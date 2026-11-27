"""The expert script: proof that a clear is possible through the agents' interface.

Like the scripted commander it is a "model" (a ChatClient) that reads exactly
the text an agent reads and replies with the same JSON orders. The game, the
view and the reply format are the models'. What differs is the knowledge: its
rules were written by someone who knows the fight, and they never change.

* Bone Pyre: two players stand in the circle, the archer first, then whoever
  has the cleanest way in (the melee only if needed, the healer last).
* Grave Mark: the marked player walks clear of everyone until it goes off.
* Pools: nobody walks through Desecrate or a grave if a dry way exists; anyone
  standing in one steps out. The tank drags trash off graves (they heal undead)
  and moves Oruth when pools crowd the melee spots around him.
* Kicks: every interrupter keeps its kick on every caster in sight.
* Trash: the tank holds the walkers a few metres from the caster; the caster
  dies first, then the walkers evenly, so they die together.
* Boss: Ironhide is saved for Soul Rend; the healer keeps the tank topped up
  and attacks only when nobody needs healing; Wild Roar opens the fight.
* Pace: the tank pulls; everyone else waits just outside aggro, and nobody
  rests unless someone is low.

It never learns (notes stay empty, it says nothing in the talk), and it plays
the same "blind" view the models get: no boss timers, only what's on screen.
"""

from __future__ import annotations

import json
import math
import re

from .. import content as C
from ..engine import dist
from .clients import Reply

CASTERS = {d.name for d in C.TRASH.values() if not d.swing_ms}
_PARTY_LINE = re.compile(r"^\s+(\w+)(?: \(YOU\))? \((\w+)\) (\d+)% HP \((\d+)/(\d+)\)(?: \+(\d+) shield)? at "
                         r"\((-?[\d.]+), (-?[\d.]+)\)")
_DEAD_LINE = re.compile(r"^\s+(\w+)(?: \(YOU\))? \((\w+)\): DEAD")
_ENEMY = re.compile(r"(\w+) \(([^)]+)\) (\d+)% HP at \((-?[\d.]+), (-?[\d.]+)\) attacking (\w+)"
                    r"(?:, casting (\w+))?")
_BOSS = re.compile(r"^BOSS oruth ([\d.]+)% HP at \((-?[\d.]+), (-?[\d.]+)\), attacking (\w+)(?:, casting (\w+))?")
_POOL = re.compile(r"(\w+) \((\w+)\) at \((-?[\d.]+), (-?[\d.]+)\) r=([\d.]+)(?: goes off in ([\d.]+)s)?")
_MARK = re.compile(r"grave_mark (\d+)s")

ROLE_OF = {m.id: C.CLASSES[m.cls].role for m in C.PARTY}
CLASS_OF = {m.id: m.cls for m in C.PARTY}
RANGED = {m.id for m in C.PARTY
          if all(C.ABILITIES[a].range > C.KICK_RANGE for a in C.CLASSES[m.cls].abilities
                 if C.ABILITIES[a].kind == "damage")}
SOAK_ORDER = ["wren", "kit", "brask", "ivy"]  # who stands in Bone Pyre, by preference
SOAK_BIAS = 1.0  # metres of extra walking each step down that list is worth
MELEE_SOAK = 8.0  # ...and a melee's lost hits, in metres
TANK = next(m.id for m in C.PARTY if ROLE_OF[m.id] == "tank")
BOSS_SPOT = (0.0, 1.0)  # where the tank holds Oruth: room to step around pools
HOLD_GAP = 5.5  # on trash, how far from the caster the tank holds the walkers
TANK_TOPUP = 95  # on the boss, the healer keeps healing the tank below this (% when asked)
WADE = 1.2  # metres of pool a melee will cut across to get back to Oruth
PACK_AT = {p.id: (0.0, sum(z for _, (_, z) in p.members) / len(p.members)) for p in C.PACKS}
PACK_EDGE = {p.id: max(z for _, (_, z) in p.members) for p in C.PACKS}  # the member nearest the entrance


# ---------------------------------------------------------------------------
# Reading the state text
# ---------------------------------------------------------------------------

