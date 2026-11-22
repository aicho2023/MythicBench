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

    def __init__(self, spec="anthropic:claude-haiku-5-5", inp=1000, out=8_000):  # at most the real output cap
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
    inner = Paid(inp=0, out=8_000)  # $0.10 per call at this price (the most a call can cost)
    price = spend.Price(input=1.0, output=12.5, cached=1.0)
    m = spend.CostMeter(inner, price, limit_usd=0.25, ledger=ledger, run_id="r1")
    for _ in range(2):
        m.complete("s", "u")
    with pytest.raises(spend.BudgetExceeded):  # a third would be over: never overshoot
        m.complete("s", "u")
    assert inner.calls == 2
    rows = spend.read_ledger(ledger)
    calls = [r for r in rows if r.get("kind") != "hold"]
    holds = [r for r in rows if r.get("kind") == "hold"]
    assert len(calls) == 2 and len(holds) == 2 and all(r["run_id"] == "r1" for r in rows)
    assert all(h["hold"] in {x for r in calls for x in r["settles"]} for h in holds)  # every hold settled
    assert spend.total_spent(ledger) == pytest.approx(0.20)


def test_recorded_replies_are_free(tmp_path):
    ledger = tmp_path / "spend.jsonl"
    meter = spend.CostMeter(Paid(), spend.PRICES["claude-haiku-5-5"], limit_usd=10, ledger=ledger)
    client = CachedClient(meter, tmp_path / "rec.jsonl")
    tally = spend.CostMeter(client, spend.PRICES["claude-haiku-5-5"])
    tally.complete("s", "same prompt")
    tally.complete("s", "same prompt")
    assert meter.calls == 1 and len(spend.counted(spend.read_ledger(ledger))) == 1  # paid once
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
    # $0.01 for a call's full output cap, so a fake call costs about $0.01
    monkeypatch.setitem(spend.PRICES, "claude-haiku-5-5", spend.Price(input=0.1, output=1.25, cached=0.01))
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
    # What's left is less than one call's worst case: the next run can't start a call.
    with pytest.raises(SystemExit, match="budget used up|budget of \\$0\\.0[01] reached"):
        run_cli("llm", "--model", "anthropic:claude-haiku-5-5", "--mode", "boss", "--seeds", "1", "--no-cache")
    assert spend.total_spent() <= 100.0


def test_unpriced_models_are_refused(sandbox, monkeypatch):
    with pytest.raises(SystemExit, match="no price known"):
        run_cli("llm", "--model", "openai:some-new-model", "--mode", "boss", "--seeds", "0", "--no-cache")


def test_offline_and_mock_runs_skip_the_guard(sandbox):
    run_cli("progress", "--model", "mock:basic", "--mode", "boss", "--episodes", "0", "--max-pulls", "1",
            "--budget-usd", "0")
    m = manifest(sandbox)
    assert m["status"] == "done" and m["budget_usd"] is None
    assert spend.total_spent() == 0


