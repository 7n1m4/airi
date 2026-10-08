# RWKV-7 Model Storage & Cache Policy

This document defines the canonical storage conventions for RWKV neural network weights and prevents duplicate multi-gigabyte files across the AIRI repository.

---

## 1. Single Authoritative Cache Location

All raw model weights (`.safetensors`, `.st`, converted `.f16`, and temporary baking intermediates) MUST be stored strictly in:

```text
scripts/tests/rwkv-harness/.cache/
```

### Active Model Weights
- `rwkv7-g1d-1.5b-20260212-ctx8192.safetensors` (~2.8 GB)
- Any future 0.1B, 0.4B, or 2.9B Hugging Face checkpoints for the harness.

---

## 2. Strictly Prohibited Locations

To avoid polluting working trees or accidentally consuming multiple gigabytes of disk space:

1. **NEVER save model weights to repository root `.cache/` (`airi_dasilva333/.cache/`)**:
   - The repository root `.cache/` is strictly for lightweight engine runtime caches (e.g., Live2D motion files, VRM avatars).
   - Storing model weights at the repository root leads to duplicate downloads and disk bloat.
2. **NEVER commit weights or save them inside `packages/` or `apps/`**:
   - The desktop/web runtime never consumes raw `.safetensors`. WebGPU executes baked `.prefab` (CBOR) binaries served over network/OPFS.

---

## 3. Harness Pipeline & Tool Usage

When invoking the offline conversion and baking pipeline, always resolve inputs from `scripts/tests/rwkv-harness/.cache/`:

```bash
cd scripts/tests/rwkv-harness

# 1. Ensure model exists in local harness cache
ls -lh .cache/rwkv7-g1d-1.5b-20260212-ctx8192.safetensors

# 2. Convert and bake prefabs (Int8 / NF4)
./tools/bake-prefab.sh .cache/rwkv7-g1d-1.5b-20260212-ctx8192.safetensors ./dist 24
```

---

## 4. Storage Hygiene & Remote Archiving

- If local laptop storage is constrained, model weights can be safely archived to the Windows GPU host (`10.0.0.91` under `E:\projects_backup\airi_rwkv\`).
- If purging cache files, verify before running that only `scripts/tests/rwkv-harness/.cache/` contains the authoritative local copy.
