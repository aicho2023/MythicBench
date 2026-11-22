"""Command-line entry point.

    python -m mythicsim run --seed 7            (the scripted commander, no API)
    python -m mythicsim progress --model openai:gpt-6.2-sol --episodes 0-2
    python -m mythicsim generate --out ../web/public/replays
"""

from __future__ import annotations

import argparse
import json
import os
import math
import statistics
from pathlib import Path

from . import content as C
from . import runs as runs_mod
from . import spend
from .engine import SIM_VERSION, Encounter
from .llm import HARNESS_VERSION, prompt_hash
from .llm.clients import EFFORTS, CachedClient, ClientError, NoNetwork, make_client
from .llm.policy import add_chat_events, make_llm_policies
from .metrics import score

# The reference replays shipped with the viewer (and its tests): the scripted
# commander, which plays through the agents' own interface with fixed, obvious
# rules (kick every cast, step out of every pool) and never learns.
SHOWCASE_SEED = 7
COMMANDER_BLURB = "Fixed, obvious rules through the agents' own interface: kick every cast, step out of every pool. It never learns."
SHOWCASE = [
    {"id": "commander-plus10", "seed": SHOWCASE_SEED, "mode": "dungeon", "tier": "plus10",
     "label": "Scripted commander, +10", "blurb": COMMANDER_BLURB},
    {"id": "commander-normal", "seed": SHOWCASE_SEED, "mode": "dungeon", "tier": "normal",
     "label": "Scripted commander, Normal", "blurb": COMMANDER_BLURB},
]


MODES = ("dungeon", "boss")


def simulate(seed: int, tier: str = C.DEFAULT_TIER, mode: str = "dungeon") -> dict:
    """One run by the scripted commander (free: no API). ``mode="dungeon"``
    plays the full run (trash, then the boss); "boss" the boss fight alone."""
    from .llm.scripted import ScriptedCommander
    client = ScriptedCommander()
    policies, party = make_llm_policies(client, tier=tier, mode=mode, knowledge="blind", parallel=False)
    return make_encounter(seed, policies, f"llm:{client.spec}", tier, mode).run()


def make_encounter(seed: int, policies, label: str, tier: str, mode: str):
    if mode == "dungeon":
        from .dungeon import DungeonRun
        return DungeonRun(seed, policies, label, tier)
    return Encounter(seed, policies, label, tier)


def parse_tier(text: str) -> str:
    try:
        return C.tier(text).id
    except ValueError as err:
        raise argparse.ArgumentTypeError(str(err)) from None


def tier_label(m: dict) -> str:
    if m.get("tier"):
        return C.tier(m["tier"]).name
    return f"+{m.get('level') or 12} (old)"  # runs made before tiers existed


def parse_seeds(text: str) -> list[int]:
    out: list[int] = []
    for part in text.split(","):
        a, _, b = part.partition("-")
        out.extend(range(int(a), int(b) + 1) if b else [int(a)])
    return out


