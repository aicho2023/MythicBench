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
import math
import shutil
import statistics as st
from dataclasses import dataclass
from pathlib import Path

from . import content as C
from . import runs as runs_mod
from . import spend
from .engine import SIM_VERSION
from .llm import HARNESS_VERSION
from .llm.progress import ci95 as _ci, diff_ci95, t95

BOT_EPISODES = 30
REQUIRED = ("name", "mode", "knowledge", "tiers", "episodes", "max_pulls", "effort", "models")


@dataclass(frozen=True)
class Combo:
    model: dict
    tier: str
    memory: bool

    @property
    def spec(self) -> str:
        provider, mid = self.model["provider"], self.model["id"]
        return f"mock:{mid}" if provider == "mock" else f"{provider}:{mid}@{self.model.get('effort')}"

    def key(self, proto: dict) -> str:
        # Versions are part of the key: episodes played by different code never
        # count toward the same cell, and a resumed campaign replays them.
        return (f"{proto['name']}|{self.spec}|{self.tier}|memory-{'on' if self.memory else 'off'}"
                f"|h{HARNESS_VERSION}|s{SIM_VERSION}|c{C.CONTENT_VERSION}")

    @property
    def slug(self) -> str:
        return self.model["id"].replace("/", "_").replace(":", "_")


def load_protocol(path: Path) -> dict:
    proto = json.loads(Path(path).read_text())
    missing = [k for k in REQUIRED if k not in proto]
    if missing:
        raise SystemExit(f"{path}: missing {', '.join(missing)}")
    for t in proto["tiers"]:
        C.tier(t)
    for m in proto["models"]:
        m.setdefault("effort", proto["effort"])
    return proto


def combos(proto: dict, only: str | None = None) -> list[Combo]:
    out = [Combo(m, C.tier(t).id, True) for m in proto["models"] for t in proto["tiers"]]
    by_id = {m["id"]: m for m in proto["models"]}
    for ctl in proto.get("controls", []):
        m = by_id[ctl["model"]]
        for t in ctl.get("tiers", proto["tiers"]):
            out.append(Combo(m, C.tier(t).id, bool(ctl.get("memory", False))))
    if only:
        out = [c for c in out if only in c.spec]
    return out


def finished_episodes(key: str, runs_dir: Path | None = None) -> dict[int, tuple[dict, list[dict]]]:
    """Episode number -> (run manifest, that episode's pull items), newest run first."""
    runs_dir = runs_dir or runs_mod.RUNS_DIR
    found: dict[int, tuple[dict, list[dict]]] = {}
    for m in runs_mod.load_manifests(runs_dir):  # newest first
        if m.get("campaign_key") != key:
            continue
        for ep in m.get("episodes") or []:
            if ep in found or not (runs_dir / m["run_id"] / "episodes" / str(ep) / "episode.json").exists():
                continue
            items = [i for i in m.get("items") or [] if i["episode"] == ep]
            if items:
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
                 budget_usd: float | None = None, offline: bool = False, allow_dirty: bool = False) -> None:
    from .__main__ import run_progress
    paid = not offline and any(m["provider"] != "mock" for m in proto["models"])
    dirty = dirty_files()
    if paid and dirty and not dry_run and not allow_dirty:
        raise SystemExit("refusing to run a paid campaign from uncommitted code (commit first, or pass "
                         "--allow-dirty for a pilot):\n  " + "\n  ".join(dirty[:10]))
    todo = []
    for c in combos(proto, only):
        done = finished_episodes(c.key(proto))
        missing = [e for e in range(proto["episodes"]) if e not in done]
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
    left = budget_usd
    for c, missing in todo:
        if not missing:
            continue
        if left is not None and left <= 0:
            print("campaign budget used up; stopping (rerun to continue)")
            return
        args = argparse.Namespace(
            model=c.spec, effort=None, episodes=",".join(map(str, missing)), max_pulls=proto["max_pulls"],
            mode=proto["mode"], tier=c.tier, memory="on" if c.memory else "off", knowledge=proto["knowledge"],
            interval_ms=proto.get("interval_ms", 4000), max_calls=proto.get("max_calls", 300), workers=workers,
            offline=offline, no_cache=False, name=f"{proto['name']} {c.spec} {C.tier(c.tier).name}"
            + ("" if c.memory else " (memory off)"), tag=[f"campaign:{proto['name']}"],
            budget_usd=left if left is not None else proto.get("run_budget_usd", spend.DEFAULT_RUN_BUDGET_USD),
            price_in=None, price_out=None, price_cached=None,
            cache_dir=runs_mod.RUNS_DIR / "cache" / proto["name"],
            extra={"campaign": proto["name"], "campaign_key": c.key(proto)})
        try:
            m = run_progress(args)
        except SystemExit as err:
            print(f"campaign stopped at {c.spec} {c.tier}: {err}")
            return
        if left is not None:
            left -= (m.get("summary") or {}).get("spent_usd", 0.0)
        if m.get("status") == "stopped":
            print("a run stopped at its budget; stopping the campaign (rerun to continue)")
            return


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


