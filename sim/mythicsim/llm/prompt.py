"""What the model sees and how its reply is read.

The system prompt states the *rules* (what every ability does, the arena, the
reply format), the same information a player gets from tooltips. It gives no
strategy: deciding who interrupts, when to move, and what to prioritise is
exactly what the benchmark measures.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from .. import content as C
from ..engine import dist

# Same hit test the engine uses for pools (centre within radius + half a body).
POOL_HIT_PAD = 0.45 * 0.5

KIND_TEXT = {
    "damage": "single-target damage", "aoe_damage": "damages every enemy within {radius:g} m of you",
    "heal": "heals one ally", "hot": "heal over time on one ally", "absorb": "damage shield on one ally",
    "raid_heal": "heals the whole party", "buff": "buff", "interrupt": "interrupts the target's cast",
    "boss": "boss ability",
    "taunt": "makes every add within {radius:g} m attack you",
}


def _ability_line(aid: str) -> str:
    a = C.ABILITIES[aid]
    bits = [KIND_TEXT.get(a.kind, a.kind).format(radius=a.radius)]
    if a.amount:
        bits.append(f"amount {a.amount}")
    bits.append(f"cast {a.cast_ms / 1000:g}s" if a.cast_ms else "instant")
    if a.cooldown_ms:
        bits.append(f"cooldown {a.cooldown_ms / 1000:g}s")
    if not a.on_gcd:
        bits.append("off the global cooldown")
    if a.kind not in ("aoe_damage", "raid_heal", "taunt", "buff", "boss"):
        bits.append(f"range {a.range:g} m")
    return f"    - {aid} ({a.name}): {', '.join(bits)}. {a.description}"


KNOWLEDGE = ("full", "blind")


def _boss_section(knowledge: str) -> str:
    b = C.BOSS
    if knowledge == "blind":
        # A first-time raider: no guide, no boss tooltips, no timers. Everything
        # about the boss has to be learned from what happens on screen.
        return f"""## Mortisar, the Hollow King ({b.max_hp:,} HP)
  - You have never fought him. His abilities, their timing, and what they do are unknown: learn them from what you see (his casts by name with a cast bar, the damage your party takes, anything that appears on the ground, any new enemies).
  - Mortisar attacks whoever he is targeting (normally the tank)."""
    boss = [_ability_line(a).replace("    - ", "  - ") for a in
            ("hollow_strike", "soul_rend", "requiem_of_bones", "desecrate", "raise_dead", "hollow_fury")]
    return f"""## Mortisar, the Hollow King ({b.max_hp:,} HP)
{chr(10).join(boss)}
  - Desecrate pools have radius {b.desecrate_radius:g} m, become dangerous {b.desecrate_arm_ms / 1000:g}s after appearing, hit for {C.ABILITIES['desecrate'].amount} every {b.desecrate_tick_ms / 1000:g}s while you stand in them, and last {b.desecrate_duration_ms / 1000:g}s.
  - Summon the Restless is cast at {', '.join(f'{int(x * 100)}%' for x in b.raise_dead_at)} boss health. Risen Bonewalkers ({C.ADD.max_hp} HP) run at the healer.
  - Mortisar attacks whoever he is targeting (normally the tank).
  - Boss timers vary from fight to fight; the state shows when each is next due."""


def notes_section(notes: str | None, pull: int | None) -> str:
    """Appended to the rules on later pulls when the agent keeps notes."""
    if not notes:
        return ""
    return (f"\n\n## Your notes from previous pulls (this is pull {pull})\n"
            f"You wrote these after earlier attempts at this boss. Use them.\n{notes.strip()}")


def system_prompt(knowledge: str = "full", notes: str | None = None, pull: int | None = None,
                  level: int = C.SIGIL_LEVEL) -> str:
    """The rules. ``knowledge="blind"`` hides everything about the boss.

    The "full" text with no notes is byte-identical to earlier harness
    versions, so its prompt hash and recorded replies stay valid."""
    from .policy import REACTION_MS  # local import: policy imports this module
    if knowledge not in KNOWLEDGE:
        raise ValueError(f"knowledge must be one of {KNOWLEDGE}")
    party = []
    for m in C.PARTY:
        cd = C.CLASSES[m.cls]
        party.append(f"  {m.id} - {m.name}, {cd.name} ({cd.role}), {cd.max_hp} HP, "
                     f"usual spot ({m.home[0]:g}, {m.home[1]:g})"
                     + (f", melee auto-attacks" if cd.auto_attack else "") + ":")
        party.extend(_ability_line(a) for a in cd.abilities)
    b = C.BOSS
    reaction = f"{REACTION_MS / 1000:g}"
    limit = f"{b.enrage_ms / 1000:g}"
    if knowledge == "blind":
        intro = f"The fight has a {limit} s time limit."
    else:
        intro = f"The boss enrages at {limit}s and then kills everyone within seconds."
    mult = C.level_multiplier(level)
    key = (f"This is a +{level} key: enemy health and damage are x{mult:.2f} compared with +{C.SIGIL_LEVEL}"
           + (" (the numbers below are for +12)." if knowledge == "full" else ".")) if level != C.SIGIL_LEVEL else ""
    return f"""You control a party of five adventurers fighting a dungeon boss in a turn-based simulation of a real-time fight. Your goal: kill the boss as fast as possible without dying. {intro}