def build_client(args, n_fights: int):
    """The model client wrapped for recording and money: ``tally`` (outside
    the recording) measures the run's cost from scratch; ``meter`` (inside it)
    charges only real API calls against the run budget and the project cap."""
    if args.offline and args.no_cache:
        raise SystemExit("--offline replays recorded replies; it can't be combined with --no-cache")
    client = make_client(args.model, args.effort)
    label = client.spec  # includes @effort when set
    if args.offline:
        client = NoNetwork(label)  # offline can never reach a provider
    price = spend.price_for(label, args.price_in, args.price_out, args.price_cached)
    paid = not args.offline and not label.startswith(("mock:", "scripted:"))
    if price is None:
        if paid:
            raise SystemExit(f"no price known for {label}. Add it to PRICES in sim/mythicsim/spend.py, "
                             "or pass --price-in and --price-out (USD per 1M tokens).")
        price = spend.FREE
    meter = None
    if paid:
        spend.claim_paid_lock()
        cap, spent = spend.project_cap(), spend.total_spent()
        left = cap - spent
        if left <= 0:
            raise SystemExit(f"project budget used up: ${spent:.2f} of ${cap:.2f} spent. "
                             "Raise MYTHICBENCH_TOTAL_BUDGET_USD in .env to allow more.")
        limit = min(spend.finite_usd(args.budget_usd, "--budget-usd"), left)
        spend.PROJECT.arm(cap, spent)  # parallel runs in this process share the money left
        per_fight, basis = spend.estimate_fight_usd(price, args.mode, label)
        print(f"budget: this run may spend ${limit:.2f} (project: ${spent:.2f} of ${cap:.2f} used). "
              f"Estimate ~${per_fight:.2f} per fight, up to {n_fights} fights = ~${per_fight * n_fights:.2f} ({basis})",
              flush=True)
        if per_fight * n_fights > limit:
            print(f"  note: the estimate is above the budget; the run will stop when it reaches ${limit:.2f} "
                  "and keep the fights finished by then", flush=True)
        meter = spend.CostMeter(client, price, limit_usd=limit, ledger=spend.LEDGER)
        client = meter
    if not args.no_cache:
        safe = label.replace(":", "_").replace("/", "_").replace("@", "_")
        # A campaign records into its own folder, so it never replays pilot runs.
        cache_dir = getattr(args, "cache_dir", None) or runs_mod.RUNS_DIR / "cache"
        client = CachedClient(client, Path(cache_dir) / f"{safe}.jsonl", offline=args.offline)
    tally = spend.CostMeter(client, price)
    return tally, label, price, meter


def cost_fields(price, stats: dict) -> float:
    return round(price.cost(stats["input_tokens"], stats["output_tokens"], stats.get("cache_read_tokens", 0),
                            stats.get("cache_write_tokens", 0)), 4)


def money_summary(tally, meter, n_fights: int) -> dict:
    return {"cost_usd": round(tally.usd, 4),  # what the run costs from scratch, at list prices
            "usd_per_fight": round(tally.usd / n_fights, 4) if n_fights else None,
            "spent_usd": round(meter.usd, 4) if meter else 0.0}  # real money this invocation (recorded replies are free)


def play_llm_seed(client, seed: int, args, label: str, run) -> tuple[dict, dict]:
    policies, party = make_llm_policies(client, interval_ms=args.interval_ms, max_calls=args.max_calls,
                                        tier=args.tier, mode=args.mode, scope=f"s{seed}")
    rep = make_encounter(seed, policies, f"llm:{label}", args.tier, args.mode).run()
    add_chat_events(rep, party.chat)
    s = score(rep)
    rep["meta"]["metrics"] = s
    rep["meta"]["run"] = {k: run.manifest.get(k) for k in
                          ("run_id", "name", "label", "model", "effort", "harness_version", "prompt_hash", "git_commit",
                                     "knowledge", "tier", "dungeon_mode", "max_pulls", "campaign")}
    rep["agents"] = {uid: {"system": a.system} for uid, a in party.agents.items()}
    rep["calls"] = party.calls
    run.replay_path(seed).write_text(json.dumps(rep, separators=(",", ":")))
    st = party.stats_dict()
    st["usd"] = cost_fields(args._price, st)
    (run.seeds_dir / f"seed-{seed}.stats.json").write_text(json.dumps(st, indent=2))
    return rep, st


