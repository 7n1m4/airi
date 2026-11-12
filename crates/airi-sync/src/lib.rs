// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! `airi-sync` — AIRI sync engine (BYOS), local-FS snapshot transport.
//!
//! This crate is the first honest slice of AIRI's sync story for the Slint
//! build: **point-in-time snapshots of the app's data directory onto a local
//! filesystem destination** (a folder, an external drive, an NFS/SMB/NAS
//! mount). It creates timestamped snapshots, lists them, verifies them,
//! restores them behind an overwrite guard, and prunes old ones.
//!
//! ## What this is NOT (read before filing issues)
//!
//! * **Not S3 / not Hyperdrive / not the Electron sync engine.** There is no
//!   cloud transport, no object store, no presigned URLs, no remote. the
//!   BYOS ("bring your own storage") folder is the *only* destination.
//! * **Not a migration tool, ever.** Electron's sync engine snapshots
//!   IndexedDB; this engine snapshots the **Slint app's SQLite / profile data
//!   directory** (e.g. the `airi.sqlite` vault and friends). It does not
//!   import, convert, migrate, or read anything produced by the Electron
//!   build, and it never will — there is no migration path, by design.
//! * **Not compressed.** Snapshots are plain file trees under
//!   `<id>.snap/files/<relative>`, deliberately *not* zip archives. Zip was
//!   declared as a dependency early on and removed unused: plain copies make
//!   restore safety inspectable (every snapshot file is a real file you can
//!   open and hash) at the cost of disk usage. Compression is deferred
//!   (see the phase note).
//! * **No automatic scheduling / background auto-sync.** Everything here is
//!   synchronous and caller-driven; nothing runs on a timer.
//! * **No deletion propagation.** Restore never deletes files in the
//!   destination that are absent from the snapshot; they are reported as
//!   [`RestorePlan::keep`] and left alone.
//! * **No encryption at rest.** Snapshots are readable by anyone with
//!   read access to `dest_root`. Encryption is deferred.
//!
//! ## On-disk layout
//!
//! ```text
//! <dest_root>/
//!   20261111T1430Z-a1b2.snap/
//!     manifest.json          (written LAST, on create)
//!     files/
//!       <relative forward-slash path>   (plain file copy)
//! ```
//!
//! `manifest.json` carries `format_version: 1` and a per-file
//! `{ path, bytes, sha256 }` table. Presence of a parseable, valid manifest
//! whose `id` matches the directory name is the gate every destructive or
//! restorative operation uses before touching anything.
//!
//! ## Safety guards (see phase note for file:line refs)
//!
//! * Symlinks are never followed anywhere (walk, restore, prune).
//! * Manifest paths must be relative, forward-slash, with no `.`/`..`/empty
//!   components and no drive-letter prefixes; anything else fails closed.
//! * Restore pre-flights that every manifest file exists in the snapshot
//!   before writing anything.
//! * Restore with `require_clean: true` (the recommended default) refuses to
//!   overwrite modified destination files, atomically with respect to the
//!   check — nothing is written. `require_clean: false` overwrites anyway
//!   and must stay behind a destructive confirm in the future UI.
//! * Prune never deletes `keep_last == 0` (typed error), never deletes a
//!   directory whose manifest does not parse/validate/match its directory
//!   name, and never deletes anything outside `<dest_root>`.
//!
//! ## Errors
//!
//! See [`SyncError`]. Corrupt snapshots are skipped-and-counted by
//! [`list_snapshots`] / [`prune_snapshots`] rather than being fatal; a
//! manifest that cannot be parsed where one file is explicitly named (verify,
//! restore) is an error.

mod error;
mod manifest;
mod ops;
mod timefmt;

pub use error::SyncError;
pub use manifest::{
    ListReport, ManifestFile, PruneReport, RestoreMode, RestorePlan, RestoreReport,
    SnapshotManifest, SnapshotSummary, VerifyReport, FORMAT_VERSION,
};
pub use ops::{
    create_snapshot, list_snapshots, prune_snapshots, restore_snapshot, verify_snapshot,
};
