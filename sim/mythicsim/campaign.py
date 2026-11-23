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
from .llm.progress import ci95 as _ci, cleared
from .stats import clopper_pearson, holm, paired

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


def freeze_id(proto: dict) -> str:
    """The code versions and gameplay rules a recording was made under."""
    return f"h{HARNESS_VERSION}-s{SIM_VERSION}-c{C.CONTENT_VERSION}-r{rules_hash(proto)}"


def recordings_dir(proto: dict, runs_dir: Path | None = None) -> Path:
    """Where a campaign records replies: one folder per protocol and freeze, so
    a rerun after a fix (new versions, or the reserve seeds) never replays
    replies recorded under other rules."""
    return (runs_dir or runs_mod.RUNS_DIR) / "cache" / proto["name"] / freeze_id(proto)


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


_SAFE_NAME = __import__("re").compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


def _safe_name(x, what: str, path) -> None:
    """Protocol names and ids become folder names: plain characters only."""
    if not isinstance(x, str) or not _SAFE_NAME.match(x) or ".." in x:
        raise SystemExit(f"{path}: {what} {x!r} must be letters, digits, '.', '_' or '-'")


def load_protocol(path: Path) -> dict:
    proto = json.loads(Path(path).read_text())
    missing = [k for k in REQUIRED if k not in proto]
    if missing:
        raise SystemExit(f"{path}: missing {', '.join(missing)}")
    _safe_name(proto["name"], "name", path)
    for m in proto["models"] + proto.get("baselines", []):
        _safe_name(m.get("id"), "model id", path)
        _safe_name(m.get("provider"), "provider", path)
        if m.get("effort") is not None:
            _safe_name(m["effort"], "effort", path)
    _safe_name(proto["effort"], "effort", path)
    for e in proto.get("efforts", []):
        for x in e.get("efforts", []):
            _safe_name(x, "effort", path)
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
                 cells: int = 1, first: int | None = None) -> None:
    """Play what's left of the protocol. ``first``: a staged run plays only each
    cell's first N episodes (ids below N); running again without it plays the
    rest under the same protocol, so the stages add up to one dataset."""
    pinned = OFFICIAL_PROTOCOLS.get(proto["name"])
    if pinned and protocol_digest(proto) != pinned[-1]:  # only the current version is played
        raise SystemExit(f"protocol {proto['name']!r} differs from the pinned official one (digest "
                         f"{protocol_digest(proto)[:12]}, pinned {pinned[-1][:12]}): restore it, or give it another name")
    paid = not offline and any(c.model["provider"] not in FREE_PROVIDERS for c in combos(proto, only))
    dirty = dirty_files()
    if paid and dirty and not dry_run and not allow_dirty:
        raise SystemExit("refusing to run a paid campaign from uncommitted code (commit first, or pass "
                         "--allow-dirty for a pilot):\n  " + "\n  ".join(dirty[:10]))
    todo = []
    for c in combos(proto, only):
        done = finished_episodes(c.key(proto), max_pulls=proto["max_pulls"])
        missing = [e for e in episode_ids(proto, c) if e not in done and (first is None or e < first)]
        todo.append((c, missing))
    print(f"protocol {proto['name']}: {len(todo)} model x tier runs, "
          + (f"stage: each run's first {first} episode(s) only, " if first is not None else "")
          + f"{sum(len(m) for _, m in todo)} episodes still to play (up to {proto['max_pulls']} pulls each)")
    total_est = 0.0
    for c, missing in todo:
        price = spend.price_for(c.spec) or spend.FREE
        per_pull, basis = spend.estimate_fight_usd(price, proto["mode"], c.spec)
        est = per_pull * len(missing) * proto["max_pulls"]
        total_est += est
        print(f"  {c.spec:<40} {C.tier(c.tier).name:<7} memory {'on ' if c.memory else 'off'}  "
              f"{len(missing)} episodes to play, ~${est:,.2f} if every one plays all {proto['max_pulls']} pulls")
    print(f"estimate for everything left: ~${total_est:,.2f} if every group plays all {proto['max_pulls']} pulls, "
          "at each model's average cost per pull so far. An estimate, not a bound: a pull can cost more than "
          "average. The spending limits are --budget-usd and MYTHICBENCH_TOTAL_BUDGET_USD")
    if dry_run:
        return
    jobs = [(c, missing) for c, missing in todo if missing]
    if paid and jobs:
        spend.claim_paid_lock()  # once, before any cell starts (cells run as threads of this process)
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
        cache_dir=recordings_dir(proto),
        extra={"campaign": proto["name"], "campaign_key": c.key(proto)})
    try:
        return run_progress(args)
    except SystemExit as err:
        print(f"campaign stopped at {c.spec} {c.tier}: {err}")
        return None


