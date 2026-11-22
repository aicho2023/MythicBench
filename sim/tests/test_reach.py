"""Melee reach (content 1.7.0): short enough to look like a hit, with the
reflexes that make it playable at a few calls per second of game time."""

from __future__ import annotations

from mythicsim import content as C
from mythicsim.engine import Encounter, dist
from mythicsim.llm.policy import LLMPolicy, Standing
from mythicsim.llm.prompt import Order


def _policy() -> LLMPolicy:
    p = LLMPolicy.__new__(LLMPolicy)
    p.uid, p.engaged = "brask", False
    return p


def _obs(me, tgt, ground=()):
    return {"self": {"id": "brask", "pos": list(me), "alive": True, "moving": False},
            "enemies": [{"id": "w1", "role": "add", "pos": list(tgt), "alive": True}],
            "party": [], "ground": list(ground), "arena_radius": C.ARENA_RADIUS}


def _standing(*prio):
    return Standing(Order(priority=list(prio)), 0)


def _units(obs):
    return {u["id"]: u for u in obs["party"] + obs["enemies"]}


def gap(a, b, rb=C.ADD.radius):
    return dist(a, b) - C.PLAYER_RADIUS - rb


def test_a_melee_character_follows_a_target_that_drifts():
    p, st = _policy(), _standing(("ravage", "w1"))
    obs = _obs((0.0, 0.0), (1.8, 0.0))  # in reach: now engaged
    assert gap((0.0, 0.0), (1.8, 0.0)) <= C.MELEE_RANGE
    assert p.keep_in_reach(obs, st, _units(obs)) is None and p.engaged
    obs = _obs((0.0, 0.0), (4.0, 0.0))  # it stepped away
    step = p.keep_in_reach(obs, st, _units(obs))
    assert step is not None and gap(step, (4.0, 0.0)) <= C.MELEE_RANGE


def test_it_never_follows_into_a_pool_or_too_far():
    p, st = _policy(), _standing(("ravage", "w1"))
    p.engaged = True
    pool = {"id": "g", "kind": "desecrate", "pos": [3.0, 0.0], "radius": 2.2, "armed": True}
    obs = _obs((0.0, 0.0), (4.0, 0.0), [pool])
    assert p.keep_in_reach(obs, st, _units(obs)) is None
    far = _obs((0.0, 0.0), (C.FOLLOW_M + 3.0, 0.0))
    assert p.keep_in_reach(far, st, _units(far)) is None


def test_a_deliberate_step_away_is_never_undone():
    p, st = _policy(), _standing(("ravage", "w1"))
    obs = _obs((0.0, 0.0), (4.0, 0.0))  # out of reach, and not engaged since its last ordered move
    assert p.keep_in_reach(obs, st, _units(obs)) is None


def test_it_follows_the_target_it_hits_not_a_standing_kick():
    p, st = _policy(), _standing(("throat_punch", "w2"), ("ravage", "w1"))
    p.engaged = True
    obs = _obs((0.0, 0.0), (4.0, 0.0))
    obs["enemies"].append({"id": "w2", "role": "add", "pos": [-2.5, 0.0], "alive": True})
    step = p.keep_in_reach(obs, st, _units(obs))
    assert step is not None and gap(step, (4.0, 0.0)) <= C.MELEE_RANGE


def test_safe_keeps_the_reach_of_the_attack_not_of_a_kick():
    p, st = _policy(), _standing(("throat_punch", "w1"), ("ravage", "w1"))
    st.order.move_to = "safe"
    # In kick reach but not in melee reach, and nothing to dodge: "safe" still steps in.
    obs = _obs((0.0, 0.0), (3.4, 0.0))
    assert C.MELEE_RANGE < gap((0.0, 0.0), (3.4, 0.0)) <= C.KICK_RANGE
    dest = p.safe_destination(obs, st)
    assert dest is not None and gap(dest, (3.4, 0.0)) <= C.MELEE_RANGE


class _Stand:
    def act(self, obs):
        return []


def test_a_taken_melee_spot_shifts_to_one_still_in_reach():
    enc = Encounter(3, {m.id: _Stand() for m in C.PARTY}, "test", "normal")
    boss, rook, brask = enc.boss, enc.units["rook"], enc.units["brask"]
    rook.pos = (boss.pos[0], boss.pos[1] + boss.radius + C.PLAYER_RADIUS + 0.3)
    enc.start_move(brask, rook.pos)  # where the tank already stands
    spot = brask.move.to if brask.move else brask.pos
    assert dist(spot, rook.pos) >= 2 * C.PLAYER_RADIUS
    assert dist(spot, boss.pos) - boss.radius - C.PLAYER_RADIUS <= C.MELEE_RANGE


def test_oruth_reaches_his_target_even_when_its_side_is_crowded():
    enc = Encounter(3, {m.id: _Stand() for m in C.PARTY}, "test", "normal")
    boss, rook = enc.boss, enc.units["rook"]
    rook.pos = (0.0, 9.0)
    # The party stands around the tank, on the side Oruth comes from.
    for uid, pos in (("brask", (-1.0, 7.6)), ("kit", (1.0, 7.6)), ("wren", (0.0, 7.2))):
        enc.units[uid].pos = pos
    enc.chase(boss, rook)
    spot = boss.move.to if boss.move else boss.pos
    assert enc.edge_dist(boss, rook) > C.MELEE_RANGE  # he had to walk
    assert dist(spot, rook.pos) - boss.radius - rook.radius <= C.MELEE_RANGE