def read_state(state: str) -> dict:
    lines = state.splitlines()
    s: dict = {"party": {}, "enemies": [], "pools": [], "boss": None,
               "in_combat": "IN COMBAT" in lines[0], "packs": {}}
    section = None
    for line in lines:
        if line.startswith("PACK "):
            pid = re.search(r"\((chapel|ossuary)\)", line)
            if pid:
                s["packs"]["pack1" if pid.group(1) == "chapel" else "pack2"] = line.split(": ")[1].split(",")[0].lower()
        elif line.startswith("BOSS oruth"):  # "is asleep" has no numbers to read: boss stays None
            b = _BOSS.match(line)
            if b:
                s["boss"] = {"id": "oruth", "name": "Oruth", "hp": float(b.group(1)),
                             "pos": (float(b.group(2)), float(b.group(3))), "on": b.group(4), "casting": b.group(5)}
        elif line.startswith("ENEMIES FIGHTING YOU:") or line.startswith("ADDS:"):
            s["enemies"] = [{"id": m.group(1), "name": m.group(2), "hp": int(m.group(3)),
                             "pos": (float(m.group(4)), float(m.group(5))), "on": m.group(6), "casting": m.group(7)}
                            for m in _ENEMY.finditer(line)]
        elif line.startswith("POOLS:"):
            s["pools"] = [{"id": m.group(1), "kind": m.group(2), "pos": (float(m.group(3)), float(m.group(4))),
                           "r": float(m.group(5)), "fuse": float(m.group(6)) if m.group(6) else None}
                          for m in _POOL.finditer(line)]
        elif line.startswith("PARTY:"):
            section = "party"
        elif line.startswith("PARTY CHAT") or line.startswith("YOUR CURRENT ORDERS"):
            section = None
        elif section == "party":
            m = _PARTY_LINE.match(line)
            if m:
                s["party"][m.group(1)] = {"hp": int(m.group(3)), "pos": (float(m.group(7)),
                                          float(m.group(8))), "marked": "grave_mark" in line,
                                          "casting": ", casting " in line, "moving": " moving" in line,
                                          "line": line, "in_pool": "STANDING IN POOL" in line}
                mk = _MARK.search(line)
                s["party"][m.group(1)]["mark_s"] = float(mk.group(1)) if mk else None
            else:
                d = _DEAD_LINE.match(line)
                if d:
                    s["party"][d.group(1)] = {"hp": 0, "pos": None, "marked": False,
                                              "casting": False, "moving": False, "line": line, "in_pool": False}
    return s


def _in(p, pool, pad: float = 0.0) -> bool:
    return p is not None and dist(p, pool["pos"]) <= pool["r"] + C.PLAYER_RADIUS * 0.5 + pad


def _seg_dist(p, a, b) -> float:
    ax, az = b[0] - a[0], b[1] - a[1]
    L = ax * ax + az * az
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * ax + (p[1] - a[1]) * az) / L))
    return dist(p, (a[0] + t * ax, a[1] + t * az))


def _path_clear(a, b, hazards, pad: float = 0.5) -> bool:
    return all(_seg_dist(g["pos"], a, b) > g["r"] + pad for g in hazards)


def _wet(a, b, hazards, pad: float = 0.35) -> float:
    """Metres of the straight path a -> b that run through hazard pools."""
    d = dist(a, b)
    n = max(1, int(d / 0.25))
    wet = 0
    for i in range(n + 1):
        t = i / n
        p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        if any(dist(p, g["pos"]) <= g["r"] + pad for g in hazards):
            wet += 1
    return wet * d / (n + 1)


def _in_boss_room(p, margin: float = 1.0) -> bool:
    if dist(p, (0.0, 0.0)) > 15.0 - margin:
        return False
    th = C.OBSTACLES[0]
    return not (abs(p[0] - th.center[0]) < th.half[0] + margin and abs(p[1] - th.center[1]) < th.half[1] + margin)


def _clearance(p, hazards) -> float:
    return min((dist(p, g["pos"]) - g["r"] for g in hazards), default=99.0)


