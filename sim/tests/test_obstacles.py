"""Solid obstacles (sim 0.10.0): the throne and the rooms' pillars. Nobody
walks through them; moves go around them on their own."""

from __future__ import annotations

from mythicsim import content as C
from mythicsim.dungeon import DungeonRun
from mythicsim.engine import Encounter, dist

THRONE = next(o for o in C.OBSTACLES if o.id == "throne")


class _Stand:
    def act(self, obs):
        return []


def _arena():
    return Encounter(3, {m.id: _Stand() for m in C.PARTY}, "test", "normal")


def _walk(enc, u, ms=12_000):
    """Run the sim and record every position u passes through."""
    seen = []
    for _ in range(ms // 100):
        enc.t += 100
        for v in enc.units.values():
            if v.move and v.alive:
                v.pos = v.move.pos_at(enc.t)
                if enc.t >= v.move.t0 + v.move.dur:
                    v.pos = v.move.to
                    v.move = None
                    if v.path:
                        enc.leg(v, v.path.pop(0))
        seen.append(u.pos)
    return seen


def _sampled(seen):
    """Every 0.1 m along the walked polyline (a 100 ms step at 5 m/s is 0.5 m)."""
    out = []
    for a, b in zip(seen, seen[1:]):
        n = max(1, int(dist(a, b) / 0.1))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n + 1)]
    return out


def test_a_move_through_the_throne_goes_around_it():
    enc = _arena()
    kit = enc.units["kit"]
    kit.pos = (-4.5, -11.0)
    enc.start_move(kit, (4.5, -11.0))  # straight through the throne, to its other side
    seen = _walk(enc, kit)
    assert dist(kit.pos, (4.5, -11.0)) < 0.05
    assert all(THRONE.gap(p) >= C.PLAYER_RADIUS - 0.01 for p in _sampled(seen))


def test_a_spot_inside_an_obstacle_is_pushed_out():
    enc = _arena()
    kit = enc.units["kit"]
    kit.pos = (5.0, -7.0)
    enc.start_move(kit, (0.5, -11.0))  # on the throne's seat
    _walk(enc, kit)
    assert C.in_obstacle(kit.pos, C.PLAYER_RADIUS) is None


def test_oruth_chases_around_his_throne():
    enc = _arena()
    boss, rook = enc.boss, enc.units["rook"]
    boss.pos, rook.pos = (-5.5, -11.0), (5.0, -11.0)  # the throne between them
    enc.chase(boss, rook)
    seen = _walk(enc, boss, 8000)
    assert all(THRONE.gap(p) >= boss.radius - 0.01 for p in _sampled(seen))
    assert enc.edge_dist(boss, rook) <= C.MELEE_RANGE


def test_pillars_are_solid_in_the_dungeon():
    from mythicsim.llm.policy import make_llm_policies
    from mythicsim.llm.scripted import ScriptedCommander
    pols, _ = make_llm_policies(ScriptedCommander(), tier="normal", mode="dungeon", knowledge="blind", parallel=False)
    run = DungeonRun(5, pols, "test", "normal")
    kit = run.units["kit"]
    pillar = next(o for o in C.OBSTACLES if o.id == "chapel_pillar_e")
    kit.pos = (7.0, 51.5)
    run.start_move(kit, (7.0, 56.5))  # straight through the pillar
    seen = _walk(run, kit, 4000)
    assert dist(kit.pos, (7.0, 56.5)) < 0.05
    assert all(pillar.gap(p) >= C.PLAYER_RADIUS - 0.01 for p in _sampled(seen))


def test_bone_pyre_never_lands_on_the_throne():
    for seed in range(12):
        enc = Encounter(seed, {m.id: _Stand() for m in C.PARTY}, "test", "plus10")
        enc.boss.pos = (0.0, -6.0)  # close enough that a careless spot would be on the throne
        enc.cast_bone_pyre(enc.boss)
        g = next(x for x in enc.ground.values() if x["kind"] == "pyre")
        assert C.in_obstacle(tuple(g["pos"]), 1.2) is None


def test_nobody_stands_in_an_obstacle_in_a_whole_run():
    from mythicsim.__main__ import simulate
    for tier in ("normal", "plus10"):
        rep = simulate(7, tier, "dungeon")
        radius = {u["id"]: u["radius"] for u in rep["units"]}
        for e in rep["events"]:
            if e["type"] == "spawn":
                radius[e["unit"]["id"]] = e["unit"]["radius"]
            if e["type"] == "move":
                a, b = e["from"], e["to"]
                r = radius[e["unit"]] - 0.01
                n = max(1, int(dist(a, b) / 0.1))
                for k in range(n + 1):
                    p = (a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)
                    assert C.in_obstacle(p, r) is None, (tier, e)


