"""The official protocol: every model on every tier, one fixed recipe.

A protocol file (``protocol/v1.json``) names the models, the shared effort,
the tiers, and how many episodes and pulls each gets. ``campaign`` plays every
model x tier as a learning run; ``results`` collects the finished episodes into
one dataset (``results/v1``) that the site reads.

Resuming is safe: each finished episode is marked on disk, a campaign only
plays the episodes still missing, and recorded replies make a re-played
episode free up to the point where it was interrupted.
"""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import statistics as st
from dataclasses import dataclass
from pathlib import Path

from . import content as C
from . import runs as runs_mod
from . import spend
from .engine import SIM_VERSION
from .llm import HARNESS_VERSION
from .llm.progress import ci95 as _ci

FREE_PROVIDERS = ("mock", "scripted")  # no API: nothing to pay, nothing to record
REQUIRED = ("name", "mode", "knowledge", "tiers", "episodes", "max_pulls", "effort", "models")


@dataclass
class Combo:
    """One cell: a model configuration on one tier, memory on or off, with the
    episode ids it plays. ``role``: ranked (the leaderboard), baseline (the
    scripted commander), control (memory off, paired with memory on), sanity
    (Normal, unranked), or effort (the same model at another reasoning effort,
    for cost-vs-score curves)."""
    model: dict
    tier: str
    memory: bool
    episodes: tuple[int, ...] = ()
    role: str = "ranked"

    @property
    def spec(self) -> str:
        provider, mid = self.model["provider"], self.model["id"]
        return f"{provider}:{mid}" if provider in FREE_PROVIDERS else f"{provider}:{mid}@{self.model.get('effort')}"

    def key(self, proto: dict) -> str:
        # The key names everything that decides how an episode is played: the
        # code versions and the gameplay rules. Episodes played under other
        # rules never count toward this cell; a resumed campaign replays them.
        return (f"{proto['name']}|{self.spec}|{self.tier}|memory-{'on' if self.memory else 'off'}"
                f"|h{HARNESS_VERSION}|s{SIM_VERSION}|c{C.CONTENT_VERSION}|r{rules_hash(proto)}")

    @property
    def slug(self) -> str:
        return self.model["id"].replace("/", "_").replace(":", "_")


RULE_KEYS = ("mode", "knowledge", "max_pulls", "interval_ms", "max_calls", "seed_base")


def rules_hash(proto: dict) -> str:
    """Fingerprint of the gameplay rules a protocol fixes."""
    import hashlib
    rules = {k: proto.get(k, DEFAULTS.get(k)) for k in RULE_KEYS}
    return hashlib.sha256(json.dumps(rules, sort_keys=True).encode()).hexdigest()[:10]


DEFAULTS = {"interval_ms": 4000, "max_calls": 300, "seed_base": 10_000}


def valid_episode(items: list[dict], max_pulls: int) -> bool:
    """A finished episode is pulls 1..n with no gaps, ending either in a timed
    clear (which ends the episode early) or at the full number of pulls."""
    from .llm.progress import cleared
    pulls = sorted(i["pull"] for i in items)
    if not pulls or pulls != list(range(1, len(pulls) + 1)) or len(pulls) > max_pulls:
        return False
    by = {i["pull"]: i for i in items}
    clears = [k for k in pulls if cleared(by[k])]
    if clears:
        return clears == [pulls[-1]]  # the first clear is the last pull
    return len(pulls) == max_pulls


def load_protocol(path: Path) -> dict:
    proto = json.loads(Path(path).read_text())
    missing = [k for k in REQUIRED if k not in proto]
    if missing:
        raise SystemExit(f"{path}: missing {', '.join(missing)}")
    for t in proto["tiers"]:
        C.tier(t)
    for m in proto["models"]:
        m.setdefault("effort", proto["effort"])
    if headline_tier(proto) not in [C.tier(t).id for t in proto["tiers"]]:
        raise SystemExit(f"{path}: headline_tier must be one of the tiers")
    return proto


def headline_tier(proto: dict) -> str:
    """The tier the MythicBench score is: +10 by default (Normal is near its
    ceiling for strong models, so it's a sanity tier, shown but not ranked on)."""
    return C.tier(proto.get("headline_tier", "plus10")).id


