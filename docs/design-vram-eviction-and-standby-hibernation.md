# AIRI VRAM Eviction & Desktop Standby Hibernation Specification

A comprehensive architectural specification for automated WebGPU memory reclamation, LRU model eviction, and multi-tier desktop standby hibernation across the AIRI application lifecycle.

---

## 1. Executive Summary & Problem Statement

AIRI is architected to run continuously as an always-on desktop companion in the system tray, docked to screen edges, or floating on the workspace.

In pursuit of complete privacy and local-first autonomy, AIRI bundles multiple local browser-side WebGPU and WASM neural inference engines:
- **Kokoro TTS** (~330 MB VRAM)
- **Kyutai Pocket-TTS** (~250 MB VRAM)
- **Local Whisper STT** (~800 MB VRAM)
- **Moondream2 VLM** (~1.6 GB VRAM)
- **Web-RWKV / WebLLM** (~2.0–4.0 GB VRAM)
- **Three.js VRM / Live2D WebGL Renderers** (~200–500 MB VRAM)

### The Idle Memory Creep Trap
While [`airi-desktop-lifecycle-power-throttling`](../.agents/skills/airi-desktop-lifecycle-power-throttling/SKILL.md) successfully halts `requestAnimationFrame` loops in `RendererStage.vue` when the screen locks or the window is minimized (eliminating CPU and GPU core utilization), **Chromium does not automatically release allocated WebGPU buffers or Web Worker memory**.

If an always-on AIRI instance has processed one voice turn and one image inspection, it retains 1.5 GB to 4.0 GB of VRAM indefinitely. When the user launches a modern game, 3D DCC tool (Blender, Unreal Engine), or video editing suite, this held VRAM causes:
1. GPU context loss and Chromium GPU process crashes (`DEVICE_LOST`).
2. Extreme system-wide framerate stuttering and VRAM swap thrashing.
3. Premature Out-Of-Memory (OOM) failures for subsequent local model loads.

---

## 2. Core Architectural Objectives

1. **Active OOM Mitigation**: When total local inference allocation approaches hardware limits, automatically evict the least-recently-used model before a fatal `GPUOutOfMemoryError` occurs.
2. **Inactivity TTL Reclamation**: Workers that have remained idle for a configurable duration (default: 15 minutes) must release their GPU buffers and transition to a cold, zero-VRAM state.
3. **Multi-Tier Desktop Hibernation**:
   - **Tier 1 (Instant Pause)**: Screen lock / window minimize immediately freezes rendering loops (`stagePaused = true`).
   - **Tier 2 (Deep Standby)**: Extended screen lock (> 10 minutes) or OS `suspend` triggers full VRAM eviction (`deepStandby = true`), unmounting background WebGPU workers.
4. **Transparent Re-hydration (< 2s)**: Models must reload on-demand from local browser cache / OPFS without requiring user intervention or network re-downloads when interaction resumes.

---

## 3. System Architecture & Component Mapping

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ELECTRON MAIN PROCESS                                 │
│  apps/stage-tamagotchi/src/main/services/electron/window.ts                │
│  - powerMonitor ('suspend', 'resume', 'lock-screen', 'unlock-screen')       │
│  - BrowserWindow ('minimize', 'restore', 'hide', 'show')                    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Eventa IPC
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       RENDERER LIFECYCLE CONTROLLER                         │
│  apps/stage-tamagotchi/src/renderer/stores/stage-window-lifecycle.ts       │
│  - Computes: stagePaused = !visible || minimized                            │
│  - Computes: deepStandby = isLocked && lockDurationMs > 10m                 │
└───────────────────┬─────────────────────────────────────┬───────────────────┘
                    │                                     │
                    ▼                                     ▼
┌──────────────────────────────────────┐  ┌───────────────────────────────────┐
│        STAGE RENDERING ENGINE        │  │      GPU RESOURCE COORDINATOR     │
│  packages/stage-ui/scenes/           │  │  packages/stage-ui/libs/inference/│
│  RendererStage.vue                   │  │  gpu-resource-coordinator.ts      │
│  - Halts 3D/2D animation loops       │  │  - Tracks allocations & LRU times │
│  - Flushes volatile textures         │  │  - Evaluates memory pressure      │
└──────────────────────────────────────┘  └─────────────────┬─────────────────┘
                                                            │
                                  ┌─────────────────────────┴─────────────────┐
                                  │ Eviction & Standby Dispatch               │
                                  ▼                                           ▼
