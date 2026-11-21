"""Tests that protect the benchmark's integrity.

If any of these fail, results are not trustworthy — so they run on every change.
"""

import hashlib
import json
from pathlib import Path

import jsonschema
import pytest

from mythicsim.__main__ import SHOWCASE_SEED, bench, simulate
from mythicsim.metrics import run_score, score

SCHEMA = json.loads((Path(__file__).parents[2] / "schema" / "replay.schema.json").read_text())


@pytest.fixture(scope="module", params=["expert", "competent", "sloppy"])
def replay(request):
    return simulate(request.param, SHOWCASE_SEED)


def digest(rep: dict) -> str:
    return hashlib.sha256(json.dumps(rep, sort_keys=True).encode()).hexdigest()


def test_deterministic_same_seed():
    """Same seed + same policy must give a byte-identical replay."""
    assert digest(simulate("sloppy", 5)) == digest(simulate("sloppy", 5))


def test_different_seeds_differ():
    assert digest(simulate("sloppy", 5)) != digest(simulate("sloppy", 6))


def test_matches_schema(replay):
    jsonschema.validate(replay, SCHEMA)


def test_events_are_time_ordered(replay):
    ts = [e["t"] for e in replay["events"]]
    assert ts == sorted(ts)


def test_hp_is_consistent(replay):
    """Every damage/heal event's ``hp`` must equal the running total.

    This is what lets the viewer trust the log: replaying amounts from
    max_hp reproduces the simulator's health exactly.
    """
    hp = {u["id"]: u["max_hp"] for u in replay["units"]}
    for e in replay["events"]:
        if e["type"] == "spawn":
            hp[e["unit"]["id"]] = e["unit"]["max_hp"]
        elif e["type"] == "damage":
            hp[e["target"]] -= e["amount"]
            assert hp[e["target"]] == e["hp"], e
        elif e["type"] == "heal":
            hp[e["target"]] += e["amount"]
            assert hp[e["target"]] == e["hp"], e
    end = replay["events"][-1]
    assert end["type"] == "encounter_end"
    for uid, final in end["final_hp"].items():
        assert hp[uid] == final


def test_no_actions_after_death(replay):
    dead = set()
    for e in replay["events"]:
        if e["type"] == "death":
            dead.add(e["unit"])
        elif e["type"] in ("cast_start", "cast_success", "move") and e["unit"] in dead:
            raise AssertionError(f"dead unit acted: {e}")


def test_showcase_outcomes():
    scores = {p: score(simulate(p, SHOWCASE_SEED)) for p in ("expert", "competent", "sloppy")}
    assert scores["expert"]["outcome"] == "victory"
    assert scores["sloppy"]["outcome"] == "wipe"
    assert scores["expert"]["score"] > scores["competent"]["score"] > scores["sloppy"]["score"]


def test_boss_script_is_the_same_for_every_policy():
    """A seed fixes the boss's timers: the first cast of each timed ability
    lands at the same moment whoever is playing (policies can't shift it)."""
    def first_casts(policy):
        seen = {}
        for e in simulate(policy, 21)["events"]:
            if e["type"] in ("cast_start", "cast_success") and e["unit"] == "mortisar" \
                    and e["ability"] in ("requiem_of_bones", "soul_rend", "desecrate"):
                seen.setdefault(e["ability"], e["t"])
        return seen
    assert first_casts("expert") == first_casts("sloppy")


def test_seeds_vary_the_boss_script():
    def first_requiem(seed):
        return next(e["t"] for e in simulate("expert", seed)["events"]
                    if e["type"] == "cast_start" and e["ability"] == "requiem_of_bones")
    assert len({first_requiem(s) for s in range(8)}) > 1


def test_no_platform_dependent_math():
    """Replays must be identical on every machine (CI regenerates them on Linux).
    libm functions like hypot/cos/sin can differ in the last bit between CPU
    platforms, and one flipped comparison changes the whole fight."""
    import re
    src = Path(__file__).parents[1] / "mythicsim"
    banned = re.compile(r"math\.(hypot|cos|sin|tan|atan2?|exp|log|pow)\b|\*\* *0?\.5")
    for f in ("engine.py", "policies.py", "content.py"):
        hits = banned.findall((src / f).read_text())
        assert not hits, f"{f} uses platform-dependent math: {hits}"


def test_run_score():
    assert run_score("victory", 170.0, 0.0, 195.0) == 125.0
    assert run_score("wipe", 120.0, 38.0, 195.0) == 62.0


def test_reference_bots_rank_in_order():
    """The benchmark's own sanity check: three known skill levels must come out
    in the right order, with non-overlapping 95% confidence intervals."""
    e, c, s = (bench(p, 40) for p in ("expert", "competent", "sloppy"))
    assert e["score_ci95"][0] > c["score_ci95"][1]
    assert c["score_ci95"][0] > s["score_ci95"][1]
