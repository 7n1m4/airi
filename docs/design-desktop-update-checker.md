# Architectural Design: Lightweight Desktop Update Checker, 24-Hour GitHub Sourcing & Release Notes Drawer

**Status:** Proposed Architecture & Design Specification
**Scope:** Desktop Companion (`apps/stage-tamagotchi` Electron) / Settings Hub (`packages/stage-pages/src/pages/settings/index.vue`)
**Authoritative References:**
- [`.agents/skills/airi-release-packaging-deploy/SKILL.md`](../.agents/skills/airi-release-packaging-deploy/SKILL.md) — Release cadence, tag formats (`v0.9.x-stable.YYYYMMDD`), and binary artifacts.
- [`docs/data-catalog.md`](./data-catalog.md) — Storage keys and `localStorage` namespace inventory.
- [`packages/stage-pages/src/pages/settings/index.vue`](../packages/stage-pages/src/pages/settings/index.vue) — Settings Hub host surface.
- [`packages/stage-ui/src/composables/use-build-info.ts`](../packages/stage-ui/src/composables/use-build-info.ts) — Source for currently installed application version.
- [`packages/stage-ui/src/components/markdown/`](../packages/stage-ui/src/components/markdown/) — Native `<MarkdownRenderer />` component.
- [`apps/stage-tamagotchi/electron-builder.config.ts`](../apps/stage-tamagotchi/electron-builder.config.ts) — Electron publish target and repository metadata (`dasilva333/airi`).
- [`scripts/release/publish-win.js`](../scripts/release/publish-win.js) & [`scripts/release/publish-mac.js`](../scripts/release/publish-mac.js) — Desktop release scripts and GitHub tag publishing flow.

---

## 1. Executive Summary & Problem Statement

AIRI operates on an active development cadence, publishing new stable desktop releases approximately every 3 to 4 days (e.g., `v0.9.28` on Aug 27, `v0.9.29` on Sep 02, `v0.9.30` on Sep 07, `v0.9.31` on Sep 11, `v0.9.32` on Sep 15).

A user running an older build—such as `v0.9.17` when `v0.9.32` is current—is roughly 15 releases (~52 days / nearly 2 months) behind. Across that span, dozens of critical capabilities and fixes were shipped (e.g., Arcade Room WebAssembly copilot, dedicated audio output device switching, Cloudflare BYOS sync hardening, power-saving render loop throttling, and MCP health monitoring).

### 1.1 Why Not Full Electron Background Auto-Updating?
Background auto-updating in Electron (`electron-updater` / Squirrel / NSIS) introduces significant complexity and maintenance overhead on a divergent fork:
1. **Code Signing & Policy Gates**: Unsigned or ad-hoc signed `.exe` binaries trigger Windows SmartScreen, WDAC, and AppLocker blocks during automated background execution.
2. **Apple Notarization Pipelines**: macOS Gatekeeper strictly requires notarization tickets stapled to every update DMG/archive.
3. **Locked-File (`EBUSY`) Crashes**: In-place replacement of running binaries (`airi.exe`, `app.asar`) frequently fails with locked-file handles on Windows.
4. **Portable Builds**: Users running standalone portable `.zip` archives cannot be updated via automated installers.

### 1.2 The Pragmatic Compromise
Instead of an automated binary self-replacer, AIRI introduces a **serverless, lightweight update checker**:
- Checks GitHub Releases directly via public REST API once every 24 hours.
- Caches results in `localStorage` to eliminate redundant network traffic.
- Renders a non-intrusive notification banner strictly within the **Settings Hub** between the window header and the quick access buttons.
- Features an expandable release notes drawer rendered natively with `<MarkdownRenderer />`.
- Allows users to dismiss (`✕`) the banner, snoozing notifications until a **new, subsequent version** is released.
- Targets **`stage-tamagotchi` (Electron) only**, remaining completely inert on `stage-web` and `stage-pocket`.

---

## 2. System Architecture & Lifecycle Flow