def _walkable(p, margin: float = 0.8) -> bool:
    """Inside a room or corridor (with a margin), and not inside the throne."""
    th = C.OBSTACLES[0]
    if abs(p[0] - th.center[0]) < th.half[0] + margin and abs(p[1] - th.center[1]) < th.half[1] + margin:
        return False
    if any(o.half is None and dist(p, o.center) < o.radius + C.PLAYER_RADIUS + 0.2 for o in C.OBSTACLES):
        return False
    if any(dist(p, r.center) <= r.radius - margin for r in C.ROOMS):
        return True
    return any(abs(p[0]) <= c.x_half - margin and c.z_min <= p[1] <= c.z_max for c in C.CORRIDORS)


def _clear_spot(start, pools, toward=None, avoid=(), min_from: float = 0.0, step: float = 1.0, here=None):
    """The nearest walkable spot (rings around ``start``) outside every hazard pool,
    at least ``min_from`` from each point in ``avoid``, reached without wading
    through a pool from ``here``; ties go toward ``toward``."""
    hz = [g for g in pools if g["kind"] in C.HAZARD_POOLS]
    here = here or start
    best = None
    for ring in range(0, 16):
        r = ring * step
        for k in range(16 if ring else 1):
            a = 2 * math.pi * k / 16
            p = (start[0] + r * math.cos(a), start[1] + r * math.sin(a))
            if not _walkable(p) or any(_in(p, g, 0.4) for g in hz):
                continue
            if any(dist(p, q) < min_from for q in avoid):
                continue
            score = r + (0.2 * dist(p, toward) if toward else 0.0) + 12 * _wet(here, p, hz)
            if best is None or score < best[0]:
                best = (score, p)
        if best and ring >= 3:
            break
    return (round(best[1][0], 2), round(best[1][1], 2)) if best else None


def _straight_ok(a, b, margin: float = 0.35) -> bool:
    d = dist(a, b)
    n = max(1, int(d / 0.25))
    return all(C.walkable((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n), margin) for i in range(n + 1))


def _toward(here, goal):
    """The goal if a straight walk reaches it, else the point on the corridors'
    line (x = 0) nearest the goal that one does: one order, no wasted legs."""
    if _straight_ok(here, goal):
        return goal
    z, step = goal[1], (0.5 if here[1] > goal[1] else -0.5)
    while (z < here[1]) if step > 0 else (z > here[1]):
        p = (0.0, z)
        if _straight_ok(here, p):
            return p
        z += step
    return (0.0, here[1])


def _dry(here, dest, hazards, limit: float = 0.3):
    """The first leg of a dry way to ``dest``: straight there if that stays out of
    pools, else to a dry point from which the rest is dry too (the next call
    finishes the walk), else None (stay put)."""
    if dest is None:
        return None
    dest = (dest[0], dest[1])
    if _wet(here, dest, hazards) <= limit:
        return [round(dest[0], 2), round(dest[1], 2)]
    best = None
    d0 = dist(here, dest)
    for r in (1.5, 3.0, 4.5, 6.0):
        for k in range(16):
            a = 2 * math.pi * k / 16
            via = (here[0] + r * math.cos(a), here[1] + r * math.sin(a))
            if not _walkable(via, 0.6) or any(_in(via, g, 0.3) for g in hazards):
                continue
            if _wet(here, via, hazards) > limit or _wet(via, dest, hazards) > limit:
                continue
            total = r + dist(via, dest)
            if total > d0 + 8.0:
                continue
            if best is None or total < best[0]:
                best = (total, via)
    return [round(best[1][0], 2), round(best[1][1], 2)] if best else None


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------

