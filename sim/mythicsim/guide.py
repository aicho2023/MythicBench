"""The public game guide: every character, ability, enemy and affix.

Written next to the showcase replays (``generate`` writes ``game.json``) and
read by the site's Party page, so what people read is exactly what the
simulator plays. CI regenerates it, so it can't drift from the game.

The guide shows everything, the boss included. The agents never see it: in a
blind run they start knowing only their own party's kit and the affixes.
"""

from __future__ import annotations

from . import content as C

KIND = {
    "damage": "Damage", "aoe_damage": "Area damage", "heal": "Heal", "hot": "Heal over time",
    "absorb": "Shield", "raid_heal": "Group heal", "buff": "Buff", "interrupt": "Interrupt",
    "taunt": "Taunt", "boss": "Boss ability", "trash": "Enemy spell", "affix": "Affix",
}


def ability(aid: str) -> dict:
    a = C.ABILITIES[aid]
    out = {
        "id": a.id, "name": a.name, "kind": a.kind, "kind_name": KIND.get(a.kind, a.kind), "school": a.school,
        "icon": a.icon, "description": a.description, "cast_s": a.cast_ms / 1000, "cooldown_s": a.cooldown_ms / 1000,
        "on_gcd": a.on_gcd, "interruptible": a.interruptible,
    }
    if a.amount:
        out["amount"] = a.amount
    if a.kind in ("aoe_damage", "taunt") or (a.radius and a.kind not in ("raid_heal",)):
        out["radius_m"] = a.radius
    if a.kind not in ("aoe_damage", "raid_heal", "taunt", "buff", "boss", "trash", "affix"):
        out["range_m"] = a.range
    return out


def game_guide() -> dict:
    party = []
    for m in C.PARTY:
        cd = C.CLASSES[m.cls]
        party.append({
            "id": m.id, "name": m.name, "class": cd.id, "class_name": cd.name, "role": cd.role, "max_hp": cd.max_hp,
            "auto_attack": {"amount": cd.auto_attack[0], "every_s": cd.auto_attack[1] / 1000} if cd.auto_attack else None,
            "abilities": [ability(a) for a in cd.abilities],
        })
    trash = [{"id": d.cls, "name": d.name, "max_hp": d.max_hp, "melee": bool(d.swing_ms),
              "spells": [ability(s) for s in d.spells]} for d in C.TRASH.values()]
    b = C.BOSS
    boss = {"id": b.id, "name": b.name, "max_hp": b.max_hp,
            "abilities": [ability(a) for a in ("hollow_strike", "soul_rend", "requiem_of_bones", "desecrate",
                                               "raise_dead", "grave_mark", "hollow_fury")],
            "adds_at_pct": [int(x * 100) for x in b.raise_dead_at]}
    tiers = [{"id": t.id, "name": t.name, "enemy_hp": t.enemy_hp, "enemy_dmg": t.enemy_dmg,
              "limit_s": t.limit_ms / 1000, "affixes": [{"id": a, "name": C.AFFIXES[a].name,
                                                          "description": C.AFFIXES[a].description} for a in t.affixes]}
             for t in C.TIERS.values()]
    return {"content_version": C.CONTENT_VERSION, "gcd_s": C.GCD_MS / 1000, "melee_range_m": C.MELEE_RANGE,
            "party": party, "trash": trash, "boss": boss, "tiers": tiers}
