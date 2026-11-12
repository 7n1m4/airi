# P9 Lane A — Onboarding / Notice / Widgets pages (catalog + scaffold)

Scope: `apps/stage-tamagotchi/src/renderer/pages/{onboarding,onboarding-v3}.vue`,
`notice/{index,gemini,fade-on-hover}.vue`, `widgets.vue` → QML. New files only;
nothing under `apps/stage-tamagotchi`, `packages/`, `build.rs`, `SettingsWindow.qml`,
or any existing QML was touched. No Rust was touched. First-run state is **not**
wired anywhere — both onboarding pages gate the app's first-run flow and are
presentational only (static wizard text + buttons); the missing bridges are
listed under "Deferred".

## What landed

### qml/pages/onboarding/OnboardingPage.qml (port of `onboarding.vue`)
Static OnboardingV2-style wizard: title + `shell.onboarding.v2.previewBadge`
badge, warning deferred-notice card (Live2D idiom), clickable step progress rail
(9 steps: welcome → calibration, local `currentStep` only), `n / m` step counter,
per-step ACard content, footer with Back (local), Skip / Finish (disabled + tooltip)
/ Next (local). Terminal actions are visible but disabled; nothing persists.

### qml/pages/onboarding/OnboardingV3Page.qml (port of `onboarding-v3.vue` + StepWelcome hero)
Static full-screen V3 frame: edgeless header bar (brand, 18 static stepper dots
from `ONBOARDING_V3_STEPS`, `shell.onboarding.v3.stageReady` success badge,
disabled ✕ close button with tooltip), main workspace with the welcome hero
(brand tile, hero title/subtitle, companion-greeting ACard, three feature pills,
Quick Start / Guided Setup disabled + tooltip, "Set up later" disabled ghost
button, deferred-notice warning card). All actions disabled; step rail not
interactive (no draft store).

### qml/pages/notice/NoticePage.qml (port of `notice/index.vue`)
`notice/index.vue` is a `<RouterView />` — in Qt it becomes an informative hub:
title + preview badge, subtitle, deferred-notice card, "Notice surfaces" section
listing the two notices (Gemini onboarding, Fade on Hover tutorial) with route
badges, footnote with the Electron route paths. No actions wired.

### qml/pages/notice/GeminiNoticePage.qml (port of `notice/gemini.vue`)
Cinematic two-pane layout: cosmic sidebar (placeholder art + "Powered by Gemini"
pill — the `gemini-graphic.png` asset is not registered in the Qt resource
pipeline) and a content column (accent system-header line, hero title, intro,
True Vision / Contextual Memory feature grid, actions strip with disabled
"Add Gemini Key" button + disabled "Don't show again" switch, both with hover
tooltips). The gradient-clipped hero text from upstream became solid
`Theme.textPrimary` (QML Text has no gradient fill — see deviations).

### qml/pages/notice/FadeOnHoverNoticePage.qml (port of `notice/fade-on-hover.vue`)
Tutorial notice: `Tutorial` badge, headline ACard, static preview placeholder
(the `tutorial-fade-on-hover.{dark,light}.mp4` assets are not bundled yet) with
an explanatory note, and the fully-expanded description card (intro + opacity
line + toggle line — hover-expand deferred), disabled "Got it" button and
disabled "Don't show again" switch.

### qml/pages/widgets/WidgetsPage.qml (port of `widgets.vue`)
Static widget-catalog/placeholder: decorative drag-handle pill, title + preview
badge, disabled ✕ close button, bridge-pending warning card, the upstream
"missing widget id" ACard, and a two-pane catalog of the six known component
types (weather / map / artistry / comfy / sticker / generic JSON fallback) with
static `componentProps` bullet lists. Catalog selection is local State; nothing
is fetched, removed, or timed (no TTL).

## Verification

- `cargo check -p airi-qt` — green.
- `/usr/lib/qt6/bin/qmllint -I target/cxxqt/qml_modules` on all six files — no
  errors; only the codebase-idiomatic `unqualified access` warnings on delegate
  `index`/`modelData` (same class as existing `AToggleGroup.qml`, which emits four).
