"""Command-line entry point.

    python -m mythicsim run --policy expert --seed 7
    python -m mythicsim bench --policy sloppy --runs 200
    python -m mythicsim generate --out ../web/public/replays
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .engine import Encounter
from .metrics import score
from .policies import PROFILES, make_policies

# The two showcase replays shipped with the viewer.
SHOWCASE = [
    {"id": "expert-kill", "policy": "expert", "seed": 2,
     "label": "Expert bots", "blurb": "Disciplined kick rotation, clean dodges, swaps to adds."},
    {"id": "sloppy-wipe", "policy": "sloppy", "seed": 2,
     "label": "Sloppy bots", "blurb": "Same fight, same seed. Missed kicks, slow feet, tunnel vision."},
]


def simulate(policy: str, seed: int) -> dict:
    enc = Encounter(seed, make_policies(policy, seed), f"scripted-{policy}")
    return enc.run()


def main() -> None:
    ap = argparse.ArgumentParser(prog="mythicsim")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="simulate one encounter and print its score")
    r.add_argument("--policy", choices=PROFILES, default="expert")
    r.add_argument("--seed", type=int, default=7)
    r.add_argument("--out", type=Path, help="also write the replay JSON here")
    b = sub.add_parser("bench", help="simulate many seeds headlessly and aggregate")
    b.add_argument("--policy", choices=PROFILES, default="expert")
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
        wins, times, deaths = 0, [], 0
        for seed in range(args.runs):
            s = score(simulate(args.policy, seed))
            wins += s["outcome"] == "victory"
            deaths += len(s["deaths"])
            if s["outcome"] == "victory":
                times.append(s["duration_s"])
        print(json.dumps({
            "policy": args.policy, "runs": args.runs, "win_rate": wins / args.runs,
            "mean_kill_time_s": round(sum(times) / len(times), 1) if times else None,
            "mean_deaths": round(deaths / args.runs, 2),
        }, indent=2))
    elif args.cmd == "generate":
        args.out.mkdir(parents=True, exist_ok=True)
        index = []
        for spec in SHOWCASE:
            rep = simulate(spec["policy"], spec["seed"])
            s = score(rep)
            rep["meta"]["metrics"] = s
            (args.out / f"{spec['id']}.json").write_text(json.dumps(rep, separators=(",", ":")))
            index.append({**spec, "file": f"{spec['id']}.json", "outcome": s["outcome"],
                          "duration_s": s["duration_s"]})
            print(f"{spec['id']}: {s['outcome']} in {s['duration_s']}s, "
                  f"{len(s['deaths'])} deaths, kicks {s['interrupts']}")
        (args.out / "index.json").write_text(json.dumps(index, indent=2))


if __name__ == "__main__":
    main()
