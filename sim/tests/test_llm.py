"""LLM harness tests. All offline: fake models, no network, no API keys."""

import hashlib
import json
import re

import pytest

from mythicsim import content as C
from mythicsim.engine import Encounter
from mythicsim.llm.clients import CachedClient, ClientError, MockClient, Reply
from mythicsim.llm.policy import INTERRUPTERS, LLMPolicy, Party, make_llm_policies
from mythicsim.llm.prompt import parse_reply, render_state, system_prompt

IDS = {m.id for m in C.PARTY} | {"mortisar"}


def digest(rep: dict) -> str:
    return hashlib.sha256(json.dumps(rep, sort_keys=True).encode()).hexdigest()


def agent_of(system: str) -> str:
    return re.search(r"\((\w+)\), the ", system).group(1)


class Scripted:
    """Fake model: canned replies per character (in order, the last one
    repeating); characters without a script keep quiet with an empty list."""
    spec = "fake:scripted"

    def __init__(self, replies: dict[str, list[str]]):
        self.replies = {k: list(v) for k, v in replies.items()}
        self.prompts: dict[str, list[str]] = {}

    def complete(self, system, user, tag=""):
        uid = agent_of(system)
        self.prompts.setdefault(uid, []).append(user)
        queue = self.replies.get(uid) or ['{"priority": []}']
        text = queue.pop(0) if len(queue) > 1 else queue[0]
        return Reply(text, 100, 10)


def hew(**extra) -> str:
    return json.dumps({"priority": [["savage_hew", "mortisar"]], **extra})


def test_parse_valid_and_drops_invalid_entries():
    reply = json.dumps({"move_to": [1, 2], "priority": [["savage_hew", "mortisar"], ["fireball", "mortisar"],
                                                        ["ravage", "nobody"]], "say": "hi"})
    p = parse_reply("Sure! " + reply, "grokka", IDS)
    assert p.ok
    o = p.orders["grokka"]
    assert o.priority == [("savage_hew", "mortisar")] and o.move_to == (1.0, 2.0) and o.say == "hi"
    assert len(p.problems) == 2  # fireball, unknown target


def test_parse_accepts_orders_nested_under_the_character():
    p = parse_reply(json.dumps({"grokka": {"priority": [["ravage", "mortisar"]]}}), "grokka", IDS)
    assert p.ok and p.orders["grokka"].priority == [("ravage", "mortisar")]


def test_parse_missing_priority_means_keep_it():
    p = parse_reply(json.dumps({"move_to": "safe"}), "lumi", IDS)
    assert p.orders["lumi"].priority is None and p.orders["lumi"].move_to == "safe"


def test_another_characters_abilities_are_refused():
    p = parse_reply(json.dumps({"priority": [["mending_light", "bramble"]]}), "grokka", IDS)
    assert p.orders["grokka"].priority == [] and p.problems == ["cannot use 'mending_light'"]


@pytest.mark.parametrize("text", ["no json here", "{not json}", '{"plan": {}}'])
def test_unusable_replies(text):
    assert not parse_reply(text, "bramble", IDS).ok


def test_state_flags_pools_under_a_character():
    enc = Encounter(1, {}, "x")
    obs = enc.observe(enc.units["bramble"])
    lumi = next(p for p in obs["party"] if p["id"] == "lumi")
    obs["ground"] = [{"id": "desecrate_9", "kind": "desecrate", "pos": list(lumi["pos"]), "radius": 2.2,
                      "age_ms": 200, "armed": False}]
    text = render_state(obs, "bramble", 0, None)
    line = next(l for l in text.splitlines() if l.strip().startswith("lumi"))
    assert "STANDING IN POOL desecrate_9 (arming, 0.0 m from its centre" in line


def test_state_shows_only_your_own_cooldowns_and_the_chat():
    enc = Encounter(1, {}, "x")
    obs = enc.observe(enc.units["grokka"])
    text = render_state(obs, "grokka", 0, None, chat=[(1500, "bramble", "I kick first.")])
    me = next(l for l in text.splitlines() if l.strip().startswith("grokka"))
    other = next(l for l in text.splitlines() if l.strip().startswith("bramble"))
    assert "(YOU)" in me and "Ready:" in me
    assert "Ready:" not in other
    assert "[1.5s] Bramble: I kick first." in text


def test_move_to_accepts_safe_in_a_list_and_xz_object():
    assert parse_reply(json.dumps({"move_to": ["safe"]}), "lumi", IDS).orders["lumi"].move_to == "safe"
    assert parse_reply(json.dumps({"move_to": {"x": 3, "z": -1.5}}), "bao", IDS).orders["bao"].move_to == (3.0, -1.5)


