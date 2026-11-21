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

Each run gets one number:

- **Wipe:** the % of the boss's health the party removed (0–100).
- **Kill:** 100, plus one point per second left on the 3:15 timer.

Win/loss alone would tie every team that wins, and every team that wipes. The
score keeps separating them: faster kills at the top, deeper progress at the
bottom. Interrupts, deaths, and avoidable damage explain where points went.

## Same fight, three teams

The viewer ships three replays on **seed 42**. Each seed shuffles the boss's
timers, but every policy on a seed faces the identical boss script, so only the
decision-maker differs.

| Run | Outcome | Score | Interrupts | Deaths |
| --- | --- | --- | --- | --- |
| Expert bots | **Kill** in 2:47 | 127.8 | 11 / 11 | 0 |
| Competent bots | **Wipe** to the enrage at 3:19, boss at 3.8% | 96.2 | 10 / 13 | 5 |
| Sloppy bots | **Wipe** at 1:22 (boss at 62%) | 38.3 | 3 / 5 | 5 |

Across 200 seeds (`python -m mythicsim bench --policy expert,competent,sloppy --runs 200`):

| Bot | Score (95% CI) | Win rate (95% CI) | Interrupt rate |
| --- | --- | --- | --- |
| Expert | **128.4** (127.3–129.5) | 99.5% (97–100%) | 99.7% |
| Competent | **104.8** (101.6–108.0) | 68.5% (62–75%) | 85.9% |
| Sloppy | **21.3** (20.5–22.1) | 0% (0–2%) | 47.8% |

Three known skill levels, ranked in the right order with no overlap. That's the
check that the benchmark can tell good play from bad before any model plays it.
Expert bots almost always win, so at the top the score separates agents by kill
time (an expert kill leaves ~29 s on the clock).

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

- Replays, stats, and recordings go to `runs/` (git-ignored).
- Each replay also appears in the viewer under **Model runs** (start it with
  `cd web && npm run dev`).

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