- QML pages are not compiled by the build; integration build + smoke run are the
  main agent's gate.
- No Rust, no existing QML, no `build.rs`, no `SettingsWindow.qml` edits.

## Deferred (no Qt backing yet — control is visible but disabled with a tooltip)

Every disabled control uses the Live2D "deferred" idiom: disabled `AButton` /
`ASwitch` inside a wrapper `Item`, plus `ATooltip` shown on wrapper hover.

### OnboardingPage / OnboardingV3Page (first-run flow)
- Skip ("Setup Later"), Finish, Guided Setup, Quick Start, close ✕, Setup Later
  ghost link — all blocked on a **first-run/onboarding store** in the Qt build
  (`useOnboardingStore` equivalent: `hasCompletedSetup`, `markSetupSkipped`,
  `markSetupCompleted`) plus an **onboarding window host** (in Electron a
  frameless `BrowserWindow` titled "AIRI - Companion Wizard", 1200×760) wired
  through `WindowManager`, emitting/closing on the store flags.
- V2 step gating (`onboardingV2GateKey`) and V3 module filtering
  (`ONBOARDING_V3_STEPS` filtered by draft `modules`) — needs the V2/V3 draft
  stores; V3's remaining 17 steps have no static content by design.
- Stage reveal + chat open on close (`electronStageToggleVisibility` /
  `electronOpenChat`) and the Electron-side `window.close()` — needs a Qt
  equivalent of those eventa invocations (WindowManager visibility toggles).
- Drag regions (`data-tauri-drag-region`, `-webkit-app-region: drag`) — Qt
  window chrome owns drag; nothing to add inside the pages.

### NoticePage / GeminiNoticePage / FadeOnHoverNoticePage (notice host)
- Notice window host + pending-notice request store: Electron preloads handle
  `pageMounted` / `pageUnmounted` / `windowAction` and the main process routes
  by `?id=` query into `pendingNoticeRegistry`. Qt needs an equivalent bridge
  ("notice window" opened by WindowManager, query params or props for the
  pending request, an action invokable, and close semantics).
- `hasGeminiKey` check (providers store `google-generative-ai` credential read)
  for the "Add Gemini Key" vs "Begin Session" label and the open-settings
  navigation (`/settings/providers/chat/google-generative-ai`) — needs a
  credential-presence invokable on the provider bridge (or a narrow
  `NoticeController`). Button stays "Add Gemini Key" (the conservative label)
  until that exists.
- "Don't show again" checkboxes (`controlsIslandStore.dontShowGeminiOnboarding`,
  `dontShowItAgainNoticeFadeOnHover`) — needs the controls-island settings
  section persisted (settings/controls-island equivalent).
- Gemini cosmic artwork (`gemini-graphic.png`) and the fade-on-hover videos
  (`tutorial-fade-on-hover.dark.mp4` / `.light.mp4`) — assets live under
  `apps/stage-tamagotchi/.../assets/`; Qt needs them copied + registered in the
  qrc/`qml_files` pipeline and, for video, `qt_module("Multimedia")` plus an
  `AVideo`-style wrapper. Until then both are static placeholders.
- Hover-expand of the description card (VueUse `useMouseInElement` +
  `TransitionVertical`) — needs a hover-driven expand animation; rendered
  fully-expanded for now.
- Gemini hero gradient-clipped text — QML `Text` cannot clip a gradient;
  rendered solid `Theme.textPrimary`.
- Waiting-for-request loading states (`waitingForRequest`) and the close-on-
  action semantics (`window.close()`) — part of the notice action bridge.

### WidgetsPage (widget host)
- Widgets bridge: `widgets.fetch` / `widgets.remove` invokables and the
  `widgets.renderEvent` / `updateEvent` / `removeEvent` / `clearEvent` events
  (Electron eventa → Rust bridge) — none exist yet.
- Component registry (QML renderer per `componentName`: weather / map /
  artistry / comfy / sticker + generic JSON dump) — needs QML delegates per
  widget, plus the `WeatherSkeleton` equivalent for async weather.