def test_move_safe_leaves_the_pool_and_stays_in_melee():
    from mythicsim.engine import dist
    reply = json.dumps({"move_to": "safe", "priority": [["savage_hew", "mortisar"]]})
    party = Party(Scripted({"grokka": [reply]}))
    pol = LLMPolicy("grokka", party)
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
    assert parse_reply(json.dumps({"priority": [["radiant_hymn", "party"]]}), "lumi", IDS).orders["lumi"].priority \
        == [("radiant_hymn", "lumi")]
    assert parse_reply(json.dumps({"priority": [["wild_roar", "self"]]}), "bao", IDS).orders["bao"].priority \
        == [("wild_roar", "bao")]


def test_each_agent_gets_its_own_rules():
    texts = {m.id: system_prompt("blind", me=m.id) for m in C.PARTY}
    assert len(set(texts.values())) == 5
    for m in C.PARTY:
        sp = texts[m.id]
        assert f"You play {m.name} ({m.id})" in sp and f"{m.id} - {m.name}" in sp
        for other in C.PARTY:  # every tooltip is shown: players know each other's kits
            assert f"{other.id} - {other.name}" in sp
        assert "party chat" in sp


def test_mock_party_plays_a_full_fight_deterministically():
    def run():
        pols, party = make_llm_policies(MockClient())
        return Encounter(3, pols, "llm:mock:basic").run(), party
    (a, pa), (b, _) = run(), run()
    assert digest(a) == digest(b)
    assert a["meta"]["outcome"] in ("victory", "wipe")
    st = pa.stats
    assert st.calls >= 5 and st.unusable_replies == 0 and st.invalid_entries == 0
    assert set(pa.stats_dict()["agents"]) == {m.id for m in C.PARTY}
    assert {c["agent"] for c in pa.calls} == {m.id for m in C.PARTY}  # every call is recorded


def test_party_chat_reaches_the_other_agents():
    fake = Scripted({"bramble": [hew(say="Grokka kicks first, I take the second.")]})
    pols, party = make_llm_policies(fake, interval_ms=1000)
    Encounter(4, pols, "x").run(max_ms=3000)
    assert party.chat and party.chat[0][1] == "bramble"
    later = fake.prompts["grokka"][1:]  # the first call happened at the same tick
    assert any("Grokka kicks first, I take the second." in p for p in later)


def test_kickable_casts_only_wake_the_kickers():
    pols, party = make_llm_policies(MockClient(), interval_ms=60_000)
    Encounter(4, pols, "x").run(max_ms=40_000)
    assert "lumi" not in INTERRUPTERS
    kick_calls = [c for c in party.calls if any("requiem_of_bones" in w for w in c["why"])]
    assert kick_calls and all(c["agent"] in INTERRUPTERS for c in kick_calls)


def test_cache_replays_a_run_exactly(tmp_path):
    path = tmp_path / "cache.jsonl"
    live = CachedClient(MockClient(), path)
    pols, _ = make_llm_policies(live, scope="t")
    first = Encounter(5, pols, "x").run()
    offline = CachedClient(MockClient(), path, offline=True)
    pols, party = make_llm_policies(offline, scope="t")
    second = Encounter(5, pols, "x").run()
    assert digest(first) == digest(second)
    assert party.stats.cached_calls == party.stats.calls > 0


def test_same_prompt_in_another_episode_is_a_new_sample(tmp_path):
    class Counter:
        spec = "fake:counter"
        n = 0
        def complete(self, system, user, tag=""):
            self.n += 1
            return Reply(str(self.n), 1, 1)
    c = CachedClient(Counter(), tmp_path / "c.jsonl")
    a = c.complete("rules", "same opening state", tag="e0p1|play|bramble|1")
    b = c.complete("rules", "same opening state", tag="e1p1|play|bramble|1")
    again = c.complete("rules", "same opening state", tag="e0p1|play|bramble|1")
    assert a.text != b.text and again.text == a.text and again.cached


def test_offline_cache_miss_is_fatal(tmp_path):
    client = CachedClient(MockClient(), tmp_path / "empty.jsonl", offline=True)
    with pytest.raises(ClientError) as err:
        client.complete("system", "user")
    assert err.value.fatal


def test_interrupt_only_fires_on_an_interruptible_cast():
    reply = json.dumps({"priority": [["throat_punch", "mortisar"], ["savage_hew", "mortisar"]]})
    pols, _ = make_llm_policies(Scripted({"grokka": [reply]}))
    rep = Encounter(4, pols, "x").run(max_ms=30_000)
    kicks = [e for e in rep["events"] if e["type"] == "cast_success" and e["ability"] == "throat_punch"]
    starts = {e["t"] for e in rep["events"] if e["type"] == "cast_start" and e.get("interruptible")}
    assert kicks, "Grokka should have kicked something in 30s"
    for k in kicks:  # every kick lands while an interruptible cast is in progress
        assert any(s <= k["t"] <= s + 3000 for s in starts)