## Score (0-100)
A wipe earns up to 70 points in proportion to the boss's health removed. A kill earns 70 plus up to 30 for speed: the full 30 for killing with a quarter of the {limit} s timer (or more) left.{(" " + key) if key else ""}

## Arena
Circular, radius {C.ARENA_RADIUS:g} m, centred on (0, 0). Positions are (x, z) in metres. Mortisar stands still at ({C.BOSS_POS[0]:g}, {C.BOSS_POS[1]:g}) with a body radius of {b.radius:g} m. Characters move at 5 m/s. Moving cancels a cast in progress, and spells with a cast time cannot be started while moving. Melee range is {C.MELEE_RANGE:g} m from the target's edge. Global cooldown (GCD): {C.GCD_MS / 1000:g}s after most abilities.

## Your party
{chr(10).join(party)}

{_boss_section(knowledge)}

## How you play
You are asked for orders every couple of seconds, and immediately when something important happens (a boss cast starts, pools appear, adds spawn, an ally gets low). The game is paused while you think. Each character keeps following its latest orders until you give it new ones:
  - "move_to": [x, z] walks there once, or "safe" steps to the nearest spot clear of all pools, reachable without walking through another pool, from which the character's first priority target is still in range when possible (the scripted bots' movement logic). Omit or null to stay put. A move is carried out each time you send it.
  - "priority": an ordered list of [ability_id, target_id]. Every tick, the character uses the FIRST entry that is ready (off cooldown, in range, GCD free, not casting or moving for cast-time spells). Off-GCD abilities in the list fire even during the GCD. Interrupts only fire while their target is casting something interruptible (reacting {reaction} s after the cast starts), so they can stay in the list; once one character interrupts, the others' interrupts see nothing to stop and stay ready. Put a reliable filler ability last so the character never idles.
  - "say": one short sentence explaining the decision (shown in the replay).
Targets are unit ids from the state (e.g. "mortisar", "bonewalker_1", "lumi"). For self-buffs and party-wide abilities use the character's own id ("self" and "party" also work).
Characters you leave out keep their previous orders.

