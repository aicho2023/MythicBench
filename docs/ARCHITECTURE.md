# Architecture (and why it looks like this)

This is written for someone learning to engineer systems like this. Each
section states a decision, the alternative, and why we chose what we did.

## The big picture

```
 content.py (rules as data)
        │
        ▼
 engine.py, dungeon.py  ◄── observation ──  llm/policy.py  (five agents: a model,
  100 ms ticks           ─── actions ────►                  or a script, answers)
        │
        ▼
 replay.json  (timestamped event log)  ──► metrics.py   (scores)
        │
        ▼
 web/src/replay/engine.ts  (state at time t)  ──► 3D scene + HUD
```

There is exactly **one arrow** between the simulator and the viewer: the replay
file. Simulation and visualization are separate programs that share a file
format (`schema/replay.schema.json`).

Around that core:

- `llm/` is the model harness: the prompt, the API clients, the party's talk
  and notes between pulls.
- `campaign.py` plays a whole protocol (`protocol/v1.json`), builds the
  published dataset and verifies it.
- `spend.py` prices every API call and enforces the budgets.

## Decision 1: a real simulator, not hand-written fake JSON

*Alternative:* hand-author a scripted fight for the viewer.

*Why not:* fake data drifts from reality. Every replay you watch is genuine
output of the simulator, which is standard-library Python with no
dependencies.

## Decision 2: fixed-tick, seeded simulation

The engine advances in fixed 100 ms steps, and all randomness comes from
`random.Random` streams made from the seed: one for combat rolls, one per boss
ability for its timings, one for where each Bone Pyre lands. The boss's
streams are separate so that nothing the players do can shift his script:
every party on a seed faces the same fight.

*Why:* reproducibility is the foundation of a benchmark. If someone reports
"model X wiped on seed 41," anyone can regenerate that exact fight.
`tests/test_replays.py::test_deterministic_same_seed` hashes two runs and
demands they match byte-for-byte.

*Trade-off:* 100 ms is coarser than a real MMO, but decisions in this genre
happen on the scale of about a second (the global cooldown), so it is plenty,
and it keeps headless runs fast.

## Decision 3: event sourcing for the viewer

The viewer never stores "the current health of Rook." It stores the event
log, and computes state at time *t* by applying (folding) events in order.
This pattern is called **event sourcing**.

What it buys:
- **Scrubbing for free.** Jump to 1:23? Fold events up to 1:23.
- **Honesty.** The viewer *cannot* show anything not in the log.
- **Testability.** `engine.test.ts` checks that the viewer reaches exactly the
  simulator's final state and scores.

Performance trick: folding from 0 each frame would be wasteful, so we keep a
snapshot every second. State at *t* = clone nearest snapshot + apply the few
events after it. A test checks this equals folding from scratch.

## Decision 4: animation is a pure function of time

Character poses, projectile positions, floating numbers, and pool swirls are
all computed from replay time, never from "how many frames have passed."
Pause freezes everything; scrubbing always shows the same picture.

The only exception is smoothing of where units face (turning toward a
target), which is cosmetic.

## Decision 5: events carry the result, not just the cause

Each `damage`/`heal` event includes the target's resulting `hp`. That is
redundant (you could compute it), which is the point: the viewer can't drift,
and `test_hp_is_consistent` verifies the redundancy everywhere.

## Decision 6: policies see observations, not the engine

`Encounter.observe(unit)` builds a plain dict: my health, cooldowns, the
boss's cast bar, where the ground effects are, party status. Policies return a
list of `Action`s. Nothing else crosses that line, so no player can read
engine internals.

An action may carry a `reason`; the engine logs it as a `decision` event,
which the viewer shows under **Decisions**. For a model this is its stated
rationale, which is what makes it possible to study *why* a party failed.

## Decision 7: models and scripts play through the same interface

