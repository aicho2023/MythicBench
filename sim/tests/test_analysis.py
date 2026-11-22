"""The analysis export: flat files from runs or a results dataset."""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path

from mythicsim import analysis as A
from mythicsim import campaign as K

from test_campaign import sandbox  # noqa: F401  (the fixture)

SAMPLE = Path(__file__).resolve().parents[2] / "web" / "public" / "results" / "sample"


def _rows(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text)))


def test_a_results_folder_exports_every_pull_and_group(tmp_path):
    refs, max_pulls = A.from_results(SAMPLE)
    board = json.loads((SAMPLE / "leaderboard.json").read_text())

    def pulls(cell):
        return sum(len(e["pulls"]) for k in ("episode_list", "paired_episode_list") for e in cell.get(k) or [])

    expected = sum(pulls(c) for r in board["leaderboard"] + board["baselines"] for c in r["tiers"].values())
    expected += sum(pulls(c) for c in board["controls"])
    expected += sum(pulls(c) for cfg in board["configs"] for c in cfg["tiers"].values())
    assert len(refs) == expected > 0
    res = A.export(refs, max_pulls, tmp_path / "out", "sample")
    out = tmp_path / "out"
    rows = _rows((out / "pulls.csv").read_text())
    assert len(rows) == expected
    assert {r["role"] for r in rows} == {"ranked", "control", "baseline"}
    groups = _rows((out / "groups.csv").read_text())
    assert len(groups) == res["groups"] == len(list((out / "groups").rglob("*.md")))
    # Every group's score matches the leaderboard's.
    for row in board["leaderboard"]:
        for tier, cell in row["tiers"].items():
            mine = sorted(float(g["group_score"]) for g in groups
                          if g["model"] == row["model"] and g["tier"] == tier and g["role"] == "ranked")
            assert mine == sorted(cell["episode_scores"])
    story = next((out / "groups").rglob("ranked-g0.md")).read_text()
    assert "## Pull 1" in story and "### The fight" in story and "### The debrief" in story
    for name in ("README.md", "overview.md", "deaths.csv", "mechanics.csv", "damage_taken.csv", "calls.jsonl",
                 "between_pulls.jsonl"):
        assert (out / name).stat().st_size > 0
    assert "prompt" not in json.loads((out / "calls.jsonl").read_text().splitlines()[0])


def test_the_export_is_deterministic_and_zips(tmp_path):
    refs, max_pulls = A.from_results(SAMPLE)
    A.export(refs, max_pulls, tmp_path / "a", "sample", make_zip=True)
    A.export(list(reversed(refs)), max_pulls, tmp_path / "b" / "a", "sample", make_zip=True)
    assert (tmp_path / "a.zip").read_bytes() == (tmp_path / "b" / "a.zip").read_bytes()


def test_prompts_only_when_asked(tmp_path):
    refs, max_pulls = A.from_results(SAMPLE)
    A.export(refs[:1], max_pulls, tmp_path / "p", "sample", prompts=True)
    call = json.loads((tmp_path / "p" / "calls.jsonl").read_text().splitlines()[0])
    assert call["prompt"]


def test_local_runs_export_with_their_run_ids(sandbox, tmp_path):  # noqa: F811
    tmp, proto = sandbox
    K.run_campaign(proto)
    refs, max_pulls = A.from_runs(tmp / "runs")
    assert max_pulls == proto["max_pulls"]
    assert {r["role"] for r in refs} == {"campaign"}
    assert {r["memory"] for r in refs} == {True, False}
    A.export(refs, max_pulls, tmp_path / "out", "runs")
    stories = list((tmp_path / "out" / "groups").rglob("*.md"))
    # Group numbers repeat across runs: every group still gets its own story.
    assert len(stories) == len({(r["run_id"], r["group"]) for r in refs})
    one = refs[0]["run_id"]
    only, _ = A.from_runs(tmp / "runs", select=[one])
    assert only and {r["run_id"] for r in only} == {one}


