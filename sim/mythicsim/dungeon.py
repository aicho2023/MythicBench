"""The dungeon run: entrance -> Chapel pack -> Ossuary pack -> Mortisar.

``DungeonRun`` extends the boss ``Encounter`` with what a Mythic+ key adds
around a boss: a route to walk, trash packs that attack when you get close,
resting and reviving between pulls (each revive costs time), and one timer
for the whole run. The boss fight itself is unchanged; Mortisar just sleeps
until the party walks into his room.

Everything is still deterministic and event-logged, and policies still only
see ``observe()``: scripted bots and language models play by the same rules.
"""

from __future__ import annotations

from . import content as C
from .engine import Encounter, Unit, dist, r2

MODE = "dungeon"


def clamp_to_walkable(p: tuple[float, float]) -> tuple[float, float]:
    """Nearest walkable point (rooms are circles, corridors rectangles)."""
    if C.walkable(p):
        return p
    best, best_d = None, float("inf")
    for r in C.ROOMS:
        d = dist(p, r.center)
        lim = r.radius - 1.0
        q = r.center if d == 0 else (r.center[0] + (p[0] - r.center[0]) * lim / d,
                                      r.center[1] + (p[1] - r.center[1]) * lim / d)
        if dist(p, q) < best_d:
            best, best_d = q, dist(p, q)
    for c in C.CORRIDORS:
        q = (max(-c.x_half + 0.05, min(c.x_half - 0.05, p[0])), max(c.z_min, min(c.z_max, p[1])))
        if dist(p, q) < best_d:
            best, best_d = q, dist(p, q)
    return best


