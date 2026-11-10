<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane D2 — MCP settings page (QML scaffold)

Direct port of the *layout* of `packages/stage-pages/src/pages/settings/modules/mcp.vue` (+ `components/McpConnectionTestPanel.vue`) into the Qt app. **No MCP client exists in the Qt build** — the Rust side (`airi-mcp` lane) is landing separately and there is no cxx-qt bridge, no `mcp.json` access from Qt, no registry client, no probe and no tool dispatch. The page is UI-complete and honest about that: every mutating control is disabled with an explanatory hover tooltip, the page carries a persistent "not wired" banner, and the only server listed is the documented Electron default, labelled as documentation.

**Ownership:** `apps/airi-qt/qml/pages/settings/modules/mcp/**` (new directory, one file: `McpSettingsPage.qml`) + this note. Nothing else was touched — no `build.rs`, no `SettingsWindow.qml`, no components, no locale files, no Rust.

## What landed, per tab

Header row (title + `warning` "Not wired yet" badge), one-line description, the persistent amber deferred-notice `ACard` (Live2D/Discord idiom), then an `AToggleGroup` tab switcher (`ButtonGroup` attached-property semantics inside `AToggleGroup`, per Qt Quick 6).

### Tab 1 — Manage

- **Runtime Status** card: `Storage (not wired)` label + `warning` badge; the would-be config path `<appData>/airi/mcp.json` shown in a mono-ish code surface (literal text, deliberately **illustrative** — the Electron main uses `join(app.getPath('appData'), 'airi', 'mcp.json')`; nothing is read from disk) with a hint line saying so. **`Apply & Restart`** (Accent) is disabled + tooltip — it would mutate the runtime.
- **Configured Servers** section: one entry, `open-websearch`, exactly the documented Electron default (`command: npx`, `args: ["-y", "open-websearch@latest"]`, env `DEFAULT_SEARCH_ENGINE=duckduckgo`, `SEARCH_MODE=auto`, `MODE=stdio` — `apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts`). Shown with a neutral unknown-state dot, an `info` badge **"Documentation example"**, `0 TOOLS`, and an expandable detail panel (click the row to toggle): endpoint caption + `Local Stdio` badge, the command in a code surface, the default-env caption line, a "Discovered Tools" caption with an honest *"tools appear here once the bridge lists them"* line, and the action row: **Test Connection** (enabled — it only switches to the Test tab, no bridge involved), an **Enable/Disable `ASwitch`** (checked, disabled) and a **Delete** (`AButton.Danger`, disabled) — both tooltip-wrapped. A caption under the card says the entry is documentation, not the user's configuration.
- **Add a Server** section, two cards. Fields are **enabled** (they are local UI state; typing mutates nothing) — every submit action is disabled:
  - *Add Remote Server* — Server Identifier / Endpoint URL / Authorization Header (Optional) fields; **Add Remote Server** button (Accent) disabled + tooltip.
  - *Add Stdio Server* — Executable Command / Command Arguments fields; **Add Stdio Server** button (Accent) disabled + tooltip.
- Porting note: the Vue's modal dialogs ("Add Remote MCP Server", "Edit JSON") were **not** ported as modals — the lane spec asked for inline forms. There is deliberately no raw-JSON editor and no Refresh/Reconnect pair; without a bridge both would fake data or no-op invisibly. They belong to the bridge lane.

### Tab 2 — Discover

- **Search field** (placeholder carries the documented registry host `registry.modelcontextprotocol.io`) is disabled + tooltip.
- `ACard` containing `AEmptyState` (🧭) — title says registry discovery is not wired yet; subtitle says search needs the Qt bridge and a registry client, and that manual add lives on the Manage tab. No fake results grid, no fake Install buttons.

### Tab 3 — Test Connection

`AToggleGroup`-selected tab; a structural port of `McpConnectionTestPanel.vue` reduced to what can honestly render:

- **MCP Connection Test Bench** card: title + description (probe semantics: connectivity, latency, tool signatures). **Target Server** label + description, a disabled `ASelect` whose only entry is `open-websearch (Local Stdio)` (tooltip-wrapped), and **Run Probe** (Accent) disabled + tooltip. A `Target` caption row restates the selection with a `STDIO` badge and the `npx` line.
- **Discovered Tools** caption + `ACard` with `AEmptyState` (🛠️) — no tools reported; subtitle says tools appear here after a probe once the bridge lands.
- **Call a Tool** caption + `ACard`: Tool Name + Tool Arguments (JSON) fields (both disabled), and **Call Tool** (Accent) disabled + tooltip. The persistent page banner covers the "banner" requirement on top of the tooltip.

## What is disabled, and why