def orders(me: str, state: str) -> dict:
    s = read_state(state)
    cls = C.CLASSES[CLASS_OF[me]]
    abil = {a: C.ABILITIES[a] for a in cls.abilities}
    role = cls.role
    party = s["party"]
    mine = party.get(me) or {}
    here = mine.get("pos")
    alive = {k: v for k, v in party.items() if v["hp"] > 0}
    pools = s["pools"]
    hazards = [g for g in pools if g["kind"] in C.HAZARD_POOLS]
    boss = s["boss"]
    adds = s["enemies"]
    order: dict = {"move_to": None, "priority": [], "say": ""}
    if not here:
        return order

    # --- targets -------------------------------------------------------------
    casters = [e for e in adds if e["name"] in CASTERS]
    walkers = sorted((e for e in adds if e["name"] not in CASTERS), key=lambda e: (e["hp"], e["id"]))
    # Trash: the caster first; then the healthiest walker, so the walkers die
    # together and none of them is left standing on a fresh grave.
    even = sorted(walkers, key=lambda e: (-e["hp"], e["id"])) if not boss else walkers
    trash_target = (casters + even)[0] if (casters or even) else None
    if boss:
        # On the boss: Oruth is the target. The tank holds the adds he summons
        # and area attacks wear them down; the archer takes any the tank lost.
        target = boss
        loose = [e for e in walkers if e["on"] != TANK]
        if role == "dps" and me in RANGED and loose:
            target = loose[0]
    else:
        target = trash_target

    prio: list[list[str]] = []
    kick = next((a for a in abil.values() if a.kind == "interrupt"), None)
    if kick:
        for e in casters + ([boss] if boss else []):
            prio.append([kick.id, e["id"]])

    # --- healer ----------------------------------------------------------------
    if role == "healer":
        lows = sorted(alive.items(), key=lambda kv: kv[1]["hp"])
        if boss and boss.get("casting") == "soul_rend" and TANK in alive:
            prio.append(["lumen_ward", TANK])
            if alive[TANK]["hp"] < 90:
                prio.append(["mending_light", TANK])
        hurt = [k for k, v in alive.items() if v["hp"] < 65]
        if len(hurt) >= 3:
            prio.append(["radiant_hymn", me])
        if lows and lows[0][1]["hp"] < 50:
            prio.append(["lumen_ward", lows[0][0]])
            prio.append(["mending_light", lows[0][0]])
        if TANK in alive:
            prio.append(["lumen_ward", TANK])
            if alive[TANK]["hp"] < 80 and "bloomward" not in alive[TANK]["line"]:
                prio.append(["bloomward", TANK])
        if lows and lows[0][1]["hp"] < 72:
            prio.append(["mending_light", lows[0][0]])
        # The tank's health can fall a long way between two calls: on the boss,
        # keep healing him unless he's nearly full when asked.
        if boss and TANK in alive and alive[TANK]["hp"] < TANK_TOPUP:
            prio.append(["mending_light", TANK])
        if target:
            prio.append(["sunspark", target["id"]])

    # --- tank ------------------------------------------------------------------
    if role == "tank":
        if any(e["on"] != me for e in walkers):
            prio.append(["challenging_roar", me])
        # On the boss, Ironhide is for Soul Rend only (its cooldown barely covers it).
        if (boss and boss.get("casting") == "soul_rend") or (not boss and mine["hp"] < 45):
            prio.append(["ironhide", me])

    # --- damage ----------------------------------------------------------------
    if role == "dps" and boss and "wild_roar" in abil:
        prio.append(["wild_roar", me])
    # Area attacks first when two enemies are in reach of them; then the
    # hardest-hitting attack that's ready.
    aoe = [a for a in abil.values() if a.kind == "aoe_damage"]
    if aoe and sum(dist(here, e["pos"]) <= aoe[0].radius + 1.0 for e in adds + ([boss] if boss else [])) >= 2:
        prio += [[a.id, me] for a in aoe]
    if target:
        prio += [[a.id, target["id"]] for a in sorted((a for a in abil.values() if a.kind == "damage"),
                                                      key=lambda a: -a.amount)]
    order["priority"] = prio

    # --- movement ----------------------------------------------------------------
    move = None
    if boss and s["in_combat"]:
        move = _boss_move(me, s, target)
        if move == "stop":
            move = None if not mine.get("moving") else "stop"
        elif mine.get("in_pool") and (move is None or any(_in(tuple(move), g) for g in hazards)):
            move = "safe"  # the harness's step out keeps the target in range and avoids other pools
    elif not s["in_combat"]:
        move = _walk_on(me, s)
        if mine.get("in_pool") and (move is None or _wet(here, tuple(move), hazards) > 5.5):
            move = "safe"
    elif mine.get("in_pool"):
        move = "safe"
    else:
        move = _trash_move(me, s, target)
    order["move_to"] = move
    return order