┌─────────────────────────────────────────────────┐ ┌─────────────────────────┐
│           GPU WORKER HOST (Single-Tenant)        │ │   LOCAL WORKERS (WebGPU)│
│  packages/stage-ui/libs/inference/gpu-worker-host│ │  - Kokoro TTS          │
│  - Inactivity TTL countdown (15 min timer)      │ │  - Pocket-TTS           │
│  - Calls rpc.unload() & releases AllocationToken│ │  - Whisper STT          │
│  - Preserves load manifest for lazy re-hydration│ │  - Moondream VLM        │
└─────────────────────────────────────────────────┘ └─────────────────────────┘
```

---

## 4. Multi-Tier Eviction Triggers

### 4.1 Trigger 1: Active Memory Pressure (OOM Prevention)
Managed by `GPUResourceCoordinator` (`packages/stage-ui/src/libs/inference/gpu-resource-coordinator.ts`):

- **Safety Budget**: `budget = estimatedVRAM * 0.70` (leaves 30% headroom for OS desktop compositing, Three.js, and other applications).
- **Thresholds**:
  - `WARNING_THRESHOLD = 0.80`: Emits warning telemetry to logs and UI monitors.
  - `CRITICAL_THRESHOLD = 0.95`: Automatically triggers active eviction.
- **Eviction Protocol**:
  ```ts
  function checkPressureAndEvict(): void {
    if (budget === Number.POSITIVE_INFINITY)
      return
    const ratio = getAllocated() / budget

    if (ratio >= CRITICAL_THRESHOLD) {
      const lruModelId = getLRUModel()
      if (lruModelId) {
        debug(`[GPUCoordinator] Critical VRAM pressure (${(ratio * 100).toFixed(1)}%). Evicting LRU model: ${lruModelId}`)
        evictModel(lruModelId)
      }
    }
  }
  ```

### 4.2 Trigger 2: Inactivity Time-to-Live (TTL Expiration)
Managed by `createGpuWorkerHost` (`packages/stage-ui/src/libs/inference/gpu-worker-host.ts`):

- Every adapter execution (`runOnGpu` / `runExclusive`) resets the worker's internal inactivity timer:
  ```ts
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null
  const INACTIVITY_TTL_MS = 15 * 60 * 1000 // 15 minutes default

  function touchActivity(): void {
    if (inactivityTimer)
      clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(async () => {
      if (phase === 'ready' && !isExclusiveLocked) {
        debug(`[GpuWorkerHost:${modelId}] Inactivity TTL expired. Unloading worker to reclaim VRAM.`)
        await unloadWorker()
      }
    }, INACTIVITY_TTL_MS)
  }
  ```
- **Preserved Manifest**: When unloading due to TTL, the host retains its `lastLoadManifest` (quantization, device, model weights URI). To callers, the adapter remains in a virtual `ready-standby` state.

### 4.3 Trigger 3: Desktop Standby & Extended Lock
Managed by Electron's native `powerMonitor` and `stage-window-lifecycle.ts`:

- **Tier 1 (Instant 0s)**:
  - Event: `powerMonitor.on('lock-screen')` or window minimized.
  - Action: Sets `stagePaused = true`. `RendererStage.vue` halts `requestAnimationFrame`, VRM spring bones, and Live2D delta ticking.
  - VRAM State: Buffers remain resident; recovery latency is 0 ms.
- **Tier 2 (Extended Lock > 10m or OS `suspend`)**:
  - Event: OS enters system sleep (`suspend`) OR screen lock elapsed time exceeds 10 minutes.
  - Action: Sets `deepStandby = true`.
  - Dispatches `coordinator.evictAllInactive()`. All background inference workers (STT, TTS, VLM) execute `.unload()`, destroying their WebGPU pipeline objects and ONNX runtime contexts.
  - VRAM State: Drops from ~3 GB to < 150 MB (baseline Electron UI).

---

## 5. Transparent Re-hydration Protocol

When the user interacts with AIRI following standby or idle eviction (e.g. typing a chat prompt, clicking the microphone, or unlocking the screen):

1. **Lazy Invocation Interception**: The adapter's entry methods (`generate`, `transcribe`, `loadModel`) verify worker readiness:
   ```ts
   async function ensureLoaded(): Promise<void> {
     if (host.phase === 'ready')
       return
     if (host.lastLoadManifest) {
       updateInferenceStatus(modelId, 'loading', 'Waking model from standby...')
       await host.load(host.lastLoadManifest)
       removeInferenceStatus(modelId)
     }
   }
   ```
2. **Local Cache Hit**: The model weights already reside in the browser's Origin Private File System (OPFS) or IndexedDB model cache. No network bytes are downloaded.
3. **Sub-2s Activation**: Pipeline initialization, tensor buffer allocations, and shader compilation complete within 800ms–1800ms on modern NVMe and WebGPU drivers.
4. **Status Transparency**: A subtle status badge (`Waking model from standby...`) is dispatched through `useInferenceStatus` so the UI remains informative and responsive.

---

## 6. Implementation Milestones

| Phase | Target Area | Description |
| :--- | :--- | :--- |
| **Phase 1** | `gpu-resource-coordinator.ts` | Implement active `evictModel()` callback registry and trigger LRU eviction on `CRITICAL_THRESHOLD`. |
| **Phase 2** | `gpu-worker-host.ts` | Implement `INACTIVITY_TTL_MS` timer, `touchActivity()`, and automated clean worker unloading with manifest retention. |
| **Phase 3** | `stage-window-lifecycle.ts` | Add `deepStandby` state evaluation based on `lockDurationMs > 10m` and link to inference engine eviction dispatch. |
| **Phase 4** | Settings UI Integration | Expose standby idle timeouts (5m, 15m, 30m, Never) under *Settings > System & Hardware*. |

---

## 7. Verification & Safety Guidelines

- **Never evict during active execution**: Eviction routines must inspect `host.isExclusiveLocked` / `gpuSlot.active` and skip any worker actively generating text, audio, or tokens.
- **Single-Owner Leader Protection**: In multi-window Electron setups, eviction commands must execute strictly on the Inference Leader window (`mainWindow`) to prevent race conditions across `BroadcastChannel` subscribers.
- **WASM Fallback Safeguard**: If a model was promoted to WASM following WebGPU device loss, unloading and reloading must respect the fallback device assignment rather than attempting to re-allocate on a compromised GPU context.
