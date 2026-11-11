<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane I8 — Cloud Sync page wired to the real local-FS `SyncController` (Qt)

Wave ⑧ lane. This is the **UI half of the local-folder sync slice**: the
`airi-sync` snapshot engine (see `p9-lane-sync.md`, wave ⑦) is now bound to the
Cloud Sync settings page through a new cxx-qt bridge. What works, works for
real or not at all; everything without an engine behind it stays disabled and
says so.

**Honesty box, up front:**

- **Local folder target only.** No S3, no network, no mesh. The provider
  selector is enabled with exactly one selectable option (`Local File System /
  Folder`) and a hover tooltip stating S3 is not implemented — `ASelect`
  (a `ComboBox`) cannot disable individual items, so this is the honest
  compromise: the S3 option is gone from the list rather than greyed out, and
  the disabled S3 credential `DeferredField`s below remain fully visibly
  disabled with their "not wired" tooltips.
- **"Sync Now" is manual.** There is no scheduling backend; the interval
  slider stays disabled with its tooltip.
- **Snapshots are plain file copies of the Qt data directory.** `airi.sqlite*`
  is included, but a snapshot taken while the app is running is a *copy of a
  live database* — SQLite pages may be mid-transaction; the WAL/SHM files are
  copied as they are. See "Deferred: SQLite copy-consistency" below.
- **Restore never runs without user action**, and the default path refuses
  to overwrite files that were modified since the snapshot (`DirtyTarget`).
  The relaxed path exists only behind an explicit second confirm.
- **Nothing here fabricates status.** Configured/not-configured comes from
  the bridge reading `sync.json`; the last-snapshot line comes from the
  actual snapshot list; verification results are real re-hashes.
- Lane boundaries: I touched only `crates/airi-qt/src/bridges/sync.rs` (new),
  `qml/pages/settings/modules/cloud-sync/CloudSyncSettingsPage.qml` (edited
  in place), and this note. No `build.rs`, `mod.rs`, `Cargo.toml`, locale,
  component, or `SettingsWindow` edits. The other lanes' uncommitted work
  (discord, mcp, channel) is untouched.

## What landed

| File | Contents |
| --- | --- |
| `crates/airi-qt/src/bridges/sync.rs` (new, ~640 lines) | `SyncController` qobject; JSON boundary; mirrors `bridges/mcp.rs` conventions (atomic `sync.json` save — tmp + rename — profile/data-dir resolution, `json_ok` helper, `set_error`/`clear_error` helpers, explicit `snapshotsChanged` emission, `working` flag around every engine call) |
| `qml/pages/settings/modules/cloud-sync/CloudSyncSettingsPage.qml` | Same structural port as before, now wired: banner copy adjusted, Storage Target card enabled for local FS (path field, Save, Test Connection), new **Saved Snapshots** card (Repeater + Verify/Restore per row), live `Last snapshot:` line, restore confirm modal with dry-run plan |
| `docs/phase-notes/p9-lane-sync-page.md` | This note |

### Bridge API (`airi_qt::SyncController`)

QProperties (QML name → meaning):

| Property | Type | Meaning |
| --- | --- | --- |
| `snapshotsJson` | `QString` | JSON array `[{id, createdMs, label, totalBytes, files}]`, newest first (engine order). `label` may be `null`. `[]` when unset/missing/empty. |
| `targetPath` | `QString` | Persisted target folder. Read from `<profile>/airi/sync.json` (or `<platform-data>/airi-qt/sync.json`), schema `{"target_path": "..."}`. Property setters emit `targetPathChanged` (cxx-qt generated). |
| `snapshotsDir` | `QString` | Resolved target root (`<targetPath>`); `""` when unset. |
| `lastError` | `QString` | Last engine/bridge error, human-readable. `DirtyTarget` includes a 5-file list summary (+ "and N more"). |
| `working` | `bool` | `true` while any engine call is in flight (UI busy state). |

Signals: `snapshotsChanged` — emitted after every mutation that can change
the snapshot list (save target, probe-if-created, createSnapshot, prune,
restore — restore emits too, since it rewrites the data dir even though it
does not change the list). Plain `refreshSnapshots` does **not** emit.