def bot_reference(proto: dict) -> dict:
    """The scripted bots on the same seeds, scored the same way (they don't
    learn, so this is what fixed skill looks like over an episode)."""
    from .__main__ import simulate
    from .llm.progress import pull_seed
    from .metrics import score
    out = {}
    for t in proto["tiers"]:
        tid = C.tier(t).id
        out[tid] = {}
        for pol in ("expert", "competent", "sloppy"):
            eps = []
            # Bots are free, so they get more episodes than the models (the
            # first ones share the models' seeds).
            for e in range(max(proto["episodes"], BOT_EPISODES)):
                items = []
                for k in range(1, proto["max_pulls"] + 1):
                    s = score(simulate(pol, pull_seed(e, k), tid, proto["mode"]))
                    items.append({"pull": k, "score": s["score"], "outcome": s["outcome"]})
                    if s["outcome"] == "victory" and s.get("in_time"):
                        break
                eps.append(_episode_scores(items, proto["max_pulls"]))
            out[tid][pol] = {"progression_score_mean": round(st.mean(eps), 1), "progression_score_ci95": _ci(eps),
                             "episodes": len(eps)}
    return out


def build_results(proto: dict, out_dir: Path, runs_dir: Path | None = None, with_bots: bool = True) -> dict:
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
    controls = []
    for c in combos(proto):
        done = finished_episodes(c.key(proto), runs_dir)
        if not done:
            continue
        items, cost, pulls, tokens_in, tokens_out = [], 0.0, 0, 0, 0
        errors = {"refusals": 0, "unusable_replies": 0, "truncated_replies": 0, "api_errors": 0,
                  "pulls_out_of_calls": 0}
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
                rel = Path("replays") / c.slug / c.tier / ("memory-off" if not c.memory else "") / f"ep{ep}-pull{it['pull']}.json.gz"
                dst = out_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                with gzip.GzipFile(dst, "wb", mtime=0) as f:  # mtime=0: byte-identical rebuilds
                    f.write(src.read_bytes())
                ep_pulls.append({"pull": it["pull"], "seed": it["seed"], "score": it["score"],
                                 "outcome": it["outcome"], "in_time": it.get("in_time", it["outcome"] == "victory"),
                                 "duration_s": it["duration_s"], "file": rel.as_posix(), "usd": stats.get("usd"),
                                 **{k: it[k] for k in ("deaths", "kicks", "avoidable") if k in it}})
            episodes_out.append({"episode": ep, "run_id": m["run_id"], "pulls": ep_pulls})
        summ = summarize_items(items, max_pulls)
        eps_scores = [_episode_scores([i for i in items if i["episode"] == e], max_pulls) for e in sorted(done)]
        cell = {
            # A cell is complete when every planned episode finished; incomplete
            # cells are shown but never ranked.
            "episodes": len(done), "complete": len(done) >= proto["episodes"], "pulls": pulls,
            "progression_score": round(st.mean(eps_scores), 1), "progression_score_ci95": _ci(eps_scores),
            "episode_scores": [round(x, 2) for x in eps_scores],
            "clear_rate": summ["kill_rate"], "pulls_to_clear_mean": summ["pulls_to_kill_mean"],
            "pulls_to_clear": summ["pulls_to_kill"], "first_pull_score_mean": summ["first_pull_score_mean"],
            "curve_mean": summ["curve_mean"], "cost_usd": round(cost, 4),
            "usd_per_pull": round(cost / pulls, 4) if pulls else None,
            "tokens_per_pull": [round(tokens_in / pulls), round(tokens_out / pulls)] if pulls else None,
            **errors, "harness_versions": sorted(h for h in harness if h),
            "episode_list": episodes_out,
        }
        if not c.memory:
            controls.append({"model": c.model["id"], "tier": c.tier, "memory": False, **cell})
            continue
        row = rows.setdefault(c.model["id"], {"model": c.model["id"], "provider": c.model["provider"],
                                              "name": c.model.get("name", c.model["id"]),
                                              "effort": c.model.get("effort"), "tiers": {}})
        row["tiers"][c.tier] = cell
    # Learning effect: memory on minus memory off, same model, tier and seeds.
    # (Within-episode gains alone are biased upward: a clear carries forward.)
    for ctl in controls:
        cell = rows.get(ctl["model"], {}).get("tiers", {}).get(ctl["tier"])
        if cell:
            cell["learning_effect"] = round(cell["progression_score"] - ctl["progression_score"], 1)
            cell["learning_effect_ci95"] = diff_ci95(cell["episode_scores"], ctl["episode_scores"])
    tiers = [C.tier(t).id for t in proto["tiers"]]
    for row in rows.values():
        cells = [row["tiers"].get(t) for t in tiers]
        row["complete"] = all(x and x["complete"] for x in cells)
        if all(cells):
            # The headline: mean of the tier scores. Its interval combines the
            # tiers' standard errors with the smaller sample's t multiplier.
            means = [x["progression_score"] for x in cells]
            ns = [len(x["episode_scores"]) for x in cells]
            if min(ns) >= 2:
                ses = [st.stdev(x["episode_scores"]) / math.sqrt(n) for x, n in zip(cells, ns)]
                half = t95(min(ns) - 1) * math.sqrt(sum(s * s for s in ses)) / len(ses)
                row["mythicbench_score_ci95"] = [round(st.mean(means) - half, 1), round(st.mean(means) + half, 1)]
            else:
                row["mythicbench_score_ci95"] = None
            row["mythicbench_score"] = round(st.mean(means), 1)
            row["cost_usd"] = round(sum(x["cost_usd"] for x in cells), 4)
        else:
            row["mythicbench_score"] = None
    ranked = sorted((r for r in rows.values() if r["complete"] and r["mythicbench_score"] is not None),
                    key=lambda r: (-r["mythicbench_score"], r["model"]))
    board = ranked + sorted((r for r in rows.values() if r not in ranked), key=lambda r: r["model"])
    for i, r in enumerate(board):
        r["rank"] = i + 1 if r in ranked else None
    result = {
        "protocol": {k: proto[k] for k in proto if k != "models"} | {"models": [m["id"] for m in proto["models"]]},
        "harness_version": HARNESS_VERSION, "content_version": C.CONTENT_VERSION, "sim_version": SIM_VERSION,
        "tiers": {t: {"name": C.tier(t).name, "affixes": [C.AFFIXES[a].name for a in C.tier(t).affixes]}
                  for t in tiers},
        "leaderboard": board, "controls": controls,
    }
    if with_bots:
        result["bots"] = bot_reference(proto)
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
