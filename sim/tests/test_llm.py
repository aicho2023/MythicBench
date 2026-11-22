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

IDS = {m.id for m in C.PARTY} | {"oruth"}


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
    return json.dumps({"priority": [["savage_hew", "oruth"]], **extra})


def test_parse_valid_and_drops_invalid_entries():
    reply = json.dumps({"move_to": [1, 2], "priority": [["savage_hew", "oruth"], ["fireball", "oruth"],
                                                        ["ravage", "nobody"]], "say": "hi"})
    p = parse_reply("Sure! " + reply, "brask", IDS)
    assert p.ok
    o = p.orders["brask"]
    assert o.priority == [("savage_hew", "oruth")] and o.move_to == (1.0, 2.0) and o.say == "hi"
    assert len(p.problems) == 2  # fireball, unknown target


def test_parse_accepts_orders_nested_under_the_character():
    p = parse_reply(json.dumps({"brask": {"priority": [["ravage", "oruth"]]}}), "brask", IDS)
    assert p.ok and p.orders["brask"].priority == [("ravage", "oruth")]


def test_parse_missing_priority_means_keep_it():
    p = parse_reply(json.dumps({"move_to": "safe"}), "ivy", IDS)
    assert p.orders["ivy"].priority is None and p.orders["ivy"].move_to == "safe"


def test_another_characters_abilities_are_refused():
    p = parse_reply(json.dumps({"priority": [["mending_light", "rook"]]}), "brask", IDS)
    assert p.orders["brask"].priority == [] and p.problems == ["cannot use 'mending_light'"]


@pytest.mark.parametrize("text", ["no json here", "{not json}", '{"plan": {}}'])
def test_unusable_replies(text):
    assert not parse_reply(text, "rook", IDS).ok


def test_state_flags_pools_under_a_character():
    enc = Encounter(1, {}, "x")
    obs = enc.observe(enc.units["rook"])
    ivy = next(p for p in obs["party"] if p["id"] == "ivy")
    obs["ground"] = [{"id": "desecrate_9", "kind": "desecrate", "pos": list(ivy["pos"]), "radius": 2.2,
                      "age_ms": 200, "armed": False}]
    text = render_state(obs, "rook", 0, None)
    line = next(l for l in text.splitlines() if l.strip().startswith("ivy"))
    assert "STANDING IN POOL desecrate_9 (arming, 0.0 m from its centre" in line


def test_state_shows_only_your_own_cooldowns_and_the_chat():
    enc = Encounter(1, {}, "x")
    obs = enc.observe(enc.units["brask"])
    text = render_state(obs, "brask", 0, None, chat=[(1500, "rook", "I kick first.")])
    me = next(l for l in text.splitlines() if l.strip().startswith("brask"))
    other = next(l for l in text.splitlines() if l.strip().startswith("rook"))
    assert "(YOU)" in me and "Ready:" in me
    assert "Ready:" not in other
    assert "[1.5s] Rook: I kick first." in text


def test_move_to_accepts_safe_in_a_list_and_xz_object():
    assert parse_reply(json.dumps({"move_to": ["safe"]}), "ivy", IDS).orders["ivy"].move_to == "safe"
    assert parse_reply(json.dumps({"move_to": {"x": 3, "z": -1.5}}), "wren", IDS).orders["wren"].move_to == (3.0, -1.5)


def test_move_safe_leaves_the_pool_and_stays_in_melee():
    from mythicsim.engine import dist
    reply = json.dumps({"move_to": "safe", "priority": [["savage_hew", "oruth"]]})
    party = Party(Scripted({"brask": [reply]}))
    pol = LLMPolicy("brask", party)
    enc = Encounter(1, {}, "x")
    obs = enc.observe(enc.units["brask"])
    me = obs["self"]["pos"]
    obs["ground"] = [{"id": "desecrate_1", "kind": "desecrate", "pos": list(me), "radius": 2.2, "age_ms": 0, "armed": False}]
    acts = pol.act(obs)
    move = next(a for a in acts if a.type == "move")
    assert dist(move.to, me) > 2.2 + 0.45  # out of the pool
    boss = (0.0, -2.0)
    assert dist(move.to, boss) - 0.45 - 1.6 <= 3.0  # still in melee range


def test_safe_move_does_not_walk_through_another_pool():
    from mythicsim.dodge import crosses_pool, find_safe_spot
    here = (6.0, -4.0)
    ground = [{"pos": [6.0, -4.0], "radius": 2.2, "armed": True},   # the pool we're in
              {"pos": [3.0, -3.0], "radius": 2.2, "armed": True}]   # between us and the boss
    spot = find_safe_spot(ground, 15.0, here, here, ((0.0, -2.0), 1.6, 2.8), avoid_paths=True)
    assert spot is None or not crosses_pool(here, spot, ground[1:])


