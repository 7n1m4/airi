<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane E — Discord messaging module settings page (QML port)

UI-complete **scaffold** of the Discord module settings page into the Qt app. **No Rust Discord gateway exists in the Qt build.** No bot connection, no token store, no websocket lifecycle, no guild/channel fetch, no event log, no ACL/routing engine. Every action is rendered but disabled with an explanatory tooltip, and the page says so persistently in its banner. The upstream Vue page was used for **structure only** — its store (`useDiscordStore`, `packages/stage-ui/src/stores/modules/discord.ts`) is a pinia wrapper over Electron `eventa` invokes/events that do not exist here, so nothing was ported line-by-line and the stage-tamagotchi main-process service was **not** read in depth.

Source of truth for structure: `packages/stage-pages/src/pages/settings/modules/messaging-discord.vue` (thin wrapper) → `packages/stage-ui/src/components/modules/MessagingDiscord.vue` (the real page, read fully). Types consulted for shape: `packages/stage-shared/src/discord.ts` (`DiscordServiceStatus`, `DiscordGuildInfo`, `DiscordEventLogEntry`) and the store's `settings/discord/*` localStorage keys.

## What landed, per file

**`qml/pages/settings/modules/discord/DiscordSettingsPage.qml`** (new; the directory is the whole lane scope) — faithful in section structure to the Vue page. SPDX header, `I18n.tr("shell.discord.*")` only, `Theme.*` only, components from `qml/components/*.qml` only (`ACard`, `ABadge`, `AButton`, `AEmptyState`, `ASeparator`, `ASwitch`, `ATextField`, `ATooltip`, `AToggleGroup`), Qt Quick 2.15 imports consistent with the rest of `qml/`, no hardcoded English or hex. Three local inline components carry the honest deferred idiom (`DeferredSwitchRow`, `DeferredButton`, `FallbackOption`) — disabled control + `ATooltip` on wrapper hover.

### Section-by-section

- **Header** — "Discord" title, warning `ABadge` ("Not wired yet"), one-line description.
- **Persistent deferred notice** (both tabs) — `ACard` with `Theme.warning` border, ⚠ glyph, Live2D/Widgets-deferred style. States plainly that the module is not wired to a Rust gateway and every action is disabled.
- **Tabs** — `AToggleGroup` ("Bot Connection" / "Access & Routing"), `page.activeTab` switches two `ColumnLayout`s via `visible`. (Upstream used hand-rolled tab buttons with solar icons; `AToggleGroup` is the house component.)
- **TAB 1 · Bot Connection**
  - **Connectivity** caption + `ACard`:
    - Connection status row: grey dot, "Not wired" label, em-dash placeholder for the ping (never a fabricated `0 ms`), warning badge. Bot user tag and ping are omitted — they cannot exist; the row is the honest "disconnected-forever" state. Upstream `error` banner intentionally omitted (there is no gateway to produce an error; a permanently-hidden banner would be dead code).
    - **Bot token** — `ATextField` with `echoMode: TextInput.Password` (supported: `ATextField` subclasses `TextField`; no component change needed), label + description + placeholder, **disabled** with wrapper tooltip. Typing a token here would be silently swallowed, which is worse than not letting you type.
    - **Bot Owner / Primary Username** — `ATextField` (plain echo), label + description + placeholder, **disabled** with tooltip. Below it, dimmed: `Resolved Owner ID: not resolved — gateway bridge required.` (owner ID resolution needs the gateway to look up the handle).
    - **Connect / Disconnect** — `AButton` `Accent` / `Danger`, **disabled** with wrapper tooltips. (Upstream had a single Start/Stop toggle obeying `configured`; it required a token store to be meaningful at all, so it is two honest dead buttons.)
  - **Controls & Modalities** caption + `ACard`:
    - **Screen & Image Vision** — disabled `ASwitch` row + tooltip (`visionEnabled` upstream, `settings/discord/visionEnabled`).
    - **Allow Direct Messages (DMs)** — disabled `ASwitch` row + tooltip (`dmsEnabled` upstream, `settings/discord/dmsEnabled`).
    - These are the page's Behavior toggles. The relay side of "Behavior/relay options" lives in TAB 2 as the disabled fallback-mode cards — no relay behavior exists to toggle either.
  - **Active Presence** caption + `ACard`: `AEmptyState` (🌐) — title "Guilds & channels unavailable", subtitle explains lists populate once the gateway bridge lands — plus a warning "Bridge required" badge. Upstream renders `serviceStatus.guilds` with icon/placeholder and an `Active` badge for `activeChannelId`; none of that data can exist.
  - **Debug Actions** caption — three disabled `AButton`s with tooltips: **Force Card Sync**, **Simulate Event**, **Restart Gateway** (all `!isConnected`-gated upstream; there is no connection to gate on). Upstream's inline *Simulate dialog* (username + content + Send) is intentionally **not ported**: it would let you "fire" a simulated event against nothing. Simulate events, when the bridge lands, should re-open the upstream dialog shape.
  - **Developer Console** caption — `ACard` with a right-aligned **disabled** "Clear Log" button and a dimmed dashed-look console box (`Theme.bg` + `Theme.border`; Qt Quick has no dashed `Rectangle`) showing "No events yet — the event log arrives with the gateway bridge." Upstream renders a live `[...eventLog].reverse()` list with per-type colors and a collapsible ▶ header; there is no log source and collapsing nothing would be theatre. A color-coded type legend was not ported for the same reason.
