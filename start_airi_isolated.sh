#!/bin/bash
set -eo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# Prevent VS Code from forcing Node mode
unset ELECTRON_RUN_AS_NODE

# Dev fallback only if the SUID sandbox fails; do not ship.
# ELECTRON_DISABLE_SANDBOX=1 is never set by default; opt in explicitly:
#   AIRI_DISABLE_ELECTRON_SANDBOX=1 ./start_airi_isolated.sh
if [ "$(uname -s)" = "Linux" ] && [ "${AIRI_DISABLE_ELECTRON_SANDBOX:-}" = "1" ]; then
  export ELECTRON_DISABLE_SANDBOX=1
fi

# Isolated User Data Directory & Origin Port
if [ -z "${AIRI_USER_DATA_DIR:-}" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    export AIRI_USER_DATA_DIR="$HOME/Library/Application Support/ai.moeru.airi.dasilva333"
  else
    export AIRI_USER_DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ai.moeru.airi.dasilva333"
  fi
fi
export APP_USER_DATA_PATH="$AIRI_USER_DATA_DIR"
mkdir -p "$AIRI_USER_DATA_DIR"

PORT_NUM="${AIRI_RENDERER_PORT:-5174}"
export AIRI_RENDERER_PORT="$PORT_NUM"

LOG_FILE="$AIRI_USER_DATA_DIR/airi-isolated.log"

echo "========================================================"
echo " Starting AIRI (dasilva333) in ISOLATED mode"
echo " User Data Dir: $AIRI_USER_DATA_DIR"
echo " Renderer Port: $AIRI_RENDERER_PORT"
echo " Log Location:  $LOG_FILE"
echo "========================================================"

# Pass any extra arguments
{
  if [ -f "apps/stage-tamagotchi/electron.vite.config.local.ts" ]; then
    pnpm -F @proj-airi/stage-tamagotchi run dev --config electron.vite.config.local.ts -- "$@"
  else
    pnpm -F @proj-airi/stage-tamagotchi run dev -- "$@"
  fi
} 2>&1 | tee "$LOG_FILE"
