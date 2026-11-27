"""The expert script: a clear is possible through the agents' own interface.

It reads the same text an agent reads and answers in the same JSON, through the
same harness (no hidden state, no special moves); only its rules know the fight.
These pin its showcase clears (dev seeds, never the official schedules) so a
change to the game or the harness that makes them impossible shows up here.
"""

from __future__ import annotations

import json

import pytest

from mythicsim.__main__ import EXPERT_SEEDS, SHOWCASE, simulate
from mythicsim.dungeon import DungeonRun
from mythicsim.llm import expert
from mythicsim.llm.policy import make_llm_policies
from mythicsim.metrics import score


@pytest.mark.parametrize("tier", ["normal", "plus10"])
def test_expert_showcase_clears(tier):
    s = score(simulate(EXPERT_SEEDS[tier], tier, "dungeon", "expert"))
    assert s["outcome"] == "victory" and s["in_time"], s
    assert s["score"] >= 70


def test_showcase_seeds_are_off_the_official_schedules():
    for spec in SHOWCASE:
        assert not (70000 <= spec["seed"] < 90000), spec  # v1 and its restart use 70000+ and 80000+


@pytest.fixture(scope="module")
def expert_party():
    """The party after the expert's +10 showcase run, with every call it made."""
    pols, party = make_llm_policies(expert.ExpertScript(), tier="plus10", mode="dungeon", knowledge="blind",
                                    parallel=False)
    DungeonRun(EXPERT_SEEDS["plus10"], pols, "x", "plus10").run()
    return party


def test_expert_replies_are_valid_orders(expert_party):
    """Every reply parses as orders the harness accepts (no dropped entries)."""
    party = expert_party
    st = party.stats
    assert st.calls > 500
    assert st.unusable_replies == 0 and st.invalid_entries == 0
    for c in party.calls[:50]:
        json.loads(c["reply"])


def test_read_state_parses_a_real_prompt(expert_party):
    boss_calls = [c for c in expert_party.calls if "BOSS oruth " in c["prompt"] and "asleep" not in c["prompt"]]
    s = expert.read_state(boss_calls[0]["prompt"])
    assert s["boss"] and s["boss"]["id"] == "oruth"
    assert set(s["party"]) == {"rook", "ivy", "brask", "kit", "wren"}
    assert s["in_combat"]


def test_scripted_players_are_chosen_by_name():
    """`scripted:expert` plays the expert's rules, not the commander's under its label."""
    from mythicsim.llm.clients import ClientError, make_client
    from mythicsim.llm.scripted import ScriptedCommander
    assert type(make_client("scripted:expert")) is expert.ExpertScript
    assert type(make_client("scripted:commander")) is ScriptedCommander
    assert make_client("scripted:expert").spec == "scripted:expert"
    with pytest.raises(ClientError):
        make_client("scripted:nobody")
