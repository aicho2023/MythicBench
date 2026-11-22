"""What each agent sees and how its reply is read.

Five agents play, one per character, all the same model. Each agent's system
prompt states the *rules* (what every ability in the party does, the arena,
the reply format): the same information a player gets from tooltips. It gives
no strategy: who interrupts, when to move, what to prioritise, and how to
coordinate (party chat) is exactly what the benchmark measures.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from .. import content as C
from ..engine import dist

# Party chat lines shown in the state (the most recent), and the longest
# message: 255 characters, WoW's chat limit.
CHAT_SHOWN = 12
CHAT_MAX_CHARS = 255

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


def _trash_line(aid: str, blind: bool) -> str:
    a = C.ABILITIES[aid]
    if blind:
        return f"      - {a.name}: unknown, learn it."
    bits = [f"cast {a.cast_ms / 1000:g}s", "interruptible" if a.interruptible else "not interruptible"]
    if a.cooldown_ms:
        bits.append(f"every ~{a.cooldown_ms / 1000:g}s")
    if a.amount:
        bits.append(f"{a.amount} damage")
    return f"      - {a.name} ({aid}): {', '.join(bits)}. {a.description}"


def _dungeon_section(knowledge: str, tier: str = C.DEFAULT_TIER) -> str:
    """The run before the boss: map, packs, pulling, resting, the timer."""
    blind = knowledge == "blind"
    rooms = "\n".join(f"  - {r.name} ({r.id}): circle centred ({r.center[0]:g}, {r.center[1]:g}), radius {r.radius:g} m"
                       for r in C.ROOMS)
    cors = "; ".join(f"|x| <= {c.x_half:g} for z {c.z_min:g}..{c.z_max:g}" for c in C.CORRIDORS)
    packs = []
    for p in C.PACKS:
        comp: dict[str, int] = {}
        for cls, _ in p.members:
            comp[cls] = comp.get(cls, 0) + 1
        packs.append(f"  - {p.name} in the {C.ROOMS_BY_ID[p.room].name}: " +
                     ", ".join(f"{n}x {C.TRASH[c].name}" for c, n in comp.items()))
    kinds = []
    for cls, d in C.TRASH.items():
        line = f"  - {d.name} ({d.max_hp:,} HP): " + ("melee, chases its target" if d.swing_ms else "caster, stands and casts")
        kinds.append(line + ("" if not d.spells else ":"))
        kinds.extend(_trash_line(s, blind) for s in d.spells)
    return f"""## The dungeon run
