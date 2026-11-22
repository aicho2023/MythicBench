"""The scripted commander: a baseline that plays through the agents' interface.

It is a "model" (a ChatClient) that reads exactly the text an LLM agent reads
and replies with the same JSON orders, using only the same tools: "safe" to
leave a pool, "next" to walk the route, coordinates, and a priority list.
Its rules are the obvious ones a new group would agree on, fixed in advance:

* kick every interruptible caster (each interrupter keeps its kick on every
  caster in sight; the 350 ms reaction rule applies as for the models);
* kill casters first, then adds, then the boss; spread AoE when 3+ enemies;
* the tank taunts adds that aren't on it and uses its defensive when low;
* the healer heals the lowest ally, shields the tank, and group-heals when
  two or more allies are low;
* melee walk into range of their target; anyone in a pool steps out;
* out of combat, walk on when the party is healthy, otherwise rest.

It never learns (its notes stay empty, it says nothing in the talk), so its
score is the floor that the harness's macros give for free: whatever a model
scores above it is the model's own doing.
"""

from __future__ import annotations

import json
import re

from .. import content as C
from ..engine import dist
from .clients import Reply

CASTERS = {d.name for d in C.TRASH.values() if not d.swing_ms}
_LINE = re.compile(r"^\s+(\w+)(?: \(YOU\))? \((\w+)\) (\d+)% HP.*? at \((-?[\d.]+), (-?[\d.]+)\)")
_ENEMY = re.compile(r"(\w+) \(([^)]+)\) (\d+)% HP at \((-?[\d.]+), (-?[\d.]+)\) attacking (\w+)")
_BOSS = re.compile(r"^BOSS mortisar ([\d.]+)% HP, attacking (\w+)")


def _party(state: str) -> dict[str, dict]:
    out = {}
    lines = state.split("PARTY:", 1)[-1].split("PARTY CHAT", 1)[0].splitlines()
    for line in lines:
        m = _LINE.match(line)
        if m:
            out[m.group(1)] = {"class": m.group(2), "hp": int(m.group(3)), "pos": (float(m.group(4)), float(m.group(5))),
                               "line": line}
        else:
            dead = re.match(r"^\s+(\w+)(?: \(YOU\))? \((\w+)\): DEAD", line)
            if dead:
                out[dead.group(1)] = {"class": dead.group(2), "hp": 0, "pos": None, "line": line}
    return out


def _enemies(state: str) -> list[dict]:
    line = next((l for l in state.splitlines() if l.startswith(("ENEMIES FIGHTING YOU:", "ADDS:"))), "")
    out = [{"id": m.group(1), "name": m.group(2), "hp": int(m.group(3)),
            "pos": (float(m.group(4)), float(m.group(5))), "on": m.group(6)} for m in _ENEMY.finditer(line)]
    for l in state.splitlines():
        b = _BOSS.match(l)
        if b:
            out.append({"id": "mortisar", "name": "Mortisar", "hp": float(b.group(1)), "pos": C.BOSS_POS, "on": b.group(2)})
    return out


def orders(me: str, state: str) -> dict:
    cls = C.CLASSES[next(m.cls for m in C.PARTY if m.id == me)]
    abilities = [C.ABILITIES[a] for a in cls.abilities]
    party = _party(state)
    mine = party.get(me, {})
    enemies = _enemies(state)
    order: dict = {"move_to": None, "say": ""}
    if "STANDING IN POOL" in mine.get("line", ""):
        order["move_to"] = "safe"
    elif "Out of combat" in state.splitlines()[0]:
        healthy = all(p["hp"] >= 70 for p in party.values())
        order["move_to"] = "next" if healthy else None
    # Who to hit: casters, then adds (lowest first), then the boss.
    adds = sorted((e for e in enemies if e["id"] != "mortisar"), key=lambda e: (e["name"] not in CASTERS, e["hp"], e["id"]))
    targets = adds + [e for e in enemies if e["id"] == "mortisar"]
    target = targets[0] if targets else None
    prio: list[list[str]] = []
    kick = next((a for a in abilities if a.kind == "interrupt"), None)
    if kick:
        for e in targets:
            if e["name"] in CASTERS or e["id"] == "mortisar":
                prio.append([kick.id, e["id"]])
    role = cls.role
    alive = {k: v for k, v in party.items() if v["hp"] > 0}
    if role == "healer":
        low = sorted(alive.items(), key=lambda kv: kv[1]["hp"])
        tank = next((k for k, v in alive.items() if v["class"] == "guardian"), None)
        for a in abilities:
            if a.kind == "raid_heal" and sum(v["hp"] < 60 for v in alive.values()) >= 2:
                prio.append([a.id, me])
        for a in abilities:
            if a.kind == "absorb" and tank:
                prio.append([a.id, tank])
        for a in abilities:
            if a.kind == "heal" and low:
                prio.append([a.id, low[0][0]])
        for a in abilities:
            if a.kind == "hot" and tank:
                prio.append([a.id, tank])
    if role == "tank":
        if any(e["on"] != me for e in adds):
            prio += [[a.id, me] for a in abilities if a.kind == "taunt"]
        if mine.get("hp", 100) < 50:
            prio += [[a.id, me] for a in abilities if a.kind == "buff"]
    elif role == "dps":
        if any(e["id"] == "mortisar" for e in enemies):
            prio += [[a.id, me] for a in abilities if a.kind == "buff"]
    if len(enemies) >= 3:
        prio += [[a.id, me] for a in abilities if a.kind == "aoe_damage"]
    if target:
        dmg = sorted((a for a in abilities if a.kind == "damage"), key=lambda a: -a.cooldown_ms)
        prio += [[a.id, target["id"]] for a in dmg]
        # Walk into range of the target (melee) unless already moving for a reason.
        reach = max((a.range for a in dmg), default=C.MELEE_RANGE)
        here = mine.get("pos")
        if here and order["move_to"] is None and "Out of combat" not in state.splitlines()[0]:
            radius = C.BOSS.radius if target["id"] == "mortisar" else C.ADD.radius
            d = dist(here, target["pos"])
            if d - radius - 0.45 > reach - 0.3:
                stop = radius + 0.45 + min(reach, C.MELEE_RANGE) * 0.5
                f = (d - stop) / d
                order["move_to"] = [round(here[0] + (target["pos"][0] - here[0]) * f, 2),
                                    round(here[1] + (target["pos"][1] - here[1]) * f, 2)]
    order["priority"] = prio
    return order


class ScriptedCommander:
    """A ChatClient that answers every agent call with fixed rules (no API, no cost)."""

    def __init__(self, model: str = "commander"):
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
