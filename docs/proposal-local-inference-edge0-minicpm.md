# Proposal: Next-Gen Local Inference: Edge0 Dynamic MoE Streaming & MiniCPM-5 Starter Runtime

> **Status**: Proposed RFC
> **Document**: `docs/proposal-local-inference-edge0-minicpm.md`
> **Target Audience**: Core Developers, Runtime Architects, Edge AI Integrators
> **Key References**: `packages/stage-ui/src/workers/web-llm/`, `packages/stage-ui/src/libs/inference/`, `apps/stage-tamagotchi/src/main/`

---

## 🧭 1. Executive Summary & Vision

Project AIRI champions private, on-device artificial intelligence. Currently, local LLM inference is achieved either through:
1. In-browser WebGPU workers running smaller quantized models via WebLLM (`packages/stage-ui/src/workers/web-llm/`).
2. RNN state-cartridge evaluation via Web-RWKV (`packages/stage-ui/src/workers/web-rwkv/`).

However, user experience faces a stark bifurcation:
* **Heavy Frontier Models (30B–70B MoE)** offer superior reasoning, roleplay fidelity, and strict JSON tool compliance, but their complete parameter weights exceed consumer RAM/VRAM budgets (requiring 24 GB+).
* **Ultralight Models (<3B)** run on consumer laptops, but frequently fail structured tool calling, hallucinate during prompt chains, and break `<|ACT:motion="..."|>` action marker syntax.

This proposal introduces a two-tier next-generation local inference architecture addressing both ends of the spectrum, governed by a strict architectural constraint:

> [!CRITICAL]
> ### Hard Architectural Boundary: Sidecar vs. Runtime Reality
> 1. **In-Browser Web Workers (WebGPU / WASM)** are the gold standard for zero-dependency execution across both Web (`apps/stage-web`) and Desktop (`apps/stage-tamagotchi`).
> 2. **Electron-Only Native Modules (C++ / Node.js N-API)** are permitted for hardware-accelerated memory-mapped IO operations that browser sandboxes forbid.
> 3. **Python Sidecars are Strictly Forbidden**: Under no circumstances will AIRI bundle or depend on a Python runtime, virtualenv, PyTorch, or conda daemon for local inference. Everything must be self-contained within WebGPU/WASM or native Electron C++/Rust bindings.

---

## 🏗️ 2. Architectural Comparison: Runtime vs. Execution Boundary

| Dimension | Tier 1: MiniCPM-5 2B (In-Browser Starter) | Tier 2: Edge0 MoE Streaming (Electron Native) |
| :--- | :--- | :--- |
| **Execution Environment** | **100% In-Browser Web Worker** (`stage-ui/workers`) | **Electron Main Process Native Addon** (N-API) |
| **Cross-Platform Scope** | Web (`stage-web`), Desktop (`stage-tamagotchi`), Mobile | Desktop-only (`apps/stage-tamagotchi`) |
| **Model Size / VRAM** | 2B dense (~5 GB unquantized, **~1.2–1.5 GB in 4-bit**) | 35B MoE (streams **~3B active weights** in **<2.9 GB RAM**) |
| **Sidecar Requirement** | **None** (Pure WebGPU / WebLLM / ONNX Runtime Web) | **None** (Native C++ / `node-llama-cpp` binding; **No Python**) |
| **Primary Role** | Instant offline starter brain; zero-setup companion | High-tier local reasoning & complex multi-tool planning |
| **Hardware Reqs** | Any WebGPU-capable browser / integrated GPU | macOS Apple Silicon (unified memory) or Windows PC with NVMe |

---

## ⚡ 3. Tier 1: MiniCPM-5 2B (Universal In-Browser Starter Brain)

### 3.1 Why MiniCPM-5 2B?
MiniCPM-5 2B (released by OpenBMB) represents a breakthrough in dense edge intelligence:
* **High Parameter Density**: Outperforms Qwen 2.5 3B/4B, Gemma 2 2B, and Llama 3.2 3B in code generation, mathematical reasoning, multi-turn roleplay, and structured instruction following.
* **Strict Tool Compliance**: Reliably outputs valid JSON tool calls without schema dropouts, essential for AIRI's `toolsResolver` and marker parser (`llm-marker-parser.ts`).
* **WebGPU Viability**: In `q4f16_1` or `q4f32_1` quantization, the model tensor occupies only **~1.2 GB to 1.5 GB**, fitting comfortably below Chromium's `maxStorageBufferBindingSize` WebGPU limits.

### 3.2 In-Browser Worker Integration
MiniCPM-5 2B integrates directly into AIRI's existing Web Worker infrastructure without external binaries:

```
[ stage-pages: Chat / Island ]
             │
             ▼ (BroadcastChannel: airi:inference:web-llm)
[ GpuResourceCoordinator ]
             │ (Single-Owner Election)
             ▼
[ packages/stage-ui/src/workers/web-llm/ ]
             │
             ├── WebLLM Engine (Apache TVM WebGPU Runtime)
             └── MiniCPM-5-2B-Instruct-q4f16_1 (CacheStorage / IndexedDB)
```

