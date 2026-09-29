# AIRI Coordinated Startup Splash & Loading Screen Specification

A comprehensive architectural specification for desktop-first coordinated startup sequencing, frameless floating splash screens, "none" model stage allocation bypass, and cross-platform loading reusability across Tamagotchi, Pocket, and Web.

---

## 1. Executive Summary & Problem Statement

When launching AIRI on desktop (`apps/stage-tamagotchi`), multiple autonomous windows and background services initialize asynchronously:
1. The **Main Process** boots hardware switches, sets up `injeca` dependency injection, and initializes core modules (`serverChannel`, `mcpStdioManager`, LevelDB integrity guard).
2. The **Control Strip** (`mainWindow`, `#/' route) mounts, positions itself at the display boundary, and begins restoring persisted state, chat sessions, and proactivity loops.
3. The **Actor Stage** (`stageWindow`, `#/actor` route) mounts, allocates a transparent WebGL viewport, compiles shaders, and loads 3D/2D model assets (Live2D, VRM, Spine, or MMD).

### The Current Friction Points
1. **Disjointed Window Popping**: Windows currently pop in at different times without visual coordination. If shader compilation or IndexedDB cache hits take 1–2 seconds, the user sees an empty desktop before windows suddenly appear and snap into place.
2. **Wasteful "None" Model Allocation**: For companions configured as text-only (`displayModelId: 'none'`), `setupActorStageWindow` unconditionally spawns a 450 × 600 transparent WebGL BrowserWindow running Chromium and Three.js/PixiJS. This wastes ~200MB+ RAM and GPU shader contexts for a companion that has no avatar.
3. **Upstream PR #2698 Limitations**: Upstream PR #2698 (*"feat(stage): add coordinated splash and loading screens"*, authored by `nekomeowww`) addressed startup loading purely for `apps/stage-web` and `apps/stage-pocket` as an in-page DOM overlay (`startup-overlay.vue` inside `Stage.vue`), completely ignoring desktop Electron. Furthermore, upstream created an extraneous package (`packages/ui-loading-screens`) for a single component, and assumed an avatar model must always download, breaking on text-only companions.

### Core Objectives
1. **Desktop-First Coordinated Splash**: Provide an immediate, beautiful, centered floating splash screen on desktop that coordinates startup milestones across Main and Renderer processes.
2. **Sleek Floating Card Form Factor (360 × 500 px)**: A tight portrait card centered on the primary monitor with brand mark, chromatic glow, milestone progress track, animated activity pulse, and dynamic status text.
3. **Automatic Exit Transition**: Automatically fade out and close the splash screen upon reaching 100% ready state without requiring any user click or interaction.
4. **"None" Model Stage Invariant**: If the active companion's model is `'none'`, bypass creating and mounting the Actor Stage window entirely, saving memory and GPU resources.
5. **Strict SPA Invariant**: Retain our Single Page Application (SPA) architecture via Vite hash routing (`#/splash`) and instant HTML pre-bootstrap in `index.html`, rejecting Multi-Page Application (MPA) complexity.
6. **Cross-Platform Reusability**: Abstract the milestone state machine (`useStartupResourcesStore`) so `apps/stage-pocket` and `apps/stage-web` can cleanly consume the same loading logic and recovery interfaces.

---

## 2. Architecture & Startup Lifecycle (Two-Phase Boot)

### Architectural Invariant: Main Has No IndexedDB Access
In AIRI, character cards and their settings (`local:airi-cards`) are stored in IndexedDB via `unstorage` + `localforage`, which only exist inside Chromium Renderer processes. The Electron Main Process has **no direct access** to IndexedDB.

Therefore, the boot lifecycle is organized as a **Two-Phase Handshake**:
- **Phase 1 (Core Bootstrap)**: Main process launches the Splash Window (`#/splash`, visible immediately) and the Control Strip (`mainWindow`, hidden with `show: false`). Main does **not** launch the Actor Stage window.
- **Phase 2 (Content Resolution & Stage Fork)**: Control Strip restores IndexedDB, reads `activeCardId`, and inspects `displayModelId`. Control Strip then commands Main to either create/mount the Actor Stage (`electronStageEnsure`) or mark the stage milestone as skipped (`electronSplashReportMilestone: { id: 'stage-actor', status: 'skipped' }`).

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Main as Electron Main Process
    participant Splash as Splash Window (#/splash)
    participant Ctrl as Control Strip (#/)
    participant Actor as Actor Stage (#/actor)

    User->>Main: Launch AIRI Desktop
    Note over Main: Hardware switches & LevelDB guard pass
    Main->>Splash: Create & show frameless Splash (360x500)
    Note over Splash: Instant HTML pre-bootstrap renders (no white flash)<br/>Vue mounts with progress bar & spinner
    Main->>Ctrl: Create Control Strip (show: false, deferInitialShow: true)

    Note over Ctrl: Control Strip mounts & restores storage
    Ctrl->>Main: electronSplashReportMilestone('core-services', 'ready')
    Main->>Splash: electronSplashStateChanged(progress: 25%)

    Ctrl->>Main: electronSplashReportMilestone('sync-engine', 'ready')
    Main->>Splash: electronSplashStateChanged(progress: 50%)

    Ctrl->>Main: electronSplashReportMilestone('character-card', 'ready')
    Main->>Splash: electronSplashStateChanged(progress: 75%)

    alt displayModelId === 'none' || --disable-webgl-stage
        Note over Ctrl: Text-only companion detected!
        Ctrl->>Main: electronSplashReportMilestone('stage-actor', 'skipped')
        Main->>Splash: electronSplashStateChanged(progress: 100%)
        Note over Actor: Actor Stage is NEVER created or mounted!
    else displayModelId !== 'none'
        Ctrl->>Main: electronSplashReportMilestone('stage-actor', 'loading')
        Ctrl->>Main: electronStageEnsure()
        Main->>Actor: stageWindowManager.ensureWindow() (show: false)
        Note over Actor: Actor Stage compiles shaders & textures
        Actor->>Main: electronSplashReportMilestone('stage-actor', 'ready')
        Main->>Splash: electronSplashStateChanged(progress: 100%)
    end

    Note over Splash: Progress 100% ("Ready!") held for 300ms
    Splash->>Splash: Smooth opacity fade-out exit (300ms)
    Splash->>Main: electronSplashDismiss()
    Main->>Splash: splashWindow.destroy()
    Main->>Ctrl: mainWindow.show() (settles in pinned corner)
    opt Model is not 'none'
        Main->>Actor: stageWindowManager.show() (settles in workspace)
    end
```

---

## 3. Form Factor & Visual Design

### 3.1. Geometry & Window Configuration
- **Dimensions**: `360px` width × `500px` height.
- **Placement**: Centered on the user's primary monitor (`screen.getPrimaryDisplay().workArea`).
- **Frameless & Transparent**: Configured with `transparentWindowConfig()`:
  - `frame: false`, `transparent: true`, `resizable: false`, `alwaysOnTop: true`, `skipTaskbar: true`.
- **Movable**: Draggable via the top brand zone (`-webkit-app-region: drag`), allowing users to reposition the splash if desired. Interactive elements (progress bar, details summary, buttons) declare `-webkit-app-region: no-drag`.

### 3.2. Visual Hierarchy (Sleek Floating Card)
```
┌────────────────────────────────────────────────────────┐
│                                                        │
│                     [ AIRI Logo ]                      │
│               (Dynamic Chromatic Hue Glow)             │
│                                                        │
│                         AIRI                           │
│                      v0.6.0-dev                        │
│                                                        │
│  ────────────────────────────────────────────────────  │
│                                                        │
│            [== Activity Spinner / Pulse ==]            │
│                                                        │
│            "Restoring character persona..."            │
│                                                        │
│            [=========================>      ]  75%     │
│                                                        │
│  ────────────────────────────────────────────────────  │
│                  Ready in a moment...                  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

1. **Brand Anchor**: Glowing AIRI mark with dynamic chromatic hue (`var(--chromatic-hue)`) and subtle breathing animation.
2. **Version Badge**: Monospace pill tag displaying `__APP_VERSION__` (injected at build time by Vite from `package.json`).
3. **Status Section**:
   - Dynamic label reflecting the current active milestone via `packages/i18n` locale keys:
     - `stage.startup.milestones.core_services`: *"Initializing core system services..."* (0–25%)
     - `stage.startup.milestones.sync_engine`: *"Restoring local state and storage..."* (25–50%)
     - `stage.startup.milestones.character_card`: *"Loading character persona..."* (50–75%)
     - `stage.startup.milestones.stage_actor`: *"Preparing avatar shaders & textures..."* (75–100%)
     - `stage.startup.milestones.stage_actor_skipped`: *"Text-only companion active (stage bypassed)"*
     - `stage.startup.ready`: *"Ready!"* (100%)
4. **Progress Track**: Sleek 4px progress bar utilizing `@proj-airi/ui` `Progress` component with smooth width easing.
5. **Zero-Flash Pre-Bootstrap**: In `apps/stage-tamagotchi/src/renderer/index.html`, routes other than the transparent floating islands automatically receive `.airi-pre-bootstrap`. The dark radial gradient and glowing pulse render **instantly in raw HTML/CSS**, eliminating any blank white or black window flash while Vite and Vue hydrate.

### 3.3. Exit Orchestration (Zero-Click Auto-Close)
- Once all registered milestones achieve `status === 'ready'` or `status === 'skipped'`:
  1. The progress bar completes to 100%, and status text displays `t('stage.startup.ready')`.
  2. A brief hold period of `300ms` ensures the user visually perceives milestone completion.
  3. The Splash view triggers a smooth CSS transition (`opacity: 0`, `transform: scale(0.98)`, duration `300ms`).
  4. On transition end, `Splash.vue` invokes `electronSplashDismiss()`.
  5. The Main process reveals `mainWindow.show()`, reveals `stageWindow.show()` (if ensured and active), and destroys the Splash BrowserWindow (`splashWindow.destroy()`), cleanly freeing Chromium resources.

---

## 4. Communication Architecture: Eventa IPC Contracts

Communication between Main and Renderer processes uses `@moeru/eventa` for strongly typed RPC and event streams.

### 4.1. Contract Definitions (`apps/stage-tamagotchi/src/shared/eventa.ts`)
```typescript
import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export type StartupMilestoneId = 'core-services' | 'sync-engine' | 'character-card' | 'stage-actor'
export type StartupMilestoneStatus = 'queued' | 'loading' | 'ready' | 'skipped' | 'failed'

export interface StartupMilestonePayload {
  id: StartupMilestoneId
  status: StartupMilestoneStatus
  error?: string
}

export interface StartupResourceState {
  id: StartupMilestoneId
  status: StartupMilestoneStatus
  error?: string
}

export interface StartupSnapshot {
  resources: StartupResourceState[]
  progress: number
  ready: boolean
  failed?: StartupResourceState
}

/** Renderer (Control Strip or Stage) reports a milestone update to Main process */
export const electronSplashReportMilestone = defineInvokeEventa<void, StartupMilestonePayload>(
  'electron:splash:report-milestone'
)

/** Main process broadcasts the updated aggregate startup state to Splash window */
export const electronSplashStateChanged = defineEventa<StartupSnapshot>(
  'electron:splash:state-changed'
)

/** Splash window notifies Main that exit fade animation completed and window can be destroyed */
export const electronSplashDismiss = defineInvokeEventa<void, void>(
  'electron:splash:dismiss'
)

/** Control Strip requests Main to ensure/create the Actor Stage window (avatar active) */
export const electronStageEnsure = defineInvokeEventa<{ created: boolean }, void>(
  'electron:stage:ensure'
)

/** Control Strip requests Main to release/hide the Actor Stage window (text-only active) */
export const electronStageRelease = defineInvokeEventa<void, void>(
  'electron:stage:release'
)
```

### 4.2. Main Process State Authority
The Main process acts as the single authoritative relay:
- Main maintains the aggregate milestone table in memory.
- When `electronSplashReportMilestone` is invoked:
  - Main sanitizes input with `toRaw()`.
  - Main verifies `event.sender.id` to prevent unauthorized cross-window tampering.
  - Main recalculates progress: `Math.round((finished / total) * 100)`.
  - Main emits `electronSplashStateChanged` to the Splash window's webContents.

---

## 5. "None" Model Bypass & Actor Stage Window Manager

### 5.1. Resolving the Boundary Contention: `--disable-webgl-stage` vs. `displayModelId: 'none'`
A key architectural question was resolved regarding whether the CLI flag `--disable-webgl-stage` (in `start_airi.sh`) and the character card config `displayModelId: 'none'` are redundant or distinct.

| Dimension | `--disable-webgl-stage` | `displayModelId === 'none'` |
| :--- | :--- | :--- |
| **Scope Boundary** | **Process / Machine Level Override** | **Content / Companion Dynamic State** |
| **Origin** | CLI flag (`--disable-webgl-stage`) or env var (`AIRI_DISABLE_WEBGL_STAGE=true`) via `start_airi.sh`. | Character Card metadata (`card.extensions.airi.modules.displayModelId`). |
| **Behavior** | Hard, permanent veto for the entire Electron session. No stage window can be opened under any circumstance. | Dynamic per-companion bypass. Active companion has no avatar; switching cards can spawn the stage. |
| **Use Case** | Headless server runs, remote audio-only nodes, crash-prone legacy GPUs. | Text-only companions, minimalist conversational agents, writer personas. |
| **Control Strip UI** | Shows *"Actor Stage: Disabled (--disable-webgl-stage)"*. | Shows avatar toggle disabled or text-only indicator. |
| **Milestone Impact** | `stage-actor` milestone marked `skipped` (reason: `hardware-override`). | `stage-actor` milestone marked `skipped` (reason: `text-only-companion`). |

### 5.2. Actor Stage Window Manager (`apps/stage-tamagotchi/src/main/windows/stage/index.ts`)
To prevent `null` pointer regressions and support clean lazy creation, `setupActorStageWindow` is refactored from returning `Promise<BrowserWindow | null>` into an `ActorStageWindowManager`:

```typescript
export interface ActorStageWindowManager {
  getWindow: () => Promise<BrowserWindow>
  ensureWindow: () => Promise<BrowserWindow | null>
  hasWindow: () => boolean
  getExistingWindow: () => BrowserWindow | undefined
  isVisible: () => boolean
  show: () => void
  hide: () => void
  setAlwaysOnTop: (flag: boolean, level?: string, relativeLevel?: number) => void
  setBounds: (bounds: Rectangle) => void
  capturePage: () => Promise<NativeImage | null>
  destroy: () => void
}
```

#### Invariants & Safety Guards:
1. **Idempotent Handler Registration**: `ipcMain.handle('stage-window-set-bounds', ...)` is moved to manager initialization (executed once), preventing "Attempted to register a second handler" exceptions on window re-creation.
2. **Caption Follow Cleanup**: Window event listeners (`show`, `hide`, `minimize`, `restore`) are tracked and explicitly disposed when the underlying `BrowserWindow` is closed or destroyed to prevent event listener leaks.
3. **Control Strip Initial Show Deferral**: In `apps/stage-tamagotchi/src/main/windows/main/index.ts`:
   ```typescript
   window.on('ready-to-show', () => {
     restoreBounds()
     // NOTICE: Initial show is deferred until Splash Window signals completion
     if (!params.deferInitialShow) {
       window.show()
     }
   })
   ```
4. **Stage Model Store Guard**: In `packages/stage-ui/src/stores/settings/stage-model.ts`:
   ```typescript
   if (!selectedModelId || selectedModelId === 'none') {
     replaceStageModelUrl(undefined)
     cleanupMmdTextures()
     stageModelSelectedDisplayModel.value = undefined
     stageModelSelectedFile.value = undefined
     stageModelRenderer.value = 'disabled'
     // Prevents spurious "Model not found (none)" toast errors!
   }
   ```

---

## 6. Error Recovery & Watchdog Safeguards

### 6.1. Control Strip Ownership of `skip`
The **Control Strip** (`apps/stage-tamagotchi/src/renderer/App.vue`) is the authoritative owner of reporting `skip('stage-actor')`. Because the Actor Stage window does not exist when `displayModelId === 'none'`, `RendererStage.vue` can never mount to report its own status. If Control Strip did not own this check, the startup sequence would deadlock at 75%.

### 6.2. Watchdog Timer & Timeout Guard
If any milestone remains in the `loading` state for longer than **10 seconds** (e.g. frozen network socket, hung shader compile), the Splash window's watchdog timer fires:
1. Marks the stalled milestone as `failed` with error: `t('stage.startup.timeout')`.
2. Transitions the Splash UI into the `error` state.

### 6.3. Recovery Action Surface
When `failed` is non-null:
1. **Retry Button**: Triggers `emit('retry')`, which commands the Control Strip via IPC to re-attempt the failed initialization step.
2. **Continue without Avatar Button**: If `failed.id === 'stage-actor'`, reveals an alternative button: `t('stage.startup.continue-without-model')`. Clicking this commands the Control Strip to invoke `electronSplashReportMilestone({ id: 'stage-actor', status: 'skipped' })`, instantly unblocking the `ready` computed state and allowing the user to proceed to the Control Strip and Chatbox.
3. **Technical Details Accordion**: An expandable `<details>` section displays the raw error stack or rejection message for easy diagnostics.

---

## 7. Cross-Platform Reusability Roadmap

The core store (`packages/stage-ui/src/stores/startup-resources.ts`) is authored as a pure Pinia store with zero Node/Electron imports, enabling drop-in reuse across all platforms:

| Surface | Presentation Mode | Milestone Set | Error Recovery Surface |
| :--- | :--- | :--- | :--- |
| **Stage-Tamagotchi** (Phase 1) | Centered floating frameless card (360 × 500 px), auto-fadeout exit. | `core-services`, `sync-engine`, `character-card`, `stage-actor`. | In-card retry / continue-without-model buttons. |
| **Stage-Pocket** (Phase 2) | Fullscreen mobile portrait loading card with safe-area insets. | `sync-engine`, `character-card`, `stage-actor`. | Fullscreen error panel with offline mode toggle. |
| **Stage-Web** (Phase 3) | Responsive web container overlay, centering over stage background. | `sync-engine`, `character-card`, `stage-actor`. | In-page card with CDN re-download button. |

---

## 8. Implementation Phasing & Task Breakdown

### Phase 1: Shared Milestone Store & Invariants
- [ ] Create `packages/stage-ui/src/stores/startup-resources.ts` with registration, progression calculation, and skip/fail support.
- [ ] Author unit test suite `packages/stage-ui/src/stores/startup-resources.test.ts` verifying all state transitions, progress arithmetic, and error states.
- [ ] Add locale strings to `packages/i18n/src/locales/en/stage.yaml` and `zh-Hans/stage.yaml`.
- [ ] Run `node scripts/audit-test-catalog.mjs` to maintain 100% test catalog integrity.

### Phase 2: Main Process Splash Window & Actor Stage Manager
- [ ] Add typed IPC contracts to `apps/stage-tamagotchi/src/shared/eventa.ts`.
- [ ] Implement `apps/stage-tamagotchi/src/main/windows/splash/index.ts` (frameless 360 × 500 window, auto-close handler).
- [ ] Refactor `apps/stage-tamagotchi/src/main/windows/stage/index.ts` to `ActorStageWindowManager` with idempotent `stage-window-set-bounds` handler.
- [ ] Update `setupMainWindow` to support `deferInitialShow` until splash completion.

### Phase 3: Renderer Splash Page & Lifecycle Integration
- [ ] Create `apps/stage-tamagotchi/src/renderer/pages/splash.vue` using `@proj-airi/ui` primitives (`Progress`, `Button`), Comfortaa font, and chromatic hue.
- [ ] Wire two-phase milestone reporting in `apps/stage-tamagotchi/src/renderer/App.vue`.
- [ ] Add `selectedModelId === 'none'` guard to `packages/stage-ui/src/stores/settings/stage-model.ts`.

### Phase 4: Verification & Parity Audit
- [ ] Run `pnpm -F @proj-airi/stage-tamagotchi typecheck`.
- [ ] Run `pnpm -F @proj-airi/stage-ui test`.
- [ ] Verify startup flow with text-only companion (`displayModelId === 'none'`).
- [ ] Verify startup flow with avatar companion (Live2D / VRM).
- [ ] Verify `--disable-webgl-stage` CLI flag.
- [ ] Run `git status` reporting.