QInvokables:

| Invokable | Signature | Notes |
| --- | --- | --- |
| `refreshSnapshots` | `() → ()` | Re-lists `<target>`. Missing `sync.json` = not an error; missing target dir → empty list; unreadable-but-`.snap` entries are skipped-and-counted: `skipped_corrupt > 0` surfaces as `lastError` = "N unreadable snapshot(s) skipped in <dir>" (non-fatal warning). |
| `saveTargetPath` | `(path: QString) → bool` | Persists `{"target_path": trimmed}` atomically, then re-lists (this is the refresh) and emits `snapshotsChanged`. `""` → `false` + `lastError`. **Spec deviation, see below.** |
| `probeTarget` | `() → QString` | `{"ok":true,"probeId":"...","filesChecked":N,"bytesChecked":N}` or `{"error":"..."}` / `{"ok":false,"probeId":"...","error":"..."}`. Creates an `airi-probe`-labeled snapshot of a 1-file temp dir under `std::env::temp_dir()` (std only), verifies it, **keeps it** (it shows in the list — honest), then re-lists. Target unset → `{"error":...}`. Target must **exist and be a directory** — the probe refuses to silently create a mis-typed root (the engine would otherwise `create_dir_all` it); `Sync Now` does create the root, that is its job. |
| `createSnapshot` | `(label: QString) → bool` | Snapshots the **Qt data dir** — same resolution chain as the MCP bridge minus the `airi/` leaf: `<profile>` when `--profile` is set, else `<platform-data>/airi-qt` (`dirs::data_dir()/airi-qt`). `airi.sqlite*` **is** included (whole-tree snapshot). `""` label → `None`. |
| `verifySnapshot` | `(snapshotId: QString) → QString` | `{"ok":true,"filesChecked":N,"bytesChecked":N}` \| `{"ok":false,"missing":[...],"mismatched":[...]}` \| `{"ok":false,...,"error":"..."}`. Snapshot ids are validated (`^[A-Za-z0-9-]{1,64}$`) before touching the filesystem. |
| `dryRunRestore` | `(snapshotId: QString) → QString` | `{"create":[...],"overwrite":[...],"unchanged":[...],"keep":[...]}` against the Qt data dir. `RestoreMode::DryRun` — **never writes**. `{"error":"..."}` on failure. |
| `restoreSnapshot` | `(snapshotId: QString, allowDirty: bool) → bool` | `RestoreMode::Overwrite { require_clean: !allowDirty }` into the Qt data dir. On `DirtyTarget`: `false` + `lastError` with the modified-file list summary. `allow_dirty: true` overwrites anyway — destructive, reachable only from the modal's second confirm. Emits `snapshotsChanged` on success. |
| `pruneSnapshots` | `(keepLast: i64) → bool` | Engine guard re-checked: `keepLast < 1` → `false`, `lastError` set, **nothing is pruned** (the engine would return `PruneKeepZero` anyway; the bridge refuses earlier with a clearer message). **Not wired in the page** — pruning stays disabled in this slice. |

Path-traversal safety: `snapshotId` from QML is validated before use; the
engine additionally validates every manifest path. Restore writes go through
the engine's pre-flight (`SnapshotIncomplete` → nothing written).

### Spec deviation you must know about: `saveTargetPath`, not `setTargetPath`

The spec asked for qinvokable `setTargetPath(path) -> bool` alongside a
qproperty `targetPath`. cxx-qt (0.10.0) **always** generates a property
setter `setTargetPath(QString)` as the `WRITE` slot of `Q_PROPERTY(... WRITE
setTargetPath ...)` (verified in the generated `sync.cxxqt.h`: `Q_SLOT void
setTargetPath(QString value) noexcept;`). A same-signature qinvokable cannot
coexist — `Q_INVOKABLE bool setTargetPath(QString)` fails to compile
("cannot be overloaded"). The property stays exactly as spec'd
(`targetPath`, cxx_name `targetPath`, Auto setter); the invokable was
renamed **`saveTargetPath`** (house style, cf. `saveServers` in the MCP
bridge). QML calls `controller.saveTargetPath(text)`. Behavior matches the
spec: persist → refresh → `true`/`false` + `snapshotsChanged`.
If the spec name is mandatory, the only path is a void-returning
`Q_PROPERTY WRITE = save_target_path` custom accessor and giving up the
bool-returning invokable QML wants; not recommended.

