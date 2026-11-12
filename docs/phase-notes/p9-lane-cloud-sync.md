<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane G3 — Cloud Sync module settings page (QML port)

UI-complete **scaffold** of the Cloud Sync module settings page into the Qt app. **No Rust sync engine exists in the Qt build.** No S3/local-FS client, no IndexedDB snapshot pipeline, no conflict contraction guard, no selective-sync manifest, no libp2p mesh node. The upstream page is a thin Vue wrapper around `useSyncEngineStore` (`packages/stage-ui/src/stores/sync-engine.ts`, ~3700 lines, ~460 kB with deps) plus `useLibp2pStore` and `useDisplayModelsStore`; none of that exists here, so the store was read for **field semantics only**, not ported. Every action is rendered but disabled with an explanatory tooltip, and the page says so persistently in the banner up top. Nothing here is persisted, and **no runtime status is fabricated** — the only honest states shown are "Not wired" and "never" (last sync, mirroring the upstream `formattedLastSync` → `'Never'` fallback and the `DataSettingsPage` "Never" precedent).

Source of truth for structure: `packages/stage-pages/src/pages/settings/modules/cloud-sync.vue` (713 lines, read fully). Provider credential fields (endpoint/bucket/region/access+secret) come from `settings/providers/cloud/s3.vue` and `local-fs.vue`, which is where the upstream page sends the "Configure" route; the selective-sync scope rows come from `packages/stage-ui/src/components/scenarios/providers/selective-sync-panel.vue`.

## What landed, per file

**`qml/pages/settings/modules/cloud-sync/CloudSyncSettingsPage.qml`** (new; the directory is the whole lane scope) — faithful in section structure to the Vue page. SPDX header, `I18n.tr("shell.cloudSync.*")` only, `Theme.*` only, components from `qml/components/*.qml` only (`ACard`, `ABadge`, `AButton`, `AEmptyState`, `ASelect`, `ASeparator`, `ASlider`, `ASwitch`, `ATextField`, `ATooltip`, `AToggleGroup`-not-used), Qt Quick 2.15 imports consistent with the rest of `qml/`, no hardcoded English or hex. Five local inline components carry the honest deferred idiom (`DeferredButton`, `DeferredSwitchRow`, `DeferredField`, `DeferredSelect`) plus a `SectionCaption` — disabled control + `ATooltip` on wrapper hover.

### Section-by-section

- **Header** — "Cloud Sync" title, warning `ABadge` ("Not wired yet"), one-line description.
- **Persistent deferred notice** — `ACard` with `Theme.warning` border, ⚠ glyph, Live2D-deferred style. States plainly that the module is not wired to a sync engine and every action is disabled.
- **Storage Target** (Vue "Local Sync Settings → Active Storage Provider" + the two provider pages inlined) — `ACard`:
  - Connection status row: grey dot, "Not wired", em-dash placeholder (never a fake `0 ms` / "3 days ago"), warning badge.
  - **Active Storage Provider** — disabled `ASelect` with `[S3-Compatible Cloud Storage, Local File System / Samba Share]`, `currentIndex: 0` (the upstream default is `isDesktopElectron ? 'local-fs' : 's3'`; S3 is shown as the selected row since S3 is the web-platform default and the safer visual). The upstream "Configure" button is intentionally **not ported** — there are no provider sub-pages in the Qt shell yet, so both target field groups are inlined below the selector instead.
  - **S3-Compatible** sub-caption + fields, all disabled with wrapper tooltips: **Endpoint URL** (`https://s3.amazonaws.com`), **Bucket Name** (`my-airi-sync`), **Region** (`us-east-1`), **Access Key ID** (password echo), **Secret Access Key** (password echo), and a **Path-Style Access** disabled `ASwitch` row (force path-style URLs; required by MinIO/self-hosted — not in the current Vue/store, kept per lane spec since the Qt page inlines what would otherwise be an S3 provider page).
  - **Local Share** sub-caption + **Backup Directory Path** (`/Volumes/AIRI-Backup-Share`), disabled with tooltip.
  - **Test Connection** — disabled `AButton` `Accent` with tooltip.