- TTL timer (`ttlMs` → auto-remove) — trivial with a QML Timer once the bridge
  exists, but meaningless without it.
- Close widget button (✕) and Refresh — need `widgets.remove` invokable.
- Frameless chrome (borderless transparent host window, top drag pill) —
  WindowManager concern; the pill is rendered decoratively here.
- `componentProps` JSON-dump fallback view — wants a monospace font token on
  `Theme` (see below) or a read-only `ATextArea` dump instead.

### WidgetsPage / Onboarding / Notice (all)
- First-run state: none of these pages read or write persisted state. When the
  onboarding store lands, wire `OnboardingPage`/`OnboardingV3Page` to it before
  enabling any button.

## Integration lists for the main agent

### 1. QML files to register in `crates/airi-qt/build.rs` (additive `qml_file` entries)

```rust
for onboarding_page in ["OnboardingPage", "OnboardingV3Page"] {
    module = module.qml_file(format!("qml/pages/onboarding/{onboarding_page}.qml").as_str());
}
for notice_page in ["NoticePage", "GeminiNoticePage", "FadeOnHoverNoticePage"] {
    module = module.qml_file(format!("qml/pages/notice/{notice_page}.qml").as_str());
}
module = module.qml_file("qml/pages/widgets/WidgetsPage.qml");
```

(or six explicit `module.qml_file("qml/pages/.../….qml");` lines after the
`ExploreModelsPage` entry — placement is up to you; these are not singletons.)

### 2. SettingsWindow.qml proposal (NOT applied — file is off-limits to this lane)

These are full-window surfaces upstream (onboarding / notice / widgets windows),
not settings pages. **Preferred integration**: register pages in `build.rs`, open
via `WindowManager` (e.g. `openWindow("onboardingWindow", "pages/onboarding/OnboardingV3Page.qml", "onboarding")`),
no settings-nav entries. If you do want them reachable from the Settings window
for preview, additive entries after Explore (`navIndex` 14–16):

```qml
// Nav (after the Explore AListItem, before the closing spacer Item)
AListItem {
    Layout.fillWidth: true
    icon: "🪄"
    title: I18n.tr("shell.settings.nav.onboarding")
    active: settingsWindow.navIndex === 14
    onClicked: settingsWindow.navIndex = 14
}
AListItem {
    Layout.fillWidth: true
    icon: "📣"
    title: I18n.tr("shell.settings.nav.notice")
    active: settingsWindow.navIndex === 15
    onClicked: settingsWindow.navIndex = 15
}
AListItem {
    Layout.fillWidth: true
    icon: "🧩"
    title: I18n.tr("shell.settings.nav.widgets")
    active: settingsWindow.navIndex === 16 || settingsWindow.navIndex === 17
    onClicked: settingsWindow.navIndex = 16
}

// StackLayout (after ExploreModelsPage)
OnboardingPage {
}
OnboardingV3Page {
}
NoticePage {
}
GeminiNoticePage {
}
FadeOnHoverNoticePage {
}
WidgetsPage {
}
```

(i.e. 14 Onboarding, 15 Notice, 16 Widgets — but the honest place for these is
dedicated windows like Chat/Stage/About, not the Settings nav; the StackLayout
has no room for the Gemini/Fade-on-Hover cinematic layouts anyway when squeezed
next to a 180 px nav column.)

### 3. i18n keys to add to all 10 shell.yaml locales (en, es, fr, id, ja, ko, ru, vi, zh-Hans, zh-Hant)

Grouped by page namespace. Values shown are the English source strings.
`/notice/gemini` and `/notice/fade-on-hover` (route badges) are route paths —
keep them identical in every locale. `shell.common.close` (existing) covers "Close".

Note: `I18n.tr()` has no parameter substitution, so `{value}`/`{targets}`-style
interpolation does not exist; interpolated sentences were inlined with English
source strings (see opacityLine/toggleLine).

**shell.onboarding.*** (shared + v2 + v3)