def test_unusable_reply_keeps_previous_orders():
    party = Party(Scripted({"grokka": [hew(), "garbage", "garbage"]}), interval_ms=1000)
    pols = {m.id: LLMPolicy(m.id, party) for m in C.PARTY}
    rep = Encounter(4, pols, "x").run(max_ms=6000)
    assert party.agents["grokka"].stats.unusable_replies >= 1
    hews = [e for e in rep["events"] if e["type"] == "cast_success" and e["ability"] == "savage_hew"]
    assert any(e["t"] > 3000 for e in hews)  # still following the first orders


def test_fatal_api_errors_stop_the_run():
    class Broke:
        spec = "fake:broke"
        def complete(self, system, user, tag=""):
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
        pols, _ = make_llm_policies(CachedClient(MockClient(), tmp_path / "c.jsonl"), scope=f"s{seed}")
        return digest(Encounter(seed, pols, "x").run())
    seq = [run(s) for s in range(4)]
    with ThreadPoolExecutor(4) as pool:
        par = list(pool.map(run, range(4)))
    assert seq == par


def test_parallel_agents_match_sequential_agents():
    def run(parallel):
        pols, _ = make_llm_policies(MockClient(), parallel=parallel)
        return digest(Encounter(6, pols, "x").run())
    assert run(True) == run(False)


def test_call_budget_is_enforced_per_agent():
    pols, party = make_llm_policies(MockClient(), interval_ms=100, min_gap_ms=0, max_calls=5)
    Encounter(2, pols, "x").run(max_ms=20_000)
    assert party.stats.calls == 25 and party.stats.budget_exhausted


def test_refusal_keeps_previous_orders_and_is_counted():
    class Refuses(Scripted):
        def complete(self, system, user, tag=""):
            r = super().complete(system, user, tag)
            first = len(self.prompts.get("grokka", [])) <= 1
            return r if agent_of(system) != "grokka" or first else Reply("", 100, 0, refused=True)

    party = Party(Refuses({"grokka": [hew()]}), interval_ms=1000)
    pols = {m.id: LLMPolicy(m.id, party) for m in C.PARTY}
    rep = Encounter(4, pols, "x").run(max_ms=6000)
    g = party.agents["grokka"].stats
    assert g.refusals >= 1 and g.unusable_replies == 0
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


def test_recordings_can_be_read_gzipped(tmp_path):
    import gzip
    path = tmp_path / "c.jsonl"
    live = CachedClient(MockClient(), path)
    first = live.complete("rules", "state", tag="t")
    (tmp_path / "c.jsonl.gz").write_bytes(gzip.compress(path.read_bytes()))
    path.unlink()
    again = CachedClient(MockClient(), path, offline=True).complete("rules", "state", tag="t")
    assert again.cached and again.text == first.text


def test_scripted_commander_plays_through_the_same_interface():
    from mythicsim.dungeon import DungeonRun
    from mythicsim.llm.clients import make_client
    from mythicsim.metrics import score
    client = make_client("scripted:commander")
    pols, party = make_llm_policies(client, tier="normal", mode="dungeon", knowledge="blind")
    s = score(DungeonRun(10001, pols, "x", "normal").run())
    st = party.stats
    assert st.calls > 50 and st.unusable_replies == 0 and st.invalid_entries == 0
    assert s["progress_pct"] > 50  # walks the route, pulls, fights


def test_scripted_commander_kicks_casters_and_leaves_pools():
    from mythicsim.llm.scripted import orders
    state = """Run timer 30.0s of 255s. IN COMBAT.
ENEMIES FIGHTING YOU: pack1_bone_chanter_1 (Bone Chanter) 80% HP at (0.0, 48.0) attacking bramble, casting grave_volley (1.0s left) INTERRUPTIBLE; pack1_bonewalker_1 (Risen Bonewalker) 50% HP at (1.0, 55.0) attacking bramble.
POOLS: none.
PARTY:
  grokka (YOU) (berserker) 90% HP (40000/44000) at (0.0, 50.0). Ready: savage_hew. STANDING IN POOL grave_1 (ARMED, 0.5 m from its centre, radius 2.5)!
  bramble (guardian) 70% HP (43400/62000) at (0.0, 54.0)."""
    o = orders("grokka", state)
    assert o["move_to"] == "safe"
    assert o["priority"][0] == ["throat_punch", "pack1_bone_chanter_1"]
    assert ["savage_hew", "pack1_bone_chanter_1"] in o["priority"]  # casters first
