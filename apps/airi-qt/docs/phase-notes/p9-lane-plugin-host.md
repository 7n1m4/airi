<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane G4 — Plugin Host devtools page (QML scaffold)

Direct port of the *layout* of `packages/stage-pages/src/pages/devtools/plugin-host.vue` into the Qt app, following the MCP/Discord scaffold idiom (persistent "not wired" banner + disabled controls + `ATooltip` on wrapper hover). **No plugin host exists in the Qt build** — no manifest discovery on disk, no enablement store, no `@proj-airi/plugin-sdk` bridge, no sessions, no capability bus. The page is honest about that everywhere: a persistent amber banner, "Not wired"/"Unknown / not wired" states only (never "Running"), and every mutating control disabled with an explanatory tooltip. Nothing is persisted.

**Ownership:** `apps/airi-qt/qml/pages/devtools/plugin-host/**` (new directory, one file: `PluginHostPage.qml`) + this note. Nothing else was touched — no `build.rs`, no `SettingsWindow.qml`, no components, no locale files, no Rust. This is a **devtools page**, not a settings page; it is intentionally not registered anywhere and will be wired by the main agent.

## What the Vue page is, for context

`plugin-host.vue` is an Electron-only debug console for `@proj-airi/plugin-sdk`'s `PluginHost`, backed by a debug store (`devtools/plugin-host-debug`) that proxies IPC to the main process. Sections: availability `Callout` (only when the runtime lacks the host), a 4-up stats grid (Discovered / Enabled / Loaded / Capabilities-ready), a filter field + Refresh / Load Enabled buttons, a load-by-exact-name field + button, a "Discovered Plugins" section (one card per manifest: name, enabled/loaded/new chips, enable + Load + Unload buttons, manifest path, entrypoints, and — when a session exists — a phase chip + module id), an "Enabled Plugins" chip row, a "Loaded Plugins" list with phase chips, and a "Capabilities" list (key, state, updated-at, metadata JSON). In this port, all of that renders as an inert scaffold.

What a "plugin" is here: an AIRI plugin discovered from **manifest files** on disk — not a package import. The integrations shipped in this repo (`integrations/claude-code/airi-plugin-claude-code`, `integrations/oh-my-pi/airi-plugin-oh-my-pi`, `integrations/vscode/airi-plugin-vscode`) are `@proj-airi/airi-plugin-*` packages bridging AIRI to external systems (Claude Code CLI, oh-my-pi, VS Code); **none of them ships a plugin-host manifest today**, and none is installed by the Qt build. They are shown in the page as clearly-labelled documentation examples only.

Lifecycle phases shown as chips in the Vue (`phaseChipTheme`): `loading`, `authenticating`, `preparing` (amber), `ready` (emerald), `failed` (amber), everything else neutral. The full state machine in `packages/plugin-sdk/src/plugin-host/core.ts` is: `loading → loaded → authenticating → authenticated → announced → preparing → waiting-deps → prepared → configuration-needed → configured → ready`, plus `failed` and the final `stopped`. Capability states: `announced | ready | degraded | withdrawn`.

