# Proposal: Vision-Based UI Verification & Browser Automation Pipeline

An architectural proposal and exploratory roadmap for introducing automated visual regression testing, multi-window Electron capture, and headless browser automation into the AIRI monorepo.

---

## 1. Executive Summary & Problem Context

In our current workflow, UI verification across `apps/stage-tamagotchi` (Electron), `apps/stage-web`, and `packages/stage-ui` is entirely manual. When developers or AI pair-programming agents make CSS, UnoCSS, layout, or component changes:
- Verification requires booting `pnpm dev` and manually inspecting the rendered surface.
- Sub-pixel regressions, clipping on high-DPI displays, and theme desynchronization across secondary windows (Chat, Settings, Customizer, Captions) are easily missed.
- Automated tests in the monorepo are currently headless unit/store tests (Vitest + JSDOM); they verify reactive state logic and Eventa IPC contracts, but have **zero visual or DOM rendering evidence**.

Upstream recently explored an automated visual testing workflow using **Vishot** (`@vishot/cli`) and **agent-browser**. This proposal analyzes upstream's methods, documents how their tooling works, critiques their architectural assumptions, and lays out a blueprint for safely porting visual verification to our fork when we decide to adopt it.

> [!NOTE]
> **Aspirational Specification**: This document is an architectural RFC, not an active skill. Per our repository discipline, `.agents/skills/` is reserved for operational procedures targeting currently installed production tools. This proposal allows the methodology to stew, mature, and be properly adapted before committing to new tool dependencies.

---

## 2. Upstream Methodology & Toolset Analysis

Upstream split their visual testing exploration into two complementary external tools:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       UPSTREAM VISUAL PIPELINE                              │
├──────────────────────────────────────┬──────────────────────────────────────┤
│           TOOL 1: VISHOT             │       TOOL 2: AGENT-BROWSER          │
│   Deterministic Visual Regression    │   Headless Interactive Automation    │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ - `@vishot/cli` + Playwright         │ - Global CLI (`agent-browser`)       │
│ - Multi-window Electron discovery    │ - Injects detached file upload DOM   │
│ - `defineScenario` programmatic runs │ - Interacts with live Chromium/WebKit│
│ - Fixed resolution & settle timers   │ - Automates complex setup sequences  │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 2.1 Tool 1: Vishot (`@vishot/cli` + Playwright)
Referenced in upstream skills:
- `.agents/skills/use-vishot/SKILL.md`
- `.agents/skills/use-vishot-with-electron/SKILL.md`
- `.agents/skills/use-vishot-with-web/SKILL.md`
- `.agents/skills/use-vishot-for-airi/SKILL.md`

#### How Upstream Executes Vishot
1. **Multi-Window Electron Discovery**:
   Electron applications do not have standard single-URL entry points. Vishot launches the built Electron binary via Playwright's Electron driver (`_electron.launch`) and identifies target renderers using `--window-url` hash matching:
   ```bash
   pnpm exec vishot capture \
     --target electron \
     --app-entrypoint ./apps/stage-tamagotchi/dist/main/index.js \
     --window-url '#/' \
     --settle-ms 2500 \
     --output-dir ./artifacts/captures/stage
   ```
2. **Settle Timer Discipline (`--settle-ms 2500`)**:
   Because Vite HMR, WebGL context initialization, UnoCSS stylesheet generation, and 3D avatar parsing are asynchronous, captures must enforce a mandatory settle delay (2500ms) to ensure textures and fonts are fully resolved before taking the screenshot.
3. **Deterministic Native Sizing**:
   Upstream evaluates native `BrowserWindow.setContentSize` directly through Playwright's Electron handle to enforce fixed desktop viewports (e.g. 1200×900 or 400×700) regardless of the host OS window manager scaling:
   ```ts
   const browserWindow = await electronApp.browserWindow(page)
   await browserWindow.evaluate((win, target) => {
     win.setContentSize(target.width, target.height)
   }, { width: 1200, height: 900 })
   ```

---

