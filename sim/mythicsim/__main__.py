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

from . import content as C
from . import runs as runs_mod
from .engine import SIM_VERSION, Encounter
from .llm import HARNESS_VERSION, prompt_hash
from .llm.clients import CachedClient, ClientError, make_client
from .llm.policy import make_llm_policies
from .metrics import score
from .policies import PROFILES, make_policies

# The showcase replays shipped with the viewer: three reference skill levels on
# one seed, so the only difference between them is decision quality.
SHOWCASE_SEED = 42
SHOWCASE = [
    {"id": "expert-clear", "policy": "expert", "seed": SHOWCASE_SEED, "mode": "dungeon",
     "label": "Expert bots", "blurb": "Clean pulls, casters first, every kick lands. Clears the crypt with time to spare."},
    {"id": "competent-run", "policy": "competent", "seed": SHOWCASE_SEED, "mode": "dungeon",
     "label": "Competent bots", "blurb": "Same run, same seed. A few missed kicks and slow dodges, and the clock gets tight."},
    {"id": "sloppy-wipe", "policy": "sloppy", "seed": SHOWCASE_SEED, "mode": "dungeon",
     "label": "Sloppy bots", "blurb": "Same run, same seed. Missed kicks, tunnel vision, standing in the bad."},
]


MODES = ("dungeon", "boss")


def simulate(policy: str, seed: int, level: int = C.SIGIL_LEVEL, mode: str = "boss") -> dict:
    """One scripted-bot run. ``mode="dungeon"`` plays the full run (trash, then boss)."""
    if mode == "dungeon":
        from .dungeon import DungeonRun
        from .policies import make_dungeon_policies
        return DungeonRun(seed, make_dungeon_policies(policy, seed), f"scripted-{policy}", level).run()
    enc = Encounter(seed, make_policies(policy, seed), f"scripted-{policy}", level)
    return enc.run()


