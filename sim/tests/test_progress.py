"""Learning over pulls: blind knowledge, debrief, reflection, episodes.

All offline: fake or mock models, no network.
"""

import hashlib
import json
import re
from pathlib import Path

import pytest

from mythicsim import runs as R
from mythicsim.engine import Encounter
from mythicsim.llm.clients import CachedClient, MockClient, Reply
from mythicsim.llm.debrief import debrief_data, debrief_text
from mythicsim.llm.policy import make_llm_policies
from mythicsim import content as C
from mythicsim.llm.progress import (ci95, cleared, curve, diff_ci95, pull_seed, run_episode, summarize,
                                      t95, write_notes)
from mythicsim.llm.prompt import render_state, system_prompt

REPLAYS = Path(__file__).parents[2] / "web" / "public" / "replays"


def test_blind_prompt_hides_the_boss_but_keeps_the_party_kit():
    full, blind = system_prompt("full"), system_prompt("blind")
    for leak in ("INTERRUPT IT", "Tank buster", "Desecrate pools", "Summon the Restless", "Bonewalkers",
                 "enrages", "Boss timers vary", "Hollow Fury"):
        assert leak in full or leak == "Bonewalkers"
        assert leak not in blind, leak
    for kept in ("rampart_bash", "mending_light", "radiant_hymn", "silencing_arrow", "1,500,000 HP", "195 s time limit"):
        assert kept in blind, kept


def test_blind_state_has_no_boss_timers():
    enc = Encounter(1, {}, "x")
    obs = enc.observe(enc.units["rook"])
    assert "Next boss abilities" in render_state(obs, "rook", 0, None, "full")
    blind = render_state(obs, "rook", 0, None, "blind")
    assert "Next boss abilities" not in blind and "enrage" not in blind and "time limit" in blind


def test_notes_are_appended_only_when_present():
    assert system_prompt("blind", None, 3) == system_prompt("blind")
    with_notes = system_prompt("blind", "Kick the Requiem.", 3)
    assert with_notes.startswith(system_prompt("blind")) and "this is pull 3" in with_notes and "Kick the Requiem." in with_notes


def _boss_replay(seed: int = 2, tier: str = "normal") -> dict:
    """The scripted commander's boss fight (seed 2 on Normal is a clean kill)."""
    from mythicsim.__main__ import simulate
    from mythicsim.metrics import score
    rep = simulate(seed, tier, "boss")
    rep["meta"]["metrics"] = score(rep)
    return rep


def test_debrief_matches_the_metrics():
    rep = _boss_replay(42, tier="plus10")
    d = debrief_data(rep)
    m = rep["meta"]["metrics"]
    assert d["outcome"] == m["outcome"] and d["boss_hp_pct_left"] == m["boss_hp_pct_remaining"]
    assert [x["unit"] for x in d["deaths"]] == [x["unit"] for x in m["deaths"]]
    requiems = [c for c in d["casts"] if c["ability"] == "requiem_of_bones"]
    assert len(requiems) == m["interrupts"]["interruptible_casts"]
    assert sum(c["result"] == "interrupted" for c in requiems) == m["interrupts"]["interrupted"]
    text = debrief_text(rep)
    assert "RESULT: party wiped" in text and "Requiem of Bones" in text and "interrupted" in text


def test_debrief_of_a_clean_kill():
    rep = _boss_replay()
    text = debrief_text(rep)
    assert text.startswith("RESULT: Oruth defeated") and "DEATHS: none." in text


class Recorder:
    """Fake model: mock play and talk, scripted notes; records every (system, user)."""
    spec = "fake:recorder"

    def __init__(self):
        self.calls = []
        self.inner = MockClient()

    def complete(self, system, user, tag=""):
        self.calls.append((system, user))
        if "WRITE YOUR NOTES" in user:
            uid = re.search(r"\((\w+)\), the ", system).group(1)
            pull = re.search(r"THE PULL \(PULL (\d+)\)", user).group(1)
            return Reply(json.dumps({"notes": f"LESSON-{uid}-{pull}"}), 10, 10)
        return self.inner.complete(system, user, tag)

    def play_systems(self):
        return [s for s, u in self.calls if "THE PULL (PULL" not in u]


