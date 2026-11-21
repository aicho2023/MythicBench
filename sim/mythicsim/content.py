"""Game content: classes, abilities, auras, and the boss.

Everything here is *data*. The engine (engine.py) reads these tables; it
never hard-codes numbers. That separation matters for a benchmark:

* Anyone can read this one file to understand the encounter's rules.
* We can version the content (``CONTENT_VERSION``) so results from different
  rule sets are never silently compared.

All names are original. The *mechanics* deliberately echo classic MMO
dungeon design (interrupt the big cast, get out of the swirl, kill the adds,
press your defensive before the tank buster) so that MMO players instantly
recognise what is going on.
"""

from __future__ import annotations

from dataclasses import dataclass, field

CONTENT_VERSION = "1.1.0"

GCD_MS = 1000
MELEE_RANGE = 3.0
RANGED_RANGE = 30.0
ARENA_RADIUS = 15.0


@dataclass(frozen=True)
class Ability:
    id: str
    name: str
    kind: str  # damage | heal | hot | absorb | buff | interrupt | taunt | aoe_damage | raid_heal | boss
    icon: str  # icon key the viewer maps to a glyph
    school: str = "physical"  # physical | holy | shadow | nature | frost
    cast_ms: int = 0
    cooldown_ms: int = 0
    on_gcd: bool = True
    range: float = MELEE_RANGE
    amount: int = 0
    radius: float = 0.0
    interruptible: bool = False
    projectile_ms: int = 0  # >0 means the effect travels and lands later
    aura: str | None = None
    description: str = ""

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "kind": self.kind,
            "icon": self.icon,
            "school": self.school,
            "cast_ms": self.cast_ms,
            "cooldown_ms": self.cooldown_ms,
            "interruptible": self.interruptible,
            "description": self.description,
        }


@dataclass(frozen=True)
class AuraDef:
    id: str
    name: str
    icon: str
    harmful: bool
    duration_ms: int
    tick_ms: int = 0
    tick_amount: int = 0
    description: str = ""
    stacks: bool = False  # re-applying adds a stack (each stack ticks) and refreshes it

    def to_json(self) -> dict:
        out = {
            "name": self.name,
            "icon": self.icon,
            "harmful": self.harmful,
            "description": self.description,
        }
        if self.stacks:
            out["stacks"] = True
        return out


@dataclass(frozen=True)
class ClassDef:
    id: str
    name: str
    role: str  # tank | healer | dps
    max_hp: int
    model: str  # KayKit model name the viewer will load once assets exist
    abilities: tuple[str, ...]
    interrupt: str | None = None
    auto_attack: tuple[int, int] | None = None  # (amount, swing_ms) for melee classes
    speed: float = 5.0
    radius: float = 0.45


# ---------------------------------------------------------------------------
# Abilities
# ---------------------------------------------------------------------------