Everything that would need the bridge: Apply & Restart, Add Remote Server, Add Stdio Server, Delete, Enable/Disable switch, search field, Target Server combo, Run Probe, Tool Name / Tool Arguments fields, Call Tool. Tooltips (`shell.mcp.deferredTip`) say the same thing everywhere: the MCP client lands in a separate lane and this page is a layout preview.

Enabled on purpose: the three tabs (pure view switching), the server-row expand/collapse, and **Test Connection** (navigates to the Test tab).

Not ported at all (would fabricate behaviour or state): the raw JSON editor, Refresh/Reconnect, the add-server modal step machine, registry fetch/install logic, the test result callout states, and any "enabled/running" claim. `lastActionMessage`/`errorMessage` feedback surfaces are omitted — no action can fire to produce them; the persistent banner is the feedback.

## i18n keys needed — namespace `shell.mcp.*` (English source strings)

All keys below go under a top-level `mcp:` section in `packages/i18n/src/locales/*/shell.yaml` (flattened to `shell.mcp.*`, same as `widgets:` / `data:`). **Locale files were not edited in this lane.** 62 new keys + 1 nav key.

```yaml
mcp:
  title: MCP Servers & Tools
  description: Connect and manage Model Context Protocol (MCP) servers to give AIRI extensible tool capabilities.
  deferredTip: Not wired yet — the MCP client lands in a separate lane (airi-mcp). This preview shows the layout only; nothing here reads or writes your configuration.
  deferredNotice: The MCP bridge is not wired yet. Servers shown are the documented Electron defaults, not your configuration — every control below is inert until the airi-mcp lane lands.
  notWiredBadge: Not wired yet
  tabs:
    manage: Manage
    discover: Discover
    test: Test Connection
  manage:
    runtimeStatus: Runtime Status
    storageLabel: Storage (not wired)
    configPathHint: Electron default is app.getPath('appData') + '/airi/mcp.json'; the Qt bridge would follow the same convention. The path shown is illustrative, not read from disk.
    configuredServers: Configured Servers
    documentedExample: Documentation example
    exampleNote: Shown as documentation — this is the default configuration baked into AIRI Desktop (Electron main), not a server AIRI has connected to.
    serverStateUnknown: Unknown
    transportStdio: Local Stdio
    toolsNone: 0 tools
    endpointLabel: Endpoint / Command
    toolsLabel: Discovered Tools
    toolsPending: Tools appear here once the bridge lists them. None reported yet.
    envCaption: Default environment (Electron main, open-websearch)
    testConnection: Test Connection
    delete: Delete
    disable: Disable
    addSection: Add a Server
    addRemoteTitle: Add Remote Server
    addRemoteDescription: Connect a remote streamable HTTP MCP server (endpoint URL + optional Authorization header).
    nameLabel: Server Identifier
    namePlaceholder: e.g. weather-api
    urlLabel: Endpoint URL
    urlPlaceholder: https://example.com/api/mcp
    authHeaderLabel: Authorization Header (Optional)
    authHeaderPlaceholder: Bearer token…
    addRemote: Add Remote Server
    addStdioTitle: Add Stdio Server
    addStdioDescription: Launch a local MCP server process over stdio (executable + arguments).
    commandLabel: Executable Command
    commandPlaceholder: npx
    argsLabel: Command Arguments
    argsPlaceholder: -y open-websearch@latest
    addStdio: Add Stdio Server
    applyRestart: Apply & Restart
  discover:
    searchPlaceholder: Search the MCP registry (e.g. fetch, weather, remote)…
    emptyTitle: Registry discovery is not wired yet
    emptySubtitle: Searching the MCP registry needs the Qt bridge and a registry client (registry.modelcontextprotocol.io). Until it lands, add servers manually on the Manage tab.
  test:
    sectionCaption: Test Connection
    title: MCP Connection Test Bench
    description: Briefly probe an MCP server over stdio or streamable HTTP to verify connectivity, measure round-trip latency, and inspect exposed tool signatures.
    targetLabel: Target Server
    targetDescription: Select a configured server to probe.
    targetExample: open-websearch (Local Stdio)
    targetCaption: Target
    runProbe: Run Probe
    toolsCaption: Discovered Tools
    emptyToolsTitle: No tools reported
    emptyToolsSubtitle: Once the bridge is wired, the tools exposed by the selected server appear here after a probe.
    callCaption: Call a Tool
    toolNameLabel: Tool Name
    toolNamePlaceholder: e.g. search
    toolArgsLabel: Tool Arguments (JSON)
    toolArgsPlaceholder: '{ "query": "rust" }'
    callTool: Call Tool
```

YAML quoting: `authHeaderPlaceholder` and `toolArgsPlaceholder` contain characters that are safe single-quoted as shown (`Bearer token…` uses an ellipsis); quote `deferredNotice`/`configPathHint` if your yaml manager prefers (they contain an em dash and a slash — both fine unquoted, but the repo style quotes em-dash strings in shell.yaml).

