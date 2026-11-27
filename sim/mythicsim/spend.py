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

PRICES_AS_OF = "2026-11-23"
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
    # Output tokens one call can bill, when a lab's API can't cap thinking at
    # the request's output cap (None: the cap, MAX_OUTPUT_TOKENS). Only the
    # spending guard's reservation uses it.
    max_output: int | None = None

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
    # Google (paid Standard tier; thinking billed as output; introductory rates
    # through 2026-12-31, about double from 2027-01-01)
    "gemini-3.8-flash": Price(0.75, 3.75, 0.075),
    # xAI (prompts under 200K tokens; ours are far below)
    "grok-4.3": Price(1.25, 2.50, 0.20, max_output=40_000),  # reasoning isn't capped by xAI's API
    # DeepSeek: the peak rate (off-peak is half), so costs here err high
    "deepseek-flash": Price(0.30, 1.20, 0.006),
    # Alibaba Model Studio (international): cache hits at the documented typical
    # 20% of input, as the console shows no separate rate for qwen4-max
    "qwen4-max": Price(1.50, 4.50, 0.30),
}

FREE = Price(0.0, 0.0, 0.0)


def price_for(label: str, price_in: float | None = None, price_out: float | None = None,
              price_cached: float | None = None) -> Price | None:
    """Price for ``provider:model[@effort]``; explicit ``--price-*`` flags win."""
    provider, _, rest = label.partition(":")
    model = rest.partition("@")[0]
    if provider in ("mock", "scripted"):
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
        cap = float(raw) if raw else DEFAULT_PROJECT_CAP_USD
    except ValueError:
        raise SystemExit(f"MYTHICBENCH_TOTAL_BUDGET_USD must be a number of dollars, got {raw!r}") from None
    return finite_usd(cap, "MYTHICBENCH_TOTAL_BUDGET_USD")


def finite_usd(x: float, what: str = "a budget") -> float:
    """A spending limit must be a real, finite, non-negative amount (inf or NaN would disable it)."""
    import math
    if not math.isfinite(x) or x < 0:
        raise SystemExit(f"{what} must be a finite number of dollars >= 0, got {x!r}")
    return x


def read_ledger(path: Path | None = None) -> list[dict]:
    path = path or LEDGER
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def counted(rows: list[dict]) -> list[dict]:
    """The ledger rows that count as money spent. A ``hold`` is written before
    a request is sent and settled by the call's record afterwards; a hold that
    was never settled (the process died mid-request) counts as spent at its
    worst case, since the request may have been billed."""
    settled = {h for r in rows for h in r.get("settles") or ()}
    return [r for r in rows if r.get("kind") != "hold" or r["hold"] not in settled]


def total_spent(path: Path | None = None) -> float:
    return sum(r["usd"] for r in counted(read_ledger(path)))


def summarize_ledger(path: Path | None = None) -> dict:
    rows = counted(read_ledger(path))
    by_model: dict[str, float] = {}
    by_run: dict[str, float] = {}
    for r in rows:
        by_model[r["spec"]] = by_model.get(r["spec"], 0.0) + r["usd"]
        by_run[r.get("run_id") or "?"] = by_run.get(r.get("run_id") or "?", 0.0) + r["usd"]
    spent = sum(by_model.values())
    cap = project_cap()
    return {"cap_usd": cap, "spent_usd": round(spent, 4), "remaining_usd": round(cap - spent, 4),
            "calls": sum(1 for r in rows if not r.get("estimated") and r.get("kind") != "hold"),
            "unsettled_holds": sum(1 for r in rows if r.get("kind") == "hold"),
            "estimated_runs": sum(1 for r in rows if r.get("estimated")),
            "by_model": {k: round(v, 4) for k, v in sorted(by_model.items(), key=lambda kv: -kv[1])},
            "by_run": {k: round(v, 4) for k, v in sorted(by_run.items(), key=lambda kv: -kv[1])}}


class BudgetExceeded(ClientError):
    """The run reached its budget: stop asking the model, keep what's finished."""

    def __init__(self, msg: str):
        super().__init__(msg, fatal=True)


