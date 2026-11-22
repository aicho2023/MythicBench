"""The official-protocol pipeline: campaign (resumable) -> results dataset."""

from __future__ import annotations

import functools
import hashlib
import json
import tempfile
from pathlib import Path

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


def test_a_staged_campaign_adds_up_to_the_full_one(sandbox):
    tmp, proto = sandbox
    K.run_campaign(proto, first=1)  # stage 1: each cell's first episode only
    for c in K.combos(proto):
        assert set(K.finished_episodes(c.key(proto), tmp / "runs")) == {0}
    K.run_campaign(proto)  # stage 2: the rest, same protocol
    for c in K.combos(proto):
        assert set(K.finished_episodes(c.key(proto), tmp / "runs")) == {0, 1}


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
    a = K.build_results(proto, tmp / "res-a", tmp / "runs")
    K.build_results(proto, tmp / "res-b", tmp / "runs")
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
    assert "if every group plays all" in capsys.readouterr().out


def test_campaign_key_names_the_code_versions():
    from mythicsim.engine import SIM_VERSION
    from mythicsim.llm import HARNESS_VERSION
    (c, *_) = K.combos(PROTO)
    key = c.key(PROTO)
    assert HARNESS_VERSION in key and SIM_VERSION in key and K.C.CONTENT_VERSION in key


def test_learning_effect_is_measured_against_the_control(sandbox):
    tmp, proto = sandbox
    K.run_campaign(proto)
    res = K.build_results(proto, tmp / "res", tmp / "runs")
    (row,) = res["leaderboard"]
    cell, ctl = row["tiers"]["plus10"], res["controls"][0]
    assert cell["learning_effect"] == round(cell["progression_score"] - ctl["progression_score"], 1)
    assert "learning_effect" not in row["tiers"]["normal"]  # no control there
    assert row["rank"] == 1 and row["complete"]


def test_incomplete_cells_are_not_ranked(sandbox):
    tmp, proto = sandbox
    K.run_campaign(dict(proto, episodes=1))
    res = K.build_results(proto, tmp / "res", tmp / "runs")  # protocol wants 2 episodes
    (row,) = res["leaderboard"]
    assert not row["complete"] and row["rank"] is None
    assert row["tiers"]["normal"]["complete"] is False


def test_paid_campaign_refuses_uncommitted_code(sandbox, monkeypatch):
    tmp, proto = sandbox
    paid = dict(proto, models=[{"provider": "anthropic", "id": "claude-haiku-5-5", "effort": "medium"}], controls=[])
    monkeypatch.setattr(K, "dirty_files", lambda: ["sim/mythicsim/engine.py"])
    with pytest.raises(SystemExit, match="uncommitted"):
        K.run_campaign(paid)


def test_results_ship_the_recordings(sandbox):
    tmp, proto = sandbox
    K.run_campaign(proto)
    K.build_results(proto, tmp / "res", tmp / "runs")
    assert list((tmp / "res" / "recordings").glob("*.jsonl.gz"))


def test_scripted_commander_is_a_baseline_not_a_ranked_model(sandbox):
    tmp, proto = sandbox
    proto = {**proto, "episodes": 1, "tiers": ["plus10"], "controls": [],
             "baselines": [{"provider": "scripted", "id": "commander", "name": "Scripted commander"}]}
    K.run_campaign(proto)
    res = K.build_results(proto, tmp / "res", tmp / "runs")
    assert [r["model"] for r in res["leaderboard"]] == ["basic"] and res["leaderboard"][0]["rank"] == 1
    (base,) = res["baselines"]
    assert base["model"] == "commander" and base["rank"] is None and base["baseline"]
    assert base["mythicbench_score"] > res["leaderboard"][0]["mythicbench_score"]  # rules beat the mock


def test_cells_in_parallel_give_the_same_results(sandbox):
    tmp, proto = sandbox
    K.run_campaign(proto, cells=3, workers=2)
    for c in K.combos(proto):
        assert set(K.finished_episodes(c.key(proto), tmp / "runs")) == {0, 1}
    a = K.build_results(proto, tmp / "res", tmp / "runs")
    assert a["leaderboard"][0]["complete"]


