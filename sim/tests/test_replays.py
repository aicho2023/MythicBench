"""Tests that protect the benchmark's integrity.

If any of these fail, results are not trustworthy — so they run on every change.
"""

import hashlib
import json
from pathlib import Path

import jsonschema
import pytest

from mythicsim import content as C

from mythicsim.__main__ import SHOWCASE_SEED, simulate
from mythicsim.metrics import run_score, score

SCHEMA = json.loads((Path(__file__).parents[2] / "schema" / "replay.schema.json").read_text())


@pytest.fixture(scope="module", params=["plus10", "normal"])
def replay(request):
    return simulate(SHOWCASE_SEED, request.param, "boss")


def digest(rep: dict) -> str:
    return hashlib.sha256(json.dumps(rep, sort_keys=True).encode()).hexdigest()


def test_deterministic_same_seed():
    """Same seed + same policy must give a byte-identical replay."""
    assert digest(simulate(5, "plus10", "boss")) == digest(simulate(5, "plus10", "boss"))


def test_different_seeds_differ():
    assert digest(simulate(5, "plus10", "boss")) != digest(simulate(6, "plus10", "boss"))


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


def test_common_sense_does_not_time_plus10():
    """The scripted commander plays by obvious rules (step out of every pool),
    so it never soaks a Bone Pyre: +10 is beyond it, Normal less so."""
    plus10, normal = (score(simulate(SHOWCASE_SEED, t, "dungeon")) for t in ("plus10", "normal"))
    assert not (plus10["outcome"] == "victory" and plus10["in_time"])
    assert normal["score"] > plus10["score"]


def test_boss_script_is_the_same_for_every_policy():
    """A seed fixes the boss's timers: the first cast of each timed ability
    lands at the same moment whoever is playing (policies can't shift it)."""
    from mythicsim.engine import Encounter

    def first_casts(rep):
        seen = {}
        for e in rep["events"]:
            if e["type"] in ("cast_start", "cast_success") and e["unit"] == "oruth" \
                    and e["ability"] in ("requiem_of_bones", "soul_rend", "desecrate", "bone_pyre"):
                seen.setdefault(e["ability"], e["t"])
        return seen
    idle = first_casts(Encounter(21, {m.id: _Idle() for m in C.PARTY}, "idle", "plus10").run())
    played = first_casts(simulate(21, "plus10", "boss"))
    both = idle.keys() & played.keys()  # a party that stands still dies early
    assert len(both) >= 3 and all(idle[k] == played[k] for k in both)


def test_seeds_vary_the_boss_script():
    def first_requiem(seed):
        return next(e["t"] for e in simulate(seed, "plus10", "boss")["events"]
                    if e["type"] == "cast_start" and e["ability"] == "requiem_of_bones")
    assert len({first_requiem(s) for s in range(8)}) > 1


def test_no_platform_dependent_math():
    """Replays must be identical on every machine (CI regenerates them on Linux).
    libm functions like hypot/cos/sin can differ in the last bit between CPU
    platforms, and one flipped comparison changes the whole fight."""
    import re
    src = Path(__file__).parents[1] / "mythicsim"
    banned = re.compile(r"math\.(hypot|cos|sin|tan|atan2?|exp|log|pow)\b|\*\* *0?\.5")
    for f in ("engine.py", "dodge.py", "content.py"):
        hits = banned.findall((src / f).read_text())
        assert not hits, f"{f} uses platform-dependent math: {hits}"


def test_run_score():
    assert run_score("wipe", 120.0, 100.0, 195.0) == 0.0
    assert run_score("wipe", 120.0, 38.0, 195.0) == 43.4  # 70 x 62% removed
    assert run_score("wipe", 199.0, 0.5, 195.0) < run_score("victory", 195.0, 0.0, 195.0) == 70.0
    assert run_score("victory", 195.0 * 0.75, 0.0, 195.0) == 100.0  # a quarter of the timer left = par
    assert run_score("victory", 60.0, 0.0, 195.0) == 100.0  # capped
    assert run_score("victory", 175.5, 0.0, 195.0) == 82.0  # 19.5 s left = 40% of par


