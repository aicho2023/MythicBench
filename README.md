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

Link straight to a moment: `http://localhost:5173/?replay=sloppy-wipe&t=123&paused=1`

## Same fight, two teams

Both replays use **seed 2**: identical boss timers, identical random rolls. Only
the decision-maker differs.

| Run | Outcome | Interrupts | Deaths |
| --- | --- | --- | --- |
| Expert bots | **Kill** in 2:56 | 11 / 11 | 0 |
| Sloppy bots | **Wipe** at 2:13 (boss at 23%) | 3 / 8 | 5 |

Across 100 seeds each (`python -m mythicsim bench`), expert bots win **100%** and
sloppy bots win **10%**. That gap is the kind of signal the benchmark measures.

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
| *Hollow Fury* at 4:00 | the hard enrage |
| Sigil +12, 4:00 timer | the keystone and its timer |

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
python -m mythicsim bench --policy sloppy --runs 200      # many fights, no graphics
python -m mythicsim generate --out ../web/public/replays  # rebuild viewer replays
python -m pytest
```

## Why you can trust the numbers

1. **Deterministic.** Same seed + same policy ⇒ byte-identical replay (tested).
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
- **Phase 1.5** — swap placeholder characters for KayKit models ([docs/ASSETS.md](docs/ASSETS.md)), panda ranger
- **Phase 2 — LLM agents & evals** — plug models into `Policy`, multi-seed evaluation, confidence intervals
- **Phase 3 — Training** — generate expert trajectories, SFT a small open model, then preference optimization / RL
- **Phase 4 — Public benchmark** — leaderboard, side-by-side failure replays

## License

Code: MIT. Placeholder art is generated procedurally in code. KayKit assets (when
added) are CC0 by Kay Lousberg. MythicBench is an independent project and is not
affiliated with or endorsed by Blizzard Entertainment.
