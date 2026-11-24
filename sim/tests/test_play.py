"""/play: a person in one seat, the expert in the other four.

The browser game must be the benchmark's game. With the expert answering in
the person's seat, through the pause-and-resume path, a pull must replay
byte for byte like the expert party played straight through the frozen
harness, and the person must be shown exactly the text an agent is sent.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from mythicsim.__main__ import simulate
from mythicsim.llm.expert import ExpertScript
from mythicsim.play import SEED_BASE, Game, expert_metrics, play_seed

ROOT = Path(__file__).resolve().parents[2]


def play_as_expert(seat: str, seed: int, tier: str) -> Game:
    g = Game(seat, seed, tier)
    sent = []
    real = g.client.complete

    def spy(system, user, tag=""):  # what the person's seat is really sent on resume
        if tag.split("|")[-2] == seat:
            sent.append(user)
        return real(system, user, tag)

    g.client.complete = spy
    ex = ExpertScript()
    out = g.start()
    while out["kind"] == "ask":
        shown = out["prompt"]
        out = g.answer(ex.complete(g.party.agents[seat].system, shown).text)
        assert sent[-1] == shown  # the person sees exactly what an agent is sent
    return g


@pytest.mark.parametrize("tier,seed", [("normal", 11), ("plus10", 12)])
@pytest.mark.parametrize("seat", ["rook", "ivy", "brask", "kit", "wren"])
def test_a_seat_played_by_the_expert_replays_identically(seat, tier, seed):
    g = play_as_expert(seat, seed, tier)
    ref = simulate(seed, tier, "dungeon", "expert")
    mine = [e for e in g.replay["events"] if e["type"] != "chat"]  # the expert never chats
    assert json.dumps(mine) == json.dumps(ref["events"])
    assert g.replay["meta"]["outcome"] == ref["meta"]["outcome"]
    assert g.decisions > 30


def test_an_idle_seat_changes_the_fight():
    g = Game("rook", play_seed(1, 1), "normal")
    out = g.start()
    while out["kind"] == "ask":
        out = g.answer("{}")
    assert out["metrics"]["score"] == 0  # nobody pulls without the tank
    assert expert_metrics(play_seed(1, 1), "normal")["score"] > 0


def test_answer_only_when_asked():
    g = Game("wren", play_seed(1, 1), "normal")
    with pytest.raises(RuntimeError):
        g.answer("{}")


def test_play_seeds_are_off_every_benchmark_schedule():
    protocol = json.loads((ROOT / "protocol" / "v1.json").read_text())
    for key in ("seed_base", "restart_seed_base"):
        assert protocol[key] + 10_000 <= SEED_BASE
    assert play_seed(1, 1) > SEED_BASE


def test_the_browser_bundle_is_current():
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "build_play_bundle.py"), "--check"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
