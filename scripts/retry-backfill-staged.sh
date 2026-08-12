#!/usr/bin/env bash
# Scheduled retry of the pre-2018 land-comps backfill (רמ"י closed tenders).
#
# This lives OUTSIDE ~/Desktop on purpose: macOS TCC blocks launchd-spawned
# processes from reading Desktop/Documents ("Operation not permitted"), and the
# alternative would be granting Full Disk Access to /bin/bash. Everything the
# job needs (ingest script, settlements cache, postgres driver, DATABASE_URL)
# is staged here instead, so no privacy permission is required.
#
# Source of truth for the ingest logic remains the repo:
#   ~/Desktop/Claude/deal-finder-il/db/ingest-land-comps.mjs
# Re-stage after changing it:  npm run backfill:stage
#
# Safe to run on a schedule: the ingest upserts, so partial runs resume. After
# one clean run it writes .done and every later invocation is a no-op.
set -uo pipefail

DIR="$HOME/Library/Application Support/deal-finder"
cd "$DIR" || exit 1

MARKER="$DIR/.backfill-pre2018.done"
LOG="$DIR/backfill.log"
LOCK="/tmp/deal-finder-backfill.lock"
NODE="${NODE_BIN:-/opt/homebrew/bin/node}"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG"; }

[ -f "$MARKER" ] && exit 0

# mkdir is atomic; macOS has no flock(1). Clear locks older than 6h.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +360 2>/dev/null)" ]; then
    log "clearing stale lock"
    rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

[ -f "$DIR/.env.local" ] || { log "ERROR .env.local missing in staging dir"; exit 1; }
set -a; . "$DIR/.env.local"; set +a
[ -x "$NODE" ] || { log "ERROR node not found at $NODE"; exit 1; }

log "attempt starting (--since 2005 --until 2018)"
OUT="$("$NODE" ingest-land-comps.mjs --since 2005 --until 2018 2>&1)"
OUT="$(printf '%s' "$OUT" | sed -E 's#:[^@ ]+@#:****@#g')"   # never log the DSN

INGESTED="$(printf '%s' "$OUT" | grep -c '✓ ingested' || true)"
ABORTED="$(printf '%s' "$OUT" | grep -c 'aborting' || true)"

if [ "$INGESTED" -gt 0 ] && [ "$ABORTED" -eq 0 ]; then
  printf '%s' "$OUT" | tail -3 | while IFS= read -r l; do log "  $l"; done

  # Comps changed → refresh the winning-premium signal and Deal Scores.
  # 008 is delta-based, so this is safe to run repeatedly.
  PSQL="${PSQL_BIN:-/opt/homebrew/opt/postgresql@15/bin/psql}"
  if [ -x "$PSQL" ] && [ -f "$DIR/008_premium_score_refresh.sql" ]; then
    if REFRESH="$("$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DIR/008_premium_score_refresh.sql" 2>&1)"; then
      log "  premium signal refreshed ($(printf '%s' "$REFRESH" | grep -c UPDATE) statements)"
    else
      log "  WARN premium refresh failed: $(printf '%s' "$REFRESH" | tail -1 | sed -E 's#:[^@ ]+@#:****@#g')"
    fi
  else
    log "  WARN skipped premium refresh (psql or 008 sql missing in staging dir)"
  fi

  date '+%Y-%m-%dT%H:%M:%S%z' >"$MARKER"
  log "DONE — backfill complete; this job is now a no-op."
  log "Remove the schedule: launchctl bootout gui/\$(id -u)/com.dealfinder.backfill"
else
  printf '%s' "$OUT" | tail -2 | while IFS= read -r l; do log "  $l"; done
  log "portal unavailable or run incomplete — will retry on the next schedule"
fi
