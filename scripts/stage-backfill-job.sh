#!/usr/bin/env bash
# Sync the scheduled backfill job's staging copy from this repo.
#
# The launchd job cannot run from ~/Desktop (macOS TCC blocks it), so it runs
# from ~/Library/Application Support/deal-finder. Run this after changing
# db/ingest-land-comps.mjs or rotating DATABASE_URL.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$HOME/Library/Application Support/deal-finder"

mkdir -p "$STAGE/data" "$STAGE/node_modules"
cp "$REPO/db/ingest-land-comps.mjs" "$STAGE/"
cp "$REPO/db/data/rmi_yeshuvim.json" "$STAGE/data/"
rm -rf "$STAGE/node_modules/postgres"
cp -R "$REPO/node_modules/postgres" "$STAGE/node_modules/"
cp "$REPO/.env.local" "$STAGE/.env.local"
chmod 600 "$STAGE/.env.local"
cp "$REPO/scripts/retry-backfill-staged.sh" "$STAGE/retry-backfill.sh"
chmod +x "$STAGE/retry-backfill.sh"

echo "staged → $STAGE"
echo "reload the schedule with:"
echo "  launchctl bootout gui/\$(id -u)/com.dealfinder.backfill 2>/dev/null; \\"
echo "  launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.dealfinder.backfill.plist"
