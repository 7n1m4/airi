<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane B — Data settings page + vault/scrub dialogs (QML port)

> **Superseded for the export/import/scrub flows** — as of `p9-lane-data-backend.md` those are wired to the real Rust vault backend (export archive, import chats+memory, media scrub). Destructive resets and Cloud Sync remain UI-only no-ops by design. This note remains accurate for everything it describes about the lane's original scope and for the vault backend shape it proposed (implemented).


Direct port of `packages/stage-pages/src/pages/settings/data/` into the Qt app. **UI lands now; the data layer does not.** No export, import, scrub, delete or reset action mutates user data — every such action either opens a real dialog with live fields or shows a persistent "not wired" banner. The page and dialogs say so honestly, in the UI itself and here. `status.ts` / `settings-search-index.ts` were read for structure only (thin status emitter + re-exports; nothing to port line-by-line).

## What landed, per file

**`qml/pages/settings/data/DataSettingsPage.qml`** — the page, faithful in structure to the Vue `index.vue`:
- Live status banner (neutral/success/error) with dismiss ✕.
- **Data Vault** card (accent border) — Universal Import / Export Archive buttons open the two dialogs.
- **Cloud Sync** card — ported 1:1 in look (badge, zero-custody + avatar notes, Active Target / Last Synchronized metadata strip) but every control is **disabled** with a `warning` "not wired yet" badge; target shows *Not configured*, last sync shows *Never*. Enabling these would be a lie.
- **Session Media Optimization & Scrub** card — button opens `ScrubHistoryDialog`.
- **Scrub history** — the required empty state (AEmptyState + explanation that entries appear once the backend lands).
- **Unlinked Conversations & Memories** — empty state with "not wired yet" badge + explanation (orphan detection needs the wave ④ bridge; the Vue "All Linked" all-clear cannot be claimed without it).
- **Legacy single-file JSON tools** — collapsible (▼/▲), one row per domain (chats / characters / memory / backgrounds) with Export + Import buttons; chats row also has a Danger *Delete All Chat Sessions*. All → not-wired notice.
- **Models & modules** (delete all models / reset module settings), **Danger zone** (reset providers / delete all data), **Desktop shell state** (reset desktop app state) — all route through one shared no-op confirmation `AModal` whose body states plainly that nothing will happen.
- Desktop-only amber card was folded into the same confirm-gated pattern (the QML app *is* the desktop build).

**`qml/pages/settings/data/DataExportDialog.qml`** — port of `ExportVaultModal`. The five domain toggles (Companions & Cards, Chat Histories & Timelines, Memories & Journals, AI Providers & App Settings, Custom Scene Backgrounds) are **live**: selection state is real, drives the cross-domain linkage warning (*chats/memory selected without companions*) and the placeholder manifest. Byte stats cannot exist yet, so sizes render as `—` and "Estimated archive size" shows *Unknown — backend not wired*. Confirm raises the persistent `shell.data.status.notWired` banner; the dialog never closes on confirm. A **Copy Placeholder Manifest** ghost button writes a *deterministic* JSON (fixed key order, no timestamps, no user data) to the clipboard via a hidden `TextEdit` (`selectAll()` + `copy()`; `opacity: 0`, not `visible: false`).

**`qml/pages/settings/data/DataImportDialog.qml`** — port of `ImportVaultModal`. Dropzone (real `DropArea` + dashed-look double hairline frame), browse button (`FileDialog` with `OpenFiles`, `.zip/.json/.png` filter), selection list (file names only — nothing is read). Always-visible wave note explains inspection/companion-linking/import arrive with the backend. Confirm disabled until files are selected, then raises the persistent `shell.data.status.actionNotWired` banner. The Vue `inspecting → aligning → ready → importing → done` step machine is intentionally **not** ported — those steps fabricate a flow that cannot run; they come with the bridge (see §4).

**`qml/pages/settings/data/ScrubHistoryDialog.qml`** — port of `ScrubHistoryModal`. Only the **prompt** step is rendered: description, "Current Total Chat Size: Unknown — backend not wired", the backup-safety banner, and the three buttons (Cancel / Scrub Without Backup / Create Backup & Scrub). Both scrub actions raise the persistent `shell.data.status.actionNotWired` banner. The `backing-up / scrubbing / complete` progress states were omitted on purpose — they cannot exist without the bridge; faking progress would be worse than the honest prompt.

All four: SPDX header, `I18n.tr("shell.data.*")` only, `Theme.*` only, no hardcoded hex, no hardcoded English in UI text (comments and the placeholder-manifest `note` payload field are English; noted), `AModal`/`ACard`/`ABadge`/`AButton`/`ASwitch`/`AEmptyState`/`ASeparator` components only.