def test_self_and_party_target_aliases():
    assert parse_reply(json.dumps({"priority": [["radiant_hymn", "party"]]}), "ivy", IDS).orders["ivy"].priority \
        == [("radiant_hymn", "ivy")]
    assert parse_reply(json.dumps({"priority": [["wild_roar", "self"]]}), "wren", IDS).orders["wren"].priority \
        == [("wild_roar", "wren")]


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
    fake = Scripted({"rook": [hew(say="Brask kicks first, I take the second.")]})
    pols, party = make_llm_policies(fake, interval_ms=1000)
    Encounter(4, pols, "x").run(max_ms=3000)
    assert party.chat and party.chat[0][1] == "rook"
    later = fake.prompts["brask"][1:]  # the first call happened at the same tick
    assert any("Brask kicks first, I take the second." in p for p in later)


def test_kickable_casts_only_wake_the_kickers():
    pols, party = make_llm_policies(MockClient(), interval_ms=60_000)
    Encounter(4, pols, "x").run(max_ms=40_000)
    assert "ivy" not in INTERRUPTERS
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
    a = c.complete("rules", "same opening state", tag="e0p1|play|rook|1")
    b = c.complete("rules", "same opening state", tag="e1p1|play|rook|1")
    again = c.complete("rules", "same opening state", tag="e0p1|play|rook|1")
    assert a.text != b.text and again.text == a.text and again.cached


def test_offline_cache_miss_is_fatal(tmp_path):
    client = CachedClient(MockClient(), tmp_path / "empty.jsonl", offline=True)
    with pytest.raises(ClientError) as err:
        client.complete("system", "user")
    assert err.value.fatal


def test_interrupt_only_fires_on_an_interruptible_cast():
    reply = json.dumps({"priority": [["throat_punch", "oruth"], ["savage_hew", "oruth"]]})
    pols, _ = make_llm_policies(Scripted({"brask": [reply]}))
    rep = Encounter(4, pols, "x").run(max_ms=30_000)
    kicks = [e for e in rep["events"] if e["type"] == "cast_success" and e["ability"] == "throat_punch"]
    starts = {e["t"] for e in rep["events"] if e["type"] == "cast_start" and e.get("interruptible")}
    assert kicks, "Brask should have kicked something in 30s"
    for k in kicks:  # every kick lands while an interruptible cast is in progress
        assert any(s <= k["t"] <= s + 3000 for s in starts)


def test_unusable_reply_keeps_previous_orders():
    party = Party(Scripted({"brask": [hew(), "garbage", "garbage"]}), interval_ms=1000)
    pols = {m.id: LLMPolicy(m.id, party) for m in C.PARTY}
    rep = Encounter(4, pols, "x").run(max_ms=6000)
    assert party.agents["brask"].stats.unusable_replies >= 1
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
            first = len(self.prompts.get("brask", [])) <= 1
            return r if agent_of(system) != "brask" or first else Reply("", 100, 0, refused=True)

    party = Party(Refuses({"brask": [hew()]}), interval_ms=1000)
    pols = {m.id: LLMPolicy(m.id, party) for m in C.PARTY}
    rep = Encounter(4, pols, "x").run(max_ms=6000)
    g = party.agents["brask"].stats
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
    from mythicsim.llm import clients
    path = tmp_path / "a" / "c.jsonl"
    first = CachedClient(MockClient(), path).complete("rules", "state", tag="t")
    pub = tmp_path / "published"
    pub.mkdir()
    (pub / "c.jsonl.gz").write_bytes(gzip.compress(path.read_bytes()))
    clients._RECORDINGS.clear()
    again = CachedClient(MockClient(), pub / "c.jsonl", offline=True).complete("rules", "state", tag="t")
    assert again.cached and again.text == first.text


class _Counting:
    spec = "fake:counting"

    def __init__(self, delay=0.0):
        self.calls, self.delay = 0, delay

    def complete(self, system, user, tag=""):
        import time
        self.calls += 1
        time.sleep(self.delay)
        return Reply(f"reply {self.calls}", 1, 1)


