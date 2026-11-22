"""After-action report for one pull, built from the event log alone.

This is what a raider would get from a combat-log tool after a wipe: who died
to what, what hit the party hardest, what the boss cast and whether it was
stopped, how adds were handled, and who stood in bad. It is factual (no advice)
so a model has to draw its own conclusions, and it is a pure function of the
replay so anyone can reproduce exactly what the model was shown.
"""

from __future__ import annotations

from collections import defaultdict


# Seconds of standing in a pool that each damage tick represents.
POOL_TICK_S = {"desecrate": 0.5, "restless_grave": 1.0}

def _name(replay: dict, ability: str) -> str:
    a = replay["abilities"].get(ability) or replay["auras"].get(ability)
    return a["name"] if a else ability.replace("_", " ")


def _t(ms: int) -> str:
    s = ms / 1000
    return f"{int(s // 60)}:{s % 60:04.1f}"


def debrief_data(replay: dict) -> dict:
    meta, ev = replay["meta"], replay["events"]
    units = {u["id"]: u for u in replay["units"]}
    players = {u["id"] for u in replay["units"] if u["kind"] == "player"}
    boss = next(u for u in replay["units"] if u["kind"] == "boss")
    boss_hp = boss["max_hp"]
    taken = defaultdict(lambda: defaultdict(int))  # player -> ability -> damage (incl. absorbed)
    recent = defaultdict(list)  # player -> [(t, ability, amount)] for death recaps
    deaths, casts, adds = [], [], {}
    interrupts_used = defaultdict(int)
    open_casts: dict[str, dict] = {}
    pool_secs = defaultdict(float)
    enraged_at = None
    for e in ev:
        t = e["type"]
        if t == "spawn":
            units[e["unit"]["id"]] = e["unit"]
            if e["unit"]["kind"] == "add":
                adds[e["unit"]["id"]] = {"spawn": e["t"], "death": None, "dealt": 0, "targets": set()}
        elif t == "damage":
            if e["target"] == boss["id"]:
                boss_hp = e["hp"]
            if e["target"] in players:
                amt = e["amount"] + e.get("absorbed", 0)
                taken[e["target"]][e["ability"]] += amt
                recent[e["target"]].append((e["t"], e["ability"], amt))
                if e["ability"] in POOL_TICK_S:
                    pool_secs[e["target"]] += POOL_TICK_S[e["ability"]]
                if e["source"] in adds:
                    adds[e["source"]]["dealt"] += amt
                    adds[e["source"]]["targets"].add(e["target"])
        elif t == "death":
            if e["unit"] in players:
                window = [(a, n) for (tt, a, n) in recent[e["unit"]] if e["t"] - tt <= 5000]
                top = defaultdict(int)
                for a, n in window:
                    top[a] += n
                deaths.append({"unit": e["unit"], "t": e["t"], "ability": e.get("ability"),
                               "last5s": sorted(top.items(), key=lambda kv: -kv[1])[:3]})
            elif e["unit"] in adds:
                adds[e["unit"]]["death"] = e["t"]
        elif t == "cast_start" and e["unit"] == boss["id"]:
            c = {"t": e["t"], "ability": e["ability"], "interruptible": e["interruptible"], "result": "completed",
                 "by": None}
            casts.append(c)
            open_casts[e["unit"]] = c
        elif t == "cast_interrupted" and e["unit"] == boss["id"] and e["unit"] in open_casts:
            c = open_casts.pop(e["unit"])
            c["result"] = "interrupted" if e["reason"] == "interrupt" else "cancelled"
            c["by"] = e.get("by")
        elif t == "cast_success":
            if e["unit"] == boss["id"]:
                if e["ability"] in ("hollow_strike",):
                    continue
                if e["unit"] in open_casts and open_casts[e["unit"]]["ability"] == e["ability"]:
                    open_casts.pop(e["unit"])
                else:  # an instant boss ability (no cast bar)
                    casts.append({"t": e["t"], "ability": e["ability"], "interruptible": False,
                                  "result": "instant", "by": None})
            elif e["unit"] in players and (replay["abilities"].get(e["ability"]) or {}).get("kind") == "interrupt":
                interrupts_used[e["unit"]] += 1
        elif t == "aura_apply" and e["unit"] == boss["id"] and e["aura"] == "hollow_fury" and enraged_at is None:
            enraged_at = e["t"]
    kicks_landed = defaultdict(int)  # on any target (boss and dungeon trash)
    for e in ev:
        if e["type"] == "cast_interrupted" and e["reason"] == "interrupt" and e.get("by") in players:
            kicks_landed[e["by"]] += 1
    return {
        "outcome": meta["outcome"], "duration_ms": meta["duration_ms"],
        "boss_hp_pct_left": round(100 * boss_hp / boss["max_hp"], 1),
        "deaths": deaths, "taken": {p: dict(v) for p, v in taken.items()}, "casts": casts,
        "adds": adds, "pool_seconds": dict(pool_secs),
        "interrupts_used": dict(interrupts_used), "interrupts_landed": dict(kicks_landed),
        "enraged_at": enraged_at, "names": {k: u["name"] for k, u in units.items()},
    }


