#!/usr/bin/env bash
# Run a stage of the official protocol in a cloud session (or anywhere), and
# keep its results safe on a git branch while it plays.
#
#   scripts/cloud_stage.sh test            # free: the mock sample protocol, then holds
#                                          #   for --hold minutes to prove a long job survives
#   scripts/cloud_stage.sh 1               # stage 1 of protocol v1 (paid; each cell's first group)
#   scripts/cloud_stage.sh 2               # stage 2 (paid; the rest)
#
# Options: --protocol NAME (v1; v1-restart after a stage-1 fault), --budget USD (100),
#          --cells N (8 groups at once), --hold MIN (test only, 40), --every MIN (checkpoint, 10).
#
# What it does:
#   1. Checks before spending: Python >= 3.10, a clean checkout, the API keys and the
#      project cap set, both APIs reachable (an unauthenticated request, which costs
#      nothing), and the dry run.
#   2. Restores runs/ from the data branch if one exists, so a stopped run resumes
#      (recorded replies are never asked, or paid for, again).
#   3. Plays the stage. Every --every minutes, and at the end, it packs runs/ (replays,
#      recordings, the spend ledger) into runs.tar.gz on the branch run-data/<protocol>
#      (run-data/cloud-test for the test) and pushes it.
#   4. Prints a summary without scores (stage 1 is read for harness faults only).
#
# Keys are read from the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY); nothing
# here prints them. See docs/CLOUD_RUN.md for setting up the cloud environment.

set -euo pipefail

MODE="${1:-}"
shift || true
PROTOCOL="v1"
BUDGET="100"
CELLS="8"
HOLD="40"
EVERY="10"
while [ $# -gt 0 ]; do
  case "$1" in
    --protocol) PROTOCOL="$2"; shift 2 ;;
    --budget) BUDGET="$2"; shift 2 ;;
    --cells) CELLS="$2"; shift 2 ;;
    --hold) HOLD="$2"; shift 2 ;;
    --every) EVERY="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
case "$MODE" in
  test) PROTOCOL="sample"; DATA_BRANCH="run-data/cloud-test" ;;
  1|2) DATA_BRANCH="run-data/$PROTOCOL" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-python3}"
TMP="$(mktemp -d)"
WT="$TMP/data"
STOP="$TMP/stop"
START=$(date +%s)
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

# ---------------------------------------------------------------------------
# 1. Checks before anything is spent
# ---------------------------------------------------------------------------
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
  || { echo "need Python 3.10+ (found $("$PY" --version 2>&1)); set PYTHON=..." >&2; exit 1; }
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "the checkout has uncommitted changes; a paid run must play committed code" >&2; exit 1
fi
log "code: $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD) ($(git describe --tags --always))"
if [ "$MODE" != test ]; then
  for k in ANTHROPIC_API_KEY OPENAI_API_KEY MYTHICBENCH_TOTAL_BUDGET_USD; do
    [ -n "${!k:-}" ] || { echo "$k is not set in the environment" >&2; exit 1; }
  done
  for url in https://api.anthropic.com/v1/models https://api.openai.com/v1/models; do
    code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$url" || true)
    # An unauthenticated request is refused (401/403) but proves the host is reachable, for free.
    case "$code" in
      401|403|200) log "reachable: $url ($code)" ;;
      *) echo "can't reach $url (HTTP $code): add its host to the environment's allowed domains" >&2; exit 1 ;;
    esac
  done
fi

# ---------------------------------------------------------------------------
# 2. The data branch: restore from it, and checkpoint to it
# ---------------------------------------------------------------------------
remote_has_branch() { git ls-remote --exit-code --heads origin "$DATA_BRANCH" >/dev/null 2>&1; }
DATA_REF="refs/remotes/origin/$DATA_BRANCH"
fetch_data() { git fetch -q origin "+refs/heads/$DATA_BRANCH:$DATA_REF"; }

if remote_has_branch; then
  if [ -d runs ] && [ -n "$(ls -A runs 2>/dev/null | grep -v '^archive$' || true)" ]; then
    log "runs/ isn't empty here: not restoring from $DATA_BRANCH (the local runs win)"
  else
    log "restoring runs/ from $DATA_BRANCH (a resumed run plays only what's missing)"
    fetch_data
    git show "$DATA_REF:runs.tar.gz" | tar -xzf - -C "$ROOT"
  fi
fi