_ABILITIES = [
    # --- Guardian (tank) ---------------------------------------------------
    Ability("bulwark_slam", "Bulwark Slam", "damage", "shield", cooldown_ms=6000, amount=2200,
            description="Slam the target with your shield."),
    Ability("rampart_strike", "Rampart Strike", "damage", "sword", amount=1100,
            description="A dependable sword strike."),
    Ability("ironhide", "Ironhide", "buff", "shield_star", cooldown_ms=25000, on_gcd=False,
            aura="ironhide", description="Reduce damage taken by 60% for 8 sec."),
    Ability("rampart_bash", "Rampart Bash", "interrupt", "shield_bash", cooldown_ms=15000,
            on_gcd=False, range=4.0, description="Interrupt the target's spellcasting."),
    Ability("challenging_roar", "Challenging Roar", "taunt", "roar", cooldown_ms=20000,
            range=40.0, radius=40.0,
            description="Force all nearby enemies to attack you."),
    # --- Lightweaver (healer) ---------------------------------------------
    Ability("mending_light", "Mending Light", "heal", "heal", school="holy", cast_ms=1500,
            range=RANGED_RANGE, amount=9000, description="A fast, focused heal."),
    Ability("bloomward", "Bloomward", "hot", "bloom", school="holy", range=RANGED_RANGE,
            aura="bloomward", description="Heals the target over 12 sec."),
    Ability("lumen_ward", "Lumen Ward", "absorb", "ward", school="holy", cooldown_ms=8000,
            range=RANGED_RANGE, amount=15000, aura="lumen_ward",
            description="Shield an ally, absorbing 15,000 damage."),
    Ability("radiant_hymn", "Radiant Hymn", "raid_heal", "hymn", school="holy", cast_ms=2000,
            cooldown_ms=60000, range=RANGED_RANGE, amount=14000,
            description="Heal the entire party for a large amount."),
    Ability("sunspark", "Sunspark", "damage", "sun", school="holy", cast_ms=1500,
            range=RANGED_RANGE, amount=1400, projectile_ms=450,
            description="Hurl a mote of light at an enemy."),
    # --- Berserker (melee dps) --------------------------------------------
    Ability("ravage", "Ravage", "damage", "axe", cooldown_ms=4500, amount=3200,
            description="A brutal, heavy blow."),
    Ability("savage_hew", "Savage Hew", "damage", "slash", amount=1500,
            description="Hack at the target."),
    Ability("cleaving_storm", "Cleaving Storm", "aoe_damage", "whirl", cooldown_ms=8000,
            radius=8.0, amount=2600, description="Spin, striking all nearby enemies."),
    Ability("throat_punch", "Throat Punch", "interrupt", "fist", cooldown_ms=15000,
            on_gcd=False, range=4.0, description="Interrupt the target's spellcasting."),
    # --- Shadowblade (melee dps) ------------------------------------------
    Ability("twin_fang", "Twin Fang", "damage", "daggers", amount=1600,
            description="Strike twice with your daggers."),
    Ability("venom_burst", "Venom Burst", "damage", "venom", school="nature", cooldown_ms=8000,
            amount=4200, description="Detonate your poisons."),
    Ability("fan_of_blades", "Scatterblades", "aoe_damage", "fan", cooldown_ms=6000,
            radius=8.0, amount=1700, description="Throw blades at all nearby enemies."),
    Ability("quick_jab", "Quick Jab", "interrupt", "jab", cooldown_ms=15000, on_gcd=False,
            range=4.0, description="Interrupt the target's spellcasting."),
    # --- Ranger (ranged dps) ----------------------------------------------
    Ability("steady_arrow", "Steady Arrow", "damage", "arrow", cast_ms=1500,
            range=RANGED_RANGE, amount=2100, projectile_ms=400,
            description="A careful, aimed arrow."),
    Ability("piercing_shot", "Piercing Shot", "damage", "pierce", cast_ms=2000, cooldown_ms=9000,
            range=RANGED_RANGE, amount=6000, projectile_ms=350,
            description="A powerful shot that punches through armor."),
    Ability("silencing_arrow", "Silencing Arrow", "interrupt", "silence", cooldown_ms=20000,
            on_gcd=False, range=RANGED_RANGE,
            description="Interrupt the target's spellcasting."),
    Ability("wild_roar", "Wild Roar", "buff", "wild", cooldown_ms=300000, range=40.0,
            aura="wild_roar", description="Increase the party's haste by 30% for 30 sec."),
    # --- Mortisar, the Hollow King (boss) ---------------------------------
    Ability("hollow_strike", "Hollow Strike", "boss", "sword", school="frost", amount=3200,
            description="Mortisar strikes his current target."),
    Ability("soul_rend", "Soul Rend", "boss", "rend", school="shadow", cast_ms=2000,
            amount=30000, aura="rent_soul",
            description="Tank buster. Massive damage plus a lingering wound. Use a defensive!"),
    Ability("requiem_of_bones", "Requiem of Bones", "boss", "requiem", school="shadow",
            cast_ms=3000, amount=22000, interruptible=True, aura="haunted",
            description="Damages the whole party. INTERRUPT IT."),
    Ability("desecrate", "Desecrate", "boss", "desecrate", school="shadow", amount=9000,
            description="Corrupts the ground beneath three players. Move out!"),
    Ability("hollow_fury", "Hollow Fury", "boss", "fury", school="shadow",
            description="Enraged: shadow damage to the whole party every second, growing each time."),
    Ability("raise_dead", "Summon the Restless", "boss", "raise", school="shadow", cast_ms=2500,
            description="Summons Bonewalkers from the crypt doors. Kill them!"),
    # --- Bonewalker (add) -------------------------------------------------
    Ability("bone_claw", "Bone Claw", "boss", "claw", amount=1400,
            description="A Bonewalker claws its target."),
]
ABILITIES: dict[str, Ability] = {a.id: a for a in _ABILITIES}

