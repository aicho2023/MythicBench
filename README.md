# MythicBench

MythicBench is an open-source benchmark that asks one question: can an AI
model lead a five-person party through a Mythic+-style dungeon it has never
seen, and does it get better with each attempt?

One model controls the whole party: a tank, a healer and three damage
dealers. It starts blind. After each wipe it reads a combat log, writes notes
for its team, and tries again, up to five times. Every fight is a
deterministic simulation that saves a full event log, so you can watch any
attempt in a 3D replay viewer and recompute every score yourself.

![Mortisar, the Hollow King, fighting the expert bots in the replay viewer](docs/media/hero.jpg)

The simulator, the dungeon, the model harness and the viewer are working. The
official run across seven models is next, followed by a public site with the
leaderboard and a write-up.

## Watch a replay

You need Node 18 or newer and Python 3.10 or newer.

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173. Space plays and pauses, the arrow keys seek 5
seconds, and 1 to 4 set the speed. Click any line under Agent decisions to
jump to that moment.

Links can point at a moment:
`http://localhost:5173/?replay=sloppy-wipe&t=30&paused=1`.

## The dungeon

The Gravecrown Crypt plays like a Mythic+ key. The party walks in from the
entrance, clears two packs of undead, then kills Mortisar, the Hollow King.
One 4:30 timer covers the whole run.

- The Chapel pack is four Bonewalkers and a Bone Chanter. The Chanter's
  Grave Volley hits the whole party and can be interrupted.
- The Ossuary pack is three Bonewalkers and a Marrow Mender. Its Mend Bones
  heals the pack and can also be interrupted, so the Mender should die first.
- A pack attacks when someone comes within 9 m or hits it. Mortisar sleeps
  until someone walks into his room; his ability timers and his 3:15 enrage
  start then.
- Out of combat, the party regains health, and fallen characters get back up
  3 seconds after the fight ends. Each revive adds 10 seconds to the timer.

### Difficulty

There are two tiers, chosen with `--tier normal` or `--tier +10` (the
default).

On Normal, enemies have 60% of their listed health and damage, and there are
no affixes. A competent group clears it.

On +10, enemies have 85% health and full damage, and three affixes change how
the dungeon has to be played:

| Affix | Effect |
| --- | --- |
| Restless Graves | Each undead that dies (Mortisar excepted) leaves a grave for 12 seconds. It heals undead standing in it and hurts players standing in it. |
| Marrowburst | Each undead death gives every player a stack of Marrow Shards, which deals damage every second for 4 seconds per stack. Killing a whole pack at once hurts. |
| Hollow Tyrant | Mortisar summons adds three times instead of twice and Desecrates four players instead of three. |

The affixes are always shown to the model, as they are in the game. Only the
boss's abilities are hidden.

### Scoring

Each attempt gets a score from 0 to 100. A wipe earns up to 70, in proportion
to how far the party got: each trash pack is worth 15% and Mortisar 70%, by
health removed. A clear earns 70 plus up to 30 for speed, with the full 30
for finishing with a quarter of the timer left. Revive penalties count
against the timer.

A learning episode's progression score is the average of its attempt scores,
with a clear carrying forward to the remaining attempts. A model that learns
faster scores higher. The headline MythicBench score is the average of the
Normal and +10 progression scores.

### Calibration with scripted bots

Three hand-written bot parties play the same dungeon at fixed skill levels.
They don't learn; they show what good and bad play look like. Over 200 seeds:

| | Expert | Competent | Sloppy |
| --- | --- | --- | --- |
| Normal clear rate | 100% | 99.5% | 19% |
| +10 clear rate | 60% (53 to 67%) | 13% (9 to 18%) | 0% |
| +10 score | 73.5 (72.4 to 74.7) | 59.6 (58.1 to 61.2) | 16.3 (14.7 to 17.9) |

Ranges are 95% confidence intervals. The three bots come out in the right
order with no overlap, which is the first check that the benchmark tells
good play from bad.

The viewer ships one +10 run for each bot, all on seed 5. Every policy on a
seed faces the same boss timers, so only the decisions differ.

| Run | Outcome | Score | Interrupts | Deaths |
| --- | --- | --- | --- | --- |
| Expert bots | Cleared in 4:09 | 79.3 | 18 of 22 | 0 |
| Competent bots | Wiped at 4:26 with Mortisar nearly dead | 69.7 | 17 of 20 | 5 |
| Sloppy bots | Wiped at 0:40 on the first pack | 6.9 | 4 of 8 | 5 |