class Guard:
    """A spending cap shared by every metered call in this process.

    Before each real API call, its worst-case cost (its input plus the full
    output cap) is reserved; the call is refused if the reservation would
    cross the cap. Afterwards the reservation becomes the actual cost. So
    calls running in parallel (a campaign's cells, its episodes, the five
    agents) can stop a little early, but never overshoot."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._lock = threading.Lock()
        self.cap: float | None = None
        self.base = 0.0  # spent before this process armed the guard
        self.spent = 0.0
        self.reserved = 0.0

    def arm(self, cap: float, already_spent: float = 0.0) -> None:
        finite_usd(cap, f"the {self.name} budget")
        with self._lock:
            if self.cap is None:
                self.cap, self.base, self.spent, self.reserved = cap, already_spent, 0.0, 0.0

    def disarm(self) -> None:
        with self._lock:
            self.cap = None

    def reserve(self, usd: float) -> None:
        with self._lock:
            if self.cap is not None and self.base + self.spent + self.reserved + usd > self.cap:
                raise BudgetExceeded(f"{self.name} budget of ${self.cap:.2f} reached "
                                     f"(spent ${self.base + self.spent:.2f}, ${self.reserved:.2f} in flight)")
            self.reserved += usd

    def settle(self, reserved: float, cost: float) -> None:
        with self._lock:
            self.reserved -= reserved
            self.spent += cost


_PAID_LOCK = None
_PAID_LOCK_GUARD = threading.Lock()


def claim_paid_lock(runs_dir: Path | None = None) -> None:
    """One process at a time may spend money on this project: two at once
    would each check the cap without seeing the other's calls in flight.
    (Threads in one process share the guards below, so a campaign's parallel
    cells are fine.) Held until the process exits."""
    with _PAID_LOCK_GUARD:  # threads of this process share one claim
        _claim(runs_dir)


def _claim(runs_dir: Path | None) -> None:
    global _PAID_LOCK
    if _PAID_LOCK is not None:
        return
    import fcntl
    d = runs_dir or RUNS_DIR
    d.mkdir(parents=True, exist_ok=True)
    f = open(d / ".paid-run.lock", "w")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        raise SystemExit("another paid run is in progress on this machine (runs/.paid-run.lock): "
                         "run one at a time; a campaign plays its cells in parallel itself") from None
    _PAID_LOCK = f


PROJECT = Guard("project")  # MYTHICBENCH_TOTAL_BUDGET_USD, across everything ever spent
CAMPAIGN = Guard("campaign")  # campaign --budget-usd, across all of a campaign's cells


# Tokens a request adds beyond its text (roles, message framing, the system
# block): a generous allowance.
MESSAGE_OVERHEAD_TOKENS = 512
# PRICES are short-context rates; some models charge more above a prompt size
# (Haiku, for one, above 100,000 input tokens). Our prompts are a few thousand
# tokens; a request whose upper bound passes this is refused, never sent.
MAX_PRICED_INPUT_TOKENS = 100_000


def input_token_bound(system: str, user: str) -> int:
    """At most one token per UTF-8 byte, plus message overhead (surrogatepass:
    never fails on odd text; a lone surrogate counts its 3 bytes)."""
    return (len(system.encode("utf-8", "surrogatepass")) + len(user.encode("utf-8", "surrogatepass"))
            + MESSAGE_OVERHEAD_TOKENS)


def worst_case_usd(price: Price, system: str, user: str) -> float:
    """An upper bound for one call, not an estimate: a token is never shorter
    than one byte, so the input is at most its UTF-8 bytes plus message
    overhead, all priced at the dearest input rate (Anthropic bills prompt-cache
    writes above the plain input rate); the output is the full cap, thinking
    included (the request sets it as the maximum)."""
    from .llm.clients import MAX_OUTPUT_TOKENS
    tokens_in = input_token_bound(system, user)
    rate_in = max(price.input, price.write if price.write is not None else price.input)
    return (tokens_in * rate_in + (price.max_output or MAX_OUTPUT_TOKENS) * price.output) / 1e6


@dataclass
class CostMeter:
    """Wraps a client and adds up what its calls cost.

    Placed *inside* the replay cache it sees only real API calls: with
    ``limit_usd`` (the run's budget) and ``ledger`` it reserves each call's
    worst case against the run budget, the campaign budget and the project
    cap before sending it, and logs what it cost. Placed *outside* the cache
    (no limit, no ledger) it measures what the run would cost from scratch,
    which is the number to report next to a score.
    """
    inner: ChatClient
    price: Price
    limit_usd: float | None = None
    ledger: Path | None = None
    run_id: str | None = None
    spec: str = ""
    usd: float = 0.0
    calls: int = 0
    reserved: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def __post_init__(self) -> None:
        self.spec = self.inner.spec

    def _hold(self, est: float, held: list) -> str | None:
        """Hold ``est`` against the run budget and every cap, and write the hold
        to the ledger (on disk) before the request goes out. Raises
        BudgetExceeded, holding nothing, if it doesn't fit."""
        if getattr(self, "_over", False):
            raise BudgetExceeded("a call cost more than its worst-case hold, so the caps can't be guaranteed: "
                                 "stopping (check the price table and token counts)")
        with self._lock:
            if self.limit_usd is not None and self.usd + self.reserved + est > self.limit_usd:
                raise BudgetExceeded(f"budget of ${self.limit_usd:.2f} reached (spent ${self.usd:.2f})")
            self.reserved += est
        got = []
        try:
            for g in (PROJECT, CAMPAIGN) if self.ledger is not None else ():
                g.reserve(est)
                got.append(g)
        except BudgetExceeded:
            for g in got:
                g.settle(est, 0.0)
            with self._lock:
                self.reserved -= est
            raise
        held.append(est)
        if self.ledger is None:
            return None
        import uuid
        hid = uuid.uuid4().hex
        self._write({"kind": "hold", "hold": hid, "usd": round(est, 6), "spec": self.spec, "run_id": self.run_id})
        return hid

    def _write(self, rec: dict) -> None:
        rec = {"t": datetime.now(timezone.utc).isoformat(timespec="seconds"), **rec}
        with self._lock:
            self.ledger.parent.mkdir(parents=True, exist_ok=True)
            with self.ledger.open("a") as f:
                f.write(json.dumps(rec) + "\n")
                f.flush()
                os.fsync(f.fileno())  # on disk before the request is sent

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        metered = self.ledger is not None or self.limit_usd is not None
        if metered and input_token_bound(system, user) > MAX_PRICED_INPUT_TOKENS:
            err = ClientError(f"prompt of up to {input_token_bound(system, user):,} tokens is past the "
                              f"{MAX_PRICED_INPUT_TOKENS:,}-token short-context pricing the price table assumes; "
                              "not sent", fatal=True)
            err.not_billed = True
            raise err
        est = worst_case_usd(self.price, system, user) if metered else 0.0
        held: list[float] = []  # one hold per attempt that went out
        holds: list[str] = []  # their ids in the ledger
        maybe_billed = 0  # earlier attempts that failed in a way that may have been billed
        if metered:
            hid = self._hold(est, held)
            if hid:
                holds.append(hid)

        def before_resend() -> None:
            # The last attempt failed after it may have reached the model
            # (a timeout, a dropped connection, a server error): it counts as
            # spent at its worst case, and the resend needs a hold of its own.
            nonlocal maybe_billed
            maybe_billed += 1
            if metered:
                h = self._hold(est, held)
                if h:
                    holds.append(h)

        from .llm import clients as _clients
        _clients._RESEND.hook = before_resend
        cost = 0.0
        reply = None
        try:
            reply = self.inner.complete(system, user, tag=tag)
            cost = self.price.reply_cost(reply)
        except BaseException as err:
            # Anything after the request went out may have been billed, unless
            # it's known not to be (a refused request: 4xx, rate limit, overload)
            # or it was our own budget stopping a resend.
            if not getattr(err, "not_billed", False) and not isinstance(err, BudgetExceeded):
                maybe_billed += 1
            raise
        finally:
            _clients._RESEND.hook = None
            assumed = est * maybe_billed if metered else 0.0
            spent = cost + assumed
            for g in (PROJECT, CAMPAIGN) if metered and self.ledger is not None else ():
                g.settle(sum(held), spent)
            with self._lock:
                self.reserved -= sum(held)
                self.usd += spent
                self.calls += 1
            if self.ledger is not None:
                rec = {"run_id": self.run_id, "spec": self.spec, "usd": round(spent, 6),
                       "in": reply.input_tokens if reply else 0, "out": reply.output_tokens if reply else 0,
                       "cache_read": reply.cache_read_tokens if reply else 0,
                       "cache_write": reply.cache_write_tokens if reply else 0, "settles": holds}
                if maybe_billed:
                    rec["assumed"] = f"{maybe_billed} attempt(s) that may have been billed, counted at worst case"
                if spent > sum(held) + 1e-9:
                    rec["over_hold"] = True  # can't happen with a true upper bound; if it does, stop spending
                self._write(rec)
            if metered and spent > sum(held) + 1e-9:
                self._over = True
        return reply


# ---------------------------------------------------------------------------
# Up-front estimate
# ---------------------------------------------------------------------------

# Measured in the five-agent pilot (Haiku and GPT-6 Luna, +10, Nov 2026): about
# 500 calls per dungeon pull plus ~20 between pulls (talk and notes), ~5,600
# input tokens per call with ~69% read from the prompt cache, and ~600 output
# tokens per call for Haiku. Thinking models write more: the fallback assumes
# 1,000 output tokens per call, so it errs high for them.
CALLS_PER_FIGHT = {"boss": 300, "dungeon": 520}
EST_INPUT, EST_CACHED_SHARE, EST_OUTPUT = 5600, 0.69, 1000


def estimate_fight_usd(price: Price, mode: str, label: str, path: Path | None = None) -> tuple[float, str]:
    """Rough cost of one pull (talk and notes included): this model's own past
    calls when there are some, else the measured five-agent profile with a
    generous output allowance (so it errs high)."""
    past = [r for r in read_ledger(path) if r.get("spec") == label and r.get("kind") != "hold"
            and not r.get("estimated")]
    calls = CALLS_PER_FIGHT.get(mode, 150)
    if len(past) >= 20:
        per_call = sum(r["usd"] for r in past) / len(past)
        return per_call * calls, f"from {len(past)} past calls of {label}"
    cached = int(EST_INPUT * EST_CACHED_SHARE)
    per_call = price.cost(EST_INPUT, EST_OUTPUT, cached, 0)
    return per_call * calls, "from a default token profile (no history for this model yet; thinking models cost more)"


def stats_cost(price: Price, st: dict) -> float:
    """List-price cost of one fight from its saved stats."""
    return price.cost(st.get("input_tokens", 0), st.get("output_tokens", 0),
                      st.get("cache_read_tokens", 0), st.get("cache_write_tokens", 0))
