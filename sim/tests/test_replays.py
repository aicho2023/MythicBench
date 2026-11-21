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
    assert run_score("wipe", 120.0, 100.0, 195.0) == 0.0
    assert run_score("wipe", 120.0, 38.0, 195.0) == 43.4  # 70 x 62% removed
    assert run_score("wipe", 199.0, 0.5, 195.0) < run_score("victory", 195.0, 0.0, 195.0) == 70.0
    assert run_score("victory", 195.0 * 0.75, 0.0, 195.0) == 100.0  # a quarter of the timer left = par
    assert run_score("victory", 60.0, 0.0, 195.0) == 100.0  # capped
    assert run_score("victory", 175.5, 0.0, 195.0) == 82.0  # 19.5 s left = 40% of par


def test_reference_bots_rank_in_order():
    """The benchmark's own sanity check: three known skill levels must come out
    in the right order, with non-overlapping 95% confidence intervals."""
    e, c, s = (bench(p, 40) for p in ("expert", "competent", "sloppy"))
    assert e["score_ci95"][0] > c["score_ci95"][1]
    assert c["score_ci95"][0] > s["score_ci95"][1]


def test_key_levels_scale_enemies_and_keep_plus_12_unchanged():
    from mythicsim import content as C
    base = simulate("expert", 7)
    assert digest(simulate("expert", 7, 12)) == digest(base)
    hard = simulate("expert", 7, 16)
    boss = lambda rep: next(u for u in rep["units"] if u["kind"] == "boss")  # noqa: E731
    assert boss(hard)["max_hp"] == round(boss(base)["max_hp"] * C.level_multiplier(16))
    assert hard["meta"]["sigil_level"] == 16
    assert C.level_multiplier(13) == 1.08 and C.level_multiplier(11) == 1 / 1.08
    with pytest.raises(ValueError):
        C.level_multiplier(99)


def test_harder_keys_are_harder():
    """Over a few seeds, the expert bot scores lower as the key level rises."""
    from mythicsim.metrics import score as sc
    mean = lambda lvl: sum(sc(simulate("expert", s, lvl))["score"] for s in range(6)) / 6  # noqa: E731
    assert mean(8) >= mean(14) > mean(18)


def test_dungeon_unit_ids_are_unique_across_the_run():
    """Trash and the boss's summoned adds must never share an id (a reused id
    would overwrite a dead trash unit and corrupt progress)."""
    rep = simulate("sloppy", 42, 12, "dungeon")
    ids = [u["id"] for u in rep["units"]] + [e["unit"]["id"] for e in rep["events"] if e["type"] == "spawn"]
    assert len(ids) == len(set(ids))


@pytest.fixture(scope="module", params=["expert", "competent", "sloppy"])
def dungeon_replay(request):
    return simulate(request.param, SHOWCASE_SEED, 12, "dungeon")


def test_dungeon_matches_schema_and_is_consistent(dungeon_replay):
    jsonschema.validate(dungeon_replay, SCHEMA)
    ts = [e["t"] for e in dungeon_replay["events"]]
    assert ts == sorted(ts)
    hp = {u["id"]: u["max_hp"] for u in dungeon_replay["units"]}
    for e in dungeon_replay["events"]:
        if e["type"] == "spawn":
            hp[e["unit"]["id"]] = e["unit"]["max_hp"]
        elif e["type"] in ("damage", "heal"):
            hp[e["target"]] += -e["amount"] if e["type"] == "damage" else e["amount"]
            assert hp[e["target"]] == e["hp"], e
        elif e["type"] == "revive":
            hp[e["unit"]] = e["hp"]


def test_dungeon_is_deterministic_and_pulls_in_order():
    a, b = simulate("expert", 9, 12, "dungeon"), simulate("expert", 9, 12, "dungeon")
    assert digest(a) == digest(b)
    pulls = [e["pack"] for e in a["events"] if e["type"] == "pull"]
    assert pulls == ["pack1", "pack2", "boss"]
    assert a["meta"]["mode"] == "dungeon" and a["meta"]["time_limit_ms"] == 270_000


def test_dungeon_bosses_sleep_until_pulled():
    rep = simulate("expert", 9, 12, "dungeon")
    pull = next(e["t"] for e in rep["events"] if e["type"] == "pull" and e["pack"] == "boss")
    first = next(e["t"] for e in rep["events"] if e.get("unit") == "mortisar" and e["type"] in ("cast_start", "cast_success"))
    assert first >= pull


def test_dungeon_revives_cost_time():
    """A dead party member gets back up out of combat, and the timer is charged."""
    from mythicsim.dungeon import DungeonRun
    from mythicsim.policies import make_dungeon_policies
    run = DungeonRun(3, make_dungeon_policies("expert", 3), "x")
    nyx = run.units["nyx"]
    run.kill(nyx, run.units["bramble"], "test")
    for _ in range(40):
        run.step()
        run.t += 100
    assert nyx.alive and run.penalty_ms == 10_000 and run.revives == 1


def test_dungeon_reference_bots_rank_in_order():
    e, c, s = (bench(p, 24, 12, "dungeon") for p in ("expert", "competent", "sloppy"))
    assert e["score_mean"] > c["score_mean"] > s["score_mean"]
    assert c["score_ci95"][0] > s["score_ci95"][1]
