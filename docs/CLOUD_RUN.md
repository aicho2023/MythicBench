# Running a stage in the cloud

A stage can run in a Claude Code cloud session instead of on your computer:
it keeps going with your laptop closed, and you can follow it from the Claude
mobile app. `scripts/cloud_stage.sh` does the run and keeps the results safe
on a git branch while it plays.

## One-time setup (claude.ai/code, about 5 minutes)

1. **API keys.** Make a new key at each provider just for this, with a spend
   limit at the provider (about $200 covers stage 1 with room to spare). The
   keys go in the environment's variables, which anyone using that
   environment can read, so don't reuse your everyday keys.
2. **A cloud environment for MythicBench** (Edit cloud environment):
   - Network access: **Limited**, and add to Allowed domains:
     `api.anthropic.com` and `api.openai.com`.
   - Environment variables:
     ```
     MYTHICBENCH_ANTHROPIC_API_KEY=...
     OPENAI_API_KEY=...
     MYTHICBENCH_TOTAL_BUDGET_USD=150
     BASH_DEFAULT_TIMEOUT_MS=14400000
     BASH_MAX_TIMEOUT_MS=14400000
     ```
     The Anthropic key goes in as `MYTHICBENCH_ANTHROPIC_API_KEY`, not
     `ANTHROPIC_API_KEY`: a cloud environment reserves that name (sessions
     sign in through your account) and doesn't pass it to commands. The
     script hands the key to the run under the name it expects.
     The last two let a command run for up to 4 hours (by default a
     background command is stopped about 30 minutes after it starts).
     `MYTHICBENCH_TOTAL_BUDGET_USD` caps what the cloud runs spend in total:
     the cloud copy only knows its own spending (restored from the data
     branch), not your computer's. Raise it before stage 2.

## Free checks first

In a cloud session on `main` in that environment, ask:

> Run `bash scripts/cloud_stage.sh check` and show me what it prints.

It checks Python, the checkout, the keys, the cap and the timeouts, makes a
free request with each key (listing models costs nothing) to prove it works
from inside the session, prints the stage 1 dry run, and stops. The dry run's
cost estimate reads higher in the cloud (about $163 rather than about $92):
the cloud copy has no spending history, so it estimates from cautious
defaults. The real cost is the same.

## A free long-run test

Start a cloud session on `main` in that environment and ask:

> Run `bash scripts/cloud_stage.sh test --hold 40` in the background, and tell
> me when it finishes.

It plays the free mock sample (no API calls), then waits 40 minutes,
pushing a checkpoint to the branch `run-data/cloud-test` every 10 minutes. If
it finishes and the branch shows a final checkpoint, long runs survive in that
environment.

## Stage 1

In a new cloud session on `main`, same environment:

> Run `bash scripts/cloud_stage.sh 1` in the background. When it finishes,
> show me the summary it prints.

Before spending anything it runs the same checks as `check`. Then it plays
stage 1 (`campaign protocol/v1.json --first 1 --budget-usd 120 --cells 8`,
about 2 to 2.5 hours), pushing `runs.tar.gz` (replays, recorded replies, the spend
ledger) to the branch `run-data/v1` every 10 minutes and at the end. The
summary it prints has the groups, pulls, cost and reply problems, but no
scores: stage 1 is read for harness faults only.

Follow it from the session in the Claude app. Options: `--budget`,
`--cells`, `--every` (minutes between checkpoints).

## If the session stops part-way

Start a new session and run the same command. It restores `runs/` from
`run-data/v1` and plays only what's missing: recorded replies are never asked
for (or paid for) again. What played since the last checkpoint (at most about
10 minutes) is lost and is played again.

## Afterwards, on your computer

The results come back from the branch:

```bash
git fetch origin run-data/v1
mkdir -p /tmp/stage1 && git show origin/run-data/v1:runs.tar.gz | tar -xzf - -C /tmp/stage1
```

Then move the runs into `runs/`, and append the cloud's spend ledger
(`/tmp/stage1/runs/spend.jsonl`) to `runs/spend.jsonl`, so the project cap
here counts the cloud's spending too. Stage 2 runs the same way:
`bash scripts/cloud_stage.sh 2`, after raising `MYTHICBENCH_TOTAL_BUDGET_USD`
in the environment.

If stage 1 finds a harness fault, the restart is
`bash scripts/cloud_stage.sh 1 --protocol v1-restart` (after the fix and a
version bump), on its own data branch.