def _pull(events, units=None):
    players = [{"id": p, "name": p.title(), "kind": "player", "role": "dps"} for p in ("rook", "ivy", "kit")]
    rep = {"meta": {"seed": 1, "metrics": {"score": 10.0, "outcome": "wipe", "deaths": []}},
           "units": players + (units or [{"id": "oruth", "name": "Oruth", "kind": "boss"},
                                         {"id": "chanter", "name": "Bone Chanter", "kind": "enemy"}]),
           "abilities": {"requiem_of_bones": {"name": "Requiem of Bones", "cast_ms": 3000},
                         "grave_volley": {"name": "Grave Volley", "cast_ms": 2000}},
           "events": [{"t": 0, "type": "encounter_start", "boss": "oruth"}] + events}
    ref = {"model": "m", "provider": "mock", "effort": "medium", "tier": "plus10", "role": "ranked",
           "memory": True, "group": 0, "pull": 1, "run_id": "r", "stats": {}}
    return A.Pull(ref, rep)


def test_mechanics_are_classified():
    p = _pull([
        # Kicked, then missed, then the caster dies mid-cast (neither).
        {"t": 1000, "type": "cast_start", "unit": "oruth", "ability": "requiem_of_bones", "interruptible": True},
        {"t": 1500, "type": "cast_interrupted", "unit": "oruth", "ability": "requiem_of_bones", "by": "kit",
         "reason": "interrupt"},
        {"t": 2000, "type": "cast_start", "unit": "chanter", "ability": "grave_volley", "interruptible": True},
        {"t": 4000, "type": "cast_success", "unit": "chanter", "ability": "grave_volley"},
        {"t": 5000, "type": "cast_start", "unit": "chanter", "ability": "grave_volley", "interruptible": True},
        {"t": 5500, "type": "death", "unit": "chanter"},
        # A player's own cast bar is never a kick.
        {"t": 5600, "type": "cast_start", "unit": "ivy", "ability": "x", "interruptible": True},
        # One empty pyre, one soaked.
        {"t": 6000, "type": "pyre_detonate", "inside": [], "soaked": False},
        {"t": 7000, "type": "pyre_detonate", "inside": ["rook", "ivy"], "soaked": True},
        # A mark that caught an ally.
        {"t": 8000, "type": "aura_apply", "unit": "kit", "aura": "grave_mark", "duration_ms": 6000},
        {"t": 14000, "type": "damage", "target": "kit", "ability": "grave_mark", "amount": 5000},
        {"t": 14000, "type": "damage", "target": "rook", "ability": "grave_mark", "amount": 9000, "absorbed": 1000},
    ])
    row = p.row()
    assert (row["boss_kicks"], row["boss_kickable"]) == (1, 1)
    assert (row["trash_kicks"], row["trash_kickable"]) == (0, 1)
    assert (row["pyres"], row["pyres_soaked"], row["pyre_mean_inside"]) == (2, 1, 1.0)
    assert (row["marks"], row["mark_allies_hit"]) == (1, 1)
    mark = next(x for x in p.mech if x["mechanic"] == "grave_mark")
    assert mark["marked"] == "kit" and mark["hit"] == ["rook"]
    dmg = {(d["unit"], d["ability"]): d["amount"] for d in p.damage_taken()}
    assert dmg[("rook", "grave_mark")] == 10000  # absorbed counts as taken
    tl = "\n".join(p.timeline())
    assert "Requiem of Bones, kicked by Kit" in tl and "Grave Volley, not kicked" in tl
    assert "nobody inside -> NOT soaked" in tl and "2 inside: Rook, Ivy -> soaked" in tl
    assert "Grave Mark on Kit, also hit Rook" in tl


def test_deaths_list_the_last_five_seconds():
    p = _pull([
        {"t": 1000, "type": "damage", "target": "ivy", "ability": "old", "amount": 1},
        {"t": 7000, "type": "damage", "target": "ivy", "ability": "bone_pyre", "amount": 30000},
        {"t": 9000, "type": "damage", "target": "ivy", "ability": "desecrate", "amount": 8000},
        {"t": 9000, "type": "death", "unit": "ivy", "ability": "desecrate", "killer": "oruth"},
        {"t": 9100, "type": "death", "unit": "chanter"},  # enemies aren't listed
    ])
    (d,) = p.deaths()
    assert d["unit"] == "ivy" and d["ability"] == "desecrate" and d["t_s"] == 9.0
    assert d["last_5s"] == "bone_pyre 30000; desecrate 8000"
    assert p.row()["first_death"] == "ivy: desecrate"
