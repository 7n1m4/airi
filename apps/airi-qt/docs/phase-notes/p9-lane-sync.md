<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane I4 — `airi-sync`: local-FS snapshot transport (Rust)

Wave ⑦ lane. This is the **first honest slice of AIRI's sync story for the Qt
build**: point-in-time snapshots of the app's data directory onto a local
filesystem destination (a folder, an external drive, an NFS/SMB/NAS mount).
It is a backup/restore engine, not a sync engine, and it says so.

**Honesty box, up front:**

- **Not S3 / not Hyperdrive / not libp2p.** There is no cloud transport, no
  object-store client, no mesh, no presigned anything. BYOS-to-a-folder is
  the only destination.
- **Not a migration tool, ever.** Electron's sync engine snapshots
  IndexedDB; this engine snapshots the **Qt app's SQLite / profile data
  directory** (the `airi.sqlite` vault and friends). It does not import,
  convert, read, or migrate anything produced by the Electron build. There
  is no migration path and there will not be one.
- **Not compressed.** Snapshots are plain file copies under
  `<id>.snap/files/`, deliberately **not** zip archives. `zip` was a
  declared dependency and was removed as unused (see Decisions). Plain
  copies keep every snapshot file inspectable and hashable with ordinary
  tools; compression is deferred.
- **No scheduling, no background auto-sync, no sync loop.** Everything is
  synchronous and caller-driven.
- **No deletion propagation.** Restore never deletes destination files that
  are absent from the snapshot; they are reported as `keep` and left alone.
- **No encryption at rest.** Anyone with read access to `dest_root` can read
  every snapshot.
- **No conflict resolution.** There is nothing to conflict with yet — one
  machine, one data dir, one backup folder.

Reference for the eventual UI:
`packages/stage-pages/src/pages/settings/modules/cloud-sync.vue` (read-only,
not modified) and the Qt scaffold at
`qml/pages/settings/modules/cloud-sync/CloudSyncSettingsPage.qml`.

## What landed