def test_a_shared_cap_is_never_overshot_by_parallel_calls():
    from concurrent.futures import ThreadPoolExecutor
    from mythicsim.llm.clients import Reply

    class Paid:
        spec = "fake:paid"
        def complete(self, system, user, tag=""):
            import time
            time.sleep(0.01)
            return Reply("ok", 1000, 1000)

    price = spend.Price(input=100.0, output=100.0, cached=100.0)  # $0.20 per call actual, worst case far more
    g = spend.CAMPAIGN
    g.disarm()
    g.arm(5.0)
    try:
        meter = spend.CostMeter(Paid(), price, ledger=None, limit_usd=None)
        meter.ledger = Path(tempfile.mkdtemp()) / "spend.jsonl"
        def go(_):
            try:
                meter.complete("s" * 100, "u" * 100)
            except spend.BudgetExceeded:
                pass
        with ThreadPoolExecutor(8) as pool:
            list(pool.map(go, range(100)))
        assert g.spent <= 5.0 and abs(g.reserved) < 1e-9
    finally:
        g.disarm()


def test_a_second_arm_doesnt_reset_the_guard():
    g = spend.Guard("test")
    g.arm(cap=1.0, already_spent=0.9)
    g.arm(cap=99.0, already_spent=0.0)
    with pytest.raises(spend.BudgetExceeded):
        g.reserve(0.2)


def test_changing_the_rules_retires_old_episodes(sandbox):
    """GPT's repro: one-pull episodes must not count once the protocol says three."""
    tmp, proto = sandbox
    short = dict(proto, max_pulls=1, controls=[])
    K.run_campaign(short)
    longer = dict(short, max_pulls=3)
    res = K.build_results(longer, tmp / "res", tmp / "runs")
    assert res["leaderboard"] == []  # nothing played under the 3-pull rules yet
    assert all(not K.finished_episodes(c.key(longer), tmp / "runs") for c in K.combos(longer))


def test_only_contiguous_episodes_that_end_properly_count():
    v = K.valid_episode
    wipe = lambda k: {"pull": k, "outcome": "wipe", "score": 40}  # noqa: E731
    clear = lambda k: {"pull": k, "outcome": "victory", "in_time": True, "score": 80}  # noqa: E731
    assert v([wipe(1), wipe(2), wipe(3)], 3)
    assert v([wipe(1), clear(2)], 3)
    assert not v([wipe(1), wipe(2)], 3)  # stopped early without a clear
    assert not v([wipe(1), wipe(3)], 3)  # a gap
    assert not v([clear(1), wipe(2)], 3)  # played on after a clear


def test_finished_episodes_survive_a_failed_run(sandbox):
    tmp, proto = sandbox
    small = dict(proto, controls=[], tiers=["plus10"], episodes=1)
    K.run_campaign(small)
    (c,) = K.combos(small)
    run_id = K.finished_episodes(c.key(small), tmp / "runs")[0][0]["run_id"]
    man = tmp / "runs" / run_id / "manifest.json"
    m = json.loads(man.read_text())
    m["items"], m["status"] = [], "failed"  # the run died later: its manifest never got items
    man.write_text(json.dumps(m))
    assert 0 in K.finished_episodes(c.key(small), tmp / "runs", small["max_pulls"])  # the checkpoint still counts


def test_learning_effect_is_paired_by_episode(sandbox):
    tmp, proto = sandbox
    proto = dict(proto, tiers=["plus10"], episodes=1, controls=[{"model": "basic", "memory": False, "episodes": 2}])
    K.run_campaign(proto)
    res = K.build_results(proto, tmp / "res", tmp / "runs")
    cell = res["leaderboard"][0]["tiers"]["plus10"]
    assert cell["episodes"] == 1  # ranked on the protocol's episode count
    pairs = cell["learning_pairs"]
    assert [p["episode"] for p in pairs] == [0, 1]
    assert cell["learning_effect"] == round(sum(p["on"] - p["off"] for p in pairs) / 2, 1)


def test_protocol_roles_merge_into_cells():
    proto = {**PROTO, "tiers": ["plus10"], "episodes": 6,
             "controls": [{"model": "basic", "episodes": 12}],
             "sanity": [{"model": "basic", "tiers": ["normal"], "episodes": 3}],
             "efforts": [{"model": "basic", "efforts": ["low"], "episodes": 3}]}
    cs = {(c.spec, c.tier, c.memory): c for c in K.combos(proto)}
    assert cs[("mock:basic", "plus10", True)].episodes == tuple(range(12))  # ranked side extended for pairing
    assert cs[("mock:basic", "plus10", False)].role == "control"
    assert cs[("mock:basic", "normal", True)].role == "sanity"