def test_the_reservation_covers_cache_write_pricing():
    """Anthropic bills prompt-cache writes above the input rate: the hold must cover it."""
    p = spend.Price(input=3.0, output=15.0, cached=0.3, write=3.75)
    system, user = "x" * 30_000, "y" * 3_000
    est = spend.worst_case_usd(p, system, user)
    # A real reply could be every input token a cache write (3-4 chars a token) plus the full output cap.
    from mythicsim.llm.clients import MAX_OUTPUT_TOKENS
    worst_real = p.cost(len(system + user) // 3, MAX_OUTPUT_TOKENS, 0, len(system + user) // 3)
    assert est >= worst_real


def test_a_timed_out_attempt_is_counted_and_held_for(monkeypatch, tmp_path):
    """A request that timed out may have been billed: the meter counts it at its
    worst case and holds money for the resend, so the cap still can't be crossed."""
    from mythicsim.llm import clients as cl
    p = spend.Price(input=1.0, output=1.0, cached=1.0)

    class Flaky:
        spec = "fake:flaky"

        def complete(self, system, user, tag=""):
            cl._before_resend()  # one attempt timed out; the client is about to resend
            return cl.Reply('{"say": "ok"}', 100, 10)

    m = spend.CostMeter(Flaky(), p, limit_usd=10.0, ledger=tmp_path / "ledger.jsonl")
    m.complete("s" * 100, "u")
    est = spend.worst_case_usd(p, "s" * 100, "u")
    assert abs(m.usd - (p.cost(100, 10) + est)) < 1e-12 and m.reserved == 0
    assert "assumed" in (tmp_path / "ledger.jsonl").read_text()
    tight = spend.CostMeter(Flaky(), p, limit_usd=est * 1.5, ledger=tmp_path / "l2.jsonl")
    with pytest.raises(spend.BudgetExceeded):  # no room to hold the resend: stop, don't overspend
        tight.complete("s" * 100, "u")
    assert tight.usd <= est * 1.5 and tight.reserved == 0


def test_only_one_paid_process_at_a_time(tmp_path, monkeypatch):
    import subprocess
    import sys
    monkeypatch.setattr(spend, "_PAID_LOCK", None)
    spend.claim_paid_lock(tmp_path)
    code = ("import sys; from pathlib import Path; from mythicsim import spend\n"
            f"spend.claim_paid_lock(Path({str(tmp_path)!r}))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert r.returncode != 0 and "another paid run" in r.stderr + r.stdout
    spend._PAID_LOCK.close()
    monkeypatch.setattr(spend, "_PAID_LOCK", None)



def test_a_crash_mid_request_leaves_its_hold_counted(tmp_path):
    """The hold is on disk before the request goes out: if the process dies
    before settling, the next process counts it as spent (it may have been billed)."""
    ledger = tmp_path / "spend.jsonl"
    price = spend.Price(input=1.0, output=1.0, cached=1.0)

    class Dies:
        spec = "fake:dies"

        def complete(self, system, user, tag=""):
            # Simulate the process dying mid-request: read the ledger as the next process would.
            raise SystemExit(f"{spend.total_spent(ledger):.6f}")

    m = spend.CostMeter(Dies(), price, limit_usd=1.0, ledger=ledger)
    with pytest.raises(SystemExit) as died:
        m.complete("s" * 100, "u")
    est = spend.worst_case_usd(price, "s" * 100, "u")
    assert float(str(died.value)) == pytest.approx(est, abs=1e-6)  # counted while in flight


@pytest.mark.parametrize("code,billed", [(504, True), (500, True), (429, False), (529, False), (400, False)])
def test_http_failures_are_counted_by_whether_they_may_be_billed(monkeypatch, tmp_path, code, billed):
    """A server error may come after the model ran: the resend gets a hold of its own and the
    failed attempt counts as spent. A rate limit, overload or bad request was never run."""
    import io
    import urllib.error
    from mythicsim.llm import clients as cl
    sent = []

    def fake_urlopen(req, timeout=0):
        sent.append(1)
        if len(sent) == 1:
            raise urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(b"{}"))
        return io.BytesIO(b'{"content": [{"type": "text", "text": "{}"}], "usage": {"input_tokens": 1, "output_tokens": 1}}')

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(cl.urllib.request, "urlopen", lambda req, timeout=0: Resp(fake_urlopen(req).read()))
    monkeypatch.setattr(cl.time, "sleep", lambda s: None)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    price = spend.Price(input=1.0, output=1.0, cached=1.0)
    client = cl.AnthropicClient("claude-haiku-5-5", effort="low")
    m = spend.CostMeter(client, price, limit_usd=10.0, ledger=tmp_path / "l.jsonl")
    if code == 400:
        with pytest.raises(cl.ClientError):
            m.complete("s", "u")
        assert m.usd == 0.0 and len(sent) == 1
        return
    m.complete("s", "u")
    est = spend.worst_case_usd(price, "s", "u")
    holds = [r for r in spend.read_ledger(tmp_path / "l.jsonl") if r.get("kind") == "hold"]
    assert len(sent) == 2
    assert len(holds) == (2 if billed else 1)
    assert (m.usd >= est) == billed


def test_an_unreadable_answer_counts_as_spent(monkeypatch, tmp_path):
    import io
    from mythicsim.llm import clients as cl

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(cl.urllib.request, "urlopen", lambda req, timeout=0: Resp(b"<html>oops</html>"))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    price = spend.Price(input=1.0, output=1.0, cached=1.0)
    m = spend.CostMeter(cl.AnthropicClient("claude-haiku-5-5", effort="low"), price, limit_usd=10.0,
                        ledger=tmp_path / "l.jsonl")
    with pytest.raises(cl.ClientError):
        m.complete("s", "u")
    assert m.usd == pytest.approx(spend.worst_case_usd(price, "s", "u"))


@pytest.mark.parametrize("bad", ["inf", "nan", "-5"])
def test_a_cap_must_be_finite(monkeypatch, bad):
    monkeypatch.setenv("MYTHICBENCH_TOTAL_BUDGET_USD", bad)
    with pytest.raises(SystemExit):
        spend.project_cap()


def test_threads_of_one_process_share_the_paid_lock(tmp_path, monkeypatch):
    import threading
    monkeypatch.setattr(spend, "_PAID_LOCK", None)
    errors, go = [], threading.Barrier(8)

    def claim():
        go.wait()
        try:
            spend.claim_paid_lock(tmp_path)
        except SystemExit as err:
            errors.append(err)
    ts = [threading.Thread(target=claim) for _ in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert not errors
    spend._PAID_LOCK.close()
    monkeypatch.setattr(spend, "_PAID_LOCK", None)


@pytest.mark.parametrize("body", [b"{}", b'{"content": [{"type": "text", "text": "{}"}]}',
                                  b'{"content": [], "usage": {"input_tokens": -1, "output_tokens": 5}}', b"[]"])
def test_a_malformed_answer_is_billable_not_a_free_reply(monkeypatch, tmp_path, body):
    """A 200 without a body or without usage can't be priced or scored: it counts at its
    bound and fails the call (the group is left unfinished), never settles at $0."""
    import io
    from mythicsim.llm import clients as cl

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(cl.urllib.request, "urlopen", lambda req, timeout=0: Resp(body))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    price = spend.Price(input=1.0, output=1.0, cached=1.0)
    m = spend.CostMeter(cl.AnthropicClient("claude-haiku-5-5", effort="low"), price, limit_usd=10.0,
                        ledger=tmp_path / "l.jsonl")
    with pytest.raises(cl.ClientError) as err:
        m.complete("s", "u")
    assert not err.value.fatal and m.usd == pytest.approx(spend.worst_case_usd(price, "s", "u"))


def test_openai_is_asked_for_the_priced_tier(monkeypatch):
    import io
    from mythicsim.llm import clients as cl
    sent = {}

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def urlopen(req, timeout=0):
        sent.update(json.loads(req.data))
        return Resp(b'{"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}], "service_tier": "default",'
                    b' "usage": {"prompt_tokens": 3, "completion_tokens": 2}}')
    monkeypatch.setattr(cl.urllib.request, "urlopen", urlopen)
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    r = cl.OpenAIClient("gpt-6-luna", effort="low").complete("s", "u")
    assert sent["service_tier"] == "default" and r.service_tier == "default"


def test_a_prompt_past_the_priced_size_is_never_sent(tmp_path):
    class Never:
        spec = "fake:never"

        def complete(self, system, user, tag=""):
            raise AssertionError("sent")
    m = spend.CostMeter(Never(), spend.Price(1.0, 1.0, 1.0), limit_usd=100.0, ledger=tmp_path / "l.jsonl")
    with pytest.raises(spend.ClientError, match="short-context"):
        m.complete("x" * spend.MAX_PRICED_INPUT_TOKENS, "u")
    assert m.usd == 0.0
