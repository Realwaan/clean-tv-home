#!/bin/sh
# Build Clean TV Home (.ipk) for LG webOS Smart TVs and optionally install via ares-install.
#   tools/install-lg.sh [ares-device-name]
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE="${1:-}"
IPK="$ROOT/dist/org.cleantv.home_0.2.0_all.ipk"

node "$ROOT/tools/package-lg.mjs"

if [ -n "$DEVICE" ] && command -v ares-install >/dev/null 2>&1; then
  echo "Installing $IPK onto LG device '$DEVICE'..."
  ares-install -d "$DEVICE" "$IPK"
  if command -v ares-launch >/dev/null 2>&1; then
    ares-launch -d "$DEVICE" org.cleantv.home
  fi
else
  echo ""
  echo "Built LG webOS package: $IPK"
  echo ""
  echo "Next steps:"
  echo "  - With webOS CLI:  ares-install -d <device> \"$IPK\" && ares-launch -d <device> org.cleantv.home"
  echo "  - With GUI:        Open webOS Dev Manager and drag & drop \"$IPK\"."
fi