def make_encounter(seed: int, policies, label: str, level: int, mode: str):
    if mode == "dungeon":
        from .dungeon import DungeonRun
        return DungeonRun(seed, policies, label, level)
    return Encounter(seed, policies, label, level)


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% confidence interval for a win rate (Wilson score interval)."""
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return round(max(0.0, centre - half), 3), round(min(1.0, centre + half), 3)


def bench(policy: str, runs: int, level: int = C.SIGIL_LEVEL, mode: str = "boss") -> dict:
    """Play seeds 0..runs-1 and report the score and win rate with 95% CIs."""
    if policy not in PROFILES:
        raise SystemExit(f"unknown policy {policy!r}; choose from {', '.join(PROFILES)}")
    scores = [score(simulate(policy, seed, level, mode)) for seed in range(runs)]
    vals = [s["score"] for s in scores]
    wins = sum(s["outcome"] == "victory" for s in scores)
    times = [s["duration_s"] for s in scores if s["outcome"] == "victory"]
    sd = statistics.stdev(vals) if runs > 1 else 0.0
    half = 1.96 * sd / math.sqrt(runs)
    return {
        "policy": policy, "runs": runs, "level": level, "mode": mode,
        "score_mean": round(statistics.mean(vals), 1),
        "score_ci95": [round(statistics.mean(vals) - half, 1), round(statistics.mean(vals) + half, 1)],
        "win_rate": round(wins / runs, 3), "win_rate_ci95": list(wilson(wins, runs)),
        "mean_kill_time_s": round(statistics.mean(times), 1) if times else None,
        "mean_deaths": round(statistics.mean(len(s["deaths"]) for s in scores), 2),
        "interrupt_rate": round(sum(s["interrupts"]["interrupted"] for s in scores) /
                                max(1, sum(s["interrupts"]["interruptible_casts"] for s in scores)), 3),
    }


LEVEL_NAMES = {"normal": 4, "heroic": 8, "mythic": 12}


def parse_level(text: str) -> int:
    lvl = LEVEL_NAMES.get(str(text).lower().lstrip("+"), None)
    lvl = lvl if lvl is not None else int(str(text).lstrip("+"))
    C.level_multiplier(lvl)  # validates the range
    return lvl


def parse_seeds(text: str) -> list[int]:
    out: list[int] = []
    for part in text.split(","):
        a, _, b = part.partition("-")
        out.extend(range(int(a), int(b) + 1) if b else [int(a)])
    return out


def play_llm_seed(client, seed: int, args, label: str, run) -> tuple[dict, dict]:
    policies, brain = make_llm_policies(client, interval_ms=args.interval_ms, max_calls=args.max_calls,
                                        level=args.level, mode=args.mode)
    rep = make_encounter(seed, policies, f"llm:{label}", args.level, args.mode).run()
    s = score(rep)
    rep["meta"]["metrics"] = s
    rep["meta"]["run"] = {k: run.manifest.get(k) for k in
                          ("run_id", "name", "label", "model", "effort", "harness_version", "prompt_hash")}
    run.replay_path(seed).write_text(json.dumps(rep, separators=(",", ":")))
    st = brain.stats.as_dict()
    (run.seeds_dir / f"seed-{seed}.stats.json").write_text(json.dumps(st, indent=2))
    return rep, st


def run_llm(args) -> None:
    """Play each seed with the model into a new run folder, then print a comparison."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    seeds = parse_seeds(args.seeds)
    client = make_client(args.model, args.effort)
    label = client.spec  # includes @effort when set
    safe = label.replace(":", "_").replace("/", "_").replace("@", "_")
    if not args.no_cache:
        client = CachedClient(client, runs_mod.RUNS_DIR / "cache" / f"{safe}.jsonl", offline=args.offline)
    run = runs_mod.new_run(label, mode="single", name=args.name, tags=args.tag, config={
        "seeds": seeds, "interval_ms": args.interval_ms, "max_calls": args.max_calls, "level": args.level,
        "dungeon_mode": args.mode,
        "harness_version": HARNESS_VERSION, "prompt_hash": prompt_hash("full", args.level, args.mode),
        "sim_version": SIM_VERSION, "content_version": C.CONTENT_VERSION,
        "offline": args.offline, "cache": not args.no_cache,
    })
    print(f"run {run.run_id}", flush=True)
    rows = []
    # Fights are independent and mostly wait on the API, so seeds can run in
    # parallel threads; each fight's own result is unaffected.
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(play_llm_seed, client, seed, args, label, run): seed for seed in seeds}
        for fut in as_completed(futures):
            seed = futures[fut]
            try:
                rep, st = fut.result()
            except ClientError as err:
                for f in futures:
                    f.cancel()
                run.manifest.update(status="failed", error=str(err)[:500])
                run.save_manifest()
                raise SystemExit(f"seed {seed}: {err}")
            s = rep["meta"]["metrics"]
            refs = {p: score(simulate(p, seed, args.level, args.mode))["score"] for p in ("expert", "competent", "sloppy")}
            rows.append({"seed": seed, "score": s["score"], "outcome": s["outcome"],
                         "duration_s": s["duration_s"], "deaths": len(s["deaths"]),
                         "interrupts": f"{s['interrupts']['interrupted']}/{s['interrupts']['interruptible_casts']}",
                         **{f"ref_{k}": v for k, v in refs.items()}, "stats": st})
            print(f"seed {seed:>3}: {s['outcome']:7s} score {s['score']:6.1f} "
                  f"(expert {refs['expert']:.1f}, competent {refs['competent']:.1f}, sloppy {refs['sloppy']:.1f})  "
                  f"calls {st['calls']} ({st['cached_calls']} cached), tokens {st['input_tokens']}+{st['output_tokens']}, "
                  f"bad replies {st['unusable_replies']} ({st['truncated_replies']} cut off), dropped entries {st['invalid_entries']}, "
                  f"api errors {st['api_errors']}", flush=True)
    rows.sort(key=lambda r: r["seed"])
    vals = [r["score"] for r in rows]
    tin = sum(r["stats"]["input_tokens"] for r in rows)
    tout = sum(r["stats"]["output_tokens"] for r in rows)
    summary = {
        "model": label, "seeds": seeds, "interval_ms": args.interval_ms,
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
    items = [{"seed": r["seed"], "file": f"seeds/seed-{r['seed']}.json", "outcome": r["outcome"],
              "score": r["score"], "duration_s": r["duration_s"]} for r in rows]
    runs_mod.finish_run(run, summary, items)
    runs_mod.publish(only=[run.run_id])
    print(json.dumps(summary, indent=2))
    print(f"run {run.run_id}: {run.dir}")
    print("watch it: cd web && npm run dev, then open Runs in the top bar")


def run_progress(args) -> None:
    """Learning over pulls: episodes of repeated attempts with notes between pulls."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from .llm.progress import run_episode, summarize
    episodes = parse_seeds(args.episodes)
    memory = args.memory == "on"
    client = make_client(args.model, args.effort)
    label = client.spec
    safe = label.replace(":", "_").replace("/", "_").replace("@", "_")
    if not args.no_cache:
        client = CachedClient(client, runs_mod.RUNS_DIR / "cache" / f"{safe}.jsonl", offline=args.offline)
    run = runs_mod.new_run(label, mode="progression", name=args.name, tags=args.tag, config={
        "episodes": episodes, "max_pulls": args.max_pulls, "memory": memory, "knowledge": args.knowledge,
        "interval_ms": args.interval_ms, "max_calls": args.max_calls, "level": args.level, "dungeon_mode": args.mode,
        "harness_version": HARNESS_VERSION, "prompt_hash": prompt_hash(args.knowledge, args.level, args.mode),
        "sim_version": SIM_VERSION, "content_version": C.CONTENT_VERSION,
        "offline": args.offline, "cache": not args.no_cache,
    })
    print(f"run {run.run_id}  (+{args.level} key, {args.knowledge} knowledge, memory {args.memory}, "
          f"up to {args.max_pulls} pulls)", flush=True)

    def on_pull(ep, pr):
        d = run.dir / "episodes" / str(ep.episode)
        d.mkdir(parents=True, exist_ok=True)
        pr.replay["meta"]["run"] = {k: run.manifest.get(k) for k in
                                    ("run_id", "name", "label", "model", "effort", "harness_version", "prompt_hash")}
        (d / f"pull-{pr.pull}.json").write_text(json.dumps(pr.replay, separators=(",", ":")))
        (d / f"pull-{pr.pull}.stats.json").write_text(json.dumps(pr.stats, indent=2))
        (d / f"notes-after-{pr.pull}.md").write_text(pr.notes_after)
        m = pr.metrics
        print(f"episode {ep.episode:>2} pull {pr.pull}: {m['outcome']:7s} score {m['score']:6.1f}  "
              f"deaths {len(m['deaths'])}  calls {pr.stats['calls']}  "
              f"tokens {pr.stats['input_tokens']}+{pr.stats['output_tokens']}"
              + (f"  [{pr.problem}]" if pr.problem else ""), flush=True)

    results = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(run_episode, client, e, max_pulls=args.max_pulls, memory=memory,
                               knowledge=args.knowledge, interval_ms=args.interval_ms,
                               max_calls=args.max_calls, level=args.level, mode=args.mode,
                               on_pull=on_pull): e for e in episodes}
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except ClientError as err:
                for f in futures:
                    f.cancel()
                run.manifest.update(status="failed", error=str(err)[:500])
                run.save_manifest()
                raise SystemExit(f"episode {futures[fut]}: {err}")
    results.sort(key=lambda e: e.episode)
    summary = summarize(results, args.max_pulls)
    items = [{"episode": e.episode, "pull": p.pull, "seed": p.seed, "file": f"episodes/{e.episode}/pull-{p.pull}.json",
              "outcome": p.metrics["outcome"], "score": p.metrics["score"], "duration_s": p.metrics["duration_s"]}
             for e in results for p in e.pulls]
    runs_mod.finish_run(run, summary, items)
    runs_mod.publish(only=[run.run_id])
    print(json.dumps({k: v for k, v in summary.items() if k not in ("score_mean", "win_rate")}, indent=2))
    print(f"run {run.run_id}: {run.dir}")


def run_runs(args) -> None:
    """Manage saved model runs."""
    if args.runs_cmd == "list":
        ms = runs_mod.filter_runs(runs_mod.load_manifests(), args.model, args.tag, args.effort)[: args.last]
        if not ms:
            print("no runs")
        for m in ms:
            s = m.get("summary") or {}
            n = len(m.get("items") or [])
            mean = s.get("score_mean")
            print(f"{m['run_id']:<52} {m.get('status', '?'):7s} {m.get('mode', ''):11s} "
                  f"{n:>3} {'pulls' if m.get('mode') == 'progression' else 'seeds'}  +{m.get('level') or 12:<3} "
                  f"score {mean if mean is not None else '-':>6}  "
                  f"harness {m.get('harness_version')}  {m.get('name') or ''} {' '.join('#' + t for t in m.get('tags') or [])}")
    elif args.runs_cmd == "show":
        print(json.dumps(runs_mod.find_run(args.run), indent=2))
    elif args.runs_cmd == "rm":
        m = runs_mod.find_run(args.run)
        runs_mod.remove_run(m["run_id"])
        runs_mod.publish(only=[])
        print(f"removed {m['run_id']}")
    elif args.runs_cmd == "publish":
        only = None if args.all or not args.runs else [runs_mod.find_run(r)["run_id"] for r in args.runs]
        n = runs_mod.publish(only=only)
        print(f"catalog: {n} runs -> {runs_mod.LOCAL_REPLAYS / 'catalog.json'}")
    elif args.runs_cmd == "rescore":
        n = runs_mod.rescore()
        runs_mod.publish(only=None)
        print(f"rescored {n} replays with the current scoring and refreshed the catalog")
    elif args.runs_cmd == "import-legacy":
        made = runs_mod.import_legacy()
        runs_mod.publish()
        print(f"imported {len(made)} legacy runs" + "".join(f"\n  {r}" for r in made))


def main() -> None:
    ap = argparse.ArgumentParser(prog="mythicsim")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="simulate one encounter and print its score")
    r.add_argument("--policy", choices=PROFILES, default="expert")
    r.add_argument("--seed", type=int, default=7)
    r.add_argument("--out", type=Path, help="also write the replay JSON here")
    r.add_argument("--mode", choices=MODES, default="dungeon",
                     help="dungeon (default): trash packs then the boss; boss: the boss fight alone")
    r.add_argument("--level", type=parse_level, default=C.SIGIL_LEVEL,
                     help="key level 2-30, or normal/heroic/mythic (= +4/+8/+12). Default +12")
    b = sub.add_parser("bench", help="simulate many seeds headlessly and aggregate")
    b.add_argument("--policy", default="expert",
                   help=f"one or more of {', '.join(PROFILES)}, comma-separated")
    b.add_argument("--runs", type=int, default=100)
    b.add_argument("--mode", choices=MODES, default="dungeon",
                     help="dungeon (default): trash packs then the boss; boss: the boss fight alone")
    b.add_argument("--level", type=parse_level, default=C.SIGIL_LEVEL,
                     help="key level 2-30, or normal/heroic/mythic (= +4/+8/+12). Default +12")
    m = sub.add_parser("llm", help="let a language model play; compares it to the reference bots")
    m.add_argument("--model", required=True,
                   help="provider:model, e.g. anthropic:claude-haiku-5-5, openai:<model>, or mock:basic")
    m.add_argument("--seeds", default="0-4", help="e.g. 0-4 or 3,7,11 (default 0-4)")
    m.add_argument("--interval-ms", type=int, default=2000, help="routine decision interval in game time")
    m.add_argument("--max-calls", type=int, default=300, help="safety cap on model calls per fight")
    m.add_argument("--mode", choices=MODES, default="dungeon",
                     help="dungeon (default): trash packs then the boss; boss: the boss fight alone")
    m.add_argument("--level", type=parse_level, default=C.SIGIL_LEVEL,
                     help="key level 2-30, or normal/heroic/mythic (= +4/+8/+12). Default +12")
    m.add_argument("--offline", action="store_true", help="only use recorded replies (no API calls)")
    m.add_argument("--no-cache", action="store_true", help="don't record or reuse replies")
    m.add_argument("--effort", choices=("none", "low", "medium", "high"),
                   help="thinking/reasoning effort (default: the provider's own default). "
                        "Also accepted as provider:model@effort. Each effort is a separate configuration")
    m.add_argument("--workers", type=int, default=1, help="seeds to play in parallel (default 1)")
    m.add_argument("--name", help="a human name for this run, e.g. 'haiku baseline'")
    m.add_argument("--tag", action="append", default=[], help="label for filtering (repeatable)")
    m.add_argument("--price-in", type=float, help="USD per 1M input tokens (to estimate cost)")
    m.add_argument("--price-out", type=float, help="USD per 1M output tokens")
    pg = sub.add_parser("progress", help="learning over pulls: repeated attempts with notes between pulls")
    pg.add_argument("--model", required=True, help="provider:model[@effort], or mock:basic")
    pg.add_argument("--effort", choices=("none", "low", "medium", "high"))
    pg.add_argument("--episodes", default="0", help="episode numbers, e.g. 0-4 (each is an independent attempt series)")
    pg.add_argument("--max-pulls", type=int, default=8)
    pg.add_argument("--mode", choices=MODES, default="dungeon",
                     help="dungeon (default): trash packs then the boss; boss: the boss fight alone")
    pg.add_argument("--level", type=parse_level, default=C.SIGIL_LEVEL,
                     help="key level 2-30, or normal/heroic/mythic (= +4/+8/+12). Default +12")
    pg.add_argument("--memory", choices=("on", "off"), default="on",
                    help="off = control condition: notes are wiped between pulls")
    pg.add_argument("--knowledge", choices=("blind", "full"), default="blind",
                    help="blind (default): nothing about the boss is given up front")
    pg.add_argument("--interval-ms", type=int, default=2000)
    pg.add_argument("--max-calls", type=int, default=300)
    pg.add_argument("--workers", type=int, default=1, help="episodes to play in parallel")
    pg.add_argument("--offline", action="store_true")
    pg.add_argument("--no-cache", action="store_true")
    pg.add_argument("--name")
    pg.add_argument("--tag", action="append", default=[])
    rs = sub.add_parser("runs", help="list, inspect, remove, and publish saved model runs")
    rsub = rs.add_subparsers(dest="runs_cmd", required=True)
    rl = rsub.add_parser("list", help="newest first")
    rl.add_argument("--model", help="substring of provider:model@effort")
    rl.add_argument("--tag")
    rl.add_argument("--effort", help="none/low/medium/high, or 'default'")
    rl.add_argument("--last", type=int, default=50)
    rsub.add_parser("show", help="print a run's manifest").add_argument("run", help="run id or unique part of it")
    rsub.add_parser("rm", help="delete a run").add_argument("run", help="run id or unique part of it")
    rp = rsub.add_parser("publish", help="copy runs into the viewer and rebuild its catalog")
    rp.add_argument("runs", nargs="*", help="run ids (default: refresh the catalog only)")
    rp.add_argument("--all", action="store_true", help="copy every run's replays")
    rsub.add_parser("import-legacy", help="convert old runs/<model>/ folders into run folders")
    rsub.add_parser("rescore", help="recompute every saved run's scores with the current scoring")
    g = sub.add_parser("generate", help="write the showcase replays for the viewer")
    g.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    if args.cmd == "run":
        rep = simulate(args.policy, args.seed, args.level, args.mode)
        print(json.dumps(score(rep), indent=2))
        if args.out:
            args.out.write_text(json.dumps(rep, separators=(",", ":")))
    elif args.cmd == "bench":
        results = [bench(p, args.runs, args.level, args.mode) for p in args.policy.split(",")]
        print(json.dumps(results[0] if len(results) == 1 else results, indent=2))
    elif args.cmd == "llm":
        run_llm(args)
    elif args.cmd == "progress":
        run_progress(args)
    elif args.cmd == "runs":
        run_runs(args)
    elif args.cmd == "generate":
        args.out.mkdir(parents=True, exist_ok=True)
        index = []
        for spec in SHOWCASE:
            rep = simulate(spec["policy"], spec["seed"], C.SIGIL_LEVEL, spec.get("mode", "boss"))
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