Reply with ONLY a JSON object, no prose:
{{"orders": {{"bramble": {{"move_to": null, "priority": [["bulwark_slam", "mortisar"], ["rampart_strike", "mortisar"]], "say": "Tanking the boss."}}, "...": {{}}}}}}""" + notes_section(notes, pull)


# ---------------------------------------------------------------------------
# State rendering
# ---------------------------------------------------------------------------

def _p(v) -> str:
    return f"({v[0]:.1f}, {v[1]:.1f})"


def _cast(c: dict | None) -> str:
    if not c:
        return ""
    tgt = f" on {c['target']}" if c.get("target") else ""
    kick = " INTERRUPTIBLE" if c["interruptible"] else ""
    return f", casting {c['ability']}{tgt} ({c['remaining_ms'] / 1000:.1f}s left){kick}"


def _danger(p: dict, ground: list[dict]) -> str:
    """What a player would see at their feet. In the 3D game a swirl under you
    is unmissable; in text, the model would have to compare coordinates by hand."""
    inside, near = [], []
    for g in ground:
        d = dist(p["pos"], g["pos"])
        state = "ARMED" if g["armed"] else "arming"
        if d <= g["radius"] + POOL_HIT_PAD:
            inside.append(f"{g['id']} ({state}, {d:.1f} m from its centre, radius {g['radius']:g})")
        elif d <= g["radius"] + 1.0:
            near.append(g["id"])
    out = ""
    if inside:
        out += f" STANDING IN POOL {', '.join(inside)}!"
    if near:
        out += f" Next to pool {', '.join(near)}."
    return out


def _auras(a: dict) -> str:
    return (", auras: " + ", ".join(f"{k} {v / 1000:.0f}s" for k, v in a.items())) if a else ""


def render_state(obs: dict, gcd: dict[str, int], orders_age_s: float | None, knowledge: str = "full") -> str:  # noqa: E501
    """Compact text snapshot of the fight, from one observation.

    Blind mode shows only what's on screen: no boss-ability timers."""
    blind = knowledge == "blind"
    limit = f"{C.BOSS.enrage_ms / 1000:g}s"
    lines = [f"Time {obs['t'] / 1000:.1f}s ({'time limit' if blind else 'enrage at'} {limit})."]
    boss = next((e for e in obs["enemies"] if e["role"] == "boss"), None)
    if boss:
        lines.append(f"BOSS mortisar {boss['hp_pct']:.1f}% HP, attacking {boss['target']}"
                     f"{_cast(boss['casting'])}{_auras(boss['auras'])}.")
        if not blind:
            nxt = ", ".join(f"{k} in {v / 1000:.1f}s" for k, v in sorted(obs["boss_next_ms"].items(), key=lambda kv: kv[1]))
            lines.append(f"  Next boss abilities: {nxt}.")
    adds = [e for e in obs["enemies"] if e["role"] == "add" and e["alive"]]
    lines.append("ADDS: " + ("; ".join(f"{a['id']} {a['hp_pct']:.0f}% HP at {_p(a['pos'])} attacking {a['target']}"
                                       for a in adds) if adds else "none") + ".")
    pools = [f"{g['id']} at {_p(g['pos'])} r={g['radius']:g} {'ARMED' if g['armed'] else 'arming'}"
             for g in obs["ground"]]
    lines.append("POOLS: " + ("; ".join(pools) if pools else "none") + ".")
    lines.append("PARTY:")
    for p in obs["party"]:
        if not p["alive"]:
            lines.append(f"  {p['id']} ({p['class']}): DEAD.")
            continue
        cds = p.get("cooldowns", {})
        ready = [a for a, v in cds.items() if v == 0]
        waiting = [f"{a} {v / 1000:.1f}s" for a, v in cds.items() if v > 0]
        g = gcd.get(p["id"], 0)
        lines.append(
            f"  {p['id']} ({p['class']}) {p['hp_pct']:.0f}% HP ({p['hp']}/{p['max_hp']})"
            + (f" +{p['absorb']} shield" if p["absorb"] else "")
            + f" at {_p(p['pos'])}{' moving' if p['moving'] else ''}{_cast(p['casting'])}{_auras(p['auras'])}"
            + (f", GCD {g / 1000:.1f}s" if g else "")
            + f". Ready: {', '.join(ready) or 'nothing'}"
            + (f". On cooldown: {', '.join(waiting)}" if waiting else "") + "."
            + _danger(p, obs["ground"]))
    if orders_age_s is not None:
        lines.append(f"Your current orders were given {orders_age_s:.1f}s ago.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Reply parsing
# ---------------------------------------------------------------------------

@dataclass
class Order:
    move_to: tuple[float, float] | str | None = None  # (x, z) or "safe"
    priority: list[tuple[str, str]] = field(default_factory=list)
    say: str = ""


@dataclass
class Parsed:
    orders: dict[str, Order]
    problems: list[str]  # invalid entries we dropped (counted as a metric)
    ok: bool  # False when the reply was not usable JSON at all


def parse_reply(text: str, unit_ids: set[str], dead: set[str] = frozenset()) -> Parsed:
    """Read the model's JSON. Invalid pieces are dropped and reported, never guessed."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return Parsed({}, ["no JSON object in reply"], False)
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError as err:
        return Parsed({}, [f"invalid JSON: {err.msg}"], False)
    raw = data.get("orders") if isinstance(data, dict) else None
    if not isinstance(raw, dict):
        return Parsed({}, ["reply has no 'orders' object"], False)
    orders: dict[str, Order] = {}
    problems: list[str] = []
    for m_ in C.PARTY:
        spec = raw.get(m_.id)
        if spec is None or m_.id in dead:
            continue  # orders for a dead character are moot, not an error
        if not isinstance(spec, dict):
            problems.append(f"{m_.id}: orders must be an object")
            continue
        o = Order(say=str(spec.get("say") or "")[:200])
        mv = spec.get("move_to")
        if isinstance(mv, dict) and set(mv) >= {"x", "z"}:
            mv = [mv["x"], mv["z"]]  # {"x": .., "z": ..} is unambiguous; accept it
        if isinstance(mv, list) and len(mv) == 1 and isinstance(mv[0], str):
            mv = mv[0]  # ["safe"] means "safe"
        if isinstance(mv, str) and mv.strip().lower() == "safe":
            o.move_to = "safe"
        elif mv is not None:
            if isinstance(mv, (list, tuple)) and len(mv) == 2 and all(isinstance(v, (int, float)) for v in mv):
                o.move_to = (float(mv[0]), float(mv[1]))
            else:
                problems.append(f"{m_.id}: bad move_to {mv!r}")
        allowed = C.CLASSES[m_.cls].abilities
        for entry in spec.get("priority") or []:
            if not (isinstance(entry, (list, tuple)) and len(entry) == 2):
                problems.append(f"{m_.id}: bad priority entry {entry!r}")
                continue
            ab, tgt = str(entry[0]), str(entry[1])
            if tgt in ("self", "party", "me", "all"):
                tgt = m_.id
            if ab not in allowed:
                problems.append(f"{m_.id}: cannot use {ab!r}")
                continue
            if tgt not in unit_ids:
                problems.append(f"{m_.id}: unknown target {tgt!r}")
                continue
            o.priority.append((ab, tgt))
        orders[m_.id] = o
    for k in raw:
        if k not in {m_.id for m_ in C.PARTY}:
            problems.append(f"unknown character {k!r}")
    return Parsed(orders, problems, True)