def combos(proto: dict, only: str | None = None) -> list[Combo]:
    """Every cell the protocol plays. Cells that land on the same model
    configuration, tier and memory setting merge (their episode ids unite): a
    control's memory-on side is the ranked cell played for more episodes."""
    tiers = [C.tier(t).id for t in proto["tiers"]]
    by_id = {m["id"]: m for m in proto["models"] + proto.get("baselines", [])}
    cells: dict[tuple, Combo] = {}

    def add(model: dict, tier: str, memory: bool, n: int, role: str) -> None:
        c = Combo(model, C.tier(tier).id, memory, tuple(range(n)), role)
        k = (c.spec, c.tier, c.memory)
        if k in cells:
            cells[k].episodes = tuple(sorted(set(cells[k].episodes) | set(c.episodes)))
        else:
            cells[k] = c

    for m in proto["models"]:
        for t in tiers:
            add(m, t, True, proto["episodes"], "ranked")
    for m in proto.get("baselines", []):
        for t in tiers:
            add(m, t, True, proto["episodes"], "baseline")
    for ctl in proto.get("controls", []):
        m = by_id[ctl["model"]]
        for t in ctl.get("tiers", tiers):
            n = ctl.get("episodes", proto["episodes"])
            add(m, t, True, n, "ranked")  # the paired memory-on side
            add(m, t, bool(ctl.get("memory", False)), n, "control")
    for x in proto.get("sanity", []):
        for t in x["tiers"]:
            add(by_id[x["model"]], t, True, x.get("episodes", proto["episodes"]), "sanity")
    for x in proto.get("efforts", []):
        for eff in x["efforts"]:
            for t in x.get("tiers", tiers):
                add({**by_id[x["model"]], "effort": eff}, t, True, x.get("episodes", proto["episodes"]), "effort")
    out = list(cells.values())
    if only:
        out = [c for c in out if only in c.spec]
    return out


def episode_ids(proto: dict, c: Combo) -> tuple[int, ...]:
    return c.episodes or tuple(range(proto["episodes"]))


def finished_episodes(key: str, runs_dir: Path | None = None, max_pulls: int | None = None
                      ) -> dict[int, tuple[dict, list[dict]]]:
    """Episode number -> (run manifest, that episode's pull items), newest run
    first. Items come from the episode's own checkpoint (episode.json), so an
    episode survives a later failure in its run. With ``max_pulls``, only
    episodes that pass ``valid_episode`` count."""
    runs_dir = runs_dir or runs_mod.RUNS_DIR
    found: dict[int, tuple[dict, list[dict]]] = {}
    for m in runs_mod.load_manifests(runs_dir):  # newest first
        if m.get("campaign_key") != key:
            continue
        for ep in m.get("episodes") or []:
            mark = runs_dir / m["run_id"] / "episodes" / str(ep) / "episode.json"
            if ep in found or not mark.exists():
                continue
            items = json.loads(mark.read_text()).get("items") or [i for i in m.get("items") or [] if i["episode"] == ep]
            if items and (max_pulls is None or valid_episode(items, max_pulls)):
                found[ep] = (m, items)
    return found


# ---------------------------------------------------------------------------
# Playing
# ---------------------------------------------------------------------------

def dirty_files() -> list[str]:
    """Uncommitted changes to code or protocol (a run must name the exact code it used)."""
    import subprocess
    try:
        out = subprocess.run(["git", "status", "--porcelain", "--", "sim/mythicsim", "protocol"],
                             cwd=runs_mod.REPO_ROOT, capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line[3:] for line in out.splitlines() if line.strip()]


