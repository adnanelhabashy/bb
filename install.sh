#!/usr/bin/env bash
# Install Adnan's BB customization layer on macOS/Linux.
# Idempotent: re-running re-copies the theme and re-points the plugins.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BB_DIR="${BB_DATA_DIR:-$HOME/.bb}"

echo "== Theme: cyber-punk"
mkdir -p "$BB_DIR/theme/cyber-punk"
cp "$REPO/theme/cyber-punk/theme.css" "$BB_DIR/theme/cyber-punk/theme.css"
bb theme set cyber-punk

echo "== Plugin: adnan-mission-control"
bb plugin install "path:$REPO/plugins/adnan-mission-control"

echo "== Plugin: cyberpunk-terminal"
bb plugin install "path:$REPO/plugins/cyberpunk-terminal"

echo "== Done. Verify with: bb plugin list | grep -E 'mission-control|cyberpunk'"