- **TAB 2 · Access & Routing** — the upstream page labelled this "DEMONSTRATION PURPOSES ONLY / EARLY ACCESS PREVIEW" and rendered mock rows. It is ported fully inert:
  - **Preview banner** — `ACard` `Theme.warning` border: the two upstream badges (warning "DEMONSTRATION PURPOSES ONLY", default "EARLY ACCESS PREVIEW"), preview title, preview body (verbatim upstream copy, minus the link), and a **disabled** "Discord" button with tooltip "External links are unavailable in the Qt build — open discord.gg in your browser." **No `discord.gg` hyperlink is rendered** (link-free layout; the upstream `href="https://discord.gg"` anchor is gone).
  - **Global Fallback Mode** caption — three dimmed, disabled option cards (`FallbackOption`, hover tooltip each): **Strict Fallback (Ignore)** (carries a neutral "Default" badge; matches upstream `(Default / Safest)`), **Shared / Legacy**, **Isolated Auto-Create**. Upstream selection is local Vue state with no effect; here nothing is selectable rather than silently-selected-but-inert.
  - **Channel & DM Context Routing Table** caption + **disabled** "+ Add Channel Mapping" button (tooltip) + `ACard` with `AEmptyState` (🗺️): "No channel mappings — the routing table fills in once the gateway bridge lands. The mock rows from the upstream preview are intentionally not rendered." Upstream's two fabricated mock rows (`channel-123456789 (#lounge) → AIRI / Mentions`, `dm-987654321 → AIRI / All Messages`) and their Delete buttons were **not** ported — shipping fake rows in an honest scaffold is worse than an empty state. The Context Key / Target Character / Trigger Mode / Actions column headers go with them.

## Stubbed / deferred, and why

| Upstream surface | Qt state | Why |
| --- | --- | --- |
| Token input (`settings/discord/token`) | Disabled, tooltip | Token store + bridge do not exist; an editable field would lie |
| Owner username + resolved owner ID | Disabled; resolution shown as pending | Owner-ID lookup needs the gateway |
| Connect/Disconnect (start/stop service) | Disabled | No websocket lifecycle, no `DiscordServiceStatus` source |
| `visionEnabled` / `dmsEnabled` toggles | Disabled, tooltip | No inbound message pipeline to gate on |
| Guilds list / active-channel badge | `AEmptyState` | `serviceStatus.guilds` needs `GatewayIntentBits.Guilds` + cache |
| Force Card Sync | Disabled | Needs gateway + card sync RPC (`discordServiceForceSync`) |
| Simulate Event (+ inline dialog) | Disabled button; dialog omitted | Needs `discordServiceSimulateEvent` round-trip; upstream dialog would be dead UI |
| Restart Gateway | Disabled | Needs stop→start lifecycle |
| Event log / Clear Log | Dimmed empty console | Needs `eventa:event:electron:discord:event-log` stream |
| Fallback mode selection | Disabled cards | No routing engine; upstream itself flagged it preview-only |
| Add Channel Mapping / routing table | Disabled button + empty state | No ACL store, no routing pipeline; mock rows not portable |
| External discord.gg link | Disabled button + tooltip | Link-free per lane rule |