def verify_campaign(proto: dict, runs_dir: Path | None = None, first: int | None = None) -> int:
    """Release check on this machine's runs: every cell has exactly the groups
    the protocol (or the stage, ``first``) calls for; every checkpointed score
    and seed matches its replay; and every group replays from its recordings
    alone (no network), byte for byte apart from the run's bookkeeping.
    Returns a process exit code. (``verify_results`` checks a published dataset.)"""
    from .llm.clients import CachedClient, NoNetwork
    from .llm.progress import run_episode
    runs_dir = runs_dir or runs_mod.RUNS_DIR
    cache_dir = recordings_dir(proto, runs_dir)
    checked, bad = 0, []
    for c in combos(proto):
        done = finished_episodes(c.key(proto), runs_dir, proto["max_pulls"])
        want = _expected(proto, c, first)
        if set(done) != want:
            bad.append(f"{c.spec} {c.tier} memory-{'on' if c.memory else 'off'}: groups {sorted(done)}, expected {sorted(want)}")
        done = {e: v for e, v in done.items() if e in want}
        if not done:
            continue
        for ep, (m, items) in sorted(done.items()):
            for it in items:
                src = runs_dir / m["run_id"] / "episodes" / str(ep) / f"pull-{it['pull']}.json"
                if not src.exists():
                    bad.append(f"{c.spec} {c.tier} episode {ep} pull {it['pull']}: replay missing")
                    continue
                again, problems = _rescore(json.loads(src.read_text()), ep, it["pull"], proto)
                bad += [f"{c.spec} {c.tier} episode {ep} pull {it['pull']}: {p}" for p in problems]
                for k in ("seed", "score", "outcome", "in_time"):
                    if it.get(k) != again[k]:
                        bad.append(f"{c.spec} {c.tier} episode {ep} pull {it['pull']}: checkpoint {k} "
                                   f"{it.get(k)!r}, the replay says {again[k]!r}")
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


def _expected(proto: dict, c: Combo, first: int | None) -> set[int]:
    """The episodes a finished campaign (or a stage of it) must have for a cell."""
    return {e for e in episode_ids(proto, c) if first is None or e < first}


def _rescore(rep: dict, ep: int, pull: int, proto: dict) -> tuple[dict, list[str]]:
    """A pull's item recomputed from its replay's event log alone, and anything
    that doesn't match the protocol (its seed, its code versions)."""
    from .__main__ import pull_facts
    from .llm.progress import pull_seed
    from .metrics import score
    m = score(rep)
    meta = rep["meta"]
    want_seed = pull_seed(ep, pull, proto.get("seed_base", DEFAULTS["seed_base"]))
    bad = []
    if meta.get("seed") != want_seed:
        bad.append(f"seed {meta.get('seed')}, the protocol says {want_seed}")
    if meta.get("sim_version") != SIM_VERSION or meta.get("content_version") != C.CONTENT_VERSION:
        bad.append(f"played on sim {meta.get('sim_version')} / content {meta.get('content_version')}")
    item = {"episode": ep, "pull": pull, "seed": meta.get("seed"), "outcome": m["outcome"],
            "in_time": m.get("in_time", False), "score": m["score"], "duration_s": m["duration_s"], **pull_facts(m)}
    return item, bad