`apps/airi-qt/crates/airi-sync/` (the lane's only scope):

| File | Contents |
| --- | --- |
| `src/lib.rs` | Crate docs (scope/non-goals), re-exports, `#![deny(missing_docs)]` |
| `src/error.rs` | `SyncError` (thiserror) — typed variants, no stringly errors |
| `src/manifest.rs` | `SnapshotManifest`, `ManifestFile`, report types, `RestoreMode`, path validator |
| `src/timefmt.rs` | std-only UTC id rendering (Howard Hinnant civil-from-days; no chrono dep) |
| `src/ops.rs` | `create_snapshot` / `list_snapshots` / `verify_snapshot` / `restore_snapshot` / `prune_snapshots` |
| `tests/sync_tests.rs` | 13 tempdir-based integration tests |
| `Cargo.toml` | Dropped unused `zip`; kept `serde`, `serde_json`, `thiserror`, `tracing`, `sha2`; dev-dep `tempfile` |

### API

```rust
pub const FORMAT_VERSION: u32 = 1;                       // manifest.rs:10

pub fn create_snapshot(
    source_dir: &Path,
    dest_root: &Path,
    label: Option<&str>,
) -> Result<SnapshotManifest, SyncError>;                // ops.rs:213

pub fn list_snapshots(dest_root: &Path) -> Result<ListReport, SyncError>;   // ops.rs:340

pub fn verify_snapshot(snapshot_dir: &Path) -> Result<VerifyReport, SyncError>; // ops.rs:401

pub fn restore_snapshot(
    snapshot_dir: &Path,
    dest_dir: &Path,
    mode: RestoreMode,
) -> Result<RestoreReport, SyncError>;                    // ops.rs:495

pub fn prune_snapshots(dest_root: &Path, keep_last: usize) -> Result<PruneReport, SyncError>; // ops.rs:578
```

Key types: `SnapshotManifest` (`{ format_version, id, created_unix_ms,
label, source_path_hint, files[], skipped[], total_bytes }`), `SnapshotSummary`,
`ListReport { snapshots, skipped_corrupt }`,
`VerifyReport::Ok { files_checked, bytes_checked } | Corrupt { missing, mismatched }`,
`RestoreMode::DryRun | Overwrite { require_clean }` (`RestoreMode::OVERWRITE_CLEAN` is the safe constant, manifest.rs:137),
`RestorePlan { create, overwrite, unchanged, keep }`,
`RestoreReport { plan, bytes_written }`,
`PruneReport { kept, deleted, skipped_corrupt, bytes_freed }`.

`create_snapshot` skips files that cannot be hashed and records their
relative paths in `manifest.skipped` (a warning is also logged); symlinks are
skipped unconditionally and are *not* recorded in `skipped`.

### On-disk layout

```text
<dest_root>/
  20261111T1430Z-a1b2.snap/        id = YYYYMMDDTHHMMZ-<4 hex>, UTC, minute precision
    manifest.json                  written LAST, on create (ops.rs:326)
    files/
      <relative forward-slash path>   (plain file copy, mode 0644/via fs::copy)
```

Id format comes from `timefmt.rs` (`snapshot_id`, `YYYYMMDDTHHMMZ-a1b2`).
Uniqueness within the same minute is a 4-hex sha256-derived suffix
(`timefmt.rs:47`) plus an 8-attempt collision retry loop in `create_snapshot`
(`ops.rs:260-274`).

`manifest.json` is written **after** the file tree, so a parseable manifest
implies a complete tree at write time. On any failure after the `.snap`
directory is created, the partial snapshot is removed before the error is
returned (ops.rs:287). Empty source (missing dir, non-dir, or zero hashable
files) is a typed `SyncError::EmptySource`.

### Safety guards (with file:line)

1. **Symlinks are never followed** — walk (ops.rs:102), list (ops.rs:362),
   restore destination replacement (ops.rs:550), prune (ops.rs:611). A
   destination symlink colliding with a snapshot path is unlinked and
   replaced with a regular file rather than written through.
2. **Manifest path validation** — every file path read from a manifest must
   be relative, forward-slash, no NUL/backslash/drive-letter, no
   `.`/`..`/empty components (`validate_manifest_rel_path`, manifest.rs:193).
   Enforced on every read path (ops.rs:173-178 for content validation,
   ops.rs:124 for all joins via `join_under_root`). A hostile manifest
   cannot escape the snapshot/restore root.
3. **Manifest gate for deletion** — `prune_snapshots` only considers direct
   `*.snap` children of `dest_root`, canonicalizes both root and child to
   confirm containment (ops.rs:588-632), and deletes only if the manifest
   parses, validates, and its `id` equals the directory name
   (ops.rs:149 `read_manifest` with `expected_id`, enforced at ops.rs:180-184;
   re-checked TOCTOU-style immediately before `remove_dir_all`, ops.rs:656-661).
   Symlinks and non-`.snap` directories are never deleted.
4. **`keep_last == 0` is a typed error** (`SyncError::PruneKeepZero`,
   error.rs:79, returned at ops.rs:580) — the engine refuses to wipe every
   snapshot.
5. **Restore pre-flight** — before any write, every manifest file must exist
   in the snapshot's `files/` tree, else `SyncError::SnapshotIncomplete` and
   the destination is untouched (ops.rs:503-513).
6. **Overwrite guard** — with `require_clean: true` (the recommended default;
   `OVERWRITE_CLEAN`), any destination file whose sha256 differs from the
   snapshot aborts the restore *before any write happens*:
   `SyncError::DirtyTarget { count, files }` (ops.rs:528-533). Destination
   hash failures (unreadable dest) are treated as dirty, not as clean-pass.
   `require_clean: false` overwrites anyway and is for the future UI's
   destructive-confirm path only.
7. **Deletions are never propagated** — destination files absent from the
   snapshot are listed in `RestorePlan::keep` and left alone; v1 has no
   delete phase at all (see `compute_plan`, ops.rs:446, `RestorePlan::keep`
   docs at manifest.rs:144, and the crate-level non-goals at lib.rs:28-35).
8. **Partial-failure hygiene** — create failure removes the half-written
   `.snap` (ops.rs:287). Restore failures mid-copy may leave a partially
   restored destination (documented; v1 does not roll back), but the
   pre-flight check and the dirty-guard failure modes never write at all.
9. **Corrupt snapshots are skipped, not fatal** — `list_snapshots` and
   `prune_snapshots` skip and count them (`ListReport::skipped_corrupt` /
   `PruneReport::skipped_corrupt`); verify/restore on an explicitly named
   snapshot return a typed error instead.
10. **Deterministic manifests** — files sorted by relative path; manifest is
    pretty-printed; `total_bytes` is the sum of listed files.

### Decisions

- **Plain copy, not zip.** The lane spec allowed zip but v1 restores by
  reading individual files and comparing hashes; a zip would put an
  extraction step between the verify and the write. Zip was removed from
  `Cargo.toml` (it was declared but unused); if compression lands later it
  should be a new transport or an opt-in `.snapz` format with its own
  restore path, not a silent change to this one.
- **Minute-precision ids with a random suffix** (`20261111T1430Z-a1b2`) —
  sortable, human-scannable, collision-retried; no second-precision noise.
- **std-only UTC math** — one formatter does not justify a chrono/time
  dependency.
- **`dirs` was not added** — every entry point takes explicit paths; default
  location wiring belongs to the Qt bridge wave, which knows the real data
  dir (`<data>/airi-qt/`). Nothing in this crate guesses it.
- **Verify reports as a value, not an error.** `Ok`/`Corrupt` are both
  `Ok(VerifyReport)`; an unparseable manifest (the thing you pointed at
  doesn't exist as a snapshot at all) is the error case.
- **Manifest written last; `.snap` dir is the atomic unit of "this exists"**
  — pruners and listers trust only dirs with a parseable manifest.

## Test evidence

`cargo test -p airi-sync` — **13 passed, 0 failed** (tests/sync_tests.rs):

- create → manifest lists every file with correct bytes+sha256, plain-copy
  tree present, label round-trips
- create → missing source and empty source both yield `EmptySource`
- verify → `Ok { files_checked: 3, bytes_checked == total_bytes }`
- verify → corrupt (flip a byte) detected as `mismatched`; deleted file
  detected as `missing`
- list → newest-first ordering (deterministic via rewritten
  `created_unix_ms`), corrupt manifest skipped and counted, missing
  `dest_root` yields an empty report
- dry-run on empty dest → all `create`, destination not created, 0 bytes
- dry-run on identical dest (after a real restore) → all `unchanged`
- dry-run lists unrelated dest files as `keep`, nothing touched
- restore `require_clean: true` on a modified dest → typed `DirtyTarget`
  (count=2, exact paths), **destination untouched**
- restore `require_clean: false` → overwrites, bytes_written > 0
- restore creates parent dirs, `keep` files untouched
- prune → keeps 2 newest of 4, typed error on `keep_last == 0` (deletes
  nothing)
- prune → never deletes non-`.snap` dirs, corrupt-manifest `.snap` dirs, or
  manifest-id/dirname-mismatch dirs; deleted bytes accounted in
  `bytes_freed`

Gates: `cargo clippy -p airi-sync --all-targets -- -D warnings` — clean.
`cargo fmt -p airi-sync -- --check` — clean. Workspace member was already
registered (`apps/airi-qt/Cargo.toml`, not this lane's edit — the pre-existing
diff also registers airi-discord); `Cargo.lock` updated as a consequence of
builds (airi-sync deps now reflect the zip removal; no other lane's lock
entries were touched by hand).

## What's deferred (explicitly)

- **S3 / Hyperdrive transport** — no network code at all in this crate.
- **libp2p mesh sync** — out of scope entirely.
- **Encryption at rest** (age/keyring) — deferred; snapshots are plaintext.
- **Compression** — see Decisions; likely a `.snapz` v2 format later.
- **Scheduling / background sync / "Sync Now" wiring** — no timers here.
- **Selective sync scopes** — v1 snapshots the whole `source_dir`.
- **Retention policies beyond `keep_last`** (time-based, size-based) —
  deferred.
- **Atomic per-file writes on restore** (temp+rename) — plain `fs::copy`
  v1; a crash mid-restore can leave a partial tree (documented in the API
  docs).
- **Rollback of partial restores** — not attempted.
- **UI wiring** — the Cloud Sync page stays disabled until the bridge lands.
- **IndexedDB import** — does not exist and will not; the Qt app has no
  IndexedDB.

## Integration asks for the main agent

1. **Workspace registration** — already present (`crates/airi-sync` in the
   member list); nothing to do.
2. **Qt wiring (later wave)** — the Cloud Sync page
   (`qml/pages/settings/modules/cloud-sync/CloudSyncSettingsPage.qml`) and a
   cxx-qt bridge in `crates/airi-qt` need: (a) a way to pick `source_dir`
   (the app data dir, e.g. `<data>/airi-qt/` — `airi-store` knows the path),
   (b) a way to pick/remember `dest_root` (settings key), and (c) buttons
   wired to these five functions with `RestoreMode::OVERWRITE_CLEAN`
   defaulting to true and `require_clean: false` strictly behind a
   destructive confirm. None of that is started here, per lane rules.
3. **Data-dir contract** — `airi-sync` never guesses the data dir; the
   bridge must pass it explicitly. If `airi-store` exposes its path
   (it has `Database::open_default()` using `dirs::data_dir()/airi-qt`),
   reuse that constant rather than re-deriving it.
4. **Error surfacing** — UI should map `SyncError::DirtyTarget` to a
   "these files were modified" list dialog, `PruneKeepZero` never happens
   (UI clamps `keep_last >= 1`), and `Skipped` entries should be shown as a
   "N files could not be read" notice after create.
5. **Do not enable** the page's "Sync Now" until the bridge exists and a
   restore drill has been done against a real vault copy.

## Lane boundaries respected

Owned exclusively `apps/airi-qt/crates/airi-sync/**` and this note. No other
crate, QML file, locale, manifest, or lockfile-by-hand was touched. The
Qt-side files referenced above are read-only context.