# ---------------------------------------------------------------------------
# Auras (buffs and debuffs)
# ---------------------------------------------------------------------------

_AURAS = [
    AuraDef("ironhide", "Ironhide", "shield_star", False, 8000,
            description="Damage taken reduced by 60%."),
    AuraDef("bloomward", "Bloomward", "bloom", False, 12000, tick_ms=1000, tick_amount=1200,
            description="Healing every second."),
    AuraDef("lumen_ward", "Lumen Ward", "ward", False, 15000, description="Absorbs damage."),
    AuraDef("wild_roar", "Wild Roar", "wild", False, 30000, description="Haste increased by 30%."),
    AuraDef("radiant_afterglow", "Radiant Afterglow", "hymn", False, 6000, tick_ms=1000,
            tick_amount=1000, description="Healing every second."),
    AuraDef("rent_soul", "Rent Soul", "rend", True, 8000, tick_ms=1000, tick_amount=1000,
            description="Taking shadow damage every second."),
    AuraDef("haunted", "Haunted", "requiem", True, 6000, tick_ms=1000, tick_amount=1500,
            description="Taking shadow damage every second."),
    AuraDef("hollow_fury", "Hollow Fury", "fury", False, 600000,
            description="Enraged. Damage dealt increased by 300%."),
    AuraDef("taunted", "Taunted", "roar", True, 600000, description="Forced to attack the Guardian."),
    AuraDef("marrow_shards", "Marrow Shards", "claw", True, 4000, tick_ms=1000, tick_amount=900,
            description="Bone shards from a fallen undead: damage every second, per stack.", stacks=True),
    AuraDef("grave_mark", "Grave Mark", "raise", True, 6000,
            description="Detonates when it expires, hitting every ally within 6 m hard. Get away from the group."),
]
AURAS: dict[str, AuraDef] = {a.id: a for a in _AURAS}

# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------

CLASSES: dict[str, ClassDef] = {
    "guardian": ClassDef(
        "guardian", "Guardian", "tank", 62000, "Knight",
        ("bulwark_slam", "rampart_strike", "ironhide", "rampart_bash", "challenging_roar"),
        interrupt="rampart_bash", auto_attack=(700, 2000)),
    "lightweaver": ClassDef(
        "lightweaver", "Lightweaver", "healer", 42000, "Mage",
        ("mending_light", "bloomward", "lumen_ward", "radiant_hymn", "sunspark")),
    "berserker": ClassDef(
        "berserker", "Berserker", "dps", 44000, "Barbarian",
        ("ravage", "savage_hew", "cleaving_storm", "throat_punch"),
        interrupt="throat_punch", auto_attack=(1000, 2000)),
    "shadowblade": ClassDef(
        "shadowblade", "Shadowblade", "dps", 40000, "Rogue_Hooded",
        ("twin_fang", "venom_burst", "fan_of_blades", "quick_jab"),
        interrupt="quick_jab", auto_attack=(800, 1300)),
    "ranger": ClassDef(
        "ranger", "Ranger", "dps", 40000, "Ranger",
        ("steady_arrow", "piercing_shot", "silencing_arrow", "wild_roar"),
        interrupt="silencing_arrow"),
}


@dataclass(frozen=True)
class PartyMember:
    id: str
    name: str
    cls: str
    home: tuple[float, float]  # default standing spot (x, z)


# The boss stands on a dais at (0, -2) facing +z, toward the party.
BOSS_POS = (0.0, -2.0)