def run_campaign(proto: dict, *, only: str | None = None, dry_run: bool = False, workers: int = 1,
                 budget_usd: float | None = None, offline: bool = False, allow_dirty: bool = False,
                 cells: int = 1) -> None:
    paid = not offline and any(c.model["provider"] not in FREE_PROVIDERS for c in combos(proto, only))
    dirty = dirty_files()
    if paid and dirty and not dry_run and not allow_dirty:
        raise SystemExit("refusing to run a paid campaign from uncommitted code (commit first, or pass "
                         "--allow-dirty for a pilot):\n  " + "\n  ".join(dirty[:10]))
    todo = []
    for c in combos(proto, only):
        done = finished_episodes(c.key(proto), max_pulls=proto["max_pulls"])
        missing = [e for e in episode_ids(proto, c) if e not in done]
        todo.append((c, missing))
    print(f"protocol {proto['name']}: {len(todo)} model x tier runs, "
          f"{sum(len(m) for _, m in todo)} episodes still to play (up to {proto['max_pulls']} pulls each)")
    total_est = 0.0
    for c, missing in todo:
        price = spend.price_for(c.spec) or spend.FREE
        per_pull, basis = spend.estimate_fight_usd(price, proto["mode"], c.spec)
        est = per_pull * len(missing) * proto["max_pulls"]
        total_est += est
        print(f"  {c.spec:<40} {C.tier(c.tier).name:<7} memory {'on ' if c.memory else 'off'}  "
              f"{len(missing)} episodes to play, worst case ~${est:,.2f}")
    print(f"worst case for everything left: ~${total_est:,.2f} (strong models clear early and cost less)")
    if dry_run:
        return
    jobs = [(c, missing) for c, missing in todo if missing]
    if budget_usd is not None:
        # One campaign budget across every cell and call (reserved before each call).
        spend.CAMPAIGN.disarm()
        spend.CAMPAIGN.arm(budget_usd)
    try:
        _play(proto, jobs, cells, workers, offline)
    finally:
        spend.CAMPAIGN.disarm()


def _play(proto: dict, jobs: list, cells: int, workers: int, offline: bool) -> None:
    if cells > 1:
        # Cells in parallel (each also plays its episodes in parallel). The
        # project cap is enforced live across all of them (spend.PROJECT);
        # each cell keeps its own run budget.
        from concurrent.futures import ThreadPoolExecutor
        print(f"playing {len(jobs)} cells, {cells} at a time", flush=True)
        with ThreadPoolExecutor(max_workers=cells) as pool:
            results = list(pool.map(lambda j: _play_cell(proto, *j, workers, None, offline), jobs))
        stopped = [c.spec for (c, _), m in zip(jobs, results) if m and m.get("status") == "stopped"]
        if stopped:
            print(f"stopped at a budget: {', '.join(stopped)} (rerun to continue)")
        return
    for c, missing in jobs:
        m = _play_cell(proto, c, missing, workers, None, offline)
        if m is None:
            return
        if m.get("status") == "stopped":
            print("a run stopped at its budget; stopping the campaign (rerun to continue)")
            return


def _play_cell(proto: dict, c: Combo, missing: list[int], workers: int, left: float | None, offline: bool) -> dict | None:
    from .__main__ import run_progress
    args = argparse.Namespace(
        model=c.spec, effort=None, episodes=",".join(map(str, missing)), max_pulls=proto["max_pulls"],
        mode=proto["mode"], tier=c.tier, memory="on" if c.memory else "off", knowledge=proto["knowledge"],
        interval_ms=proto.get("interval_ms", 4000), max_calls=proto.get("max_calls", 300), workers=workers,
        seed_base=proto.get("seed_base", DEFAULTS["seed_base"]),
        offline=offline, no_cache=False, name=f"{proto['name']} {c.spec} {C.tier(c.tier).name}"
        + ("" if c.memory else " (memory off)"), tag=[f"campaign:{proto['name']}"],
        budget_usd=left if left is not None else proto.get("run_budget_usd", spend.DEFAULT_RUN_BUDGET_USD),
        price_in=None, price_out=None, price_cached=None,
        cache_dir=runs_mod.RUNS_DIR / "cache" / proto["name"],
        extra={"campaign": proto["name"], "campaign_key": c.key(proto)})
    try:
        return run_progress(args)
    except SystemExit as err:
        print(f"campaign stopped at {c.spec} {c.tier}: {err}")
        return None


