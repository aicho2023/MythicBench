"""Melee reach (content 1.7.0): short enough to look like a hit, with the
reflexes that make it playable at a few calls per second of game time."""

from __future__ import annotations

from mythicsim import content as C
from mythicsim.engine import Action, Encounter, dist
from mythicsim.llm.policy import LLMPolicy, Standing
from mythicsim.llm.prompt import Order


def _policy() -> LLMPolicy:
    p = LLMPolicy.__new__(LLMPolicy)
    p.uid, p.contact = "brask", None
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
    assert p.keep_in_reach(obs, st, _units(obs)) is None and p.contact == "w1"
    obs = _obs((0.0, 0.0), (4.0, 0.0))  # it stepped away
    step = p.keep_in_reach(obs, st, _units(obs))
    assert step is not None and step[1] == "w1" and gap(step[0], (4.0, 0.0)) <= C.MELEE_RANGE


def test_it_never_follows_into_a_pool_or_too_far():
    p, st = _policy(), _standing(("ravage", "w1"))
    p.contact = "w1"
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
    p.contact = "w1"
    obs = _obs((0.0, 0.0), (4.0, 0.0))
    obs["enemies"].append({"id": "w2", "role": "add", "pos": [-2.5, 0.0], "alive": True})
    step = p.keep_in_reach(obs, st, _units(obs))
    assert step is not None and step[1] == "w1" and gap(step[0], (4.0, 0.0)) <= C.MELEE_RANGE


def test_safe_keeps_the_reach_of_the_attack_not_of_a_kick():
    p, st = _policy(), _standing(("throat_punch", "w1"), ("ravage", "w1"))
    st.order.move_to = "safe"
    # In kick reach but not in melee reach, and nothing to dodge: "safe" still steps in.
    obs = _obs((0.0, 0.0), (3.4, 0.0))
    assert C.MELEE_RANGE < gap((0.0, 0.0), (3.4, 0.0)) <= C.KICK_RANGE
    options = p.safe_destination(obs, st)
    assert options and options[0]["reach"] == ("w1", C.ABILITIES["ravage"].range)
    assert gap(options[0]["to"], (3.4, 0.0)) <= C.MELEE_RANGE


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


def test_contact_with_one_enemy_never_authorizes_following_another():
    p = _policy()
    obs = _obs((0.0, 0.0), (1.8, 0.0))
    obs["enemies"].append({"id": "w2", "role": "add", "pos": [-4.0, 0.0], "alive": True})
    assert p.keep_in_reach(obs, _standing(("ravage", "w1")), _units(obs)) is None and p.contact == "w1"
    # Only the priority changes, to an enemy it has never been in reach of: it stays put.
    assert p.keep_in_reach(obs, _standing(("ravage", "w2")), _units(obs)) is None
    assert p.contact is None


def test_follow_never_goes_round_an_obstacle():
    """Straight only: a step that would detour round the throne is the agent's call."""
    p, st = _policy(), _standing(("ravage", "w1"))
    p.contact = "w1"
    obs = _obs((-4.2, -11.0), (-1.0, -8.0))  # the throne's corner between them
    obs["arena_radius"] = C.ARENA_RADIUS
    assert p.keep_in_reach(obs, st, _units(obs)) is None


def _enc():
    return Encounter(3, {m.id: _Stand() for m in C.PARTY}, "test", "normal")


def _pool(enc, pos, r=2.2):
    enc.ground["d1"] = {"id": "d1", "kind": "desecrate", "pos": list(pos), "radius": r, "armed_at": 0}


def test_a_guarded_step_is_taken_only_straight_clear_and_in_reach():
    enc = _enc()
    brask, boss = enc.units["brask"], enc.boss
    boss.pos = (0.0, 0.0)
    brask.pos = (0.0, 5.0)
    near = (0.0, boss.radius + C.PLAYER_RADIUS + 0.5)
    assert enc.guarded_step_ok(brask, near, "oruth")
    _pool(enc, (1.5, 3.6))  # the straight step passes through it
    assert not enc.guarded_step_ok(brask, near, "oruth")
    enc.ground.clear()
    assert not enc.guarded_step_ok(brask, (0.0, 4.6), "oruth")  # clear, but not in reach
    brask.pos = (-4.6, -11.0)  # the throne between it and the spot: a detour
    assert not enc.guarded_step_ok(brask, (4.6, -11.0), "oruth")


def test_stop_halts_where_it_is_with_no_new_destination():
    enc = _enc()
    brask, kit = enc.units["brask"], enc.units["kit"]
    brask.pos, kit.pos = (0.0, 6.0), (0.0, 8.0)
    enc.start_move(brask, (0.0, 12.0))  # walks through where Kit stands
    for _ in range(4):
        enc.t += 100
        brask.pos = brask.move.pos_at(enc.t)

    class StopNow:
        def act(self, obs):
            return [Action("stop")] if obs["self"]["id"] == "brask" else []
    enc.policies = {m.id: StopNow() for m in C.PARTY}
    here = brask.pos
    n = len(enc.events)
    enc.run_policies()
    assert brask.move is None and brask.path == [] and dist(brask.pos, here) < 0.05
    assert not any(e["type"] == "move" and dist(e["to"], here) > 0.05 for e in enc.events[n:])


def test_safe_needs_the_real_route_to_stay_clear():
    from mythicsim.dodge import find_safe_spot
    pool = [{"id": "g", "kind": "desecrate", "pos": [0.0, 0.0], "radius": 2.0, "armed": True},
            {"id": "h", "kind": "desecrate", "pos": [6.0, 4.0], "radius": 1.5, "armed": True}]
    me = (0.0, 1.0)
    straight = find_safe_spot(pool, C.ARENA_RADIUS, me, me, avoid_paths=True)
    assert straight is not None

    def detour(a, b):  # pretend an obstacle sends every walk past the second pool
        return [(6.0, 4.0), b]
    other = find_safe_spot(pool, C.ARENA_RADIUS, me, me, avoid_paths=True, path=detour)
    assert other is None


def test_safe_never_stops_in_a_pool_when_a_clear_spot_is_reachable():
    """Codex's case: at the Ossuary's doorway, the best-looking spot is in the
    corridor, but the straight walk there hits the wall inside the grave. The
    sim judges every candidate as the move would really go."""
    from mythicsim.dungeon import DungeonRun
    for side in (-1, 1):
        run = DungeonRun(3, {m.id: _Stand() for m in C.PARTY}, "test", "normal")
        brask = run.units["brask"]
        brask.pos = (3.2 * side, 23.3)
        run.ground["g1"] = {"id": "g1", "kind": "grave", "pos": [2.0 * side, 23.5], "radius": 2.5, "armed_at": 0,
                            "spawned_at": 0, "expires_at": 10 ** 9, "next_tick": 10 ** 9, "tick_ms": 1000}
        p = _policy()
        options = p.safe_destination(run.observe(brask), _standing())
        assert options
        legs = run.pick_option(brask, options)
        assert legs is not None and not run.in_pool(brask, legs[-1])