def test_each_agent_carries_only_its_own_notes():
    rec = Recorder()
    ep = run_episode(rec, 0, max_pulls=3, memory=True, max_calls=3)
    assert [p.pull for p in ep.pulls] == [1, 2, 3]
    assert [p.seed for p in ep.pulls] == [pull_seed(0, k) for k in (1, 2, 3)]
    assert all(v == "" for v in ep.pulls[0].notes_before.values())
    assert ep.pulls[1].notes_before == {m.id: f"LESSON-{m.id}-1" for m in C.PARTY}
    assert ep.pulls[2].notes_before["kit"] == "LESSON-kit-2"
    for system in rec.play_systems():
        if "this is pull 2" in system:
            mine = re.search(r"\((\w+)\), the ", system).group(1)
            assert f"LESSON-{mine}-1" in system
            assert not any(f"LESSON-{m.id}-1" in system for m in C.PARTY if m.id != mine)
    prog = ep.pulls[1].replay["meta"]["progress"]
    assert prog["notes_before"]["ivy"] == "LESSON-ivy-1" and prog["agents"] == "per-character"
    assert "RESULT:" in ep.pulls[0].debrief


def test_party_talks_in_turn_until_everyone_is_ready():
    rec = Recorder()
    ep = run_episode(rec, 0, max_pulls=2, memory=True, max_calls=3)
    talk = ep.pulls[0].talk
    assert [x["agent"] for x in talk[:5]] == [m.id for m in C.PARTY]
    assert all(x["ready"] for x in talk[-5:]) and len(talk) == 10  # mock: speaks once, then ready
    # Later speakers see what earlier ones said; notes see the whole talk.
    talk_prompts = [u for s, u in rec.calls if "PARTY TALK" in u]
    assert "rook here" in talk_prompts[1]
    notes_prompts = [u for s, u in rec.calls if "WRITE YOUR NOTES" in u]
    assert len(notes_prompts) == 5 and all("wren here" in u for u in notes_prompts)
    assert ep.pulls[1].stats["calls"] >= 5 and ep.pulls[0].stats["between_pulls"]["calls"] == 15


def test_between_pull_prompts_give_no_advice():
    rec = Recorder()
    run_episode(rec, 0, max_pulls=2, memory=True, max_calls=3)
    for s, u in rec.calls:
        if "THE PULL (PULL" in u:
            low = u.lower()
            for advice in ("interrupt", "should", "improve", "mistake", "lesson", "strategy"):
                assert advice not in low.split("combat log summary")[0], advice
                assert advice not in low.split("party talk")[-1].split("what the party said")[-1] \
                    .replace(low.split("combat log summary")[1].split("party talk")[0], ""), advice


def test_memory_off_is_a_true_control():
    rec = Recorder()
    ep = run_episode(rec, 0, max_pulls=3, memory=False, max_calls=3)
    assert all(not any(p.notes_before.values()) for p in ep.pulls)
    assert not any("THE PULL (PULL" in u for s, u in rec.calls)  # no talk, no notes
    assert set(rec.play_systems()) == {system_prompt("blind", me=m.id) for m in C.PARTY}


def test_notes_failure_keeps_old_notes():
    from mythicsim.llm.policy import Agent
    class Junk:
        spec = "fake:junk"
        def complete(self, system, user, tag=""):
            return Reply("I think we should try harder", 1, 1)
    notes, problem = write_notes(Junk(), Agent("ivy", system_prompt(me="ivy")), "old notes", "debrief", [], 1, "t")
    assert notes == "old notes" and problem


def test_episode_is_reproducible_from_recordings(tmp_path):
    def run(offline):
        c = CachedClient(MockClient(), tmp_path / "c.jsonl", offline=offline)
        ep = run_episode(c, 2, max_pulls=2, max_calls=5)
        return [hashlib.sha256(json.dumps(p.replay, sort_keys=True).encode()).hexdigest() for p in ep.pulls]
    assert run(False) == run(True)


class _P:
    def __init__(self, pull, score, outcome, in_time=True):
        self.pull, self.metrics = pull, {"score": score, "outcome": outcome, "in_time": in_time}


class _E:
    def __init__(self, episode, pulls):
        self.episode, self.pulls = episode, pulls

    @property
    def killed_on(self):
        return next((p.pull for p in self.pulls if cleared(p.metrics)), None)