```yaml
onboarding:
  deferredNotice: First-run completion isn't wired in this Qt build yet — these screens are presentational. Buttons that finish or skip the wizard unlock once the onboarding store lands.
  deferredTip: Not wired yet — the first-run onboarding store will enable this action.
  back: Back
  v2:
    title: AIRI Companion Setup
    previewBadge: First-run wizard
    next: Next
    finish: Finish
    skip: Setup Later
    steps:
      welcome:
        label: Welcome
        subtitle: Meet your digital companion and pick how you'd like to set things up.
      triage:
        label: Your Path
        subtitle: New machine or returning device — choose how to continue.
      hearing:
        label: Hearing
        subtitle: Give your companion ears with speech-to-text and a mic check.
      consciousness:
        label: Consciousness
        subtitle: Choose the reasoning engine behind your companion.
      profile:
        label: You
        subtitle: Tell your companion who you are and how you like to work.
      persona:
        label: Persona
        subtitle: Shape the soul: name, character and personality traits.
      vessel:
        label: Vessel
        subtitle: Pick the body: Live2D, VRM or a minimal presence.
      speech:
        label: Voice
        subtitle: Voice selection and a speaking-rate sanity check.
      calibration:
        label: Launch
        subtitle: A quick calibration, then straight onto the stage.
  v3:
    brand: AIRI Companion Setup
    stageReady: Stage Ready
    heroTitle: Welcome to AIRI
    heroSubtitle: Your companion's stage — set up in minutes, 100% on your machine.
    companionQuote: Hello! I'm your autonomous digital companion. Whether you want voice conversation, creative stage performances, or a quiet desktop presence, I'm ready to adapt to your world.
    pillWebgpu: Local WebGPU Core
    pillOffline: 100% Offline & Private
    pillSouls: Mix & Match Souls + Bodies
    quickStart: Quick Start (60s)
    guidedSetup: Guided Setup
    setupLater: Set up later
```

**shell.notice.***

```yaml
notice:
  previewBadge: Preview
  deferredTip: Needs the notice-window action bridge (windowAction / pageMounted / pageUnmounted), which doesn't exist in the Qt build yet.
  index:
    title: Notice
    subtitle: AIRI's main process shows transient notice windows for one-off prompts. This page lists the notices the desktop app ships with.
    surfaces: Notice surfaces
    geminiTitle: Gemini onboarding
    geminiSubtitle: Opens when no Google Generative AI key is configured, offering to add one before the first session.
    fadeOnHoverTitle: Fade on Hover tutorial
    fadeOnHoverSubtitle: Explains the auto-hide behavior that fades the character when the cursor roams nearby.
    routeGemini: /notice/gemini
    routeFadeOnHover: /notice/fade-on-hover
    deferredNotice: The Qt build has no notice-window host yet. These surfaces will open as frameless notice windows driven by the pending-notice request store once it lands.
    footnote: In the Electron build these live at /notice/gemini and /notice/fade-on-hover.
  gemini:
    header: Intelligence Node Online
    title: Gemini Quantum Leap
    intro: Welcome to the next generation of AI interaction. Your character is now powered by Google Gemini, enabling deep multimodal understanding.
    graphicCaption: Gemini cosmic visualization
    poweredBy: Powered by Gemini
    visionTitle: True Vision
    visionDescription: I can finally see your screen and world. Use the Camera icon to trigger a capture or show me things through your lens.
    memoryTitle: Contextual Memory
    memoryDescription: I remember our current session with extreme precision, allowing us to build deeper conversations over time.
    addKey: Add Gemini Key
    dontShowAgain: Don't show again
  fadeOnHover:
    badge: Tutorial
    title: Fade on Hover
    intro: Automatically fades the character when your cursor roams nearby. It helps reduce distractions while keeping your character visible.
    opacityLine: After turning on, the opacity drops to 0 for both the character and UI when your cursor is nearby.
    toggleLine: You can toggle it off by hovering at the Controls Island, then clicking the eye-slash icon again.
    confirm: Got it
    dontShowAgain: Don't show again
    previewTitle: Tutorial preview
    previewNote: The fade-on-hover walkthrough video ships with the stage-tamagotchi renderer assets. Bundling it needs an asset-registration pass that hasn't landed in the Qt build yet.
```