> Plus **one nav key outside the namespace** (mirrors `shell.settings.nav.widgets`): `shell.settings.nav.mcp` = `MCP`.

## Integration lists (for the main agent — do NOT apply in this lane)

### 1. QML file to register in `crates/airi-qt/build.rs`

```rust
module = module.qml_file("qml/pages/settings/modules/mcp/McpSettingsPage.qml");
```

Add next to the `modules/` block once the Discord lane's registration lands (or after the `pages/settings/data/` block). `emit_rerun_if_changed` already walks the tree, so no other build.rs change is needed.

### 2. SettingsWindow.qml nav/StackLayout snippet (proposed, not applied)

Nav (after the Widgets row, before `Item { Layout.fillHeight: true }`; index 21 — everything else keeps its index):

```qml
AListItem {
    Layout.fillWidth: true
    icon: "🔌"
    title: I18n.tr("shell.settings.nav.mcp")
    active: settingsWindow.navIndex === 21
    onClicked: settingsWindow.navIndex = 21
}
```

StackLayout (after the `WidgetsPage { }` entry — order must match the nav indices):

```qml
// MCP — servers & tools scaffold (UI-only until the airi-mcp bridge lands).
McpSettingsPage {
}
```

(`import` line is not needed — the module registers the type globally like the other pages.)

## Missing Theme.* / component requests (requests, not blockers)

- **No `Theme.fontMono`** — command lines (`npx -y …`), the illustrative config path and the env line fall back to `Theme.fontBody` (Lane B precedent). Please add `readonly property string fontMono: "Monospace"` (or map to the platform mono family) so code surfaces stop improvising.
- **No mono `ACodeBlock`/`APathChip`** — the code surface is a hand-rolled `Rectangle` + `Text` (WrapAnywhere) repeated four times on this page and again in DataImportDialog/ScrubHistoryDialog. A shared component would kill the duplication.
- **No `AToggleGroup` label slot** — model strings are the only labels; icons are not possible. Fine as-is for tabs; noting it for future icon+text tab rows.
- **`ASelect` has no `label`/`description` props** — handled with external `FieldLabel`/`Text` (Live2D precedent). If a `label` prop is added, the Test tab target row simplifies.
- **No `ATooltip` on non-hoverable disabled containers** — tooltips ride on a wrapper `MouseArea` (the only reliable hover source behind a disabled control); works but each site re-declares the wrapper. An `ADisabledHint` wrapper component (content alias + tip) would remove ~5 copies of the idiom from this page alone.
- **ASwitch "checked but disabled"** renders at reduced opacity with no explanation beyond the tooltip — acceptable, but a dedicated `ASwitchRow` (label + description + disabled reason) like Discord's `DeferredSwitchRow` would be tidier; consider promoting that inline component to `qml/components/`.
- **`ABadge` variant naming** (`info` vs `accent`) — used `info` for transport/example tags and `warning` for not-wired states; if a "docs/example" variant is ever added it would fit `documentedExample` better than `info`.

## Verification

- `qmllint -I <module-sandbox>` on `McpSettingsPage.qml` — **0 warnings/errors**. Sandbox at `/tmp/opencode/qmllint-mcp/com/airi/airiqt` (copy of `qml/` + generated `qmldir`, 63 entries; module resolves `com.airi.airiqt` with Theme/I18n singletons). Sandbox deleted/left under `/tmp`, not committed.
- Brace/paren/bracket balance scan — OK (136/136, 78/78, 4/4).
- `cargo check -p airi-qt` — **not run**; no Rust was touched (lane rules), and the page is not registered in `build.rs` yet, so the mirror has nothing new to chew.
- Visual smoke — **not run** (no registration, no window); do it after the integration snippet above lands.
- Nothing committed; no git writes; `target/` untouched; discord sibling read, not modified.

## Source cross-references

- Vue page: `packages/stage-pages/src/pages/settings/modules/mcp.vue` — tab structure (manage/discover/test), server card layout, runtime-status/path block, Discover (registry `v0.1/servers`, `search` param), Add Remote modal fields, `handleTestServerFromCard` (→ `page.activeTab = 2` here).
- Vue test panel: `…/components/McpConnectionTestPanel.vue` — bench title/description, Target Server select + "Run Probe", target summary strip, disabled tool-call surface.
- Electron default MCP config & path: `apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts` (`defaultMcpConfig`, line ~132; `join(app.getPath('appData'), 'airi', 'mcp.json')`).
- Sibling scaffold (pattern source): `qml/pages/settings/modules/discord/DiscordSettingsPage.qml` — `DeferredButton`/`DeferredSwitch`-style wrappers, `AToggleGroup` tabs, persistent amber `ACard` banner, `SectionCaption`.