A model does not act every tick. Each of the five agents is asked every 4
seconds of game time, and sooner when something happens (a new cast, a death,
a pool under its feet). It reads the state as text and answers in JSON with
standing orders: where to go, a priority list of abilities and targets, and
optionally a line of party chat. `llm/policy.py` turns those orders into
per-tick actions until the next answer. The game waits while the model thinks.

The scripted commander (`llm/scripted.py`) and the expert script
(`llm/expert.py`) are "models" too: they read the same text and answer in the
same JSON, with fixed rules where a model would think. The expert clearing the
dungeon proves a clear is possible through the interface the models get.

## Decision 8: every model reply is recorded

`llm/clients.py` stores each reply under a hash of the model configuration,
the full prompt, and a tag saying where in the run the call was made. Playing
a group again reads the recorded replies, so with the deterministic simulator
the whole run replays offline, for free, to the same event log.

That is what `python -m mythicsim verify` does for the published dataset: it
replays all 525 pulls from the recordings, rescoring each from its event log,
and rebuilds the leaderboard.

*The cost:* the prompt text is frozen. Changing one character of it changes
the hash, and the recordings no longer match. Prompt changes need a new
harness version and a new run.

## Things that are deliberately simple

- No mana or other resources, no threat tables, no line of sight.
- No healer mana means damage that doesn't kill is free. Pools and missed
  kicks are tuned to hit hard enough to kill instead.
- One dungeon.

## The game, in code

- **Per-seed boss script.** Each timed boss ability draws its timings from its
  own `random.Random(f"{seed}:timer:{ability}")` stream. Mechanics overlap on
  some seeds.
- **Enrage.** 3:15 after Oruth is pulled, Hollow Fury pulses ramping damage on
  the whole party every second (`BOSS.enrage_ms`).
- **The dungeon** (`dungeon.py`): `DungeonRun(Encounter)`.
  - Rooms are circles and corridors rectangles (`content.ROOMS/CORRIDORS`,
    `walkable`). The throne and the pillars are obstacles units walk around
    (`content.OBSTACLES`).
  - Packs sleep until a player is within `AGGRO_RADIUS` or hits one; Oruth
    sleeps until `BOSS_ENGAGE_RADIUS`, and his timers start at the pull.
  - Out of combat: health regenerates, and fallen allies revive after 3 s,
    each revive adding 10 s to the timer.
  - Trash ids are pack-prefixed (`pack1_bonewalker_1`) so they never collide
    with the boss's summoned `bonewalker_N`.
  - Policies get `obs["dungeon"]` (timer, packs, route) and an `engaged` flag
    on enemies.
- **Scoring** (`metrics.py`, `SCORE_VERSION` 2), 0 to 100: a wipe earns up to
  70 for progress (each pack 15%, Oruth 70%, by health removed); a clear earns
  70 plus up to 30 for speed (the full 30 with a quarter of the timer or more
  left). Scores are a pure function of the event log, so `mythicsim runs
  rescore` recomputes saved runs exactly.
- **Tiers** (`content.TIERS`, `--tier normal|+10`). A tier sets enemy health
  and damage multipliers, the timer, and a list of affixes (`content.AFFIXES`):
  - `Encounter.on_undead_death` drives Restless Graves (a `grave` ground
    effect) and Marrowburst (a stacking `marrow_shards` aura);
  - `self.tyrant` drives Hollow Tyrant (a third add wave).
  - Replay meta carries `tier`, `tier_name` and `affixes`.
- **Cross-platform determinism.** CI regenerates the showcase replays and
  diffs them against the committed ones. libm results (`hypot`, `cos`,
  `sin`…) can differ in the last bit between CPUs, so the sim uses only
  `+ - * /` and `sqrt` (exactly rounded by IEEE 754) and hard-coded direction
  constants; `test_no_platform_dependent_math` enforces it.

## Known follow-ups

- `web/src/replay/types.ts` mirrors `schema/replay.schema.json` by hand; one
  could be generated from the other.