PARTY: tuple[PartyMember, ...] = (
    PartyMember("bramble", "Bramble", "guardian", (0.0, 0.9)),
    PartyMember("lumi", "Lumi", "lightweaver", (0.0, 8.5)),
    PartyMember("grokka", "Grokka", "berserker", (-1.9, -4.9)),
    PartyMember("nyx", "Nyx", "shadowblade", (1.9, -4.9)),
    PartyMember("bao", "Bao", "ranger", (5.5, 7.0)),
)

# The order in which the party takes turns interrupting. A real team agrees
# on this before the pull; our scripted bots do the same.
KICK_ORDER = ("grokka", "nyx", "bao", "bramble")


@dataclass(frozen=True)
class BossDef:
    id: str = "mortisar"
    name: str = "Mortisar, the Hollow King"
    max_hp: int = 1_500_000
    radius: float = 1.6
    model: str = "Skeleton_Warrior"
    melee: tuple[int, int] = (3200, 2000)
    # first cast time and repeat interval, in ms
    timers: dict = field(default_factory=lambda: {
        "requiem_of_bones": (7000, 16000),
        "soul_rend": (11000, 24000),
        "desecrate": (15000, 20000),
    })
    raise_dead_at: tuple[float, ...] = (0.70, 0.35)
    # Per-seed variation: each repeat lands within +/- this fraction of its
    # interval, and each first cast within +/- first_jitter_ms. Overlapping
    # mechanics on some seeds are what make the fight hard to play perfectly.
    timer_jitter: float = 0.25
    first_jitter_ms: int = 3000
    # Hard enrage. Tuned so expert bots kill with ~20 s to spare and a few
    # mistakes (missed kicks, idle time, standing in pools) cost the kill.
    enrage_ms: int = 195_000
    # After the enrage, Hollow Fury hits the whole party every second for
    # base + ramp * n (before the enrage's x4 damage bonus).
    fury_pulse_ms: int = 1000
    fury_pulse_base: int = 1500
    fury_pulse_ramp: int = 750
    desecrate_targets: int = 3
    desecrate_radius: float = 2.2
    desecrate_arm_ms: int = 1000  # a 0.8 s reaction is too slow to dodge cleanly
    desecrate_duration_ms: int = 40000
    desecrate_tick_ms: int = 500


BOSS = BossDef()


@dataclass(frozen=True)
class AddDef:
    name: str = "Risen Bonewalker"
    max_hp: int = 30000
    radius: float = 0.5
    speed: float = 3.5
    model: str = "Skeleton_Minion"
    swing_ms: int = 1500


ADD = AddDef()
CRYPT_DOORS: tuple[tuple[float, float], ...] = ((-12.5, -4.0), (12.5, -4.0), (-9.0, 10.0))

# ---------------------------------------------------------------------------
# Difficulty: two tiers, like a Normal dungeon and a +10 Mythic+ key.
# ---------------------------------------------------------------------------
# Normal is the dungeon with softer numbers. +10 is the tuned dungeon plus three
# affixes that change how it has to be played, not just how big the numbers are.

@dataclass(frozen=True)
class Affix:
    id: str
    name: str
    description: str


AFFIXES: dict[str, Affix] = {a.id: a for a in (
    Affix("restless_graves", "Restless Graves",
          "When an undead enemy other than Mortisar dies, it leaves a Restless Grave on the ground for 12 sec. "
          "The grave heals other undead standing in it by 5% of their health every second, and hurts players "
          "standing in it. Fight enemies away from graves."),
    Affix("marrowburst", "Marrowburst",
          "When an undead enemy other than Mortisar dies, every player gains a stack of Marrow Shards: shadow "
          "damage every second for 4 sec, for each stack. Many kills at once stack it high: stagger kills."),
    Affix("hollow_tyrant", "Hollow Tyrant",
          "Mortisar Summons the Restless three times (at 80%, 50% and 25% health), Desecrates four players "
          "instead of three, and every ~24 sec brands a player with a Grave Mark: after 6 sec it detonates, "
          "hitting the marked player and, much harder, every ally within 6 m of them. Spread out."),
)}