```mermaid
flowchart TD
    subgraph Client [Settings Hub (packages/stage-pages/src/pages/settings/index.vue)]
        MOUNT["User opens /settings"]
        CHECK_DESKTOP{"isStageTamagotchi()?"}
        CHECK_CACHE{"lastCheckedAt < 24 hrs?"}
        COMPARE{"latestVersion > currentVersion?"}
        CHECK_SNOOZE{"latestVersion === dismissedVersion?"}
        RENDER_BANNER["Render Update Banner\n(Between Header & Quick Buttons)"]
        RENDER_NOTHING["Render Standard Settings Hub\n(No Banner)"]
        CLICK_EXPAND["User clicks (i) toggle"]
        EXPAND_DRAWER["Expand Accordion Drawer\n(Scrollable Markdown Release Notes)"]
        CLICK_DOWNLOAD["User clicks [Download on GitHub]"]
        OPEN_BROWSER["Open Release Page in Browser\n(shell.openExternal / window.open)"]
        CLICK_DISMISS["User clicks (X) dismiss"]
        SAVE_DISMISS["Set dismissedVersion = latestVersion\nin localStorage"]
    end

    subgraph GitHub [Public GitHub API (api.github.com)]
        GH_API["GET /repos/dasilva333/airi/releases/latest"]
    end

    MOUNT --> CHECK_DESKTOP
    CHECK_DESKTOP -- No --> RENDER_NOTHING
    CHECK_DESKTOP -- Yes --> CHECK_CACHE

    CHECK_CACHE -- Fresh (<24h) --> COMPARE
    CHECK_CACHE -- Stale (>=24h) --> GH_API
    GH_API -.->|"200 OK (tag_name, body, html_url)"| COMPARE
    GH_API -.->|"Error / Offline / Rate Limit"| RENDER_NOTHING

    COMPARE -- No (Up-to-Date) --> RENDER_NOTHING
    COMPARE -- Yes (Outdated) --> CHECK_SNOOZE

    CHECK_SNOOZE -- Yes (Snoozed) --> RENDER_NOTHING
    CHECK_SNOOZE -- No --> RENDER_BANNER

    RENDER_BANNER --> CLICK_EXPAND
    CLICK_EXPAND --> EXPAND_DRAWER
    RENDER_BANNER --> CLICK_DOWNLOAD
    CLICK_DOWNLOAD --> OPEN_BROWSER
    RENDER_BANNER --> CLICK_DISMISS
    CLICK_DISMISS --> SAVE_DISMISS
    SAVE_DISMISS --> RENDER_NOTHING
```

---

## 3. Remote Sourcing Specification

### 3.1 Endpoint
- **URL**: `https://api.github.com/repos/dasilva333/airi/releases/latest`
- **Method**: `GET`
- **Headers**:
  ```http
  Accept: application/vnd.github+json
  X-GitHub-Api-Version: 2022-11-28
  ```
- **Authentication**: None required.
- **CORS**: GitHub sets `access-control-allow-origin: *` for public release endpoints.

### 3.2 Response Payload Extraction
```typescript
interface GitHubReleaseResponse {
  tag_name: string // e.g. "v0.9.32-stable.20260915"
  name: string // e.g. "AIRI v0.9.32-stable.20260915"
  html_url: string // e.g. "https://github.com/dasilva333/airi/releases/tag/v0.9.32-stable.20260915"
  body: string // Markdown changelog string
  published_at: string // ISO 8601 timestamp
  prerelease: boolean
  draft: boolean
}
```

### 3.3 Rate Limiting & Resilience Contract
1. **Rate Limit Boundary**: Unauthenticated GitHub API calls are limited to 60 requests/hour per IP.
2. **Frequency Cap**: With the 24-hour cache, a client executes at most 1 query per 24-hour period.
3. **Silent Failure**: All network calls are wrapped in a strict `try/catch`. If an HTTP 403 (rate limited), HTTP 404, DNS error, or offline state occurs:
   - The error is logged to console at `debug` level.
   - The UI does not display error alerts or toasts.
   - The application silently continues using cached data or skips displaying the banner until the next cycle.

---

## 4. Version Comparison Algorithm