Other deviations, all deliberate and small:

1. **`saveTargetPath` rename** (above).
2. **Probe requires an existing directory target** — see `probeTarget`.
3. **`snapshotsChanged` is also emitted after a successful restore** (spec
   said "after any mutation"; restore mutates the data dir, not the list).
4. **`refreshSnapshots` does not emit `snapshotsChanged`** — emitting on a
   read gives QML nothing to re-derive and invites reload loops; plain
   property notifications (`snapshotsJsonChanged`, etc.) fire as usual.
5. **`"Overwrite anyway" is offered iff the dry-run plan has
   `overwrite.length > 0`.** The engine's `DirtyTarget` is otherwise
   indistinguishable from other failures from QML; the plan is the honest
   signal that a `require_clean` refusal is possible (and is also the only
   refusal the relaxed path can help with — `SnapshotIncomplete` etc. are
   unaffected by `allow_dirty`).
6. **Provider selector is enabled single-option**, no "S3 (disabled)" item —
   `ASelect` cannot disable items.
7. **`pragma ComponentBehavior: Bound` at file scope** — qmllint's suggested
   fix for outer-id references inside the Repeater delegate; zero-warning
   lint; semantics unchanged (declaration-time binding).
8. **`delegate: ColumnLayout` made explicit** (was implicit child) — same
   behavior, one less qmllint class of warning.

### Page breakdown

| Section | Before | Now |
| --- | --- | --- |
| Banner (persistent) | "not wired yet" copy | New copy: local folder snapshots work; S3/scheduling/etc. pending. New badge in header: **Local folder only** (`warning` variant) replacing "Not wired yet". |
| Storage Target — status row | "Not wired", grey dot, `—` | Live: green dot (`Theme.success`) + "Target folder configured" / grey + "No target folder configured"; badge → "Local folder only". |
| Provider selector | disabled, `[S3, Local FS]` selected 0 | **Enabled**, single option `Local File System / Samba Share` (i18n key reused), tooltip (`s3PendingTip`): S3 not implemented. |
| S3 credential fields | disabled + tooltips | **unchanged** (stay disabled). |
| Local path field | disabled field + tooltip | **Enabled** `ATextField` (`localPathField`), Enter in field triggers save; placeholder/label/description keys reused. |
| Buttons | disabled Test Connection | **Save** (Accent) + **Test Connection** (enabled, disabled only while `working`) — inline status line below (`storageStatus`, success/error colored). |
| SYNCHRONIZATION card | interval slider disabled, conflict select disabled, selective sync disabled | **unchanged** — all stay disabled with tooltips. |
| MANUAL ACTIONS — "Last synced" line | static "Last synced: never" | Live: `Last snapshot: yyyy-MM-dd HH:mm` of `snapshots[0].createdMs` when the list is non-empty; else the existing never-key. |
| MANUAL ACTIONS — Sync Now | disabled Accent button | **Enabled** Accent `AButton`; text flips to "Syncing…" while `working`; inline status line (`actionStatus`) shows result/`lastError`. Selective Sync stays disabled. Prune, Restore Settings, Restore Backup stay disabled (merged destructive path lives in Restore…). |
| **Saved Snapshots** (new card) | — | Section caption + `ACard`; `AEmptyState` ("No snapshots yet" + hint) when empty; `Repeater` of rows (title = label \| id; sub-line `id · date · size · file count`; **Verify** and **Restore…** per row; per-row verify-result line colored success/error). Verify/Restore buttons disabled while `working`. Trailing separator per row. |
| Conflicts / scope / mesh cards | disabled scaffold | **unchanged**. |
| Restore modal (new `AModal` at root) | — | Shows dry-run plan counts (`Create N missing`, `Overwrite N modified`, `Leave N identical untouched`, `Keep N existing (never deleted)`), or the plan error, or (after a failed confirm with `overwrite.length > 0`) the DirtyTarget hint + raw `lastError` + a second **Overwrite anyway** (Danger) button. Buttons: Cancel (Ghost), **Restore** (Danger, only when plan ok and not yet refused), **Overwrite anyway** (Danger, only after refusal). On success: modal closes, inline status "Restore completed.". |

### i18n

No locale files were touched (lane rules). **All user-visible static strings
go through `I18n.tr("shell.cloudSync.live.*")` with the English strings
below — the main agent adds them to `packages/i18n/src/locales/en/shell.yaml`
(and whatever locales the fan-out wants) before this ships.** Byte-unit
suffixes (" GB" / " MB" / " KB" / " B") are literal, matching
`ScrubHistoryDialog`'s precedent. Everything else is reused or machine text
(ids, error strings).

New namespace: `shell.cloudSync.live.*` (34 keys):

| Key | English string |
| --- | --- |
| `shell.cloudSync.live.notice` | 'The sync engine is only partly here: local folder snapshots work (create, verify, restore). S3, scheduling, selective sync, conflict tools and mesh sync are not implemented yet, so those stay disabled.' |
| `shell.cloudSync.live.partialBadge` | 'Local folder only' |
| `shell.cloudSync.live.stateConfigured` | 'Target folder configured' |
| `shell.cloudSync.live.stateNotConfigured` | 'No target folder configured' |
| `shell.cloudSync.live.s3PendingTip` | 'S3-compatible storage is not implemented yet — only a local folder target is available.' |
| `shell.cloudSync.live.save` | 'Save' |
| `shell.cloudSync.live.configSaved` | 'Target folder saved.' |
| `shell.cloudSync.live.probeOk` | 'Target OK — probe snapshot %1 created and verified.' |
| `shell.cloudSync.live.probeFailed` | 'Probe failed: %1' |
| `shell.cloudSync.live.syncDone` | 'Snapshot created.' |
| `shell.cloudSync.live.syncing` | 'Syncing…' |
| `shell.cloudSync.live.lastSnapshot` | 'Last snapshot: %1' |
| `shell.cloudSync.live.snapshotsTitle` | 'Saved Snapshots' |
| `shell.cloudSync.live.snapshotsEmpty` | 'No snapshots yet' |
| `shell.cloudSync.live.snapshotsEmptyHint` | 'Press Sync Now to create the first snapshot in the target folder.' |
| `shell.cloudSync.live.fileCount` | '%1 files' |
| `shell.cloudSync.live.verify` | 'Verify' |
| `shell.cloudSync.live.verifyOk` | 'Snapshot intact — %1 files, %2 re-hashed.' |
| `shell.cloudSync.live.verifyError` | 'Verify failed: %1' |
| `shell.cloudSync.live.verifyFailed` | 'Snapshot corrupt — %1 missing, %2 mismatched.' |
| `shell.cloudSync.live.restore` | 'Restore…' |
| `shell.cloudSync.live.restoreTitle` | 'Restore snapshot' |
| `shell.cloudSync.live.restoreSubtitle` | 'Plan against the current data directory (dry run — nothing is written until you confirm):' |
| `shell.cloudSync.live.restoreCreate` | 'Create %1 missing file(s)' |
| `shell.cloudSync.live.restoreOverwrite` | 'Overwrite %1 modified file(s) with the snapshot copy' |
| `shell.cloudSync.live.restoreUnchanged` | 'Leave %1 identical file(s) untouched' |
| `shell.cloudSync.live.restoreKeep` | 'Keep %1 existing file(s) (never deleted)' |
| `shell.cloudSync.live.restorePlanError` | 'Could not compute the restore plan.' |
| `shell.cloudSync.live.restoreDirtyHint` | 'Some data files were modified since the snapshot; a safe restore refuses to overwrite them. Choose Overwrite anyway only if you mean it.' |
| `shell.cloudSync.live.restoreConfirm` | 'Restore' |
| `shell.cloudSync.live.restoreOverwriteAnyway` | 'Overwrite anyway' |
| `shell.cloudSync.live.restoreDone` | 'Restore completed.' |
| `shell.cloudSync.live.cancel` | 'Cancel' |

Keys deliberately **not** reused/new, for reference: existing
`shell.cloudSync.{title,description,storage.*,sync.*,scope.*,mesh.*,actions.*,conflicts.*,deferredTip}`
all still used; `shell.cloudSync.deferredNotice` / `shell.cloudSync.notWiredBadge`
are no longer referenced by this page (left in the locale files untouched —
main agent decides whether to prune). Reused `shell.mcp.test.probing` was
considered and rejected: the Test Connection button only needs its static
`testConnection` text since a probe of a tiny temp dir is sub-second.
`shell.cloudSync.actions.lastSyncedNever` stays in place for the empty state.

String audit: every `text:`/`title:`/`subtitle:`/`placeholderText:`/`tip:` in
the new/edited regions goes through `I18n.tr`; literals are glyph/bytes/id
machine text only. No hex colors; all colors are `Theme.*`.

## Deferred (explicitly)

- **S3 / Hyperdrive transport** — untouched; fields stay disabled.
- **Scheduling / background auto-sync** — Sync Now is manual; slider disabled.
- **Selective Sync** (and its scope dialog) — disabled, not ported.
- **Conflict resolution UI** — conflicts card stays the honest empty state;
  there is nothing to conflict in one-machine local-folder mode.
- **Prune UI** — bridge implements `pruneSnapshots` (kept for the spec) but the
  page keeps the Prune button disabled behind the not-wired tooltip; wiring it
  is a one-line page change + confirm copy when the retention story lands.
- **Mesh sync** — untouched.
- **Restore-settings-only / restore-remote-backup rows** — stay disabled; the
  destructive whole-data-dir restore now lives in each snapshot's Restore… modal.
- **Compression / encryption at rest** — engine-level, see `p9-lane-sync.md`.
- **SQLite copy-consistency caveat (important).** A snapshot taken while the
  app is running plain-copies `airi.sqlite`, `airi.sqlite-wal`,
  `airi.sqlite-shm` mid-write; the copy may hold torn pages. v1 of the engine
  and this UI do nothing about it. A later pass should (a) recommend closing
  the app (or a `PRAGMA wal_checkpoint(TRUNCATE)` + read-only backup through
  the SQLite backup API) before restore/snapshot, and (b) put that language
  in the restore modal copy — e.g. a "Quit AIRI before restoring; the app
  must not write to the data directory mid-restore" line. Restore pre-flights
  existence only; it does not detect a running instance.
- **`--profile` vs temp default (repo-wide caveat, not this lane's to fix).**
  `main.rs` currently gives default launches a throwaway `temp_dir` profile,
  so "Sync Now" there snapshots an ephemeral dir — technically exactly the
  data the app is using, but not useful until default launches persist to
  `<platform-data>/airi-qt` again. `sync.json` and the snapshot source follow
  `profile_dir()`, so behavior is consistent with whatever the app itself does.
- **`skipped_corrupt` surfacing** is fire-and-forget through `lastError`; a
  dedicated UI affordance ("N unreadable snapshots — open folder…") is a
  later pass; no "open folder" exists in the shell yet.
- **`"Overwrite anyway" gating** uses `plan.overwrite.length > 0` rather than
  error-kind matching (opaque `bool` return). Consequence: if a restore fails
  for a *non*-`DirtyTarget` reason while the plan had modified files, the
  button is still offered; the engine will then fail honestly (e.g.
  `SnapshotIncomplete`) — no data is written. Acceptable for v1.