def run_llm(args) -> None:
    """Play each seed with the model into a new run folder, then print a comparison."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    seeds = parse_seeds(args.seeds)
    client, label, args._price, meter = build_client(args, len(seeds))
    run = runs_mod.new_run(label, mode="single", name=args.name, tags=args.tag, config={
        "seeds": seeds, "interval_ms": args.interval_ms, "max_calls": args.max_calls, "tier": args.tier,
        "dungeon_mode": args.mode,
        "harness_version": HARNESS_VERSION, "prompt_hash": prompt_hash("full", args.tier, args.mode),
        "sim_version": SIM_VERSION, "content_version": C.CONTENT_VERSION,
        "offline": args.offline, "cache": not args.no_cache,
        "budget_usd": meter.limit_usd if meter else None,
    })
    if meter:
        meter.run_id = run.run_id
    print(f"run {run.run_id}", flush=True)
    rows = []
    stopped = None
    # Fights are independent and mostly wait on the API, so seeds can run in
    # parallel threads; each fight's own result is unaffected.
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(play_llm_seed, client, seed, args, label, run): seed for seed in seeds}
        for fut in as_completed(futures):
            seed = futures[fut]
            try:
                rep, st = fut.result()
            except spend.BudgetExceeded as err:
                for f in futures:
                    f.cancel()
                stopped = stopped or str(err)
                continue
            except ClientError as err:
                for f in futures:
                    f.cancel()
                run.manifest.update(status="failed", error=str(err)[:500], **money_summary(client, meter, 0))
                run.save_manifest()
                raise SystemExit(f"seed {seed}: {err}")
            s = rep["meta"]["metrics"]
            rows.append({"seed": seed, "score": s["score"], "outcome": s["outcome"],
                         "duration_s": s["duration_s"], "deaths": len(s["deaths"]),
                         "interrupts": f"{s['interrupts']['interrupted']}/{s['interrupts']['interruptible_casts']}",
                         "stats": st})
            print(f"seed {seed:>3}: {s['outcome']:7s} score {s['score']:6.1f}  "
                  f"calls {st['calls']} ({st['cached_calls']} cached), tokens {st['input_tokens']}+{st['output_tokens']} (${st['usd']:.2f}), "
                  f"bad replies {st['unusable_replies']} ({st['truncated_replies']} cut off), dropped entries {st['invalid_entries']}, "
                  f"api errors {st['api_errors']}", flush=True)
    rows.sort(key=lambda r: r["seed"])
    if stopped and not rows:
        run.manifest.update(status="stopped", error=stopped, **money_summary(client, meter, 0))
        run.save_manifest()
        raise SystemExit(f"stopped before any fight finished: {stopped}")
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
        "calls_per_fight": round(statistics.mean(r["stats"]["calls"] for r in rows), 1),
        "input_tokens_per_fight": round(tin / len(rows)),
        "output_tokens_per_fight": round(tout / len(rows)),
        "provider_cached_input_tokens_per_fight": round(sum(r["stats"]["cache_read_tokens"] for r in rows) / len(rows)),
        "model_seconds_per_fight": round(statistics.mean(r["stats"]["latency_s"] for r in rows), 1),
    }
    summary.update(money_summary(client, meter, len(rows)))
    items = [{"seed": r["seed"], "file": f"seeds/seed-{r['seed']}.json", "outcome": r["outcome"],
              "score": r["score"], "duration_s": r["duration_s"]} for r in rows]
    runs_mod.finish_run(run, summary, items, status="stopped" if stopped else "done", note=stopped)
    runs_mod.publish(only=[run.run_id])
    print(json.dumps(summary, indent=2))
    if stopped:
        print(f"STOPPED EARLY: {stopped}. Kept {len(rows)} of {len(seeds)} seeds.")
    print(f"run {run.run_id}: {run.dir}")
    print("watch it: cd web && npm run dev, then open Runs in the top bar")


def run_progress(args) -> dict:
    """Learning over pulls: episodes of repeated attempts with notes between pulls.
    Returns the run's manifest."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from .llm.progress import DEFAULT_SEED_BASE, run_episode, summarize
    episodes = parse_seeds(args.episodes)
    memory = args.memory == "on"
    seed_base = getattr(args, "seed_base", None) or DEFAULT_SEED_BASE
    client, label, price, meter = build_client(args, len(episodes) * args.max_pulls)
    run = runs_mod.new_run(label, mode="progression", name=args.name, tags=args.tag, config={
        "episodes": episodes, "max_pulls": args.max_pulls, "memory": memory, "knowledge": args.knowledge,
        "interval_ms": args.interval_ms, "max_calls": args.max_calls, "tier": args.tier, "dungeon_mode": args.mode,
        "seed_base": seed_base,
        "harness_version": HARNESS_VERSION, "prompt_hash": prompt_hash(args.knowledge, args.tier, args.mode),
        "sim_version": SIM_VERSION, "content_version": C.CONTENT_VERSION,
        "offline": args.offline, "cache": not args.no_cache,
        "budget_usd": meter.limit_usd if meter else None,
        **(getattr(args, "extra", None) or {}),
    })
    if meter:
        meter.run_id = run.run_id
    print(f"run {run.run_id}  ({C.tier(args.tier).name}, {args.knowledge} knowledge, memory {args.memory}, "
          f"up to {args.max_pulls} pulls)", flush=True)

    def on_pull(ep, pr):
        d = run.dir / "episodes" / str(ep.episode)
        d.mkdir(parents=True, exist_ok=True)
        pr.replay["meta"]["run"] = {k: run.manifest.get(k) for k in
                                    ("run_id", "name", "label", "model", "effort", "harness_version", "prompt_hash", "git_commit",
                                     "knowledge", "tier", "dungeon_mode", "max_pulls", "campaign", "seed_base")}
        (d / f"pull-{pr.pull}.json").write_text(json.dumps(pr.replay, separators=(",", ":")))
        pr.stats["usd"] = cost_fields(price, pr.stats)
        (d / f"pull-{pr.pull}.stats.json").write_text(json.dumps(pr.stats, indent=2))
        (d / f"notes-after-{pr.pull}.json").write_text(json.dumps(pr.notes_after, indent=1))
        m = pr.metrics
        print(f"episode {ep.episode:>2} pull {pr.pull}: {m['outcome']:7s} score {m['score']:6.1f}  "
              f"deaths {len(m['deaths'])}  calls {pr.stats['calls']}  "
              f"tokens {pr.stats['input_tokens']}+{pr.stats['output_tokens']} (${pr.stats['usd']:.2f})"
              + (f"  [{pr.problem}]" if pr.problem else ""), flush=True)

    results = []
    stopped = None
    unfinished: list[str] = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(run_episode, client, e, max_pulls=args.max_pulls, memory=memory,
                               knowledge=args.knowledge, interval_ms=args.interval_ms,
                               max_calls=args.max_calls, tier=args.tier, mode=args.mode,
                               on_pull=on_pull, seed_base=seed_base): e for e in episodes}
        for fut in as_completed(futures):
            try:
                ep = fut.result()
                results.append(ep)
                # Marks the episode complete, with its own pull list (the
                # campaign resumes from these even if a later episode fails).
                # Written to a temp file and renamed: never half-written.
                ep_dir = run.dir / "episodes" / str(ep.episode)
                tmp = ep_dir / "episode.json.tmp"
                tmp.write_text(json.dumps({
                    "episode": ep.episode, "pulls": len(ep.pulls), "complete": True, "seed_base": seed_base,
                    "cleared_on": ep.killed_on, "items": episode_items(ep)}))
                os.replace(tmp, ep_dir / "episode.json")
            except spend.BudgetExceeded as err:
                # The interrupted episode's finished pulls are on disk but not
                # counted: a cut-short episode would bias pulls-to-kill.
                for f in futures:
                    f.cancel()
                stopped = stopped or str(err)
            except ClientError as err:
                if not err.fatal:
                    # Retries used up: this episode stops unfinished (not
                    # checkpointed). Rerunning replays its recorded calls for
                    # free and asks the failed one again. Others carry on.
                    unfinished.append(f"episode {futures[fut]}: {str(err)[:200]}")
                    print(f"episode {futures[fut]} left unfinished (rerun to resume): {err}", flush=True)
                    continue
                for f in futures:
                    f.cancel()
                run.manifest.update(status="failed", error=str(err)[:500], **money_summary(client, meter, 0))
                run.save_manifest()
                raise SystemExit(f"episode {futures[fut]}: {err}")
    results.sort(key=lambda e: e.episode)
    if unfinished:
        stopped = stopped or "; ".join(unfinished)
    if stopped and not results:
        run.manifest.update(status="stopped", error=stopped, **money_summary(client, meter, 0))
        run.save_manifest()
        raise SystemExit(f"stopped before any episode finished: {stopped}")
    summary = summarize(results, args.max_pulls)
    summary.update(money_summary(client, meter, sum(len(e.pulls) for e in results)))
    items = [it for e in results for it in episode_items(e)]
    runs_mod.finish_run(run, summary, items, status="stopped" if stopped else "done", note=stopped)
    runs_mod.publish(only=[run.run_id])
    print(json.dumps({k: v for k, v in summary.items() if k not in ("score_mean", "win_rate")}, indent=2))
    print(f"run {run.run_id}: {run.dir}")
    if stopped:
        print(f"STOPPED EARLY: {stopped}. Kept {len(results)} of {len(episodes)} complete episodes.")
    return run.manifest


