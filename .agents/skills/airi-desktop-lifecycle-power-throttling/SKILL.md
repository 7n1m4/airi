---
name: airi-desktop-lifecycle-power-throttling
description: >-
  Configure/debug desktop window lifecycle and power throttling: Electron powerMonitor,
  sleep/wake suspension, screen-lock pausing, window visibility events, stagePaused,
  and render loop freezing. Cognitive heartbeats and prompt grounding use
  airi-proactivity-sensory-telemetry; stage UI surfaces use airi-stage-ui-surfaces.
---

# AIRI Desktop Lifecycle, Power Monitoring & Render Throttling

AIRI's desktop application (`apps/stage-tamagotchi`) continuously renders high-fidelity 3D (VRM / Three.js) and 2D (Live2D, Spine, MMD) avatars at 60 FPS. To prevent severe battery drain, fan noise, and GPU context stutter on unattended or sleeping devices, AIRI implements an automated hardware and OS lifecycle power-throttling pipeline.

This guide covers the end-to-end integration between native Electron power events, window state transitions, the Eventa IPC bridge, Pinia lifecycle state, and render loop freezing.

---

## Key Files & Locations

- **Native Power & Window Services (Main Process)**:
  - `apps/stage-tamagotchi/src/main/services/electron/window.ts` — hooks `params.window` (`show`, `hide`, `minimize`, `restore`, `focus`, `blur`) and native `powerMonitor` (`suspend`, `resume`, `lock-screen`, `unlock-screen`). Emits `electronWindowLifecycleChanged` and handles `electronGetWindowLifecycleState`.
  - `apps/stage-tamagotchi/src/main/services/sensors/index.ts` — queries `powerMonitor.getSystemIdleTime()` for sensory AFK idle tracking.
- **Typed Eventa Contracts**:
  - `apps/stage-tamagotchi/src/shared/eventa.ts` — defines `ElectronWindowLifecycleReason`, `ElectronWindowLifecycleState`, `electronGetWindowLifecycleState`, and `electronWindowLifecycleChanged`.
- **Renderer Lifecycle Store & Presentations**:
  - `apps/stage-tamagotchi/src/renderer/stores/stage-window-lifecycle.ts` — computes `stagePaused = !state.visible || state.minimized` from lifecycle events.
  - `apps/stage-tamagotchi/src/renderer/App.vue` — initializes the lifecycle bridge (`initializeWindowLifecycleBridge()`) on app mount.
  - `apps/stage-tamagotchi/src/renderer/pages/index.vue` — binds `:paused="stagePaused"` to `<WidgetStage>`.
- **Render Loop Freezing (Stage UI & 3D/2D Engines)**:
  - `packages/stage-ui/src/components/scenes/ControlStripHost.vue` (`WidgetStage`) — receives `:paused` prop and forwards to `RendererStage.vue`.
  - `packages/stage-ui/src/components/scenes/RendererStage.vue` — halts animation and render loops across Three.js VRM, Live2D Cubism, Spine, and MMD when `paused` is `true`.

---

## Architectural Invariants & Flow

```
[OS Sleep / Lock Screen]  OR  [Window Minimize / Hide]
              │
              ▼
   Electron \`powerMonitor\`  &  \`BrowserWindow\` Events
   ('suspend', 'lock-screen', 'minimize', 'hide')
              │
              ▼
   \`window.ts\` createWindowService
   Emits \`electronWindowLifecycleChanged\`
   (Sets \`visible: false\` when reason === 'suspend' or window hidden)
              │
              ▼ (IPC via Eventa)
   \`stage-window-lifecycle.ts\` Pinia Store
   \`stagePaused = computed(() => !state.visible || state.minimized)\`
              │
              ▼
   \`apps/stage-tamagotchi/src/renderer/pages/index.vue\`
   \`<WidgetStage :paused="stagePaused" />\`
              │
              ▼
   \`ControlStripHost.vue\` -> \`RendererStage.vue\`
   Halts \`requestAnimationFrame\` & physics ticking in:
   - Three.js VRM (MToon shaders, spring bones, blink timers)
   - Live2D (Cubism physics, breathing, motion loops)
   - Spine & MMD canvas animators
```

### State Transitions & Reasons
`ElectronWindowLifecycleReason` values:
- `'initial'`: default store initialization state.
- `'snapshot'`: point-in-time state queried via `electronGetWindowLifecycleState`.
- `'show'` / `'hide'`: window visibility changes.
- `'minimize'` / `'restore'`: window minimized to taskbar/dock or restored.
- `'focus'` / `'blur'`: window focus gained or lost (does not pause stage).
- `'suspend'`: screen locked or OS entering sleep. In `window.ts`, `visible` is forced to `false` when `reason === 'suspend'`.

---

## When to Use

- Debugging high CPU, GPU, or battery consumption while the computer is locked or asleep.
- Fixing avatar animations failing to pause on window minimize or screen lock.
- Investigating avatar freeze, WebGL context loss, or visual pop-in after unlocking or waking from sleep.
- Adding new hardware power-state listeners (e.g. AC power vs on-battery throttle).
- Differentiating between *hardware/power throttling* and *cognitive AFK sensing* (which belongs in `airi-proactivity-sensory-telemetry`).

---

## Common Pitfalls & Known Behaviors

1. **Do not confuse Cognitive AFK with Power Lifecycle**:
   - `powerMonitor.getSystemIdleTime()` in `proactivity` measures user inactivity in seconds to evaluate whether a conversation prompt should be generated.
   - `powerMonitor.on('suspend' | 'lock-screen')` in `window.ts` immediately halts WebGL rendering loops. They serve entirely distinct architectural concerns.
2. **Audio/TTS Playback Independence**:
   - Freezing `RendererStage` only affects visual canvas rendering. If audio is actively playing via `SpeechStore` / TTS when the screen locks, audio playback continues uninterrupted to the speakers while the avatar mouth motion is paused.
3. **Wayland / Linux Stuck Visibility**:
   - On Linux native Wayland sessions, `screen.getCursorScreenPoint()` or window state queries can occasionally report stale or stuck values due to Ozone limitations. Ensure DOM and OS signals are properly arbitration-gated (see PR #2521 / #2522).
4. **Listener Cleanup**:
   - `powerMonitor` is a global Electron module. Always register listeners with explicit teardown in `cleanup()` (`powerMonitor.off(...)`) on window close and app quit to avoid memory leaks.

---

## Verification

1. **Unit Tests**:
   ```bash
   pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/stores/stage-window-lifecycle.test.ts
   ```
2. **Typecheck**:
   ```bash
   pnpm -F @proj-airi/stage-tamagotchi typecheck
   ```
3. **Manual Verification**:
   - Lock screen (`Ctrl+Cmd+Q` on macOS or `Win+L` on Windows).
   - Check renderer performance visualizer or logs to verify `stagePaused` toggles to `true`.
   - Unlock screen: verify avatar immediately resumes rendering without shader reload or jitter.

---

## Related Skills & References

- **Cognitive AFK & Heartbeats**: [`airi-proactivity-sensory-telemetry`](../airi-proactivity-sensory-telemetry/SKILL.md)
- **Stage Shells & Controls Island**: [`airi-stage-ui-surfaces`](../airi-stage-ui-surfaces/SKILL.md)
- **Typed IPC & RPC**: [`airi-ipc-eventa`](../airi-ipc-eventa/SKILL.md)
- **Avatar Rendering Pipelines**: [`airi-character-rendering`](../airi-character-rendering/SKILL.md)