def test_playing_beats_standing_still():
    """The score tells play from no play: the commander beats a party that does nothing."""
    from mythicsim.engine import Encounter
    for seed in range(3):
        idle = score(Encounter(seed, {m.id: _Idle() for m in C.PARTY}, "idle", "plus10").run())
        assert score(simulate(seed, "plus10", "boss"))["score"] > idle["score"]


def test_tiers_scale_enemies_and_add_affixes():
    from mythicsim import content as C
    normal, plus10 = simulate(7, "normal", "boss"), simulate(7, "+10", "boss")
    boss = lambda rep: next(u for u in rep["units"] if u["kind"] == "boss")  # noqa: E731
    assert boss(normal)["max_hp"] == round(C.BOSS.max_hp * C.TIERS["normal"].enemy_hp)
    assert boss(plus10)["max_hp"] == round(round(C.BOSS.max_hp * C.TIERS["plus10"].enemy_hp) * C.TYRANT_HP)
    assert normal["meta"]["tier"] == "normal" and normal["meta"]["affixes"] == [] and normal["affixes"] == {}
    assert plus10["meta"]["tier_name"] == "+10" and set(plus10["affixes"]) == set(C.TIERS["plus10"].affixes)
    with pytest.raises(ValueError):
        C.tier("+30")


def test_plus10_affixes_fire_on_undead_deaths():
    """Every undead death (not Oruth) leaves a grave and stacks Marrow Shards."""
    rep = simulate(3, "plus10", "dungeon")
    ev = rep["events"]
    undead_deaths = [e for e in ev if e["type"] == "death" and e["unit"] not in
                     {u["id"] for u in rep["units"] if u["kind"] in ("player", "boss")}]
    graves = [e for e in ev if e["type"] == "ground_spawn" and e["kind"] == "grave"]
    assert undead_deaths and len(graves) == len(undead_deaths)
    stacks = [e["stacks"] for e in ev if e["type"] == "aura_apply" and e["aura"] == "marrow_shards"]
    assert len(stacks) >= len(undead_deaths)  # every undead death puts it on the party
    assert any(e["type"] == "heal" and e["ability"] == "restless_grave" for e in ev) or \
        any(e["type"] == "damage" and e["ability"] == "restless_grave" for e in ev)
    raises = [e for e in ev if e["type"] == "cast_start" and e["ability"] == "raise_dead"]
    assert len(raises) <= 3
    normal = simulate(3, "normal", "dungeon")["events"]
    assert not any(e["type"] == "ground_spawn" and e["kind"] == "grave" for e in normal)


def test_harder_tier_is_harder():
    """Over a few seeds, the commander scores lower on +10 than on Normal."""
    from mythicsim.metrics import score as sc
    mean = lambda t: sum(sc(simulate(s, t, "dungeon"))["score"] for s in range(6)) / 6  # noqa: E731
    assert mean("normal") > mean("plus10")


def test_dungeon_unit_ids_are_unique_across_the_run():
    """Trash and the boss's summoned adds must never share an id (a reused id
    would overwrite a dead trash unit and corrupt progress)."""
    rep = simulate(42, "plus10", "dungeon")
    ids = [u["id"] for u in rep["units"]] + [e["unit"]["id"] for e in rep["events"] if e["type"] == "spawn"]
    assert len(ids) == len(set(ids))


@pytest.fixture(scope="module", params=["plus10", "normal"])
def dungeon_replay(request):
    return simulate(SHOWCASE_SEED, request.param, "dungeon")


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
    a, b = simulate(9, "plus10", "dungeon"), simulate(9, "plus10", "dungeon")
    assert digest(a) == digest(b)
    pulls = [e["pack"] for e in a["events"] if e["type"] == "pull"]
    assert pulls == ["pack1", "pack2", "boss"]
    assert a["meta"]["mode"] == "dungeon" and a["meta"]["time_limit_ms"] == C.TIERS["plus10"].limit_ms


def test_dungeon_bosses_sleep_until_pulled():
    rep = simulate(9, "plus10", "dungeon")
    pull = next(e["t"] for e in rep["events"] if e["type"] == "pull" and e["pack"] == "boss")
    first = next(e["t"] for e in rep["events"] if e.get("unit") == "oruth" and e["type"] in ("cast_start", "cast_success"))
    assert first >= pull


