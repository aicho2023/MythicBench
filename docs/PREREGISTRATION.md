# MythicBench v1: pre-registration

Written before the official run, and frozen with the code that plays it
(git tag `v1.0.0`). Everything below is fixed: the models, the seeds, the
metrics, the analysis and the stopping rules. Anything decided after seeing
official data is reported as exploratory, and labelled as such.

**Amendment 1 (2026-11-22, before any official data; git tag `v1.0.1`).**
After an outside review, and before stage 1 played a single call: the
analysis below was tightened (model-against-model claims need same-seed
paired differences; exact intervals for clear rates; the learning question
says what the control can and can't separate), the restart on reserve seeds
became a pinned protocol of its own, and the limitations section says how
the difficulty was calibrated. Nothing that plays changed: the harness is
still 1.0.0, the sim 0.11.0, the content 1.8.0, and the seeds are the same.
`v1.0.1` differs from `v1.0.0` only in documentation and in the analysis
code that builds and checks the results.

**Amendment 2 (2026-11-23, after stage 1's fault review, before stage 2).**
The review found one harness fault (described under "Running it in two
stages"). The pre-registered rule says a fault is fixed and the protocol
restarts on the reserve seeds. We are knowingly departing from that rule for
this fault: it was judged immaterial, it is deliberately not fixed, and stage 2
plays the same frozen code as stage 1, so every v1 group plays one code. Every
occurrence in the final data is counted and reported, by the rule stated
there. Nothing else changes.

## The question

Can a team of AI agents learn a dungeon it has never seen? Five copies of
one model each play one character in a five-person party. They go in blind,
and between pulls they read a combat log, talk it over and each write their
own notes. Nothing tells them what to learn.

Primary question: **how well does each model's party do on +10 over up to
five pulls?** (the MythicBench score).

Secondary questions:

1. **Does carrying information across wipes help?** Is the score with memory
   on higher than with memory off, on the same seeds (the learning effect)?
   Memory on is a whole pipeline: a factual debrief, the party's talk, each
   agent's private notes, and the extra calls they take. The control removes
   all of it, so the effect is the pipeline's, not any one part's.
2. **What does a score cost?** Dollars per group, at list prices, thinking
   included, and how score moves with reasoning effort.
3. **How often does each model clear, and after how many pulls?**

## What is played

The protocol file is `protocol/v1.json`.

| | |
| --- | --- |
| Dungeon | The Hollow Vault: two trash packs, then Oruth the Unburied, on a 4:15 timer |
| Ranked tier | +10 (0.98x enemy health, 1.15x damage, Restless Graves, Marrowburst, Hollow Tyrant) |
| Knowledge | Blind to the mechanics and timings of Oruth and the trash casters, beyond what the disclosed affixes say: no encounter guide, no ability list, no boss timers. The party knows its own abilities, the map and its obstacles, the enemies' names, health and pack makeup, how Oruth moves, and the affixes as the game shows them (Hollow Tyrant names Oruth's summon thresholds, 80/50/25%, and Grave Mark's ~24 s cadence) |
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

Code versions: harness 1.0.0, sim 0.11.0, content 1.8.0. Every replay records
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
  off, across the 12 matched groups, with a 95% Student-t interval and a
  paired-t p-value. It measures the debrief, talk and notes together: with
  memory off there are none of them. The 12 paired differences are the
  learning result; a rising curve of scores by pull is descriptive only (a
  clear's score carries forward, which lifts later pulls on its own).
- **Model against model**: for each pair of ranked models, the paired
  difference of their group scores, group by group on the same seeds (every
  model's group *g* plays the same seeds), with a 95% Student-t interval and a
  paired-t p-value, Holm-adjusted over all the pairs.
- **Clear rate** (share of groups with a timed clear, `clears / groups`, with
  an exact Clopper-Pearson 95% interval: 0 of 6 still allows up to 46%),
  **pulls to clear**, and **cost per group**: the observed cost at list prices
  at the time of the run, thinking included, shown with the calls, tokens,
  cut-off replies and the model ids the providers report serving (the
  published `served_models.json`). Providers' "medium" efforts and an equal
  output cap don't make compute equal; cost is an end-to-end outcome.

## What the harness does for the agents

Agents give standing orders; between calls the harness carries them out the
same way for every model. That includes some movement:

- A move walks in a straight line and stops at a wall. It goes around a solid
  obstacle (the throne, the rooms' pillars) on its own, and a spot asked for
  inside one is moved just outside it. A spot taken by another body shifts to
  the nearest free one (for a melee spot, one still in reach of that enemy).
- "next" walks to the next waypoint of the route toward the boss; "safe" steps
  to the nearest spot clear of the pools known to hurt, keeping the target of
  the first attack or heal in range when it can, by a route that stays clear
  of other pools (else the nearest clear spot anyway). Every candidate is
  judged as the move would really go (a wall, a taken spot, obstacles), so it
  never stops in a pool when a clear spot is reachable. "stop" halts.
- Oruth never leaves his room; if he can't reach the player he's attacking
  from inside it, he turns on the nearest player he can reach until he can.
  The rules text tells the agents.
- Stay in reach: a melee character that has been in reach of the target of its
  first melee ability, since its last ordered move and since it picked that
  target, follows that target if it drifts up to 3 m away, in a straight step
  that never enters or crosses a pool and ends in reach. It never closes a gap
  the agent opened, never re-targets, and never goes round an obstacle. The
  rules text tells the agents.
- Interrupts in the priority list fire 0.35 s after an interruptible cast
  starts, only while there's one to stop.

Choosing targets, positioning the party, and deciding when to disengage are
the agents' own.

## Analysis, fixed in advance

- Every model is ranked on the same six groups (0 to 5, the same seeds).
  Haiku's and Luna's extra memory-on groups (6 to 11) only feed the learning
  effect. A model whose six groups aren't all finished is shown, not ranked.
- Models are listed by MythicBench score. The order is descriptive: it is
  not a claim that one model is better than another.
- One model is claimed better than another only where their same-seed paired
  difference has a Holm-adjusted p below 0.05 (over every pair of ranked
  models). Every pair's difference and interval is reported either way.
  Overlapping or separate intervals on the leaderboard decide nothing.
- A learning effect is claimed only if its 95% interval excludes zero.
- Every finished group counts. A group is finished when it has pulls 1..*n*
  with no gaps, ending at its first timed clear or at pull 5. Bad replies,
  refusals and dropped entries count against the model, and are reported per
  pull, with the number of calls, for the fight and for the talk and notes
  separately.
- How a reply is read, in every phase: the answer is the last complete JSON
  object that is either orders or `{}` (`{}` means no change). A reply cut
  off at the token limit is read the same way (any complete object in it
  counts) and is counted as cut off. A refused reply changes nothing (old
  orders and old notes stay) and is counted. Nothing in a reply can crash a
  run: huge numbers, deep nesting or garbage are an unusable reply.
- Recordings are keyed by the seed, group, pull and agent, and (from pull 2)
  by memory on or off: a memory-off group shares only pull 1 with its twin.
  They're stored per protocol and code version, so a rerun under other rules
  never replays them.
- A group stopped by infrastructure (an API outage, a crash) is replayed from
  its recorded replies and continued; recorded calls are never asked again.
  If a provider fails a whole group repeatedly, that cell is reported short,
  with the reason.
- Nothing is excluded for scoring badly.

## Running it in two stages

1. **Stage 1**: each model and configuration plays its first group
   (`campaign protocol/v1.json --first 1`, about $92 at full length). Then we
   stop and read replays, looking only for **harness faults**: the game or the
   harness doing something other than what the rules say (a crash, an order
   applied wrongly, a prompt bug). Scores are not looked at to decide anything.
2. If there's no fault, **stage 2** plays the rest under the same protocol and
   code (`campaign protocol/v1.json`). Stage 1's groups count.
3. If there is a fault, it's fixed, the version goes up, stage 1 is reported as
   a pilot and not counted, and the whole protocol runs again on the new
   version and on the reserve seeds (`restart_seed_base` 80000, set now), so
   nothing seen while inspecting stage 1 can help. The restart is its own
   pinned protocol, `protocol/v1-restart.json` (identical to v1 but for its
   name and seeds), and runs the same way, staged as well:
   `campaign protocol/v1-restart.json --first 1`, then
   `campaign protocol/v1-restart.json`. Its recordings and results are
   separate from v1's.

**Stage 1 review (2026-11-23).** Stage 1 played its 15 groups (75 pulls) on
harness 1.0.0, sim 0.11.0, content 1.8.0, and all 75 replay exactly from the
recordings. No crash, no API error, no refusal, no pull out of calls, no
prompt with broken text; Oruth always stayed in his room and never stood idle;
memory on and off behaved as specified. Unusable and cut-off replies were
model errors (pseudo tool calls, a missing bracket, replies cut off at the
output cap) and count against the model as above.

One harness fault: in one pull (Claude Haiku 5.5, Normal, group 0, pull 4, at
3:44.7) Wren walked through Oruth's throne. She stood exactly on the
throne's inflated boundary (z = -8.8, her body radius from its edge), which
floating-point arithmetic put 4e-16 m inside it. The router lets a unit walk
out of an obstacle it already overlaps, so it ignored the throne for her next
move. It can only happen to a unit standing exactly on such a boundary, saves
about a second of walking, and can't trap or harm anyone. It was judged
immaterial and is not fixed (Amendment 2).

Counting rule, fixed now: an occurrence is a `move` event whose straight path,
sampled every 0.1 m, comes within the mover's body radius minus 1 cm of any
obstacle (`content.OBSTACLES`). Every occurrence in the final dataset is listed
in the report, with the model, group, pull and time.

## Budget

The estimate is about $551 if every group plays all five pulls at each
model's average cost per pull in the pilots (an estimate, not a bound). The
spending limits are a campaign budget set at launch (`--budget-usd`) and the
project cap (`MYTHICBENCH_TOTAL_BUDGET_USD`), both finite. They're enforced
before each request: a request holds an upper bound on its cost (its input at
one token per byte plus overhead, at the dearest input rate, and the full
output cap), and the hold is written to the spend ledger before the request is
sent. Any attempt that may have been billed (a timeout, a dropped connection, a
server error, an unreadable answer) counts as spent at that bound, and a resend
needs a hold of its own; a hold left unsettled by a crash counts as spent. One
paid process runs at a time. Requests ask for each provider's standard tier
(the one priced), and a prompt past the short-context size the prices assume is never sent. The campaign stops cleanly at a limit; whatever
finished by then is reported, with what didn't.

## What gets published

The leaderboard and every scored group's replays (including the extra
memory-on groups behind the learning effect), the recorded replies, and the
agents' notes and talk. Anyone can check every number offline, for free, from
the published folder alone: `python -m mythicsim verify <folder>` rescores
every pull from its replay, checks every seed against the schedule, rebuilds
the leaderboard (with the pairwise comparisons and clear-rate intervals) and
compares it, checks which models served the calls against the recordings,
checks each cell has exactly the groups the
protocol calls for, and replays every group from the recordings, recomputing
each pull's reply counts, tokens and list-price cost from them. The v1
protocol's fingerprint is pinned in the code, so a dataset can't pass against
a different protocol under the same name. Results are
reported whatever they show, including a learning effect of zero.

## Known limitations

One dungeon and one boss: the results are about this task, not a general
ranking of models or a broad claim about AI learning. Fresh seeds give fresh
runs of one tuned task (the map, the boss and the mechanics stay the same).
Six groups per model separate clear gaps, not small ones. Orders come every
few seconds of game time, not every global cooldown, and the game waits for
the agents. List prices change.

How the difficulty was set: +10 was calibrated in pilots against GPT-6.2 Sol
(on seeds outside the official schedule), aiming for "the best models can
clear, but not reliably". Sol is also one of the ranked models. The scripted
commander is a floor, not a skilled player: it never soaks Bone Pyre and
clears 0 of 60 dev seeds on +10, so beating it is a modest bar.
