"""Tests that protect the benchmark's integrity.

If any of these fail, results are not trustworthy — so they run on every change.
"""

import hashlib
import json
from pathlib import Path

import jsonschema
import pytest

from mythicsim import content as C

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
    # The showcase as shipped: the full dungeon run on +10, which is tuned so
    # that even the expert bots run out of time (without a single death).
    scores = {p: score(simulate(p, SHOWCASE_SEED, "plus10", "dungeon")) for p in ("expert", "competent", "sloppy")}
    assert scores["expert"]["outcome"] == "timeout" and not scores["expert"]["deaths"]
    assert scores["competent"]["outcome"] == "wipe"
    assert scores["sloppy"]["outcome"] == "wipe"
    assert scores["expert"]["score"] > scores["competent"]["score"] > scores["sloppy"]["score"]


def test_boss_script_is_the_same_for_every_policy():
    """A seed fixes the boss's timers: the first cast of each timed ability
    lands at the same moment whoever is playing (policies can't shift it)."""
    def first_casts(policy):
        seen = {}
        for e in simulate(policy, 21)["events"]:
            if e["type"] in ("cast_start", "cast_success") and e["unit"] == "oruth" \
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


def test_tiers_scale_enemies_and_add_affixes():
    from mythicsim import content as C
    normal, plus10 = simulate("expert", 7, "normal"), simulate("expert", 7, "+10")
    boss = lambda rep: next(u for u in rep["units"] if u["kind"] == "boss")  # noqa: E731
    assert boss(normal)["max_hp"] == round(C.BOSS.max_hp * C.TIERS["normal"].enemy_hp)
    assert boss(plus10)["max_hp"] == round(round(C.BOSS.max_hp * C.TIERS["plus10"].enemy_hp) * C.TYRANT_HP)
    assert normal["meta"]["tier"] == "normal" and normal["meta"]["affixes"] == [] and normal["affixes"] == {}
    assert plus10["meta"]["tier_name"] == "+10" and set(plus10["affixes"]) == set(C.TIERS["plus10"].affixes)
    with pytest.raises(ValueError):
        C.tier("+30")


def test_plus10_affixes_fire_on_undead_deaths():
    """Every undead death (not Oruth) leaves a grave and stacks Marrow Shards."""
    rep = simulate("expert", 3, "plus10", "dungeon")
    ev = rep["events"]
    undead_deaths = [e for e in ev if e["type"] == "death" and e["unit"] not in
                     {u["id"] for u in rep["units"] if u["kind"] in ("player", "boss")}]
    graves = [e for e in ev if e["type"] == "ground_spawn" and e["kind"] == "grave"]
    assert undead_deaths and len(graves) == len(undead_deaths)
    stacks = [e["stacks"] for e in ev if e["type"] == "aura_apply" and e["aura"] == "marrow_shards"]
    assert max(stacks) >= 2  # a pack dying close together stacks it
    assert any(e["type"] == "heal" and e["ability"] == "restless_grave" for e in ev) or \
        any(e["type"] == "damage" and e["ability"] == "restless_grave" for e in ev)
    raises = [e for e in ev if e["type"] == "cast_start" and e["ability"] == "raise_dead"]
    assert len(raises) <= 3
    normal = simulate("expert", 3, "normal", "dungeon")["events"]
    assert not any(e["type"] == "ground_spawn" and e["kind"] == "grave" for e in normal)


def test_harder_tier_is_harder():
    """Over a few seeds, the expert bot scores lower on +10 than on Normal."""
    from mythicsim.metrics import score as sc
    mean = lambda t: sum(sc(simulate("expert", s, t, "dungeon"))["score"] for s in range(6)) / 6  # noqa: E731
    assert mean("normal") > mean("plus10")


def test_dungeon_unit_ids_are_unique_across_the_run():
    """Trash and the boss's summoned adds must never share an id (a reused id
    would overwrite a dead trash unit and corrupt progress)."""
    rep = simulate("sloppy", 42, "plus10", "dungeon")
    ids = [u["id"] for u in rep["units"]] + [e["unit"]["id"] for e in rep["events"] if e["type"] == "spawn"]
    assert len(ids) == len(set(ids))


@pytest.fixture(scope="module", params=["expert", "competent", "sloppy"])
def dungeon_replay(request):
    return simulate(request.param, SHOWCASE_SEED, "plus10", "dungeon")


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
    a, b = simulate("expert", 9, "plus10", "dungeon"), simulate("expert", 9, "plus10", "dungeon")
    assert digest(a) == digest(b)
    pulls = [e["pack"] for e in a["events"] if e["type"] == "pull"]
    assert pulls == ["pack1", "pack2", "boss"]
    assert a["meta"]["mode"] == "dungeon" and a["meta"]["time_limit_ms"] == C.TIERS["plus10"].limit_ms


