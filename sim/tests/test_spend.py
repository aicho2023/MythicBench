"""The spend guard: prices, the per-run budget, the project cap, and the ledger."""

from __future__ import annotations

import functools
import json
import sys

import pytest

from mythicsim import __main__ as cli
from mythicsim import runs as R
from mythicsim import spend
from mythicsim.llm.clients import CachedClient, MockClient, Reply


class Paid:
    """Looks like a paid model; answers like the mock, with fixed token counts."""

    def __init__(self, spec="anthropic:claude-haiku-5-5", inp=1000, out=20_000):
        self.spec, self.inp, self.out, self.calls = spec, inp, out, 0
        self._mock = MockClient()

    def complete(self, system, user, tag=""):
        self.calls += 1
        r = self._mock.complete(system, user, tag)
        return Reply(r.text, self.inp, self.out, 0.0)


def test_price_math():
    p = spend.PRICES["claude-sonnet-5-5"]
    assert p.cost(1_000_000, 0) == pytest.approx(2.00)
    assert p.cost(0, 1_000_000) == pytest.approx(10.00)
    # 1M input of which 600k read from the cache and 100k written to it
    assert p.cost(1_000_000, 0, cache_read=600_000, cache_write=100_000) == pytest.approx(
        0.3 * 2.00 + 0.6 * 0.10 + 0.1 * 2.50)


def test_price_lookup():
    assert spend.price_for("anthropic:claude-opus-5-5@low") is spend.PRICES["claude-opus-5-5"]
    assert spend.price_for("openai:gpt-5.4-mini") is spend.PRICES["gpt-5.4-mini"]
    assert spend.price_for("mock:basic") is spend.FREE
    assert spend.price_for("openai:some-new-model") is None
    custom = spend.price_for("openai:some-new-model", 1.0, 4.0)
    assert (custom.input, custom.output, custom.cached) == (1.0, 4.0, 1.0)


def test_meter_stops_at_its_limit_and_logs_each_call(tmp_path):
    ledger = tmp_path / "spend.jsonl"
    inner = Paid(inp=0, out=200_000)  # $0.10 per call on Haiku
    m = spend.CostMeter(inner, spend.PRICES["claude-haiku-5-5"], limit_usd=0.25, ledger=ledger, run_id="r1")
    for _ in range(3):
        m.complete("s", "u")
    with pytest.raises(spend.BudgetExceeded):
        m.complete("s", "u")
    assert inner.calls == 3
    rows = spend.read_ledger(ledger)
    assert len(rows) == 3 and all(r["run_id"] == "r1" for r in rows)
    assert spend.total_spent(ledger) == pytest.approx(0.30)


def test_recorded_replies_are_free(tmp_path):
    ledger = tmp_path / "spend.jsonl"
    meter = spend.CostMeter(Paid(), spend.PRICES["claude-haiku-5-5"], limit_usd=10, ledger=ledger)
    client = CachedClient(meter, tmp_path / "rec.jsonl")
    tally = spend.CostMeter(client, spend.PRICES["claude-haiku-5-5"])
    tally.complete("s", "same prompt")
    tally.complete("s", "same prompt")
    assert meter.calls == 1 and len(spend.read_ledger(ledger)) == 1  # paid once
    assert tally.calls == 2 and tally.usd == pytest.approx(2 * meter.usd)  # but costs count twice at list price


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """Point runs, the viewer catalog, and the ledger at a temp folder, and
    make every 'anthropic:' model a fake that costs $0.01 per call."""
    runs_dir, out_dir = tmp_path / "runs", tmp_path / "local"
    monkeypatch.setattr(R, "RUNS_DIR", runs_dir)
    monkeypatch.setattr(R, "new_run", functools.partial(R.new_run, runs_dir=runs_dir))
    monkeypatch.setattr(R, "finish_run", functools.partial(R.finish_run, runs_dir=runs_dir))
    monkeypatch.setattr(R, "publish", functools.partial(R.publish, runs_dir=runs_dir, out_dir=out_dir))
    monkeypatch.setattr(spend, "LEDGER", tmp_path / "spend.jsonl")
    monkeypatch.setenv("MYTHICBENCH_TOTAL_BUDGET_USD", "100")
    monkeypatch.setattr(cli, "make_client", lambda spec, effort=None: Paid(spec))
    return runs_dir


def run_cli(*argv):
    old = sys.argv
    sys.argv = ["mythicsim", *argv]
    try:
        cli.main()
    finally:
        sys.argv = old


def manifest(runs_dir):
    (path,) = runs_dir.glob("*/manifest.json")
    return json.loads(path.read_text())


def mock_calls_per_fight(seed=0):
    from mythicsim.llm.policy import make_llm_policies
    policies, brain = make_llm_policies(MockClient(), interval_ms=2000, max_calls=300, mode="boss", scope=f"s{seed}")
    cli.make_encounter(seed, policies, "x", "plus10", "boss").run()
    return brain.stats.calls


def test_budget_stops_a_run_and_keeps_finished_fights(sandbox, capsys):
    # The same fight three times at $0.01 a call: the budget covers one and a half.
    n = mock_calls_per_fight()
    budget = round(n * 1.5 * 0.01, 2)
    run_cli("llm", "--model", "anthropic:claude-haiku-5-5", "--mode", "boss", "--seeds", "0,0,0",
            "--budget-usd", str(budget), "--no-cache")
    m = manifest(sandbox)
    assert m["status"] == "stopped" and "budget" in m["note"]
    assert [i["seed"] for i in m["items"]] == [0]
    # Each call reserves its worst case first, so the run stops at or under its budget, never over.
    assert budget - 0.5 <= m["summary"]["spent_usd"] <= budget
    assert spend.total_spent() == pytest.approx(m["summary"]["spent_usd"])
    assert "STOPPED EARLY" in capsys.readouterr().out
    cat = json.loads((sandbox.parent / "local" / "catalog.json").read_text())
    assert cat["runs"][0]["status"] == "stopped"  # still browsable


def test_project_cap_limits_and_blocks_runs(sandbox, monkeypatch):
    spend.LEDGER.parent.mkdir(parents=True, exist_ok=True)
    spend.LEDGER.write_text(json.dumps({"run_id": "old", "spec": "x", "usd": 99.9}) + "\n")
    with pytest.raises(SystemExit):
        # only $0.10 of the $100 cap is left, so the run's $20 budget shrinks to that
        run_cli("llm", "--model", "anthropic:claude-haiku-5-5", "--mode", "boss", "--seeds", "0", "--no-cache")
    assert manifest(sandbox)["budget_usd"] == pytest.approx(0.10)
    assert spend.total_spent() == pytest.approx(100.0, abs=0.011)
    with pytest.raises(SystemExit, match="budget used up"):
        run_cli("llm", "--model", "anthropic:claude-haiku-5-5", "--mode", "boss", "--seeds", "1", "--no-cache")


def test_unpriced_models_are_refused(sandbox, monkeypatch):
    with pytest.raises(SystemExit, match="no price known"):
        run_cli("llm", "--model", "openai:some-new-model", "--mode", "boss", "--seeds", "0", "--no-cache")


def test_offline_and_mock_runs_skip_the_guard(sandbox):
    run_cli("progress", "--model", "mock:basic", "--mode", "boss", "--episodes", "0", "--max-pulls", "1",
            "--budget-usd", "0")
    m = manifest(sandbox)
    assert m["status"] == "done" and m["budget_usd"] is None
    assert spend.total_spent() == 0
