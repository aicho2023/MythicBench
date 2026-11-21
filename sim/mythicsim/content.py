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

CONTENT_VERSION = "0.1.0"

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

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "icon": self.icon,
            "harmful": self.harmful,
            "description": self.description,
        }


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
    Ability("hollow_strike", "Hollow Strike", "boss", "sword", school="frost", amount=2600,
            description="Mortisar strikes his current target."),
    Ability("soul_rend", "Soul Rend", "boss", "rend", school="shadow", cast_ms=2000,
            amount=24000, aura="rent_soul",
            description="Tank buster. Massive damage plus a lingering wound. Use a defensive!"),
    Ability("requiem_of_bones", "Requiem of Bones", "boss", "requiem", school="shadow",
            cast_ms=3000, amount=15000, interruptible=True, aura="haunted",
            description="Damages the whole party. INTERRUPT IT."),
    Ability("desecrate", "Desecrate", "boss", "desecrate", school="shadow", amount=3500,
            description="Corrupts the ground beneath three players. Move out!"),
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
    AuraDef("haunted", "Haunted", "requiem", True, 6000, tick_ms=1000, tick_amount=800,
            description="Taking shadow damage every second."),
    AuraDef("hollow_fury", "Hollow Fury", "fury", False, 600000,
            description="Enraged. Damage dealt increased by 300%."),
    AuraDef("taunted", "Taunted", "roar", True, 600000, description="Forced to attack the Guardian."),
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
    melee: tuple[int, int] = (2600, 2000)
    # first cast time and repeat interval, in ms
    timers: dict = field(default_factory=lambda: {
        "requiem_of_bones": (7000, 16000),
        "soul_rend": (11000, 24000),
        "desecrate": (15000, 20000),
    })
    raise_dead_at: tuple[float, ...] = (0.70, 0.35)
    enrage_ms: int = 240_000
    desecrate_targets: int = 3
    desecrate_radius: float = 2.2
    desecrate_arm_ms: int = 1500
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

SIGIL_LEVEL = 12
TIME_LIMIT_MS = 240_000