def debrief_text(replay: dict) -> str:
    d = debrief_data(replay)
    nm = d["names"]
    who = lambda uid: nm.get(uid, uid)  # noqa: E731
    out = []
    if d["outcome"] == "victory":
        out.append(f"RESULT: Mortisar defeated at {_t(d['duration_ms'])}.")
        meta = replay["meta"]
        timer = meta["duration_ms"] + meta.get("penalty_ms", 0)
        if timer > meta["time_limit_ms"]:
            out.append(f"The run timer read {_t(timer)}, past the {_t(meta['time_limit_ms'])} limit: the run was not "
                       "completed in time, so it does not count as a clear.")
    else:
        out.append(f"RESULT: party wiped at {_t(d['duration_ms'])} with Mortisar at {d['boss_hp_pct_left']}% health.")
    if d["enraged_at"] is not None:
        out.append(f"At {_t(d['enraged_at'])} Mortisar gained Hollow Fury (enraged).")

    out.append("\nDEATHS:" if d["deaths"] else "\nDEATHS: none.")
    for x in d["deaths"]:
        recap = ", ".join(f"{_name(replay, a)} {n:,}" for a, n in x["last5s"])
        out.append(f"  {_t(x['t'])} {who(x['unit'])} died to {_name(replay, x['ability'])}"
                   + (f" (damage taken in the last 5 s: {recap})" if recap else "") + ".")

    out.append("\nDAMAGE TAKEN BY SOURCE (whole party, absorbed included):")
    total = defaultdict(int)
    for per in d["taken"].values():
        for a, n in per.items():
            total[a] += n
    for a, n in sorted(total.items(), key=lambda kv: -kv[1])[:8]:
        hit = sorted(((p, per.get(a, 0)) for p, per in d["taken"].items() if per.get(a)), key=lambda kv: -kv[1])
        out.append(f"  {_name(replay, a)}: {n:,}  (" + ", ".join(f"{who(p)} {v:,}" for p, v in hit[:5]) + ")")

    out.append("\nMORTISAR'S ABILITIES OBSERVED:")
    by_ability = defaultdict(list)
    for c in d["casts"]:
        by_ability[c["ability"]].append(c)
    for a, cs in by_ability.items():
        times = ", ".join(_t(c["t"]) for c in cs[:12]) + (" ..." if len(cs) > 12 else "")
        if cs[0]["result"] == "instant":
            out.append(f"  {_name(replay, a)}: instant, {len(cs)}x at {times}.")
            continue
        kicked = sum(c["result"] == "interrupted" for c in cs)
        kind = "interruptible" if cs[0]["interruptible"] else "not interruptible"
        out.append(f"  {_name(replay, a)}: cast bar, {kind}, {len(cs)}x at {times}"
                   + (f"; interrupted {kicked}/{len(cs)}" if cs[0]["interruptible"] else "") + ".")

    if d["interrupts_used"]:
        out.append("\nYOUR INTERRUPTS: " + "; ".join(
            f"{who(p)} used {n}, landed {d['interrupts_landed'].get(p, 0)}" for p, n in sorted(d["interrupts_used"].items())) + ".")

    if d["adds"]:
        alive_for = [((a["death"] if a["death"] is not None else d["duration_ms"]) - a["spawn"]) / 1000 for a in d["adds"].values()]
        waves = sorted({_t(a["spawn"]) for a in d["adds"].values()})
        killed = sum(a["death"] is not None for a in d["adds"].values())
        targets = sorted({who(t) for a in d["adds"].values() for t in a["targets"]})
        dealt = sum(a["dealt"] for a in d["adds"].values())
        out.append(f"\nADDS: {len(d['adds'])} Risen Bonewalkers appeared (at {', '.join(waves)}); {killed} killed; "
                   f"alive {sum(alive_for) / len(alive_for):.0f} s on average; they dealt {dealt:,} damage, "
                   f"to {', '.join(targets) or 'nobody'}.")

    if meta_mode(replay) == "dungeon":
        out.append("\n" + dungeon_lines(replay))

    if d["pool_seconds"]:
        out.append("\nTIME STANDING IN DESECRATE POOLS: " + ", ".join(
            f"{who(p)} {s:g} s" for p, s in sorted(d["pool_seconds"].items(), key=lambda kv: -kv[1])) + ".")
    return "\n".join(out)


