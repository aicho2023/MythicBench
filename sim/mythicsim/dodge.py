"""Where to step to get out of a harmful pool: the planner behind the agents'
"safe" move. Pure functions of what an agent can see (the observation)."""

from __future__ import annotations

import math

from . import content as C
from .engine import COMPASS16 as _DIRS, dist


def hazards(ground: list[dict]) -> list[dict]:
    """The pools that hurt to stand in (a Bone Pyre doesn't, until it goes off)."""
    return [g for g in ground if g.get("kind", "desecrate") in C.HAZARD_POOLS]


def unsafe(pos, ground: list[dict], margin: float = 0.6) -> bool:
    return any(dist(pos, g["pos"]) <= g["radius"] + margin for g in hazards(ground))


def crosses_pool(a: tuple, b: tuple, ground: list[dict], margin: float = 0.3) -> bool:
    """Does walking straight from a to b pass through an armed pool? (sampled every ~0.25 m)"""
    steps = max(1, int(dist(a, b) / 0.25))
    for i in range(1, steps + 1):
        f = i / steps
        p = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        if any(g.get("armed", True) and dist(p, g["pos"]) <= g["radius"] + margin for g in hazards(ground)):
            return True
    return False


def walk_check(obs: dict):
    """Where a dodge may end: inside the dungeon's rooms and corridors on a
    dungeon run, else inside the boss arena (None = the arena default)."""
    if obs.get("dungeon"):
        return lambda p: C.walkable(p, 0.5)
    return None


def find_safe_spot(ground: list[dict], arena_radius: float, near: tuple, anchor: tuple,
                   reach=None, avoid_paths: bool = False, inside=None) -> tuple | None:
    """Nearest spot clear of harmful pools (the "safe" move's planner).

    ``reach`` = (target_pos, target_radius, range): only consider spots from
    which that target is still in range (e.g. a melee character stays in melee).
    ``avoid_paths``: also reject spots whose straight path from ``near`` crosses
    another armed pool (the pool being escaped from is ignored).
    ``inside``: where a spot may be (default: within the boss arena).
    """
    ground = hazards(ground)
    escaping = [g for g in ground if dist(near, g["pos"]) <= g["radius"] + 0.6]
    others = [g for g in ground if g not in escaping]
    best, best_score = None, math.inf
    lim = arena_radius - 1.5
    for ring in (1.5, 2.5, 3.5, 4.5, 6.0, 8.0):
        for cx, cz in _DIRS:
            cand = (near[0] + ring * cx, near[1] + ring * cz)
            if not (inside(cand) if inside else dist(cand, (0.0, 0.0)) <= lim) or unsafe(cand, ground, 0.9):
                continue
            if reach and dist(cand, reach[0]) - C.PLAYER_RADIUS - reach[1] > reach[2]:
                continue
            if avoid_paths and crosses_pool(near, cand, others):
                continue
            # Shortest escape, near where we want to be; among equally good
            # spots, prefer the middle of the room (stay with the group,
            # never get pinned against the wall). Without this tie-break the
            # choice between equal spots fell to floating-point noise.
            score = dist(cand, near) + 0.5 * dist(cand, anchor) + 0.05 * dist(cand, (0.0, 0.0))
            if score < best_score:
                best, best_score = cand, score
    return best