def verify_campaign(proto: dict, runs_dir: Path | None = None) -> int:
    """Release check: replay every counted episode from its recordings alone
    (no network) and compare each pull with the published one, byte for byte
    apart from the run's bookkeeping. Returns a process exit code."""
    from .llm.clients import CachedClient, NoNetwork
    from .llm.progress import run_episode
    runs_dir = runs_dir or runs_mod.RUNS_DIR
    cache_dir = runs_dir / "cache" / proto["name"]
    checked, bad = 0, []
    for c in combos(proto):
        done = finished_episodes(c.key(proto), runs_dir, proto["max_pulls"])
        if not done:
            continue
        safe = c.spec.replace(":", "_").replace("/", "_").replace("@", "_")
        client = CachedClient(NoNetwork(c.spec), cache_dir / f"{safe}.jsonl", offline=True)
        for ep, (m, items) in sorted(done.items()):
            try:
                again = run_episode(client, ep, max_pulls=proto["max_pulls"], memory=c.memory,
                                    knowledge=proto["knowledge"], interval_ms=proto.get("interval_ms", 4000),
                                    max_calls=proto.get("max_calls", 300), tier=c.tier, mode=proto["mode"],
                                    seed_base=proto.get("seed_base", DEFAULTS["seed_base"]))
            except Exception as err:  # noqa: BLE001 - any failure is a failed check
                bad.append(f"{c.spec} {c.tier} memory-{'on' if c.memory else 'off'} episode {ep}: {err}")
                continue
            for p in again.pulls:
                src = runs_dir / m["run_id"] / "episodes" / str(ep) / f"pull-{p.pull}.json"
                want = json.loads(src.read_text()) if src.exists() else None
                got = json.loads(json.dumps(p.replay))
                for r in (want, got):
                    if r:
                        r["meta"].pop("run", None)
                checked += 1
                if want != got:
                    bad.append(f"{c.spec} {c.tier} episode {ep} pull {p.pull}: replay differs")
            if len(again.pulls) != len(items):
                bad.append(f"{c.spec} {c.tier} episode {ep}: {len(again.pulls)} pulls on replay, {len(items)} recorded")
    for b in bad:
        print("FAIL", b)
    print(f"verified {checked} pulls: {'OK' if not bad else f'{len(bad)} problems'}")
    return 1 if bad or not checked else 0


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

def _episode_scores(items: list[dict], max_pulls: int) -> float:
    """One episode's progression score: mean pull score, a clear carrying forward."""
    last, total = 0.0, 0.0
    by_pull = {i["pull"]: i for i in items}
    for k in range(1, max_pulls + 1):
        if k in by_pull:
            last = by_pull[k]["score"]
        total += last
    return total / max_pulls


def _spec_of(row: dict, proto: dict) -> str:
    m = {"provider": row["provider"], "id": row["model"], "effort": row.get("effort")}
    return Combo(m, "plus10", True).spec


