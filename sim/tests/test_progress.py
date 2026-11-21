"""Learning over pulls: blind knowledge, debrief, reflection, episodes.

All offline: fake or mock models, no network.
"""

import hashlib
import json
from pathlib import Path

import pytest

from mythicsim import runs as R
from mythicsim.engine import Encounter
from mythicsim.llm.clients import CachedClient, MockClient, Reply
from mythicsim.llm.debrief import debrief_data, debrief_text
from mythicsim.llm.policy import make_llm_policies
from mythicsim.llm.progress import curve, pull_seed, reflect, run_episode, summarize
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
    obs = enc.observe(enc.units["bramble"])
    assert "Next boss abilities" in render_state(obs, {}, None, "full")
    blind = render_state(obs, {}, None, "blind")
    assert "Next boss abilities" not in blind and "enrage" not in blind and "time limit" in blind


def test_notes_are_appended_only_when_present():
    assert system_prompt("blind", None, 3) == system_prompt("blind")
    with_notes = system_prompt("blind", "Kick the Requiem.", 3)
    assert with_notes.startswith(system_prompt("blind")) and "this is pull 3" in with_notes and "Kick the Requiem." in with_notes


def test_debrief_matches_the_metrics():
    rep = json.loads((REPLAYS / "competent-enrage.json").read_text())
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
    rep = json.loads((REPLAYS / "expert-kill.json").read_text())
    text = debrief_text(rep)
    assert text.startswith("RESULT: Mortisar defeated") and "DEATHS: none." in text


class Recorder:
    """Fake model: mock orders + scripted reflections; records every system prompt."""
    spec = "fake:recorder"

    def __init__(self):
        self.systems = []
        self.inner = MockClient()

    def complete(self, system, user):
        self.systems.append(system)
        if "over repeated attempts" in system:
            pull = user.split("DEBRIEF OF PULL ")[1].split(":")[0]
            return Reply(json.dumps({"notes": f"LESSON-{pull}"}), 10, 10)
        return self.inner.complete(system, user)


def test_notes_carry_into_the_next_pull():
    rec = Recorder()
    ep = run_episode(rec, 0, max_pulls=3, memory=True, max_calls=3)
    assert [p.pull for p in ep.pulls] == [1, 2, 3]
    assert [p.seed for p in ep.pulls] == [pull_seed(0, k) for k in (1, 2, 3)]
    assert ep.pulls[0].notes_before == "" and ep.pulls[1].notes_before == "LESSON-1" and ep.pulls[2].notes_before == "LESSON-2"
    play_prompts = [s for s in rec.systems if "over repeated attempts" not in s]
    assert any("LESSON-1" in s and "this is pull 2" in s for s in play_prompts)
    assert ep.pulls[1].replay["meta"]["progress"]["notes_before"] == "LESSON-1"
    assert "RESULT:" in ep.pulls[0].debrief


def test_memory_off_is_a_true_control():
    rec = Recorder()
    ep = run_episode(rec, 0, max_pulls=3, memory=False, max_calls=3)
    assert all(p.notes_before == "" for p in ep.pulls)
    assert not any("over repeated attempts" in s for s in rec.systems)  # no reflection calls at all
    plays = {s for s in rec.systems}
    assert plays == {system_prompt("blind")}  # every pull sees exactly the pull-1 rules


def test_reflection_failure_keeps_old_notes():
    class Junk:
        spec = "fake:junk"
        def complete(self, system, user):
            return Reply("I think we should try harder", 1, 1)
    notes, problem = reflect(Junk(), "old notes", "debrief", 1)
    assert notes == "old notes" and problem


def test_episode_is_reproducible_from_recordings(tmp_path):
    def run(offline):
        c = CachedClient(MockClient(), tmp_path / "c.jsonl", offline=offline)
        ep = run_episode(c, 2, max_pulls=2, max_calls=5)
        return [hashlib.sha256(json.dumps(p.replay, sort_keys=True).encode()).hexdigest() for p in ep.pulls]
    assert run(False) == run(True)


def test_curve_carries_a_kill_forward_and_summary():
    class P:
        def __init__(self, pull, score, outcome):
            self.pull, self.metrics = pull, {"score": score, "outcome": outcome}
    class E:
        def __init__(self, episode, pulls):
            self.episode, self.pulls = episode, pulls
        @property
        def killed_on(self):
            return next((p.pull for p in self.pulls if p.metrics["outcome"] == "victory"), None)
    a = E(0, [P(1, 20, "wipe"), P(2, 60, "wipe"), P(3, 120, "victory")])
    b = E(1, [P(1, 30, "wipe"), P(2, 30, "wipe"), P(3, 40, "wipe"), P(4, 50, "wipe")])
    assert curve(a, 4) == [20, 60, 120, 120]
    s = summarize([a, b], 4)
    assert s["pulls_to_kill"] == [3, 5] and s["kill_rate"] == 0.5
    assert s["curve_mean"] == [25.0, 45.0, 80.0, 85.0]
    assert s["learning_gain_mean"] == pytest.approx(((120 - 40) + (45 - 30)) / 2, abs=0.1)


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
