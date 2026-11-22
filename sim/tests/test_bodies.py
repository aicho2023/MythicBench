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
    from mythicsim.policies import make_policies
    enc = Encounter(8, make_policies("expert", 8), "test", "plus10")
    enc.run(max_ms=150_000)
    standing = [u for u in enc.units.values() if u.alive and u.move is None]
    for a, b in combinations(standing, 2):
        assert dist(a.pos, b.pos) >= a.radius + b.radius - 0.01, (a.id, b.id, a.pos, b.pos)


def test_mortisar_walks_after_a_target_out_of_reach():
    class Stand:
        def act(self, obs):
            return []
    enc = Encounter(3, {m.id: Stand() for m in C.PARTY}, "test", "normal")
    tank = enc.units["rook"]
    tank.pos = (0.0, 10.0)  # far out of his reach
    settle(enc, 6000)
    assert enc.edge_dist(enc.boss, tank) <= C.MELEE_RANGE
    assert dist(enc.boss.pos, C.BOSS_POS) > 3.0
