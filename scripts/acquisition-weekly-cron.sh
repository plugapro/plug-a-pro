#!/bin/bash
# Weekly acquisition review — launchd entrypoint.
#
# Runs the snapshot, then hands it to a headless Claude session to compare
# against the previous week and log the delta to OpenBrain.
#
# Activated by ~/Library/LaunchAgents/za.co.plugapro.acquisition-weekly.plist
# Logs to docs/marketing/acquisition-weekly/.
set -uo pipefail

REPO="/Users/shimane/Projects/Plug A Pro"
# launchd gets a bare PATH with no nvm, so pin the interpreter explicitly.
# If you upgrade node via nvm, update this path.
NODE="/Users/shimane/.nvm/versions/node/v24.13.0/bin/node"
OUT_DIR="$REPO/docs/marketing/acquisition-weekly"
RUN_LOG="$OUT_DIR/.cron.log"

mkdir -p "$OUT_DIR"

# Snapshot window ends yesterday, so name the file for that day.
WEEK_END=$(date -v-1d +%Y-%m-%d)
SNAPSHOT="$OUT_DIR/$WEEK_END.md"

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') starting weekly acquisition snapshot ==="
} >> "$RUN_LOG"

cd "$REPO" || exit 1

if ! "$NODE" scripts/acquisition-weekly-snapshot.mjs > "$SNAPSHOT" 2>> "$RUN_LOG"; then
  echo "snapshot FAILED — see errors above" >> "$RUN_LOG"
  exit 1
fi

echo "snapshot written: $SNAPSHOT" >> "$RUN_LOG"

# Previous snapshot, if any, so Claude can report the week-over-week delta
# rather than just restating this week's numbers.
PREV=$(ls -1 "$OUT_DIR"/*.md 2>/dev/null | grep -v "$WEEK_END" | tail -1)

PROMPT="You are running the weekly Plug A Pro acquisition review, unattended.

This week's snapshot is at: $SNAPSHOT
Previous snapshot: ${PREV:-none — this is the first week}

Do this:
1. Read both snapshots.
2. Compute the week-over-week delta on: spend, drafts started, applications
   submitted, approved, MATCHABLE, job requests, and cost-per-matchable.
3. Call out any warning lines in the snapshot (budget concentration, missing
   EMPLOYMENT category, approved-but-unmatchable count) and whether each got
   better or worse.
4. Judge against the five standing priorities from the 2026-07-28 baseline:
   GA4 key events, matchability/autosync regression, evidence-step leak,
   review-screen submit leak, EMPLOYMENT campaign swap. State which are still open.
5. Log the result to OpenBrain via knowledge_log, project PlugAPro, domain
   marketing, title 'review — weekly acquisition snapshot ($WEEK_END)',
   tags including domain:marketing, acquisition, weekly-tracking.

Be concrete and numeric. Do not make code or ad-account changes — this is a
read-and-report run only."

/usr/local/bin/claude -p "$PROMPT" >> "$RUN_LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') finished (exit $?) ===" >> "$RUN_LOG"