## Verification

- `qmllint -I <module-sandbox>` on the file (fresh sandbox `/tmp/opencode/qmllint-discord`, copy of `qml/` + generated `qmldir` including the new entry): **no errors, no warnings except the two expected "plugin.qmltypes does not exist" import notices** (same category the data lane saw; the plugin/qmltypes are produced by the cxx-qt build, not the sandbox).
- Brace/paren/bracket balance scan (comment- and string-aware): **clean**.
- `cargo check -p airi-qt`: **Finished dev profile in 25.60s** — the file is not yet registered in `build.rs` (by design), so the Rust side is untouched; this confirms the build mirror is unaffected.
- `cargo clippy` / workspace gates / `cargo build` — **not run** (lane rules; main agent gates).
- Hardcoded-string scan: UI strings are all `I18n.tr`; remaining literals are property names, icon glyphs only (⚠, —, 🌐, 🗺️). No hex colors; all colors are `Theme.*`.
- Nothing committed; working tree has only the two lane paths (see handoff).

## Integration lists (for the main agent — do NOT apply in this lane)

### 1. QML file to register in `crates/airi-qt/build.rs`

After the `pages/settings/mmd/` / `live2d/` block (or right after the `data/` block):

```rust
module = module.qml_file("qml/pages/settings/modules/discord/DiscordSettingsPage.qml");
```

`emit_rerun_if_changed` already covers the tree recursively.

### 2. SettingsWindow.qml nav/StackLayout snippet (proposed, not applied)

Nav (after the Widgets row, before `Item { Layout.fillHeight: true }`); keep the content stack aligned — appending after Widgets makes the Discord page `navIndex === 21`:

```qml
AListItem {
    Layout.fillWidth: true
    icon: "💬"
    title: I18n.tr("shell.settings.nav.discord")
    active: settingsWindow.navIndex === 21
    onClicked: settingsWindow.navIndex = 21
}
```

StackLayout (after the `WidgetsPage { }` entry):

```qml
// Discord — messaging module scaffold (UI-only until the Rust gateway lands).
DiscordSettingsPage {
}
```

Plus one nav key outside the namespace: `shell.settings.nav.discord` = `Discord`.

### 3. i18n keys needed — namespace `shell.discord.*` (English source strings)

All keys below must be added to every locale in `packages/i18n/src/locales/*/shell.yaml` under a top-level `discord:` section (flattened to `shell.discord.*`). Keys whose values contain `:` or leading punctuation follow the existing single-quote pattern.

