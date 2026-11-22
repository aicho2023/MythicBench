"""Run storage: folders, manifests, registry, viewer catalog, legacy import.

Everything uses temporary folders; the real runs/ directory is never touched.
"""

import json

import pytest

from mythicsim import runs as R
from mythicsim.__main__ import simulate
from mythicsim.metrics import score


def make_run(tmp, label="anthropic:claude-haiku-5-5@none", seeds=(0, 1), name=None, tags=None):
    run = R.new_run(label, mode="single", name=name, tags=tags,
                    config={"seeds": list(seeds), "harness_version": "0.3.0"}, runs_dir=tmp)
    items = []
    for s in seeds:
        rep = simulate(s, "plus10", "boss")
        m = score(rep)
        rep["meta"]["metrics"] = m
        run.replay_path(s).write_text(json.dumps(rep))
        items.append({"seed": s, "file": f"seeds/seed-{s}.json", "outcome": m["outcome"],
                      "score": m["score"], "duration_s": m["duration_s"]})
    R.finish_run(run, {"score_mean": 20.0, "win_rate": 0.0}, items, runs_dir=tmp)
    return run


def test_run_ids_are_readable_sortable_and_unique():
    a, b = R.make_run_id("anthropic:claude-haiku-5-5@none"), R.make_run_id("anthropic:claude-haiku-5-5@none")
    assert a != b
    assert R.RUN_ID_RE.match(a) and "_claude-haiku-5-5@none_" in a and "anthropic" not in a


def test_new_and_finished_run(tmp_path):
    run = make_run(tmp_path, name="baseline", tags=["smoke"])
    m = json.loads((run.dir / "manifest.json").read_text())
    assert m["status"] == "done" and m["name"] == "baseline" and m["tags"] == ["smoke"]
    assert m["provider"] == "anthropic" and m["model"] == "claude-haiku-5-5" and m["effort"] == "none"
    assert [i["seed"] for i in m["items"]] == [0, 1]
    reg = [json.loads(l) for l in (tmp_path / "registry.jsonl").read_text().splitlines()]
    assert reg[0]["run_id"] == run.run_id and reg[0]["n"] == 2


def test_list_filter_find_and_remove(tmp_path):
    a = make_run(tmp_path, label="openai:gpt-5.4-mini", tags=["x"])
    b = make_run(tmp_path, label="anthropic:claude-haiku-5-5@none")
    ms = R.load_manifests(tmp_path)
    assert {m["run_id"] for m in ms} == {a.run_id, b.run_id}
    assert [m["run_id"] for m in R.filter_runs(ms, model="gpt-5.4")] == [a.run_id]
    assert [m["run_id"] for m in R.filter_runs(ms, tag="x")] == [a.run_id]
    assert [m["run_id"] for m in R.filter_runs(ms, effort="none")] == [b.run_id]
    assert [m["run_id"] for m in R.filter_runs(ms, effort="default")] == [a.run_id]
    assert R.find_run(a.run_id[-4:], tmp_path)["run_id"] == a.run_id
    with pytest.raises(SystemExit):
        R.find_run("no-such-run", tmp_path)
    with pytest.raises(SystemExit):  # ambiguous: both ids contain the timestamp's year
        R.find_run(a.run_id[:4], tmp_path)
    pub = tmp_path / "pub"
    R.publish(tmp_path, pub)
    R.remove_run(a.run_id, tmp_path, pub)
    assert not (tmp_path / a.run_id).exists() and not (pub / a.run_id).exists()
    assert [json.loads(l)["run_id"] for l in (tmp_path / "registry.jsonl").read_text().splitlines()] == [b.run_id]


def test_publish_builds_catalog_without_hiding_other_runs(tmp_path):
    a, b = make_run(tmp_path), make_run(tmp_path, label="openai:gpt-5.4-mini")
    pub = tmp_path / "pub"
    (pub).mkdir()
    (pub / "index.json").write_text("[]")  # the old flat list gets removed
    assert R.publish(tmp_path, pub, only=[a.run_id]) == 2  # b's missing files are restored too
    assert R.publish(tmp_path, pub, only=[b.run_id]) == 2  # a stays listed
    cat = json.loads((pub / "catalog.json").read_text())
    assert cat["current_harness_version"] and {r["run_id"] for r in cat["runs"]} == {a.run_id, b.run_id}
    item = cat["runs"][0]["items"][0]
    assert (pub / item["file"]).exists() and item["file"].startswith(cat["runs"][0]["run_id"] + "/")
    assert not (pub / "index.json").exists()


def test_publish_restores_missing_files(tmp_path):
    a = make_run(tmp_path)
    pub = tmp_path / "pub"
    R.publish(tmp_path, pub)
    import shutil
    shutil.rmtree(pub / a.run_id)  # e.g. an older layout, or a deleted folder
    assert R.publish(tmp_path, pub, only=[]) == 1 and (pub / a.run_id / "seeds" / "seed-0.json").exists()


def test_unfinished_runs_are_not_published(tmp_path):
    R.new_run("openai:gpt-5.4-mini", mode="single", config={}, runs_dir=tmp_path)
    assert R.publish(tmp_path, tmp_path / "pub") == 0


def test_import_legacy_keeps_originals(tmp_path):
    old = tmp_path / "openai_gpt-5.4-mini"
    old.mkdir()
    for s in (3, 4):
        rep = simulate(s, "plus10", "boss")
        rep["meta"]["policy"] = "llm:openai:gpt-5.4-mini"
        (old / f"seed-{s}.json").write_text(json.dumps(rep))
        (old / f"seed-{s}.stats.json").write_text("{}")
    (tmp_path / "cache").mkdir()
    made = R.import_legacy(tmp_path)
    assert len(made) == 1
    m = R.find_run(made[0], tmp_path)
    assert m["tags"] == ["legacy"] and m["harness_version"] == "legacy" and [i["seed"] for i in m["items"]] == [3, 4]
    assert (tmp_path / made[0] / "seeds" / "seed-3.stats.json").exists()
    assert (tmp_path / ".legacy-originals" / "openai_gpt-5.4-mini" / "seed-3.json").exists()
    assert R.import_legacy(tmp_path) == []  # idempotent


def test_rescore_recomputes_scores_and_summaries(tmp_path):
    run = make_run(tmp_path)
    m = json.loads((run.dir / "manifest.json").read_text())
    m["items"][0]["score"] = 999.0  # stale value from an older scoring
    (run.dir / "manifest.json").write_text(json.dumps(m))
    assert R.rescore(tmp_path) == 2
    m = json.loads((run.dir / "manifest.json").read_text())
    rep = json.loads((run.dir / m["items"][0]["file"]).read_text())
    assert m["items"][0]["score"] == rep["meta"]["metrics"]["score"] <= 100
    assert m["summary"]["score_version"] == 2 and m["summary"]["score_mean"] <= 100