def test_dungeon_revives_cost_time():
    """A dead party member gets back up out of combat, and the timer is charged."""
    from mythicsim.dungeon import DungeonRun
    run = DungeonRun(3, {m.id: _Idle() for m in C.PARTY}, "x")
    kit = run.units["kit"]
    run.kill(kit, run.units["rook"], "test")
    for _ in range(40):
        run.step()
        run.t += 100
    assert kit.alive and run.penalty_ms == 10_000 and run.revives == 1


def test_grave_mark_detonates_on_nearby_allies():
    """+10's Hollow Tyrant brands a player; when it expires, allies within 6 m take the splash."""
    from mythicsim import content as C
    found = False
    for seed in range(6):
        ev = simulate(seed, "plus10", "boss")["events"]
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
    assert not any(e["aura"] == "grave_mark" for e in simulate(3, "normal", "boss")["events"]
                   if e["type"] == "aura_apply")


def test_tiers_have_their_own_timers():
    from mythicsim import content as C
    for t in ("normal", "plus10"):
        rep = simulate(2, t, "dungeon")
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


class _Soak:
    """Two players stand in every Bone Pyre; the rest stay put."""

    def __init__(self, uid, soaks):
        self.uid, self.soaks = uid, soaks

    def act(self, obs):
        from mythicsim.engine import Action
        pyre = next((g for g in obs["ground"] if g["kind"] == "pyre"), None)
        if not pyre or obs["self"]["moving"]:
            return []
        if self.soaks:
            return [Action("move", to=tuple(pyre["pos"]))]
        # Everyone else keeps well clear of it (whoever happens to stand there steps away).
        me, c = obs["self"]["pos"], pyre["pos"]
        d = ((me[0] - c[0]) ** 2 + (me[1] - c[1]) ** 2) ** 0.5
        if d < pyre["radius"] + 1.5:
            ux, uz = ((me[0] - c[0]) / d, (me[1] - c[1]) / d) if d > 1e-6 else (1.0, 0.0)
            return [Action("move", to=(c[0] + ux * (pyre["radius"] + 3), c[1] + uz * (pyre["radius"] + 3)))]
        return []


def _first_pyre(soakers):
    from mythicsim.engine import Encounter
    enc = Encounter(4, {m.id: _Soak(m.id, m.id in soakers) for m in C.PARTY}, "test", "normal")
    enc.boss_next = {"bone_pyre": 2000}  # only the pyre, so nothing else gets in the way
    rep = enc.run(max_ms=12_000)
    boom = next(e for e in rep["events"] if e["type"] == "pyre_detonate")
    hits = [e for e in rep["events"] if e["type"] == "damage" and e["ability"] == "bone_pyre" and e["t"] == boom["t"]]
    return boom, hits


def test_bone_pyre_split_between_soakers():
    boom, hits = _first_pyre({"brask", "kit"})
    assert boom["soaked"] and set(boom["inside"]) == {"brask", "kit"}
    assert {e["target"] for e in hits} == {"brask", "kit"}
    per = C.PYRE_SOAK / 2 * C.TIERS["normal"].enemy_dmg
    assert all(abs(e["amount"] + e["absorbed"] - per) <= per * 0.08 + 1 for e in hits)


def test_bone_pyre_hits_everyone_when_not_soaked():
    for soakers in (set(), {"brask"}):
        boom, hits = _first_pyre(soakers)
        assert not boom["soaked"] and len(boom["inside"]) == len(soakers)
        assert len(hits) == len(C.PARTY)  # the whole party, soaker or not
        assert min(e["amount"] + e["absorbed"] for e in hits) >= C.PYRE_BLAST * C.TIERS["normal"].enemy_dmg * 0.92 - 1


def test_bone_pyre_is_not_a_pool_to_dodge():
    """The "safe" planner and the in-pool alarm treat a pyre as floor, not danger."""
    from mythicsim.dodge import find_safe_spot, unsafe
    pyre = [{"id": "pyre_1", "kind": "pyre", "pos": [0.0, 5.0], "radius": 2.5, "armed": False, "detonates_in_ms": 3000}]
    assert not unsafe((0.0, 5.0), pyre)
    assert find_safe_spot(pyre, C.ARENA_RADIUS, (0.0, 5.0), (0.0, 5.0)) is not None