checkpoint() {
  [ -d runs ] || return 0
  local note="$1"
  if [ ! -d "$WT" ]; then
    git worktree add -q --detach "$WT" HEAD
    if remote_has_branch; then
      fetch_data && git -C "$WT" checkout -q -B "$DATA_BRANCH" "$DATA_REF"
    else
      git -C "$WT" checkout -q --orphan "$DATA_BRANCH"
      git -C "$WT" rm -rqf . >/dev/null 2>&1 || true
      git -C "$WT" clean -qfdx
    fi
  fi
  tar -czf "$WT/runs.tar.gz" -C "$ROOT" --exclude='runs/archive' --exclude='*.lock' runs
  printf 'MythicBench run data for protocol %s, from %s.\nUnpack at the repository root: tar -xzf runs.tar.gz\nLast checkpoint: %s (%s)\n' \
    "$PROTOCOL" "$(git rev-parse --short HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$note" > "$WT/README.txt"
  git -C "$WT" add runs.tar.gz README.txt
  local who=(-c user.name="${GIT_AUTHOR_NAME:-MythicBench run}" -c user.email="${GIT_AUTHOR_EMAIL:-run@mythicbench.invalid}")
  # One commit, amended each time, so the branch doesn't grow by a tarball per checkpoint.
  if git -C "$WT" rev-parse -q --verify HEAD >/dev/null 2>&1; then
    git -C "$WT" "${who[@]}" commit -q --amend -m "run data: $PROTOCOL ($note)" || true
  else
    git -C "$WT" "${who[@]}" commit -q -m "run data: $PROTOCOL ($note)"
  fi
  if git -C "$WT" push -q -f origin "HEAD:refs/heads/$DATA_BRANCH" 2>/dev/null \
     || git -C "$WT" push -q origin "HEAD:refs/heads/$DATA_BRANCH" 2>/dev/null; then
    log "checkpoint pushed to $DATA_BRANCH ($(du -h "$WT/runs.tar.gz" | cut -f1), $note)"
  else
    log "WARNING: checkpoint push to $DATA_BRANCH failed; the data is only on this machine for now"
  fi
}

# Periodic checkpoints in the background; stopped (between checkpoints, never in
# the middle of one) before the final checkpoint.
LOOP_PID=""
stop_loop() {
  [ -n "$LOOP_PID" ] || return 0
  touch "$STOP"
  wait "$LOOP_PID" 2>/dev/null || true
  LOOP_PID=""
}
cleanup() {
  stop_loop
  git worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
(
  while [ ! -e "$STOP" ]; do
    waited=0
    while [ ! -e "$STOP" ] && [ $waited -lt $((EVERY * 60)) ]; do sleep 5; waited=$((waited + 5)); done
    [ -e "$STOP" ] || checkpoint "periodic" || true
  done
) &
LOOP_PID=$!

# ---------------------------------------------------------------------------
# 3. Play
# ---------------------------------------------------------------------------
STATUS=0
cd "$ROOT/sim"
if [ "$MODE" = test ]; then
  log "free test: the mock sample protocol (no API calls), then holding $HOLD minutes"
  "$PY" -m mythicsim campaign "../protocol/$PROTOCOL.json" --workers 2 || STATUS=$?
else
  FIRST="--first=1"; [ "$MODE" = 1 ] || FIRST=""
  "$PY" -m mythicsim campaign "../protocol/$PROTOCOL.json" $FIRST --dry-run | tail -n 1
  log "playing protocol $PROTOCOL stage $MODE: --budget-usd $BUDGET --cells $CELLS"
  "$PY" -m mythicsim campaign "../protocol/$PROTOCOL.json" $FIRST --budget-usd "$BUDGET" \
    --cells "$CELLS" || STATUS=$?
fi
cd "$ROOT"
if [ "$MODE" = test ]; then
  checkpoint "test campaign finished (exit $STATUS)"
  while [ $(( $(date +%s) - START )) -lt $((HOLD * 60)) ]; do
    log "holding: $(( ($(date +%s) - START) / 60 )) of $HOLD minutes"
    sleep 60
  done
fi
stop_loop
checkpoint "finished (campaign exit $STATUS)"

# ---------------------------------------------------------------------------
# 4. Summary, without scores
# ---------------------------------------------------------------------------
"$PY" - "$PROTOCOL" <<'EOF'
import json, sys
from pathlib import Path
proto = sys.argv[1]
rows = []
for mf in sorted(Path("runs").glob("*/manifest.json")):
    m = json.loads(mf.read_text())
    if m.get("campaign") != proto:
        continue
    stats = [json.loads(p.read_text()) for p in mf.parent.rglob("*.stats.json")]
    tot = lambda k: sum(s.get(k) or 0 for s in stats)
    groups = sorted({it.get("episode") for it in m.get("items", [])})
    rows.append((m.get("label", "?"), m.get("tier", "?"), "on" if m.get("memory", True) else "off",
                 len(groups), len(m.get("items", [])), tot("usd"), tot("calls"), tot("refusals"),
                 tot("unusable_replies"), tot("truncated_replies"), tot("api_errors"), m.get("status")))
print(f"\n{'configuration':<40} {'tier':<7} mem groups pulls     cost  calls refus unusa trunc apierr status")
for r in rows:
    print(f"{r[0]:<40} {r[1]:<7} {r[2]:<3} {r[3]:>6} {r[4]:>5} ${r[5]:>7.2f} {r[6]:>6} {r[7]:>5} {r[8]:>5} {r[9]:>5} {r[10]:>6} {r[11]}")
print(f"\n{len(rows)} runs, ${sum(r[5] for r in rows):.2f} at list prices (scores left out on purpose)")
EOF
(cd sim && "$PY" -m mythicsim runs spend 2>/dev/null | head -n 1) || true
log "done (campaign exit $STATUS). Data: branch $DATA_BRANCH, file runs.tar.gz"
exit "$STATUS"
