#!/usr/bin/env bash
# ==============================================================================
# bake-prefab.sh - Offline RWKV-7 G1 Prefab Baking Tool for WebGPU
# ==============================================================================
# Usage:
#   ./bake-prefab.sh <input.safetensors> <output_dir> <layers>
#
# Examples:
#   ./bake-prefab.sh rwkv-0.4b.safetensors ./dist 24
#   ./bake-prefab.sh rwkv-1.5b.safetensors ./dist 24
#   ./bake-prefab.sh rwkv-2.9b.safetensors ./dist 32
# ==============================================================================

set -euo pipefail

INPUT_FILE="${1:-}"
OUTPUT_DIR="${2:-./dist}"
LAYERS="${3:-24}"

if [[ -z "$INPUT_FILE" || ! -f "$INPUT_FILE" ]]; then
  echo "Error: Input SafeTensors file not found."
  echo "Usage: $0 <input.safetensors> <output_dir> [layers=24]"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
BASE_NAME=$(basename "$INPUT_FILE" .safetensors)
CONV_ST="/tmp/${BASE_NAME}-conv.st"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONVERTER="${SCRIPT_DIR}/convert_safetensors.py"

echo "=== [1/3] Converting SafeTensors to web-rwkv F16 layout ==="
python3 "$CONVERTER" "$INPUT_FILE" "$CONV_ST"

echo "=== [2/3] Baking Int8 Prefab (${LAYERS} layers) ==="
INT8_OUT="${OUTPUT_DIR}/${BASE_NAME}-int8.prefab"
cargo run --release --manifest-path "${SCRIPT_DIR}/../Cargo.toml" --example serde -- \
  -a -m "$CONV_ST" --quant="$LAYERS" -o "$INT8_OUT"

echo "=== [3/3] Baking NF4 Prefab (${LAYERS} layers) ==="
NF4_OUT="${OUTPUT_DIR}/${BASE_NAME}-nf4.prefab"
cargo run --release --manifest-path "${SCRIPT_DIR}/../Cargo.toml" --example serde -- \
  -a -m "$CONV_ST" --quant-nf4="$LAYERS" -o "$NF4_OUT"

# Cleanup intermediate converted file
rm -f "$CONV_ST"

echo "=== Baking Complete! ==="
echo "Int8: $INT8_OUT ($(du -h "$INT8_OUT" | cut -f1))"
echo "NF4:  $NF4_OUT ($(du -h "$NF4_OUT" | cut -f1))"
