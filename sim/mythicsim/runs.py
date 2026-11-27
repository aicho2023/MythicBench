"""Model runs: one folder per invocation, a registry, and the viewer catalog.

A *run* is one invocation of ``mythicsim llm`` or ``mythicsim progress``::

    runs/
      registry.jsonl                    one line per finished run (fast listing)
      cache/<model-config>.jsonl        recorded replies, shared across runs
      <run_id>/
        manifest.json                   everything that defines the run + its summary
        seeds/seed-N.json               replay (``llm``)
        seeds/seed-N.stats.json         model call stats
        episodes/<E>/pull-K.json        replay (``progress``), with pull-K.stats.json

``run_id`` = ``<UTC time>_<model>[@effort]_<4 hex>``, e.g.
``2026-11-21T1530_claude-haiku-5-5@none_a1b2``: sortable by time, readable,
and unique. Nothing is ever overwritten, so reruns never destroy old results.

The viewer reads ``web/public/replays/local/catalog.json`` (git-ignored), which
``publish`` rebuilds from all manifests.
"""

from __future__ import annotations

import json
import re
import secrets
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .llm.clients import REPO_ROOT

RUNS_DIR = REPO_ROOT / "runs"
LOCAL_REPLAYS = REPO_ROOT / "web" / "public" / "replays" / "local"
RUN_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{4}_.+_[0-9a-f]{4,8}$")


def recording_name(spec: str) -> str:
    """The recordings file for one model configuration, e.g. ``openai_gpt-6-luna_medium.jsonl``."""
    return spec.replace(":", "_").replace("/", "_").replace("@", "_") + ".jsonl"


def git_commit() -> str | None:
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT,
                             capture_output=True, text=True, timeout=5).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=REPO_ROOT,
                               capture_output=True, text=True, timeout=5).stdout.strip()
        return (sha + ("-dirty" if dirty else "")) or None
    except (OSError, subprocess.SubprocessError):
        return None


def make_run_id(label: str, when: datetime | None = None) -> str:
    when = when or datetime.now(timezone.utc)
    short = label.split(":", 1)[-1]  # drop the provider: "claude-haiku-5-5@none"
    short = re.sub(r"[^A-Za-z0-9.@_-]+", "-", short)
    return f"{when.strftime('%Y-%m-%dT%H%M')}_{short}_{secrets.token_hex(4)}"


@dataclass
class Run:
    run_id: str
    dir: Path
    manifest: dict = field(default_factory=dict)

    @property
    def seeds_dir(self) -> Path:
        return self.dir / "seeds"

    def save_manifest(self) -> None:
        (self.dir / "manifest.json").write_text(json.dumps(self.manifest, indent=2))

    def replay_path(self, seed: int) -> Path:
        return self.seeds_dir / f"seed-{seed}.json"


def new_run(label: str, *, mode: str, config: dict, name: str | None = None,
            tags: list[str] | None = None, runs_dir: Path = RUNS_DIR) -> Run:
    """Create a run folder and its manifest (status ``running``)."""
    provider, _, rest = label.partition(":")
    model, _, effort = rest.partition("@")
    now = datetime.now(timezone.utc)
    runs_dir.mkdir(parents=True, exist_ok=True)
    for _ in range(20):  # claim a fresh folder atomically; a clash just draws another id
        run_id = make_run_id(label, now)
        try:
            (runs_dir / run_id).mkdir()
            break
        except FileExistsError:
            continue
    else:
        raise RuntimeError("couldn't create a unique run folder")
    run = Run(run_id, runs_dir / run_id)
    run.seeds_dir.mkdir()
    run.manifest = {
        "run_id": run_id, "name": name, "tags": tags or [], "mode": mode,
        "label": label, "provider": provider, "model": model, "effort": effort or None,
        "created": now.isoformat(timespec="seconds"), "git_commit": git_commit(),
        "status": "running", **config,
    }
    run.save_manifest()
    return run