The versioning format used across package configurations and release tags includes semver plus optional date-stamp tags:
- Tag shape: `v[major].[minor].[patch][-stable.[YYYYMMDD]]` (e.g. `v0.9.32-stable.20260915` or legacy `v0.9.17`).
- Installed shape from `useBuildInfo().version`: `[major].[minor].[patch][-stable.[YYYYMMDD]]` (e.g. `0.9.32-stable.20260915` or `'dev'`).

### 4.1 Parsing & Comparison Contract
```typescript
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  dateStamp: number
  raw: string
}

export function parseVersion(versionStr: string): ParsedVersion | null {
  if (!versionStr || versionStr === 'dev')
    return null

  const cleaned = versionStr.trim().replace(/^v/, '')
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-stable\.(\d{8}))?/)
  if (!match)
    return null

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    dateStamp: match[4] ? Number.parseInt(match[4], 10) : 0,
    raw: versionStr,
  }
}

export function isNewerVersion(remoteStr: string, currentStr: string): boolean {
  const remote = parseVersion(remoteStr)
  const current = parseVersion(currentStr)

  // If running in local development mode ('dev'), do not flag an update
  if (!current || !remote)
    return false

  if (remote.major !== current.major)
    return remote.major > current.major
  if (remote.minor !== current.minor)
    return remote.minor > current.minor
  if (remote.patch !== current.patch)
    return remote.patch > current.patch

  // Same semver: check daily date stamp (e.g. 20260915 vs 20260911)
  if (remote.dateStamp && current.dateStamp)
    return remote.dateStamp > current.dateStamp

  return false
}
```

---

## 5. Storage Schema & Data Catalog Entry

The update checker persists its state in browser `localStorage` under `settings/system/update-checker`.

### 5.1 Schema
```typescript
export interface DesktopUpdateCache {
  lastCheckedAt: number // Unix epoch timestamp in ms
  latestVersion: string | null // e.g. "v0.9.32-stable.20260915"
  releaseTitle: string | null // e.g. "AIRI v0.9.32-stable.20260915"
  releaseUrl: string | null // GitHub release URL
  releaseNotes: string | null // Markdown body
  publishedAt: string | null // ISO string
  dismissedVersion: string | null // Version string snoozed by user (cleared on newer tag)
}
```

### 5.2 Data Catalog Addition (`docs/data-catalog.md`)
| Key | Type | Description |
| :--- | :--- | :--- |
| `settings/system/update-checker` | `DesktopUpdateCache` (JSON string) | Stores last GitHub release check timestamp, latest tag/notes, and user snooze status for desktop update notifications. |

---

## 6. UI & Surface Implementation

### 6.1 Placement
In `packages/stage-pages/src/pages/settings/index.vue`:
```vue
<template>
  <div flex="~ col gap-8" pb-12 font-normal>
    <!-- Desktop Update Banner (isStageTamagotchi only) -->
    <SettingsUpdateBanner />

    <!-- Quick Access Shortcuts -->
    <SettingsQuickAccess />

    <div v-for="group in settingsGroups" :key="group.id" flex="~ col gap-4">
      ...
    </div>
  </div>
</template>
```

### 6.2 Component Specification: `SettingsUpdateBanner.vue`

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  ✨  You are on version 0.9.17. Latest version v0.9.32 is available.                   │
│      [ Download on GitHub ↗ ]    [ (i) View Release Notes ▾ ]                      [ ✕ ] │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  ▼ EXPANDED DRAWER (Scrollable max-h-64)                                               │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ # 🚀 AIRI v0.9.32-stable.20260915 — Release Notes                                │  │
│  │ This release introduces the Arcade Room & Autonomous Game Copilot...             │  │
│  │ • Audio Output Device Selection                                                  │  │
│  │ • Cloudflare & BYOS CloudSync Infrastructure Overhaul                            │  │
│  │ • 100% Localization Parity Across 9 Languages                                    │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Visual Styles & Conventions:
- **Card Styling**:
  ```vue
  :class="[
    'relative overflow-hidden rounded-2xl p-4 transition-all duration-300',
    'border border-primary-500/30 bg-gradient-to-r from-primary-500/10 via-primary-500/5 to-transparent',
    'dark:border-primary-400/30 dark:from-primary-400/15 dark:via-primary-400/5',
    'shadow-xs backdrop-blur-md',
  ]"
  ```
