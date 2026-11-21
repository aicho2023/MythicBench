"""Score an encounter using ONLY its event log.

This is a deliberate scientific choice: metrics are a pure function of the
published replay file. Anyone can download a replay and re-compute our
numbers without trusting our simulator code or our word.
"""

from __future__ import annotations

from collections import defaultdict


def score(replay: dict) -> dict:
    ev = replay["events"]
    meta = replay["meta"]
    players = {u["id"] for u in replay["units"] if u["kind"] == "player"}
    boss = next(u for u in replay["units"] if u["kind"] == "boss")

    dmg = defaultdict(int)
    heal = defaultdict(int)
    avoidable = defaultdict(int)
    deaths = []
    kick_casts = interrupted = 0
    boss_hp = boss["max_hp"]
    for e in ev:
        t = e["type"]
        if t == "damage":
            if e["source"] in players:
                dmg[e["source"]] += e["amount"]
            if e["target"] == boss["id"]:
                boss_hp = e["hp"]
            if e["ability"] == "desecrate" and e["target"] in players:
                avoidable[e["target"]] += e["amount"] + e["absorbed"]
        elif t == "heal" and e["source"] in players:
            heal[e["source"]] += e["amount"]
        elif t == "death" and e["unit"] in players:
            deaths.append({"unit": e["unit"], "t": e["t"], "ability": e["ability"]})
        elif t == "cast_start" and e["interruptible"]:
            kick_casts += 1
        elif t == "cast_interrupted" and e["reason"] == "interrupt":
            interrupted += 1

    secs = max(1, meta["duration_ms"]) / 1000
    return {
        "outcome": meta["outcome"],
        "duration_s": round(secs, 1),
        "in_time": meta["outcome"] == "victory" and meta["duration_ms"] <= meta["time_limit_ms"],
        "boss_hp_pct_remaining": round(100 * boss_hp / boss["max_hp"], 1),
        "deaths": deaths,
        "interrupts": {"interruptible_casts": kick_casts, "interrupted": interrupted},
        "avoidable_damage_taken": dict(avoidable),
        "damage_done": dict(dmg),
        "dps": {k: round(v / secs) for k, v in dmg.items()},
        "healing_done": dict(heal),
    }