def meta_mode(replay: dict) -> str:
    return replay["meta"].get("mode", "boss")


def dungeon_lines(replay: dict) -> str:
    """Trash pulls, clears, caster casts (and how many were stopped), revives."""
    ev = replay["events"]
    packs = {p["id"]: p for p in replay["arena"].get("packs", [])}
    names = {u["id"]: u["name"] for u in replay["units"]}
    trash = {u["id"] for u in replay["units"] if u.get("pack")}
    out = ["DUNGEON:"]
    pulls = {e["pack"]: e["t"] for e in ev if e["type"] == "pull"}
    clears = {e["pack"]: e["t"] for e in ev if e["type"] == "pack_cleared"}
    for pid, p in packs.items():
        if pid not in pulls:
            out.append(f"  {p['name']}: never pulled.")
            continue
        took = f"cleared at {_t(clears[pid])} ({(clears[pid] - pulls[pid]) / 1000:.0f} s)" if pid in clears else "not cleared"
        out.append(f"  {p['name']}: pulled at {_t(pulls[pid])}, {took}.")
    if "boss" in pulls:
        out.append(f"  Mortisar pulled at {_t(pulls['boss'])}.")
    casts: dict[str, list] = {}
    open_c = {}
    for e in ev:
        if e["type"] == "cast_start" and e["unit"] in trash:
            c = {"ability": e["ability"], "kicked": False, "interruptible": e["interruptible"]}
            casts.setdefault(e["ability"], []).append(c)
            open_c[e["unit"]] = c
        elif e["type"] == "cast_interrupted" and e["unit"] in open_c and e["reason"] == "interrupt":
            open_c.pop(e["unit"])["kicked"] = True
    for a, cs in casts.items():
        if not cs[0]["interruptible"]:
            continue
        out.append(f"  Trash cast {_name(replay, a)}: {len(cs)}x, interrupted {sum(c['kicked'] for c in cs)}.")
    revs = [e for e in ev if e["type"] == "revive"]
    if revs:
        out.append(f"  Revives: {len(revs)} ({', '.join(names.get(e['unit'], e['unit']) for e in revs)}), "
                   f"+{sum(e['penalty_ms'] for e in revs) / 1000:g} s on the timer.")
    return "\n".join(out)
