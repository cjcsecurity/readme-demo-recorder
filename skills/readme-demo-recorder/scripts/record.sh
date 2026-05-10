#!/usr/bin/env bash
# readme-demo-recorder driver wrapper.
# Ensures node_modules is symlinked next to record.mjs so ESM can resolve
# 'playwright' and 'js-yaml', then invokes the driver.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
NODE_MODULES_SRC="${READMEDEMO_NODE_MODULES:-/home/staycold66/world-leaders-part4/node_modules}"

if [ ! -e "$SCRIPT_DIR/node_modules" ]; then
  if [ ! -d "$NODE_MODULES_SRC" ]; then
    echo "error: node_modules not found at $NODE_MODULES_SRC" >&2
    echo "       set READMEDEMO_NODE_MODULES to a dir that has playwright + js-yaml installed" >&2
    exit 1
  fi
  ln -s "$NODE_MODULES_SRC" "$SCRIPT_DIR/node_modules"
fi

exec node "$SCRIPT_DIR/record.mjs" "$@"