@dataclass(frozen=True)
class Tier:
    id: str
    name: str
    enemy_hp: float  # multiplies every enemy's health
    enemy_dmg: float  # multiplies every enemy's damage
    affixes: tuple[str, ...]
    limit_ms: int  # the dungeon run's timer


TIERS: dict[str, Tier] = {t.id: t for t in (
    Tier("normal", "Normal", 1.0, 0.9, (), 255_000),
    Tier("plus10", "+10", 0.85, 1.15, ("restless_graves", "marrowburst", "hollow_tyrant"), 255_000),
)}
DEFAULT_TIER = "plus10"
TIER_ALIASES = {"normal": "normal", "n": "normal", "plus10": "plus10", "+10": "plus10", "10": "plus10"}

# Affix numbers
GRAVE_RADIUS = 2.5
GRAVE_DURATION_MS = 12_000
GRAVE_TICK_MS = 1_000
GRAVE_HEAL_PCT = 0.05
GRAVE_DAMAGE = 3_500
TYRANT_HP = 1.0
TYRANT_RAISE_AT = (0.80, 0.50, 0.25)
TYRANT_DESECRATE_TARGETS = 4
GRAVE_MARK_FIRST_MS = 16_000  # after the boss is pulled (jittered like his other timers)
GRAVE_MARK_EVERY_MS = 24_000
GRAVE_MARK_RADIUS = 6.0
GRAVE_MARK_SELF = 6_000  # damage to the marked player
GRAVE_MARK_SPLASH = 22_000  # damage to each ally within GRAVE_MARK_RADIUS


def tier(tier_id: str) -> Tier:
    t = TIERS.get(TIER_ALIASES.get(str(tier_id).lower(), str(tier_id)))
    if t is None:
        raise ValueError(f"tier must be one of: normal, +10 (got {tier_id!r})")
    return t


TIME_LIMIT_MS = BOSS.enrage_ms


# ---------------------------------------------------------------------------
# The dungeon run: entrance -> Pack 1 -> corridor -> Pack 2 -> Mortisar
# ---------------------------------------------------------------------------
# The boss room is the original arena (centre (0, 0), radius ARENA_RADIUS). The
# party starts at the far end of the crypt (large +z) and walks toward it.
# Walkable space is a union of circles (rooms) and corridors (axis-aligned
# rectangles along z), so it's easy to describe to a model and to clamp to.

@dataclass(frozen=True)
class Room:
    id: str
    name: str
    center: tuple[float, float]
    radius: float


@dataclass(frozen=True)
class Corridor:
    x_half: float  # half-width
    z_min: float
    z_max: float


@dataclass(frozen=True)
class TrashDef:
    cls: str
    name: str
    max_hp: int
    radius: float
    speed: float
    model: str
    swing_ms: int = 0  # 0 = no melee (a caster)
    spells: tuple[str, ...] = ()  # cast in priority order when off cooldown


@dataclass(frozen=True)
class PackDef:
    id: str
    name: str
    room: str
    members: tuple[tuple[str, tuple[float, float]], ...]  # (trash class, position)


ROOMS: tuple[Room, ...] = (
    Room("boss", "Throne of the Hollow King", (0.0, 0.0), ARENA_RADIUS),
    Room("ossuary", "Ossuary", (0.0, 30.0), 9.0),
    Room("chapel", "Bone Chapel", (0.0, 54.0), 9.0),
    Room("entrance", "Crypt Entrance", (0.0, 84.0), 5.0),
)
CORRIDORS: tuple[Corridor, ...] = (
    Corridor(2.6, 13.0, 23.0),   # boss room <-> ossuary
    Corridor(2.6, 37.0, 47.0),   # ossuary <-> chapel
    Corridor(2.6, 61.0, 80.0),   # chapel <-> entrance
)
ROOMS_BY_ID = {r.id: r for r in ROOMS}
DUNGEON_START = (0.0, 84.0)
# Waypoints from the entrance to the boss room, for the "next" move and the bots.
ROUTE: tuple[tuple[float, float], ...] = (
    (0.0, 84.0), (0.0, 77.0), (0.0, 70.0), (0.0, 63.0), (0.0, 54.0), (0.0, 45.0), (0.0, 39.0), (0.0, 30.0),
    (0.0, 21.0), (0.0, 14.0), (0.0, 6.0),
)

