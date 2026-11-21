# MythicBench

**Can better training data teach a small AI model to be a better dungeon teammate?**

MythicBench is an open-source benchmark where AI agents control a party of five
adventurers fighting a dungeon boss. Watch the fights in a cute 3D replay viewer,
compare decision-makers on the *exact same* encounter, and score them with
metrics anyone can recompute from the published replay files.

![Expert bots fighting Mortisar, the Hollow King](docs/media/hero.jpg)

> Phase 1 (this repo today): a deterministic simulator, two showcase replays, and
> the 3D viewer. LLM agents and training come next — see the [roadmap](#roadmap).

## Try it

You need **Node 18+** and **Python 3.10+**.

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173. Space = play/pause, ←/→ = ±5 s, 1–4 = speed.
Click any line in **Agent decisions** to rewind to that moment.

Link straight to a moment: `http://localhost:5173/?replay=sloppy-wipe&t=95&paused=1`

## How a run is scored

Each pull gets one number from **0 to 100**:

- **Wipe:** up to **70**, in proportion to the boss health removed.
- **Kill:** **70 plus up to 30 for speed.** The full 30 goes to a kill with a
  quarter of the 3:15 timer (or more) left.

70 is the line between a wipe and a kill. Win/loss alone would tie every team
that wins, and every team that wipes. The score keeps separating them: faster
kills at the top, deeper progress at the bottom. Interrupts, deaths, and
avoidable damage explain where points went. A learning episode's
**progression score** (also 0–100) is its average pull score, with a kill
carrying forward, so learning faster scores higher.

### Difficulty: key levels

Like Mythic+, the fight comes in key levels from **+2 to +30**:

- +12 is the tuned default.
- Each level up or down multiplies enemy health and damage by 1.08.
- Set it with `--level` on `run`, `bench`, `llm`, and `progress`, as a number
  or as `normal` / `heroic` / `mythic` (= +4 / +8 / +12).

Each bot has a natural ceiling, like a player's highest timed key (100 seeds
each):

| Level | Expert wins | Competent wins | Sloppy wins |
| --- | --- | --- | --- |
| +4 | 100% | 100% | 56% |
| +8 | 100% | 99% | 1% |
| +12 | 100% | 65% | 0% |
| +14 | 47% | 1% | 0% |
| +16 | 0% (81% of the boss down) | 0% | 0% |

## The dungeon run

A run of the **Gravecrown Crypt** works like a Mythic+ key: walk in from the
entrance, clear two trash packs, then kill Mortisar, all on one **4:30 timer**.

- **Chapel pack:** 4 Bonewalkers plus a **Bone Chanter**. Its Grave Volley
  hits the whole party and can be interrupted: kick it or eat it.
- **Ossuary pack:** 3 Bonewalkers plus a **Marrow Mender**. Its Mend Bones
  heals the pack and can be interrupted: kill the Mender first.
- **Pulling:** a pack attacks when anyone gets within 9 m or hits it. Mortisar
  sleeps until someone walks into his room, and his timers and enrage start
  then.
- **Between pulls:** the party regenerates health, and fallen allies get back
  up. Each revive costs **10 s** on the timer, so resting costs time and
  pulling hurt costs lives.
- **Scoring (0–100):** a wipe earns up to 70 for progress (each pack 15%,
  Mortisar 70%). A clear earns 70 plus up to 30 for speed, with revive
  penalties counted.

`--mode dungeon` is the default for `run`, `bench`, `llm`, and `progress`.
`--mode boss` plays the boss fight alone.

The viewer ships three runs on **seed 42**. Each seed shuffles the boss's
timers, but every policy on a seed faces the identical script, so only the
decision-maker differs.

| Run | Outcome | Score | Progress | Interrupts | Deaths |
| --- | --- | --- | --- | --- | --- |
| Expert bots | **Clear** in 3:44 | 90.4 | 100% | 17 / 21 | 0 |
| Competent bots | **Wipe** to the enrage, boss at 0.9% | 69.6 | 99.4% | 16 / 22 | 5 |
| Sloppy bots | **Wipe** at 2:22, boss at 63% | 39.0 | 55.7% | 4 / 13 | 5 |

Across 200 seeds (`python -m mythicsim bench --policy expert,competent,sloppy --runs 200`):

| Bot | Score (95% CI) | Clear rate (95% CI) | Interrupt rate |
| --- | --- | --- | --- |
| Expert | **89.0** (88.3–89.7) | 97% (94–99%) | 81% |
| Competent | **74.6** (72.8–76.4) | 62% (55–68%) | 74% |
| Sloppy | **30.8** (30.4–31.3) | 0% (0–2%) | 33% |

