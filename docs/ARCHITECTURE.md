# Architecture (and why it looks like this)

This is written for someone learning to engineer systems like this. Each
section states a decision, the alternative, and why we chose what we did.

## The big picture

```
 content.py (rules as data)
        │
        ▼
 engine.py  ◄──── observation (JSON) ──── policies.py  (bots today, LLMs tomorrow)
  100 ms ticks ──── actions (JSON) ─────►
        │
        ▼
 replay.json  (timestamped event log)  ──► metrics.py   (scores)
        │
        ▼
 web/src/replay/engine.ts  (state at time t)  ──► 3D scene + HUD
```

There is exactly **one arrow** between the simulator and the viewer: the replay
file. That's the critical principle from the project brief — *separate
simulation from visualization*.

## Decision 1: a real simulator now, not hand-written fake JSON

*Alternative:* hand-author a scripted fight for Phase 1.

*Why not:* fake data drifts from reality. By writing a small but real simulator
immediately, every replay you watch is genuine output, and Phase 2 starts from
working code instead of a rewrite. It cost very little extra: the sim is ~600
lines of standard-library Python.

## Decision 2: fixed-tick, seeded simulation

The engine advances in fixed 100 ms steps and all randomness comes from one
`random.Random(seed)` (each bot gets its own seeded RNG, so one bot's dice rolls
never shift another's).

*Why:* reproducibility is the foundation of a benchmark. If someone reports
"model X wiped on seed 41," anyone can regenerate that exact fight.
`tests/test_replays.py::test_deterministic_same_seed` hashes two runs and
demands they match byte-for-byte.

*Trade-off:* 100 ms is coarser than a real MMO, but decisions in this genre
happen on the scale of ~1 s (the global cooldown), so it is plenty — and it
makes headless runs fast (~0.25 s per full fight).

## Decision 3: event sourcing for the viewer

The viewer never stores "the current health of Rook." It stores the event
log, and computes state at time *t* by applying (folding) events in order.
This pattern is called **event sourcing**.

What it buys:
- **Scrubbing for free.** Jump to 1:23? Fold events up to 1:23.
- **Honesty.** The viewer *cannot* show anything not in the log.
- **Testability.** `engine.test.ts` checks that the viewer reaches exactly the
  simulator's final state.

Performance trick: folding from 0 each frame would be wasteful, so we keep a
snapshot every second. State at *t* = clone nearest snapshot + apply the few
events after it. A test checks this equals folding from scratch.

## Decision 4: animation is a pure function of time

Character poses, projectile positions, floating numbers, and pool swirls are
all computed from replay time — never from "how many frames have passed."
Pause freezes everything; scrubbing always shows the same picture. (Even the
ambient dust motes follow replay time.)

The only exception is camera-facing smoothing (units turning toward targets),
which is cosmetic.

## Decision 5: events carry the result, not just the cause

Each `damage`/`heal` event includes the target's resulting `hp`. That is
redundant (you could compute it), which is the point: the viewer can't drift,
and the Python test suite verifies the redundancy is consistent everywhere.

## Decision 6: policies see observations, not the engine

`Encounter.observe(unit)` builds a plain dict: my health, cooldowns, the boss's
cast bar, where the ground effects are, party status. Policies return a list of
`Action`s. The scripted bots use *only* this — which proves the observation
contains enough information to play well, and guarantees bots and LLMs are
judged on equal footing.

Bots may attach a `reason` to an action; the engine logs it as a `decision`
event, which the viewer shows in **Agent decisions**. For LLMs this becomes
their stated rationale — great for studying *why* models fail.

## Decision 7: a controlled experiment, even for the demo

The expert, competent, and sloppy bots are the same code with different `Skill` knobs
(reaction time, chance to notice a cast, whether they swap to adds…). Same
seed, same encounter, only decision quality varies. That's the shape every
future comparison should have.

## Things that are deliberately simple (for now)

- No mana/resources, threat tables, or line-of-sight.
- The boss doesn't move; the arena has no obstacles.
- One encounter, one content version.
- No healer mana, so damage that doesn't kill is free. Pools and missed kicks are
  tuned to hit hard enough to kill instead.

## Difficulty and scoring (content 0.2.0)

- **Per-seed boss script.** Each timed boss ability draws its timings from its
  own `random.Random(f"{seed}:timer:{ability}")` stream (first cast ±3 s,
  repeats ±25% of the interval). Players can't shift these draws, so every
  policy on a seed faces the same script. Mechanics overlap on some seeds.
- **Hard enrage at 3:15.** Hollow Fury pulses ramping damage on the whole party
  every second, so the timer is a real deadline. Expert bots kill with ~29 s
  to spare; a few mistakes cost the kill.
- **Run score** (`metrics.run_score`, `SCORE_VERSION` 2), 0–100: a wipe earns
  up to 70 for boss health removed; a kill earns 70 plus up to 30 for speed
  (full 30 with ≥25% of the timer left). It separates every rung of a skill
  ladder, where win rate falls off a cliff. Old runs are converted with
  `mythicsim runs rescore`, which is exact because scores are a pure function
  of the event log.
- **Dungeon run** (`dungeon.py`, content 0.3.0): `DungeonRun(Encounter)`.
  - Rooms are circles and corridors rectangles (`content.ROOMS/CORRIDORS`, `walkable`).
  - Packs sleep until a player is within `AGGRO_RADIUS` or hits one; Oruth
    sleeps until `BOSS_ENGAGE_RADIUS`, and his timers and enrage shift to the pull.
  - Out of combat: regen, and revives after 3 s, each +10 s on the timer.
  - Trash ids are pack-prefixed (`pack1_bonewalker_1`) so they never collide
    with the boss's summoned `bonewalker_N`.
  - Policies get `obs["dungeon"]` (timer, packs, route) and an `engaged` flag
    on enemies. Bots: `policies.DungeonPolicy` (route, formation, casters
    first, rest to 80%, Wild Roar saved for the boss).
  - Score: `metrics.dungeon_score` (progress weights 15/15/70).
  - Boss-only fights are byte-identical except for the ability table.
- **Tiers** (`content.TIERS`, `--tier normal|+10`). A tier sets enemy
  health/damage multipliers and a list of affixes (`content.AFFIXES`):
  - `Encounter.on_undead_death` drives Restless Graves (a `grave` ground
    effect that heals undead and hurts players) and Marrowburst (a stacking
    `marrow_shards` aura; `AuraDef.stacks`, `aura_apply.stacks`);
  - `self.tyrant` drives Hollow Tyrant (a third add wave, four Desecrates).
  - Replay meta carries `tier`, `tier_name` and `affixes`, and the top level
    carries the affix tooltips.
- **Cross-platform determinism.** CI regenerates replays on Linux and diffs
  them against ones made on a Mac. libm results (`hypot`, `cos`, `sin`…) can
  differ in the last bit between CPUs, so the sim uses only `+ - * /` and
  `sqrt` (exactly rounded by IEEE 754) and hard-coded direction constants;
  `test_no_platform_dependent_math` enforces it. Bots must also break ties on
  purpose: the dodge planner prefers spots nearer the arena centre. Before
  that rule, ties fell to float noise, and that noise alone swung the expert
  bot's win rate between ~2% and ~100%.
- **Validation.** `test_reference_bots_rank_in_order` requires the expert,
  competent, and sloppy bots to rank in order with non-overlapping 95% CIs.

## Known follow-ups

- The JS bundle is ~1.1 MB (three.js); code-splitting can come later.
- `web/src/replay/types.ts` mirrors `schema/replay.schema.json` by hand; we
  could generate one from the other.
- Placeholder characters are procedural; see `ASSETS.md` for the KayKit swap.
