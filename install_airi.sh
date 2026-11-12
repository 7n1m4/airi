#!/bin/bash
set -euo pipefail

# AIRI Tamagotchi - Local Setup & Dependency Installer (macOS/Linux)
# Use this to prepare your environment before running start_airi.sh.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# Safeguard: prevent VS Code from forcing Electron into Node mode
unset ELECTRON_RUN_AS_NODE

# Prevent onnxruntime-node from attempting broken CUDA binary downloads on Linux
export ONNXRUNTIME_NODE_INSTALL_CUDA=skip

# On Linux, disable Electron sandbox if needed for dev environments
if [ "$(uname -s)" = "Linux" ]; then
  export ELECTRON_DISABLE_SANDBOX=1
fi

echo "========================================================"
echo " [AIRI] Installing Workspace Dependencies & Building"
echo "========================================================"

echo "[1/2] Installing project dependencies (pnpm install)..."
pnpm install

echo "[2/2] Building internal workspace packages..."
pnpm run build:packages

echo "========================================================"
echo " Installation complete!"
echo " You can now start AIRI by running:"
echo "   ./start_airi.sh"
echo "========================================================"