## How a model plays

The model reads the same observation the bots get, rendered as text, plus the
rules: every ability's tooltip, the map and the reply format. The rules
contain no strategy. It replies with standing orders for each character: an
optional move and a priority list of `[ability, target]` pairs.

The model is asked for new orders every 4 seconds of game time, and right
away when something happens: a cast starts, pools appear, adds spawn, a pack
is pulled or cleared, someone stands in an armed pool, or an ally gets low or
dies. The game pauses while it thinks, so a slow model is not penalised.

It uses the same controls as the bots. A move can be a coordinate, `"safe"`
(the bots' own dodge planner, which steps out of pools while keeping the
target in range) or `"next"` (the next point on the route). Queued interrupts
fire 350 ms after a cast starts, the expert bot's reaction time. The model
decides when and what; it doesn't have to do the geometry the bots get for
free.

Every model gets the same budget: one shared effort setting and at most
8,000 output tokens per call, thinking included. Invalid entries in a reply
are dropped and counted. If a provider refuses to answer, the refusal is
recorded and the party keeps its previous orders; no other model answers in
its place. Every reply is recorded, so any run can be replayed exactly
without calling the model again.

### Learning over pulls

In a progression run the party starts blind. It knows its own abilities and
the affixes, but nothing about Mortisar: no tooltips, no timers, no warning
about the enrage. After each wipe it gets a factual debrief built from the
event log: who died to what, what hit hardest, every boss cast and whether it
was interrupted, the adds, and the time spent in pools. It then rewrites its
team notes (up to about 350 words), which go into the rules for the next
attempt. Each attempt uses a new seed, so memorising timings doesn't help.

The `--memory off` control wipes the notes between attempts. If scores rise
with memory and stay flat without it, the gain comes from what the model
wrote down.

## Running models

Put your API keys in `.env` (copy `.env.example`), then from `sim/`:

```bash
python -m mythicsim progress --model mock:basic --episodes 0 --max-pulls 2    # free, no API
python -m mythicsim progress --model anthropic:claude-haiku-5-5@medium --episodes 0-2 --max-pulls 5 --workers 3
python -m mythicsim progress --model openai:gpt-6-luna@medium --episodes 0-2 --max-pulls 5 --memory off
python -m mythicsim llm --model anthropic:claude-haiku-5-5@medium --seeds 0-4    # single fights, no learning
```

A model is written `provider:model@effort`. The effort is one of `none`,
`low`, `medium`, `high`, `xhigh` or `max`, mapped to Anthropic's effort
setting or OpenAI's `reasoning_effort`. Each effort is its own configuration
with its own recording and results. `--workers N` plays N episodes at once;
they are independent, so this only saves time.

### The official protocol

`protocol/v1.json` defines the leaderboard run: seven models at one shared
effort, both tiers, three blind episodes of up to five attempts each, and
memory-off controls on the two cheapest models.

```bash
python -m mythicsim campaign ../protocol/v1.json --dry-run     # what's left and the worst-case cost
python -m mythicsim campaign ../protocol/v1.json --workers 3   # play it; safe to stop and rerun
python -m mythicsim results ../protocol/v1.json --out ../results/v1
```

`campaign` only plays episodes that haven't finished. Recorded replies make a
replayed episode free up to the point where it stopped. `results` writes
`leaderboard.json` with, for each model and tier, the progression score and
its confidence interval, the clear rate, attempts to clear, the learning gain
and the cost per attempt. It also writes a gzipped replay of every attempt
and the scripted bots' scores on the same seeds.

### Cost limits

Every run records its cost at list prices; the table is in
`sim/mythicsim/spend.py`. A run stops when its API spend reaches
`--budget-usd` (default $20) and keeps the fights it finished. Every real
API call is logged to `runs/spend.jsonl`, and no run may spend past
`MYTHICBENCH_TOTAL_BUDGET_USD` (in `.env`, default $500). Recorded replies
cost nothing.

```bash
python -m mythicsim runs spend    # spending so far, by model and by run
```

### Managing runs

Each command creates a run folder under `runs/` with a `manifest.json` (model,
settings, harness version, prompt hash, git commit, summary) and one replay
per fight. Name and tag runs with `--name` and `--tag`.