def test_curve_carries_a_timed_clear_forward_and_summary():
    a = _E(0, [_P(1, 20, "wipe"), _P(2, 60, "wipe"), _P(3, 90, "victory")])
    b = _E(1, [_P(1, 30, "wipe"), _P(2, 30, "wipe"), _P(3, 40, "wipe"), _P(4, 50, "wipe")])
    assert curve(a, 4) == [20, 60, 90, 90]
    s = summarize([a, b], 4)
    assert s["pulls_to_kill"] == [3, None] and s["kill_rate"] == 0.5 and s["pulls_to_kill_mean"] == 3
    assert s["curve_mean"] == [25.0, 45.0, 65.0, 70.0]
    assert "learning_gain_mean" not in s  # biased upward; the campaign compares against the control instead


def test_an_over_time_kill_is_not_a_clear():
    late = _E(0, [_P(1, 70, "victory", in_time=False), _P(2, 85, "victory")])
    assert late.killed_on == 2
    assert not cleared({"outcome": "victory", "in_time": False}) and cleared({"outcome": "victory", "in_time": True})


def test_intervals_use_student_t():
    xs = [60.0, 70.0, 80.0]  # mean 70, sd 10, n 3: half-width 4.303 * 10 / sqrt(3) = 24.8
    assert ci95(xs) == [45.2, 94.8]
    assert t95(2) == 4.303 and t95(500) == 1.96
    assert diff_ci95([1.0, 1.0], [0.0, 0.0]) == [1.0, 1.0]


def test_progression_items_publish_without_collisions(tmp_path):
    run = R.new_run("mock:basic", mode="progression", config={"max_pulls": 2}, runs_dir=tmp_path)
    items = []
    for e in (0, 1):
        ep = run_episode(MockClient(), e, max_pulls=2, max_calls=3)
        for p in ep.pulls:
            f = f"episodes/{e}/pull-{p.pull}.json"
            (run.dir / f).parent.mkdir(parents=True, exist_ok=True)
            (run.dir / f).write_text(json.dumps(p.replay))
            items.append({"episode": e, "pull": p.pull, "seed": p.seed, "file": f, "outcome": "wipe",
                          "score": p.metrics["score"], "duration_s": 1})
    R.finish_run(run, {"score_mean": 1}, items, tmp_path)
    pub = tmp_path / "pub"
    R.publish(tmp_path, pub)
    cat = json.loads((pub / "catalog.json").read_text())
    files = [i["file"] for i in cat["runs"][0]["items"]]
    assert len(set(files)) == 4 and all((pub / f).exists() for f in files)


def test_debrief_covers_the_dungeon():
    rep = json.loads((REPLAYS / "commander-plus10.json").read_text())
    text = debrief_text(rep)
    assert "DUNGEON:" in text and "Chapel pack" in text and "Grave Volley" in text


def test_debrief_reports_a_timeout_as_a_timeout():
    rep = json.loads((REPLAYS / "commander-plus10.json").read_text())
    rep["meta"]["outcome"] = "timeout"
    text = debrief_text(rep)
    assert text.startswith("RESULT: time ran out") and "wiped" not in text.split("\n")[0]


def test_talk_and_notes_have_their_own_reply_format():
    rec = Recorder()
    run_episode(rec, 0, max_pulls=2, memory=True, max_calls=3)
    review = [(sy, u) for sy, u in rec.calls if "THE PULL (PULL" in u]
    assert review
    for system, _ in review:
        assert "Reply with ONLY a JSON object, no prose" not in system  # no combat order format
        assert '"message"' in system or '"notes"' in system


def test_ready_must_be_json_true_and_notes_are_capped_exactly():
    from mythicsim.llm.policy import Agent
    from mythicsim.llm.progress import NOTES_WORD_CAP, team_talk

    class Says:
        spec = "fake:says"
        def complete(self, system, user, tag=""):
            if "WRITE YOUR NOTES" in user:
                return Reply(json.dumps({"notes": "word " * 415}), 1, 1)
            return Reply(json.dumps({"message": "hi", "ready": "false"}), 1, 1)

    agents = {m.id: Agent(m.id, system_prompt(me=m.id)) for m in C.PARTY}
    talk = team_talk(Says(), agents, {}, "log", 1, "t", [])
    assert not any(x["ready"] for x in talk) and len(talk) == 15  # "false" is not ready: all three rounds
    notes, _ = write_notes(Says(), agents["ivy"], "", "log", talk, 1, "t")
    assert len(notes.split()) == NOTES_WORD_CAP + 1  # 350 words and the trailing ellipsis
