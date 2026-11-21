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
from .llm.clients import REPO_ROOT, CachedClient, ClientError, make_client
from .llm.policy import make_llm_policies
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


def parse_seeds(text: str) -> list[int]:
    out: list[int] = []
    for part in text.split(","):
        a, _, b = part.partition("-")
        out.extend(range(int(a), int(b) + 1) if b else [int(a)])
    return out


def publish_local(rep: dict, model: str, safe: str, seed: int, s: dict) -> None:
    """Copy a model run into the viewer's git-ignored replays/local/ folder."""
    local = REPO_ROOT / "web" / "public" / "replays" / "local"
    local.mkdir(parents=True, exist_ok=True)
    file = f"{safe}-seed-{seed}.json"
    (local / file).write_text(json.dumps(rep, separators=(",", ":")))
    idx_path = local / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else []
    entry = {"id": f"{safe}-seed-{seed}", "policy": f"llm:{model}", "seed": seed,
             "label": f"{model.split(':', 1)[-1]} · seed {seed}",
             "blurb": f"{model} on seed {seed}.", "file": file, "outcome": s["outcome"],
             "duration_s": s["duration_s"], "score": s["score"]}
    idx = [e for e in idx if e["id"] != entry["id"]] + [entry]
    idx_path.write_text(json.dumps(idx, indent=2))


def run_llm(args) -> None:
    """Play each seed with the model, save replays + stats, and print a comparison."""
    seeds = parse_seeds(args.seeds)
    client = make_client(args.model)
    safe = args.model.replace(":", "_").replace("/", "_")
    out_dir = REPO_ROOT / "runs" / safe
    out_dir.mkdir(parents=True, exist_ok=True)
    if not args.no_cache:
        client = CachedClient(client, REPO_ROOT / "runs" / "cache" / f"{safe}.jsonl", offline=args.offline)
    rows = []
    for seed in seeds:
        policies, brain = make_llm_policies(client, interval_ms=args.interval_ms, max_calls=args.max_calls)
        try:
            rep = Encounter(seed, policies, f"llm:{args.model}").run()
        except ClientError as err:
            raise SystemExit(f"seed {seed}: {err}")
        s = score(rep)
        rep["meta"]["metrics"] = s
        (out_dir / f"seed-{seed}.json").write_text(json.dumps(rep, separators=(",", ":")))
        publish_local(rep, args.model, safe, seed, s)
        st = brain.stats.as_dict()
        (out_dir / f"seed-{seed}.stats.json").write_text(json.dumps(st, indent=2))
        refs = {p: score(simulate(p, seed))["score"] for p in ("expert", "competent", "sloppy")}
        rows.append({"seed": seed, "score": s["score"], "outcome": s["outcome"],
                     "duration_s": s["duration_s"], "deaths": len(s["deaths"]),
                     "interrupts": f"{s['interrupts']['interrupted']}/{s['interrupts']['interruptible_casts']}",
                     **{f"ref_{k}": v for k, v in refs.items()}, "stats": st})
        print(f"seed {seed:>3}: {s['outcome']:7s} score {s['score']:6.1f} "
              f"(expert {refs['expert']:.1f}, competent {refs['competent']:.1f}, sloppy {refs['sloppy']:.1f})  "
              f"calls {st['calls']} ({st['cached_calls']} cached), tokens {st['input_tokens']}+{st['output_tokens']}, "
              f"bad replies {st['unusable_replies']}, dropped entries {st['invalid_entries']}, "
              f"api errors {st['api_errors']}", flush=True)
    vals = [r["score"] for r in rows]
    tin = sum(r["stats"]["input_tokens"] for r in rows)
    tout = sum(r["stats"]["output_tokens"] for r in rows)
    summary = {
        "model": args.model, "seeds": seeds, "interval_ms": args.interval_ms,
        "score_mean": round(statistics.mean(vals), 1),
        "score_ci95": ([round(statistics.mean(vals) - 1.96 * statistics.stdev(vals) / math.sqrt(len(vals)), 1),
                        round(statistics.mean(vals) + 1.96 * statistics.stdev(vals) / math.sqrt(len(vals)), 1)]
                       if len(vals) > 1 else None),
        "win_rate": round(sum(r["outcome"] == "victory" for r in rows) / len(rows), 3),
        "reference_means": {p: round(statistics.mean(r[f"ref_{p}"] for r in rows), 1)
                            for p in ("expert", "competent", "sloppy")},
        "calls_per_fight": round(statistics.mean(r["stats"]["calls"] for r in rows), 1),
        "input_tokens_per_fight": round(tin / len(rows)),
        "output_tokens_per_fight": round(tout / len(rows)),
        "provider_cached_input_tokens_per_fight": round(sum(r["stats"]["cache_read_tokens"] for r in rows) / len(rows)),
        "model_seconds_per_fight": round(statistics.mean(r["stats"]["latency_s"] for r in rows), 1),
    }
    if args.price_in is not None and args.price_out is not None:
        summary["usd_per_fight"] = round((tin * args.price_in + tout * args.price_out) / 1e6 / len(rows), 4)
    (out_dir / "summary.json").write_text(json.dumps({"summary": summary, "runs": rows}, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"replays and stats: {out_dir}")
    print("watch them: cd web && npm run dev, then pick from 'Model runs' in the top bar")


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
    m = sub.add_parser("llm", help="let a language model play; compares it to the reference bots")
    m.add_argument("--model", required=True,
                   help="provider:model, e.g. anthropic:claude-haiku-5-5, openai:<model>, or mock:basic")
    m.add_argument("--seeds", default="0-4", help="e.g. 0-4 or 3,7,11 (default 0-4)")
    m.add_argument("--interval-ms", type=int, default=2000, help="routine decision interval in game time")
    m.add_argument("--max-calls", type=int, default=300, help="safety cap on model calls per fight")
    m.add_argument("--offline", action="store_true", help="only use recorded replies (no API calls)")
    m.add_argument("--no-cache", action="store_true", help="don't record or reuse replies")
    m.add_argument("--price-in", type=float, help="USD per 1M input tokens (to estimate cost)")
    m.add_argument("--price-out", type=float, help="USD per 1M output tokens")
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
    elif args.cmd == "llm":
        run_llm(args)
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