```bash
python -m mythicsim runs list --model haiku
python -m mythicsim runs show a1b2        # any unique part of the run id
python -m mythicsim runs rm a1b2
python -m mythicsim runs publish --all    # refresh the viewer's run list
```

In the viewer, the button in the top bar opens the run list, with search,
filters and a score for each attempt. Runs from an older harness version are
hidden by default because their scores aren't comparable.

## Simulator commands

```bash
cd sim
pip install -e ".[dev]"                                              # only needed for the tests
python -m mythicsim run --policy expert --seed 7 --tier +10          # one run, print the score
python -m mythicsim bench --policy expert,competent,sloppy --runs 200  # many runs, with 95% CIs
python -m mythicsim generate --out ../web/public/replays             # rebuild the viewer's bot replays
python -m pytest
```

## Why the numbers hold up

- The simulator is deterministic. The same seed and the same decisions give a
  byte-identical replay on any machine, because it avoids math functions whose
  last digit can differ between CPUs. CI checks this on Linux against replays
  made on a Mac.
- The event log is the only output. The viewer and every metric are computed
  from the replay file alone, and the tests check each event's health values
  against a running total.
- The viewer is tested against the simulator: it must reproduce the final
  state and every score, and jumping to any moment must match playing from
  the start.
- Bots and models get the same observation and the same controls. Neither
  can see engine internals.
- Every replay records the simulator, content and harness versions, the seed
  and the policy, so results from different rules are never mixed silently.

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## For WoW players

The names, art and numbers are all original, but the design will feel
familiar:

| MythicBench | In WoW terms |
| --- | --- |
| Mortisar, the Hollow King | the last boss of the key |
| Requiem of Bones (interruptible party damage) | the cast you have to kick |
| Soul Rend (tank buster) | press your big defensive |
| Desecrate (pools under three players) | don't stand in the bad |
| Summon the Restless | add waves to swap to |
| Hollow Fury, 3:15 after the pull | the hard enrage |
| Restless Graves, Marrowburst, Hollow Tyrant | the week's affixes |

| Class (role) | Key abilities | Closest WoW match |
| --- | --- | --- |
| Guardian (tank) | Ironhide, Rampart Bash, Challenging Roar | Shield Wall, Pummel, Challenging Shout |
| Lightweaver (healer) | Mending Light, Bloomward, Lumen Ward, Radiant Hymn | Flash Heal, Renew, Power Word: Shield, Divine Hymn |
| Berserker (damage) | Ravage, Cleaving Storm, Throat Punch | Fury Warrior with Whirlwind and Pummel |
| Shadowblade (damage) | Twin Fang, Venom Burst, Scatterblades, Quick Jab | Rogue with Fan of Knives and Kick |
| Ranger (damage) | Steady Arrow, Piercing Shot, Silencing Arrow, Wild Roar | Hunter with Counter Shot and Bloodlust |

## Repository layout

```
schema/replay.schema.json   the replay format (JSON event log)
protocol/v1.json            the official run: models, tiers, episodes
sim/                        Python simulator, standard library only
  mythicsim/content.py      game rules as data: classes, abilities, boss, dungeon, tiers
  mythicsim/engine.py       100 ms tick loop that writes the event log
  mythicsim/dungeon.py      the dungeon run: map, packs, pulling, resting
  mythicsim/policies.py     scripted expert, competent and sloppy bots
  mythicsim/metrics.py      scores, computed only from the event log
  mythicsim/llm/            model harness: prompt, clients, debrief, learning episodes
  mythicsim/campaign.py     the official protocol and the results dataset
  mythicsim/spend.py        prices and cost limits
  tests/
web/                        React and three.js replay viewer
  src/replay/               replay engine (no 3D, unit-tested)
  src/scene/                the 3D dungeon, characters and effects
  src/hud/                  the game interface
docs/                       architecture notes, asset guide, design audit
```

## Credits and license

The code is MIT-licensed. The characters, animations and dungeon pieces are
KayKit packs by Kay Lousberg, released under CC0. The idea of a careful,
readable game-based eval owes a lot to Dwarkesh Patel's
[Clocktower Bench](https://clocktowerbench.com/). Full credits are in
[THIRD_PARTY.md](THIRD_PARTY.md).

MythicBench is an independent project. It is not affiliated with or endorsed
by Blizzard Entertainment. World of Warcraft and Mythic+ are trademarks of
Blizzard Entertainment, Inc.
