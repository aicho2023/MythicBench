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
    boss_left = round(100 * boss_hp / boss["max_hp"], 1)
    return {
        "score": run_score(meta["outcome"], secs, boss_left, meta["time_limit_ms"] / 1000),
        "score_version": SCORE_VERSION,
        "outcome": meta["outcome"],
        "duration_s": round(secs, 1),
        "in_time": meta["outcome"] == "victory" and meta["duration_ms"] <= meta["time_limit_ms"],
        "boss_hp_pct_remaining": boss_left,
        "deaths": deaths,
        "interrupts": {"interruptible_casts": kick_casts, "interrupted": interrupted},
        "avoidable_damage_taken": dict(avoidable),
        "damage_done": dict(dmg),
        "dps": {k: round(v / secs) for k, v in dmg.items()},
        "healing_done": dict(heal),
    }


SCORE_VERSION = 2
WIPE_MAX = 70.0  # a wipe earns up to this for boss health removed
KILL_BASE = 70.0  # every kill starts here, so any kill beats any wipe
PAR_TIME_LEFT = 0.25  # full speed points for killing with this share of the timer left


def run_score(outcome: str, duration_s: float, boss_hp_pct_left: float, time_limit_s: float) -> float:
    """The headline number for one pull, on a 0-100 scale.

    * Wipe: up to 70, in proportion to the boss's health removed.
    * Kill: 70, plus up to 30 for speed: the full 30 for killing with a quarter
      (or more) of the timer left, scaled down linearly to 0 at the buzzer.

    70 is the line between a wipe and a kill. Win/loss alone would tie every
    team that wins (or wipes); this keeps separating them at both ends.
    """
    if outcome == "victory":
        left = max(0.0, time_limit_s - duration_s)
        speed = min(1.0, left / (PAR_TIME_LEFT * time_limit_s))
        return round(KILL_BASE + (100.0 - KILL_BASE) * speed, 1)
    return round(WIPE_MAX * (100.0 - boss_hp_pct_left) / 100.0, 1)
