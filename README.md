# MythicBench

Can AI Agents Learn How to Defeat MMORPG Dungeons?

Five agents, one per character and all the same model, run a Mythic+-style
dungeon they have never seen. After each wipe they read the same combat log,
talk it over, rewrite their own notes and try again, up to five times. Nothing
tells them what to learn. Every fight is a deterministic simulation, so every
attempt can be watched in a 3D replay and every score recomputed from it.

![Oruth the Unburied in the replay viewer](docs/media/hero.jpg)

Results, replays and the report: **[mythicbench.com](https://mythicbench.com)**

## Results (v1)

Seven models from four labs, six groups each on +10, up to five pulls per
group. No model cleared the dungeon.

| Model | Score (95% CI) |
| --- | --- |
| Claude Opus 5.5 | 44.1 (40.4 to 47.7) |
| GPT-6.2 Sol | 42.9 (37.6 to 48.3) |
| DeepSeek V4.1 Flash | 33.4 (29.4 to 37.3) |
| GPT-6 Luna | 32.8 (31.8 to 33.8) |
| Claude Sonnet 5.5 | 32.7 (28.7 to 36.7) |
| Grok 4.3 | 32.4 (30.3 to 34.6) |
| Claude Haiku 5.5 | 32.1 (29.0 to 35.3) |
| Scripted bot (reference) | 32.5 |

Every model plays about the same on the blind first pull. The gap opens after
it. Only Opus and Sol learned the fight's key mechanic, standing in Bone
Pyre's circle so it doesn't hit the whole party, and they learned it in every
group. Which differences are statistically clear is in the
[report](https://mythicbench.com/report#results).

## Check the results for free

Every model reply is recorded, so the whole leaderboard rebuilds offline with
no API calls. You need Python 3.10+.

```bash
cd sim && pip install -e ".[dev]"
python -m mythicsim verify ../web/public/results/v1             # replay all 525 pulls, rebuild the leaderboard
python -m mythicsim export ../web/public/results/v1 --zip       # CSVs, JSONL and one story per group
```

## Watch replays locally

You need Node 18+.

```bash
cd web && npm install && npm run dev
```

Open http://localhost:5173. Space plays and pauses, the arrow keys seek 5
seconds, 1 to 4 set the speed. `/watch/<model>/<tier>/<group>/<pull>` opens
one pull, and `?t=30` starts it at 0:30.

## How it works

**The dungeon.** The Hollow Vault is two packs of undead and a boss, Oruth the
Unburied, on one 4:15 timer. A clear means everything dies before the timer
runs out. The ranked tier, +10, has 98% enemy health, 115% damage and three
affixes. Normal (95% health, 90% damage, no affixes) is an unranked check.

**Scoring.** A wipe scores up to 70 for how far the party got (each pack 15%,
Oruth 70%, by health removed). A clear scores 70 plus up to 30 for speed. A
group's score is the mean of its pulls, a clear counting again for each pull
it saved. A model's score is its mean group score on +10.

**The agents.** Each agent sees what its character would, as text, and
replies in JSON with a move, a priority list of abilities and targets, and
optionally a line of party chat. It is asked every 4 seconds of game time and
sooner when something happens. The game waits while it thinks. Every model
gets the same prompt, seeds and call budget, at its lab's "medium" effort,
with an 8,000-token output cap per reply.

**Learning.** The party starts blind to everything about the enemies. After a
wipe it gets a factual debrief from the event log, talks it over, and each
agent rewrites its notes for the next pull. Each pull uses a new seed, so
memorising timings doesn't help. The `--memory off` control drops the
debrief, talk and notes, to measure what they add.

**The protocol.** Models, seeds, metrics, analysis and stopping rules were
fixed before the run in [docs/PREREGISTRATION.md](docs/PREREGISTRATION.md),
with the code frozen at harness 1.0.0. `protocol/v1.json` is the run.

## Running models

Put API keys in `.env` (copy `.env.example`), then from `sim/`:

```bash
python -m mythicsim progress --model mock:basic --episodes 0 --max-pulls 2       # free, no API
python -m mythicsim progress --model anthropic:claude-haiku-5-5@medium --episodes 0-2 --max-pulls 5
python -m mythicsim campaign ../protocol/v1.json --dry-run                       # what's left, worst-case cost
python -m mythicsim campaign ../protocol/v1.json                                 # resumable
python -m mythicsim results ../protocol/v1.json --out ../web/public/results/v1
```

A model is `provider:model@effort`. Providers: `anthropic`, `openai`, `xai`,
`deepseek`. Each run stops at `--budget-usd` (default $20), and nothing spends
past `MYTHICBENCH_TOTAL_BUDGET_USD` (in `.env`, default $500). Every API call
is logged to `runs/spend.jsonl`; `python -m mythicsim runs spend` totals it.
Recorded replies cost nothing. To run a stage in a Claude Code cloud session,
see [docs/CLOUD_RUN.md](docs/CLOUD_RUN.md).

## Why the numbers hold up

- The simulator is deterministic: the same seed and decisions give a
  byte-identical replay on any machine. CI checks Linux against Mac.
- Every score is computed from the replay's event log alone, and the viewer
  is tested to reproduce the simulator's final state and scores.
- Every replay records the simulator, content and harness versions, so
  results from different rules are never mixed.
- The scripted bot and the models play through the same interface.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository

```
protocol/      the official run: models, tiers, seeds
sim/           Python simulator and model harness (standard library only)
  mythicsim/llm/       prompts, API clients, debrief, learning episodes
  mythicsim/campaign.py  the protocol, results dataset and verification
web/           the site and 3D replay viewer (React, three.js)
  public/results/v1/   the published dataset: leaderboard, replays, recordings
docs/          architecture, pre-registration, cloud runs
```

## Citing

If you use MythicBench, its data or its findings, please cite the paper:

```bibtex
@misc{mythicbench2026,
  title        = {MythicBench: Can AI Agents Learn How to Defeat MMORPG Dungeons?},
  author       = {Ho, Austin},
  year         = {2026},
  howpublished = {\url{https://mythicbench.com/report}},
  note         = {Code and data: https://github.com/aicho2023/MythicBench}
}
```

GitHub's "Cite this repository" button gives the same entry, from
[CITATION.cff](CITATION.cff).

## Credits and license

The code is under the [MIT License](LICENSE). The data (everything under
`web/public/results/` and `web/public/insights/`, including the replays and
recorded model replies), the highlights and the paper are under
[CC BY 4.0](LICENSE-DATA.md): use them for anything, as long as you credit
Austin Ho and link the source. Characters,
animations and dungeon pieces are KayKit packs by Kay Lousberg (CC0). The idea
of a careful, readable game-based eval owes a lot to Dwarkesh Patel's
[Clocktower Bench](https://www.dwarkesh.com/p/clocktower). Full credits are in
[THIRD_PARTY.md](THIRD_PARTY.md).

MythicBench is an independent project, not affiliated with or endorsed by
Blizzard Entertainment. World of Warcraft and Mythic+ are trademarks of
Blizzard Entertainment, Inc.