def episode_items(e) -> list[dict]:
    """The manifest items (one per pull) of a finished episode."""
    return [{"episode": e.episode, "pull": p.pull, "seed": p.seed, "file": f"episodes/{e.episode}/pull-{p.pull}.json",
             "outcome": p.metrics["outcome"], "in_time": p.metrics.get("in_time", False),
             "score": p.metrics["score"], "duration_s": p.metrics["duration_s"], **pull_facts(p.metrics)}
            for p in e.pulls]


def pull_facts(m: dict) -> dict:
    """Small per-pull numbers the viewer charts across an episode."""
    k = m.get("interrupts") or {}
    return {"deaths": len(m.get("deaths") or []), "kicks": [k.get("interrupted", 0), k.get("interruptible_casts", 0)],
            "avoidable": sum((m.get("avoidable_damage_taken") or {}).values())}


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
                  f"{n:>3} {'pulls' if m.get('mode') == 'progression' else 'seeds'}  {tier_label(m):<7} "
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
    elif args.runs_cmd == "spend":
        if args.backfill:
            for rid, usd in spend.backfill():
                print(f"  added estimate for {rid}: ${usd:.2f}")
        led = spend.summarize_ledger()
        print(f"spent ${led['spent_usd']:.2f} of ${led['cap_usd']:.2f} "
              f"(${led['remaining_usd']:.2f} left): {led['calls']} logged API calls"
              + (f" + estimates for {led['estimated_runs']} earlier runs" if led["estimated_runs"] else ""))
        if led["by_model"]:
            print("by model:")
            for k, v in led["by_model"].items():
                print(f"  {k:<44} ${v:8.2f}")
            print("most expensive runs:")
            for k, v in list(led["by_run"].items())[:10]:
                print(f"  {k:<52} ${v:8.2f}")
        print("change the cap with MYTHICBENCH_TOTAL_BUDGET_USD in .env")
    elif args.runs_cmd == "import-legacy":
        made = runs_mod.import_legacy()
        runs_mod.publish()
        print(f"imported {len(made)} legacy runs" + "".join(f"\n  {r}" for r in made))


