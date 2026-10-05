---
name: airi-rwkv-webgpu-engine
description: >-
  Build, load, and debug RWKV-7 G1 RNN models on WebGPU via @cryscan/web-rwkv-wasm.
  Covers the offline .prefab CBOR quantization pipeline, OPFS single-slot caching,
  streaming session lifecycle, cleanroom test harnesses, and Hugging Face distribution.
---

# AIRI RWKV-7 WebGPU Engine & Prefab Pipeline

This domain skill governs the integration, execution, and model lifecycle of RWKV recurrent neural networks (specifically RWKV-7 "Goose" G1) running locally in the browser and Electron desktop via WebGPU.

## 1. Overview & Architecture

Unlike Transformer architectures that require quadratic attention mechanisms, KV-caching, and variable memory allocation, RWKV-7 functions as an RNN with constant memory consumption per batch (`O(1)` memory complexity during generation).

AIRI supports RWKV models across two primary surfaces:
1. **Local Chat LLM**: Web-RWKV Chat Provider (`packages/stage-pages/src/pages/settings/providers/chat/web-rwkv.vue` & `packages/stage-ui/src/stores/providers/web-rwkv/index.ts`).
2. **Autonomous Salience Gating**: Ultra-fast, constant-time System-1 evaluation and classification (`scripts/tests/rwkv-harness/`).

### Canonical Model Catalog

| Model | Parameters | Layers | DL Size (Raw) | Int8 Prefab | NF4 Prefab | Sweet Spot / Usage |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **0.1B** | 0.1B | 12 | 382 MB | — | — | Nano fallback, lightweight classification |
| **0.4B** | 0.4B | 24 | 902 MB | 581 MB | 437 MB | Mobile (`stage-pocket`), integrated GPUs |
| **1.5B** | 1.5B | 24 | 3.06 GB | 1.88 GB | 1.28 GB | Recommended balance: roleplay, natural dialogue |
| **2.9B** | 2.9B | 32 | 5.90 GB | ~3.7 GB | ~2.5 GB | High capacity, deep multi-step reasoning |

---

## 2. Key Code Paths

### Runtime & Execution
- `packages/stage-ui/src/workers/web-rwkv/worker.ts` — Web Worker host running `@cryscan/web-rwkv-wasm`. Handles Range streaming, OPFS caching, and `Session.from_prefab` instant boot.
- `packages/stage-ui/src/workers/web-rwkv/cache.ts` — Single-slot OPFS disk cache manager. Stores `.prefabcache` or `.f16cache` and evicts older checkpoints automatically.
- `packages/stage-ui/src/libs/inference/adapters/web-rwkv.ts` — UI adapter bridging stores to the worker; resolves Hugging Face `.prefab` endpoints and calculates VRAM budgets.
- `packages/stage-ui/src/libs/inference/constants.ts` — Catalog definitions (`WEB_RWKV_MODELS`, `quantUrls`).
- `packages/stage-pages/src/pages/settings/providers/chat/web-rwkv.vue` — Provider settings UI page.

### Cleanroom Harness & Maintenance Tools
- `scripts/tests/rwkv-harness/` — Experimental cleanroom harness and Puppeteer browser test suite.
- `scripts/tests/rwkv-harness/tools/convert_safetensors.py` — Zero-PyTorch NumPy converter mapping Hugging Face safetensors to web-rwkv F16 tensor layout.
- `scripts/tests/rwkv-harness/tools/bake-prefab.sh` — Offline CLI script automating Int8 and NF4 CBOR prefab compilation.
- `scripts/tests/rwkv-harness/tools/verify-prefab.mjs` — Browser-in-the-loop WebGPU validation script checking token fluency and `<think>` reasoning.

---

## 3. The Prefab Serialization Contract

### The "Broken Kernel" Pitfall (`from_reader` vs `from_prefab`)
In `@cryscan/web-rwkv-wasm@0.10.20`:
- **`Session.from_reader()` (Broken for Quantization)**: Downloads raw 3 GB+ FP16 weights and executes compute shaders (`quantize_mat_int8.wgsl`, `quantize_mat_nf4.wgsl`) on the browser GPU to quantize matrices in-memory. In browser WebGPU runtimes, workgroup/buffer synchronization race conditions corrupt weights, outputting token salad.
- **`Session.from_prefab()` (Authoritative & Production-Ready)**: Loads pre-quantized offline CBOR binaries. It completely bypasses browser compute shaders, loads into GPU buffers in **~5.8s**, saves **38%–58% download bandwidth**, and produces **100% coherent English with native `<think>` blocks**.

### Model Distribution
Pre-quantized `.prefab` binaries for AIRI are hosted on Hugging Face:
- Repository: [`dasilva333/rwkv7-g1-webgpu-prefabs`](https://huggingface.co/dasilva333/rwkv7-g1-webgpu-prefabs)
- Base weights: [`DanielClough/rwkv7-g1-safetensors`](https://huggingface.co/DanielClough/rwkv7-g1-safetensors)

---

## 4. Maintenance & Offline Baking SOP

When updating or adding a new RWKV model checkpoint:

### Step 1: Download SafeTensors
Ensure at least 12 GB of free disk space is available before processing large (>1.5B) models.
```bash
curl -L -o /tmp/rwkv-model.safetensors "<huggingface-safetensors-url>"
```

### Step 2: Run the Bake Tool
Use the automated harness tool to convert and serialize:
```bash
./scripts/tests/rwkv-harness/tools/bake-prefab.sh /tmp/rwkv-model.safetensors /tmp/dist 24
```
This produces:
- `/tmp/dist/rwkv-model-int8.prefab`
- `/tmp/dist/rwkv-model-nf4.prefab`

### Step 3: Run Cleanroom Verification
Run browser WebGPU verification before publishing:
```bash
node scripts/tests/rwkv-harness/tools/verify-prefab.mjs /tmp/dist/rwkv-model-nf4.prefab
```

### Step 4: Publish to Hugging Face
Upload the verified binaries to your Hugging Face model repository:
```bash
hf upload dasilva333/rwkv7-g1-webgpu-prefabs /tmp/dist/rwkv-model-nf4.prefab rwkv-model-nf4.prefab
hf upload dasilva333/rwkv7-g1-webgpu-prefabs /tmp/dist/rwkv-model-int8.prefab rwkv-model-int8.prefab
```

### Step 5: Wire Catalog in Codebase
Update `WEB_RWKV_MODELS` in `packages/stage-ui/src/libs/inference/constants.ts` with the new `quantUrls`.

---

## 5. Verification Workflows

- **Typecheck UI**: `pnpm -F @proj-airi/stage-ui typecheck`
- **Typecheck Pages**: `pnpm -F @proj-airi/stage-pages typecheck`
- **Run Inference Suite**: `pnpm -F @proj-airi/stage-ui test run src/libs/inference/`
- **Audit Test Catalog**: `node scripts/audit-test-catalog.mjs`

### Authoritative Architecture Documents
- [`docs/design-web-rwkv-quantization-architecture.md`](../../docs/design-web-rwkv-quantization-architecture.md) — Comprehensive empirical cleanroom matrix, WGSL kernel analysis, and prefab distribution design.
- [`docs/project-rwkv-cleanroom-harness-plan.md`](../../docs/project-rwkv-cleanroom-harness-plan.md) — Phase 0–8 empirical test records.
- [`docs/rosetta-stone.md`](../../docs/rosetta-stone.md) — Subsystem reference §6 and failure modes §16.