This is a full Mythic+-style run, not just the boss: walk from the entrance, clear two packs of undead, then fight Mortisar. One timer covers the whole run: {C.tier(tier).limit_ms / 1000:g} s.
Map (positions are (x, z); the entrance is at large z, Mortisar's room at the origin):
{rooms}
  - Corridors join them: {cors}. You can only walk inside rooms and corridors.
Route, entrance to boss: {', '.join(f'({w[0]:g}, {w[1]:g})' for w in C.ROUTE)}.
Packs:
{chr(10).join(packs)}
Enemies:
{chr(10).join(kinds)}
Pulling: a pack attacks when anyone comes within {C.AGGRO_RADIUS:g} m of any of its members, or hits one. Mortisar wakes when someone comes within {C.BOSS_ENGAGE_RADIUS:g} m of him; his abilities and timers only start then.
Between pulls (no enemy fighting you): the party regenerates {int(C.OOC_REGEN_PCT_PER_S * 100)}% health per second, and after {C.REVIVE_AFTER_MS / 1000:g} s out of combat fallen allies get back up at {int(C.REVIVE_HP_PCT * 100)}% health. Each revive adds {C.DEATH_PENALTY_MS / 1000:g} s to the timer. Resting costs time; pulling hurt costs lives.
Score for the run (0-100): if the party wipes, up to 70 for progress (each pack is worth 15%, Mortisar 70% by health removed); if Mortisar dies, 70 plus up to 30 for speed (the full 30 with a quarter of the timer left; revive penalties count)."""


def _tier_section(tier: str) -> str:
    """Difficulty and affixes: shown to everyone, as the game shows them."""
    t = C.tier(tier)
    if not t.affixes:
        return (f"## Difficulty: {t.name}\nEnemy health and damage are x{t.enemy_hp:g} of the listed numbers. "
                "No affixes.")
    lines = [f"## Difficulty: {t.name}",
             "Affixes this run (the dungeon's modifiers; they are always visible):"]
    lines += [f"  - {C.AFFIXES[a].name}: {C.AFFIXES[a].description}" for a in t.affixes]
    return "\n".join(lines)


def notes_section(notes: str | None, pull: int | None) -> str:
    """Appended to the rules on later pulls: the agent's own notes, verbatim."""
    if not notes:
        return ""
    return (f"\n\n## Your notes from previous pulls (this is pull {pull})\n"
            f"You wrote these yourself after earlier attempts.\n{notes.strip()}")


def system_prompt(knowledge: str = "full", notes: str | None = None, pull: int | None = None,
                  tier: str = C.DEFAULT_TIER, mode: str = "boss", me: str = "bramble") -> str:
    """The rules for the agent playing ``me``. ``knowledge="blind"`` hides
    everything about the boss. Notes (the agent's own) are appended last, so
    the text before them is identical across pulls and caches well."""
    from .policy import REACTION_MS  # local import: policy imports this module
    if knowledge not in KNOWLEDGE:
        raise ValueError(f"knowledge must be one of {KNOWLEDGE}")
    member = next(m for m in C.PARTY if m.id == me)
    mine = C.CLASSES[member.cls]
    party = []
    for m in C.PARTY:
        cd = C.CLASSES[m.cls]
        party.append(f"  {m.id} - {m.name}, {cd.name} ({cd.role}){' (YOU)' if m.id == me else ''}, {cd.max_hp} HP, "
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
    if mode == "dungeon":
        score_text = "Scored over the whole dungeon run; see \"The dungeon run\" below."
        intro += " (Mortisar's clock starts when he is pulled.)"
    else:
        score_text = (f"A wipe earns up to 70 points in proportion to the boss's health removed. A kill earns 70 plus "
                      f"up to 30 for speed: the full 30 for killing with a quarter of the {limit} s timer (or more) left.")
    next_move = (', or "next" walks to the next waypoint of the route toward the boss' if mode == "dungeon" else "")
    example = next(a for a in mine.abilities if C.ABILITIES[a].kind not in ("interrupt", "taunt", "buff"))
    tgt = "mortisar" if C.ABILITIES[example].kind in ("damage", "aoe_damage") else me
    return f"""You play {member.name} ({me}), the {mine.name} ({mine.role}), in a party of five adventurers fighting through a dungeon in a turn-based simulation of a real-time fight. Each of the other four characters is played by another player; you control only {member.name}. The party's goal: kill the boss as fast as possible without dying. {intro}

## Score (0-100, shared by the whole party)
{score_text}

{_tier_section(tier)}

## Arena
Circular, radius {C.ARENA_RADIUS:g} m, centred on (0, 0). Positions are (x, z) in metres. Mortisar stands still at ({C.BOSS_POS[0]:g}, {C.BOSS_POS[1]:g}) with a body radius of {b.radius:g} m. Characters move at 5 m/s and can't stand inside one another. Moving cancels a cast in progress, and spells with a cast time cannot be started while moving. Melee range is {C.MELEE_RANGE:g} m from the target's edge. Global cooldown (GCD): {C.GCD_MS / 1000:g}s after most abilities.

## The party
{chr(10).join(party)}

{_boss_section(knowledge)}
{(chr(10) + _dungeon_section(knowledge, tier) + chr(10)) if mode == "dungeon" else ""}
## How you play
You are asked for {member.name}'s orders every 4 seconds of game time, and immediately when something that concerns you happens. The game is paused while everyone thinks; the other players are asked at the same moments you are. {member.name} keeps following your latest orders until you change them:
  - "move_to": [x, z] walks there once, or "safe" steps to the nearest spot clear of all pools, reachable without walking through another pool, from which your first priority target is still in range when possible (the scripted bots' movement logic){next_move}. Omit or null to stay put. A move is carried out each time you send it.
  - "priority": an ordered list of [ability_id, target_id]. Every tick, {member.name} uses the FIRST entry that is ready (off cooldown, in range, GCD free, not casting or moving for cast-time spells). Off-GCD abilities in the list fire even during the GCD. Interrupts only fire while their target is casting something interruptible (reacting {reaction} s after the cast starts), so they can stay in the list; if someone else interrupts first, yours sees nothing to stop and stays ready. Put a reliable filler ability last so you never idle. Leave "priority" out to keep your current one.
  - "say": a message in party chat (at most {CHAT_MAX_CHARS} characters, as in the game), which every player sees from then on. Leave it out to say nothing.
Ground effects ("pools") in the state are dangerous to stand in: "desecrate" pools come from Mortisar, "grave" pools from the Restless Graves affix. "safe" avoids both.
Targets are unit ids from the state (e.g. "mortisar", "bonewalker_1", "lumi"). For self-buffs and party-wide abilities use your own id ("self" and "party" also work).
You can only use {member.name}'s abilities: {', '.join(mine.abilities)}.

Reply with ONLY a JSON object, no prose:
{{"move_to": null, "priority": [["{example}", "{tgt}"]], "say": ""}}""" + notes_section(notes, pull)


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


def _auras(a: dict, stacks: dict | None = None) -> str:
    stacks = stacks or {}
    return (", auras: " + ", ".join(f"{k}{f' x{stacks[k]}' if k in stacks else ''} {v / 1000:.0f}s"
                                    for k, v in a.items())) if a else ""


def render_state(obs: dict, me: str, gcd_ms: int, orders_age_s: float | None, knowledge: str = "full",
                 chat: list[tuple[int, str, str]] | None = None) -> str:
    """Compact text snapshot of the fight as one character sees it.

    Like party frames in the game: everyone's health, position, auras and
    casts are visible, but only your own cooldowns and GCD. Blind mode shows
    only what's on screen: no boss-ability timers."""
    blind = knowledge == "blind"
    limit = f"{C.BOSS.enrage_ms / 1000:g}s"
    dg = obs.get("dungeon")
    if dg:
        timer = (dg["elapsed_ms"] + dg["penalty_ms"]) / 1000
        lines = [f"Run timer {timer:.1f}s of {dg['limit_ms'] / 1000:g}s"
                 + (f" (includes {dg['penalty_ms'] / 1000:g}s of revive penalties)" if dg["penalty_ms"] else "")
                 + (". IN COMBAT." if dg["in_combat"] else ". Out of combat (resting regenerates health).")]
        for p in dg["packs"]:
            lines.append(f"PACK {p['name']} ({p['room']}): {p['state'].upper()}"
                         + (f", {len(p['alive'])} left" if p["state"] != "dead" else ""))
        if not dg["boss_engaged"]:
            lines.append("BOSS mortisar is asleep on his throne at (0.0, -2.0); he wakes when someone comes within "
                         f"{C.BOSS_ENGAGE_RADIUS:g} m.")
    else:
        lines = [f"Time {obs['t'] / 1000:.1f}s ({'time limit' if blind else 'enrage at'} {limit})."]
    boss = next((e for e in obs["enemies"] if e["role"] == "boss"), None)
    if boss and dg and not dg["boss_engaged"]:
        boss = None  # described above as asleep
    if boss:
        lines.append(f"BOSS mortisar {boss['hp_pct']:.1f}% HP, attacking {boss['target']}"
                     f"{_cast(boss['casting'])}{_auras(boss['auras'])}.")
        if not blind:
            nxt = ", ".join(f"{k} in {v / 1000:.1f}s" for k, v in sorted(obs["boss_next_ms"].items(), key=lambda kv: kv[1]))
            lines.append(f"  Next boss abilities: {nxt}.")
    adds = [e for e in obs["enemies"] if e["role"] == "add" and e["alive"] and e.get("engaged", True)]
    lines.append(("ENEMIES FIGHTING YOU: " if dg else "ADDS: ")
                 + ("; ".join(f"{a['id']} ({a['name']}) {a['hp_pct']:.0f}% HP at {_p(a['pos'])} attacking {a['target']}"
                              f"{_cast(a['casting'])}" for a in adds) if adds else "none") + ".")
    if dg:
        idle = [e for e in obs["enemies"] if e["role"] == "add" and not e.get("engaged", True)]
        if idle:
            lines.append("NOT YET PULLED: " + "; ".join(f"{e['id']} ({e['name']}) at {_p(e['pos'])}" for e in idle) + ".")
    pools = [f"{g['id']} ({g['kind']}) at {_p(g['pos'])} r={g['radius']:g} {'ARMED' if g['armed'] else 'arming'}"
             for g in obs["ground"]]
    lines.append("POOLS: " + ("; ".join(pools) if pools else "none") + ".")
    lines.append("PARTY:")
    names = {m.id: m.name for m in C.PARTY}
    for p in sorted(obs["party"], key=lambda p: p["id"] != me):
        you = " (YOU)" if p["id"] == me else ""
        if not p["alive"]:
            lines.append(f"  {p['id']}{you} ({p['class']}): DEAD.")
            continue
        line = (f"  {p['id']}{you} ({p['class']}) {p['hp_pct']:.0f}% HP ({p['hp']}/{p['max_hp']})"
                + (f" +{p['absorb']} shield" if p["absorb"] else "")
                + f" at {_p(p['pos'])}{' moving' if p['moving'] else ''}{_cast(p['casting'])}"
                + f"{_auras(p['auras'], p.get('stacks'))}")
        if p["id"] == me:
            cds = p.get("cooldowns", {})
            ready = [a for a, v in cds.items() if v == 0]
            waiting = [f"{a} {v / 1000:.1f}s" for a, v in cds.items() if v > 0]
            line += ((f", GCD {gcd_ms / 1000:.1f}s" if gcd_ms else "")
                     + f". Ready: {', '.join(ready) or 'nothing'}"
                     + (f". On cooldown: {', '.join(waiting)}" if waiting else ""))
        lines.append(line + "." + _danger(p, obs["ground"]))
    if chat:
        lines.append("PARTY CHAT (oldest first):")
        lines.extend(f"  [{t / 1000:.1f}s] {names.get(who, who)}: {text}" for t, who, text in chat[-CHAT_SHOWN:])
    if orders_age_s is not None:
        lines.append(f"Your current orders were given {orders_age_s:.1f}s ago.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Reply parsing
# ---------------------------------------------------------------------------

@dataclass
class Order:
    move_to: tuple[float, float] | str | None = None  # (x, z) or "safe"
    priority: list[tuple[str, str]] | None = field(default_factory=list)  # None: keep the current one
    say: str = ""


@dataclass
class Parsed:
    orders: dict[str, Order]
    problems: list[str]  # invalid entries we dropped (counted as a metric)
    ok: bool  # False when the reply was not usable JSON at all


def parse_reply(text: str, me: str, unit_ids: set[str], gone: set[str] = frozenset()) -> Parsed:
    """Read one agent's JSON orders for its own character. Invalid pieces are
    dropped and reported, never guessed. ``priority`` absent = keep the old
    one (``Order.priority`` is then None). Targets in ``gone`` (enemies that
    have died) are dropped quietly: an order still naming a dead enemy is
    harmless, not a mistake."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return Parsed({}, ["no JSON object in reply"], False)
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError as err:
        return Parsed({}, [f"invalid JSON: {err.msg}"], False)
    if not isinstance(data, dict):
        return Parsed({}, ["reply is not a JSON object"], False)
    if isinstance(data.get(me), dict):  # {"grokka": {...}}: unambiguous, accept it
        data = data[me]
    elif isinstance(data.get("orders"), dict):
        data = data["orders"].get(me, data["orders"]) if isinstance(data["orders"].get(me), dict) else data["orders"]
    if not any(k in data for k in ("move_to", "priority", "say")):
        return Parsed({}, ["reply has none of move_to, priority, say"], False)
    member = next(x for x in C.PARTY if x.id == me)
    problems: list[str] = []
    o = Order(say=str(data.get("say") or "").strip()[:CHAT_MAX_CHARS], priority=None)
    mv = data.get("move_to")
    if isinstance(mv, dict) and set(mv) >= {"x", "z"}:
        mv = [mv["x"], mv["z"]]  # {"x": .., "z": ..} is unambiguous; accept it
    if isinstance(mv, list) and len(mv) == 1 and isinstance(mv[0], str):
        mv = mv[0]  # ["safe"] means "safe"
    if isinstance(mv, str) and mv.strip().lower() in ("safe", "next"):
        o.move_to = mv.strip().lower()
    elif mv is not None:
        if isinstance(mv, (list, tuple)) and len(mv) == 2 and all(isinstance(v, (int, float)) for v in mv):
            o.move_to = (float(mv[0]), float(mv[1]))
        else:
            problems.append(f"bad move_to {mv!r}")
    if "priority" in data:
        o.priority = []
        allowed = C.CLASSES[member.cls].abilities
        raw = data.get("priority") or []
        for entry in raw if isinstance(raw, list) else [raw]:
            if not (isinstance(entry, (list, tuple)) and len(entry) == 2):
                problems.append(f"bad priority entry {entry!r}")
                continue
            ab, tgt = str(entry[0]), str(entry[1])
            if tgt in ("self", "party", "me", "all"):
                tgt = me
            if ab not in allowed:
                problems.append(f"cannot use {ab!r}")
                continue
            if tgt not in unit_ids:
                if tgt not in gone:
                    problems.append(f"unknown target {tgt!r}")
                continue
            o.priority.append((ab, tgt))
    return Parsed({me: o}, problems, True)