- **Synchronization** (Vue "Local Sync Settings" card) — `ACard`:
  - **Enable Cloud Sync** — disabled `ASwitch` row ("Automatically back up and sync your data in the background.").
  - **Sync Interval (Minutes)** — disabled `ASlider` (`from: 5, to: 120, stepSize: 5, value: 30`; the editable upstream default, shown dimmed) with the static "30 min" label to its right. The label is the documented default (`settings/sync/interval=30`), not a live setting.
  - **Conflict Resolution Strategy** — disabled `ASelect` `[Last-Write-Wins (LWW), Remote-Wins (Override Conflicts), Local-Wins (Keep Local Copy)]`, `currentIndex: 1` (upstream default `remote-wins`).
  - **Selective Sync** — disabled `ASwitch` row.
- **What Gets Synced** (Vue `SelectiveSyncPanel` scope tree, single-line preview) — `ACard` with disabled `ASwitch` rows: **Database Core & Settings** (`checked: true` — upstream marks this group *required*; the switch is forced on for fidelity but inert), **Avatar & Display Model Sync** (character-card avatars + VRM/Live2D/MMD display models; upstream `local:airi-cards`), **Memory & Journal Sync** (`local:memory/*`), **Chat History Sync** (`local:chat/sessions/*`, `local:chat/index/*`).
- **Local Mesh Sync** (Vue Electron-gated libp2p section; Qt desktop builds would be Electron too) — `ACard`: **Enable Mesh Sync** disabled row + three target rows (**Memory / Vault / Companions**), all disabled with tooltip. Upstream hides this on non-Electron; here it is shown dimmed rather than hidden so the scaffold stays structurally complete — it cannot function either way.
- **Manual Actions** (Vue "Sync Now Trigger Panel") — `ACard`, rows separated by `ASeparator`:
  - **Manual Synchronization** + dimmed "Last synced: never" + disabled **Selective Sync…** (`Default`) + disabled **Sync Now** (`Accent`). The upstream two-state button (`Syncing...` / `Sync Selected` / `Sync Full`) collapses to one honest dead button.
  - **Prune Unlinked Local Models** + disabled **Prune Models…** (`Default`; upstream `bg-indigo-600` has no Qt variant — not `Danger` either, since it deletes only unlinked local files and preserves cloud backups).
  - **Restore Settings Only** + disabled **Restore Settings…** (`Default`; upstream `DoubleCheckButton variant="caution"` — no caution variant in `AButton`).
  - **Restore Remote Backup** + disabled **Restore Backup…** (`Danger`; upstream `variant="danger"`).
- **Sync Conflicts** — `SectionCaption` + `ACard` with `AEmptyState` (🛡️): "No conflicts to review — the sync engine is not wired in this build…". Upstream renders the conflict list only when `conflicts.length > 0`; with no engine there can be no conflicts, so no fabricated conflict rows and no "Keep Local / Keep Remote / Merge" buttons.

### Intentionally not ported

- **Selective Sync Scope dialog** — dead UI; re-open it as the upstream dialog shape when the engine lands.
- **Prune Unlinked Models dialog** — same reason (needs `displayModelsStore` + cloud backup verification).
- **Conflict list / merge buttons** — needs the contraction guard + resolver; upstream itself gates on `conflicts.length > 0`, which can never happen here.
- **Inline per-key merge logic** (`isMergeable()` in the Vue page) — belongs to the engine, not the page.
- **`syncError` banner** — there is no engine to produce an error; a permanently-hidden banner is dead code. (Same reasoning as the Discord lane omitting its error banner.)
- **External/web-service links** — none rendered (link-free, per lane rule).

## Stubbed / deferred, and why