# The official protocols, pinned: a published dataset that names one of these
# must carry exactly one of its pinned versions (normalized JSON's SHA-256), or a
# verifier pass would only prove it complete against some other protocol. The
# last digest is the current protocol file; earlier ones are datasets published
# before a pre-registered amendment that only added models.
OFFICIAL_PROTOCOLS: dict[str, tuple[str, ...]] = {
    "v1": (
        "8ff5337d414ceac9f4944bd23081d6058d459ed3d1f264fd0d7b695d6d0e6641",  # the five models of stages 1 and 2
        "a41e77f133926d32b0edeb10676a5c33d09146b4197bce91fc5bae2fd30bed1d",  # + two labs (Amendment 3)
    ),
    # The pre-registered restart: v1 on its reserve seeds (seed_base 80000), run in
    # full only if v1's stage 1 finds a harness fault (docs/PREREGISTRATION.md).
    "v1-restart": ("8bcc88a37769d812845924300c2630a14fc361dfbbbeba8e17819aefa32c5169",),  # protocol/v1-restart.json
}


def protocol_digest(proto: dict) -> str:
    import hashlib
    return hashlib.sha256(json.dumps(proto, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


# Stats that are a pure function of the recorded replies (so a replay must
# reproduce them exactly). Latency and cache hits depend on the machine.
_TIMING_KEYS = {"latency_s", "cached_calls"}


def _deterministic_stats(st_: dict) -> dict:
    out = {}
    for k in STAT_KEYS:
        if k == "usd" or k not in st_:
            continue
        v = st_[k]
        out[k] = {kk: vv for kk, vv in v.items() if kk not in _TIMING_KEYS} if isinstance(v, dict) else v
    return out


def _with_checked(published: dict, replayed: dict | None) -> dict:
    """The published stats with every checked field (counts, tokens, cost)
    replaced by the replay's own; only timing fields stay as published."""
    if replayed is None:
        return published
    out = dict(published)
    for k, v in _deterministic_stats(replayed).items():
        out[k] = {**(published.get(k) or {}), **v} if isinstance(v, dict) else v
    out["usd"] = replayed["usd"]
    return out


def _inside(root: Path, p: Path) -> Path:
    """``p``, refused unless it resolves inside ``root`` (no writing outside the sandbox)."""
    rp = p.resolve()
    if not rp.is_relative_to(root.resolve()):
        raise SystemExit(f"refusing a path outside {root}: {p}")
    return rp


def verify_results(out_dir: Path, first: int | None = None, replay: bool = True,
                   official: Path | None = None) -> int:
    """Release check on a published dataset, from its folder alone.

    1. The protocol is the official one when it names one (pinned digest), or
       the one given with ``official``.
    2. Every scored pull is rescored from its replay's event log, and its seed
       checked against the protocol's schedule.
    3. With ``replay`` (the default), every group is played again offline from
       the published recordings and must match its published replays; each
       pull's reply and token stats are recomputed from the recordings and
       must match the published ones, and its cost is recomputed from those
       tokens and the price table in this code.
    4. The whole leaderboard is rebuilt from the recomputed pulls (and, with
       ``replay``, the recomputed stats and costs) and must equal the published one.
    5. Each cell has exactly the groups the protocol (or the stage, ``first``) calls for.

    Nothing from the dataset names a path: the checker writes only inside its
    own temporary folder, under folder names it makes up. Returns an exit code.
    """
    import tempfile
    from .llm.progress import cleared
    out_dir = Path(out_dir).resolve()
    proto = load_protocol(out_dir / "protocol.json")
    published = json.loads((out_dir / "leaderboard.json").read_text())
    bad: list[str] = []
    digest = protocol_digest(proto)
    if official is not None and digest != protocol_digest(load_protocol(official)):
        bad.append(f"the dataset's protocol isn't {official} (digest {digest[:12]})")
    pinned = OFFICIAL_PROTOCOLS.get(proto["name"])
    if pinned and digest not in pinned:
        bad.append(f"the dataset says it's protocol {proto['name']!r} but its protocol differs from the pinned "
                   f"official ones (digest {digest[:12]}, pinned {', '.join(d[:12] for d in pinned)})")
    for k, v in (("harness_version", HARNESS_VERSION), ("sim_version", SIM_VERSION), ("content_version", C.CONTENT_VERSION)):
        if published.get(k) != v:
            bad.append(f"dataset {k} {published.get(k)}, this code {v}: check out the tag the dataset names")
    if bad:
        for b in bad:
            print("FAIL", b)
        return 1

    # Each published pull's group/run id and stats, by its replay file (comparison only).
    pub: dict[str, tuple[str, dict]] = {}

    def lists(cell: dict):
        yield from cell.get("episode_list") or []
        yield from cell.get("paired_episode_list") or []
    cells = [c for row in published["leaderboard"] + (published.get("baselines") or []) for c in row["tiers"].values()]
    cells += list(published.get("controls") or [])
    cells += [c for cfg in published.get("configs") or [] for c in cfg["tiers"].values()]
    for cell in cells:
        for e in lists(cell):
            for pl in e["pulls"]:
                pub[str(pl["file"])] = (str(e["run_id"]), pl.get("stats") or {})

    # Replay first (when asked): it recomputes every pull's stats and cost.
    derived: dict[str, dict] = {}
    checked_replays = _replay_from_recordings(out_dir, proto, first, bad, derived) if replay else 0
    if replay:
        for rel, (_, st_pub) in pub.items():
            got = derived.get(rel)
            if got is None:
                continue
            if _deterministic_stats(st_pub) != _deterministic_stats(got):
                bad.append(f"{rel}: published stats differ from a replay of the recordings "
                           f"(at {', '.join(_diff(_deterministic_stats(st_pub), _deterministic_stats(got))[:4])})")
            if st_pub.get("usd") is not None and abs(st_pub["usd"] - got["usd"]) > 5e-5:
                bad.append(f"{rel}: published cost ${st_pub['usd']} but its tokens cost ${got['usd']} at list prices")

    checked = 0
    with tempfile.TemporaryDirectory() as tmpname:
        tmp = Path(tmpname).resolve()
        runs_dir = tmp / "runs"
        internal: dict[str, str] = {}  # published run id -> a folder name we made up
        for c in combos(proto):
            sub = ("" if c.memory else "memory-off") if c.role != "effort" else f"effort-{c.model['effort']}"
            folder = _inside(out_dir, out_dir / "replays" / c.slug / c.tier / sub) if sub else \
                _inside(out_dir, out_dir / "replays" / c.slug / c.tier)
            found: dict[int, dict[int, Path]] = {}
            for f in sorted(folder.glob("ep*-pull*.json.gz")) if folder.is_dir() else []:
                try:
                    ep, pull = (int(x) for x in f.name[2:-len(".json.gz")].split("-pull"))
                except ValueError:
                    bad.append(f"unexpected file {f.relative_to(out_dir)}")
                    continue
                found.setdefault(ep, {})[pull] = f
            want = _expected(proto, c, first)
            label = f"{c.spec} {c.tier} memory-{'on' if c.memory else 'off'}"
            if set(found) != want:
                missing, extra = sorted(want - set(found)), sorted(set(found) - want)
                bad.append(f"{label}: groups {sorted(found)}, expected {sorted(want)}"
                           + (f" (missing {missing})" if missing else "") + (f" (not in the protocol {extra})" if extra else ""))
            by_run: dict[str, dict] = {}
            for ep, pulls in sorted(found.items()):
                items, rid = [], None
                for pull, f in sorted(pulls.items()):
                    raw = gzip.decompress(f.read_bytes())
                    item, problems = _rescore(json.loads(raw), ep, pull, proto)
                    bad += [f"{label} group {ep} pull {pull}: {p}" for p in problems]
                    rel = f.relative_to(out_dir).as_posix()
                    if rel not in pub:
                        bad.append(f"{label} group {ep} pull {pull}: replay not in the leaderboard")
                        continue
                    rid = pub[rel][0]
                    folder_id = internal.setdefault(rid, f"run{len(internal):04d}")
                    run = by_run.setdefault(folder_id, {"run_id": folder_id, "campaign_key": c.key(proto), "episodes": [],
                                                        "created": "0", "items": [], "harness_version": HARNESS_VERSION})
                    pdir = _inside(tmp, runs_dir / folder_id / "episodes" / str(ep))
                    pdir.mkdir(parents=True, exist_ok=True)
                    (pdir / f"pull-{pull}.json").write_bytes(raw)
                    stats = _with_checked(pub[rel][1], derived.get(rel)) if replay else pub[rel][1]
                    (pdir / f"pull-{pull}.stats.json").write_text(json.dumps(stats))
                    item["file"] = f"episodes/{ep}/pull-{pull}.json"
                    items.append(item)
                    checked += 1
                if items and not valid_episode(items, proto["max_pulls"]):
                    bad.append(f"{label} group {ep}: pulls {[i['pull'] for i in items]} aren't a finished group")
                if items:
                    run = by_run[internal[rid]]
                    run["episodes"].append(ep)
                    run["items"] += items
                    (_inside(tmp, runs_dir / run["run_id"] / "episodes" / str(ep)) / "episode.json").write_text(
                        json.dumps({"items": items, "cleared_on": next((i["pull"] for i in items if cleared(i)), None)}))
            for run in by_run.values():
                d = _inside(tmp, runs_dir / run["run_id"])
                d.mkdir(parents=True, exist_ok=True)
                (d / "manifest.json").write_text(json.dumps(run))
        rebuilt = build_results(proto, tmp / "rebuilt", runs_dir)
        back = {v: k for k, v in internal.items()}
        mine = json.loads(json.dumps(rebuilt), object_hook=lambda o: {**o, "run_id": back.get(o["run_id"], o["run_id"])}
                          if isinstance(o.get("run_id"), str) else o)
        if mine != published:
            for path in _diff(published, mine)[:20]:
                bad.append(f"leaderboard.json differs from a rebuild at {path}")
    # Which models really served the calls: recomputed from the published recordings.
    sm = out_dir / "served_models.json"
    if not sm.exists():
        bad.append("served_models.json is missing")
    elif json.loads(sm.read_text()) != served_models(_inside(out_dir, out_dir / "recordings")):
        bad.append("served_models.json differs from the published recordings")
    for b in bad:
        print("FAIL", b)
    if replay:
        print(f"replayed {checked_replays} pulls offline from the published recordings; stats and costs recomputed")
    else:
        print("not replayed: costs and reply counts were taken as published, not checked")
    print(f"protocol {proto['name']} digest {digest[:16]}")
    print(f"verified {checked} pulls and the leaderboard built from them: {'OK' if not bad else f'{len(bad)} problems'}")
    return 1 if bad or not checked else 0


def _diff(a, b, path: str = "") -> list[str]:
    """Where two JSON values differ (paths), for a readable failure."""
    if type(a) is not type(b):
        return [path or "/"]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            out += [f"{path}/{k}"] if k not in a or k not in b else _diff(a[k], b[k], f"{path}/{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [f"{path} (length {len(a)} vs {len(b)})"]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in _diff(x, y, f"{path}[{i}]")]
    return [] if a == b else [path or "/"]


def _replay_from_recordings(out_dir: Path, proto: dict, first: int | None, bad: list[str],
                            derived: dict | None = None) -> int:
    """Play every published group again from the published recordings (no network).
    ``derived`` gets each pull's stats as the replay produced them, with its
    cost at list prices (keyed by the replay's path in the dataset)."""
    from .llm.clients import CachedClient, NoNetwork
    from .llm.progress import run_episode
    n = 0
    for c in combos(proto):
        sub = ("" if c.memory else "memory-off") if c.role != "effort" else f"effort-{c.model['effort']}"
        folder = out_dir / "replays" / c.slug / c.tier / sub
        safe = c.spec.replace(":", "_").replace("/", "_").replace("@", "_")
        client = CachedClient(NoNetwork(c.spec), out_dir / "recordings" / f"{safe}.jsonl", offline=True)
        eps = sorted({int(f.name[2:].split("-pull")[0]) for f in folder.glob("ep*-pull*.json.gz")}) if folder.exists() else []
        for ep in eps:
            try:
                again = run_episode(client, ep, max_pulls=proto["max_pulls"], memory=c.memory,
                                    knowledge=proto["knowledge"], interval_ms=proto.get("interval_ms", 4000),
                                    max_calls=proto.get("max_calls", 300), tier=c.tier, mode=proto["mode"],
                                    seed_base=proto.get("seed_base", DEFAULTS["seed_base"]))
            except Exception as err:  # noqa: BLE001 - any failure is a failed check
                bad.append(f"{c.spec} {c.tier} group {ep}: can't replay from the recordings ({err})")
                continue
            price = spend.price_for(c.spec) or spend.FREE
            for p in again.pulls:
                f = folder / f"ep{ep}-pull{p.pull}.json.gz"
                if derived is not None:
                    st_ = json.loads(json.dumps(p.stats))
                    st_["usd"] = round(price.cost(st_["input_tokens"], st_["output_tokens"],
                                                  st_.get("cache_read_tokens", 0), st_.get("cache_write_tokens", 0)), 4)
                    derived[f.relative_to(out_dir).as_posix()] = st_
                want = json.loads(gzip.decompress(f.read_bytes())) if f.exists() else None
                got = json.loads(json.dumps(p.replay))
                for r in (want, got):
                    if r:
                        r["meta"].pop("run", None)
                n += 1
                if want != got:
                    bad.append(f"{c.spec} {c.tier} group {ep} pull {p.pull}: replay differs from the recordings")
    return n


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


# Per-pull bookkeeping published next to each replay (from the run's stats file):
# money, tokens, and every kind of reply problem, so none of it is hidden.
STAT_KEYS = ("usd", "calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
             "refusals", "unusable_replies", "truncated_replies", "invalid_entries", "api_errors",
             "budget_exhausted", "in_pull", "between_pulls")


def _cell(c: Combo, done: dict, planned: set, out_dir: Path, runs_dir: Path, max_pulls: int) -> dict:
    """One cell's numbers from its finished episodes; copies the replays into the dataset."""
    from .llm.progress import summarize_items
    items, cost, pulls, tokens_in, tokens_out = [], 0.0, 0, 0, 0
    errors = {"refusals": 0, "unusable_replies": 0, "truncated_replies": 0, "invalid_entries": 0, "api_errors": 0,
              "pulls_out_of_calls": 0, "calls": 0}
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
            for k in ("refusals", "unusable_replies", "truncated_replies", "invalid_entries", "api_errors", "calls"):
                errors[k] += stats.get(k, 0) or 0
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
                             "stats": {k: stats[k] for k in STAT_KEYS if k in stats},
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
        # Exact (Clopper-Pearson) interval on the share of groups with a timed clear.
        "clear_rate_ci95": clopper_pearson(sum(1 for e in sorted(done) if any(cleared(i) for i in done[e][1])), n),
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
    items_by: dict[tuple, dict[int, list]] = {}  # (spec, tier, memory) -> episode -> pull items
    for c in combos(proto):
        planned = episode_ids(proto, c)
        done = {e: v for e, v in finished_episodes(c.key(proto), runs_dir, max_pulls).items() if e in planned}
        if not done:
            continue
        scores[(c.spec, c.tier, c.memory)] = {e: _episode_scores(done[e][1], max_pulls) for e in done}
        items_by[(c.spec, c.tier, c.memory)] = {e: [{**i, "episode": e} for i in done[e][1]] for e in done}
        if c.role in ("ranked", "baseline"):
            # The leaderboard uses the same episodes for every model: the
            # protocol's first N. Extra episodes (for the paired control) only
            # feed the learning effect.
            ranked = set(range(proto["episodes"]))
            cell = _cell(c, {e: v for e, v in done.items() if e in ranked}, ranked, out_dir, runs_dir, max_pulls)
            extra = {e: v for e, v in done.items() if e not in ranked}
            if extra:
                # Published too (replays and all): they're half of the paired learning effect.
                cell["paired_episode_list"] = _cell(c, extra, set(extra), out_dir, runs_dir, max_pulls)["episode_list"]
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
        # The memory-on curve over the same groups as the control (not the six ranked ones).
        on_items = items_by[(_spec_of(on_row, proto), ctl["tier"], True)]
        twin_items = [i for e in sorted(off) for i in on_items[e]]
        ctl["paired_on_curve_mean"] = summarize_items(twin_items, max_pulls)["curve_mean"]
        cell = on_row["tiers"].get(ctl["tier"])
        if cell is not None:
            cell["learning_effect"] = round(st.mean(diffs), 1)
            cell["learning_effect_ci95"] = _ci(diffs)
            cell["learning_effect_p"] = paired(diffs)["p"] if len(diffs) > 1 else None
            cell["learning_pairs"] = pairs
    # Effort sweeps compare like with like: the default effort on the same
    # groups as the sweep (its first few), next to the six-group headline.
    for cfg in configs:
        base_row = rows.get(cfg["model"])
        for tier, cell in cfg["tiers"].items():
            base = scores.get((_spec_of(base_row, proto), tier, True)) if base_row else None
            same = [base[e] for e in cell["episode_ids"] if base and e in base]
            if base and len(same) == len(cell["episode_ids"]):
                bcell = base_row["tiers"].get(tier) or {}
                eps = [e for e in (bcell.get("episode_list") or []) + (bcell.get("paired_episode_list") or [])
                       if e["episode"] in cell["episode_ids"]]
                usd = sum(pl.get("usd") or 0.0 for e in eps for pl in e["pulls"])
                cell["default_effort_same_groups"] = {"effort": base_row.get("effort"), "episodes": cell["episode_ids"],
                                                      "progression_score": round(st.mean(same), 1),
                                                      "progression_score_ci95": _ci(same),
                                                      "usd_per_episode": round(usd / len(same), 4)}
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
    # Model against model, on the same seeds: the paired difference of their
    # group scores on the headline tier, group by group (the ranked groups only).
    # An order is claimed only where the Holm-adjusted p (over every pair) is
    # below 0.05; the leaderboard's order itself is descriptive.
    ranked_eps = set(range(proto["episodes"]))
    heads = [(r["model"], scores.get((_spec_of(r, proto), head, True)) or {}) for r in board if r["complete"]]
    pairwise = []
    for i in range(len(heads)):
        for j in range(i + 1, len(heads)):
            (ma, sa), (mb, sb) = heads[i], heads[j]
            eps = sorted(e for e in ranked_eps if e in sa and e in sb)
            res = paired([sa[e] - sb[e] for e in eps])
            if res:
                pairwise.append({"a": ma, "b": mb, "episodes": eps, **res})
    for pw, adj in zip(pairwise, holm([pw["p"] for pw in pairwise])):
        pw["p_holm"] = adj
        pw["claim"] = (pw["a"] if pw["mean"] > 0 else pw["b"]) if adj < 0.05 else None
    result = {
        "pairwise": pairwise,
        "protocol": {k: proto[k] for k in proto if k != "models"} | {"models": [m["id"] for m in proto["models"]]},
        "harness_version": HARNESS_VERSION, "content_version": C.CONTENT_VERSION, "sim_version": SIM_VERSION,
        "tiers": {t: {"name": C.tier(t).name, "affixes": [C.AFFIXES[a].name for a in C.tier(t).affixes]}
                  for t in tiers},
        "headline_tier": head, "leaderboard": board, "baselines": baseline_rows, "controls": controls,
        "configs": configs,
    }
    # The model-reply recordings: with them anyone can replay every pull
    # offline, for free (python -m mythicsim progress ... --offline --cache-dir <this folder>).
    rec_dir = recordings_dir(proto, runs_dir)
    if (out_dir / "recordings").exists():
        shutil.rmtree(out_dir / "recordings")
    for f in sorted(rec_dir.glob("*.jsonl")) if rec_dir.exists() else []:
        (out_dir / "recordings").mkdir(parents=True, exist_ok=True)
        with gzip.GzipFile(out_dir / "recordings" / (f.name + ".gz"), "wb", mtime=0) as g:
            g.write(f.read_bytes())
    (out_dir / "leaderboard.json").write_text(json.dumps(result, indent=1) + "\n")
    (out_dir / "protocol.json").write_text(json.dumps(proto, indent=1) + "\n")
    (out_dir / "served_models.json").write_text(json.dumps(served_models(out_dir / "recordings"), indent=1) + "\n")
    return result


def served_models(rec_dir: Path) -> dict:
    """Per configuration, the model ids the provider reports actually serving
    its calls, with call counts (a provider can route an alias to a dated
    model; this is what ran). Read from the recordings, so anyone can check it."""
    out: dict[str, dict[str, int]] = {}
    for f in sorted(rec_dir.glob("*.jsonl.gz")) if rec_dir.exists() else []:
        for line in gzip.decompress(f.read_bytes()).decode().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            served = out.setdefault(r.get("spec", f.name), {})
            m = r.get("model") or "(not reported)"
            served[m] = served.get(m, 0) + 1
    return {spec: dict(sorted(v.items())) for spec, v in sorted(out.items())}