```yaml
discord:
  title: 'Discord'
  description: 'Messaging bridge between your AIRI companion and Discord servers and direct messages.'
  deferredNotice: 'The Discord module is not wired to a Rust gateway yet. Bot connection, relay behavior and access routing are shown as a structural preview — every action is disabled until the gateway bridge lands.'
  deferredTip: 'Needs the Discord gateway bridge (websocket lifecycle, token store, Rust service) in the Qt build.'

  tabs:
    bot: 'Bot Connection'
    acl: 'Access & Routing'

  connectivity:
    title: 'Connectivity'
    notWiredState: 'Not wired'
    notWiredBadge: 'Not wired yet'
    tokenLabel: 'Bot Token'
    tokenDescription: 'Your Discord bot token from the Developer Portal.'
    tokenPlaceholder: 'Paste your bot token…'
    ownerLabel: 'Bot Owner / Primary Username'
    ownerDescription: 'Your Discord handle (e.g. dasilva333). AIRI automatically resolves your account ID for owner privileges & memory sync.'
    ownerPlaceholder: 'e.g. dasilva333'
    ownerIdPending: 'Resolved Owner ID: not resolved — gateway bridge required.'
    connect: 'Connect'
    disconnect: 'Disconnect'

  controls:
    title: 'Controls & Modalities'
    vision: 'Screen & Image Vision'
    visionDescription: 'Let the bot analyze images and screenshots posted in Discord using the vision pipeline.'
    dms: 'Allow Direct Messages (DMs)'
    dmsDescription: 'Enable or disable bot interactions (commands and chat) in private direct messages.'

  presence:
    title: 'Active Presence'
    emptyTitle: 'Guilds & channels unavailable'
    emptySubtitle: 'Server and channel lists populate once the gateway bridge lands and the bot connects. Nothing is shown until then.'
    bridgeBadge: 'Bridge required'

  debug:
    title: 'Debug Actions'
    forceSync: 'Force Card Sync'
    simulate: 'Simulate Event'
    restart: 'Restart Gateway'

  devConsole:
    title: 'Developer Console'
    empty: 'No events yet — the event log arrives with the gateway bridge.'
    clearLog: 'Clear Log'

  acl:
    demoBadge: 'DEMONSTRATION PURPOSES ONLY'
    previewBadge: 'EARLY ACCESS PREVIEW'
    previewTitle: 'Access & Context Routing Interface Preview'
    previewBody: "This routing matrix and channel access control interface is an early architectural preview presented for demonstration and feedback purposes only. The underlying multi-channel routing pipeline and per-context isolation layers are actively being refined. We've surfaced these configuration controls early so you can explore the proposed workflow and provide feedback on whether this layout meets your needs before the live routing engine is implemented."
    linkLabel: 'Discord'
    linkTip: 'External links are unavailable in the Qt build — open discord.gg in your browser.'
    fallbackTitle: 'Global Fallback Mode'
    fallbackIgnoreTitle: 'Strict Fallback (Ignore)'
    fallbackIgnoreBody: 'Unmapped channels are dropped. (Default / Safest)'
    fallbackSharedTitle: 'Shared / Legacy'
    fallbackSharedBody: 'All channels share the active desktop character & session.'
    fallbackAutoCreateTitle: 'Isolated Auto-Create'
    fallbackAutoCreateBody: 'Auto-instantiate isolated sessions per channel/DM.'
    defaultBadge: 'Default'
    matrixTitle: 'Channel & DM Context Routing Table'
    addMapping: '+ Add Channel Mapping'
    matrixEmptyTitle: 'No channel mappings'
    matrixEmptySubtitle: 'The routing table fills in once the gateway bridge lands. The mock rows from the upstream preview are intentionally not rendered.'
```

YAML note: `addMapping` contains a leading `+` and must stay single-quoted as shown; `previewBody` contains an apostrophe ("We've") and is double-quoted as shown; `devConsole.empty` and `deferredNotice` contain em-dashes and are fine unquoted. All keys are leaf strings except the nested groups shown.

Upstream Vue → this namespace cross-reference (for review): `settings.pages.modules.messaging-discord.connectivity.*` → `discord.connectivity.*`; `.token*` → `.connectivity.token*`; `.actions.start/stop` → `.connectivity.connect/disconnect`; `.actions.force-sync|simulate|restart|clear-log` → `.debug.*` / `.devConsole.clearLog`; `.controls.*` → `.controls.*`; `.presence.title` → `.presence.title`; `.dev-console.*` → `.devConsole.*`; `.simulate-dialog.*` → **dropped** (dialog not ported). Upstream hardcoded English (tab labels, owner-username copy, DM copy, ACL preview copy, fallback-mode cards, mock-table cells, `Resolved Owner ID`, `Active`, `Delete`, `+ Add Channel Mapping`, the two badges) is now all in `shell.discord.*`.

### 4. Suggested Rust gateway shape (separate phase — for the main agent to schedule)