- **Typography & Colors**:
  - Accent badge / icon: `i-solar:cloud-download-bold-duotone` with gentle pulse.
  - Text: `text-xs sm:text-sm font-medium text-neutral-800 dark:text-neutral-200`.
  - Versions styled with inline mono badges: `:class="['px-1.5 py-0.5 rounded bg-primary-500/15 font-mono font-semibold text-primary-600 dark:text-primary-300']"`.
- **Buttons**:
  - `[Download on GitHub]`: Primary styled button opening `releaseUrl` in browser.
  - `[(i) Release Notes]`: Secondary toggle button switching drawer visibility.
  - `[✕]`: Subtle icon button setting `dismissedVersion = latestVersion`.
- **Drawer Details**:
  - Animated with smooth Vue `<Transition name="expand">` or CSS grid height transition.
  - Inner scrollable container: `max-h-64 overflow-y-auto rounded-xl bg-neutral-900/40 p-4 border border-neutral-800/60 scrollbar-thin`.
  - Renders release body using `@proj-airi/stage-ui/components` `<MarkdownRenderer :content="releaseNotes" />`.

---

## 7. Precise Boundaries & Explicit Non-Goals

1. **No Application-Wide Nagging**: The banner will **not** appear in the stage window, control strip, chat window, or floating widgets. It remains strictly within the Settings Hub.
2. **No Automatic Background Binary Downloads**: The app will never download executables or run background installer processes in the background.
3. **No Manual Check Clutter**: No extra "Check for updates" buttons will be added to Settings headers or About dialogs. The check is completely automatic on page load if 24 hours have elapsed.
4. **No Web or Pocket Deployment**: Gated strictly by `isStageTamagotchi()`. Docker/Pages and Capacitor users will never see this component.
5. **No Custom Backend Service**: All data is fetched directly from GitHub's public API without intermediary servers.

---

## 8. Planned File Modifications

| Component | Path | Action | Description |
| :--- | :--- | :--- | :--- |
| Composable | `packages/stage-pages/src/pages/settings/composables/use-desktop-release-checker.ts` | **NEW** | Sourcing logic, 24h caching, version parsing, snooze handling. |
| Component | `packages/stage-pages/src/pages/settings/components/SettingsUpdateBanner.vue` | **NEW** | Banner card, action buttons, expandable markdown drawer. |
| Page Host | `packages/stage-pages/src/pages/settings/index.vue` | **MODIFY** | Mount `SettingsUpdateBanner` above `SettingsQuickAccess`. |
| Documentation | `docs/data-catalog.md` | **MODIFY** | Document `settings/system/update-checker` localStorage key. |
| Tests | `packages/stage-pages/src/pages/settings/composables/use-desktop-release-checker.spec.ts` | **NEW** | Unit tests for version comparison, snooze, and 24h expiry. |

---

## 9. Verification & Testing Strategy

1. **Unit Testing**:
   - Verify `parseVersion` against standard semver (`0.9.17`), date-stamped versions (`0.9.32-stable.20260915`), and dev builds (`dev`).
   - Verify `isNewerVersion`:
     - `0.9.32` > `0.9.17` $\rightarrow$ `true`
     - `0.9.32-stable.20260915` > `0.9.32-stable.20260911` $\rightarrow$ `true`
     - `0.9.32` > `0.9.32` $\rightarrow$ `false`
     - `'dev'` vs any $\rightarrow$ `false`
   - Verify 24-hour cache expiry and snooze clearing when a newer version arrives.
2. **Typecheck & Lint**:
   - `pnpm -F @proj-airi/stage-pages typecheck`
   - `pnpm -F @proj-airi/stage-tamagotchi typecheck`
3. **Git Status & Working Tree Safety**:
   - Run `git status` to verify clean staging and zero unrelated file mutations.
