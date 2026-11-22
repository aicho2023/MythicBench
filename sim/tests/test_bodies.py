"""Bodies take up space: players never end a move stacked on each other."""
from itertools import combinations

from mythicsim import content as C
from mythicsim.dungeon import DungeonRun
from mythicsim.engine import Action, Encounter, dist


class GoTo:
    """Walk to one fixed spot, re-asking every tick (the worst case)."""

    def __init__(self, spot):
        self.spot = spot

    def act(self, obs):
        return [] if obs["self"]["moving"] else [Action("move", to=self.spot)]


def settle(enc, ms=8000):
    enc.roster = [enc.unit_json(u) for u in enc.units.values()]
    for _ in range(ms // 100):
        enc.step()
        enc.t += 100


def assert_apart(enc):
    players = enc.players()
    assert all(p.move is None for p in players), "everyone should have arrived"
    for a, b in combinations(players, 2):
        assert dist(a.pos, b.pos) >= a.radius + b.radius, (a.id, b.id, a.pos, b.pos)


def test_party_sent_to_one_spot_spreads_out():
    spot = (0.0, 76.0)  # a corridor waypoint, like the models' "next"
    enc = DungeonRun(3, {m.id: GoTo(spot) for m in C.PARTY}, "test", "normal")
    settle(enc)
    assert_apart(enc)
    # Nobody ends far from where they were sent.
    assert max(dist(p.pos, spot) for p in enc.players()) <= 2.0


def test_moves_into_the_boss_stop_outside_it():
    boss = (0.0, 0.0)
    enc = Encounter(3, {m.id: GoTo(boss) for m in C.PARTY}, "test", "normal")
    enc.boss_tick = lambda: None  # just the walking
    settle(enc)
    assert_apart(enc)
    for p in enc.players():
        assert dist(p.pos, enc.boss.pos) >= p.radius + enc.boss.radius


def test_one_order_one_move_event():
    """Re-asking for a spot that was shifted is not a new order (no move spam)."""
    spot = (0.0, 76.0)
    enc = DungeonRun(3, {m.id: GoTo(spot) for m in C.PARTY}, "test", "normal")
    settle(enc)
    moves = [e for e in enc.events if e["type"] == "move" and e["unit"] in {m.id for m in C.PARTY}]
    assert len(moves) == len(C.PARTY)


def test_enemies_do_not_stand_inside_each_other_or_the_party():
    """A boss fight's adds crowd the tank but keep their bodies apart."""
    from mythicsim.llm.policy import make_llm_policies
    from mythicsim.llm.scripted import ScriptedCommander
    pols, _ = make_llm_policies(ScriptedCommander(), tier="plus10", mode="boss", knowledge="blind", parallel=False)
    enc = Encounter(8, pols, "test", "plus10")
    enc.run(max_ms=150_000)
    standing = [u for u in enc.units.values() if u.alive and u.move is None]
    for a, b in combinations(standing, 2):
        assert dist(a.pos, b.pos) >= a.radius + b.radius - 0.01, (a.id, b.id, a.pos, b.pos)


def test_oruth_walks_after_a_target_out_of_reach():
    class Stand:
        def act(self, obs):
            return []
    enc = Encounter(3, {m.id: Stand() for m in C.PARTY}, "test", "normal")
    tank = enc.units["rook"]
    tank.pos = (0.0, 10.0)  # far out of his reach
    settle(enc, 6000)
    assert enc.edge_dist(enc.boss, tank) <= C.MELEE_RANGE
    assert dist(enc.boss.pos, C.BOSS_POS) > 3.0


def _walking_oruth(tier="plus10"):
    class Stand:
        def act(self, obs):
            return []
    enc = Encounter(3, {m.id: Stand() for m in C.PARTY}, "test", tier)
    enc.roster = [enc.unit_json(u) for u in enc.units.values()]
    enc.boss_next = {}  # only what the test arms
    enc.t = C.BOSS.rise_ms
    return enc


def test_a_summon_is_never_lost_while_oruth_walks():
    enc = _walking_oruth()
    b = enc.boss
    enc.start_move(b, (0.0, 8.0))  # walking when he crosses the threshold
    b.hp = int(b.max_hp * 0.79)
    for _ in range(5):
        enc.step()
        enc.t += 100
    casts = [e for e in enc.events if e["type"] == "cast_start" and e["ability"] == "raise_dead"]
    assert len(casts) == 1 and b.move is None


def test_soul_rend_waits_for_its_target_instead_of_being_skipped():
    enc = _walking_oruth()
    tank = enc.units["rook"]
    tank.pos = (0.0, 12.0)  # out of his reach when it comes due
    enc.boss_next = {"soul_rend": enc.t}
    enc.step()
    assert "soul_rend" in enc.boss_next and enc.boss_next["soul_rend"] <= enc.t  # still due
    assert not any(e["type"] == "cast_start" for e in enc.events)
    for _ in range(80):  # he walks over, then casts it
        enc.t += 100
        enc.step()
    assert any(e["type"] == "cast_start" and e["ability"] == "soul_rend" for e in enc.events)


def test_a_move_stops_at_the_wall_instead_of_walking_through_it():
    room = C.ROOMS[0]
    inside = (room.center[0], room.center[1])
    beyond = (room.center[0] + room.radius + 20.0, room.center[1])  # straight through the room's wall
    stop = DungeonRun.straight_line_reach(inside, beyond)
    assert C.walkable(stop) and dist(stop, inside) < room.radius