Read from the Vue page + `stage-shared` types + a shallow skim of `apps/stage-tamagotchi/src/main/services/airi/discord/index.ts` (982 lines; **do not** port it) for the IPC contract only. Functionally the Electron side is a `discord.js` `Client` with `GatewayIntentBits.Guilds | GuildVoiceStates | GuildMessages | MessageContent | DirectMessages` (+ `Partials`), wrapped in `setupDiscordService()`.

- **Bridge** `bridges/discord.rs` (cxx-qt, `DiscordController`): `startService(token: QString) -> bool`, `stopService() -> bool`, `getStatus() -> QString(json)`, `forceCardSync(name: QString, avatarBase64: QString) -> bool`, `simulateEvent(username: QString, content: QString) -> bool`, `registerCommands() -> bool`, `leaveGuild(...) / summonBot(...)`, plus `sendMessage / sendTyping / sendImage / sendVoiceNote / replyInteraction` (image/voice-note are native IPC upstream because of payload size — same reasoning applies to cxx-qt), and `drainEvents()` or an event emitter for `status-changed`, `event-log`, `inbound-message`, `interaction`.
- **Core** (`airi-core::discord` or new module): the gateway client itself (serenity or twilight; *not* discord.js), command registry (upstream `COMMANDS_VERSION = 11`, `CORE_COMMANDS` with `/status /imagine /director /character /new /history` …), ACL/routing store (the "Isolated Auto-Create" pipeline + per-channel session mapping), owner-ID resolution (username → user id), typing heartbeat, card-sync payload builder.
- **Persistence**: token in the platform credential store (not plain localStorage like upstream `useLocalStorageManualReset('settings/discord/token')` — Qt should not regress that), `settings/discord/{ownerUsername,ownerUserId,visionEnabled,dmsEnabled}` in `airi-store` KV.
- **QML wiring then**: token/owner fields flip `enabled: true`; Connect/Disconnect bind to `startService/stopService`; status row renders `state` + `ping` + `botUser.tag`; guilds `Repeater` on `serviceStatus.guilds`; presence section appears when connected; developer console binds the `event-log` stream with per-type colors; ACL tab unlocks behind the same "live routing engine" gate upstream warns about; `Simulate Event` re-opens the upstream inline dialog.

### 5. Missing Theme.* / component props (requests, not blockers)

- **No dashed border** on `Rectangle` — the dev-console empty box approximates the upstream `border-dashed` look with `Theme.bg` fill + `Theme.border` hairline. An `ADashedFrame` (or Canvas-based dash) would match better. (Same request the data lane made for its dropzone.)
- **No `ASwitchRow`** (label + description + switch) — `DeferredSwitchRow` is now a third local copy of the pattern (GeneralSettings, DataSettings, here). Worth promoting to `qml/components/`.
- **No `ATooltip` on disabled button *inside* the button** — the deferred idiom needs a wrapping `Item + MouseArea` per control (`DeferredButton`/`DeferredSwitchRow`/`FallbackOption` are all local). A first-class `disabledTooltip` prop on `AButton`/`ASwitch` would remove the triplicated wrapper.
- **No `fontMono` on `Theme`** — `Resolved Owner ID` was rendered at `pixelSize: 10` in `fontBody`; upstream used `font-mono`. If `Theme.fontMono` lands, use it for that line and the dev-console box.
- **No `AEmptyState` minimum-fill behavior** — fine here; noted only because `index`-style pages may want a compact variant.
- **`AToggleGroup` one-way** — it owns `currentIndex` internally on click; binding `currentIndex: page.activeTab` works (assignment on click replaces the binding, and `onToggled` keeps the page property in sync), but a true two-way or a proper `TabBar` component would be cleaner if more tabbed pages appear.
- **`GridLayout` not used for fallback cards** — used `RowLayout` + `Layout.fillWidth` on the three options instead; equal-width distribution works, but `GridLayout { columns: 3 }` is arguably the more idiomatic trio. Cosmetic either way.
- **Status dot** — a raw 10 px `Rectangle`; an `AStatusDot` (or badge dot variant) would standardise the "grey = not wired" state across the scaffold pages.