def test_dungeon_bosses_sleep_until_pulled():
    rep = simulate("expert", 9, "plus10", "dungeon")
    pull = next(e["t"] for e in rep["events"] if e["type"] == "pull" and e["pack"] == "boss")
    first = next(e["t"] for e in rep["events"] if e.get("unit") == "oruth" and e["type"] in ("cast_start", "cast_success"))
    assert first >= pull


def test_dungeon_revives_cost_time():
    """A dead party member gets back up out of combat, and the timer is charged."""
    from mythicsim.dungeon import DungeonRun
    from mythicsim.policies import make_dungeon_policies
    run = DungeonRun(3, make_dungeon_policies("expert", 3), "x")
    kit = run.units["kit"]
    run.kill(kit, run.units["rook"], "test")
    for _ in range(40):
        run.step()
        run.t += 100
    assert kit.alive and run.penalty_ms == 10_000 and run.revives == 1


def test_dungeon_reference_bots_rank_in_order():
    e, c, s = (bench(p, 24, "plus10", "dungeon") for p in ("expert", "competent", "sloppy"))
    assert e["score_mean"] > c["score_mean"] > s["score_mean"]
    assert c["score_ci95"][0] > s["score_ci95"][1]


def test_grave_mark_detonates_on_nearby_allies():
    """+10's Hollow Tyrant brands a player; when it expires, allies within 6 m take the splash."""
    from mythicsim import content as C
    found = False
    for seed in range(6):
        ev = simulate("expert", seed, "plus10", "boss")["events"]
        marks = [e for e in ev if e["type"] == "aura_apply" and e["aura"] == "grave_mark"]
        assert marks, "the boss should brand someone during the fight"
        for m in marks:
            boom = [e for e in ev if e["type"] == "damage" and e["ability"] == "grave_mark"
                    and e["t"] == m["t"] + C.AURAS["grave_mark"].duration_ms]
            if boom:
                found = True
                assert boom[0]["target"] == m["unit"]  # the marked player is hit first
                assert all(e["source"] == "oruth" for e in boom)
    assert found
    assert not any(e["aura"] == "grave_mark" for e in simulate("expert", 3, "normal", "boss")["events"]
                   if e["type"] == "aura_apply")


def test_tiers_have_their_own_timers():
    from mythicsim import content as C
    for t in ("normal", "plus10"):
        rep = simulate("expert", 2, t, "dungeon")
        assert rep["meta"]["time_limit_ms"] == C.TIERS[t].limit_ms


def test_game_guide_lists_every_ability_and_matches_the_committed_file():
    from mythicsim.guide import game_guide
    g = game_guide()
    for m, member in zip(C.PARTY, g["party"]):
        assert member["id"] == m.id
        assert [a["id"] for a in member["abilities"]] == list(C.CLASSES[m.cls].abilities)
    assert {t["id"] for t in g["tiers"]} == set(C.TIERS)
    committed = json.loads((Path(__file__).parents[2] / "web" / "public" / "replays" / "game.json").read_text())
    assert committed == json.loads(json.dumps(g)), "run: python -m mythicsim generate --out ../web/public/replays"


class _Idle:
    def act(self, obs):
        return []


def _dungeon(tier="normal"):
    from mythicsim.dungeon import DungeonRun
    return DungeonRun(1, {m.id: _Idle() for m in C.PARTY}, "test", tier)


def test_a_run_ends_at_the_timer():
    rep = _dungeon().run()
    assert rep["meta"]["outcome"] == "timeout"
    assert rep["meta"]["duration_ms"] == C.tier("normal").limit_ms  # not a second longer
    assert all(e["t"] <= C.tier("normal").limit_ms for e in rep["events"])


def test_revive_penalties_count_against_the_timer():
    enc = _dungeon()
    enc.penalty_ms = 30_000
    rep = enc.run()
    assert rep["meta"]["duration_ms"] == C.tier("normal").limit_ms - 30_000


def _kill_at(enc, ms, packs=True):
    """Fast-forward: everything dies at ``ms`` (packs optional)."""
    orig = enc.step

    def step():
        orig()
        if enc.t == ms:
            for u in list(enc.units.values()):
                if u.kind != "player" and u.alive and (packs or not u.pack):
                    enc.kill(u, enc.units["rook"], "test")
    enc.step = step


def test_a_kill_counts_just_before_and_at_the_deadline_but_not_after():
    limit = C.tier("normal").limit_ms
    for at, want in ((limit - 100, "victory"), (limit, "victory"), (limit + 100, "timeout")):
        enc = _dungeon()
        _kill_at(enc, at)
        assert enc.run()["meta"]["outcome"] == want, at


def test_a_clear_needs_every_pack_dead_too():
    enc = _dungeon()
    _kill_at(enc, 10_000, packs=False)
    rep = enc.run()
    assert rep["meta"]["outcome"] == "timeout"
    assert score(rep)["score"] < 70
