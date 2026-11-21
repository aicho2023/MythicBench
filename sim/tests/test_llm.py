"""LLM harness tests. All offline: a fake model, no network, no API keys."""

import hashlib
import json

import pytest

from mythicsim import content as C
from mythicsim.engine import Encounter
from mythicsim.llm.clients import CachedClient, ClientError, MockClient, Reply
from mythicsim.llm.policy import LLMPolicy, PartyBrain, make_llm_policies
from mythicsim.llm.prompt import parse_reply, render_state, system_prompt

IDS = {m.id for m in C.PARTY} | {"mortisar"}


def digest(rep: dict) -> str:
    return hashlib.sha256(json.dumps(rep, sort_keys=True).encode()).hexdigest()


class Scripted:
    """Fake model that returns canned replies in order, recording prompts."""
    spec = "fake:scripted"

    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts = []

    def complete(self, system, user):
        self.prompts.append(user)
        text = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        return Reply(text, 100, 10)


def test_parse_valid_and_drops_invalid_entries():
    reply = json.dumps({"orders": {
        "bramble": {"priority": [["bulwark_slam", "mortisar"], ["fireball", "mortisar"]], "say": "hi"},
        "lumi": {"move_to": [1, 2], "priority": [["mending_light", "nobody"]]},
        "ghost": {"priority": []},
    }})
    p = parse_reply("Sure! " + reply, IDS)
    assert p.ok
    assert p.orders["bramble"].priority == [("bulwark_slam", "mortisar")]
    assert p.orders["lumi"].move_to == (1.0, 2.0) and p.orders["lumi"].priority == []
    assert len(p.problems) == 3  # fireball, unknown target, unknown character


@pytest.mark.parametrize("text", ["no json here", "{not json}", '{"plan": {}}'])
def test_unusable_replies(text):
    assert not parse_reply(text, IDS).ok


def test_prompts_render():
    sp = system_prompt()
    for m in C.PARTY:
        assert m.id in sp
    enc = Encounter(1, {}, "x")
    text = render_state(enc.observe(enc.units["bramble"]), {}, None)
    assert "BOSS mortisar" in text and "lumi" in text


def test_mock_model_plays_a_full_fight_deterministically():
    def run():
        pols, brain = make_llm_policies(MockClient())
        return Encounter(3, pols, "llm:mock:basic").run(), brain.stats
    (a, sa), (b, _) = run(), run()
    assert digest(a) == digest(b)
    assert a["meta"]["outcome"] in ("victory", "wipe")
    assert 1 <= sa.calls <= 300 and sa.unusable_replies == 0
    assert any(e["type"] == "decision" for e in a["events"])  # "say" shows in the replay


def test_cache_replays_a_run_exactly(tmp_path):
    path = tmp_path / "cache.jsonl"
    live = CachedClient(MockClient(), path)
    pols, _ = make_llm_policies(live)
    first = Encounter(5, pols, "x").run()
    offline = CachedClient(MockClient(), path, offline=True)
    pols, brain = make_llm_policies(offline)
    second = Encounter(5, pols, "x").run()
    assert digest(first) == digest(second)
    assert brain.stats.cached_calls == brain.stats.calls > 0


def test_offline_cache_miss_is_an_error(tmp_path):
    client = CachedClient(MockClient(), tmp_path / "empty.jsonl", offline=True)
    with pytest.raises(ClientError):
        client.complete("system", "user")


def test_interrupt_only_fires_on_an_interruptible_cast():
    reply = json.dumps({"orders": {"grokka": {"priority": [["throat_punch", "mortisar"], ["savage_hew", "mortisar"]]}}})
    pols, _ = make_llm_policies(Scripted([reply]))
    enc = Encounter(4, pols, "x")
    rep = enc.run(max_ms=30_000)
    kicks = [e for e in rep["events"] if e["type"] == "cast_success" and e["ability"] == "throat_punch"]
    starts = {e["t"] for e in rep["events"] if e["type"] == "cast_start" and e.get("interruptible")}
    assert kicks, "Grokka should have kicked something in 30s"
    for k in kicks:  # every kick lands while an interruptible cast is in progress
        assert any(s <= k["t"] <= s + 3000 for s in starts)


def test_unusable_reply_keeps_previous_orders():
    good = json.dumps({"orders": {"grokka": {"priority": [["savage_hew", "mortisar"]]}}})
    brain = PartyBrain(Scripted([good, "garbage", "garbage"]), interval_ms=1000)
    pols = {m.id: LLMPolicy(m.id, brain) for m in C.PARTY}
    rep = Encounter(4, pols, "x").run(max_ms=6000)
    assert brain.stats.unusable_replies >= 1
    hews = [e for e in rep["events"] if e["type"] == "cast_success" and e["ability"] == "savage_hew"]
    assert any(e["t"] > 3000 for e in hews)  # still following the first orders


def test_fatal_api_errors_stop_the_run():
    class Broke:
        spec = "fake:broke"
        def complete(self, system, user):
            raise ClientError("no credits", fatal=True)
    pols, _ = make_llm_policies(Broke())
    with pytest.raises(ClientError):
        Encounter(1, pols, "x").run()


def test_call_budget_is_enforced():
    pols, brain = make_llm_policies(MockClient(), interval_ms=100, min_gap_ms=0, max_calls=5)
    Encounter(2, pols, "x").run(max_ms=20_000)
    assert brain.stats.calls == 5 and brain.stats.budget_exhausted
