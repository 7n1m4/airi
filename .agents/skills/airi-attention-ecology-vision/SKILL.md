---
name: airi-attention-ecology-vision
description: >-
  Configure/debug continuous background vision: screen perception, Cascaded Salience Gate, pHash, CLIP, OCR, RWKV gating, System-1 Jev sentinels, VLM forwarding, privacy app exclusions, Vibe Island. OS sensors and heartbeat decisions use airi-proactivity-sensory-telemetry.
---

# AIRI Attention Ecology & Screen Watching Perception

This skill provides comprehensive technical guidelines, diagnostic procedures, and exact codebase paths for AIRI's ambient screen-watching architecture, Cascaded Salience Gate, on-device WebGPU inference workers, and privacy exclusion filters.

---

## 1. Architectural Overview & Pipeline

The Attention Ecology Screen Watching engine provides non-intrusive 24/7 visual and environmental awareness for AI characters without draining battery or exploding cloud API costs.

### A. The 4-Stage Cascaded Salience Gate
Instead of streaming 4K/1080p desktop frames to cloud VLMs every 2 seconds, the pipeline cascades through four low-to-high cost filters:
- **Stage 0 (aHash / pHash / Window Delta)**: Microsecond-cost perceptual hash and OS active-window comparison. If the screen is static or micro-changes (e.g. blinking cursor) occur, the frame is dropped ($0 cost, eliminates ~90%+ of ticks).
- **Stage 1 (Local WebGPU CLIP Embedding)**: Runs `Xenova/clip-vit-base-patch32` inside a Web Worker. Computes 512-dim visual embeddings and measures cosine distance against the rolling centroid of recent frames ($\Delta \text{sim}$ novelty scoring).
- **Stage 2 (Local OCR / RWKV-7 / System-1 Sentinel Gating)**:
  - *Heuristic Mode*: Local Tesseract WASM OCR checks for terminal errors or interest keywords (`interestTags`).
  - *System-1 Sentinel Mode*: Non-autoregressive discrete triage via TypeSafe Jev or local Laya ModernBERT (`useSystemOneStore`), evaluating user-configured natural language questions against the sliding visual Chrono-Log and entity anchors.
- **Stage 3 (Cloud VLM / Text Forwarder)**: High-novelty promoted events are either summarized via on-device VLM (Moondream2 / BLIP) or forwarded as structured text observations (`[REAL-TIME SCREEN OBSERVATIONS]`) to the primary character LLM.

### B. Dual Push & Pull Cognitive Mechanics
Promotions flow through two complementary pathways fed by the rolling visual observation buffer:
1. **Push Route (Real-Time Interventions)**: Gated by user interest tags or System-1 sentinel tripwires. Subject to hysteresis cooldowns, hourly budgets, and the **Busy Pipe Safeguard** (defers speech if user is typing, character is speaking, or a live call is active).
2. **Pull Route (Ambient Heartbeat)**: Ambient proactivity loops inject recent visual history (`[ Visual Stream (Last N Events) ]`) directly into the standard `[Sensor Data]` context block during periodic heartbeats, governed by `NO_REPLY` silent prompts.

---

## 2. Key Codebase Paths

### Core Loop & Runtime (Renderer)
- `packages/stage-ui/src/stores/modules/screen-watcher.ts` — `useScreenWatcherStore`. The main ambient screen-watching ticker loop. Manages `setInterval` ticks, schedule/AFK/busy-pipe gates, observation buffering, promotion rate limits (hysteresis cooldown, hourly caps), and reaction dispatch (chat orchestrator or reading-paced caption bubbles).
- `packages/stage-ui/src/stores/modules/vision/orchestrator.ts` — `useVisionOrchestratorStore`. Salience gate triage (`processCapture`), sliding Chrono-Log ring buffer, entity enrichment via `useEntityLedgerStore`, attention guard worker bridge, and System-1 sentinel dispatch.
- `packages/stage-ui/src/stores/modules/vision.ts` — `useVisionStore`. High-level vision store managing active VLM providers, prompt shims (direct vs. forward), display size caching (`getPrimaryDisplaySize`), and macOS permission wrappers (`checkPermissions`, `openPermissionSettings`).

### Native Screen Capture (Electron Main Process & IPC)
- `apps/stage-tamagotchi/src/main/services/electron/vision.ts` — Main-process `createVisionService`. Handles `visionCaptureScreen`, `visionCheckPermission`, and `visionGetPrimaryDisplaySize` Eventa handlers. Calls Electron `desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize })` and converts native bitmaps to base64 data URLs with memory telemetry probes.
- `packages/electron-screen-capture/src/main/index.ts` & `src/main/utils.ts` — Native macOS screen capture permission checking (`hasScreenCapturePermission()`) and settings prompt invocation.