class DungeonRun(Encounter):
    def __init__(self, seed, policies, policy_label, level: int = C.SIGIL_LEVEL):
        super().__init__(seed, policies, policy_label, level)
        # The party starts at the crypt entrance, in a small cluster.
        offsets = ((0.0, -1.5), (0.0, 1.5), (-1.6, 0.0), (1.6, 0.0), (0.0, 0.0))
        for m, (dx, dz) in zip(C.PARTY, offsets):
            self.units[m.id].pos = (C.DUNGEON_START[0] + dx, C.DUNGEON_START[1] + dz)
            self.units[m.id].target = None
        self.boss.engaged = False
        self.pack_state = {p.id: "idle" for p in C.PACKS}  # idle -> engaged -> dead
        self.pack_members: dict[str, list[str]] = {}
        for pack in C.PACKS:
            ids = []
            counts: dict[str, int] = {}
            for cls, pos in pack.members:
                counts[cls] = counts.get(cls, 0) + 1
                d = C.TRASH[cls]
                # Pack-prefixed ids never collide with the boss's summoned "bonewalker_N" adds.
                uid = f"{pack.id}_{cls}_{counts[cls]}"
                u = Unit(uid, d.name, "add", cls, "add", self.scaled_hp(d.max_hp), d.radius, d.speed,
                         d.model, pos, target=None, pack=pack.id, engaged=False)
                self.units[uid] = u
                ids.append(uid)
            self.pack_members[pack.id] = ids
        self.combat_since: int | None = None
        self.calm_since = 0
        self.penalty_ms = 0
        self.revives = 0

    # ----- map ---------------------------------------------------------------
    def clamp(self, to):
        return clamp_to_walkable(to)

    # ----- pulling -------------------------------------------------------------
    def in_combat(self) -> bool:
        return (self.boss.alive and self.boss.engaged) or any(
            u.alive and u.engaged for u in self.units.values() if u.pack)

    def engage_pack(self, pack_id: str, by: str | None) -> None:
        if self.pack_state[pack_id] != "idle":
            return
        self.pack_state[pack_id] = "engaged"
        self.emit("pull", pack=pack_id, by=by)
        players = self.players()
        for uid in self.pack_members[pack_id]:
            u = self.units[uid]
            u.engaged = True
            if players:
                u.target = min(players, key=lambda p: (dist(p.pos, u.pos), p.id)).id
            u.swing_at = self.t + 800
            for s in C.TRASH[u.cls].spells:  # casters open with a short delay, not instantly
                u.cooldowns.setdefault(s, self.t + 1200)

    def engage_boss(self, by: str | None) -> None:
        b = self.boss
        if b.engaged:
            return
        b.engaged = True
        self.boss_engaged_t = self.t
        # The boss's timers were drawn relative to t=0; shift them to the pull.
        self.boss_next = {k: v + self.t for k, v in self.boss_next.items()}
        b.swing_at = self.t + 1500
        self.emit("pull", pack="boss", by=by)
        self.emit("emote", unit=b.id, style="yell",
                  text="You trespass in the Hollow King's tomb. Your bones will serve me!")

    def check_aggro(self) -> None:
        players = self.players()
        for pack in C.PACKS:
            if self.pack_state[pack.id] != "idle":
                continue
            for uid in self.pack_members[pack.id]:
                u = self.units[uid]
                close = next((p for p in players if dist(p.pos, u.pos) <= C.AGGRO_RADIUS), None)
                if close:
                    self.engage_pack(pack.id, close.id)
                    break
        if not self.boss.engaged:
            close = next((p for p in players if dist(p.pos, self.boss.pos) <= C.BOSS_ENGAGE_RADIUS), None)
            if close:
                self.engage_boss(close.id)

    def damage(self, src, tgt, ability, base, *, crit_ok=True):
        if src.kind == "player" and tgt.kind != "player":
            if tgt.pack and self.pack_state[tgt.pack] == "idle":
                self.engage_pack(tgt.pack, src.id)
            elif tgt.kind == "boss" and not tgt.engaged:
                self.engage_boss(src.id)
        super().damage(src, tgt, ability, base, crit_ok=crit_ok)

    def kill(self, u, killer, ability):
        super().kill(u, killer, ability)
        if u.pack and all(not self.units[i].alive for i in self.pack_members[u.pack]):
            self.pack_state[u.pack] = "dead"
            self.emit("pack_cleared", pack=u.pack)

    # ----- trash ---------------------------------------------------------------
    def add_tick(self) -> None:
        # Summoned Bonewalkers (the boss's adds) use the base behaviour, and so
        # do engaged melee trash; casters stand and cast.
        for a in [u for u in self.units.values() if u.kind == "add" and u.alive and u.engaged]:
            d = C.TRASH.get(a.cls)
            if d and not d.swing_ms:
                self.caster_tick(a, d)
        super().add_tick()

    def melee_adds(self):
        return [u for u in super().melee_adds() if u.engaged and not self.is_caster(u)]

    @staticmethod
    def is_caster(u: Unit) -> bool:
        d = C.TRASH.get(u.cls) if u.pack else None
        return bool(d and not d.swing_ms)

    def caster_tick(self, a: Unit, d: C.TrashDef) -> None:
        if a.cast:
            return
        tgt = self.units.get(a.target)
        if not tgt or not tgt.alive:
            alive = self.players()
            if not alive:
                return
            tgt = min(alive, key=lambda p: (dist(p.pos, a.pos), p.id))
            a.target = tgt.id
        for sid in d.spells:
            ab = C.ABILITIES[sid]
            if a.cooldowns.get(sid, 0) > self.t:
                continue
            if sid == "mend_bones":
                hurt = [u for u in self.units.values() if u.pack == a.pack and u.alive and u.hp < u.max_hp * 0.8]
                if not hurt:
                    continue
                target = min(hurt, key=lambda u: (u.hp / u.max_hp, u.id)).id
            elif sid == "grave_volley":
                target = None
            else:
                target = tgt.id
            if self.begin_cast(a, sid, target):
                return

    def resolve_trash(self, u: Unit, ab: C.Ability, tgt: Unit | None) -> None:
        if ab.id == "grave_volley":
            for p in self.players():
                if dist(p.pos, u.pos) <= ab.range:
                    self.damage(u, p, ab.id, ab.amount)
        elif ab.id == "mend_bones" and tgt and tgt.alive:
            self.heal(u, tgt, ab.id, tgt.max_hp * C.MEND_PCT, crit_ok=False)
        elif ab.id == "bone_bolt" and tgt and tgt.alive:
            self.damage(u, tgt, ab.id, ab.amount)

    def can_cast(self, u, ab, tgt):
        # Trash spells are cast at range without the player-style range checks.
        if ab.kind == "trash":
            return u.alive and not u.cast and u.cooldowns.get(ab.id, 0) <= self.t
        return super().can_cast(u, ab, tgt)

    # ----- between pulls -------------------------------------------------------
    def rest_tick(self) -> None:
        if self.in_combat():
            self.calm_since = self.t
            return
        calm = self.t - self.calm_since
        if self.t % 1000 == 0:
            for p in self.players():
                if p.hp < p.max_hp:
                    self.heal(p, p, "resting", p.max_hp * C.OOC_REGEN_PCT_PER_S, crit_ok=False)
        if calm >= C.REVIVE_AFTER_MS:
            for p in self.players(alive_only=False):
                if not p.alive:
                    p.alive = True
                    p.hp = int(p.max_hp * C.REVIVE_HP_PCT)
                    self.penalty_ms += C.DEATH_PENALTY_MS
                    self.revives += 1
                    self.emit("revive", unit=p.id, hp=p.hp, penalty_ms=C.DEATH_PENALTY_MS)

    def step(self) -> None:
        self.check_aggro()
        super().step()
        self.rest_tick()

    # ----- observation -----------------------------------------------------------
    def view(self, u, full):
        v = super().view(u, full)
        if u.kind != "player":
            v["engaged"] = u.engaged
            if u.pack:
                v["pack"] = u.pack
        return v

    def observe(self, u):
        obs = super().observe(u)
        obs["dungeon"] = {
            "elapsed_ms": self.t, "penalty_ms": self.penalty_ms, "limit_ms": C.DUNGEON_LIMIT_MS,
            "in_combat": self.in_combat(), "boss_engaged": self.boss.engaged,
            "packs": [{"id": p.id, "name": p.name, "room": p.room, "state": self.pack_state[p.id],
                       "alive": [i for i in self.pack_members[p.id] if self.units[i].alive]} for p in C.PACKS],
            "route": [list(w) for w in C.ROUTE],
        }
        if not self.boss.engaged:
            obs["boss_next_ms"] = {}  # his timers don't run until he's pulled
        return obs

    # ----- run -------------------------------------------------------------------
    def intro(self) -> None:
        self.emit("encounter_start", encounter="gravecrown_crypt_run", boss=self.boss.id)
        self.emit("emote", unit=self.boss.id, style="warning",
                  text="The Gravecrown Crypt: clear the way to the Hollow King.")

    def run(self, max_ms: int = C.DUNGEON_LIMIT_MS + 60_000) -> dict:
        return super().run(max_ms)

    def to_replay(self) -> dict:
        rep = super().to_replay()
        rep["abilities"]["resting"] = {"name": "Resting", "kind": "heal", "icon": "heal", "school": "nature",
                                       "cast_ms": 0, "cooldown_ms": 0, "interruptible": False,
                                       "description": "Out-of-combat health regeneration."}
        rep["meta"].update({
            "mode": MODE, "encounter": "gravecrown_crypt_run",
            "title": "Gravecrown Crypt — full run", "time_limit_ms": C.DUNGEON_LIMIT_MS,
            "penalty_ms": self.penalty_ms, "revives": self.revives,
            "boss_engaged_ms": self.boss_engaged_t if self.boss.engaged else None,
        })
        rep["arena"].update({
            "rooms": [{"id": r.id, "name": r.name, "center": list(r.center), "radius": r.radius} for r in C.ROOMS],
            "corridors": [{"x_half": c.x_half, "z_min": c.z_min, "z_max": c.z_max} for c in C.CORRIDORS],
            "route": [list(w) for w in C.ROUTE],
            "packs": [{"id": p.id, "name": p.name, "room": p.room, "members": self.pack_members[p.id]} for p in C.PACKS],
        })
        return rep
