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


def test_state_flags_pools_under_a_character():
    enc = Encounter(1, {}, "x")
    obs = enc.observe(enc.units["bramble"])
    lumi = next(p for p in obs["party"] if p["id"] == "lumi")
    obs["ground"] = [{"id": "desecrate_9", "kind": "desecrate", "pos": list(lumi["pos"]), "radius": 2.2,
                      "age_ms": 200, "armed": False}]
    text = render_state(obs, {}, None)
    line = next(l for l in text.splitlines() if l.strip().startswith("lumi"))
    assert "STANDING IN POOL desecrate_9 (arming, 0.0 m from its centre" in line


def test_move_to_accepts_safe_in_a_list():
    p = parse_reply(json.dumps({"orders": {"lumi": {"move_to": ["safe"]}}}), IDS)
    assert p.orders["lumi"].move_to == "safe" and not p.problems


def test_move_to_accepts_xz_object():
    p = parse_reply(json.dumps({"orders": {"bao": {"move_to": {"x": 3, "z": -1.5}}}}), IDS)
    assert p.orders["bao"].move_to == (3.0, -1.5) and not p.problems


def test_move_safe_leaves_the_pool_and_stays_in_melee():
    from mythicsim.engine import dist
    reply = json.dumps({"orders": {"grokka": {"move_to": "safe", "priority": [["savage_hew", "mortisar"]]}}})
    brain = PartyBrain(Scripted([reply]))
    pol = LLMPolicy("grokka", brain)
    enc = Encounter(1, {}, "x")
    obs = enc.observe(enc.units["grokka"])
    me = obs["self"]["pos"]
    obs["ground"] = [{"id": "desecrate_1", "kind": "desecrate", "pos": list(me), "radius": 2.2, "age_ms": 0, "armed": False}]
    acts = pol.act(obs)
    move = next(a for a in acts if a.type == "move")
    assert dist(move.to, me) > 2.2 + 0.45  # out of the pool
    boss = (0.0, -2.0)
    assert dist(move.to, boss) - 0.45 - 1.6 <= 3.0  # still in melee range


def test_safe_move_does_not_walk_through_another_pool():
    from mythicsim.policies import crosses_pool, find_safe_spot
    here = (6.0, -4.0)
    ground = [{"pos": [6.0, -4.0], "radius": 2.2, "armed": True},   # the pool we're in
              {"pos": [3.0, -3.0], "radius": 2.2, "armed": True}]   # between us and the boss
    spot = find_safe_spot(ground, 15.0, here, here, ((0.0, -2.0), 1.6, 2.8), avoid_paths=True)
    assert spot is None or not crosses_pool(here, spot, ground[1:])


def test_self_and_party_target_aliases():
    reply = json.dumps({"orders": {"lumi": {"priority": [["radiant_hymn", "party"]]},
                                   "bao": {"priority": [["wild_roar", "self"]]}}})
    p = parse_reply(reply, IDS)
    assert p.orders["lumi"].priority == [("radiant_hymn", "lumi")]
    assert p.orders["bao"].priority == [("wild_roar", "bao")]
    assert not p.problems


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


def test_effort_is_part_of_the_model_label():
    from mythicsim.llm.clients import make_client
    assert make_client("anthropic:claude-haiku-5-5").spec == "anthropic:claude-haiku-5-5"
    assert make_client("anthropic:claude-haiku-5-5@none").spec == "anthropic:claude-haiku-5-5@none"
    c = make_client("openai:gpt-5.4-mini", "low")
    assert c.spec == "openai:gpt-5.4-mini@low"
    with pytest.raises(ClientError):
        make_client("openai:gpt-5.4-mini@turbo")


def test_parallel_seeds_match_sequential(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    def run(seed):
        pols, _ = make_llm_policies(CachedClient(MockClient(), tmp_path / "c.jsonl"))
        return digest(Encounter(seed, pols, "x").run())
    seq = [run(s) for s in range(4)]
    with ThreadPoolExecutor(4) as pool:
        par = list(pool.map(run, range(4)))
    assert seq == par


def test_call_budget_is_enforced():
    pols, brain = make_llm_policies(MockClient(), interval_ms=100, min_gap_ms=0, max_calls=5)
    Encounter(2, pols, "x").run(max_ms=20_000)
    assert brain.stats.calls == 5 and brain.stats.budget_exhausted


def test_refusal_keeps_previous_orders_and_is_counted():
    good = json.dumps({"orders": {"grokka": {"priority": [["savage_hew", "mortisar"]]}}})

    class Refuses(Scripted):
        def complete(self, system, user):
            r = super().complete(system, user)
            return r if len(self.prompts) == 1 else Reply("", 100, 0, refused=True)

    brain = PartyBrain(Refuses([good]), interval_ms=1000)
    pols = {m.id: LLMPolicy(m.id, brain) for m in C.PARTY}
    rep = Encounter(4, pols, "x").run(max_ms=6000)
    assert brain.stats.refusals >= 1 and brain.stats.unusable_replies == 0
    hews = [e for e in rep["events"] if e["type"] == "cast_success" and e["ability"] == "savage_hew"]
    assert any(e["t"] > 3000 for e in hews)


def test_frontier_model_settings():
    from mythicsim.llm.clients import MAX_OUTPUT_TOKENS, make_client
    with pytest.raises(ClientError, match="cannot turn thinking off"):
        make_client("anthropic:claude-opus-5-5@none")
    opus = make_client("anthropic:claude-opus-5-5@xhigh")
    assert opus.effort_params() == {"thinking": {"type": "adaptive", "display": "summarized"},
                                    "output_config": {"effort": "xhigh"}}
    assert make_client("anthropic:claude-haiku-5-5@none").effort_params() == {"thinking": {"type": "disabled"}}
    assert opus.max_tokens == MAX_OUTPUT_TOKENS == 8000
    assert make_client("openai:gpt-6.2-astra@max").spec == "openai:gpt-6.2-astra@max"


def test_prompt_cache_key_follows_the_rules_text():
    from mythicsim.llm.clients import _cache_key
    a, b = system_prompt("blind"), system_prompt("blind", notes="kick the requiem", pull=2)
    assert _cache_key(a) == _cache_key(a) != _cache_key(b)
