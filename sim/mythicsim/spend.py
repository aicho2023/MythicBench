"""What model runs cost, and a guard so they can't cost more than you allow.

Two limits protect the wallet:

* a **per-run budget** (``--budget-usd``, default $20): the run stops cleanly
  once its real API spend reaches it, keeping every fight finished so far;
* a **project cap** (``MYTHICBENCH_TOTAL_BUDGET_USD`` in ``.env``, default
  $500): every real API call is appended to ``runs/spend.jsonl``, and no run
  may spend past what is left of the cap.

Replies served from the replay recording cost nothing and are not charged.
Prices are list prices in USD per million tokens; check them against the
providers' pricing pages when adding a model (``PRICES_AS_OF``).
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .llm.clients import ChatClient, ClientError, Reply, load_env
from .runs import RUNS_DIR

PRICES_AS_OF = "2026-11-21"
DEFAULT_RUN_BUDGET_USD = 20.0
DEFAULT_PROJECT_CAP_USD = 500.0
LEDGER = RUNS_DIR / "spend.jsonl"


@dataclass(frozen=True)
class Price:
    """USD per 1M tokens. ``cached``: input read from the provider's prompt
    cache; ``write``: input written to it (Anthropic charges extra for that)."""
    input: float
    output: float
    cached: float
    write: float | None = None

    def cost(self, input_tokens: int, output_tokens: int, cache_read: int = 0, cache_write: int = 0) -> float:
        fresh = max(0, input_tokens - cache_read - cache_write)
        write = self.input if self.write is None else self.write
        return (fresh * self.input + cache_read * self.cached + cache_write * write
                + output_tokens * self.output) / 1e6

    def reply_cost(self, r: Reply) -> float:
        return self.cost(r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens)


def _anthropic(inp: float, out: float, cached: float | None = None) -> Price:
    # Prompt-cache writes cost 1.25x input; reads default to 0.1x when unlisted
    # (newer models are cheaper than that, so the default errs high).
    return Price(inp, out, inp * 0.1 if cached is None else cached, inp * 1.25)


PRICES: dict[str, Price] = {
    # Anthropic (first-party API)
    "claude-fable-5-2": _anthropic(8.00, 40.00, 0.20),
    "claude-fable-5-1": _anthropic(10.00, 50.00),
    "claude-fable-5": _anthropic(10.00, 50.00),
    "claude-opus-5-5": _anthropic(4.00, 20.00, 0.20),
    "claude-opus-5": _anthropic(5.00, 25.00),
    "claude-opus-4-8": _anthropic(5.00, 25.00),
    "claude-sonnet-5-5": _anthropic(2.00, 10.00, 0.10),
    "claude-sonnet-5": _anthropic(2.00, 10.00),
    "claude-haiku-5-5": _anthropic(0.10, 0.50),
    "claude-haiku-4-5": _anthropic(1.00, 5.00),
    # OpenAI (standard tier, short context)
    "gpt-6.2-astra": Price(8.00, 40.00, 0.40),
    "gpt-6.2-sol": Price(2.00, 10.00, 0.10),
    "gpt-6-astra": Price(10.00, 50.00, 1.00),
    "gpt-6.1-sol": Price(2.00, 10.00, 0.10),
    "gpt-6.1-terra": Price(1.00, 5.00, 0.05),
    "gpt-6-sol": Price(2.00, 10.00, 0.20),
    "gpt-6-luna": Price(0.10, 0.50, 0.01),
    "gpt-5.6-sol": Price(4.00, 20.00, 0.40),
    "gpt-5.6-terra": Price(2.00, 12.00, 0.20),
    "gpt-5.6-luna": Price(0.20, 1.20, 0.02),
    "gpt-5.4": Price(2.50, 15.00, 0.25),
    "gpt-5.4-mini": Price(0.75, 4.50, 0.075),
    "gpt-5.4-nano": Price(0.20, 1.25, 0.02),
    "gpt-4.1-mini": Price(0.40, 1.60, 0.10),
}

FREE = Price(0.0, 0.0, 0.0)


def price_for(label: str, price_in: float | None = None, price_out: float | None = None,
              price_cached: float | None = None) -> Price | None:
    """Price for ``provider:model[@effort]``; explicit ``--price-*`` flags win."""
    provider, _, rest = label.partition(":")
    model = rest.partition("@")[0]
    if provider == "mock":
        return FREE
    if price_in is not None and price_out is not None:
        return Price(price_in, price_out, price_in if price_cached is None else price_cached)
    return PRICES.get(model)


# ---------------------------------------------------------------------------
# Ledger and caps
# ---------------------------------------------------------------------------

def project_cap() -> float:
    load_env()
    raw = os.environ.get("MYTHICBENCH_TOTAL_BUDGET_USD", "").strip()
    try:
        return float(raw) if raw else DEFAULT_PROJECT_CAP_USD
    except ValueError:
        raise SystemExit(f"MYTHICBENCH_TOTAL_BUDGET_USD must be a number of dollars, got {raw!r}")


def read_ledger(path: Path | None = None) -> list[dict]:
    path = path or LEDGER
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def total_spent(path: Path | None = None) -> float:
    return sum(r["usd"] for r in read_ledger(path))


def summarize_ledger(path: Path | None = None) -> dict:
    rows = read_ledger(path)
    by_model: dict[str, float] = {}
    by_run: dict[str, float] = {}
    for r in rows:
        by_model[r["spec"]] = by_model.get(r["spec"], 0.0) + r["usd"]
        by_run[r.get("run_id") or "?"] = by_run.get(r.get("run_id") or "?", 0.0) + r["usd"]
    spent = sum(by_model.values())
    cap = project_cap()
    return {"cap_usd": cap, "spent_usd": round(spent, 4), "remaining_usd": round(cap - spent, 4),
            "calls": sum(1 for r in rows if not r.get("estimated")),
            "estimated_runs": sum(1 for r in rows if r.get("estimated")),
            "by_model": {k: round(v, 4) for k, v in sorted(by_model.items(), key=lambda kv: -kv[1])},
            "by_run": {k: round(v, 4) for k, v in sorted(by_run.items(), key=lambda kv: -kv[1])}}


class BudgetExceeded(ClientError):
    """The run reached its budget: stop asking the model, keep what's finished."""

    def __init__(self, msg: str):
        super().__init__(msg, fatal=True)