def _walk_on(me: str, s: dict):
    """Out of combat: walk straight to the next pull (the corridors are all on x = 0)."""
    party = s["party"]
    if any(v["hp"] == 0 for v in party.values()):
        return None  # wait for the revive
    alive = [v for v in party.values() if v["hp"] > 0]
    ready = min(v["hp"] for v in alive) >= 40  # health comes back at 4%/s while we walk
    here = party[me]["pos"]
    packs = s["packs"]
    if packs.get("pack1") != "dead":
        goal, edge = PACK_AT["pack1"], PACK_EDGE["pack1"] + C.AGGRO_RADIUS
    elif packs.get("pack2") != "dead":
        goal, edge = PACK_AT["pack2"], PACK_EDGE["pack2"] + C.AGGRO_RADIUS
    else:
        goal, edge = BOSS_SPOT, C.BOSS_POS[1] + C.BOSS_ENGAGE_RADIUS
    # The tank pulls; everyone else waits just outside aggro and comes in once
    # the pull is on (the next call after it, a moment later).
    if me == TANK and ready:
        dest = (0.0, goal[1] - 2.0)
    elif me == TANK:
        dest = (0.0, edge + 0.5)  # wait at the edge of aggro for the party to top up
    else:
        dest = ((-1.0 if me in ("brask", "wren") else 1.0), edge + (1.5 if me in ("brask", "kit") else 3.5))
    dest = _toward(here, dest)
    return [round(dest[0], 2), round(dest[1], 2)] if dist(here, dest) > 0.8 else None


def _trash_move(me: str, s: dict, target):
    party = s["party"]
    here = party[me]["pos"]
    hazards = [g for g in s["pools"] if g["kind"] in C.HAZARD_POOLS]
    if me == TANK:
        # Hold the walkers a little way from the caster (its graves can't heal
        # it, and theirs can't heal the caster), close enough for area attacks.
        caster = next((e for e in s["enemies"] if e["name"] in CASTERS), None)
        if caster:
            hold = (caster["pos"][0], caster["pos"][1] + HOLD_GAP)
            if dist(here, hold) > 1.2 and not any(_in(hold, g, 0.3) for g in hazards):
                return _dry(here, hold, hazards, 0.6)
        # Drag the pack off any grave: they heal undead standing in them.
        healing = [e for e in s["enemies"] if any(_in(e["pos"], g) for g in hazards if g["kind"] == "grave")]
        if healing:
            nxt = (0.0, here[1] - 8.0)  # toward the next pull
            spot = _clear_spot(here, s["pools"], step=1.5, toward=nxt, avoid=[g["pos"] for g in hazards],
                               min_from=C.GRAVE_RADIUS + 2.5, here=here)
            if spot and dist(spot, here) > 0.5:
                return list(spot)
        return None
    if me in RANGED or ROLE_OF[me] == "healer":
        if target and dist(here, target["pos"]) > 26.0:
            return list(_toward(here, (0.0, target["pos"][1] + 12.0)))
        return None  # cast from where we are
    if target is None:
        return None
    return _approach(here, target, s["pools"])


def _approach(here, target, pools):
    """Into melee reach of the target, by the spot whose straight path stays out of pools."""
    reach = C.MELEE_RANGE
    radius = C.BOSS.radius if target["id"] == "oruth" else C.ADD.radius
    d = dist(here, target["pos"])
    if d - radius - C.PLAYER_RADIUS <= reach - 0.05:
        return None  # in reach: the harness keeps us there
    hz = [g for g in pools if g["kind"] in C.HAZARD_POOLS]
    stop = radius + C.PLAYER_RADIUS + reach * 0.5
    best = None
    for k in range(16):
        a = 2 * math.pi * k / 16
        p = (target["pos"][0] + stop * math.cos(a), target["pos"][1] + stop * math.sin(a))
        if any(_in(p, g, 0.3) for g in hz):
            continue
        cost = dist(here, p) + 12 * _wet(here, p, hz)
        if best is None or cost < best[0]:
            best = (cost, p)
    if best is None:
        return None
    dest = best[1]
    if not _straight_ok(here, dest):
        dest = _toward(here, dest)  # the target is in another room: round the corner first
    return [round(dest[0], 2), round(dest[1], 2)]