### Local WebGPU / WASM Inference Workers
- `packages/stage-ui/src/workers/attention-guard/engine/vision.ts` — Stage 1 CLIP vision embedding (`Xenova/clip-vit-base-patch32`), cosine novelty scoring, and zero-shot classifier.
- `packages/stage-ui/src/libs/inference/adapters/attention-guard.ts` — Renderer-to-worker adapter that loads and manages `attention-guard.worker.ts`.
- `packages/stage-ui/src/stores/providers/moondream/index.ts` — On-device WebGPU Moondream2 VLM provider when `vlmTier === 'moondream'`.

### Configuration Schema & UI Surfaces
- `packages/stage-ui/src/stores/modules/airi-card.ts` — `ScreenWatchingConfig` interface defining card-level configuration schema (`sourceId`, `captureIntervalMs`, `downscalePercent`, `workload`, `interestTags`, `gatingMode`, `sentinelQuestions`, etc.).
- `packages/stage-pages/src/pages/settings/airi-card/components/tabs/CardCreationTabProactivity.vue` — Character card settings tab under the `screen` sub-tab (monitor picker, intervals, interest tags, System-1 sentinel questions, model provisioning progress).
- `apps/stage-tamagotchi/src/renderer/pages/devtools/vision.vue` — Vision DevTools inspection panel for testing live screen captures, pHash deltas, CLIP embeddings, and inference latency.
- `apps/stage-tamagotchi/src/renderer/pages/devtools/screen-capture.vue` — Screen capture diagnostics panel.

---

## 3. Diagnostic Console Hooks & Live Inspection

When diagnosing screen-watching behavior inside Electron or Web DevTools (`Cmd+Opt+I` or `Ctrl+Shift+I`), use the built-in diagnostic hooks exposed on `window`:

```javascript
// 1. Inspect live screen watcher state, counters, buffers, and last error
window.screenWatcherStatus()

// Expected return:
// {
//   isRunning: true,
//   isCapturing: false,
//   captureCount: 142,
//   promotionsCount: 3,
//   observationBufferCount: 0,
//   lastCaptureAt: "11:42:15 AM",
//   lastPromotionAt: "11:38:02 AM",
//   lastDecision: "PROMOTE", // or "IGNORE", "NOTE"
//   lastSummary: "Terminal displayed error in auth.ts",
//   lastLatencyMs: 118,
//   lastError: null
// }

// 2. Force an immediate manual screen capture tick
window.triggerScreenCaptureTick()
```

### Standalone CLI Terminal Observer
AIRI includes a terminal-based ASCII observer dashboard for cleanroom benchmarking without UI overhead:
```bash
pnpm test:attention:dashboard
```
This runs `scripts/tests/attention-ecology-harness/live-desktop-dashboard.ts`, capturing live frames via macOS `screencapture -x` and printing real-time 4-stage cascade telemetry in an in-place terminal dashboard.

---

## 4. Troubleshooting Matrix & Common Failure Modes

| Failure Mode | Symptoms | Root Cause & Resolution |
| :--- | :--- | :--- |
| **macOS Permission Denied** | `lastError: "Screen capture permission denied."` or black / transparent thumbnails (`dataUrl < 1000 bytes`). | Electron lacks OS permission. Open **System Settings $\rightarrow$ Privacy & Security $\rightarrow$ Screen Recording**, toggle AIRI (or Electron) on, and restart the app. Verify via `visionStore.checkPermissions()`. |
| **Character Bedtime / Schedule Gate** | Logs show: `Skipped: Outside operating schedule ... character is asleep`. | `activeConfig.respectSchedule` is active and current time is outside `activeCard.extensions.airi.heartbeats.schedule` (`start`/`end`). Either adjust the operating schedule or toggle off "Respect operating schedule" in card settings. |
| **AFK / Idle Safeguard** | Logs show: `Skipped: User is away / AFK (Xm Ys idle)`. | `pauseWhenAfk` is enabled and `proactivityStore.idleTimeSec >= afkThresholdMinutes * 60`. Move the mouse or adjust `afkThresholdMinutes` in the card editor. |
| **Busy Pipe Mutex** | Logs show: `Skipped: Busy Pipe (user or character is speaking/typing)`. | Screen watcher defers captures while TTS speech is active (`chatOrchestrator.activeSpokenText`), the LLM is generating, the user is typing, or a Live API call is active. Observation items queue in `observationBuffer` until the pipe clears. |
| **Model Download / WebGPU Stalls** | Watcher hangs on `Attention Ecology Guard is loading/downloading models, waiting for ready...`. | On first run with `workload: 'attention-guard'`, HuggingFace model weights (`Xenova/clip-vit-base-patch32`, ~300MB) or Tesseract OCR data are downloading. Check internet connectivity and browser OPFS/Cache storage. Pre-warm manually via `CardCreationTabProactivity.vue` "Download / Check Models" button. |
| **Sub-Window Deactivation** | Watcher is paused (`isRunning: false`) while DevTools is open. | `screen-watcher.ts` enforces `isPrimaryHostWindow()`. Secondary detached windows (e.g. detached settings or devtools panels with hash `#/...`) pause screen watching to prevent duplicate capture loops. Keep the main window open. |
| **Canvas / Bitmap Memory Leaks** | Main process RSS grows steadily over hours of capture. | Large bitmaps retained in GPU compositor. `vision.ts` caps capture size to 1920×1080, empties source arrays immediately after `.toDataURL()`, and decodes to raw bytes with `dataUrl = undefined` to allow GC. Always ensure temporary canvas dimensions are reset. |