- **Bridge not yet registered in the repo build** — see Integration below.

## Verification

- `qmllint -I <fresh sandbox>` on `CloudSyncSettingsPage.qml` — **no errors,
  no warnings** (exit 0). Sandbox = copy of `qml/` + build-produced
  `target/cxxqt/qml_modules/com/airi/airiqt/plugin.qmltypes` (from the
  scratch-check build, which **does** include `SyncController` —
  `QML_NAMED_ELEMENT` and its `saveTargetPath`/`snapshotsChanged` are in the
  qmltypes) + `qmldir`. Earlier sandbox without the bridge's qmltypes showed
  exactly one `incompatible-type` warning (`SyncController` unknown); with the
  fresh qmltypes the page lints completely clean. Pragma
  `ComponentBehavior: Bound` eliminated the 8 nested-component outer-id
  "unqualified access" warnings (Qt-6-scoped; other pages tolerate these).
- Scratch `cargo check -p airi-qt` in a throwaway copy
  (`/tmp/opencode/airi-qt-sync-check`, repo copy with `--exclude=target`;
  ~7.5 MB) with `sync.rs` appended to `build.rs`'s `files` list and
  `pub mod sync;` in `bridges/mod.rs` (**copy only**):
  **Finished `dev` profile, 0 errors** (first run: 1m 01s; after the
  `saveTargetPath` rename: 29.61s). Full `cargo check`, not `clippy` — clippy
  on the workspace is the main agent's gate.
