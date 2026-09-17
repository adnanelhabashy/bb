#!/usr/bin/env bash
# Install Adnan's BB customization layer on macOS/Linux.
# Run from a clone of the bb-setup repo.
#
# Plugins install straight from this clone's git origin (subdirectory install)
# — BB installs their npm dependencies itself, so Node.js is NOT required.
# Re-running skips already-installed plugins.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BB_DIR="${BB_DATA_DIR:-$HOME/.bb}"
ORIGIN="$(git -C "$REPO" remote get-url origin 2>/dev/null || true)"
if [ -z "$ORIGIN" ]; then
  echo "error: no git origin in $REPO — run this from a clone of the bb-setup repo" >&2
  exit 1
fi

echo "== Theme: cyber-punk"
mkdir -p "$BB_DIR/theme/cyber-punk"
cp "$REPO/theme/cyber-punk/theme.css" "$BB_DIR/theme/cyber-punk/theme.css"
bb theme set cyber-punk

for SUB in adnan/plugins/adnan-mission-control adnan/plugins/cyberpunk-terminal; do
  ID="$(basename "$SUB")"
  if bb plugin list --json | jq -e --arg id "$ID" '.plugins[] | select(.id==$id)' >/dev/null 2>&1; then
    echo "== Plugin: $ID already installed (refresh with: bb plugin update $ID)"
  else
    echo "== Plugin: $ID"
    bb plugin install "git:$ORIGIN" --subdirectory "$SUB"
  fi
done

echo "== Done. Verify with: bb plugin list"
