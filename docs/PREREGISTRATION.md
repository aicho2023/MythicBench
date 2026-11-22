# MythicBench v1: pre-registration

Written before the official run, and frozen with the code that plays it
(git tag `v1.0.0`). Everything below is fixed: the models, the seeds, the
metrics, the analysis and the stopping rules. Anything decided after seeing
official data is reported as exploratory, and labelled as such.

## The question

Can a team of AI agents learn a dungeon it has never seen? Five copies of
one model each play one character in a five-person party. They go in blind,
and between pulls they read a combat log, talk it over and each write their
own notes. Nothing tells them what to learn.

Primary question: **how well does each model's party do on +10 over up to
five pulls?** (the MythicBench score).

Secondary questions:

1. **Do the notes help?** Is the score with memory on higher than with memory
   off, on the same seeds (the learning effect)?
2. **What does a score cost?** Dollars per group, at list prices, thinking
   included, and how score moves with reasoning effort.
3. **How often does each model clear, and after how many pulls?**

## What is played

The protocol file is `protocol/v1.json`.

| | |
| --- | --- |
| Dungeon | The Hollow Vault: two trash packs, then Oruth the Unburied, on a 4:15 timer |
| Ranked tier | +10 (0.98x enemy health, 1.15x damage, Restless Graves, Marrowburst, Hollow Tyrant) |
| Knowledge | Blind: the party knows its own abilities and the affixes, nothing about the enemies |
| Groups per model | 6, each up to 5 pulls; a group ends at its first timed clear |
| Reasoning effort | medium, for every model |
| Calls | every 4 s of game time and on triggers; at most 300 calls per agent per pull; 8,000 output tokens per call |
| Seeds | pull *p* of group *g* plays seed 70000 + 100*g* + *p* (nobody tuned on these) |

Models, by exact API id: `claude-haiku-5-5`, `claude-sonnet-5-5`,
`claude-opus-5-5` (Anthropic), `gpt-6-luna`, `gpt-6.2-sol` (OpenAI).

Also played, none of them ranked:

- **Scripted commander** on the same seeds, through the agents' own interface
  with fixed rules. The line a model has to beat.
- **Memory-off controls** for Haiku and Luna: 12 groups each, paired with 12
  memory-on groups on the same seeds. Same play, but no talk and no notes
  between pulls.
- **Normal** (sanity check): Haiku, Luna and the commander, 3 groups each.
- **Effort sweeps**: Haiku and Luna at low and high effort, 3 groups each.

Code versions: harness 1.0.0 (1.0.0-rc.1 until the review is done), sim 0.6.0, content 1.6.0. Every replay records
them, and the campaign refuses to mix results from different versions.

## Metrics

All are computed from the replays' event logs by `sim/mythicsim/metrics.py`
and `campaign.py`.

- **Pull score** (0 to 100). A timed clear (Oruth and both packs dead within
  the timer, revive penalties included) scores 70 plus up to 30 for speed:
  the full 30 with a quarter of the timer left. Otherwise it scores 70 times
  the share of the dungeon done (each pack 15%, Oruth 70% by health removed).
- **Group score**: the mean of its five pull scores. After a clear, the clear's
  score counts for every pull the group didn't need, so clearing sooner scores
  higher.
- **MythicBench score**: a model's mean group score on +10, with a 95%
  Student-t interval across its groups.
- **Learning effect**: the mean paired difference, memory on minus memory
  off, across the 12 matched groups, with a 95% Student-t interval.
- **Clear rate** (share of groups with a timed clear), **pulls to clear**, and
  **cost per group** (list prices at the time of the run, thinking included).

## Analysis, fixed in advance

- Every model is ranked on the same six groups (0 to 5, the same seeds).
  Haiku's and Luna's extra memory-on groups (6 to 11) only feed the learning
  effect. A model whose six groups aren't all finished is shown, not ranked.
- Models are ranked by MythicBench score. Where two models' 95% intervals
  overlap, we don't claim an order between them.
- A learning effect is claimed only if its 95% interval excludes zero.
- Every finished group counts. A group is finished when it has pulls 1..*n*
  with no gaps, ending at its first timed clear or at pull 5. Bad replies,
  refusals and dropped entries count against the model, and are reported.
- A group stopped by infrastructure (an API outage, a crash) is replayed from
  its recorded replies and continued; recorded calls are never asked again.
  If a provider fails a whole group repeatedly, that cell is reported short,
  with the reason.
- Nothing is excluded for scoring badly.

## Running it in two stages

1. **Stage 1**: each model and configuration plays its first group
   (`campaign protocol/v1.json --first 1`, worst case about $92). Then we
   stop and read replays, looking only for **harness faults**: the game or the
   harness doing something other than what the rules say (a crash, an order
   applied wrongly, a prompt bug). Scores are not looked at to decide anything.
2. If there's no fault, **stage 2** plays the rest under the same protocol and
   code (`campaign protocol/v1.json`). Stage 1's groups count.
3. If there is a fault, it's fixed, the version goes up, stage 1 is reported as
   a pilot and not counted, and both stages run again on the new version.

## Budget

The worst case is about $551 (every group playing all five pulls). The
campaign stops cleanly at the project cap (`MYTHICBENCH_TOTAL_BUDGET_USD`);
whatever finished by then is reported, with what didn't.

## What gets published

The leaderboard and every group's replays, the recorded replies, and the
agents' notes and talk. Anyone can rebuild every number offline for free
(`campaign protocol/v1.json --verify`). Results are reported whatever they
show, including a learning effect of zero.

## Known limitations

One dungeon and one boss. Six groups per model separate clear gaps, not small
ones. Orders come every few seconds of game time, not every global cooldown,
and the game waits for the agents. List prices change.