def _cell(c: Combo, done: dict, planned: set, out_dir: Path, runs_dir: Path, max_pulls: int) -> dict:
    """One cell's numbers from its finished episodes; copies the replays into the dataset."""
    from .llm.progress import summarize_items
    items, cost, pulls, tokens_in, tokens_out = [], 0.0, 0, 0, 0
    errors = {"refusals": 0, "unusable_replies": 0, "truncated_replies": 0, "api_errors": 0, "pulls_out_of_calls": 0}
    harness = set()
    episodes_out = []
    for ep in sorted(done):
        m, ep_items = done[ep]
        harness.add(m.get("harness_version"))
        ep_pulls = []
        for it in sorted(ep_items, key=lambda i: i["pull"]):
            items.append({**it, "episode": ep})
            src = runs_dir / m["run_id"] / it["file"]
            stats_p = src.with_name(src.stem + ".stats.json")
            stats = json.loads(stats_p.read_text()) if stats_p.exists() else {}
            cost += stats.get("usd", 0.0)
            tokens_in += stats.get("input_tokens", 0)
            tokens_out += stats.get("output_tokens", 0)
            for k in ("refusals", "unusable_replies", "truncated_replies", "api_errors"):
                errors[k] += stats.get(k, 0)
            errors["pulls_out_of_calls"] += bool(stats.get("budget_exhausted"))
            pulls += 1
            sub = ("" if c.memory else "memory-off") if c.role != "effort" else f"effort-{c.model['effort']}"
            rel = Path("replays") / c.slug / c.tier / sub / f"ep{ep}-pull{it['pull']}.json.gz"
            dst = out_dir / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            with gzip.GzipFile(dst, "wb", mtime=0) as f:  # mtime=0: byte-identical rebuilds
                f.write(src.read_bytes())
            ep_pulls.append({"pull": it["pull"], "seed": it["seed"], "score": it["score"],
                             "outcome": it["outcome"], "in_time": it.get("in_time", it["outcome"] == "victory"),
                             "duration_s": it["duration_s"], "file": rel.as_posix(), "usd": stats.get("usd"),
                             **{k: it[k] for k in ("deaths", "kicks", "avoidable") if k in it}})
        episodes_out.append({"episode": ep, "run_id": m["run_id"], "pulls": ep_pulls})
    summ = summarize_items(items, max_pulls) if items else None
    eps_scores = [_episode_scores([i for i in items if i["episode"] == e], max_pulls) for e in sorted(done)]
    n = len(done)
    return {
        # A cell is complete when every planned episode finished (and checked
        # out as valid); incomplete cells are shown but never ranked.
        "episodes": n, "episode_ids": sorted(done), "complete": set(done) == set(planned), "pulls": pulls,
        "progression_score": round(st.mean(eps_scores), 1) if eps_scores else None,
        "progression_score_ci95": _ci(eps_scores), "episode_scores": [round(x, 2) for x in eps_scores],
        "clear_rate": summ["kill_rate"] if summ else None, "clears": sum(1 for e in sorted(done) if any(
            i.get("outcome") == "victory" for i in done[e][1])),
        "pulls_to_clear_mean": summ["pulls_to_kill_mean"] if summ else None,
        "pulls_to_clear": summ["pulls_to_kill"] if summ else [],
        "first_pull_score_mean": summ["first_pull_score_mean"] if summ else None,
        "curve_mean": summ["curve_mean"] if summ else None,
        # Cost next to every score: what an episode of this configuration costs at list prices.
        "cost_usd": round(cost, 4), "usd_per_episode": round(cost / n, 4) if n else None,
        "usd_per_pull": round(cost / pulls, 4) if pulls else None,
        "tokens_per_pull": [round(tokens_in / pulls), round(tokens_out / pulls)] if pulls else None,
        **errors, "harness_versions": sorted(h for h in harness if h),
        "episode_list": episodes_out,
    }


