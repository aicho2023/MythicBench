"""Deterministic, tick-based combat simulator.

Design rules (these are what make the benchmark trustworthy):

1. **Determinism.** All randomness flows from one seeded ``random.Random``.
   Same seed + same policies => byte-identical event log. Tests enforce this.
2. **The event log is the only output.** Everything a viewer shows and every
   metric we score is derived from the log. Nothing hidden.
3. **Policies only see observations.** A policy (scripted bot today, LLM
   tomorrow) receives a plain JSON-able dict and returns plain actions. It
   cannot reach into engine internals, so bots and LLMs are judged by the
   same rules.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Callable, Protocol

from . import content as C

TICK_MS = 100
SIM_VERSION = "0.7.0"  # 0.3.0: bodies collide where they stop; 0.4.0: a run ends at its timer;
# 0.5.0: enemies keep their space too, and the boss walks after his target;
# 0.6.0: Bone Pyre, a soak; 0.7.0: a due boss mechanic waits until it can happen (never skipped)


# ---------------------------------------------------------------------------
# Small geometry helpers
# ---------------------------------------------------------------------------

Vec = tuple[float, float]


def r2(v: float) -> float:
    return round(v, 2)


def dist(a: Vec, b: Vec) -> float:
    # Not hypot(): its last bit can differ between CPU platforms, and one
    # flipped comparison changes a whole replay. +, *, and sqrt are exactly
    # rounded by IEEE 754 everywhere, so this is identical on every machine.
    dx, dy = a[0] - b[0], a[1] - b[1]
    return math.sqrt(dx * dx + dy * dy)


def lerp(a: Vec, b: Vec, f: float) -> Vec:
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)


# Bodies take up space: no unit ends a move inside another. Units
# may pass through each other while walking (as in WoW), but where they stop,
# their bodies keep at least BODY_GAP between them. A destination that's taken
# shifts to the nearest free spot on rings around it. Literal unit vectors, not
# cos/sin, so every machine gets the same answer.
# 16 compass directions as exact constants (cos and sin of k * 22.5 degrees).
# Hard-coded rather than computed at runtime: libm trig results can differ in
# the last bit between CPU platforms, which would make replays machine-dependent.
_C1, _C2, _C3 = 0.9238795325112867, 0.7071067811865476, 0.3826834323650898
COMPASS16 = ((1.0, 0.0), (_C1, _C3), (_C2, _C2), (_C3, _C1), (0.0, 1.0), (-_C3, _C1), (-_C2, _C2), (-_C1, _C3),
         (-1.0, 0.0), (-_C1, -_C3), (-_C2, -_C2), (-_C3, -_C1), (0.0, -1.0), (_C3, -_C1), (_C2, -_C2), (_C1, -_C3))


BODY_GAP = 0.2
# Enemies swing when their target is this close, edge to edge (m).
ENEMY_REACH = 1.2
SPOT_RINGS = (0.5, 1.0, 1.5, 2.0, 2.5, 3.0)
SPOT_DIRS = ((1.0, 0.0), (0.7071067811865476, 0.7071067811865476), (0.0, 1.0),
             (-0.7071067811865476, 0.7071067811865476), (-1.0, 0.0),
             (-0.7071067811865476, -0.7071067811865476), (0.0, -1.0),
             (0.7071067811865476, -0.7071067811865476))


# ---------------------------------------------------------------------------
# Runtime state
# ---------------------------------------------------------------------------

@dataclass
class Move:
    frm: Vec
    to: Vec
    t0: int
    dur: int

    def pos_at(self, t: int) -> Vec:
        # The viewer uses this exact formula, so positions match perfectly.
        if self.dur <= 0:
            return self.to
        f = min(1.0, max(0.0, (t - self.t0) / self.dur))
        return lerp(self.frm, self.to, f)


@dataclass
class Cast:
    ability: str
    target: str | None
    t0: int
    cast_ms: int


@dataclass
class Aura:
    id: str
    source: str
    t0: int
    dur: int
    next_tick: int = 0
    stacks: int = 1


@dataclass
class Unit:
    id: str
    name: str
    kind: str  # player | boss | add
    cls: str
    role: str
    max_hp: int
    radius: float
    speed: float
    model: str
    pos: Vec
    hp: int = 0
    alive: bool = True
    move: Move | None = None
    cast: Cast | None = None
    gcd_until: int = 0
    swing_at: int = 0
    target: str | None = None
    absorb: int = 0
    cooldowns: dict[str, int] = field(default_factory=dict)
    auras: dict[str, Aura] = field(default_factory=dict)
    pack: str | None = None  # dungeon trash: which pack this enemy belongs to
    asked_to: Vec | None = None  # last destination asked for, before free_spot moved it
    engaged: bool = True  # dungeon trash/boss: has it been pulled yet?

    def __post_init__(self) -> None:
        if self.hp == 0:
            self.hp = self.max_hp

    @property
    def haste(self) -> float:
        return 1.3 if "wild_roar" in self.auras else 1.0


# ---------------------------------------------------------------------------
# Actions a policy may return
# ---------------------------------------------------------------------------

@dataclass
class Action:
    type: str  # "cast" | "move"
    ability: str | None = None
    target: str | None = None
    to: Vec | None = None
    reason: str | None = None  # optional; logged as a ``decision`` event


class Policy(Protocol):
    name: str

    def act(self, obs: dict) -> list[Action]: ...


# ---------------------------------------------------------------------------
# The encounter
# ---------------------------------------------------------------------------

class Encounter:
    def __init__(self, seed: int, policies: dict[str, Policy], policy_label: str,
                 tier: str = C.DEFAULT_TIER):
        self.seed = seed
        # Difficulty: enemy health/damage multipliers plus the tier's affixes.
        self.tier = C.tier(tier)
        self.affixes = frozenset(self.tier.affixes)
        self.rng = random.Random(seed)
        self.policies = policies
        self.policy_label = policy_label
        self.t = 0
        self.events: list[dict] = []
        self.units: dict[str, Unit] = {}
        self.ground: dict[str, dict] = {}
        self.pending: list[tuple[int, int, Callable[[], None]]] = []
        self._seq = 0
        self.outcome: str | None = None
        # The boss's script for this seed. Each timed ability draws its timings
        # from its own seeded stream, so every policy that plays this seed faces
        # the same sequence of timers, whatever the party does.
        self.timer_rng = {k: random.Random(f"{seed}:timer:{k}") for k in C.BOSS.timers}
        self.pyre_rng = random.Random(f"{seed}:pyre")  # where each Bone Pyre lands, its own stream
        self.boss_next = {k: self.jitter(k, v[0], C.BOSS.first_jitter_ms)
                          for k, v in C.BOSS.timers.items()}
        if "hollow_tyrant" in self.tier.affixes:
            self.timer_rng["grave_mark"] = random.Random(f"{seed}:timer:grave_mark")
            self.boss_next["grave_mark"] = self.jitter("grave_mark", C.GRAVE_MARK_FIRST_MS, C.BOSS.first_jitter_ms)
        self.tyrant = "hollow_tyrant" in self.affixes
        self.raise_dead_left = list(C.TYRANT_RAISE_AT if self.tyrant else C.BOSS.raise_dead_at)
        self.raise_queued = False
        self.add_count = 0
        self.ground_count = 0
        self.enraged = False
        self.fury_pulses = 0
        self.next_fury_pulse = 0

        for m in C.PARTY:
            cd = C.CLASSES[m.cls]
            self.units[m.id] = Unit(m.id, m.name, "player", cd.id, cd.role, cd.max_hp,
                                    cd.radius, cd.speed, cd.model, m.home, target=C.BOSS.id)
        b = C.BOSS
        boss_hp = self.scaled_hp(b.max_hp)
        if self.tyrant:
            boss_hp = int(round(boss_hp * C.TYRANT_HP))
        self.units[b.id] = Unit(b.id, b.name, "boss", "boss", "boss", boss_hp, b.radius, b.speed,
                                b.model, C.BOSS_POS, target=C.PARTY[0].id)
        self.boss = self.units[b.id]
        self.boss_engaged_t = 0  # when Oruth was pulled (the dungeon run pulls him later)

    def jitter(self, key: str, base: float, spread: float) -> int:
        """``base`` +/- ``spread`` ms from this ability's stream, snapped to a tick."""
        ms = base + self.timer_rng[key].uniform(-spread, spread)
        return max(TICK_MS, int(round(ms / TICK_MS)) * TICK_MS)

    def scaled_hp(self, base: int) -> int:
        return base if self.tier.enemy_hp == 1.0 else int(round(base * self.tier.enemy_hp))

    # ----- event helpers ---------------------------------------------------
    def emit(self, type_: str, **data) -> None:
        self.events.append({"t": self.t, "type": type_, **data})

    def schedule(self, delay_ms: int, fn: Callable[[], None]) -> None:
        self._seq += 1
        self.pending.append((self.t + delay_ms, self._seq, fn))

    def unit_json(self, u: Unit) -> dict:
        out = {"id": u.id, "name": u.name, "kind": u.kind, "class": u.cls, "role": u.role,
               "max_hp": u.max_hp, "radius": u.radius, "model": u.model,
               "pos": [r2(u.pos[0]), r2(u.pos[1])]}
        if u.pack:
            out["pack"] = u.pack
        return out

    # ----- queries ---------------------------------------------------------
    def players(self, alive_only: bool = True) -> list[Unit]:
        return [u for u in self.units.values() if u.kind == "player" and (u.alive or not alive_only)]

    def enemies(self) -> list[Unit]:
        return [u for u in self.units.values() if u.kind != "player" and u.alive]

    def edge_dist(self, a: Unit, b: Unit) -> float:
        return dist(a.pos, b.pos) - a.radius - b.radius

    # ----- movement --------------------------------------------------------
    def start_move(self, u: Unit, to: Vec, *, exact: bool = False) -> None:
        to = self.clamp(to)
        to = (r2(to[0]), r2(to[1]))
        if u.kind == "player" and not exact:
            # Asking again for the spot it was already sent to (and shifted
            # away from) is not a new order, as long as where it was shifted
            # to is still free and no worse for pools.
            if u.asked_to is not None and dist(u.asked_to, to) < 0.05:
                here = u.move.to if u.move else u.pos
                if not self.taken(u, here) and (self.in_pool(u, to) or not self.in_pool(u, here)):
                    return
            u.asked_to = to
            to = self.free_spot(u, to)
        elif not exact:
            u.asked_to = to
            to = self.free_spot(u, to)
        if u.move and dist(u.move.to, to) < 0.05:
            return
        if not u.move and dist(u.pos, to) < 0.05:
            return
        frm = (r2(u.pos[0]), r2(u.pos[1]))
        dur = int(round(dist(frm, to) / u.speed * 1000))
        u.pos = frm
        u.move = Move(frm, to, self.t, dur)
        if u.cast and C.ABILITIES[u.cast.ability].cast_ms > 0:
            self.emit("cast_interrupted", unit=u.id, ability=u.cast.ability, by=None,
                      by_ability=None, reason="moved")
            u.cast = None
        self.emit("move", unit=u.id, **{"from": list(frm)}, to=list(to), duration_ms=dur)

    def clamp(self, to: Vec) -> Vec:
        """Keep a destination inside the playable area (here: the arena circle)."""
        d = dist(to, (0.0, 0.0))
        lim = C.ARENA_RADIUS - 1.0
        if d > lim:
            to = (to[0] * lim / d, to[1] * lim / d)
        return to

    def stop_move(self, u: Unit) -> None:
        if u.move:
            self.start_move(u, u.pos, exact=True)
            u.move = None
        u.asked_to = None

    def taken(self, u: Unit, spot: Vec) -> bool:
        """Would u's body overlap another unit standing (or headed) there?"""
        for o in self.units.values():
            if o is u or not o.alive:
                continue
            there = o.move.to if o.move else o.pos
            if dist(spot, there) < u.radius + o.radius + BODY_GAP:
                return True
        return False

    def in_pool(self, u: Unit, spot: Vec) -> bool:
        """Would u standing there be hit by a pool? (Same reach as ground_tick, plus a margin.)"""
        return any(dist(spot, g["pos"]) <= g["radius"] + u.radius * 0.5 + 0.2 for g in self.ground.values()
                   if g["kind"] in C.HAZARD_POOLS)

    def free_spot(self, u: Unit, to: Vec) -> Vec:
        """Nearest spot to ``to`` where u's body fits: walkable, not inside
        another unit, and not in a pool unless ``to`` itself was."""
        if not self.taken(u, to):
            return to
        pool_ok = self.in_pool(u, to)
        # A spot asked for within melee reach of a foe was asked for to
        # fight it: shift around that foe, not away from it.
        foes = [o for o in self.units.values() if (o.kind == "player") != (u.kind == "player") and o.alive
                and dist(to, o.pos) - o.radius - u.radius <= C.MELEE_RANGE]
        for ring in SPOT_RINGS:
            best = None
            for dx, dz in SPOT_DIRS:
                c = (r2(to[0] + dx * ring), r2(to[1] + dz * ring))
                w = self.clamp(c)
                if dist(w, c) > 0.01 or self.taken(u, c) or (not pool_ok and self.in_pool(u, c)):
                    continue
                # Same ring: prefer staying close to the enemy it came to
                # fight, else the side the unit is coming from.
                key = min(dist(c, o.pos) - o.radius for o in foes) if foes else dist(c, u.pos)
                if best is None or key < best[0]:
                    best = (key, c)
            if best:
                return best[1]
        return to

    # ----- combat math -----------------------------------------------------
    def damage(self, src: Unit, tgt: Unit, ability: str, base: float, *, crit_ok: bool = True) -> None:
        if not tgt.alive:
            return
        amt = base * self.rng.uniform(0.92, 1.08)
        crit = crit_ok and src.kind == "player" and self.rng.random() < 0.15
        if crit:
            amt *= 2
        if src.kind != "player" and self.tier.enemy_dmg != 1.0:
            amt *= self.tier.enemy_dmg
        if "hollow_fury" in src.auras:
            amt *= 4
        if "ironhide" in tgt.auras:
            amt *= 0.4
        amt = int(round(amt))
        absorbed = min(tgt.absorb, amt)
        tgt.absorb -= absorbed
        dealt = amt - absorbed
        overkill = max(0, dealt - tgt.hp)
        tgt.hp = max(0, tgt.hp - dealt)
        self.emit("damage", source=src.id, target=tgt.id, ability=ability, amount=dealt - overkill,
                  absorbed=absorbed, overkill=overkill, crit=crit, hp=tgt.hp, absorb=tgt.absorb)
        if absorbed and tgt.absorb == 0 and "lumen_ward" in tgt.auras:
            self.remove_aura(tgt, "lumen_ward", "consumed")
        if tgt.hp == 0:
            self.kill(tgt, src, ability)

    def heal(self, src: Unit, tgt: Unit, ability: str, base: float, *, crit_ok: bool = True) -> None:
        if not tgt.alive:
            return
        amt = base * self.rng.uniform(0.95, 1.05)
        crit = crit_ok and self.rng.random() < 0.15
        if crit:
            amt *= 1.8
        amt = int(round(amt))
        eff = min(amt, tgt.max_hp - tgt.hp)
        tgt.hp += eff
        self.emit("heal", source=src.id, target=tgt.id, ability=ability, amount=eff,
                  overheal=amt - eff, crit=crit, hp=tgt.hp)

    def apply_aura(self, tgt: Unit, aura_id: str, src: Unit, *, absorb: int = 0) -> None:
        a = C.AURAS[aura_id]
        old = tgt.auras.get(aura_id)
        if a.stacks and old:
            # Another stack: refresh the duration, keep the tick rhythm.
            old.stacks += 1
            old.t0, old.dur, old.source = self.t, a.duration_ms, src.id
            self.emit("aura_apply", unit=tgt.id, aura=aura_id, source=src.id, duration_ms=a.duration_ms,
                      stacks=old.stacks)
            return
        tgt.auras[aura_id] = Aura(aura_id, src.id, self.t, a.duration_ms,
                                  next_tick=self.t + a.tick_ms if a.tick_ms else 0)
        data = {"unit": tgt.id, "aura": aura_id, "source": src.id, "duration_ms": a.duration_ms}
        if a.stacks:
            data["stacks"] = 1
        if absorb:
            tgt.absorb = absorb
            data["absorb"] = absorb
        self.emit("aura_apply", **data)

    def remove_aura(self, tgt: Unit, aura_id: str, reason: str = "expired") -> None:
        if aura_id in tgt.auras:
            del tgt.auras[aura_id]
            if aura_id == "lumen_ward":
                tgt.absorb = 0
            self.emit("aura_remove", unit=tgt.id, aura=aura_id, reason=reason)

    def kill(self, u: Unit, killer: Unit, ability: str) -> None:
        u.alive = False
        u.cast = None
        if u.move:
            u.pos = u.move.pos_at(self.t)
            u.move = None
        u.asked_to = None
        self.emit("death", unit=u.id, killer=killer.id, ability=ability)
        for aid in list(u.auras):
            del u.auras[aid]
        u.absorb = 0
        if u.kind == "add":
            self.on_undead_death(u)

    def on_undead_death(self, u: Unit) -> None:
        """Affixes that trigger when an undead (not Oruth) dies."""
        if "restless_graves" in self.affixes:
            self.ground_count += 1
            gid = f"grave_{self.ground_count}"
            pos = (r2(u.pos[0]), r2(u.pos[1]))
            arm = C.BOSS.desecrate_arm_ms
            self.ground[gid] = {"id": gid, "kind": "grave", "source": u.id, "pos": pos, "radius": C.GRAVE_RADIUS,
                                "spawned_at": self.t, "armed_at": self.t + arm,
                                "expires_at": self.t + C.GRAVE_DURATION_MS, "next_tick": self.t + arm,
                                "tick_ms": C.GRAVE_TICK_MS}
            self.emit("ground_spawn", id=gid, kind="grave", source=u.id, pos=list(pos), radius=C.GRAVE_RADIUS,
                      arm_ms=arm, duration_ms=C.GRAVE_DURATION_MS, target=None)
        if "marrowburst" in self.affixes:
            for p in self.players():
                self.apply_aura(p, "marrow_shards", u)

    # ----- casting ---------------------------------------------------------
    @staticmethod
    def right_team(ab: C.Ability, u: Unit, tgt: Unit) -> bool:
        """Attacks and kicks go on enemies; heals and shields on allies."""
        if ab.kind in ("damage", "interrupt"):
            return tgt.kind != "player"
        if ab.kind in ("heal", "hot", "absorb"):
            return tgt.kind == "player"
        return True

    def can_cast(self, u: Unit, ab: C.Ability, tgt: Unit | None) -> bool:
        if not u.alive or u.cast:
            return False
        if ab.on_gcd and self.t < u.gcd_until:
            return False
        if u.cooldowns.get(ab.id, 0) > self.t:
            return False
        if ab.cast_ms and u.move:
            return False
        if tgt is not None:
            if not tgt.alive:
                return False
            if u.kind == "player" and not self.right_team(ab, u, tgt):
                return False
            if ab.kind not in ("taunt", "buff") and tgt is not u and self.edge_dist(u, tgt) > ab.range:
                return False
        return True

    def begin_cast(self, u: Unit, ability_id: str, target_id: str | None) -> bool:
        ab = C.ABILITIES[ability_id]
        tgt = self.units.get(target_id) if target_id else None
        if not self.can_cast(u, ab, tgt):
            return False
        if ab.on_gcd:
            u.gcd_until = self.t + int(C.GCD_MS / u.haste)
        if ab.kind in ("damage", "aoe_damage") and tgt and tgt.kind != "player":
            u.target = tgt.id
        if ab.cast_ms:
            cast_ms = int(ab.cast_ms / u.haste)
            u.cast = Cast(ab.id, target_id, self.t, cast_ms)
            self.emit("cast_start", unit=u.id, ability=ab.id, target=target_id, cast_ms=cast_ms,
                      interruptible=ab.interruptible)
        else:
            self.resolve(u, ab, target_id)
        return True

    def resolve(self, u: Unit, ab: C.Ability, target_id: str | None) -> None:
        tgt = self.units.get(target_id) if target_id else None
        if ab.cooldown_ms:
            u.cooldowns[ab.id] = self.t + ab.cooldown_ms
        self.emit("cast_success", unit=u.id, ability=ab.id, target=target_id)
        k = ab.kind
        if ab.projectile_ms and tgt:
            self.emit("projectile", source=u.id, target=tgt.id, ability=ab.id,
                      travel_ms=ab.projectile_ms)
            self.schedule(ab.projectile_ms, lambda: self.damage(u, tgt, ab.id, ab.amount))
        elif k == "damage" and tgt:
            self.damage(u, tgt, ab.id, ab.amount)
        elif k == "aoe_damage":
            for e in self.enemies():
                if dist(u.pos, e.pos) - e.radius <= ab.radius:
                    self.damage(u, e, ab.id, ab.amount)
        elif k == "heal" and tgt:
            self.heal(u, tgt, ab.id, ab.amount)
        elif k == "hot" and tgt:
            self.apply_aura(tgt, ab.aura, u)
        elif k == "absorb" and tgt:
            self.apply_aura(tgt, ab.aura, u, absorb=ab.amount)
        elif k == "raid_heal":
            for p in self.players():
                self.heal(u, p, ab.id, ab.amount)
                self.apply_aura(p, "radiant_afterglow", u)
        elif k == "buff":
            if ab.id == "wild_roar":
                for p in self.players():
                    self.apply_aura(p, "wild_roar", u)
            else:
                self.apply_aura(u, ab.aura, u)
        elif k == "interrupt" and tgt:
            if ab.projectile_ms == 0 and u.cls == "ranger":
                self.emit("projectile", source=u.id, target=tgt.id, ability=ab.id, travel_ms=250)
            if tgt.cast and C.ABILITIES[tgt.cast.ability].interruptible:
                self.emit("cast_interrupted", unit=tgt.id, ability=tgt.cast.ability, by=u.id,
                          by_ability=ab.id, reason="interrupt")
                tgt.cast = None
        elif k == "taunt":
            for e in self.enemies():
                if e.kind == "add" and dist(u.pos, e.pos) <= ab.radius:
                    e.target = u.id
                    if "taunted" not in e.auras:
                        self.apply_aura(e, "taunted", u)
        elif k == "boss":
            self.resolve_boss(u, ab, tgt)
        elif k == "trash":
            self.resolve_trash(u, ab, tgt)

    def resolve_trash(self, u: Unit, ab: C.Ability, tgt: Unit | None) -> None:
        """Dungeon trash abilities (see dungeon.py)."""

    # ----- boss behaviour --------------------------------------------------
    def resolve_boss(self, b: Unit, ab: C.Ability, tgt: Unit | None) -> None:
        if ab.id == "soul_rend" and tgt and tgt.alive:
            self.damage(b, tgt, ab.id, ab.amount)
            if tgt.alive:
                self.apply_aura(tgt, "rent_soul", b)
        elif ab.id == "requiem_of_bones":
            for p in self.players():
                self.damage(b, p, ab.id, ab.amount)
                if p.alive:
                    self.apply_aura(p, "haunted", b)
        elif ab.id == "raise_dead":
            self.emit("emote", unit=b.id, style="yell", text="Rise, my faithful. Feast upon the living!")
            for door in C.CRYPT_DOORS:
                self.add_count += 1
                aid = f"bonewalker_{self.add_count}"
                a = C.ADD
                healer = next((p for p in self.players() if p.role == "healer"), None)
                add = Unit(aid, a.name, "add", "bonewalker", "add", self.scaled_hp(a.max_hp), a.radius, a.speed,
                           a.model, door, target=(healer or self.players()[0]).id)
                add.swing_at = self.t + 1500
                self.units[aid] = add
                self.emit("spawn", unit=self.unit_json(add))

    def boss_tick(self) -> None:
        b = self.boss
        if not b.alive or not b.engaged:
            return
        if not self.enraged and self.t - self.boss_engaged_t >= C.BOSS.enrage_ms:
            self.enraged = True
            self.emit("emote", unit=b.id, style="yell", text="Enough! The Hollow Crown consumes all!")
            self.apply_aura(b, "hollow_fury", b)
            self.fury_pulses = 0
            self.next_fury_pulse = self.t
        if self.enraged and self.t >= self.next_fury_pulse:
            # Hard enrage: ramping party-wide damage makes the timer a real deadline.
            self.next_fury_pulse = self.t + C.BOSS.fury_pulse_ms
            amount = C.BOSS.fury_pulse_base + C.BOSS.fury_pulse_ramp * self.fury_pulses
            self.fury_pulses += 1
            self.emit("cast_success", unit=b.id, ability="hollow_fury", target=None)
            for p in self.players():
                self.damage(b, p, "hollow_fury", amount, crit_ok=False)
        if self.raise_dead_left and b.hp / b.max_hp <= self.raise_dead_left[0]:
            self.raise_dead_left.pop(0)
            self.raise_queued = True
        tank = self.units.get(b.target)
        if not tank or not tank.alive:
            alive = self.players()
            if not alive:
                return
            tank = min(alive, key=lambda p: dist(p.pos, b.pos))
            b.target = tank.id
        if b.cast:
            return
        # Priority: Summon the Restless > Soul Rend > Requiem > Grave Mark > Desecrate > Bone Pyre.
        # A mechanic that is due stays due until it actually happens: Oruth
        # stops walking to cast, and a cast he can't start yet (Soul Rend on a
        # target out of reach) waits while he closes in. Nothing is ever skipped.
        if self.raise_queued:
            if self.boss_cast(b, "raise_dead", None):
                self.raise_queued = False
                self.emit("emote", unit=b.id, style="warning", text="Oruth begins to Summon the Restless!")
                return
        for key in ("soul_rend", "requiem_of_bones", "grave_mark", "desecrate", "bone_pyre"):
            if key not in self.boss_next or self.t < self.boss_next[key]:
                continue
            if key == "grave_mark":
                if not self.cast_grave_mark(b):
                    continue  # nobody to brand: try again next tick
            elif key == "soul_rend":
                if not self.boss_cast(b, key, tank.id):
                    continue
            elif key == "requiem_of_bones":
                if not self.boss_cast(b, key, None):
                    continue
            elif key == "bone_pyre":
                self.cast_bone_pyre(b)
            else:
                self.cast_desecrate(b)
            every = C.GRAVE_MARK_EVERY_MS if key == "grave_mark" else C.BOSS.timers[key][1]
            self.boss_next[key] = self.t + self.jitter(key, every, every * C.BOSS.timer_jitter)
            return
        if self.edge_dist(b, tank) > C.MELEE_RANGE:
            if self.t - self.boss_engaged_t >= C.BOSS.rise_ms:
                self.chase(b, tank)
            return
        if self.t >= b.swing_at:
            b.swing_at = self.t + C.BOSS.melee[1]
            self.emit("cast_success", unit=b.id, ability="hollow_strike", target=tank.id)
            self.damage(b, tank, "hollow_strike", C.BOSS.melee[0])

    def boss_cast(self, b: Unit, ability_id: str, target_id: str | None) -> bool:
        """Start one of Oruth's cast-time abilities if he can: in reach of its
        target, he stops walking and casts. False (and nothing changes) if not."""
        ab = C.ABILITIES[ability_id]
        tgt = self.units.get(target_id) if target_id else None
        if tgt is not None and (not tgt.alive or self.edge_dist(b, tgt) > ab.range):
            return False
        if b.move:
            self.stop_move(b)
        return self.begin_cast(b, ability_id, target_id)

    def cast_grave_mark(self, b: Unit) -> bool:
        """Hollow Tyrant: brand a random non-tank player; it detonates in 6 s."""
        candidates = [p for p in self.players() if p.role != "tank" and "grave_mark" not in p.auras]
        if not candidates:
            return False
        p = self.rng.choice(candidates)
        self.emit("cast_success", unit=b.id, ability="grave_mark", target=p.id)
        self.emit("emote", unit=b.id, style="warning", text=f"Oruth brands {p.name} with a Grave Mark!")
        self.apply_aura(p, "grave_mark", b)
        return True

    def detonate_grave_mark(self, p: Unit, src: Unit) -> None:
        others = [o for o in self.players() if o is not p and dist(o.pos, p.pos) <= C.GRAVE_MARK_RADIUS]
        self.damage(src, p, "grave_mark", C.GRAVE_MARK_SELF, crit_ok=False)
        for o in others:
            self.damage(src, o, "grave_mark", C.GRAVE_MARK_SPLASH, crit_ok=False)

    def cast_desecrate(self, b: Unit) -> None:
        self.emit("cast_success", unit=b.id, ability="desecrate", target=None)
        candidates = [p for p in self.players() if p.role != "tank"]
        k = min(C.TYRANT_DESECRATE_TARGETS if self.tyrant else C.BOSS.desecrate_targets, len(candidates))
        for p in self.rng.sample(candidates, k):
            self.ground_count += 1
            gid = f"desecrate_{self.ground_count}"
            pos = (r2(p.pos[0]), r2(p.pos[1]))
            g = {"id": gid, "kind": "desecrate", "source": b.id, "pos": pos,
                 "radius": C.BOSS.desecrate_radius, "spawned_at": self.t,
                 "armed_at": self.t + C.BOSS.desecrate_arm_ms,
                 "expires_at": self.t + C.BOSS.desecrate_duration_ms,
                 "next_tick": self.t + C.BOSS.desecrate_arm_ms, "tick_ms": C.BOSS.desecrate_tick_ms}
            self.ground[gid] = g
            self.emit("ground_spawn", id=gid, kind="desecrate", source=b.id, pos=list(pos),
                      radius=g["radius"], arm_ms=C.BOSS.desecrate_arm_ms,
                      duration_ms=C.BOSS.desecrate_duration_ms, target=p.id)

    def cast_bone_pyre(self, b: Unit) -> None:
        """Mark a circle a few metres from Oruth, clear of other pools, inside his room."""
        self.emit("cast_success", unit=b.id, ability="bone_pyre", target=None)
        lim = C.ARENA_RADIUS - C.PYRE_RADIUS - 1.5
        pos = b.pos
        for _ in range(12):
            # A compass direction, not cos/sin of a random angle: libm trig can
            # differ in the last bit between machines (replays must not).
            dx, dz = self.pyre_rng.choice(COMPASS16)
            r = self.pyre_rng.uniform(C.PYRE_MIN_DIST, C.PYRE_MAX_DIST)
            c = (r2(b.pos[0] + r * dx), r2(b.pos[1] + r * dz))
            if dist(c, (0.0, 0.0)) > lim:
                continue
            pos = c
            if not any(dist(c, g["pos"]) < g["radius"] + C.PYRE_RADIUS for g in self.ground.values()):
                break
        self.ground_count += 1
        gid = f"pyre_{self.ground_count}"
        fuse = C.PYRE_FUSE_MS
        self.ground[gid] = {"id": gid, "kind": "pyre", "source": b.id, "pos": pos, "radius": C.PYRE_RADIUS,
                            "spawned_at": self.t, "armed_at": self.t + fuse, "detonate_at": self.t + fuse,
                            "expires_at": self.t + fuse + TICK_MS, "next_tick": 1 << 62, "tick_ms": 1 << 62}
        self.emit("ground_spawn", id=gid, kind="pyre", source=b.id, pos=list(pos), radius=C.PYRE_RADIUS,
                  arm_ms=fuse, duration_ms=fuse)

    def detonate_pyre(self, g: dict) -> None:
        src = self.units[g["source"]]
        inside = [p for p in self.players() if dist(p.pos, g["pos"]) <= g["radius"] + p.radius * 0.5]
        soaked = len(inside) >= C.PYRE_SOAKERS
        self.emit("pyre_detonate", id=g["id"], pos=list(g["pos"]), inside=[p.id for p in inside], soaked=soaked)
        if soaked:
            for p in inside:
                self.damage(src, p, "bone_pyre", C.PYRE_SOAK / len(inside), crit_ok=False)
        else:
            for p in self.players():
                self.damage(src, p, "bone_pyre", C.PYRE_BLAST, crit_ok=False)

    def ground_tick(self) -> None:
        for gid, g in list(self.ground.items()):
            if g["kind"] == "pyre" and self.t >= g["detonate_at"]:
                del self.ground[gid]
                self.detonate_pyre(g)
                self.emit("ground_expire", id=gid)
                continue
            if self.t >= g["expires_at"]:
                del self.ground[gid]
                self.emit("ground_expire", id=gid)
                continue
            if self.t >= g["next_tick"]:
                g["next_tick"] = self.t + g["tick_ms"]
                if g["kind"] == "grave":
                    src = self.units[g["source"]]
                    for p in self.players():
                        if dist(p.pos, g["pos"]) <= g["radius"] + p.radius * 0.5:
                            self.damage(src, p, "restless_grave", C.GRAVE_DAMAGE, crit_ok=False)
                    for e in self.enemies():
                        if e.kind == "add" and dist(e.pos, g["pos"]) <= g["radius"] + e.radius * 0.5:
                            self.heal(src, e, "restless_grave", e.max_hp * C.GRAVE_HEAL_PCT, crit_ok=False)
                    continue
                for p in self.players():
                    if dist(p.pos, g["pos"]) <= g["radius"] + p.radius * 0.5:
                        self.damage(self.boss, p, "desecrate", C.ABILITIES["desecrate"].amount,
                                    crit_ok=False)

    def melee_adds(self) -> list[Unit]:
        """Enemies that chase their target and claw it (the dungeon filters these)."""
        return [u for u in self.units.values() if u.kind == "add" and u.alive]

    def chase(self, e: Unit, tgt: Unit) -> None:
        """Walk an enemy up to its target, to a free spot beside it."""
        d = dist(e.pos, tgt.pos)
        stop = e.radius + tgt.radius + 0.4
        f = max(0.0, (d - stop) / d) if d else 0
        dest = lerp(e.pos, tgt.pos, f)
        if e.kind == "boss":
            dest = self.leash(dest)
        # Re-plan only when the target has moved on (re-planning every tick = jitter).
        if e.move and e.asked_to is not None and dist(e.asked_to, dest) <= 1.0:
            return
        self.start_move(e, dest)

    def leash(self, spot: Vec) -> Vec:
        """Oruth never leaves his throne room (the arena circle)."""
        d = dist(spot, (0.0, 0.0))
        lim = C.ARENA_RADIUS - 2.5
        return (spot[0] * lim / d, spot[1] * lim / d) if d > lim else spot

    def add_tick(self) -> None:
        for a in self.melee_adds():
            tgt = self.units.get(a.target)
            if not tgt or not tgt.alive:
                alive = self.players()
                if not alive:
                    return
                tgt = min(alive, key=lambda p: dist(p.pos, a.pos))
                a.target = tgt.id
            if self.edge_dist(a, tgt) > ENEMY_REACH:
                self.chase(a, tgt)
            elif self.t >= a.swing_at:
                # In reach: swing. (A walker finishes its step to the free spot
                # it chose rather than stopping on top of someone.)
                a.swing_at = self.t + C.ADD.swing_ms
                self.emit("cast_success", unit=a.id, ability="bone_claw", target=tgt.id)
                self.damage(a, tgt, "bone_claw", C.ABILITIES["bone_claw"].amount)

    # ----- periodic effects ------------------------------------------------
    def aura_tick(self) -> None:
        for u in list(self.units.values()):
            if not u.alive:
                continue
            for aid, au in list(u.auras.items()):
                d = C.AURAS[aid]
                if d.tick_ms and self.t >= au.next_tick and self.t <= au.t0 + au.dur:
                    au.next_tick += d.tick_ms
                    src = self.units[au.source]
                    if d.harmful:
                        self.damage(src, u, aid, d.tick_amount * au.stacks, crit_ok=False)
                    else:
                        self.heal(src, u, aid, d.tick_amount * au.stacks, crit_ok=False)
                    if not u.alive:
                        break
                if self.t >= au.t0 + au.dur:
                    self.remove_aura(u, aid)
                    if aid == "grave_mark":
                        self.detonate_grave_mark(u, self.units[au.source])
                        if not u.alive:
                            break

    def auto_attacks(self) -> None:
        for p in self.players():
            cd = C.CLASSES[p.cls]
            if not cd.auto_attack or p.cast:
                continue
            tgt = self.units.get(p.target)
            if not tgt or not tgt.alive or self.edge_dist(p, tgt) > C.MELEE_RANGE:
                continue
            if self.t >= p.swing_at:
                p.swing_at = self.t + int(cd.auto_attack[1] / p.haste)
                self.damage(p, tgt, "auto_attack", cd.auto_attack[0])

    # ----- observations for policies --------------------------------------
    def view(self, u: Unit, full: bool) -> dict:
        v = {
            "id": u.id, "name": u.name, "role": u.role, "class": u.cls, "alive": u.alive,
            "hp": u.hp, "max_hp": u.max_hp, "hp_pct": round(100 * u.hp / u.max_hp, 1),
            "absorb": u.absorb, "pos": [r2(u.pos[0]), r2(u.pos[1])], "moving": u.move is not None,
            "target": u.target,
            "auras": {aid: au.t0 + au.dur - self.t for aid, au in u.auras.items()},
            "casting": None,
        }
        stacks = {aid: au.stacks for aid, au in u.auras.items() if au.stacks > 1}
        if stacks:
            v["stacks"] = stacks
        if u.cast:
            ab = C.ABILITIES[u.cast.ability]
            v["casting"] = {"ability": ab.id, "name": ab.name, "target": u.cast.target,
                            "elapsed_ms": self.t - u.cast.t0,
                            "remaining_ms": u.cast.t0 + u.cast.cast_ms - self.t,
                            "interruptible": ab.interruptible}
        if u.kind == "player":
            cd = C.CLASSES[u.cls]
            v["cooldowns"] = {a: max(0, u.cooldowns.get(a, 0) - self.t) for a in cd.abilities}
            if full:
                v["gcd_ms"] = max(0, u.gcd_until - self.t)
                v["abilities"] = list(cd.abilities)
        return v

    def observe(self, u: Unit) -> dict:
        return {
            "t": self.t,
            "self": self.view(u, True),
            "party": [self.view(p, False) for p in self.players(alive_only=False)],
            "enemies": [self.view(e, False) for e in self.enemies()],
            "ground": [{"id": g["id"], "kind": g["kind"], "pos": list(g["pos"]),
                        "radius": g["radius"], "age_ms": self.t - g["spawned_at"],
                        "armed": g["kind"] in C.HAZARD_POOLS and self.t >= g["armed_at"],
                        **({"detonates_in_ms": g["detonate_at"] - self.t} if g["kind"] == "pyre" else {})}
                       for g in self.ground.values()],
            "tier": self.tier.id,
            "affixes": list(self.tier.affixes),
            "arena_radius": C.ARENA_RADIUS,
            "boss_next_ms": {k: max(0, v - self.t) for k, v in self.boss_next.items()},
        }

    def run_policies(self) -> None:
        for p in self.players():
            pol = self.policies.get(p.id)
            if not pol:
                continue
            for act in pol.act(self.observe(p)):
                ok = False
                if act.type == "move" and act.to is not None:
                    self.start_move(p, act.to)
                    ok = True
                elif act.type == "cast" and act.ability:
                    if act.ability not in C.CLASSES[p.cls].abilities:
                        continue  # illegal action: silently ignored (and countable later)
                    ok = self.begin_cast(p, act.ability, act.target)
                if ok and act.reason:
                    label = act.ability and C.ABILITIES[act.ability].name or "Move"
                    tname = self.units[act.target].name if act.target in self.units else None
                    self.emit("decision", unit=p.id,
                              action=f"{label} → {tname}" if tname else label, reason=act.reason)

    # ----- main loop -------------------------------------------------------
    def step(self) -> None:
        # 1. movement
        for u in self.units.values():
            if u.move and u.alive:
                u.pos = u.move.pos_at(self.t)
                if self.t >= u.move.t0 + u.move.dur:
                    u.pos = u.move.to
                    u.move = None
        # 2. delayed effects (projectiles landing)
        due = sorted([p for p in self.pending if p[0] <= self.t], key=lambda p: (p[0], p[1]))
        self.pending = [p for p in self.pending if p[0] > self.t]
        for _, _, fn in due:
            fn()
        # 3. casts finishing
        for u in list(self.units.values()):
            if u.alive and u.cast and self.t >= u.cast.t0 + u.cast.cast_ms:
                c = u.cast
                u.cast = None
                tgt = self.units.get(c.target) if c.target else None
                if tgt is not None and not tgt.alive and u.kind == "player":
                    continue
                self.resolve(u, C.ABILITIES[c.ability], c.target)
        # 4. periodic stuff, enemies, then players
        self.aura_tick()
        self.ground_tick()
        self.boss_tick()
        self.add_tick()
        self.auto_attacks()
        self.run_policies()

    def run(self, max_ms: int = 330_000) -> dict:
        self.roster = [self.unit_json(u) for u in self.units.values()]
        self.intro()
        while self.outcome is None:
            self.step()
            if self.cleared():
                self.outcome = "victory"
            elif not self.players():
                self.outcome = "wipe"
            elif self.time_up(max_ms):
                self.outcome = "timeout"
            else:
                self.t += TICK_MS
        if self.outcome == "victory":
            self.emit("emote", unit=self.boss.id, style="yell",
                      text="The crown... was never... mine...")
        else:
            self.emit("emote", unit=self.boss.id, style="yell",
                      text="Another party for my eternal court.")
        self.emit("encounter_end", outcome=self.outcome,
                  final_hp={u.id: u.hp for u in self.units.values()})
        return self.to_replay()

    def cleared(self) -> bool:
        """What a win is: here, the boss dead."""
        return not self.boss.alive

    def time_up(self, max_ms: int) -> bool:
        return self.t >= max_ms

    def intro(self) -> None:
        self.emit("encounter_start", encounter="hollow_vault", boss=self.boss.id)
        self.emit("emote", unit=self.boss.id, style="yell",
                  text="You trespass in my vault. Your bones will serve me!")

    def to_replay(self) -> dict:
        abilities = {k: a.to_json() for k, a in C.ABILITIES.items()}
        abilities["auto_attack"] = {"name": "Auto Attack", "kind": "damage", "icon": "sword",
                                    "school": "physical", "cast_ms": 0, "cooldown_ms": 0,
                                    "interruptible": False, "description": "Melee swing."}
        return {
            "schema_version": "0.1.0",
            "meta": {
                "encounter": "hollow_vault",
                "title": "The Hollow Vault: Oruth the Unburied",
                "seed": self.seed,
                "policy": self.policy_label,
                "sim_version": SIM_VERSION,
                "content_version": C.CONTENT_VERSION,
                "tick_ms": TICK_MS,
                "duration_ms": self.t,
                "outcome": self.outcome,
                "tier": self.tier.id,
                "tier_name": self.tier.name,
                "affixes": list(self.tier.affixes),
                "time_limit_ms": C.TIME_LIMIT_MS,
            },
            "arena": {"radius": C.ARENA_RADIUS, "doors": [list(d) for d in C.CRYPT_DOORS]},
            "classes": {k: {"name": c.name, "role": c.role, "interrupt": c.interrupt,
                            "abilities": list(c.abilities)} for k, c in C.CLASSES.items()},
            "abilities": abilities,
            "auras": {k: a.to_json() for k, a in C.AURAS.items()},
            "affixes": {k: {"name": C.AFFIXES[k].name, "description": C.AFFIXES[k].description}
                        for k in self.tier.affixes},
            "units": self.roster,
            "events": self.events,
        }