class ProjectGuard:
    """The project cap, enforced live across every run in this process.

    Each run checks the cap when it starts, but runs played in parallel (a
    campaign's cells) would each see the same money left. This adds up what
    all metered runs in the process have spent since the guard was armed."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.cap: float | None = None
        self.base = 0.0
        self.spent = 0.0

    def arm(self, cap: float, already_spent: float) -> None:
        with self._lock:
            if self.cap is None:
                self.cap, self.base, self.spent = cap, already_spent, 0.0

    def check(self) -> None:
        if self.cap is not None and self.base + self.spent >= self.cap:
            raise BudgetExceeded(f"project budget of ${self.cap:.2f} reached (spent ${self.base + self.spent:.2f})")

    def add(self, usd: float) -> None:
        with self._lock:
            self.spent += usd


PROJECT = ProjectGuard()


@dataclass
class CostMeter:
    """Wraps a client and adds up what its calls cost.

    Placed *inside* the replay cache it sees only real API calls: with
    ``limit_usd`` it refuses calls once the limit is reached, and with
    ``ledger`` it appends each call to the project spend log. Placed *outside*
    the cache (no limit, no ledger) it measures what the run would cost from
    scratch, which is the number to report next to a score.
    """
    inner: ChatClient
    price: Price
    limit_usd: float | None = None
    ledger: Path | None = None
    run_id: str | None = None
    spec: str = ""
    usd: float = 0.0
    calls: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def __post_init__(self) -> None:
        self.spec = self.inner.spec

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        # Calls already in flight on other threads may finish after the limit
        # is reached, so a run can overshoot by about one call per worker.
        if self.limit_usd is not None and self.usd >= self.limit_usd:
            raise BudgetExceeded(f"budget of ${self.limit_usd:.2f} reached (spent ${self.usd:.2f})")
        if self.ledger is not None:
            PROJECT.check()
        reply = self.inner.complete(system, user, tag=tag)
        cost = self.price.reply_cost(reply)
        if self.ledger is not None:
            PROJECT.add(cost)
        with self._lock:
            self.usd += cost
            self.calls += 1
            if self.ledger is not None:
                self.ledger.parent.mkdir(parents=True, exist_ok=True)
                with self.ledger.open("a") as f:
                    f.write(json.dumps({
                        "t": datetime.now(timezone.utc).isoformat(timespec="seconds"), "run_id": self.run_id,
                        "spec": self.spec, "usd": round(cost, 6), "in": reply.input_tokens,
                        "out": reply.output_tokens, "cache_read": reply.cache_read_tokens,
                        "cache_write": reply.cache_write_tokens}) + "\n")
        return reply


# ---------------------------------------------------------------------------
# Up-front estimate
# ---------------------------------------------------------------------------

# Measured on the boss fight with Haiku (Nov 2026): ~3,900 input tokens per call,
# ~70% of them read from the prompt cache, and ~550 output tokens without
# thinking. A dungeon run makes about 1.5x the calls of the boss fight.
CALLS_PER_FIGHT = {"boss": 100, "dungeon": 150}
EST_INPUT, EST_CACHED_SHARE, EST_OUTPUT = 3900, 0.7, 550


def estimate_fight_usd(price: Price, mode: str, label: str, path: Path | None = None) -> tuple[float, str]:
    """Rough cost of one fight: from this model's own past calls when there are
    some, else from the measured Haiku profile (which knows nothing about how
    much a thinking model writes, so treat it as a floor for those)."""
    past = [r for r in read_ledger(path) if r["spec"] == label]
    calls = CALLS_PER_FIGHT.get(mode, 150)
    if len(past) >= 20:
        per_call = sum(r["usd"] for r in past) / len(past)
        return per_call * calls, f"from {len(past)} past calls of {label}"
    cached = int(EST_INPUT * EST_CACHED_SHARE)
    per_call = price.cost(EST_INPUT, EST_OUTPUT, cached, 0)
    return per_call * calls, "from a default token profile (no history for this model yet; thinking models cost more)"


# ---------------------------------------------------------------------------
# Runs made before the ledger existed
# ---------------------------------------------------------------------------

def stats_cost(price: Price, st: dict, fresh_only: bool = False) -> float:
    """Cost of one fight from its saved stats. ``fresh_only``: count only the
    share of calls that really went to the API (not served from the recording)."""
    usd = price.cost(st.get("input_tokens", 0), st.get("output_tokens", 0),
                     st.get("cache_read_tokens", 0), st.get("cache_write_tokens", 0))
    if fresh_only and st.get("calls"):
        usd *= max(0, st["calls"] - st.get("cached_calls", 0)) / st["calls"]
    return usd


def backfill(runs_dir: Path | None = None, path: Path | None = None) -> list[tuple[str, float]]:
    """Add an estimated ledger line for each saved run that has none, so money
    spent before the guard existed still counts against the cap. Estimates come
    from each fight's token counts (reflection calls weren't recorded, so they
    run slightly low)."""
    runs_dir, path = runs_dir or RUNS_DIR, path or LEDGER
    known = {r.get("run_id") for r in read_ledger(path)}
    added = []
    for mf in sorted(runs_dir.glob("*/manifest.json")):
        m = json.loads(mf.read_text())
        rid = m.get("run_id")
        if rid in known or m.get("offline"):
            continue
        price = price_for(m.get("label") or "")
        if price is None or price is FREE:
            continue
        usd = sum(stats_cost(price, json.loads(p.read_text()), fresh_only=True)
                  for p in mf.parent.rglob("*.stats.json"))
        if usd <= 0:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps({"t": m.get("created"), "run_id": rid, "spec": m.get("label"),
                                "usd": round(usd, 6), "estimated": True}) + "\n")
        added.append((rid, usd))
    return added