def test_nobody_hides_behind_the_throne():
    """The strip behind the throne is too narrow for Oruth, so it's solid for everyone."""
    enc = _arena()
    for x in (-2.5, 0.0, 2.5):
        assert C.in_obstacle((x, -13.5), C.PLAYER_RADIUS) is not None
        assert enc.clamp((x, -13.5)) != (x, -13.5)


def test_oruth_never_stalls_behind_his_throne():
    """Codex's case: Oruth on one side of the throne, a tank standing still on
    the other. The real boss tick: he walks round, swings, and casts Soul Rend."""
    enc = _arena()
    boss, rook = enc.boss, enc.units["rook"]
    for k, uid in enumerate(("ivy", "brask", "kit", "wren")):
        enc.units[uid].pos = (10.0, 4.0 + 1.5 * k)
    boss.pos, rook.pos = (4.75, -11.45), (-5.2, -10.5)
    enc.boss_engaged_t, boss.engaged = -10_000, True
    enc.boss_next = {"soul_rend": 0}
    for _ in range(100):  # 10 s
        enc.step()
        enc.t += 100
    hit = [e for e in enc.events if e.get("target") == "rook" and e["type"] in ("cast_start", "cast_success")]
    assert any(e["ability"] == "hollow_strike" for e in hit)
    assert any(e["ability"] == "soul_rend" for e in hit)


def test_oruth_stays_in_his_room_when_the_doorway_is_crowded():
    """Codex's case: the tank out in the corridor, allies crowding the doorway.
    Oruth never leaves his room; he fights the nearest player he can reach."""
    class Still:
        def act(self, obs):
            return []
    run = DungeonRun(3, {m.id: Still() for m in C.PARTY}, "test", "normal")
    for u in run.units.values():
        if u.pack:
            u.alive = False
    boss = run.boss
    run.units["rook"].pos = (0.0, 16.0)
    for uid, pos in (("ivy", (-1.2, 13.3)), ("brask", (1.2, 13.3)), ("kit", (0.0, 12.4)), ("wren", (-2.0, 11.6))):
        run.units[uid].pos = pos
    boss.engaged, run.boss_engaged_t, boss.pos = True, -10_000, (0.0, 0.0)
    for _ in range(150):
        run.step()
        run.t += 100
        assert dist(boss.pos, (0.0, 0.0)) <= C.ARENA_RADIUS - 2.5 + 0.01
    for e in run.events:
        if e["type"] == "move" and e["unit"] == "oruth":
            assert dist(e["to"], (0.0, 0.0)) <= C.ARENA_RADIUS - 2.5 + 0.01
    swings = [e for e in run.events if e["type"] == "cast_success" and e["ability"] == "hollow_strike"]
    assert swings and all(e["target"] != "rook" for e in swings)  # out of his reach, so someone else


def test_oruth_goes_back_to_his_target_once_he_can_reach_it():
    class Still:
        def act(self, obs):
            return []
    run = DungeonRun(3, {m.id: Still() for m in C.PARTY}, "test", "normal")
    for u in run.units.values():
        if u.pack:
            u.alive = False
    boss, rook = run.boss, run.units["rook"]
    rook.pos = (0.0, 16.0)
    for uid, pos in (("ivy", (-1.2, 13.3)), ("brask", (1.2, 13.3)), ("kit", (0.0, 12.4)), ("wren", (-2.0, 11.6))):
        run.units[uid].pos = pos
    boss.engaged, run.boss_engaged_t, boss.pos = True, -10_000, (0.0, 0.0)
    for _ in range(80):
        run.step()
        run.t += 100
    # The tank steps back into the room and the crowd clears the doorway.
    rook.pos = (0.0, 6.0)
    for k, uid in enumerate(("ivy", "brask", "kit", "wren")):
        run.units[uid].pos = (-9.0 + 2.0 * k, -6.0)
    n = len(run.events)
    for _ in range(60):
        run.step()
        run.t += 100
    swings = [e for e in run.events[n:] if e["type"] == "cast_success" and e["ability"] == "hollow_strike"]
    assert swings and swings[-1]["target"] == "rook"
