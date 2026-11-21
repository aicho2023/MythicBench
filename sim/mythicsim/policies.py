"""Scripted bot policies.

These play the same role an LLM will play in Phase 2: they receive an
observation dict (see ``Encounter.observe``) and return a list of
``Action``s. They never touch engine internals.

A single ``ScriptedPolicy`` class is parameterised by a ``Skill`` profile.
That gives us a clean experiment: the *only* difference between the
"expert" and "sloppy" replays is these few knobs, so any difference in
outcome is attributable to decision quality.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from . import content as C
from .engine import Action, dist


@dataclass(frozen=True)
class Skill:
    name: str
    reaction_ms: int  # how long before noticing a new ground effect / boss cast
    interrupt_attention: float  # chance the assigned kicker actually kicks a given cast
    dodge_attention: float  # chance of noticing a given pool at all (else stand in it)
    swaps_to_adds: bool  # do DPS switch to the adds, or tunnel the boss?
    taunt_delay_ms: int  # how long the tank takes to grab adds
    uses_defensives: bool
    apm: float  # chance of pressing a button on any free GCD (1.0 = never idle)
    lust_on_pull: bool  # use Wild Roar at the start (best) or hold it until the boss is low


# Three reference skill levels. A benchmark that can't rank these three in the
# right order, with clear gaps, can't be trusted to rank models either.
EXPERT = Skill("expert", reaction_ms=350, interrupt_attention=1.0, dodge_attention=1.0,
               swaps_to_adds=True, taunt_delay_ms=3000, uses_defensives=True, apm=1.0,
               lust_on_pull=True)
COMPETENT = Skill("competent", reaction_ms=800, interrupt_attention=0.85, dodge_attention=0.85,
                  swaps_to_adds=True, taunt_delay_ms=3000, uses_defensives=True, apm=0.95,
                  lust_on_pull=True)
SLOPPY = Skill("sloppy", reaction_ms=1700, interrupt_attention=0.55, dodge_attention=0.6,
               swaps_to_adds=False, taunt_delay_ms=9000, uses_defensives=False, apm=0.85,
               lust_on_pull=False)
PROFILES = {"expert": EXPERT, "competent": COMPETENT, "sloppy": SLOPPY}


# 16 compass directions as exact constants (cos and sin of k * 22.5 degrees).
# Hard-coded rather than computed at runtime: libm trig results can differ in
# the last bit between CPU platforms, which would make replays machine-dependent.
_C1, _C2, _C3 = 0.9238795325112867, 0.7071067811865476, 0.3826834323650898
_DIRS = ((1.0, 0.0), (_C1, _C3), (_C2, _C2), (_C3, _C1), (0.0, 1.0), (-_C3, _C1), (-_C2, _C2), (-_C1, _C3),
         (-1.0, 0.0), (-_C1, -_C3), (-_C2, -_C2), (-_C3, -_C1), (0.0, -1.0), (_C3, -_C1), (_C2, -_C2), (_C1, -_C3))


def unsafe(pos, ground: list[dict], margin: float = 0.6) -> bool:
    return any(dist(pos, g["pos"]) <= g["radius"] + margin for g in ground)


def crosses_pool(a: tuple, b: tuple, ground: list[dict], margin: float = 0.3) -> bool:
    """Does walking straight from a to b pass through an armed pool? (sampled every ~0.25 m)"""
    steps = max(1, int(dist(a, b) / 0.25))
    for i in range(1, steps + 1):
        f = i / steps
        p = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        if any(g.get("armed", True) and dist(p, g["pos"]) <= g["radius"] + margin for g in ground):
            return True
    return False


def find_safe_spot(ground: list[dict], arena_radius: float, near: tuple, anchor: tuple,
                   reach=None, avoid_paths: bool = False) -> tuple | None:
    """Nearest spot clear of pools (the dodge planner shared by bots and LLM agents).

    ``reach`` = (target_pos, target_radius, range): only consider spots from
    which that target is still in range (e.g. a melee character stays in melee).
    ``avoid_paths``: also reject spots whose straight path from ``near`` crosses
    another armed pool (the pool being escaped from is ignored).
    """
    escaping = [g for g in ground if dist(near, g["pos"]) <= g["radius"] + 0.6]
    others = [g for g in ground if g not in escaping]
    best, best_score = None, math.inf
    lim = arena_radius - 1.5
    for ring in (1.5, 2.5, 3.5, 4.5, 6.0, 8.0):
        for cx, cz in _DIRS:
            cand = (near[0] + ring * cx, near[1] + ring * cz)
            if dist(cand, (0.0, 0.0)) > lim or unsafe(cand, ground, 0.9):
                continue
            if reach and dist(cand, reach[0]) - 0.45 - reach[1] > reach[2]:
                continue
            if avoid_paths and crosses_pool(near, cand, others):
                continue
            # Shortest escape, near where we want to be; among equally good
            # spots, prefer the middle of the room (stay with the group,
            # never get pinned against the wall). Without this tie-break the
            # choice between equal spots fell to floating-point noise.
            score = dist(cand, near) + 0.5 * dist(cand, anchor) + 0.05 * dist(cand, (0.0, 0.0))
            if score < best_score:
                best, best_score = cand, score
    return best


def _by_id(obs: dict) -> dict:
    return {u["id"]: u for u in obs["party"] + obs["enemies"]}


class ScriptedPolicy:
    def __init__(self, unit_id: str, skill: Skill, seed: int):
        self.uid = unit_id
        self.skill = skill
        self.name = f"scripted-{skill.name}"
        # Each bot gets its own RNG so one bot's choices never shift another's.
        self.rng = random.Random(f"{seed}:{unit_id}:{skill.name}")
        member = next(m for m in C.PARTY if m.id == unit_id)
        self.home = member.home
        self.cls = member.cls
        self.attention: dict[str, bool] = {}  # memoised dice rolls per event id
        self.first_seen: dict[str, int] = {}
        self.dodge_to: tuple | None = None

    # ------------------------------------------------------------------
    def roll(self, key: str, p: float) -> bool:
        if key not in self.attention:
            self.attention[key] = self.rng.random() < p
        return self.attention[key]

    def act(self, obs: dict) -> list[Action]:
        me = obs["self"]
        if not me["alive"]:
            return []
        out: list[Action] = []
        # Off-GCD reactions first (interrupts, defensives)
        kick = self.maybe_interrupt(obs)
        if kick:
            out.append(kick)
        move = self.movement(obs)
        if move:
            out.append(move)
            # Moving cancels casts, so only instants make sense this tick
        if me["casting"] or me["gcd_ms"] > 0:
            return out
        if not self.roll(f"apm:{obs['t'] // 1000}", self.skill.apm):
            return out
        role_action = getattr(self, f"rotation_{self.cls}")(obs, moving=bool(move) or me["moving"])
        if role_action:
            out.append(role_action)
        return out

    # ------------------------------------------------------------------
    # Interrupts: follow the agreed kick order.
    # ------------------------------------------------------------------
    def maybe_interrupt(self, obs: dict) -> Action | None:
        me = obs["self"]
        kick_id = C.CLASSES[self.cls].interrupt
        if not kick_id:
            return None
        for enemy in obs["enemies"]:
            cast = enemy["casting"]
            if not cast or not cast["interruptible"]:
                continue
            if cast["elapsed_ms"] < self.skill.reaction_ms:
                continue
            cast_key = f"{enemy['id']}:{obs['t'] - cast['elapsed_ms']}"
            # Who is responsible? First person in the kick order who is alive,
            # has their interrupt ready, and is in range.
            party = {p["id"]: p for p in obs["party"]}
            responsible = None
            for pid in C.KICK_ORDER:
                p = party.get(pid)
                if not p or not p["alive"]:
                    continue
                pk = C.CLASSES[p["class"]].interrupt
                if p["cooldowns"].get(pk, 1) == 0 and \
                        self.in_range(p, enemy, C.ABILITIES[pk].range - 0.2):
                    responsible = pid
                    break
            if responsible != self.uid:
                continue
            if me["cooldowns"].get(kick_id, 1) > 0:
                continue
            if not self.roll(f"kick:{cast_key}", self.skill.interrupt_attention):
                continue  # distracted: nobody else covers, because it was "my turn"
            return Action("cast", kick_id, enemy["id"],
                          reason=f"Interrupting {cast['name']} — my turn in the kick rotation.")
        return None

    # ------------------------------------------------------------------
    # Movement: dodge pools, otherwise hold position.
    # ------------------------------------------------------------------
    def unsafe(self, pos, obs, margin: float = 0.6) -> bool:
        return unsafe(pos, obs["ground"], margin)

    def noticed_pools(self, obs: dict) -> list[dict]:
        out = []
        for g in obs["ground"]:
            attentive = self.roll(f"dodge:{g['id']}", self.skill.dodge_attention)
            # Inattentive players still notice eventually ("oh no, I'm standing in it!")
            delay = self.skill.reaction_ms if attentive else self.skill.reaction_ms * 2.5
            if g["age_ms"] >= delay:
                out.append(g)
        return out

    def safe_spot(self, obs: dict, near: tuple, anchor: tuple) -> tuple | None:
        return find_safe_spot(obs["ground"], obs["arena_radius"], near, anchor)

    def movement(self, obs: dict) -> Action | None:
        me = obs["self"]
        pos = tuple(me["pos"])
        seen = {"ground": self.noticed_pools(obs), "arena_radius": obs["arena_radius"]}
        standing_in = self.unsafe(pos, seen, 0.3)
        anchor = self.desired_spot(obs)
        # Commit to an escape route once chosen (re-planning every tick = jitter).
        if self.dodge_to is not None:
            if me["moving"] and not self.unsafe(self.dodge_to, seen, 0.9):
                return None
            self.dodge_to = None
        if standing_in:
            spot = self.safe_spot(seen, pos, anchor)
            if spot:
                self.dodge_to = spot
                return Action("move", to=spot, reason="Desecrate under me — moving out!")
            return None
        if me["moving"]:
            return None
        if dist(pos, anchor) > 0.6 and not self.unsafe(anchor, seen, 0.9):
            return Action("move", to=anchor)
        return None

    def desired_spot(self, obs: dict) -> tuple:
        """Where this bot wants to stand right now (home, or next to its target)."""
        me = obs["self"]
        if self.cls in ("berserker", "shadowblade"):
            tgt = self.pick_target(obs)
            if tgt and tgt["role"] == "add":
                # step next to the add
                tp = tuple(tgt["pos"])
                d = dist(me["pos"], tp)
                if d > 2.2:
                    f = (d - 1.6) / d
                    return (me["pos"][0] + (tp[0] - me["pos"][0]) * f,
                            me["pos"][1] + (tp[1] - me["pos"][1]) * f)
                return tuple(me["pos"])
        return self.home

    # ------------------------------------------------------------------
    # Targeting
    # ------------------------------------------------------------------
    def pick_target(self, obs: dict) -> dict | None:
        enemies = [e for e in obs["enemies"] if e["alive"]]
        if not enemies:
            return None
        adds = [e for e in enemies if e["role"] == "add"]
        if adds and self.skill.swaps_to_adds and self.uid != "bramble":
            return min(adds, key=lambda e: (e["hp"], e["id"]))
        boss = next((e for e in enemies if e["role"] == "boss"), None)
        return boss or enemies[0]

    def in_range(self, me: dict, tgt: dict, rng: float) -> bool:
        radius = C.BOSS.radius if tgt["role"] == "boss" else C.ADD.radius
        return dist(me["pos"], tgt["pos"]) - radius - 0.45 <= rng

    # ------------------------------------------------------------------
    # Class rotations (one action per free GCD)
    # ------------------------------------------------------------------
    def ready(self, obs: dict, ability: str) -> bool:
        return obs["self"]["cooldowns"].get(ability, 1) == 0

    def rotation_guardian(self, obs: dict, moving: bool) -> Action | None:
        me = obs["self"]
        boss = next((e for e in obs["enemies"] if e["role"] == "boss"), None)
        # Defensive before the tank buster lands
        if self.skill.uses_defensives and boss and boss["casting"] and \
                boss["casting"]["ability"] == "soul_rend" and self.ready(obs, "ironhide") and \
                "ironhide" not in me["auras"]:
            return Action("cast", "ironhide", me["id"],
                          reason="Soul Rend incoming — popping Ironhide.")
        loose = [e for e in obs["enemies"] if e["role"] == "add" and e["target"] != me["id"]]
        if loose and self.ready(obs, "challenging_roar"):
            first_seen = self.first_seen.setdefault(f"adds:{loose[0]['id']}", obs["t"])
            if obs["t"] - first_seen >= self.skill.taunt_delay_ms:
                return Action("cast", "challenging_roar", loose[0]["id"],
                              reason="Bonewalkers are loose — grabbing them with Challenging Roar.")
        if not boss or not self.in_range(me, boss, C.MELEE_RANGE):
            return None
        if self.ready(obs, "bulwark_slam"):
            return Action("cast", "bulwark_slam", boss["id"])
        return Action("cast", "rampart_strike", boss["id"])

    def rotation_lightweaver(self, obs: dict, moving: bool) -> Action | None:
        me = obs["self"]
        party = [p for p in obs["party"] if p["alive"]]
        if not party:
            return None
        tank = next((p for p in party if p["role"] == "tank"), None)
        boss = next((e for e in obs["enemies"] if e["role"] == "boss"), None)
        avg = sum(p["hp_pct"] for p in party) / len(party)
        lowest = min(party, key=lambda p: (p["hp_pct"], p["id"]))
        if not moving and avg < 62 and self.ready(obs, "radiant_hymn"):
            return Action("cast", "radiant_hymn", me["id"],
                          reason=f"Party averaging {avg:.0f}% health — channeling Radiant Hymn.")
        if tank and boss and boss["casting"] and boss["casting"]["ability"] == "soul_rend" and \
                self.ready(obs, "lumen_ward") and tank["absorb"] == 0:
            return Action("cast", "lumen_ward", tank["id"],
                          reason="Pre-shielding the tank before Soul Rend.")
        if lowest["hp_pct"] < 55 and self.ready(obs, "lumen_ward") and lowest["absorb"] == 0:
            return Action("cast", "lumen_ward", lowest["id"],
                          reason=f"{lowest['name']} is at {lowest['hp_pct']:.0f}% — emergency shield.")
        if lowest["hp_pct"] < 70 and not moving:
            return Action("cast", "mending_light", lowest["id"])
        if tank and "bloomward" not in tank["auras"]:
            return Action("cast", "bloomward", tank["id"])
        for p in sorted(party, key=lambda p: p["hp_pct"]):
            if p["hp_pct"] < 85 and "bloomward" not in p["auras"]:
                return Action("cast", "bloomward", p["id"])
        if lowest["hp_pct"] < 88 and not moving:
            return Action("cast", "mending_light", lowest["id"])
        if boss and not moving:
            return Action("cast", "sunspark", boss["id"])
        return None

    def rotation_berserker(self, obs: dict, moving: bool) -> Action | None:
        me = obs["self"]
        tgt = self.pick_target(obs)
        if not tgt:
            return None
        adds_near = [e for e in obs["enemies"] if e["role"] == "add" and
                     dist(me["pos"], e["pos"]) <= 7.5]
        if len(adds_near) >= 2 and self.ready(obs, "cleaving_storm"):
            return Action("cast", "cleaving_storm", tgt["id"])
        if not self.in_range(me, tgt, C.MELEE_RANGE):
            return None
        if self.ready(obs, "ravage"):
            return Action("cast", "ravage", tgt["id"])
        return Action("cast", "savage_hew", tgt["id"])

    def rotation_shadowblade(self, obs: dict, moving: bool) -> Action | None:
        me = obs["self"]
        tgt = self.pick_target(obs)
        if not tgt:
            return None
        adds_near = [e for e in obs["enemies"] if e["role"] == "add" and
                     dist(me["pos"], e["pos"]) <= 7.5]
        if len(adds_near) >= 2 and self.ready(obs, "fan_of_blades"):
            return Action("cast", "fan_of_blades", tgt["id"])
        if not self.in_range(me, tgt, C.MELEE_RANGE):
            return None
        if self.ready(obs, "venom_burst"):
            return Action("cast", "venom_burst", tgt["id"])
        return Action("cast", "twin_fang", tgt["id"])

    def rotation_ranger(self, obs: dict, moving: bool) -> Action | None:
        me = obs["self"]
        tgt = self.pick_target(obs)
        if not tgt:
            return None
        boss = next((e for e in obs["enemies"] if e["role"] == "boss"), None)
        if self.ready(obs, "wild_roar"):
            want = obs["t"] > 1500 if self.skill.lust_on_pull else \
                (boss is not None and boss["hp_pct"] < 50)
            if want:
                return Action("cast", "wild_roar", me["id"],
                              reason="Popping Wild Roar for the whole party.")
        if moving:
            return None
        if self.ready(obs, "piercing_shot"):
            return Action("cast", "piercing_shot", tgt["id"])
        return Action("cast", "steady_arrow", tgt["id"])


def make_policies(profile: str, seed: int) -> dict[str, ScriptedPolicy]:
    skill = PROFILES[profile]
    return {m.id: ScriptedPolicy(m.id, skill, seed) for m in C.PARTY}