| Upstream surface | Qt state | Why |
| --- | --- | --- |
| `syncEnabled` master toggle | Disabled row | No background sync loop to gate on |
| `syncInterval` range input | Disabled slider @ 30 | `useLocalStorageManualReset` doesn't exist here; value is the documented default |
| `conflictStrategy` select | Disabled, `remote-wins` default | No divergent-write resolution exists |
| `activeProvider` select + "Configure" route | Disabled `ASelect`; Configure omitted | No provider sub-pages in Qt; fields inlined instead |
| S3 endpoint/bucket/region | Disabled fields + tooltip | No S3 client; `validateConnection()` RPC doesn't exist |
| S3 access key + secret | Disabled password-echo fields + tooltip | No credential store wiring in the Qt shell for sync |
| Local share backup path | Disabled field + tooltip | No local-FS transport |
| Path-style access toggle | Disabled switch + tooltip | Additive per lane spec (MinIO); upstream has it only implicitly |
| `selectiveSyncEnabled` + scope dialog | Disabled row; dialog omitted | No manifest/catalog RPC (`fetchRemoteSyncManifestCatalog`) |
| Avatar/memory/chat sync scope | Disabled rows | Mirror of the selective-sync tree; purely presentational here |
| Mesh sync (`meshSyncEnabled`, targets) | Disabled rows | No libp2p node in the Qt build (libp2p lane is separate) |
| `triggerSync()` / "Sync Now" | Disabled button | No sync pipeline |
| `forceRestoreFromRemote()` / `restoreSettingsFromRemote()` | Disabled buttons | No remote snapshot to restore from |
| Prune unlinked models | Disabled button; dialog omitted | Needs display-models store + cloud verification |
| Conflict resolver (`resolveConflict`) | Empty state, not buttons/rows | No contraction guard, no merge logic |
| `lastSyncTime` display | "Last synced: never" | Fabricating a time would be a lie; `Never` is upstream's own empty value |

## Verification