ABILITIES.update({a.id: a for a in (
    Ability("grave_volley", "Grave Volley", "trash", "requiem", school="shadow", cast_ms=2000,
            cooldown_ms=5000, range=40.0, amount=13000, interruptible=True,
            description="A volley of bone shards hits the whole party. Interrupt it."),
    Ability("mend_bones", "Mend Bones", "trash", "raise", school="nature", cast_ms=2000,
            cooldown_ms=5000, range=30.0, interruptible=True,
            description="Restores 30% health to the most injured undead ally. Interrupt it, or kill the Mender first."),
    Ability("bone_bolt", "Bone Bolt", "trash", "claw", school="shadow", cast_ms=1500,
            range=30.0, amount=5000, description="A ranged bolt at the caster's target."),
    Ability("restless_grave", "Restless Grave", "affix", "desecrate", school="shadow", amount=GRAVE_DAMAGE,
            description=AFFIXES["restless_graves"].description),
    Ability("grave_mark", "Grave Mark", "boss", "raise", school="shadow", amount=GRAVE_MARK_SPLASH,
            description="Brands a player; after 6 sec it detonates on everyone within 6 m. Spread out."),
)})

TRASH: dict[str, TrashDef] = {
    "bonewalker": TrashDef("bonewalker", "Risen Bonewalker", 42000, ADD.radius, ADD.speed,
                           ADD.model, swing_ms=ADD.swing_ms),
    "bone_chanter": TrashDef("bone_chanter", "Bone Chanter", 90000, 0.55, 3.0, "Skeleton_Mage",
                             spells=("grave_volley", "bone_bolt")),
    "marrow_mender": TrashDef("marrow_mender", "Marrow Mender", 80000, 0.55, 3.0, "Skeleton_Rogue",
                              spells=("mend_bones", "bone_bolt")),
}
MEND_PCT = 0.30

PACKS: tuple[PackDef, ...] = (
    PackDef("pack1", "Chapel pack", "chapel", (
        ("bonewalker", (-2.5, 52.5)), ("bonewalker", (2.5, 52.5)),
        ("bonewalker", (-1.5, 50.0)), ("bonewalker", (1.5, 50.0)),
        ("bone_chanter", (0.0, 48.0)),
    )),
    PackDef("pack2", "Ossuary pack", "ossuary", (
        ("bonewalker", (-2.5, 28.5)), ("bonewalker", (2.5, 28.5)), ("bonewalker", (0.0, 27.0)),
        ("marrow_mender", (0.0, 24.5)),
    )),
)
AGGRO_RADIUS = 9.0  # a pack attacks when any player comes this close to any member
BOSS_ENGAGE_RADIUS = 13.0  # Mortisar wakes when a player is this close to him
DUNGEON_LIMIT_MS = 270_000  # default run timer; each tier sets its own (Tier.limit_ms)
DEATH_PENALTY_MS = 10_000  # each revive costs this much on the timer (like an M+ death)
REVIVE_AFTER_MS = 3_000  # out of combat this long, fallen allies get back up
REVIVE_HP_PCT = 0.5
OOC_REGEN_PCT_PER_S = 0.04  # out-of-combat health regeneration
# Score weights for a run that doesn't finish: each pack, then the boss.
PROGRESS_WEIGHTS = {"pack1": 0.15, "pack2": 0.15, "boss": 0.70}


def walkable(p: tuple[float, float], margin: float = 0.0) -> bool:
    for r in ROOMS:
        dx, dz = p[0] - r.center[0], p[1] - r.center[1]
        if dx * dx + dz * dz <= (r.radius - 1.0 - margin) ** 2:
            return True
    return any(abs(p[0]) <= c.x_half - margin and c.z_min <= p[1] <= c.z_max for c in CORRIDORS)