def add_money_args(p) -> None:
    p.add_argument("--budget-usd", type=float, default=spend.DEFAULT_RUN_BUDGET_USD,
                   help=f"stop this run once it has spent this much on API calls "
                        f"(default ${spend.DEFAULT_RUN_BUDGET_USD:.0f}; recorded replies are free)")
    p.add_argument("--price-in", type=float, help="USD per 1M input tokens, for a model not in the price table")
    p.add_argument("--price-out", type=float, help="USD per 1M output tokens")
    p.add_argument("--price-cached", type=float, help="USD per 1M cached input tokens (default: the input price)")


def main() -> None:
    ap = argparse.ArgumentParser(prog="mythicsim")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="play one run with the scripted commander (no API) and print its score")
    r.add_argument("--seed", type=int, default=7)
    r.add_argument("--out", type=Path, help="also write the replay JSON here")
    r.add_argument("--mode", choices=MODES, default="dungeon",
                     help="dungeon (default): trash packs then the boss; boss: the boss fight alone")
    r.add_argument("--tier", type=parse_tier, default=C.DEFAULT_TIER,
                     help="difficulty: normal, or +10 (default; harder mechanics via affixes)")
    m = sub.add_parser("llm", help="let a language model play single fights")
    m.add_argument("--model", required=True,
                   help="provider:model, e.g. anthropic:claude-haiku-5-5, openai:<model>, or mock:basic")
    m.add_argument("--seeds", default="0-4", help="e.g. 0-4 or 3,7,11 (default 0-4)")
    m.add_argument("--interval-ms", type=int, default=4000, help="routine decision interval in game time")
    m.add_argument("--max-calls", type=int, default=300, help="safety cap on model calls per fight")
    m.add_argument("--mode", choices=MODES, default="dungeon",
                     help="dungeon (default): trash packs then the boss; boss: the boss fight alone")
    m.add_argument("--tier", type=parse_tier, default=C.DEFAULT_TIER,
                     help="difficulty: normal, or +10 (default; harder mechanics via affixes)")
    m.add_argument("--offline", action="store_true", help="only use recorded replies (no API calls)")
    m.add_argument("--no-cache", action="store_true", help="don't record or reuse replies")
    m.add_argument("--cache-dir", type=Path, help="where recorded replies live (default runs/cache)")
    m.add_argument("--effort", choices=EFFORTS,
                   help="thinking/reasoning effort (default: the provider's own default). "
                        "Also accepted as provider:model@effort. Each effort is a separate configuration")
    m.add_argument("--workers", type=int, default=1, help="seeds to play in parallel (default 1)")
    m.add_argument("--name", help="a human name for this run, e.g. 'haiku baseline'")
    m.add_argument("--tag", action="append", default=[], help="label for filtering (repeatable)")
    add_money_args(m)
    pg = sub.add_parser("progress", help="learning over pulls: repeated attempts with notes between pulls")
    pg.add_argument("--model", required=True, help="provider:model[@effort], or mock:basic")
    pg.add_argument("--effort", choices=EFFORTS)
    pg.add_argument("--episodes", default="0", help="episode numbers, e.g. 0-4 (each is an independent attempt series)")
    pg.add_argument("--max-pulls", type=int, default=8)
    pg.add_argument("--mode", choices=MODES, default="dungeon",
                     help="dungeon (default): trash packs then the boss; boss: the boss fight alone")
    pg.add_argument("--tier", type=parse_tier, default=C.DEFAULT_TIER,
                     help="difficulty: normal, or +10 (default; harder mechanics via affixes)")
    pg.add_argument("--memory", choices=("on", "off"), default="on",
                    help="off = control condition: notes are wiped between pulls")
    pg.add_argument("--knowledge", choices=("blind", "full"), default="blind",
                    help="blind (default): nothing about the boss is given up front")
    pg.add_argument("--interval-ms", type=int, default=4000)
    pg.add_argument("--max-calls", type=int, default=300)
    pg.add_argument("--workers", type=int, default=1, help="episodes to play in parallel")
    pg.add_argument("--offline", action="store_true")
    pg.add_argument("--no-cache", action="store_true")
    pg.add_argument("--seed-base", type=int, help="first seed of the pull schedule (default 10000; a protocol sets its own)")
    pg.add_argument("--cache-dir", type=Path, help="where recorded replies live (a campaign records into runs/cache/<protocol name>)")
    pg.add_argument("--name")
    pg.add_argument("--tag", action="append", default=[])
    add_money_args(pg)
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
    rsp = rsub.add_parser("spend", help="real API spend so far, against the project cap")
    rsp.add_argument("--backfill", action="store_true",
                     help="first add estimated spend for runs made before the spend log existed")
    rsub.add_parser("import-legacy", help="convert old runs/<model>/ folders into run folders")
    rsub.add_parser("rescore", help="recompute every saved run's scores with the current scoring")
    cp = sub.add_parser("campaign", help="play the official protocol: every model on every tier (resumable)")
    cp.add_argument("protocol", type=Path, help="e.g. ../protocol/v1.json")
    cp.add_argument("--only", help="only models whose spec contains this text")
    cp.add_argument("--dry-run", action="store_true", help="list what's left to play and a worst-case cost")
    cp.add_argument("--workers", type=int, default=3, help="episodes to play in parallel per model and tier")
    cp.add_argument("--budget-usd", type=float, help="stop the campaign after spending this much this time")
    cp.add_argument("--offline", action="store_true", help="only use recorded replies (rebuild from recordings)")
    cp.add_argument("--verify", action="store_true",
                    help="release check: replay every counted episode from the recordings alone and compare; "
                         "exits nonzero on any difference")
    cp.add_argument("--allow-dirty", action="store_true", help="allow a paid campaign from uncommitted code (pilots only)")
    cp.add_argument("--first", type=int,
                    help="a staged run: play only each cell's first N episodes (rerun without it for the rest)")
    cp.add_argument("--cells", type=int, default=1,
                    help="model x tier cells to play at once (each plays --workers episodes at once); default 1")
    rr = sub.add_parser("results", help="collect the protocol's finished episodes into a results dataset")
    rr.add_argument("protocol", type=Path)
    rr.add_argument("--out", type=Path, required=True, help="e.g. ../results/v1")
    vr = sub.add_parser("verify", help="check a published results folder on its own: rescore every pull, "
                                       "rebuild the leaderboard, replay every group from the recordings")
    vr.add_argument("results", type=Path, help="e.g. ../web/public/results/v1")
    vr.add_argument("--first", type=int, help="the dataset is stage 1 of a staged run: expect each cell's first N groups")
    vr.add_argument("--no-replay", action="store_true",
                    help="skip replaying from the recordings (faster, but costs and reply counts go unchecked)")
    vr.add_argument("--protocol", type=Path, help="also require the dataset's protocol to be this file")
    g = sub.add_parser("generate", help="write the showcase replays for the viewer")
    g.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    if args.cmd == "run":
        rep = simulate(args.seed, args.tier, args.mode)
        print(json.dumps(score(rep), indent=2))
        if args.out:
            args.out.write_text(json.dumps(rep, separators=(",", ":")))
    elif args.cmd == "llm":
        run_llm(args)
    elif args.cmd == "progress":
        run_progress(args)
    elif args.cmd == "runs":
        run_runs(args)
    elif args.cmd == "campaign":
        from .campaign import load_protocol, run_campaign, verify_campaign
        if args.verify:
            raise SystemExit(verify_campaign(load_protocol(args.protocol), first=args.first))
        run_campaign(load_protocol(args.protocol), only=args.only, dry_run=args.dry_run, workers=args.workers,
                     budget_usd=args.budget_usd, offline=args.offline, allow_dirty=args.allow_dirty, cells=args.cells,
                     first=args.first)
    elif args.cmd == "results":
        from .campaign import build_results, load_protocol
        res = build_results(load_protocol(args.protocol), args.out)
        for row in res["leaderboard"]:
            tiers = "  ".join(f"{t} {c['progression_score']:5.1f} (clear {c['clear_rate']:.0%})"
                              for t, c in row["tiers"].items())
            print(f"{row['name']:<28} score {row['mythicbench_score'] if row['mythicbench_score'] is not None else '-':>5}  {tiers}")
        print(f"wrote {args.out}/leaderboard.json")
    elif args.cmd == "verify":
        from .campaign import verify_results
        raise SystemExit(verify_results(args.results, first=args.first, replay=not args.no_replay,
                                        official=args.protocol))
    elif args.cmd == "generate":
        args.out.mkdir(parents=True, exist_ok=True)
        index = []
        for spec in SHOWCASE:
            rep = simulate(spec["seed"], spec["tier"], spec["mode"])
            s = score(rep)
            rep["meta"]["metrics"] = s
            (args.out / f"{spec['id']}.json").write_text(json.dumps(rep, separators=(",", ":")))
            index.append({**spec, "file": f"{spec['id']}.json", "outcome": s["outcome"],
                          "duration_s": s["duration_s"], "score": s["score"]})
            print(f"{spec['id']}: {s['outcome']} in {s['duration_s']}s, score {s['score']}, "
                  f"{len(s['deaths'])} deaths, kicks {s['interrupts']}")
        (args.out / "index.json").write_text(json.dumps(index, indent=2))
        # The site's Party page reads this: every character, ability, enemy and affix.
        from .guide import game_guide
        (args.out / "game.json").write_text(json.dumps(game_guide(), indent=1) + "\n")


if __name__ == "__main__":
    main()