**shell.widgets.***

```yaml
widgets:
  title: Widgets
  previewBadge: Preview
  catalogTitle: Known widget components
  samplePropsCaption: Sample componentProps
  missingId: Missing widget id. Launch this window via a component call (widgets.render) to populate the view.
  refresh: Refresh
  closeWidget: Close widget
  deferredNotice: The Qt build has no widgets bridge yet (widgets.fetch / render / update / remove / clear events) and no QML renderer registry. Everything below is static preview data.
  deferredTip: Needs the widgets bridge (fetch + render/update/remove/clear events) in the Qt build.
  kinds:
    weather:
      name: Weather
      description: Current conditions and forecast, resolved for the companion's location.
    map:
      name: Map
      description: Interactive map snapshot for a location the companion asked about.
    artistry:
      name: Artistry
      description: Generated artwork from the artistry pipeline (ComfyUI / image generation).
    comfy:
      name: Comfy
      description: Alias of artistry — the ComfyUI-backed generation view.
    sticker:
      name: Sticker
      description: Sticker or reaction image the companion picks for the conversation.
    generic:
      name: Generic
      description: Fallback JSON dump for unregistered component names.
```

**Settings-nav keys (only if you apply the SettingsWindow snippet above)**

```yaml
settings:
  nav:
    onboarding: Onboarding
    notice: Notice
    widgets: Widgets
```

Total: 91 page keys + 3 nav keys. Remember the wrapper group is `shell.` after
flattening (e.g. `shell.onboarding.v2.steps.welcome.label`), same as existing
entries. Do not forget the 10-locale leaf-parity `npx vitest run` in
`packages/i18n`.

### 4. Missing Theme tokens / component props found (for main agent)

- **No monospace font token** on `Theme` (`fontMono`) — wanted for the widgets
  JSON-dump fallback and `componentProps` rendering; worked around with bulleted
  field lists.
- **No `ACheckbox`** — upstream Vue uses `Checkbox` in gemini + fade-on-hover;
  `ASwitch` is used as a stand-in (disabled). A real checkbox would match the
  design better.
- **No gradient support expectations**: `Theme` exposes only flat colors; hero
  gradient text and the Gemini cosmic gradient need new tokens (e.g.
  `Theme.gradientA/B/C`) if wanted later.
- **`AButton` has no `loading` state** (upstream `:loading` while waiting for
  the request id) — fine while disabled, needed once the notice bridge lands.
- **`ATooltip` has no hover trigger of its own** — disabled buttons are
  wrapped in a hover-`MouseArea` wrapper `Item` to drive `visible:`. If a
  shared `ADeferredButton` component appears (the same inline wrapper is copied
  into four pages), it should live in `qml/components/` instead of being
  duplicated.
- **`ACard` fills only via anchors** — gradient/border accents beyond
  `borderColor` aren't supported; Sidebar backdrop-blur simulation like upstream
  (`backdrop-blur-md`) has no QML counterpart yet.
- **`font.capitalization: Font.AllUppercase` has no tracking/letter-spacing**
  companion on `Text`; upstream tracking classes are dropped.
- No Qt Multimedia in `qt_module(...)` list and no video asset registration
  path — needed for the fade-on-hover tutorial video.
- `Image { asynchronous: true }` remains mandatory for any remote preview
  (pattern matches ExploreModelsPage); no remote images used in these pages.

## File inventory (new, untracked)

- `apps/airi-qt/qml/pages/onboarding/OnboardingPage.qml`
- `apps/airi-qt/qml/pages/onboarding/OnboardingV3Page.qml`
- `apps/airi-qt/qml/pages/notice/NoticePage.qml`
- `apps/airi-qt/qml/pages/notice/GeminiNoticePage.qml`
- `apps/airi-qt/qml/pages/notice/FadeOnHoverNoticePage.qml`
- `apps/airi-qt/qml/pages/widgets/WidgetsPage.qml`
- this note