- Two cxx-qt integration failures were caught and fixed by this loop
  (both inside `bridges/sync.rs`, nothing in `build.rs` needed):
  1. Rust-side `set_target_path` collided with the generated property setter
     (`E0121`-class "defined multiple times") → renamed to `save_target_path`.
  2. `#[cxx_name = "setTargetPath"]` qinvokable collided with the generated
     `Q_SLOT void setTargetPath(QString)` at the C++ level → renamed the
     invokable to `saveTargetPath` (documented above).
- `cargo clippy -p airi-qt` not run (lane rules; workspace is mid-integration).
- Engine behavior (create/verify/restore/prune safety) covered by
  `airi-sync`'s own 13 integration tests — engine untouched by this lane.
- String audit (see above) clean; brace/parens balance visually checked;
  `git status --short`: only my three paths (+ other lanes' pre-existing
  modifications, none of them mine to touch).
- Nothing committed; repo `build.rs`/`mod.rs`/`Cargo.toml`/locales/components
  untouched, per lane rules.

## Integration snippets for the main agent (apply in the repo, not here)

### 1. `crates/airi-qt/build.rs` — add to the `files` array

After the `src/bridges/mcp.rs` line (alphabetical placement is near `mcp.rs`):

```rust
manifest_dir.join("src/bridges/sync.rs"),
```