- `qmllint -I <sandbox>` on the file (fresh sandbox `/tmp/opencode/qmllint-cloud-sync`: copy of `qml/` + generated `com/airi/airiqt/qmldir` including the new `CloudSyncSettingsPage` entry + the build-produced `plugin.qmltypes`): **no errors, no warnings** — completely clean, because the sandbox includes the built `plugin.qmltypes` (unlike the Discord lane's sandbox which lacked it and saw the two import notices).
- Brace/paren/bracket balance scan (comment- and string-aware): **clean**.
- String audit: every `text:`/`placeholderText:`/`title:`/`label:`/`description:`/`tip:` literal goes through `I18n.tr("shell.cloudSync.*")`; remaining literals are property names, variant names (`"warning"`), `Qt` glyphs (⚠, —, 🛡️, ▾ via ASelect/ASlider internals) and import URIs. **No hex colors**; all colors are `Theme.*`.
- `cargo check -p airi-qt`: **Finished dev profile in 25.28s** on retry. First invocation failed with two `E0308` mismatches inside `crates/airi-qt/src/bridges/mcp.rs` — a *different lane's untracked, in-progress file* (the mcp lane; `git status` shows it as `??`). It compiled clean on the re-run once that lane saved. My file is not registered in `build.rs` (by design), so the Rust side is untouched by this lane.
- `cargo clippy` / workspace gates / `cargo build` — **not run** (lane rules; main agent gates).
- Nothing committed; working tree additionally contains the other lanes' uncommitted work (see handoff).

## Integration lists (for the main agent — do NOT apply in this lane)

### 1. QML file to register in `crates/airi-qt/build.rs`

After the `modules/discord/` line (line ~143):

```rust
module = module.qml_file("qml/pages/settings/modules/cloud-sync/CloudSyncSettingsPage.qml");
```

`emit_rerun_if_changed` already covers the tree recursively.

### 2. SettingsWindow.qml nav/StackLayout snippet (proposed, not applied)

Current state (verified): nav indices 0–19 pages, **20 = Widgets**, **21 = MCP**, **22 = Discord**; content `StackLayout` appends `WidgetsPage`, `McpSettingsPage`, `DiscordSettingsPage` in that order. Cloud Sync should therefore be **navIndex 23**.

Nav (after the Discord `AListItem`, before `Item { Layout.fillHeight: true }`); keep the content stack aligned:

```qml
AListItem {
    Layout.fillWidth: true
    icon: "☁️"
    title: I18n.tr("shell.settings.nav.cloud-sync")
    active: settingsWindow.navIndex === 23
    onClicked: settingsWindow.navIndex = 23
}
```

StackLayout (after the `DiscordSettingsPage { }` entry):

```qml
// Cloud Sync — BYOS sync (scaffold; sync engine pending).
CloudSyncSettingsPage {
}
```

Plus one nav key **outside** the namespace: `shell.settings.nav.cloud-sync` = `Cloud Sync`. (Kebab-case matches the neighboring `nav.mcp` / `nav.discord`... note `nav.cloudSync` camelCase is also consistent with the namespace choice; pick one and keep it — I suggest `cloudSync` to match `shell.cloudSync.*`.)

### 3. i18n keys needed — namespace `shell.cloudSync.*` (English source strings)

All keys below must be added to every locale in `packages/i18n/src/locales/*/shell.yaml` under a new top-level `cloudSync:` section (flattened to `shell.cloudSync.*`). No existing `cloudSync:` key exists in any locale (verified — `settings.yaml` holds the unrelated `settings.modules.cloud-sync.*` Vue keys; they stay untouched). No `:`-bearing values need double quotes; `sync.intervalValue` (`'30 min'`) is fine single-quoted. Nesting groups shown as YAML for direct paste; all leaves are strings.

```yaml
cloudSync:
  title: 'Cloud Sync'
  description: 'Backs up and synchronises your databases, character cards, memory segments, and media assets across devices.'
  notWiredBadge: 'Not wired yet'
  deferredNotice: 'The Cloud Sync module is not wired to a sync engine in the Qt build yet. Sync targets, credentials, scheduling, and restore are shown as a structural preview — every action is disabled until the sync engine lands.'
  deferredTip: 'Needs the sync engine (S3 / local-FS transports, IndexedDB snapshotting, conflict guard) in the Qt build.'

  storage:
    title: 'Storage Target'
    notWiredState: 'Not wired'
    providerLabel: 'Active Storage Provider'
    providerDescription: 'Choose which sync target is active.'
    providerS3: 'S3-Compatible Cloud Storage'
    providerLocalFs: 'Local File System / Samba Share'
    s3Caption: 'S3-Compatible Settings'
    endpointLabel: 'Endpoint URL'
    endpointDescription: 'The base endpoint URL of your S3 provider (e.g. https://s3.amazonaws.com).'
    endpointPlaceholder: 'https://s3.amazonaws.com'
    bucketLabel: 'Bucket Name'
    bucketDescription: 'The name of your cloud bucket.'
    bucketPlaceholder: 'my-airi-sync'
    regionLabel: 'Region'
    regionDescription: 'The region of your bucket (defaults to us-east-1 if left blank).'
    regionPlaceholder: 'us-east-1'
    accessKeyLabel: 'Access Key ID'
    accessKeyDescription: 'The S3 Access Key ID credential.'
    accessKeyPlaceholder: 'Enter Access Key ID'
    secretKeyLabel: 'Secret Access Key'
    secretKeyDescription: 'The S3 Secret Access Key credential.'
    secretKeyPlaceholder: 'Enter Secret Access Key'
    pathStyleLabel: 'Path-Style Access'
    pathStyleDescription: 'Force path-style bucket URLs (https://host/bucket). Required for MinIO and most self-hosted S3-compatible stores.'
    localCaption: 'Local Share Settings'
    localPathLabel: 'Backup Directory Path'
    localPathDescription: 'The absolute path to your local sync folder or mounted network drive (NAS / Samba share).'
    localPathPlaceholder: '/Volumes/AIRI-Backup-Share'
    testConnection: 'Test Connection'

  sync:
    title: 'Synchronization'
    enableLabel: 'Enable Cloud Sync'
    enableDescription: 'Automatically back up and sync your data in the background.'
    intervalLabel: 'Sync Interval (Minutes)'
    intervalDescription: 'Time between automatic background sync loops.'
    intervalValue: '30 min'
    conflictLabel: 'Conflict Resolution Strategy'
    conflictDescription: 'How conflict is resolved if data diverges on multiple devices.'
    conflictLww: 'Last-Write-Wins (LWW)'
    conflictRemoteWins: 'Remote-Wins (Override Conflicts)'
    conflictLocalWins: 'Local-Wins (Keep Local Copy)'
    selectiveLabel: 'Selective Sync'
    selectiveDescription: 'Only sync selected characters, chat histories, and display models.'

  scope:
    title: 'What Gets Synced'
    coreLabel: 'Database Core & Settings'
    coreDescription: 'Required — app settings, provider configurations, character card database and short-term memory are always synced upstream.'
    avatarLabel: 'Avatar & Display Model Sync'
    avatarDescription: 'Character card avatars and Live2D / VRM / MMD display models (airi-cards).'
    memoryLabel: 'Memory & Journal Sync'
    memoryDescription: 'Short-term memory summaries, text journal and echo chips (memory/*).'
    chatLabel: 'Chat History Sync'
    chatDescription: 'Chat sessions and the session index (chat/sessions, chat/index).'

  mesh:
    title: 'Local Mesh Sync'
    enableLabel: 'Enable libp2p Mesh Sync'
    enableDescription: 'Sync memory, vault credentials, and companion cards directly with other AIRI instances on your local network.'
    memoryLabel: 'Memory (STMM / LTMM / Event Ledger)'
    vaultLabel: 'Vault (BYOS credentials)'
    companionsLabel: 'Companions (character cards)'
    targetDescription: 'Synced with paired AIRI instances over libp2p.'

  actions:
    title: 'Manual Actions'
    manualTitle: 'Manual Synchronization'
    lastSyncedNever: 'Last synced: never'
    selectiveSync: 'Selective Sync…'
    syncNow: 'Sync Now'
    pruneTitle: 'Prune Unlinked Local Models'
    pruneDescription: 'Free up local disk space by safely removing models not associated with any character card. Verified against cloud backups before removal.'
    pruneButton: 'Prune Models…'
    restoreSettingsTitle: 'Restore Settings Only'
    restoreSettingsDescription: 'Restore configurations and UI settings without touching character assets.'
    restoreSettingsButton: 'Restore Settings…'
    restoreBackupTitle: 'Restore Remote Backup'
    restoreBackupDescription: 'Nuke local data and force restore all settings from remote.'
    restoreBackupButton: 'Restore Backup…'

  conflicts:
    title: 'Sync Conflicts'
    emptyTitle: 'No conflicts to review'
    emptySubtitle: 'The sync engine is not wired in this build, so contraction-guard conflicts cannot occur. When it lands, files blocked from auto-overwriting will appear here — you will keep local, keep remote, or merge.'
```

YAML note: `scope.avatarDescription` and `scope.chatDescription` contain `/` and are plain-safe; `mesh.memoryLabel`/`vaultLabel`/`companionsLabel` contain parentheses and slashes but no `: `, fine single-quoted; `conflicts.emptySubtitle` and `scope.coreDescription` contain em-dashes, fine; `actions.selectiveSync` / `pruneButton` contain `…`, fine. Everything is a leaf string except the nested groups shown.

Upstream Vue → this namespace cross-reference (for review): most of the Vue page is **hardcoded English** (Local Sync Settings, Enable Cloud Sync, Sync Interval, Conflict Resolution Strategy, Selective Sync, Active Storage Provider + the S3/local-fs credential copy from `providers/cloud/*.vue`, Manual Synchronization, Prune Unlinked Local Models, Restore Settings Only, Restore Remote Backup); only the Mesh-Sync card and route meta used i18n (`settings.pages.modules.local-sync.*`). Mapping: `settings.pages.modules.local-sync.meshSync|enableMeshSync(Desc)|syncTargets|memory|vault|companions` → `mesh.*`; everything else → the matching `sync.*` / `storage.*` / `actions.*` keys above. The Vue keys under `settings.modules.cloud-sync.{title,description}` (only two exist, e.g. fr "Synchronisation cloud (BYOS)") stay untouched — `shell.cloudSync.title` is intentionally a fresh string ("Cloud Sync"), matching the nav label suggested in §2.

### 4. Suggested sync-engine shape (separate phase — for the main agent to schedule)

Read from the Vue page + `sync-engine.ts` (skim only) for the IPC contract, not to port:

- **Core** (`airi-core::sync` or new module): target transports (S3-compatible via `rust-s3` or signed HTTP against `s3-endpoint`; local-FS via a path watcher; libp2p reuse of the future mesh lane), IndexedDB-equivalent snapshot of `local:*` keys into `remote/manifest.json`, the **contraction guard** (`checkSyncConflict`/size-drop detection — the upstream "significant data contraction" block), the merge routines (`mergeChatSessions`, `mergeAiriCards`, `available-motions`, `voice-profiles`), selective-sync manifest (`fetchRemoteSyncManifestCatalog`), `pruneLocalModels` verification against remote backups.
- **Persistence**: `settings/sync/*` in `airi-store` KV (the `useLocalStorageManualReset` namespace); **credentials in the platform credential store**, not plain JSON (the upstream keeps `s3-secret-access-key` in localStorage — Qt must not regress that; note it as an accepted upstream deviation when writing the phase).
- **Stack**: a cxx-qt `SyncController` bridge (`validateConnection`, `triggerSync`, `forceRestoreFromRemote`, `restoreSettingsFromRemote`, `resolveConflict`, `getStatus`, `listConflicts`, `pruneScan/pruneApply`); QML then flips every `enabled: false` in this page to real bindings, the status row renders live state, the conflicts section renders the real list, and the two dialogs come back in upstream shape.

### 5. Missing Theme.* / component props (requests, not blockers)

- **No `ASwitchRow`** (label + description + switch) — `DeferredSwitchRow` is now a fourth local copy of the pattern (General, Data, Discord, here). Promote to `qml/components/`.
- **No disabled-tooltip built into `AButton` / `ASwitch` / `ASelect`** — every deferred control needs the wrapping `Item + MouseArea + ATooltip` boilerplate (four local components in this file). A first-class `disabledTooltip` property would remove them all.
- **No "caution" `AButton` variant** — upstream used `DoubleCheckButton variant="caution"` for Restore Settings Only; mapped to `Default`. An amber/caution variant (`Theme.warning` border/text) would map 1:1.
- **No `AToggleGroup` disabled state** — it has no `enabled` propagation to its child `AButton`s (they would stay clickable), which is why the target-type selector is an `ASelect` instead. (Upstream used a `<select>`, so `ASelect` is the faithful mapping; noted in case `AToggleGroup` gains `enabled` later.)
- **No `Theme.fontMono`** — placeholders are monospace-ish values but rendered in `fontBody` (same as Discord/MCP).
- **`ASlider` has no explicit `valueLabel` slot** — the "30 min" companion text is a hand-placed dimmed `Text`; fine at one row, awkward at many.
- **Status dot** — raw 10 px `Rectangle` again (fourth copy); an `AStatusDot` would standardize the "grey = not wired" state.
- **No `AField` / `AFieldInput`** (label + description + control + tooltip) — the upstream `FieldInput` pattern; `DeferredField` is its disabled-only shadow and will be re-implemented per port.
- **Not missing, but noted:** `AEmptyState`'s centered emoji icon is a reasonable stand-in for the upstream solar-icon conflicts panel.

### 6. Namespace collision check (done)

`grep -rn '^cloudSync:' packages/i18n/src/locales/*/shell.yaml` → **no matches**; `settings.yaml` holds the unrelated `settings.modules.cloud-sync.*` (Vue meta keys, 2 leaves per locale) which stay untouched. `shell.cloudSync.*` is new and free.