1. **Model Cache**: Cached automatically in CacheStorage via browser `fetch` chunks with progress telemetry.
2. **Multi-Window Safety**: Bound to the single-owner `BroadcastChannel` pattern in `web-llm-channel.ts` to prevent duplicate VRAM allocations across multi-window Electron setups.

---

## 🚀 4. Tier 2: Edge0 Dynamic MoE Streaming (Electron-Only Native Engine)

### 4.1 The Mechanism of Edge0
Traditional local LLM loaders require loading the entire parameter space into VRAM/RAM before generation begins. For Mixture-of-Experts (MoE) architectures, this is immensely wasteful:
* In a 35B MoE (such as Qwen 2.5 32B MoE or Ling 3.0 Tiny), only **~3 billion parameters are actively computed** per token.
* **Dynamic Expert Paging**: Edge0 holds the shared attention backbone permanently in memory and dynamically pages/streams the selected expert tensors from high-speed storage (NVMe SSD or OS disk cache) right when the router activates them.
* **INT4 Quantization + Recover-LoRA**: Weights are compressed to 4-bit for ultra-fast storage bandwidth, while a fused low-rank adapter (Recover-LoRA) recovers full 16-bit mathematical precision.

### 4.2 Rejection of Python Sidecars & Electron Implementation
Because browser sandboxes forbid low-level kernel memory mapping (`mmap`) and direct disk page streaming, Edge0 cannot operate inside a standard Web Worker.

To prevent the unacceptable operational burden of a Python sidecar (pip dependencies, PyTorch DLLs, CUDA mismatches, broken paths), AIRI implements Edge0 as an **Electron Native Addon**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         APPS/STAGE-TAMAGOTCHI (ELECTRON)                 │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │ Renderer Process (Vue 3 / stage-ui)                              │   │
│   │  • useLLM() ──► ipcRenderer.invoke('airi:inference:edge0')       │   │
│   └────────────────────────────────┬─────────────────────────────────┘   │
│                                    │ Electron IPC / Eventa               │
│   ┌────────────────────────────────▼─────────────────────────────────┐   │
│   │ Main Process Service (services/airi/inference/edge0-host.ts)     │   │
│   │  • Worker Thread Pool (Native C++ N-API / Rust Binding)          │   │
│   │  • Zero Python / Zero PyTorch / Embedded Native Binary           │   │
│   │  • Memory-Mapped Model File (Qwen-32B-MoE-INT4-Edge0.bin)        │   │
│   │                                                                  │   │
│   │       [ Kernel mmap() ] ──► [ Dynamic Expert Paging ]            │   │
│   │                                      │                           │   │
│   │                                      ▼                           │   │
│   │                          [ Active VRAM: < 2.9 GB ]               │   │
│   └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

1. **Native N-API Binding**: Wrapped as a pre-compiled Node native addon (`.node`) distributed via `@proj-airi/edge0-binding` per platform architecture (`win32-x64`, `darwin-arm64`, `linux-x64`).
2. **Unified Memory on Apple Silicon**: On macOS, utilizes native Metal unified buffer mapping, achieving near-zero transfer overhead between disk cache and GPU.
3. **Graceful Fallback**: If running on Web (`apps/stage-web`), Edge0 is masked from the UI, and the runtime cleanly defaults to Tier 1 (MiniCPM-5 2B WebGPU).

---

## 📊 5. Resource Consumption & Benchmark Profile

| Engine | Execution Host | Disk Size | Runtime Memory | Output Velocity | Tool Reliability |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MiniCPM-5 2B** | In-Browser Web Worker | ~1.3 GB | ~1.5 GB VRAM | ~35–45 tok/s | 96% Valid Schema |
| **Edge0 (Ling 8B MoE)** | Electron Native Addon | ~4.8 GB | ~1.0 GB RAM | ~40–55 tok/s | 98% Valid Schema |
| **Edge0 (Qwen 32B MoE)** | Electron Native Addon | ~18 GB | ~2.9 GB RAM | ~22–32 tok/s | 99.5% Frontier Grade |

---

## 📅 6. Implementation Roadmap

- [ ] **Phase 1: MiniCPM-5 2B in WebLLM**:
  - Add MiniCPM-5 model record into `packages/stage-ui/src/workers/web-llm/models.ts`.
  - Verify WebGPU tensor compilation and shader compatibility in Chrome/Electron.
  - Test tool-calling schema output with `packages/stage-ui/src/composables/llm-marker-parser.ts`.
- [ ] **Phase 2: Edge0 Native Specification & Node N-API Spike**:
  - Create native Node binding spike in `apps/stage-tamagotchi/src/main/services/airi/inference/`.
  - Validate zero-Python C++ dynamic expert paging on macOS Metal and Windows DirectX/Vulkan.
  - Implement IPC channel `airi:inference:edge0` with token streaming over `@moeru/eventa`.
- [ ] **Phase 3: Settings & Coordinator Wiring**:
  - Expose both engines under `Settings > Providers > Chat > Local Inference`.
  - Connect memory footprint telemetry to `GpuResourceCoordinator`.