def test_one_call_is_recorded_once_even_when_asked_twice_at_once(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    inner = _Counting(delay=0.05)
    a, b = CachedClient(inner, tmp_path / "c.jsonl"), CachedClient(inner, tmp_path / "c.jsonl")
    with ThreadPoolExecutor(2) as pool:
        ra, rb = pool.map(lambda c: c.complete("rules", "same", tag="e0p1|play|rook|1"), (a, b))
    assert inner.calls == 1 and ra.text == rb.text  # memory on/off share one recorded pull 1
    assert len((tmp_path / "c.jsonl").read_text().splitlines()) == 1


def test_conflicting_recordings_are_refused(tmp_path):
    from mythicsim.llm import clients
    path = tmp_path / "c.jsonl"
    rec = {"key": "k", "text": "one", "input_tokens": 1, "output_tokens": 1}
    path.write_text(json.dumps(rec) + "\n" + json.dumps({**rec, "text": "two"}) + "\n")
    clients._RECORDINGS.clear()
    with pytest.raises(ClientError, match="two different recorded replies") as err:
        CachedClient(MockClient(), path)
    assert err.value.fatal


def test_offline_never_reaches_a_provider():
    from mythicsim.llm.clients import NoNetwork
    with pytest.raises(ClientError) as err:
        NoNetwork("anthropic:x").complete("s", "u")
    assert err.value.fatal


def test_a_transport_failure_stops_the_episode_unrecorded():
    from mythicsim.llm.progress import run_episode

    class Flaky:
        spec = "fake:flaky"
        n = 0

        def complete(self, system, user, tag=""):
            self.n += 1
            if self.n == 7:
                raise ClientError("network error after retries")  # not fatal
            return MockClient().complete(system, user, tag)

    with pytest.raises(ClientError) as err:
        run_episode(Flaky(), 0, max_pulls=1, max_calls=5)
    assert not err.value.fatal  # the run carries on; this episode isn't checkpointed


def test_finite_and_in_range_coordinates_only():
    for bad in ([1e309, 0], [float("nan"), 1], [5000, 0]):
        p = parse_reply(json.dumps({"move_to": bad}), "wren", IDS)
        assert p.orders["wren"].move_to is None and p.problems, bad


def test_attacks_go_on_enemies_and_heals_on_allies():
    p = parse_reply(json.dumps({"priority": [["mending_light", "oruth"], ["mending_light", "rook"]]}), "ivy", IDS)
    assert p.orders["ivy"].priority == [("mending_light", "rook")] and len(p.problems) == 1
    p = parse_reply(json.dumps({"priority": [["savage_hew", "brask"], ["savage_hew", "oruth"]]}), "brask", IDS)
    assert p.orders["brask"].priority == [("savage_hew", "oruth")] and len(p.problems) == 1
    enc = Encounter(1, {}, "x")
    assert not enc.begin_cast(enc.units["ivy"], "mending_light", "oruth")  # the engine refuses it too
    assert not enc.begin_cast(enc.units["brask"], "savage_hew", "brask")


def test_thinking_out_loud_before_the_json_is_fine():
    text = 'I am at {x: 1, z: 2}, out of range {sort of}. So: {"move_to": [0, 51.5], "priority": [["savage_hew", "oruth"]]}'
    p = parse_reply(text, "brask", IDS)
    assert p.ok and p.orders["brask"].move_to == (0.0, 51.5) and not p.problems


def test_the_last_orders_object_is_the_answer():
    text = 'Draft: {"priority": [["ravage", "oruth"]]} Final: {"priority": [["savage_hew", "oruth"]]}'
    assert parse_reply(text, "brask", IDS).orders["brask"].priority == [("savage_hew", "oruth")]


def test_an_empty_object_means_no_change():
    p = parse_reply("{}", "brask", IDS)
    assert p.ok and p.orders["brask"].priority is None and p.orders["brask"].move_to is None


def test_trailing_garbage_without_orders_is_still_unusable():
    assert not parse_reply('thinking... <invoke name="x"></invoke> Error: unknown tool', "brask", IDS).ok


def test_chat_is_limited_to_one_message_every_ten_seconds():
    fake = Scripted({"rook": [hew(say="Kick the chanter.")]})
    pols, party = make_llm_policies(fake, interval_ms=1000)
    Encounter(4, pols, "x").run(max_ms=25_000)
    times = [t for t, who, _ in party.chat if who == "rook"]
    assert times and all(b - a >= 10_000 for a, b in zip(times, times[1:]))
    assert party.agents["rook"].stats.chat_dropped > 0
    assert any("You can type in party chat again in" in p for p in fake.prompts["rook"])


def test_chat_is_cut_to_a_short_line_at_a_word_or_sentence():
    from mythicsim.llm.prompt import CHAT_MAX_CHARS, fit_chat
    assert fit_chat("  Kick   the chanter. ") == "Kick the chanter."
    long = "Brask, kick Requiem this time. " + "Wren has the next one and Kit the one after that, then back to me " * 3
    out = fit_chat(long)
    assert len(out) <= CHAT_MAX_CHARS and long.startswith(out) and not out.endswith("…")
    words = "word " * 60
    cut = fit_chat(words)
    assert len(cut) <= CHAT_MAX_CHARS and cut.endswith("word")