def finish_run(run: Run, summary: dict, items: list[dict], runs_dir: Path = RUNS_DIR,
               status: str = "done", note: str | None = None) -> None:
    """Record the summary and per-seed results, mark done (or ``stopped`` when
    the budget ran out part-way), and append to the registry."""
    run.manifest.update(status=status, summary=summary, items=items,
                        finished=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    if note:
        run.manifest["note"] = note
    run.save_manifest()
    runs_dir.mkdir(parents=True, exist_ok=True)
    with (runs_dir / "registry.jsonl").open("a") as f:
        f.write(json.dumps(registry_line(run.manifest)) + "\n")


def registry_line(m: dict) -> dict:
    s = m.get("summary") or {}
    return {k: m.get(k) for k in ("run_id", "name", "tags", "mode", "label", "provider", "model", "effort",
                                  "created", "harness_version", "status")} | {
        "n": len(m.get("items") or []), "score_mean": s.get("score_mean"), "win_rate": s.get("win_rate"),
        "cost_usd": s.get("cost_usd")}


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def load_manifests(runs_dir: Path = RUNS_DIR) -> list[dict]:
    """All run manifests, newest first (the source of truth; the registry is a cache)."""
    out = []
    if runs_dir.exists():
        for p in runs_dir.glob("*/manifest.json"):
            try:
                out.append(json.loads(p.read_text()))
            except (OSError, json.JSONDecodeError):
                continue
    return sorted(out, key=lambda m: m.get("created", ""), reverse=True)


def find_run(prefix: str, runs_dir: Path = RUNS_DIR) -> dict:
    """Look a run up by id or any unique prefix/substring of it."""
    ms = load_manifests(runs_dir)
    exact = [m for m in ms if m["run_id"] == prefix]
    hits = exact or [m for m in ms if prefix in m["run_id"]]
    if len(hits) != 1:
        raise SystemExit(f"{len(hits)} runs match {prefix!r}" + (": " + ", ".join(m["run_id"] for m in hits[:8]) if hits else ""))
    return hits[0]


def filter_runs(ms: list[dict], model: str | None = None, tag: str | None = None,
                effort: str | None = None) -> list[dict]:
    if model:
        ms = [m for m in ms if model in (m.get("label") or "")]
    if tag:
        ms = [m for m in ms if tag in (m.get("tags") or [])]
    if effort:
        ms = [m for m in ms if (m.get("effort") or "default") == effort]
    return ms


def rebuild_registry(runs_dir: Path = RUNS_DIR) -> None:
    lines = [json.dumps(registry_line(m)) for m in reversed(load_manifests(runs_dir)) if m.get("status") in ("done", "stopped")]
    (runs_dir / "registry.jsonl").write_text("".join(l + "\n" for l in lines))


def remove_run(run_id: str, runs_dir: Path = RUNS_DIR, published_dir: Path = LOCAL_REPLAYS) -> None:
    """Delete a run and its published copy in the viewer folder."""
    shutil.rmtree(runs_dir / run_id)
    if (published_dir / run_id).exists():
        shutil.rmtree(published_dir / run_id)
    rebuild_registry(runs_dir)


# ---------------------------------------------------------------------------
# Viewer catalog
# ---------------------------------------------------------------------------

_PUBLISH_LOCK = threading.Lock()  # a campaign's parallel cells finish (and publish) concurrently


def publish(runs_dir: Path = RUNS_DIR, out_dir: Path = LOCAL_REPLAYS, only: list[str] | None = None) -> int:
    with _PUBLISH_LOCK:
        return _publish(runs_dir, out_dir, only)


def _publish(runs_dir: Path, out_dir: Path, only: list[str] | None) -> int:
    """Copy replays into the viewer's local folder and rebuild ``catalog.json``.

    ``only``: copy just these runs' replays (the catalog always lists every run
    whose replays are present, so publishing one run never hides the others).
    """
    from .llm import HARNESS_VERSION
    out_dir.mkdir(parents=True, exist_ok=True)
    runs = []
    for m in load_manifests(runs_dir):
        if m.get("status") not in ("done", "stopped") or not m.get("items"):
            continue
        rid = m["run_id"]
        dest = out_dir / rid
        for it in m["items"]:
            src, dst = runs_dir / rid / it["file"], dest / it["file"]
            # Copy when asked to, and always when missing (self-heals layout changes).
            if src.exists() and (only is None or rid in only or not dst.exists()):
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dst)
        # Keep sub-folders (episodes/E/pull-K.json) so files never collide.
        items = [{**it, "file": f"{rid}/{it['file']}", **_pull_stats(runs_dir / rid / it["file"])}
                 for it in m["items"] if (dest / it["file"]).exists()]
        if not items:
            continue
        s = dict(m.get("summary") or {})
        if s.get("cost_usd") is None:
            s.update(estimate_cost(m, runs_dir / rid))
        runs.append({k: m.get(k) for k in ("run_id", "name", "tags", "mode", "label", "provider", "model", "effort",
                                           "created", "harness_version", "prompt_hash", "git_commit",
                                           "knowledge", "memory", "max_pulls", "level", "tier", "dungeon_mode", "status", "note")}
                    | {"summary": {k: s.get(k) for k in ("score_mean", "score_ci95", "win_rate",
                                                          "kill_rate", "pulls_to_kill_mean", "pulls_to_kill_ci95",
                                                          "first_pull_score_mean", "curve_mean",
                                                          "progression_score_mean", "progression_score_ci95",
                                                          "cost_usd", "usd_per_fight")},
                       "items": items})
    catalog = {"current_harness_version": HARNESS_VERSION, "runs": runs}
    (out_dir / "catalog.json").write_text(json.dumps(catalog, indent=1))
    old = out_dir / "index.json"  # the pre-catalog flat list
    if old.exists():
        old.unlink()
    return len(runs)


def _pull_stats(replay: Path) -> dict:
    """A pull's cost, call counts and reply problems, for the viewer's analysis export."""
    from .campaign import STAT_KEYS
    p = replay.with_name(replay.stem + ".stats.json")
    if not p.exists():
        return {}
    st = json.loads(p.read_text())
    return {"usd": st.get("usd"), "stats": {k: st[k] for k in STAT_KEYS if k in st}}