---

## 5. Verification Workflows

- **Typecheck**: `pnpm -F @proj-airi/stage-ui typecheck`
- **Unit Tests**: `pnpm -F @proj-airi/stage-ui test packages/stage-ui/src/stores/modules/vision/orchestrator.test.ts`
- **DevTools Inspection**: Open `/devtools/vision` in app settings to inspect live screen capture frames, perceptual hashes, and salience scores.

---

## 6. Authoritative Design & Architecture Documents

- [docs/design-attention-ecology-screen-watching.md](docs/design-attention-ecology-screen-watching.md) — Canonical Attention Ecology & Screen Watching architecture specification (Cascaded Salience Gate, dual push/pull, test harness, and promotion discipline).
- [docs/design-vision-system-support.md](docs/design-vision-system-support.md) — Local ONNX & WebGPU vision model support (Moondream2, Waifu Diffusion WD14 tagger, BLIP-2).
- [docs/proposal-proactivity-vision.md](docs/proposal-proactivity-vision.md) — Screenshot pipeline and Direct vs. Forward-to-LLM vision routing.
- [docs/proposal-vision-witness.md](docs/proposal-vision-witness.md) — Vision witness implementation plan and salience scoring harness.
- [docs/proposal-poc-attention-ecology-vibe-island.md](docs/proposal-poc-attention-ecology-vibe-island.md) — Vibe Island ambient sensory indicator proof-of-concept.
- [docs/design-jev-integrations.md](docs/design-jev-integrations.md) — TypeSafe Jev / Laya System-1 non-autoregressive cognitive sentinel specification.
- [docs/proposal-salience-gate-ui-integration.md](docs/proposal-salience-gate-ui-integration.md) — Salience gate UI integration proposal.
- [docs/design-vision-api-cost-analysis.md](docs/design-vision-api-cost-analysis.md) — Token and financial cost breakdown for 24/7 continuous perception.
- [docs/content/en/docs/manual/vision.md](docs/content/en/docs/manual/vision.md) — User-facing vision settings manual.
- [docs/content/en/docs/manual/proactivity.md](docs/content/en/docs/manual/proactivity.md) — User-facing proactivity and screen-watching guide.

## Related Skills & References

- **Key Documents**: [[design-attention-ecology-screen-watching]], [[design-vision-system-support]], [[proposal-proactivity-vision]], [[proposal-vision-witness]], [[proposal-poc-attention-ecology-vibe-island]], [[design-jev-integrations]], [[design-vision-api-cost-analysis]], [[vision]], [[proactivity]]

### Authoritative Design & Architecture Documents

- [docs/design-attention-ecology-screen-watching.md](docs/design-attention-ecology-screen-watching.md) — Attention ecology & screen watching local WebGPU / System-1 salience guard spec.
- [docs/proposal-vision-witness.md](docs/proposal-vision-witness.md) — Vision witness implementation plan and salience scoring harness.
- [docs/proposal-poc-attention-ecology-vibe-island.md](docs/proposal-poc-attention-ecology-vibe-island.md) — Vibe Island proof-of-concept design.
- [docs/design-vision-system-support.md](docs/design-vision-system-support.md) — Vision system support design.
- [docs/design-vision-system-support.md](docs/design-vision-system-support.md) — Vision system support (localized architecture copy).
- [docs/design-vision-api-cost-analysis.md](docs/design-vision-api-cost-analysis.md) — Vision API cost analysis.
- [docs/research-vision-witness-report.md](docs/research-vision-witness-report.md) — Vision witness research report.
- [docs/project-vision-architecture-review-alpha22.md](docs/project-vision-architecture-review-alpha22.md) — Vision architecture review alpha22.
- [docs/proposal-salience-gate-ui-integration.md](docs/proposal-salience-gate-ui-integration.md) — Salience gate UI integration proposal.
- [docs/proposal-vlm-forward-to-llm.md](docs/proposal-vlm-forward-to-llm.md) — VLM forward-to-LLM proposal.
- [docs/content/en/docs/showcase/08-situational-awareness.md](docs/content/en/docs/showcase/08-situational-awareness.md) — Situational awareness showcase.