def test_verify_replays_the_campaign_from_recordings(sandbox, capsys):
    tmp, proto = sandbox
    proto = dict(proto, tiers=["plus10"], episodes=1, controls=[])
    K.run_campaign(proto)
    assert K.verify_campaign(proto, tmp / "runs") == 0
    rec = next(K.recordings_dir(proto, tmp / "runs").glob("*.jsonl"))
    lines = rec.read_text().splitlines()
    rec.write_text("\n".join(lines[: len(lines) // 2]) + "\n")  # lose half the recording
    from mythicsim.llm import clients
    clients._RECORDINGS.clear()
    assert K.verify_campaign(proto, tmp / "runs") == 1
    assert "FAIL" in capsys.readouterr().out


def _tamper_checkpoint(tmp, proto, **changes):
    m = next(m for m in R.load_manifests(tmp / "runs") if m.get("campaign_key"))
    mark = tmp / "runs" / m["run_id"] / "episodes" / str(m["episodes"][0]) / "episode.json"
    ck = json.loads(mark.read_text())
    ck["items"][0].update(changes)
    mark.write_text(json.dumps(ck))


@pytest.mark.parametrize("changes", [{"score": 99.9}, {"seed": 99999}])
def test_verify_catches_a_doctored_checkpoint(sandbox, capsys, changes):
    tmp, proto = sandbox
    K.run_campaign(proto)
    assert K.verify_campaign(proto, tmp / "runs") == 0
    _tamper_checkpoint(tmp, proto, **changes)
    assert K.verify_campaign(proto, tmp / "runs") == 1
    assert "the replay says" in capsys.readouterr().out


def test_verify_wants_every_group_unless_told_it_is_a_stage(sandbox):
    tmp, proto = sandbox
    K.run_campaign(proto, first=1)
    assert K.verify_campaign(proto, tmp / "runs") == 1  # groups 1 are missing
    assert K.verify_campaign(proto, tmp / "runs", first=1) == 0


def test_a_published_dataset_verifies_on_its_own(sandbox, capsys):
    tmp, proto = sandbox
    K.run_campaign(proto)
    out = tmp / "published"
    K.build_results(proto, out, tmp / "runs")
    import shutil
    shutil.rmtree(tmp / "runs")  # nothing local left: the folder must stand alone
    from mythicsim.llm import clients
    clients._RECORDINGS.clear()
    assert K.verify_results(out) == 0, capsys.readouterr().out
    assert K.verify_results(out, first=1) == 1  # it has more than stage 1


@pytest.mark.parametrize("where", ["score", "seed", "aggregate"])
def test_a_doctored_dataset_fails(sandbox, capsys, where):
    tmp, proto = sandbox
    K.run_campaign(proto)
    out = tmp / "published"
    K.build_results(proto, out, tmp / "runs")
    board = json.loads((out / "leaderboard.json").read_text())
    cell = board["leaderboard"][0]["tiers"]["plus10"]
    if where == "score":
        cell["episode_list"][0]["pulls"][0]["score"] = 99.9
    elif where == "seed":
        cell["episode_list"][0]["pulls"][0]["seed"] = 99999
    else:
        cell["progression_score"] = 99.9
    (out / "leaderboard.json").write_text(json.dumps(board, indent=1) + "\n")
    assert K.verify_results(out, replay=False) == 1
    assert "differs from a rebuild" in capsys.readouterr().out


def test_paired_memory_on_groups_are_published(sandbox):
    tmp, proto = sandbox
    proto = dict(proto, controls=[{"model": "basic", "memory": False, "tiers": ["plus10"], "episodes": 3}])
    K.run_campaign(proto)
    out = tmp / "published"
    board = K.build_results(proto, out, tmp / "runs")
    cell = board["leaderboard"][0]["tiers"]["plus10"]
    assert [e["episode"] for e in cell["paired_episode_list"]] == [2]  # beyond the 2 ranked groups
    assert (out / cell["paired_episode_list"][0]["pulls"][0]["file"]).exists()
    ctl = board["controls"][0]
    assert ctl["paired_on_curve_mean"] and len(cell["learning_pairs"]) == 3


def test_memory_twins_share_pull_one_only(sandbox):
    """A memory-off group replays its memory-on twin's first pull, never a later one."""
    tmp, proto = sandbox
    proto = dict(proto, tiers=["plus10"], episodes=1, controls=[{"model": "basic", "memory": False, "tiers": ["plus10"]}])
    K.run_campaign(proto)  # memory on plays first, then the control
    off = next(m for m in R.load_manifests(tmp / "runs") if m.get("memory") is False)
    stats = [json.loads((tmp / "runs" / off["run_id"] / "episodes" / "0" / f"pull-{k}.stats.json").read_text())
             for k in (1, 2)]
    assert stats[0]["cached_calls"] == stats[0]["calls"] > 0  # pull 1: the twin's, replayed
    assert stats[1]["cached_calls"] == 0  # pull 2: its own calls


@pytest.mark.parametrize("field,value", [("usd", 123.45), ("refusals", 25)])
def test_doctored_costs_and_reply_counts_fail_a_replay_check(sandbox, capsys, field, value):
    tmp, proto = sandbox
    K.run_campaign(proto)
    out = tmp / "published"
    K.build_results(proto, out, tmp / "runs")
    board = json.loads((out / "leaderboard.json").read_text())
    pl = board["leaderboard"][0]["tiers"]["plus10"]["episode_list"][0]["pulls"][0]
    pl["stats"][field] = value
    if field == "usd":
        pl["usd"] = value
    (out / "leaderboard.json").write_text(json.dumps(board, indent=1) + "\n")
    from mythicsim.llm import clients
    clients._RECORDINGS.clear()
    assert K.verify_results(out) == 1
    assert "differ" in capsys.readouterr().out


def test_the_verifier_never_writes_where_the_dataset_says(sandbox, tmp_path):
    """A published run id can't steer where the checker writes."""
    tmp, proto = sandbox
    K.run_campaign(proto)
    out = tmp / "published"
    K.build_results(proto, out, tmp / "runs")
    board = json.loads((out / "leaderboard.json").read_text())
    evil = "../../../../escaped-by-run-id"
    for e in board["leaderboard"][0]["tiers"]["plus10"]["episode_list"]:
        e["run_id"] = evil
    (out / "leaderboard.json").write_text(json.dumps(board, indent=1) + "\n")
    import tempfile as tf
    before = set(Path(tf.gettempdir()).parent.glob("escaped-by-run-id*")) | set(tmp.parent.glob("escaped-by-run-id*"))
    K.verify_results(out, replay=False)  # it may well fail; it must not write outside its sandbox
    after = set(Path(tf.gettempdir()).parent.glob("escaped-by-run-id*")) | set(tmp.parent.glob("escaped-by-run-id*"))
    assert after == before


@pytest.mark.parametrize("bad", ["../escape", "a/b", "..", ""])
def test_protocol_names_must_be_plain(tmp_path, bad):
    p = tmp_path / "proto.json"
    p.write_text(json.dumps(dict(PROTO, name=bad)))
    with pytest.raises(SystemExit):
        K.load_protocol(p)
    p.write_text(json.dumps(dict(PROTO, models=[{"provider": "mock", "id": bad or "x/y"}])))
    with pytest.raises(SystemExit):
        K.load_protocol(p)


def test_an_official_protocol_is_pinned(sandbox, monkeypatch, capsys):
    tmp, proto = sandbox
    K.run_campaign(proto)
    out = tmp / "published"
    K.build_results(proto, out, tmp / "runs")
    monkeypatch.setitem(K.OFFICIAL_PROTOCOLS, proto["name"], "0" * 64)  # the real one differs
    assert K.verify_results(out, replay=False) == 1
    assert "pinned" in capsys.readouterr().out


def test_v1_is_pinned_to_the_committed_protocol():
    v1 = K.load_protocol(Path(__file__).parents[2] / "protocol" / "v1.json")
    assert K.OFFICIAL_PROTOCOLS["v1"] == K.protocol_digest(v1)


def test_an_altered_official_protocol_is_refused_before_anything_runs(tmp_path):
    v1 = json.loads((Path(__file__).parents[2] / "protocol" / "v1.json").read_text())
    v1["episodes"] = 3  # same name, different protocol
    p = tmp_path / "v1.json"
    p.write_text(json.dumps(v1))
    with pytest.raises(SystemExit, match="pinned"):
        K.run_campaign(K.load_protocol(p), dry_run=True)