def _boss_move(me: str, s: dict, target):
    party = s["party"]
    mine = party[me]
    here = mine["pos"]
    boss = s["boss"]
    alive = {k: v for k, v in party.items() if v["hp"] > 0}
    pyres = [g for g in s["pools"] if g["kind"] == "pyre"]
    hazards = [g for g in s["pools"] if g["kind"] in C.HAZARD_POOLS]
    # Bone Pyre: the two free players with the cleanest way in stand in it.
    if pyres:
        pyre = pyres[0]
        fuse = pyre["fuse"] if pyre["fuse"] is not None else C.PYRE_FUSE_MS / 1000
        # A marked player can still soak if the pyre goes off well before the mark (a
        # routine call, at most 4 s apart, then takes them clear in time).
        free = [p for p in SOAK_ORDER if p in alive
                and (not alive[p]["marked"] or (alive[p]["mark_s"] or 0) > fuse + 4.3)]

        def route_cost(p):
            at = alive[p]["pos"]
            if dist(at, pyre["pos"]) <= pyre["r"] - 0.2:
                return -100.0  # already in: stay
            spot = _soak_spot(at, pyre, hazards, 0)
            if spot is None:
                return 999.0
            melee = p not in RANGED and ROLE_OF[p] != "healer"
            return dist(at, spot) + 12 * _wet(at, spot, hazards) + SOAK_BIAS * SOAK_ORDER.index(p) + (MELEE_SOAK if melee else 0)
        soakers = sorted(free, key=lambda p: (route_cost(p), SOAK_ORDER.index(p)))[:C.PYRE_SOAKERS]
        if me in soakers:
            inside = dist(here, pyre["pos"]) <= pyre["r"] + C.PLAYER_RADIUS * 0.5 - 0.1
            if inside and (not mine["in_pool"] or fuse <= 1.0):
                return "stop"  # in it: stay (a pool that lands this late hits once at most)
            bodies = [(v["pos"], C.PLAYER_RADIUS) for k, v in alive.items() if k != me]
            bodies += [(e["pos"], C.ADD.radius) for e in s["enemies"]]
            bodies.append((boss["pos"], C.BOSS.radius))
            spot = _soak_spot(here, pyre, hazards, soakers.index(me), bodies)
            if spot and dist(spot, here) > 0.4:
                return [round(spot[0], 2), round(spot[1], 2)]
            return None
    # Grave Mark: walk clear of everyone (6 m) without wading through pools.
    if mine["marked"]:
        others = [v["pos"] for k, v in alive.items() if k != me]
        if all(dist(here, q) > C.GRAVE_MARK_RADIUS + 0.8 for q in others):
            return None
        spot = _clear_spot(here, s["pools"], toward=boss["pos"], avoid=others,
                           min_from=C.GRAVE_MARK_RADIUS + 1.2, step=1.0, here=here)
        return _dry(here, spot, hazards, 0.6)
    marked = [v["pos"] for k, v in alive.items() if v["marked"] and k != me]
    if marked and any(dist(here, q) <= C.GRAVE_MARK_RADIUS + 0.6 for q in marked):
        spot = _clear_spot(here, s["pools"], toward=boss["pos"], avoid=marked, min_from=C.GRAVE_MARK_RADIUS + 1.0,
                           step=1.0, here=here)
        return _dry(here, spot, hazards, 0.6)
    if me == TANK:
        # Hold Oruth on clean ground: when pools crowd him, take him somewhere with room.
        spot = BOSS_SPOT if not hazards and dist(here, BOSS_SPOT) > 1.0 else None
        if _melee_room(boss["pos"], hazards) < 7 or _clearance(boss["pos"], hazards) < 1.0:
            spot = _roomy_spot(boss["pos"], hazards, here)
        if spot and dist(here, spot) > 1.0:
            return _dry(here, spot, hazards)
        return None
    if me in RANGED or ROLE_OF[me] == "healer":
        if mine["casting"]:
            return None
        # Stand 6-11 m from Oruth on clean ground, ready for the next pyre.
        d = dist(here, boss["pos"])
        if 5.5 <= d <= 11.5 and _clearance(here, hazards) > 0.8:
            return None
        spot = _ranged_spot(here, boss["pos"], hazards, me)
        return _dry(here, spot, hazards) if spot and dist(spot, here) > 0.5 else None
    if not target:
        return None
    ap = _approach(here, target, s["pools"])
    return _dry(here, ap, hazards) or _dry(here, ap, hazards, WADE)


