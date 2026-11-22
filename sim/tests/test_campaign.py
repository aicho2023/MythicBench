"""The official-protocol pipeline: campaign (resumable) -> results dataset."""

from __future__ import annotations

import functools
import hashlib
import json

import pytest

from mythicsim import campaign as K
from mythicsim import runs as R
from mythicsim import spend

PROTO = {
    "name": "test", "mode": "boss", "knowledge": "blind", "tiers": ["normal", "+10"], "episodes": 2,
    "max_pulls": 2, "effort": "medium", "interval_ms": 4000, "max_calls": 60,
    "models": [{"provider": "mock", "id": "basic", "name": "Mock"}],
    "controls": [{"model": "basic", "memory": False, "tiers": ["plus10"]}],
}
WITH_BASELINE = {**PROTO, "baselines": [{"provider": "scripted", "id": "commander", "name": "Scripted commander"}]}


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    runs_dir = tmp_path / "runs"
    monkeypatch.setattr(R, "RUNS_DIR", runs_dir)
    monkeypatch.setattr(R, "new_run", functools.partial(R.new_run, runs_dir=runs_dir))
    monkeypatch.setattr(R, "finish_run", functools.partial(R.finish_run, runs_dir=runs_dir))
    monkeypatch.setattr(R, "publish", functools.partial(R.publish, runs_dir=runs_dir, out_dir=tmp_path / "local"))
    monkeypatch.setattr(spend, "LEDGER", tmp_path / "spend.jsonl")
    proto = json.loads(json.dumps(PROTO))
    for m in proto["models"]:
        m.setdefault("effort", proto["effort"])
    return tmp_path, proto


def tree_digest(d) -> str:
    h = hashlib.sha256()
    for p in sorted(d.rglob("*")):
        if p.is_file():
            h.update(p.relative_to(d).as_posix().encode())
            h.update(p.read_bytes())
    return h.hexdigest()


def test_campaign_plays_every_combo_then_resumes_nothing(sandbox, capsys):
    tmp, proto = sandbox
    K.run_campaign(proto)
    keys = {c.key(proto) for c in K.combos(proto)}
    assert len(keys) == 3  # 2 tiers + 1 memory-off control
    for k in keys:
        assert set(K.finished_episodes(k, tmp / "runs")) == {0, 1}
    n_runs = len(list((tmp / "runs").glob("*/manifest.json")))
    K.run_campaign(proto)  # everything is done: plays nothing new
    assert len(list((tmp / "runs").glob("*/manifest.json"))) == n_runs
    assert "0 episodes still to play" in capsys.readouterr().out


def test_campaign_only_plays_missing_episodes(sandbox):
    tmp, proto = sandbox
    small = dict(proto, episodes=1)
    K.run_campaign(small)
    K.run_campaign(proto)  # episode 0 already done: only episode 1 is played now
    for m in R.load_manifests(tmp / "runs"):
        assert m["episodes"] in ([0], [1])


def test_results_are_complete_and_rebuild_identically(sandbox):
    tmp, proto = sandbox
    K.run_campaign(proto)
    a = K.build_results(proto, tmp / "res-a", tmp / "runs", with_bots=False)
    K.build_results(proto, tmp / "res-b", tmp / "runs", with_bots=False)
    assert tree_digest(tmp / "res-a") == tree_digest(tmp / "res-b")
    (row,) = a["leaderboard"]
    assert set(row["tiers"]) == {"normal", "plus10"}
    cell = row["tiers"]["plus10"]
    assert cell["episodes"] == 2 and 2 <= cell["pulls"] <= 4 and len(cell["curve_mean"]) == 2
    assert row["mythicbench_score"] == cell["progression_score"]  # the headline is +10
    assert row["mythicbench_score_ci95"] == cell["progression_score_ci95"]
    assert a["controls"] and a["controls"][0]["memory"] is False
    replays = list((tmp / "res-a" / "replays").rglob("*.json.gz"))
    assert len(replays) == sum(c["pulls"] for c in row["tiers"].values()) + a["controls"][0]["pulls"]


def test_dry_run_plays_nothing(sandbox, capsys):
    tmp, proto = sandbox
    K.run_campaign(proto, dry_run=True)
    assert not (tmp / "runs").exists() or not list((tmp / "runs").glob("*/manifest.json"))
    assert "worst case" in capsys.readouterr().out


def test_campaign_key_names_the_code_versions():
    from mythicsim.engine import SIM_VERSION
    from mythicsim.llm import HARNESS_VERSION
    (c, *_) = K.combos(PROTO)
    key = c.key(PROTO)
    assert HARNESS_VERSION in key and SIM_VERSION in key and K.C.CONTENT_VERSION in key


def test_learning_effect_is_measured_against_the_control(sandbox):
    tmp, proto = sandbox
    K.run_campaign(proto)
    res = K.build_results(proto, tmp / "res", tmp / "runs", with_bots=False)
    (row,) = res["leaderboard"]
    cell, ctl = row["tiers"]["plus10"], res["controls"][0]
    assert cell["learning_effect"] == round(cell["progression_score"] - ctl["progression_score"], 1)
    assert "learning_effect" not in row["tiers"]["normal"]  # no control there
    assert row["rank"] == 1 and row["complete"]


def test_incomplete_cells_are_not_ranked(sandbox):
    tmp, proto = sandbox
    K.run_campaign(dict(proto, episodes=1))
    res = K.build_results(proto, tmp / "res", tmp / "runs", with_bots=False)  # protocol wants 2 episodes
    (row,) = res["leaderboard"]
    assert not row["complete"] and row["rank"] is None
    assert row["tiers"]["normal"]["complete"] is False


def test_paid_campaign_refuses_uncommitted_code(sandbox, monkeypatch):
    tmp, proto = sandbox
    paid = dict(proto, models=[{"provider": "anthropic", "id": "claude-haiku-5-5", "effort": "medium"}])
    monkeypatch.setattr(K, "dirty_files", lambda: ["sim/mythicsim/engine.py"])
    with pytest.raises(SystemExit, match="uncommitted"):
        K.run_campaign(paid)


def test_results_ship_the_recordings(sandbox):
    tmp, proto = sandbox
    K.run_campaign(proto)
    K.build_results(proto, tmp / "res", tmp / "runs", with_bots=False)
    assert list((tmp / "res" / "recordings").glob("*.jsonl.gz"))


def test_scripted_commander_is_a_baseline_not_a_ranked_model(sandbox):
    tmp, proto = sandbox
    proto = {**proto, "episodes": 1, "tiers": ["plus10"], "controls": [],
             "baselines": [{"provider": "scripted", "id": "commander", "name": "Scripted commander"}]}
    K.run_campaign(proto)
    res = K.build_results(proto, tmp / "res", tmp / "runs", with_bots=False)
    assert [r["model"] for r in res["leaderboard"]] == ["basic"] and res["leaderboard"][0]["rank"] == 1
    (base,) = res["baselines"]
    assert base["model"] == "commander" and base["rank"] is None and base["baseline"]
    assert base["mythicbench_score"] > res["leaderboard"][0]["mythicbench_score"]  # rules beat the mock