(`emit_rerun_if_changed` already covers the tree recursively; no other
build.rs change needed. **QML registration NOT needed** — the page is
already registered in `build.rs` line ~149 and `SettingsWindow.qml` already
shows it.)

### 2. `crates/airi-qt/src/bridges/mod.rs` — add module line

Alphabetical — between `pub mod spine;` and `pub mod stage;`:

```rust
pub mod sync;
```

### 3. `crates/airi-qt/Cargo.toml` — nothing

`airi-sync = { path = "../airi-sync" }` and `dirs` are already dependencies.

### 4. i18n — add the 34 `shell.cloudSync.live.*` keys to

`packages/i18n/src/locales/en/shell.yaml` (English strings above) under
`cloudSync:`, e.g.:

```yaml
cloudSync:
  ...
  live:
    notice: 'The sync engine is only partly here: ...'
    ...
```

then the usual locale fan-out the main agent runs for new keys.

### 5. Sanity after registering

`cargo check -p airi-qt` (repo target dir) should reproduce the clean
scratch-check result; `qmllint` sandbox with the rebuilt
`target/cxxqt/qml_modules/com/airi/airiqt/plugin.qmltypes` stays at 0 warnings.

## Lane boundaries respected

Owned exclusively `sync.rs` (new), `CloudSyncSettingsPage.qml` (edit), this
note. `git status` shows other lanes' uncommitted work (discord, mcp,
channel, Cargo.toml/lock at root) as pre-existing — untouched. Scratch
containers under `/tmp/opencode/` only (`airi-qt-sync-check` copy,
`qmllint-sync-*` sandboxes, `qmllint-cloud-sync` reused) — nothing in the
repo was registered, built, or committed.
