"""The dungeon scoring path, pinned on small hand-checkable cases. Every
published score goes through these two functions."""

from __future__ import annotations

from mythicsim.metrics import dungeon_progress, dungeon_score, run_score

LIMIT = 255.0  # both tiers' timer, in seconds


def test_dungeon_score_of_a_wipe_is_progress_out_of_70():
    assert dungeon_score("wipe", 100.0, 0.0, LIMIT) == 0.0
    assert dungeon_score("wipe", 300.0, 62.0, LIMIT) == 43.4
    assert dungeon_score("wipe", 10.0, 100.0, LIMIT) == 70.0
    assert dungeon_score("timeout", 255.0, 50.0, LIMIT) == 35.0  # anything but a victory scores as a wipe


def test_dungeon_score_of_a_clear_is_70_plus_speed():
    assert dungeon_score("victory", LIMIT, 100.0, LIMIT) == 70.0  # at the buzzer
    assert dungeon_score("victory", 300.0, 100.0, LIMIT) == 70.0  # over time: no speed points, never below 70
    assert dungeon_score("victory", LIMIT * 0.75, 100.0, LIMIT) == 100.0  # a quarter of the timer left = par
    assert dungeon_score("victory", 60.0, 100.0, LIMIT) == 100.0  # capped
    assert dungeon_score("victory", 229.5, 100.0, LIMIT) == 82.0  # 25.5 s left = 40% of par
    assert dungeon_score("victory", 254.0, 100.0, LIMIT) == 70.5  # the expert's +10 showcase clear


def test_a_clear_scores_the_same_in_a_dungeon_as_in_a_single_fight():
    for t in (0.0, 60.0, 191.25, 200.0, 227.3, 229.5, 254.0, 255.0, 300.0):
        assert dungeon_score("victory", t, 100.0, LIMIT) == run_score("victory", t, 0.0, LIMIT)


def test_dungeon_progress_weighs_each_pack_15_and_the_boss_70():
    replay = {
        "meta": {"penalty_ms": 20_000, "revives": 2},
        "units": [
            {"id": "rook", "max_hp": 1000},
            {"id": "a", "max_hp": 100, "pack": "pack1"},
            {"id": "b", "max_hp": 300, "pack": "pack1"},
            {"id": "c", "max_hp": 200, "pack": "pack2"},
            {"id": "oruth", "max_hp": 5000},
        ],
        "events": [
            {"type": "damage", "target": "a", "hp": 0},
            {"type": "damage", "target": "b", "hp": 150},
            {"type": "heal", "target": "b", "hp": 200},  # a mended enemy gives progress back
            {"type": "damage", "target": "summoned_later", "hp": 0},  # not in the roster: ignored
            {"type": "cast", "target": "c", "hp": 0},  # only damage and heals move health
            {"type": "damage", "target": "rook", "hp": 10},
        ],
    }
    assert dungeon_progress(replay, 40.0) == {
        "progress_pct": 49.5,  # 15% x 200/400 + 15% x 0 + 70% x 60%
        "packs_cleared_pct": {"pack1": 50.0, "pack2": 0.0},
        "penalty_s": 20.0,
        "revives": 2,
    }
    assert dungeon_progress({**replay, "meta": {}}, 100.0)["progress_pct"] == 7.5