def build_results(proto: dict, out_dir: Path, runs_dir: Path | None = None) -> dict:
    """Collect every finished episode into ``out_dir`` (leaderboard.json, per-pull
    replays gzipped, notes). Deterministic: the same runs give the same files."""
    from .llm.progress import summarize_items
    runs_dir = runs_dir or runs_mod.RUNS_DIR
    out_dir = Path(out_dir)
    if (out_dir / "replays").exists():
        shutil.rmtree(out_dir / "replays")
    out_dir.mkdir(parents=True, exist_ok=True)
    max_pulls = proto["max_pulls"]
    rows: dict[str, dict] = {}
    baselines: dict[str, dict] = {}
    controls, configs = [], []
    scores: dict[tuple, dict[int, float]] = {}  # (spec, tier, memory) -> episode -> progression score
    for c in combos(proto):
        planned = episode_ids(proto, c)
        done = {e: v for e, v in finished_episodes(c.key(proto), runs_dir, max_pulls).items() if e in planned}
        if not done:
            continue
        scores[(c.spec, c.tier, c.memory)] = {e: _episode_scores(done[e][1], max_pulls) for e in done}
        if c.role in ("ranked", "baseline"):
            # The leaderboard uses the same episodes for every model: the
            # protocol's first N. Extra episodes (for the paired control) only
            # feed the learning effect.
            ranked = set(range(proto["episodes"]))
            cell = _cell(c, {e: v for e, v in done.items() if e in ranked}, ranked, out_dir, runs_dir, max_pulls)
        else:
            cell = _cell(c, done, set(planned), out_dir, runs_dir, max_pulls)
        if c.role == "control":
            controls.append({"model": c.model["id"], "tier": c.tier, "memory": False, **cell})
            continue
        if c.role == "effort":
            cfg = next((x for x in configs if x["model"] == c.model["id"] and x["effort"] == c.model["effort"]), None)
            if cfg is None:
                cfg = {"model": c.model["id"], "provider": c.model["provider"], "effort": c.model["effort"], "tiers": {}}
                configs.append(cfg)
            cfg["tiers"][c.tier] = cell
            continue
        table = baselines if c.model["provider"] in FREE_PROVIDERS and c.model["id"] in {
            m["id"] for m in proto.get("baselines", [])} else rows
        row = table.setdefault(c.model["id"], {"model": c.model["id"], "provider": c.model["provider"],
                                               "name": c.model.get("name", c.model["id"]),
                                               "effort": c.model.get("effort"), "tiers": {}})
        if c.role == "sanity":
            cell["sanity"] = True  # shown, never ranked on
        row["tiers"][c.tier] = cell
    # Learning effect: memory on minus memory off, episode by episode on the
    # same seeds (a paired comparison; a within-episode gain alone is biased
    # upward because a clear carries forward). Only complete, matched pairs.
    for ctl in controls:
        on_row = rows.get(ctl["model"])
        on = scores.get((_spec_of(on_row, proto), ctl["tier"], True)) if on_row else None
        off = scores.get((_spec_of(on_row, proto), ctl["tier"], False)) if on_row else None
        if not on or not off or not ctl["complete"]:
            continue
        pairs = [{"episode": e, "on": round(on[e], 2), "off": round(off[e], 2)} for e in sorted(off) if e in on]
        if len(pairs) != len(off):
            continue  # the memory-on side is missing some of the control's episodes
        diffs = [p["on"] - p["off"] for p in pairs]
        cell = on_row["tiers"].get(ctl["tier"])
        if cell is not None:
            cell["learning_effect"] = round(st.mean(diffs), 1)
            cell["learning_effect_ci95"] = _ci(diffs)
            cell["learning_pairs"] = pairs
    tiers = [C.tier(t).id for t in proto["tiers"]]
    head = headline_tier(proto)
    for row in rows.values():
        # Ranking needs every ranked tier complete; sanity cells don't count.
        cells = [row["tiers"].get(t) for t in tiers]
        row["complete"] = all(x and x["complete"] for x in cells)
        cell = row["tiers"].get(head)
        # The headline is the headline tier's progression score and interval.
        row["mythicbench_score"] = cell["progression_score"] if cell else None
        row["mythicbench_score_ci95"] = cell["progression_score_ci95"] if cell else None
        if all(cells):
            row["cost_usd"] = round(sum(x["cost_usd"] for x in cells), 4)
    for row in baselines.values():
        cell = row["tiers"].get(head)
        row["mythicbench_score"] = cell["progression_score"] if cell else None
        row["mythicbench_score_ci95"] = cell["progression_score_ci95"] if cell else None
    baseline_rows = sorted(baselines.values(), key=lambda r: r["model"])
    models = list(rows.values())
    ranked = sorted((r for r in models if r["complete"] and r["mythicbench_score"] is not None),
                    key=lambda r: (-r["mythicbench_score"], r["model"]))
    board = ranked + sorted((r for r in models if r not in ranked), key=lambda r: r["model"])
    for i, r in enumerate(board):
        r["rank"] = i + 1 if r in ranked else None
    for r in baseline_rows:
        r["rank"] = None
        r["baseline"] = True
    result = {
        "protocol": {k: proto[k] for k in proto if k != "models"} | {"models": [m["id"] for m in proto["models"]]},
        "harness_version": HARNESS_VERSION, "content_version": C.CONTENT_VERSION, "sim_version": SIM_VERSION,
        "tiers": {t: {"name": C.tier(t).name, "affixes": [C.AFFIXES[a].name for a in C.tier(t).affixes]}
                  for t in tiers},
        "headline_tier": head, "leaderboard": board, "baselines": baseline_rows, "controls": controls,
        "configs": configs,
    }
    # The model-reply recordings: with them anyone can replay every pull
    # offline, for free (python -m mythicsim progress ... --offline --cache-dir <this folder>).
    rec_dir = runs_dir / "cache" / proto["name"]
    if (out_dir / "recordings").exists():
        shutil.rmtree(out_dir / "recordings")
    for f in sorted(rec_dir.glob("*.jsonl")) if rec_dir.exists() else []:
        (out_dir / "recordings").mkdir(parents=True, exist_ok=True)
        with gzip.GzipFile(out_dir / "recordings" / (f.name + ".gz"), "wb", mtime=0) as g:
            g.write(f.read_bytes())
    (out_dir / "leaderboard.json").write_text(json.dumps(result, indent=1) + "\n")
    (out_dir / "protocol.json").write_text(json.dumps(proto, indent=1) + "\n")
    return result