def _soak_spot(here, pyre, hazards, slot: int, bodies=()):
    """A spot inside the pyre, clear of pools and of other bodies in it, reached
    by the driest straight walk."""
    best = None
    c = pyre["pos"]
    # Inside counts out to the rim plus half a body; the outer rings are the
    # fallback when a pool has landed on the middle.
    for r in (0.0, 0.7, 1.3, 1.9, 2.3, 2.6):
        for k in range(12 if r else 1):
            a = 2 * math.pi * (k + 0.5 * slot) / 12
            p = (c[0] + r * math.cos(a), c[1] + r * math.sin(a))
            if any(_in(p, g, 0.05) for g in hazards) or not _walkable(p, 0.4):
                continue
            if any(dist(p, b) < r_b + C.PLAYER_RADIUS + 0.15 for b, r_b in bodies):
                continue
            cost = dist(here, p) + 12 * _wet(here, p, hazards) + 0.5 * r + (3.0 if r > 2.0 else 0.0)
            if best is None or cost < best[0]:
                best = (cost, p)
    return best[1] if best else None


def _melee_room(at, hazards) -> int:
    """How many of 16 melee spots around a boss standing at ``at`` are out of pools."""
    stop = C.BOSS.radius + C.PLAYER_RADIUS + C.MELEE_RANGE * 0.5
    return sum(not any(_in((at[0] + stop * math.cos(2 * math.pi * k / 16), at[1] + stop * math.sin(2 * math.pi * k / 16)),
                           g, 0.3) for g in hazards) for k in range(16))


def _roomy_spot(at, hazards, here=None):
    best = None
    for x in range(-9, 10, 1):
        for z in range(-6, 10, 1):
            p = (float(x), float(z))
            if not _in_boss_room(p, 4.0) or not _walkable(p):
                continue
            room = min(_clearance(p, hazards), 6.0)
            score = room - 0.12 * dist(p, at) - (1.5 * _wet(here, p, hazards) if here else 0.0)
            if best is None or score > best[0]:
                best = (score, p)
    return best[1] if best else BOSS_SPOT


def _ranged_spot(here, boss_pos, hazards, me):
    best = None
    side = -1.0 if me == "wren" else 1.0
    for k in range(24):
        a = 2 * math.pi * k / 24
        for r in (7.0, 8.5, 10.0):
            p = (boss_pos[0] + r * math.cos(a), boss_pos[1] + r * math.sin(a))
            if not _in_boss_room(p, 1.5) or not _walkable(p):
                continue
            room = min(_clearance(p, hazards), 4.0)
            if room < 1.0:
                continue
            score = room - 0.25 * dist(p, here) + 0.3 * side * (p[0] - boss_pos[0]) / r
            if not _path_clear(here, p, hazards):
                score -= 5
            if best is None or score > best[0]:
                best = (score, p)
    return best[1] if best else None


class ExpertScript:
    """A ChatClient that answers every agent call with the expert's rules (no API, no cost)."""

    def __init__(self, model: str = "expert"):
        self.model = model
        self.spec = f"scripted:{model}"

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        me = re.search(r"\((\w+)\), the ", system).group(1)
        n = (len(system) + len(user)) // 4
        if "WRITE YOUR NOTES" in user:
            return Reply(json.dumps({"notes": "(scripted: fixed rules, no notes)"}), n, 0, 0.0)
        if "PARTY TALK" in user:
            return Reply(json.dumps({"message": "", "ready": True}), n, 0, 0.0)
        return Reply(json.dumps(orders(me, user)), n, 0, 0.0)
