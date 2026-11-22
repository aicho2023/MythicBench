"""What each agent sees and how its reply is read.

Five agents play, one per character, all the same model. Each agent's system
prompt states the *rules* (what every ability in the party does, the arena,
the reply format): the same information a player gets from tooltips. It gives
no strategy: who interrupts, when to move, what to prioritise, and how to
coordinate (party chat) is exactly what the benchmark measures.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field

from .. import content as C
from ..engine import dist

# Party chat lines shown in the state (the most recent), and the longest
# message: one short line, as typed mid-fight (it shows as a bubble overhead).
CHAT_SHOWN = 12
CHAT_MAX_CHARS = 120
# Typing takes time: one party-chat message per character every 10 s of game time.
CHAT_COOLDOWN_MS = 10_000

# Coordinates beyond this are nonsense (the map spans about -20..95 m); a
# non-finite or huge number is dropped, never passed to the engine.
COORD_LIMIT = 200.0
PARTY_IDS = frozenset(m.id for m in C.PARTY)

# Same hit test the engine uses for pools (centre within radius + half a body).
POOL_HIT_PAD = C.PLAYER_RADIUS * 0.5

def clean_text(text: str) -> str:
    """Model text made safe to put in another prompt: valid Unicode only (a
    lone surrogate, which a reply's JSON can spell as \\ud800, becomes U+FFFD).
    Applied the same way live and when replaying a recording."""
    return text.encode("utf-8", "surrogatepass").decode("utf-8", "replace")


def fit_chat(text: str) -> str:
    """A chat message cut to CHAT_MAX_CHARS: at the last whole sentence that
    fits, else the last whole word (never mid-word)."""
    text = " ".join(clean_text(text).split())
    if len(text) <= CHAT_MAX_CHARS:
        return text
    cut = text[:CHAT_MAX_CHARS + 1]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if end >= CHAT_MAX_CHARS // 2:
        return cut[:end + 1]
    space = cut.rfind(" ")
    return cut[:space].rstrip(",;:-– ") if space > 0 else text[:CHAT_MAX_CHARS]


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
        return f"""## Oruth the Unburied ({b.max_hp:,} HP)
  - You have never fought him. His abilities, their timing, and what they do are unknown: learn them from what you see (his casts by name with a cast bar, the damage your party takes, anything that appears on the ground, any new enemies).
  - Oruth attacks whoever he is targeting (normally the tank)."""
    boss = [_ability_line(a).replace("    - ", "  - ") for a in
            ("hollow_strike", "soul_rend", "requiem_of_bones", "desecrate", "bone_pyre", "raise_dead", "hollow_fury")]
    return f"""## Oruth the Unburied ({b.max_hp:,} HP)
{chr(10).join(boss)}
  - Desecrate pools have radius {b.desecrate_radius:g} m, become dangerous {b.desecrate_arm_ms / 1000:g}s after appearing, hit for {C.ABILITIES['desecrate'].amount} every {b.desecrate_tick_ms / 1000:g}s while you stand in them, and last {b.desecrate_duration_ms / 1000:g}s.
  - Summon the Restless is cast at {', '.join(f'{int(x * 100)}%' for x in b.raise_dead_at)} boss health. Risen Bonewalkers ({C.ADD.max_hp} HP) run at the healer.
  - Oruth attacks whoever he is targeting (normally the tank).
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


_THRONE = next(o for o in C.OBSTACLES if o.id == "throne")
_PILLAR_R = next(o.radius for o in C.OBSTACLES if o.half is None)


def _dungeon_section(knowledge: str, tier: str = C.DEFAULT_TIER) -> str:
    """The run before the boss: map, packs, pulling, resting, the timer."""
    blind = knowledge == "blind"
    rooms = "\n".join(f"  - {r.name} ({r.id}): circle centred ({r.center[0]:g}, {r.center[1]:g}), radius {r.radius:g} m"
                       for r in C.ROOMS)
    cors = "; ".join(f"|x| <= {c.x_half:g} for z {c.z_min:g}..{c.z_max:g}" for c in C.CORRIDORS)
    pillars = ", ".join(f"({o.center[0]:g}, {o.center[1]:g})" for o in C.OBSTACLES if o.half is None)
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
This is a full Mythic+-style run, not just the boss: walk from the entrance, clear two packs of undead, then fight Oruth. One timer covers the whole run: {C.tier(tier).limit_ms / 1000:g} s.
Map (positions are (x, z); the entrance is at large z, Oruth's room at the origin):
{rooms}
  - Corridors join them: {cors}. You can only walk inside rooms and corridors.
  - Solid pillars (radius {_PILLAR_R:g} m; moves go around them): {pillars}.
Route, entrance to boss: {', '.join(f'({w[0]:g}, {w[1]:g})' for w in C.ROUTE)}.
Packs:
{chr(10).join(packs)}
Enemies:
{chr(10).join(kinds)}
Pulling: a pack attacks when anyone comes within {C.AGGRO_RADIUS:g} m of any of its members, or hits one. Oruth wakes when someone comes within {C.BOSS_ENGAGE_RADIUS:g} m of him; his abilities and timers only start then.
Between pulls (no enemy fighting you): the party regenerates {int(C.OOC_REGEN_PCT_PER_S * 100)}% health per second, and after {C.REVIVE_AFTER_MS / 1000:g} s out of combat fallen allies get back up at {int(C.REVIVE_HP_PCT * 100)}% health. Each revive adds {C.DEATH_PENALTY_MS / 1000:g} s to the timer. Resting costs time; pulling hurt costs lives.
The run ends when the timer runs out (revive penalties included); nothing after that counts. It is a clear when Oruth and every pack are dead within the timer.
Score for the run (0-100): a clear earns 70 plus up to 30 for speed (the full 30 with a quarter of the timer left; revive penalties count). Otherwise (a wipe, or the timer running out), up to 70 for progress (each pack is worth 15%, Oruth 70% by health removed)."""


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


NOTES_HEADER = "\n\n## Your notes from previous pulls"
ORDER_FORMAT_MARK = "\n\nReply with ONLY a JSON object, no prose:"


def notes_section(notes: str | None, pull: int | None) -> str:
    """Appended to the rules on later pulls: the agent's own notes, verbatim,
    marked off as notes (data it wrote, not rules of the game)."""
    if not notes:
        return ""
    return (f"{NOTES_HEADER} (this is pull {pull})\n"
            "You wrote these yourself after earlier attempts. They are your notes, not rules of the game.\n"
            f"<notes>\n{notes.strip()}\n</notes>")


def system_prompt(knowledge: str = "full", notes: str | None = None, pull: int | None = None,
                  tier: str = C.DEFAULT_TIER, mode: str = "boss", me: str = "rook") -> str:
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
        # The run's own timer (in the dungeon section) is the only limit stated:
        # the blind party isn't told anything about the boss's timing.
        intro = "" if knowledge == "blind" else intro + " (Oruth's clock starts when he is pulled.)"
    else:
        score_text = (f"A wipe earns up to 70 points in proportion to the boss's health removed. A kill earns 70 plus "
                      f"up to 30 for speed: the full 30 for killing with a quarter of the {limit} s timer (or more) left.")
    goal = ("clear the dungeon (both packs and the boss) within the timer, as fast as possible, without dying."
            if mode == "dungeon" else "kill the boss as fast as possible without dying.")
    next_move = (', or "next" walks to the next waypoint of the route toward the boss' if mode == "dungeon" else "")
    example = next(a for a in mine.abilities if C.ABILITIES[a].kind not in ("interrupt", "taunt", "buff"))
    tgt = "oruth" if C.ABILITIES[example].kind in ("damage", "aoe_damage") else me
    return f"""You play {member.name} ({me}), the {mine.name} ({mine.role}), in a party of five adventurers fighting through a dungeon in a turn-based simulation of a real-time fight. Each of the other four characters is played by another player; you control only {member.name}. The party's goal: {goal}{(" " + intro) if intro else ""}

## Score (0-100, shared by the whole party)
{score_text}

{_tier_section(tier)}

## Arena
Circular, radius {C.ARENA_RADIUS:g} m, centred on (0, 0). Positions are (x, z) in metres. Oruth starts on his dais at ({C.BOSS_POS[0]:g}, {C.BOSS_POS[1]:g}), with a body radius of {b.radius:g} m. His throne stands behind it against the back wall: solid, a box from x {-_THRONE.half[0]:g} to {_THRONE.half[0]:g} and z {_THRONE.center[1] - _THRONE.half[1]:g} to {_THRONE.center[1] + _THRONE.half[1]:g}. Nobody walks through solid things; a move goes around them on its own. Once pulled, he takes {b.rise_ms / 1000:g} s to rise from his dais; after that he walks after whoever he is attacking ({b.speed:g} m/s) whenever they're out of his melee reach, but never leaves this room. Characters move at 5 m/s, have a body radius of {C.PLAYER_RADIUS:g} m, and can't stand inside one another. Moving cancels a cast in progress, and spells with a cast time cannot be started while moving. Melee range is {C.MELEE_RANGE:g} m from the target's edge (interrupts {C.KICK_RANGE:g} m). While you're in melee reach of the enemy your first melee ability targets, you follow it if it drifts away (up to {C.FOLLOW_M:g} m), unless that step would take you into or through a pool; a move you order ends this until you're back in reach. Global cooldown (GCD): {C.GCD_MS / 1000:g}s after most abilities.

## The party
{chr(10).join(party)}

{_boss_section(knowledge)}
{(chr(10) + _dungeon_section(knowledge, tier) + chr(10)) if mode == "dungeon" else ""}
## How you play
You are asked for {member.name}'s orders every 4 seconds of game time, and immediately when something that concerns you happens. The game is paused while everyone thinks; the other players are asked at the same moments you are. {member.name} keeps following your latest orders until you change them:
  - "move_to": [x, z] walks there once, in a straight line (a move that would cross a wall stops at the wall). "safe" steps to the nearest spot clear of the ground effects known to hurt, keeping the target of your first attack or heal in range when possible and avoiding paths through other pools (when no clean route exists it takes the nearest clear spot anyway){next_move}. "stop" stops where you are. Omit it or send null for no new move (a move under way carries on). A move is carried out each time you send it.
  - "priority": an ordered list of [ability_id, target_id]. Every tick, {member.name} uses the FIRST entry that is ready (off cooldown, in range, GCD free, not casting or moving for cast-time spells). Off-GCD abilities in the list fire even during the GCD. Interrupts only fire while their target is casting something interruptible (reacting {reaction} s after the cast starts), so they can stay in the list; if someone else interrupts first, yours sees nothing to stop and stays ready. Put a reliable filler ability last so you never idle. Leave "priority" out to keep your current one.
  - "say": one short line in party chat (at most {CHAT_MAX_CHARS} characters; anything longer is cut off), which every player sees from then on. Typing takes time: you can send one message every {CHAT_COOLDOWN_MS // 1000} s, and one sent sooner isn't delivered. Leave it out to say nothing.
Ground effects ("pools") appear in the state with their kind and size. The kinds known to hurt anyone standing in them are "desecrate" and "grave" (the Restless Graves affix): "safe" steps out of those, and doesn't treat any other kind as dangerous.
Targets are unit ids from the state (e.g. "oruth", "bonewalker_1", "ivy"). For self-buffs and party-wide abilities use your own id ("self" and "party" also work).
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
    inside, near, circles = [], [], []
    for g in ground:
        d = dist(p["pos"], g["pos"])
        if "detonates_in_ms" in g:  # not a pool that hurts to stand in: just say where you are
            if d <= g["radius"] + POOL_HIT_PAD:
                circles.append(f"{g['id']} ({d:.1f} m from its centre)")
            continue
        state = "ARMED" if g["armed"] else "arming"
        if d <= g["radius"] + POOL_HIT_PAD:
            inside.append(f"{g['id']} ({state}, {d:.1f} m from its centre, radius {g['radius']:g})")
        elif d <= g["radius"] + 1.0:
            near.append(g["id"])
    out = ""
    if circles:
        out += f" Inside {', '.join(circles)}."
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
                 chat: list[tuple[int, str, str]] | None = None, chat_ready_in_ms: int = 0) -> str:
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
            lines.append("BOSS oruth is asleep on his dais at (0.0, -2.0); he wakes when someone comes within "
                         f"{C.BOSS_ENGAGE_RADIUS:g} m.")
    else:
        lines = [f"Time {obs['t'] / 1000:.1f}s ({'time limit' if blind else 'enrage at'} {limit})."]
    boss = next((e for e in obs["enemies"] if e["role"] == "boss"), None)
    if boss and dg and not dg["boss_engaged"]:
        boss = None  # described above as asleep
    if boss:
        lines.append(f"BOSS oruth {boss['hp_pct']:.1f}% HP at {_p(boss['pos'])}, attacking {boss['target']}"
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
    pools = [f"{g['id']} ({g['kind']}) at {_p(g['pos'])} r={g['radius']:g} "
             + (f"goes off in {g['detonates_in_ms'] / 1000:.1f}s" if "detonates_in_ms" in g
                else 'ARMED' if g['armed'] else 'arming')
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
    if chat_ready_in_ms > 0:
        lines.append(f"You can type in party chat again in {chat_ready_in_ms / 1000:.1f}s.")
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


ORDER_KEYS = ("move_to", "priority", "say")


# Numbers in a reply are bounded before Python converts them: an integer with
# hundreds of digits would overflow a float, and thousands would trip the
# decoder's own limit. Either way it's an invalid value, never a crash.
MAX_NUMBER_CHARS = 32


def _bounded_int(s: str) -> float | int:
    return int(s) if len(s) <= MAX_NUMBER_CHARS else math.inf


def _bounded_float(s: str) -> float:
    return float(s) if len(s) <= MAX_NUMBER_CHARS else math.inf


_DECODER = json.JSONDecoder(parse_int=_bounded_int, parse_float=_bounded_float)


def json_objects(text: str) -> list[dict]:
    """Every complete JSON object in a reply, in order. A model that thinks out
    loud before answering (braces in its prose and all) still gets its final,
    well-formed answer read; nothing malformed is ever repaired or guessed, and
    nothing in a reply (huge numbers, deep nesting) can crash the reader."""
    out, i = [], text.find("{")
    while i != -1:
        try:
            obj, end = _DECODER.raw_decode(text, i)
        except (ValueError, RecursionError):  # malformed, or nested too deep
            i = text.find("{", i + 1)
            continue
        if isinstance(obj, dict):
            out.append(obj)
        i = text.find("{", end)
    return out


def _orders_in(data: dict, me: str) -> dict | None:
    if isinstance(data.get(me), dict):  # {"brask": {...}}: unambiguous, accept it
        return data[me]
    if isinstance(data.get("orders"), dict):
        o = data["orders"]
        return o[me] if isinstance(o.get(me), dict) else o
    return data


def parse_reply(text: str, me: str, unit_ids: set[str], gone: set[str] = frozenset()) -> Parsed:
    """Read one agent's JSON orders for its own character. Invalid pieces are
    dropped and reported, never guessed. ``priority`` absent = keep the old
    one (``Order.priority`` is then None). Targets in ``gone`` (enemies that
    have died) are dropped quietly: an order still naming a dead enemy is
    harmless, not a mistake."""
    objs = json_objects(text)
    if not objs:
        return Parsed({}, ["no complete JSON object in reply"], False)
    # The answer is the last object that is either orders or an empty {} ("no
    # change": every field left out keeps its value, as the rules say). Drafts
    # before it don't count, and neither do objects of some other shape. A
    # reply cut off at the token limit is read the same way: any complete
    # object in it counts.
    data = None
    for o in objs:
        d = _orders_in(o, me)
        if d == {} or any(k in d for k in ORDER_KEYS):
            data = d
    if data is None:
        return Parsed({}, ["reply has none of move_to, priority, say"], False)
    member = next(x for x in C.PARTY if x.id == me)
    problems: list[str] = []
    o = Order(say=fit_chat(str(data.get("say") or "")), priority=None)
    mv = data.get("move_to")
    if isinstance(mv, dict) and set(mv) >= {"x", "z"}:
        mv = [mv["x"], mv["z"]]  # {"x": .., "z": ..} is unambiguous; accept it
    if isinstance(mv, list) and len(mv) == 1 and isinstance(mv[0], str):
        mv = mv[0]  # ["safe"] means "safe"
    if isinstance(mv, str) and mv.strip().lower() in ("safe", "next", "stop"):
        o.move_to = mv.strip().lower()
    elif mv is not None:
        if (isinstance(mv, (list, tuple)) and len(mv) == 2
                and all(isinstance(v, (int, float)) and not isinstance(v, bool)
                        and abs(v) <= COORD_LIMIT and math.isfinite(v) for v in mv)):
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
            kind = C.ABILITIES[ab].kind
            ally = tgt in PARTY_IDS
            if (kind in ("damage", "interrupt") and ally) or (kind in ("heal", "hot", "absorb") and not ally):
                problems.append(f"{ab!r} can't target {tgt!r} (attacks go on enemies, heals on allies)")
                continue
            o.priority.append((ab, tgt))
    return Parsed({me: o}, problems, True)