def estimate_cost(m: dict, run_dir: Path) -> dict:
    """List-price cost of a run saved before costs were recorded, from its
    fights' token counts (reflection calls weren't counted, so slightly low)."""
    from .spend import FREE, price_for, stats_cost
    price = price_for(m.get("label") or "")
    files = sorted(run_dir.rglob("*.stats.json"))
    if price is None or price is FREE or not files:
        return {}
    usd = sum(stats_cost(price, json.loads(p.read_text())) for p in files)
    return {"cost_usd": round(usd, 4), "usd_per_fight": round(usd / len(files), 4)}


# ---------------------------------------------------------------------------
# Rescoring (scores are a pure function of the event log, so this is exact)
# ---------------------------------------------------------------------------

def rescore(runs_dir: Path = RUNS_DIR) -> int:
    """Recompute every saved replay's metrics with the current scoring, then
    each run's items and summary. Returns the number of replays rescored."""
    import math
    import statistics as st
    from .llm.progress import summarize_items
    from .metrics import SCORE_VERSION, score as score_fn
    n = 0
    for m in load_manifests(runs_dir):
        if m.get("status") not in ("done", "stopped"):
            continue
        rid = m["run_id"]
        for it in m.get("items") or []:
            p = runs_dir / rid / it["file"]
            if not p.exists():
                continue
            rep = json.loads(p.read_text())
            s = score_fn(rep)
            rep["meta"]["metrics"] = s
            p.write_text(json.dumps(rep, separators=(",", ":")))
            it.update(score=s["score"], outcome=s["outcome"], duration_s=s["duration_s"])
            n += 1
        items = m.get("items") or []
        summ = dict(m.get("summary") or {})
        if m.get("mode") == "progression" and items:
            summ.update(summarize_items(items, m.get("max_pulls") or max(i["pull"] for i in items)))
        elif items:
            vals = [i["score"] for i in items]
            h = 1.96 * st.stdev(vals) / math.sqrt(len(vals)) if len(vals) > 1 else None
            summ.update(score_mean=round(st.mean(vals), 1),
                        score_ci95=[round(st.mean(vals) - h, 1), round(st.mean(vals) + h, 1)] if h is not None else None,
                        win_rate=round(sum(i["outcome"] == "victory" for i in items) / len(items), 3))
        summ["score_version"] = SCORE_VERSION
        m["summary"] = summ
        (runs_dir / rid / "manifest.json").write_text(json.dumps(m, indent=2))
    rebuild_registry(runs_dir)
    return n


# ---------------------------------------------------------------------------
# Legacy import (runs/<model>/seed-N.json from before run folders existed)
# ---------------------------------------------------------------------------

def import_legacy(runs_dir: Path = RUNS_DIR) -> list[str]:
    from .metrics import score as score_fn
    made = []
    for d in sorted(runs_dir.iterdir()) if runs_dir.exists() else []:
        if not d.is_dir() or d.name in ("cache", ".legacy-originals") or RUN_ID_RE.match(d.name) \
                or (d / "manifest.json").exists():
            continue
        seeds = sorted(d.glob("seed-*.json"), key=lambda p: p.stat().st_mtime)
        seeds = [p for p in seeds if not p.name.endswith(".stats.json")]
        if not seeds:
            continue
        first = json.loads(seeds[0].read_text())
        label = first["meta"]["policy"].removeprefix("llm:")
        when = datetime.fromtimestamp(seeds[0].stat().st_mtime, timezone.utc)
        rid = make_run_id(label, when)
        run = Run(rid, runs_dir / rid)
        run.seeds_dir.mkdir(parents=True)
        items = []
        for p in seeds:
            rep = json.loads(p.read_text())
            seed = rep["meta"]["seed"]
            s = rep["meta"].get("metrics") or score_fn(rep)
            shutil.copyfile(p, run.replay_path(seed))
            stats = p.with_name(f"seed-{seed}.stats.json")
            if stats.exists():
                shutil.copyfile(stats, run.seeds_dir / stats.name)
            items.append({"seed": seed, "file": f"seeds/seed-{seed}.json", "outcome": s["outcome"],
                          "score": s["score"], "duration_s": s["duration_s"]})
        provider, _, rest = label.partition(":")
        model, _, effort = rest.partition("@")
        vals = [i["score"] for i in items]
        run.manifest = {
            "run_id": run.run_id, "name": None, "tags": ["legacy"], "mode": "single",
            "label": label, "provider": provider, "model": model, "effort": effort or None,
            "created": when.isoformat(timespec="seconds"), "git_commit": None,
            "harness_version": "legacy", "prompt_hash": None, "seeds": [i["seed"] for i in items],
            "status": "running",
        }
        finish_run(run, {"score_mean": round(sum(vals) / len(vals), 1),
                         "win_rate": round(sum(i["outcome"] == "victory" for i in items) / len(items), 3)},
                   sorted(items, key=lambda i: i["seed"]), runs_dir)
        backup = runs_dir / ".legacy-originals"  # keep the originals; nothing is deleted
        backup.mkdir(exist_ok=True)
        shutil.move(str(d), str(backup / d.name))
        made.append(run.run_id)
    return made
