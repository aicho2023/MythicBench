"""Per-pull facts for the site's charts, read from the published replays.

    python3 scripts/build_insights.py                # writes web/public/insights/v1.json

The leaderboard (results/v1/leaderboard.json) has each pull's score. The charts
on the home page also need what happened in it: how much of Oruth was left,
whether the party soaked Bone Pyre, deaths, interrupts and chat. This reads
those from the replays of every memory-on +10 group, so anyone can rebuild the
file from the published data.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "web/public/results/v1"
OUT = ROOT / "web/public/insights/v1.json"


def pull_facts(path: Path) -> dict:
    r = json.loads(gzip.decompress(path.read_bytes()))
    m = r["meta"]["metrics"]
    ev = r["events"]
    pyres = [e for e in ev if e["type"] == "pyre_detonate"]
    first_soak = next((e["t"] for e in pyres if e.get("soaked")), None)
    return {
        "score": m["score"],
        "dur": round(m["duration_s"], 1),
        # Oruth's health when the pull ended; None if the party never reached him.
        "boss": m.get("boss_hp_pct_remaining") if r["meta"].get("boss_engaged_ms") is not None else None,
        "deaths": len(m.get("deaths", [])),
        "pyres": len(pyres),
        "soaked": sum(1 for e in pyres if e.get("soaked")),
        # How many players stood in each Bone Pyre, in order (two or more soak it).
        "pyre_inside": [len(e.get("inside", [])) for e in pyres],
        # What killed each party member who died, by ability id.
        "killed_by": dict(Counter(d.get("ability") or "unknown" for d in m.get("deaths", []))),
        "first_soak_s": round(first_soak / 1000, 1) if first_soak is not None else None,
        "kicks": [m["interrupts"]["interrupted"], m["interrupts"]["interruptible_casts"]],
        "chat": sum(1 for e in ev if e["type"] == "chat"),
    }


def main() -> int:
    board = json.loads((RESULTS / "leaderboard.json").read_text())
    ranked = {row["model"]: set(row["tiers"]["plus10"]["episode_ids"]) for row in board["leaderboard"]}
    out: dict = {"source": "results/v1", "tier": "plus10", "abilities": {}, "models": {}}
    for model in board["protocol"]["models"]:
        folder = RESULTS / "replays" / model / "plus10"
        groups: dict[int, list] = {}
        for f in folder.glob("ep*-pull*.json.gz"):  # memory-on, medium effort only (subfolders hold the rest)
            g, p = map(int, re.match(r"ep(\d+)-pull(\d+)", f.name).groups())
            groups.setdefault(g, []).append((p, pull_facts(f)))
            if not out["abilities"]:  # display names for the killed_by ids
                r = json.loads(gzip.decompress(f.read_bytes()))
                out["abilities"] = {k: v["name"] for k, v in {**r["abilities"], **r.get("auras", {})}.items() if "name" in v}
        out["models"][model] = [
            {"episode": g, "ranked": g in ranked.get(model, set()), "pulls": [{"pull": p, **x} for p, x in sorted(pulls)]}
            for g, pulls in sorted(groups.items())
        ]
        print(model, len(groups), "groups", file=sys.stderr)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print("wrote", OUT.relative_to(ROOT), f"{OUT.stat().st_size // 1024} KB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