## Stubbed / deferred, and why

- **No export bridge exists** (`crates/airi-store/src/lib.rs` exposes KV/sessions/messages/memory/embeddings stores but no vault/export; `crates/airi-core/src/{lib.rs,settings.rs,cards.rs}` have cards export only, no data vault). Nothing may fake it — so confirms raise banners, never write files.
- **Scrub history table** renders empty by design; rows need persisted scrub reports (table doesn't exist yet).
- **Unlinked-data detection** needs orphan-group queries plus card-store lookup — not wired.
- **Cloud Sync** has no sync engine bridge; the card is informational with disabled controls.
- **Destructive actions** (delete chats/models/all data, reset providers/modules/desktop state) are no-op confirmations until wave ④.
- **Estimated archive size** shows *Unknown — backend not wired* instead of summing fabricated stats.

## Verification

- `qmllint -I <module-sandbox>` on all four files (module-aware, `com.airi.airiqt` resolvable): **0 warnings/errors**. Sandbox built in `/tmp/opencode/qmllint-module` (a copy of `qml/` + generated `qmldir`); the `target/…` build-tree copy was used read-only as lint reference. Build tree not modified intentionally.
- Brace/paren balance scan: clean.
- `cargo check -p airi-qt` — `Finished dev profile in 23.10s` (Rust untouched; confirms the unchanged build-mirror path still works).
- `cargo clippy` / smoke NOT run (per lane rules; main agent gates).
- Nothing committed; `apps/airi-qt` remains untracked as handed off.

## Integration lists (for the main agent — do NOT apply in this lane)

### 1. QML files to register in `crates/airi-qt/build.rs`

```rust
module = module.qml_file("qml/pages/settings/data/DataSettingsPage.qml");
module = module.qml_file("qml/pages/settings/data/DataExportDialog.qml");
module = module.qml_file("qml/pages/settings/data/DataImportDialog.qml");
module = module.qml_file("qml/pages/settings/data/ScrubHistoryDialog.qml");
```
(add after the `pages/settings/system/` loop or next to the cards block; `emit_rerun_if_changed` already covers the tree.)

### 2. SettingsWindow.qml nav/StackLayout snippet (proposed, not applied)

Nav (after the Explore row, before `Item { Layout.fillHeight: true }`):

```qml
AListItem {
    Layout.fillWidth: true
    icon: "🗄️"
    title: I18n.tr("shell.settings.nav.data")
    active: settingsWindow.navIndex === 14
    onClicked: settingsWindow.navIndex = 14
}
```

StackLayout (after the `ExploreModelsPage { }` entry):

```qml
// Data — export/import/vault status (UI-only until wave ④).
DataSettingsPage {
}
```

Also bump nothing else: Explore stays 13. Cards' `active` double-condition precedent (`navIndex === 11 || 12`) is untouched.

### 3. i18n keys needed — namespace `shell.data.*` (English source strings)

> Plus **one nav key outside the namespace**: `shell.settings.nav.data` = `Data` (mirrors `shell.settings.nav.explore` etc.). All keys below must be added to every locale in `packages/i18n/src/locales/*/shell.yaml` under a top-level `data:` section (flattened to `shell.data.*`).

```yaml
data:
  title: Data
  description: Everything AIRI stores locally on this device — export it, import it, or scrub heavy history.

  status:
    notWired: Export is not wired to a Rust backend yet — see phase note
    actionNotWired: This action is not wired to a Rust backend yet — see phase note
    imported: Import complete.
    placeholderCopied: Placeholder manifest copied to the clipboard — it contains no user data.

  vault:
    title: 'Data Vault: Archive & Universal Import'
    description: Selective, human-readable ZIP archives across all memory pillars, or restore data with automatic companion linking.
    import: Universal Import
    export: Export Archive

  sync:
    title: 'Cloud Sync: Zero-Custody Continuous Backup'
    description: Continuous replication to your personal S3-compatible bucket or local network share.
    badge: Not wired yet
    enable: Enable Auto-Sync
    active: Auto-Sync Active
    syncNow: Sync Now
    openSettings: Open Cloud Sync Settings
    zeroCustodyTitle: 'Zero-Custody Automatic Replication:'
    zeroCustodyBody: Cloud Sync continuously mirrors your conversations, companions, daily memory summaries, and settings to storage you control (AWS S3, S3-compatible buckets, or Local Share). We never see or hold custody of your data.
    avatarsTitle: 'Live2D, VRM, Spine & MMD Avatars:'
    avatarsBody: Avatar models are large binary assets, so there is no single-file export; Cloud Sync is the only automated backup mechanism for them.
    activeTarget: Active Target
    lastSynced: Last Synchronized
    notConfigured: Not configured
    never: Never

  scrub:
    title: Session Media Optimization & Scrub
    description: Extract inline base64 image strings and leaked tool payloads from your chat history into persistent local storage, preventing LLM token blowup.
    button: Clean & Resolve History

  scrubHistory:
    title: Scrub History
    description: Reports from past optimization runs.
    emptyTitle: No scrubs recorded yet
    emptySubtitle: Scrub history will appear here once the scrub backend lands and you run your first optimization.

  scrubDialog:
    title: Scrub & Resolve Session Media
    subtitle: Extract heavy inline images into storage to eliminate token blowup.
    promptBody: This process scans all chat conversations for embedded base64 image data URLs and raw tool image payloads. Each detected image is safely relocated to your local background gallery and replaced in your history with a lightweight asset pointer.
    currentChatSize: Current Total Chat Size
    sizeUnknown: Unknown — backend not wired
    safetyTitle: 'Safety Confirmation:'
    safetyBody: Just to be safe, do you want to create a full backup archive of your companions and conversations before proceeding?
    cancel: Cancel
    scrubWithoutBackup: Scrub Without Backup
    backupAndScrub: Create Backup & Scrub
    waveNote: Scrubbing itself is not wired to a Rust backend yet — pressing either action only shows this notice.

  unlinked:
    title: Unlinked Conversations & Memories
    description: Recover chat histories and memories left behind by deleted or renamed companions.
    badge: Not wired yet
    emptyTitle: Unlinked-data detection not wired yet
    emptySubtitle: Detecting orphaned sessions requires the data bridge (wave ④). Once it lands, groups you can recreate or merge will be listed here.

  legacy:
    title: Individual Domain Tools (Legacy Single-File JSON)
    show: Show
    hide: Hide
    chatsTitle: Chat Sessions
    chatsDescription: Export or purge all chat sessions as a single JSON file.
    charactersTitle: Companions & Cards
    charactersDescription: Export or import all character cards as a single JSON file.
    memoryTitle: Memories & Journals
    memoryDescription: Export or import memories, daily recaps and journal entries.
    backgroundsTitle: Backgrounds
    backgroundsDescription: Export or import custom scene backgrounds.
    export: Export
    import: Import
    deleteChats: Delete All Chat Sessions

  models:
    title: Downloaded Models
    description: Remove all downloaded VRM/MMD/Spine/Live2D model files from this device.
    delete: Delete All Models

  modules:
    title: Module Settings
    description: Reset all module configuration to defaults.
    reset: Reset Module Settings

  danger:
    title: Danger Zone
    description: These actions are irreversible.
    providersTitle: Providers & Credentials
    providersDescription: Reset provider configuration and stored credentials.
    providersReset: Reset Providers
    allTitle: All User Data
    allDescription: Delete everything — sessions, memories, cards, settings. Cannot be undone.
    allDelete: Delete All Data

  desktop:
    title: Desktop Application State
    description: Reset window placement, tray and other desktop-shell state (desktop build only).
    reset: Reset Desktop State

  confirm:
    title: Are you sure?
    notWiredBody: This action is not wired to a Rust backend yet — confirming will only show a notice, nothing will be deleted or reset.
    confirm: Confirm
    cancel: Cancel

  exportDialog:
    title: Export Data Archive
    subtitle: Select data domains to package into a standard ZIP archive.
    characters: Companions & Cards
    charactersHint: Prompts, wardrobe, avatars
    chats: Chat Histories & Timelines
    chatsHint: Sessions and messages across all companions
    memory: Memories & Journals
    memoryHint: Daily recaps, journal entries, lifetime cores
    providers: AI Providers & App Settings
    providersHint: Configured providers & preferences (~2 KB)
    backgrounds: Custom Scene Backgrounds
    backgroundsHint: Saved image wallpapers
    linkageWarning: Companions & Cards is unselected. We recommend including it so chats and memories stay linked when restored.
    estimatedSize: 'Estimated archive size:'
    sizeUnknown: Unknown — backend not wired
    cancel: Cancel
    confirm: Export Archive
    copyPlaceholder: Copy Placeholder Manifest

  importDialog:
    title: Universal Data Import
    subtitle: Restore from a ZIP archive, legacy backup JSON, or character card.
    dropTitle: Click or drag files here to import
    dropSubtitle: Supports .zip archives, chat/memory JSONs, and PNG cards (multi-file drop supported)
    browse: Browse Files…
    selectedTitle: 'Selected files:'
    waveNote: File inspection, companion linking and the import itself arrive with the wave ④ vault bridge. Nothing is written yet.
    filterVault: Vault archives and backups (*.zip *.json *.png)
    filterAll: All files (*)
    cancel: Cancel
    confirm: Import All Data
```

YAML note for keys containing `:` (e.g. `vault.title`, `sync.*Title`, `safetyTitle`, `zeroCustodyTitle`): single-quote them as shown, or the parser balks — the existing `en/shell.yaml` already follows this pattern (`import-error: "..."`). `estimatedSize` also needs quoting.

### 4. Suggested Rust backend shape (wave ④ — for the main agent to schedule)

- **`airi-store`**: new read-only stats/export queries — per-domain byte estimates (`sessions`, `messages`, `memory_*`, `kv` prefix sums), counts for vault stats; a `scrub_runs` table (`id, started_ms, sessions_scanned, bytes_before, bytes_after, images_extracted`) with insert + `list_recent`.
- **`airi-core::vault`** (new module, not a new crate): `collect_archive(domains) -> Result<Vec<u8>>` (JSON-per-domain + manifest.json into a zip via `zip` crate or manual store; human-readable per the Vue copy), `inspect_archive(paths) -> InspectionReport` (domains, counts, `unalignedCompanions[]` with `suggestedName/messageCount/memoryCount/previewText`), `apply_alignment(payload, alignments)`, `commit_import(payload) -> ImportReport`, `export_pre_scrub_backup()`.
- **Scrub**: `scrub_session_media` — scan `messages` for `data:image/...;base64` URLs + tool-payload images, write each to the backgrounds/assets store, replace with an asset pointer, report deltas; bytes accounting for the before/after metric grid.
- **Orphan detection**: `get_orphaned_groups()` — group messages by `character_id` where the id has no card in the card store; `restore_orphaned_groups(mappings)`; `nuke_orphaned_groups(ids)`.
- **Bridge** `bridges/data.rs` (`DataController`, cxx-qt): `listVaultStats() -> json`, `exportVault(selectionJson, destPath?) -> bool` (writes via native save dialog or to downloads), `inspectVault(pathsJson) -> json`, `commitVaultImport(payloadJson, alignmentsJson) -> json`, `scrubRun() -> json` (+ `drainEvents` progress), `listScrubRuns() -> json`, `getOrphanedGroups() -> json`, `restoreOrphans(json)`, `nukeOrphans(json)`, plus destructive resets (`deleteAllChatSessions`, `resetProviders`, `deleteAllData`, …) — each with typed errors. Save-path/clipboard: add `clipboardCopy(QString)` if the TextEdit trick is deemed too hacky for the export path.
- **QML wiring then**: dialogs swap `notWiredBanner = true` for real calls; `Scrub history` renders `Repeater` over `listScrubRuns()` as a table; unlinked section renders grouped orphan cards with recreate/link/purge actions; Cloud Sync card needs the sync-engine bridge (separate phase, untouched here).

### 5. Missing Theme.* / component props (requests, not blockers)

- **No `Theme.fontMono`** — Vue used `font-mono` for character ids; fell back to `fontBody`. Add `readonly property string fontMono: "Mono"` if desired.
- **No `ACheckbox`** — domain toggles use `ASwitch` (fine), but a checkbox would map better to the Vue look; consider adding for future vault UIs.
- **No dashed border** on `Rectangle` (dropzone wants `border.style: dashed`-like look) — approximated with a double hairline frame; a `ADashedFrame` or Canvas would be nicer.
- **No toast/snackbar component** — used inline persistent banners everywhere (matches "persistent banner/toast state" requirement); a `AToast` would standardise this.
- **`AModal` width** is fixed at `min(480, parent.width − 2·spacingL)` — fine for these dialogs, but note it can't fit e.g. logs; leave as is.
- **`ASwitch` contentItem relies on `control.text`** — used on the sync row with `enabled: false`; works, but a dedicated `ASwitchRow` (label + description + switch) would remove repetition seen in GeneralSettingsPage and here.
- **`ButtonGroup.group`** — not needed anywhere in this lane after switching domain toggles to switches (hint for other lanes: it is the correct attached-property form; `group:` is the P2-wave-A bug).
- **No `ATooltip` on disabled controls** explaining *why* they're disabled ("not wired yet") — currently communicated via badge/notes; consider wiring ATooltip once disabled-button tooltips are a pattern.
- **`AEmptyState.icon`** takes an emoji glyph string — worked for 🧹/👻; no change needed.