Three known skill levels, ranked in the right order with no overlap. That's the
check that the benchmark can tell good play from bad before any model plays it.
Boss-only fights (`--mode boss`) score expert 87.5, competent 72.3, and sloppy
14.9.

![The sloppy party's wipe](docs/media/wipe.jpg)

## The encounter (for WoW players)

Everything is original — names, art, numbers — but the design is
deliberately familiar:

| MythicBench | Think of it as… |
| --- | --- |
| **Mortisar, the Hollow King** | an undead king atop his throne |
| *Requiem of Bones* (interruptible party damage) | the cast you **must** kick |
| *Soul Rend* (tank buster) | press your big defensive |
| *Desecrate* (swirls under 3 players) | don't stand in the bad |
| *Summon the Restless* at 70% / 35% | adds — swap and kill them |
| *Hollow Fury* at 3:15 | the hard enrage (ramping party damage) |
| Sigil +12, 3:15 timer | the keystone and its timer |

| Class (role) | Abilities | Basically… |
| --- | --- | --- |
| Guardian (tank) | Ironhide, Rampart Bash, Challenging Roar | Shield Wall, Pummel, Challenging Shout |
| Lightweaver (healer) | Mending Light, Bloomward, Lumen Ward, Radiant Hymn | Flash Heal, Renew, Power Word: Shield, Divine Hymn |
| Berserker (dps) | Ravage, Cleaving Storm, Throat Punch | Fury warrior with Whirlwind and Pummel |
| Shadowblade (dps) | Twin Fang, Venom Burst, Scatterblades, Quick Jab | Rogue with Fan of Knives and Kick |
| Ranger (dps) | Steady Arrow, Piercing Shot, Silencing Arrow, Wild Roar | Hunter with Counter Shot and Bloodlust |

## Repository layout

```
schema/replay.schema.json   The contract: the JSON event-log format
sim/                        Python simulator (pure standard library)
  mythicsim/content.py      All game rules as data (classes, abilities, boss)
  mythicsim/engine.py       Deterministic 100 ms tick loop -> event log
  mythicsim/policies.py     Scripted "expert" and "sloppy" bots
  mythicsim/metrics.py      Scores computed ONLY from the event log
  tests/                    Determinism, schema, consistency tests
web/                        React + Three.js replay viewer
  src/replay/               Event-sourced replay engine (no 3D, unit-tested)
  src/scene/                3D arena, characters, effects
  src/hud/                  MMO interface
docs/                       Architecture notes, asset guide
```

## Simulator commands

```bash
cd sim
pip install -e ".[dev]"                    # only needed for tests
python -m mythicsim run --policy expert --seed 7          # one fight, print score
python -m mythicsim bench --policy expert,competent,sloppy --runs 200  # many fights, 95% CIs
python -m mythicsim generate --out ../web/public/replays  # rebuild viewer replays
python -m pytest
```

## Let a model play

One language model controls the whole party. It reads the same observation the
bots get, rendered as text, plus the rules (every ability's tooltip, the arena,
the reply format, and no strategy). It answers with standing orders per
character: an optional move, and a priority list of `[ability, target]`.

- **When it's asked:** every 2 s of game time, and immediately when something
  important happens: a boss cast starts, pools appear, adds spawn, someone is
  standing in an armed pool, or an ally gets low or dies.
- **Same controls as the bots:** a move can be coordinates or `"safe"`, which
  uses the bots' own dodge planner to step out of pools while keeping the
  target in range. Queued interrupts react after 350 ms, like the expert bot.
  The model decides *when* and *what*; it isn't asked to do coordinate geometry
  the bots get for free.
- **No time pressure:** the game pauses while the model thinks, so slow models
  aren't penalised.
- **Bad replies:** invalid entries are dropped and counted, never guessed.
- **Replayable:** every reply is recorded, so a run can be replayed exactly
  without calling the model again.

```bash
cp .env.example .env            # then paste your ANTHROPIC_API_KEY / OPENAI_API_KEY
cd sim
python -m mythicsim llm --model mock:basic --seeds 0-2             # free smoke test, no API
python -m mythicsim llm --model anthropic:claude-haiku-5-5 --seeds 0-4
python -m mythicsim llm --model openai:<model-name> --seeds 0-4
python -m mythicsim llm --model anthropic:claude-haiku-5-5 --seeds 0-4 --offline   # replay from recording
python -m mythicsim llm --model anthropic:claude-haiku-5-5@none --seeds 0-9 --workers 5   # thinking off, 5 fights at once
```

- **`--workers N`** plays N seeds at the same time. Fights are independent and
  mostly wait on the API, so this cuts wall-clock time roughly N-fold without
  changing any result.
- **`--effort none|low|medium|high`**, or `model@effort`, sets how much the
  model thinks: Anthropic thinking off or the effort level, OpenAI
  `reasoning_effort`. Without it you get the provider's default. Note that
  gpt-5.4-mini's default does *no* reasoning. Each effort is its own
  configuration with its own label, recording, and results folder.

Each run prints the model's score next to the expert, competent, and sloppy
bots on the same seeds. It also prints calls, tokens, and dropped entries;
add `--price-in/--price-out` (USD per 1M tokens) for a cost estimate.

### Learning over pulls

How many pulls does a model need to kill a boss it has never seen, and does
it actually learn? In a **progression** run, the party starts **blind**:
- It knows its own abilities but nothing about Mortisar (no tooltips, no
  timers, no warning about the enrage).
- After each wipe it gets a factual combat-log debrief: who died to what, what
  hit hardest, every boss cast seen and whether it was interrupted, adds, and
  time spent in pools.
- It then rewrites its team NOTES (up to ~350 words), and the notes go into the
  rules for the next pull.
- Each pull uses a new seed, so it has to learn the mechanics, not memorize
  timings.

```bash
python -m mythicsim progress --model anthropic:claude-haiku-5-5@none --episodes 0-4 --max-pulls 6 --workers 5
python -m mythicsim progress --model anthropic:claude-haiku-5-5@none --episodes 0-4 --max-pulls 6 --memory off   # control
```

It reports kill rate, pulls-to-kill, learning gain, and the mean score at each
pull, with 95% CIs.

The `--memory off` control wipes the notes between pulls. If memory-on improves
and memory-off doesn't, the improvement comes from learning, not luck.

In the viewer, a progression run lists its episodes as strips of pulls. The
**Learning** panel shows the score per pull, what the model knew going into
the pull, and what it wrote afterwards, with new lessons highlighted.

### Organizing runs

Every invocation is one **run** in its own folder, and nothing is ever
overwritten:

```
runs/2026-11-21T1530_claude-haiku-5-5@none_a1b2/
  manifest.json            model, effort, seeds, harness version, prompt hash,
                           git commit, name, tags, summary
  seeds/seed-N.json        replays (+ .stats.json with calls and tokens)
```

Name and tag runs with `--name "prompt v2" --tag ablation`. Then:

```bash
python -m mythicsim runs list --model haiku --tag ablation   # newest first
python -m mythicsim runs show a1b2                           # any unique part of the id
python -m mythicsim runs rm a1b2
python -m mythicsim runs publish --all                       # refresh the viewer catalog
```

In the viewer (`cd web && npm run dev`), **Model runs** in the top bar opens a
browser with search, provider/effort filters, sorting, and per-seed score
chips. Runs from an older harness version are flagged as not directly
comparable. Links like `?run=a1b2&seed=3` open a specific fight.

## Why you can trust the numbers

1. **Deterministic.** Same seed + same policy ⇒ byte-identical replay, on any
   machine: the sim avoids math functions whose last bit varies by CPU (tested).
2. **The log is the truth.** The viewer and every metric derive from the replay
   file alone; health in every event is cross-checked against a running total.
3. **The viewer is verified.** Viewer tests confirm it reconstructs the
   simulator's final state and damage numbers *exactly*, and that scrubbing
   to any moment equals replaying from the start.
4. **Same interface for every agent.** Bots receive the same JSON observation
   an LLM will receive. No privileged access to engine internals.
5. **Versioned.** Every replay records `sim_version`, `content_version`, seed,
   and policy so results are never silently compared across rule changes.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Roadmap

- **Phase 1 — Visual prototype** ✅ simulator, replays, 3D viewer
- **Phase 1.5** — KayKit models and dungeon ✅ ([docs/ASSETS.md](docs/ASSETS.md)); panda ranger customization next
- **Phase 2 — LLM agents & evals** — harness ✅ (`mythicsim llm`); next: first real model runs, then multi-seed leaderboard
- **Phase 3 — Training** — generate expert trajectories, SFT a small open model, then preference optimization / RL
- **Phase 4 — Public benchmark** — leaderboard, side-by-side failure replays

## License

Code: MIT. Character, weapon, and dungeon art: KayKit packs by Kay Lousberg (CC0).
Fallback art is generated procedurally in code. MythicBench is an independent project and is not
affiliated with or endorsed by Blizzard Entertainment.
