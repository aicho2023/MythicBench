"""Command-line entry point.

    python -m mythicsim run --policy expert --seed 7
    python -m mythicsim bench --policy sloppy --runs 200
    python -m mythicsim generate --out ../web/public/replays
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path

from .engine import Encounter
from .metrics import score
from .policies import PROFILES, make_policies

# The showcase replays shipped with the viewer: three reference skill levels on
# one seed, so the only difference between them is decision quality.
SHOWCASE_SEED = 42
SHOWCASE = [
    {"id": "expert-kill", "policy": "expert", "seed": SHOWCASE_SEED,
     "label": "Expert bots", "blurb": "Every kick lands, pools dodged, adds handled. Kills with time to spare."},
    {"id": "competent-enrage", "policy": "competent", "seed": SHOWCASE_SEED,
     "label": "Competent bots", "blurb": "Same fight, same seed. A few missed kicks and slow dodges cost just enough time to hit the enrage."},
    {"id": "sloppy-wipe", "policy": "sloppy", "seed": SHOWCASE_SEED,
     "label": "Sloppy bots", "blurb": "Same fight, same seed. Missed kicks, slow feet, tunnel vision."},
]


def simulate(policy: str, seed: int) -> dict:
    enc = Encounter(seed, make_policies(policy, seed), f"scripted-{policy}")
    return enc.run()


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% confidence interval for a win rate (Wilson score interval)."""
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return round(max(0.0, centre - half), 3), round(min(1.0, centre + half), 3)


def bench(policy: str, runs: int) -> dict:
    """Play seeds 0..runs-1 and report the score and win rate with 95% CIs."""
    if policy not in PROFILES:
        raise SystemExit(f"unknown policy {policy!r}; choose from {', '.join(PROFILES)}")
    scores = [score(simulate(policy, seed)) for seed in range(runs)]
    vals = [s["score"] for s in scores]
    wins = sum(s["outcome"] == "victory" for s in scores)
    times = [s["duration_s"] for s in scores if s["outcome"] == "victory"]
    sd = statistics.stdev(vals) if runs > 1 else 0.0
    half = 1.96 * sd / math.sqrt(runs)
    return {
        "policy": policy, "runs": runs,
        "score_mean": round(statistics.mean(vals), 1),
        "score_ci95": [round(statistics.mean(vals) - half, 1), round(statistics.mean(vals) + half, 1)],
        "win_rate": round(wins / runs, 3), "win_rate_ci95": list(wilson(wins, runs)),
        "mean_kill_time_s": round(statistics.mean(times), 1) if times else None,
        "mean_deaths": round(statistics.mean(len(s["deaths"]) for s in scores), 2),
        "interrupt_rate": round(sum(s["interrupts"]["interrupted"] for s in scores) /
                                max(1, sum(s["interrupts"]["interruptible_casts"] for s in scores)), 3),
    }


def main() -> None:
    ap = argparse.ArgumentParser(prog="mythicsim")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="simulate one encounter and print its score")
    r.add_argument("--policy", choices=PROFILES, default="expert")
    r.add_argument("--seed", type=int, default=7)
    r.add_argument("--out", type=Path, help="also write the replay JSON here")
    b = sub.add_parser("bench", help="simulate many seeds headlessly and aggregate")
    b.add_argument("--policy", default="expert",
                   help=f"one or more of {', '.join(PROFILES)}, comma-separated")
    b.add_argument("--runs", type=int, default=100)
    g = sub.add_parser("generate", help="write the showcase replays for the viewer")
    g.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    if args.cmd == "run":
        rep = simulate(args.policy, args.seed)
        print(json.dumps(score(rep), indent=2))
        if args.out:
            args.out.write_text(json.dumps(rep, separators=(",", ":")))
    elif args.cmd == "bench":
        results = [bench(p, args.runs) for p in args.policy.split(",")]
        print(json.dumps(results[0] if len(results) == 1 else results, indent=2))
    elif args.cmd == "generate":
        args.out.mkdir(parents=True, exist_ok=True)
        index = []
        for spec in SHOWCASE:
            rep = simulate(spec["policy"], spec["seed"])
            s = score(rep)
            rep["meta"]["metrics"] = s
            (args.out / f"{spec['id']}.json").write_text(json.dumps(rep, separators=(",", ":")))
            index.append({**spec, "file": f"{spec['id']}.json", "outcome": s["outcome"],
                          "duration_s": s["duration_s"], "score": s["score"]})
            print(f"{spec['id']}: {s['outcome']} in {s['duration_s']}s, score {s['score']}, "
                  f"{len(s['deaths'])} deaths, kicks {s['interrupts']}")
        (args.out / "index.json").write_text(json.dumps(index, indent=2))


if __name__ == "__main__":
    main()