Config/env surfaces: the enablement store (`plugins-v1.json`, schema `{ enabled: string[], known: Record<name, { path }> }`), the manifest root (`<userData>/plugins/v1`), and the per-session cwd (the manifest's parent directory). There is **no host TCP port** — see the port correction below.

## Section breakdown (as built)

Header row: title **Plugin Host** + `warning` "Not wired yet" badge; one-line description; persistent amber deferred-notice `ACard` (Live2D/MCP idiom).

1. **Plugin Host Status** — `SectionCaption` + `ACard`. Status dot (neutral `Theme.textSecondary`, never green), "Not wired" text + `warning` badge. `SpecRow`s: Host state → `Not wired`; Plugin bus → `Unknown / not wired`; Manifest root → `<userData>/plugins/v1` (illustrative literal, not read); Enablement store → `plugins-v1.json` (illustrative literal); Port → `None — in-process host`; plus an 11px hint that 6121 is the channel server and unrelated.
2. **Stats tiles** — 4-up `StatTile` grid (Discovered / Enabled / Loaded / Capabilities), all values `—`. Nothing is measured; `0` would claim "we checked", `—` claims "unknown".
3. **Installed Plugins** — `SectionCaption`, disabled filter `ATextField` + disabled **Refresh** + **Load Enabled** (`DeferredButton`, Accent), then a disabled load-by-name `ATextField` + **Load Plugin** row (exact-name semantics from the Vue, inert). `ACard` containing `AEmptyState` (🧩, "No plugins installed in this build"). Below, a **Documentation Example — Not Installed** caption + `info` badge, with three `ExamplePluginRow`s (name, package name + version, repo path, `info` "Documentation example" badge, neutral "Not wired" lifecycle chip, disabled enable `ASwitch`, disabled **Load**/**Unload** buttons, all tooltip-wrapped) for `airi-plugin-claude-code`, `airi-plugin-oh-my-pi`, `airi-plugin-vscode` (all `v0.9.0-alpha.15`, `integrations/…` paths). Footer caption: these are repository integration packages, none ships a manifest today, and this build discovers nothing from disk.
4. **Capabilities** — `SectionCaption` + `ACard` with `AEmptyState` (📡, "No capabilities announced"); subtitle explains capabilities appear here once a host is wired and plugins announce `module:contribute:capability` over the bus.
5. **Actions** — `SectionCaption` + row of disabled tooltip-wrapped **Reload Plugins**, **Open Plugin Folder**, **New Plugin Scaffold** (Accent).
6. **Plugin Host Settings (Not Wired)** — `SectionCaption` + `ACard` with disabled tooltip-wrapped fields: **Port** (placeholder `Not wired`, hint reiterating 6121 ≠ plugin host), **Log Level** (disabled `ASelect`, `["debug","info","warn","error"]`, index 1), **Plugin Directory** (placeholder `<userData>/plugins/v1`, hint describing `<pluginDir>/<plugin>/*.json` discovery and `plugins-v1.json` persistence), and a disabled **Save & Restart Host** (Accent).

The Vue's per-plugin enable/load/unload, enabled/loaded chip sections, and the raw session id/module id line are not separately rendered — there is nothing to enable, load, or session. The "Enabled/Loaded" views are replaced by the honest empty state + documentation example rows; the filtered/sort/refresh machinery is inert scaffolding.

## Port correction (verified, do not "fix" the page to 6121)

The lane brief asked about "port 6121?" for the plugin host. 6121 is the **AIRI channel server** port (`apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts`, overridable via `env.SERVER_CHANNEL_PORT`, loopback-first, authToken handshake) — it has nothing to do with the plugin host. The plugin host is **in-process** in the Electron main process; there is no TCP port, no listening socket, no bus address. The page therefore shows `None — in-process host` for Port and `Unknown / not wired` for Plugin bus, with an explicit hint line. Do not substitute a port number; any value would be fiction.

## What is disabled, and why

Everything that would need a host: filter field, Refresh, Load Enabled, load-by-name field, Load Plugin, per-example enable switch, Load, Unload, Reload Plugins, Open Plugin Folder, New Plugin Scaffold, Port, Log Level, Plugin Directory, Save & Restart Host. All carry `ATooltip`s with `shell.pluginHost.deferredTip` (the wrapper-hover idiom — disabled controls don't emit mouse events, so the `MouseArea` rides on the wrapper).

Enabled on purpose: nothing interactive. (Unlike MCP, there are no tabs to switch and no expandable example rows — the example rows are flat documentation. If the main agent wants expandable details later, mirror the MCP `exampleExpanded` idiom.)

Not ported at all (would fabricate behaviour or state): refresh/load IPC, `isAvailable` callout states, `isNew` computed-from-config semantics, session `phase` chips with live data, capability `updatedAt`/metadata rendering, `toast.error` feedback (no action can fire to produce it), and the raw JSON entrypoints dump.

## i18n keys needed — namespace `shell.pluginHost.*` (English source strings)

All keys go under a top-level `pluginHost:` section in `packages/i18n/src/locales/*/shell.yaml` (flattened to `shell.pluginHost.*`, same convention as `mcp:` / `discord:`). **Locale files were not edited in this lane.** 50 keys, no nav key (devtools page, not a settings entry — main agent decides how it is reached).

```yaml
pluginHost:
  title: Plugin Host
  description: Inspect and manage AIRI plugins: discovered manifests, enablement, loaded sessions and announced capabilities.
  notWiredBadge: Not wired yet
  deferredTip: Not wired yet — no plugin host exists in the Qt build. This preview shows the layout only; nothing here discovers, loads or persists plugins.
  deferredNotice: The plugin host is not wired in this build. No manifests are discovered from disk, no plugin is loaded, and every control below is inert until a Qt plugin host (or an Electron-style bridge) lands.
  stats:
    discovered: Discovered
    enabled: Enabled
    loaded: Loaded
    capabilities: Capabilities
  host:
    section: Plugin Host Status
    stateLabel: Host state
    stateValue: Not wired
    busLabel: Plugin bus
    busValue: Unknown / not wired
    manifestRootLabel: Manifest root
    configLabel: Enablement store
    portLabel: Port
    portValue: None — in-process host
    portHint: The Electron plugin host runs in-process in the main process and has no TCP port. Port 6121 belongs to the AIRI channel server (SERVER_CHANNEL_PORT) and is unrelated to the plugin host.
  installed:
    section: Installed Plugins
    emptyTitle: No plugins installed in this build
    emptySubtitle: Nothing here discovers or loads plugins yet. When a host lands, manifests found in the manifest root appear in this list.
  examples:
    section: Documentation Example — Not Installed
    badge: Documentation example
    chipNotWired: Not wired
    load: Load
    unload: Unload
    note: These are repository integration packages under integrations/, shown to document what a plugin looks like. None ships a plugin-host manifest today, and this build discovers nothing from disk.
  filter:
    placeholder: Filter discovered plugins…
  actions:
    section: Actions
    refresh: Refresh
    loadEnabled: Load Enabled
    loadByNamePlaceholder: Load discovered plugin by exact name…
    loadPlugin: Load Plugin
    reload: Reload Plugins
    openDir: Open Plugin Folder
    newScaffold: New Plugin Scaffold
  capabilities:
    section: Capabilities
    emptyTitle: No capabilities announced
    emptySubtitle: Capabilities appear here once a host is wired and plugins announce module:contribute:capability entries over the plugin bus.
  hostSettings:
    section: Plugin Host Settings (Not Wired)
    portLabel: Port
    portDescription: The hypothetical host port. The real host is in-process and has none.
    portPlaceholder: Not wired
    portHint: Port 6121 is the AIRI channel server (SERVER_CHANNEL_PORT), not the plugin host. Any value here would be fiction.
    logLevelLabel: Log Level
    pluginDirLabel: Plugin Directory
    pluginDirPlaceholder: <userData>/plugins/v1
    pluginDirHint: Manifests are read from <pluginDir>/<plugin>/*.json; enablement persists to plugins-v1.json alongside the app config.
    save: Save & Restart Host
```

YAML quoting: `deferredNotice`, `portHint`, `hostSettings.portHint` and `examples.note` contain em dashes — fine unquoted, but the repo style quotes em-dash strings in `shell.yaml`. `filter.placeholder` and `loadByNamePlaceholder` end in `…`; single-quote if the yaml manager prefers. `pluginDirPlaceholder` contains `<`/`>`; safe unquoted, quote if preferred.

## What the real host needs (from `apps/stage-tamagotchi/src/main/services/airi/plugins/index.ts`)

Read in full (352 lines). Characterization for whoever wires a Qt host:

- **Plugin directory layout.** `pluginsRoot = join(app.getPath('userData'), 'plugins', 'v1')`. `loadManifestsFrom` does `mkdir(root, { recursive: true })`, `readdir(root, { withFileTypes: true })`, and for each **top-level directory** scans its entries; every `*.json` file directly inside a plugin dir is a manifest candidate. Symlinks are allowed only if they resolve to a `.json` **file** (`realpath` + `stat` + `extname` check); anything else is skipped with a warning. Manifests must parse as JSON and validate against `manifestV1Schema` (`safeParse`); invalid ones are logged and skipped.
- **How plugins are declared.** `ManifestV1` (`packages/plugin-sdk/src/plugin-host/core.ts`): `{ apiVersion: 'v1', kind: 'manifest.plugin.airi.moeru.ai', name: string, entrypoints: { default?, electron?, node?, web? } }`. Entrypoint resolution: `entrypoints[runtime] ?? entrypoints.default ?? entrypoints.electron` (the trailing `electron` is the legacy fallback for current local manifests). `cwd` for the session is `dirname(manifestPath)`.
- **Enablement persistence.** `createConfig('plugins', 'v1.json', pluginConfigSchema, { default: { enabled: [], known: {} }, autoHeal: true })` — an auto-healing JSON store next to the app config (`plugins-v1.json`; Windows `%APPDATA%\<appId>\plugins-v1.json`, Linux `$XDG_CONFIG_HOME/<appId>/plugins-v1.json` or `~/.config/<appId>/plugins-v1.json`, macOS `~/Library/Application Support/<appId>/plugins-v1.json`). `enabled: string[]` holds names; `known: Record<name, { path }>` marks "seen before" — a discovered manifest missing from `known` is flagged `isNew`.
- **Host lifecycle.** `new PluginHost({ runtime: 'electron' })` from `@proj-airi/plugin-sdk/plugin-host`, run **in-process** in the main process. `setupPluginHost()` is called once at startup (injeca lifecycle): it refreshes manifests, then `loadEnabled()` — every enabled plugin starts immediately. State machine per session: `loading → loaded → authenticating → authenticated → announced → preparing → waiting-deps → prepared → configuration-needed → configured → ready`, plus `failed` (any stage, via `SESSION_FAILED`) and `stopped` (final). Targets for `STATUS_FAILED` transitions etc. are asserted by `assertTransition`; the Vue's chips come from `session.phase`.
- **IPC surface (eventa).** `electronPluginList` / `electronPluginSetEnabled` / `electronPluginLoadEnabled` / `electronPluginLoad` / `electronPluginUnload` / `electronPluginInspect` / `electronPluginUpdateCapability`, plus `pluginProtocolListProviders` (provider-list resolution). `electronPluginInspect` returns the debug snapshot the devtools page renders: registry snapshot (`root` + per-manifest summaries), `sessions` (id, manifestName, phase, runtime, moduleId), `capabilities` (key/state/updatedAt/metadata), `refreshedAt`.
- **Capabilities.** `announceCapability(key, metadata)` / `markCapabilityReady(key, metadata)` on the host (cast to a `CapabilityAwarePluginHost`); if `payload.key === pluginProtocolListProvidersEventName && state === 'ready'`, the host's providers-list resolver is bound to the eventa invoke. Capability states: `announced | ready | degraded | withdrawn`.
- **What a Qt host needs to reach parity:** a manifest scanner + validator (or a Rust side using `walkdir`+`serde` mirroring the valibot schema), an enablement store equivalent to `plugins-v1.json`, a plugin-sdk bridge (or a Rust `PluginHost`) running sessions in-process, eventa-equivalent IPC (cxx-qt bridges), and a devtools window hosting this page with a `PluginHostDebug`-equivalent QObject (discovered/enabled/loaded/sessions/capabilities + `refreshAll`). Until then this page stays inert.

## Integration lists (for the main agent — do NOT apply in this lane)

### 1. QML file to register in `crates/airi-qt/build.rs`

```rust
// After the discord block (or in a new devtools block once one exists):
module = module.qml_file("qml/pages/devtools/plugin-host/PluginHostPage.qml");
```

`emit_rerun_if_changed` already walks the `qml/` tree recursively, so no other build.rs change is needed. Without this line the page is not in the module and nothing else works.

### 2. Devtools registration (proposed, not applied)

This page is devtools, not settings — it does **not** belong in `SettingsWindow.qml`'s nav/StackLayout (that would misfile it as a settings surface, and the lane rules forbid it). Suggested shape once the main agent lands a devtools host window (or a devtools section inside an existing debug window):

```qml
// StackLayout (order must match its nav indices in the devtools window):
// Plugin Host — devtools scaffold (UI-only until a Qt plugin host lands).
PluginHostPage {
}
```

If the main agent does decide to surface it in SettingsWindow temporarily (not recommended), mirror the mcp/discord registration: one `AListItem` in the nav (index after `DiscordSettingsPage`, i.e. current 22 — verify against the live file, indices shift), one StackLayout entry, and one nav key `shell.settings.nav.pluginHost: Plugin Host` (note: that nav key deliberately lives outside `shell.pluginHost.*` and was **not** added to the key list above). Prefer the devtools host.

### 3. Nav key (only if a devtools nav exists)

`shell.devtools.nav.pluginHost: Plugin Host` — namespace TBD by the main agent's devtools shell; not included in the 50 keys above.

## Missing Theme.* / component requests (requests, not blockers)

- **No `Theme.fontMono`** — manifest paths, the example repo-path lines, `<userData>/plugins/v1` and the entrypoint/path lines fall back to `Theme.fontBody` (Lane B/MCP precedent). Please add a mono family so code/path surfaces stop improvising.
- **No mono `ACodeBlock`/`APathChip`** — the illustrative path surfaces are plain `Text` with `WrapAnywhere`. Fine for two lines; would not survive a manifest dump view.
- **No `ASpecRow`** — the `SpecRow` (label : value row) here is inline and duplicates the ad-hoc status-row pattern already inlined in Discord/MCP status cards. Promote to `qml/components/` when a third user appears (Live2D/MMD hints already lean on it).
- **No `AStatTile`** — the 4-up Discovered/Enabled/Loaded/Capabilities grid tile is inline; promote alongside `ASpecRow` if other devtools pages need the same grid (websocket-inspector, core-ai-lab ports will).
- **`AEmptyState` has no lifecycle-chip slot** — the "Not wired" lifecycle chip for example rows is a plain `ABadge variant:"default"`. If a dedicated `AStatusChip` (neutral/amber/emerald by `phase` prop) lands, both this page and any future live session rows get consistent phase chips.
- **`ABadge` neutral `default` vs `info`** — used `info` for "Documentation example" and `default` for "Not wired" lifecycle chips; if a "docs/example" or "unknown" variant is ever added it would fit both better than reusing `info`/`default`.
- **`ASelect` disabled placeholder text** — the Log Level select shows `info` as currentIndex 1; there is no "not configured" affordance, so the disabled control can read as a real persisted value. A `placeholderText: "Not wired"` or a disabled-with-tooltip-only mode would be more honest once one exists.
- **No `ATooltip` on non-hoverable disabled containers** — same wrapper-`MouseArea` idiom as MCP/Discord (~8 copies on this page). An `ADisabledHint` wrapper would collapse these; already requested by the MCP lane.

## Verification

- `qmllint -I <module-sandbox>` on `PluginHostPage.qml` — **silent, exit 0**. Sandbox at `/tmp/opencode/qmllint-pluginhost/com/airi/airiqt` (copy of `qml/` + the generated `qmldir` from `target/debug/build/airi-qt-a0710cbb1232d6b7/out/qt-build-utils/`, with `PluginHostPage 1.0 qml/pages/devtools/plugin-host/PluginHostPage.qml` appended; module copy deleted/left under `/tmp`, not committed). Cross-checked: the sibling `McpSettingsPage.qml` and `DiscordSettingsPage.qml` in the same sandbox also lint silent, exit 0. (First sandbox attempt had module-relative `qmldir` paths wrong — it produced import/unresolved noise for *every* type including singletons; rebuilt with `qml/` nested inside the module dir and output went clean.)
- Brace/paren/bracket balance scan — OK (125/125, 73/73, 1/1).
- Hardcoded-hex scan — none; all colors via `Theme.*`; all strings via `I18n.tr` (only glyph literals `⚠`/`—`/emoji are inline).
- `cargo check -p airi-qt` — **not run**; no Rust was touched (lane rules), and the page is not registered in `build.rs` yet, so the mirror has nothing new to chew.
- Visual smoke — **not run** (no registration, no window); do it after the integration snippet lands.
- Nothing committed; no git writes; `packages/**` and `apps/stage-tamagotchi/**` untouched and read-only per lane rules.

## Source cross-references

- Vue page: `packages/stage-pages/src/pages/devtools/plugin-host.vue` — section structure, stats grid, per-plugin card/actions, phase chips (`phaseChipTheme`), capabilities list.
- Electron host: `apps/stage-tamagotchi/src/main/services/airi/plugins/index.ts` — manifest discovery, enablement store, host lifecycle, eventa IPC.
- Manifest schema & session phases: `packages/plugin-sdk/src/plugin-host/core.ts` (`manifestV1Schema`, `ManifestV1`, `PluginSessionPhase`, `lifecycleTransitionEvents`, `resolveEntrypointFor`).
- Example integrations: `integrations/claude-code/airi-plugin-claude-code/package.json`, `integrations/oh-my-pi/airi-plugin-oh-my-pi/package.json`, `integrations/vscode/airi-plugin-vscode/package.json` (all `@proj-airi/airi-plugin-*`, `v0.9.0-alpha.15`, private, Channel-Server bridges — **no plugin-host manifests**).
- Sibling scaffolds (pattern sources): `qml/pages/settings/modules/mcp/McpSettingsPage.qml`, `qml/pages/settings/modules/discord/DiscordSettingsPage.qml` — `DeferredButton`/`DeferredSwitch` wrappers, persistent amber banner, `SectionCaption`/`FieldLabel`, `AEmptyState`, documented-example idiom.