### 2.2 Tool 2: Agent Browser (`agent-browser`)
Referenced in upstream skills:
- `.agents/skills/agent-browser/SKILL.md`
- `.agents/skills/agent-browser-electron/SKILL.md`
- `.agents/skills/use-agent-browser-for-airi/SKILL.md`
- `.agents/skills/use-agent-browser-with-input-file/SKILL.md`

#### How Upstream Solved Detached File Inputs
AIRI uses VueUse's `useFileDialog()` for importing character cards (`.png`), VRM models (`.vrm`), and Live2D archives (`.zip`). `useFileDialog` creates an in-memory `<input type="file">` element that is **never appended to the DOM**, making standard Playwright/Selenium `page.setInputFiles()` fail because no file input exists in the DOM tree.

Upstream solved this by dynamically injecting temporary instrumentation:
```ts
// Injects a temporary DOM attribute on the detached file input
const input = document.createElement('input')
input.type = 'file'
input.setAttribute('data-agent-browser-upload', 'true')
// Allows headless automation to bind file buffers reliably
```

---

## 3. Fork Divergence & Critical Pitfalls to Avoid

If we were to blindly port upstream's Vishot and agent-browser skills today, **they would immediately fail**. Upstream's visual tests are coupled to obsolete architecture that has diverged radically from our fork:

1. **The Deleted `controls-island` Trap**:
   Upstream's scenario scripts hardcode DOM selectors for `stage-islands/controls-island`. In our fork, the floating island was completely replaced by `ControlStripHost.vue` and `ControlStrip.vue`. Any test targeting `.controls-island` will fail with selector timeouts.
2. **Obsolete Onboarding V2 State**:
   Upstream's state preparation scripts run:
   ```bash
   localStorage.setItem("onboarding/completed", "true")
   ```
   Our fork uses canonical **Onboarding V3** (`docs/design-onboarding-v3.md`), which isolates state in `useOnboardingV3Draft` and commits starter cards atomically.
3. **Global CLI Dependency Drift**:
   Upstream relies on globally installed binaries (`npm i -g agent-browser`). In a production development environment, unmanaged global CLI tools introduce version skew, node-gyp compilation failures on Apple Silicon, and unpredictable CI environments.

---

## 4. The Adapted Fork Blueprint: What Our Testing Pipeline Should Look Like

When we choose to adopt vision-based testing, it should be tailored specifically to our current architecture:

```
apps/stage-tamagotchi/
  ├── scenarios/                         # Fork-owned visual test scenarios
  │   ├── control-strip.scenario.ts     # Pill, expanded dock, notch hit-testing
  │   ├── card-export-modal.scenario.ts # CardExportDialog 4-model selection grid
  │   ├── onboarding-v3.scenario.ts     # 19-step sliding stepper & archetype pickers
  │   └── memory-dashboard.scenario.ts  # STMM / Lifetime / Dreaming graphs
```

### Key Scenarios for AIRI Fork

#### Scenario 1: Control Strip & Chromatic Theming
- Verify that `--chromatic-hue` dynamic theme switching applies cleanly across all buttons without leaving unstyled neutral borders.
- Test notch-mode geometric hit-testing and edge-docking transitions.

#### Scenario 2: Card Export Dialog (`CardExportDialog.vue`)
- Mount the new 4-model multi-select export dialog.
- Verify that file size estimation badges, checkboxes, and warning notices render cleanly at standard desktop window dimensions.

#### Scenario 3: 3D/2D Avatar Canvas Rendering Verification
- Test that Three.js VRM (MToon shaders) and Live2D canvases correctly render with transparent alpha channels without background artifacts or WebGL clipping.

---

## 5. Decision Criteria for Adoption

We should let this proposal mature and only pull the trigger on implementation when:

1. **Component Design Parity**: When `CardExportDialog.vue` and the settings revamp are committed and stabilized.
2. **Local Monorepo Dependency**: Instead of unpinned global CLIs, install `@vishot/cli` (or Playwright Component Testing) directly into `devDependencies` in `apps/stage-tamagotchi`.
3. **CI Pipeline Integration**: Formally provision headless Electron capture in GitHub Actions with automated PR visual diff artifacts.

Once these conditions are met, we will convert this proposal into an operational domain skill (`.agents/skills/airi-visual-verification-vishot/SKILL.md`).
