<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Decision: audit archive (`.cleared-*`) disk-growth retention policy

- **Status:** Decided — policy only, no implementation authorized
- **Date:** 2026-11-21
- **Tracks:** bead `airi-eh4.7` (child of epic `airi-eh4`), "Decide audit archive disk-growth policy"
- **Supersedes:** the 2026-11-13 "undecided" note on `airi-eh4.7`

## Context

The awareness audit log is an append-only, redacted JSONL at
`<data_dir>/airi-slint/audit/awareness-audit.jsonl` (path contract in
`crates/airi-channel/src/audit.rs:14-27`). Two distinct lifecycles exist and
must not be confused:

- **Active file** — the daemon prunes it to a **7-day window on startup**
  (`RETENTION_MS` at `crates/airi-daemon/src/audit.rs:19`; `prune_on_start` at
  `crates/airi-daemon/src/audit.rs:146-191`). The prune reads and rewrites only
  `self.path`, the active file.
- **Archives** — `clear_audit()` (the only archiving entry point,
  `crates/airi-slint/src/bridges/daemon.rs:865-897`) calls
  `archive_audit_file()` (`crates/airi-channel/src/audit.rs:70-92`), which
  **renames** the active file to `<name>.cleared-<unix-ts>[-<counter>]` in the
  same directory. The `-<counter>` suffix handles same-second collisions
  (`audit.rs:85-89`); a missing file is a no-op success
  (`daemon.rs:870-876`). It never truncates or deletes history.

Actual behavior today: every `clear_audit()` call archives the current active
file; the daemon recreates a fresh active file on the next append. **No code
anywhere rotates, ages out, or deletes `.cleared-*` files** — grep finds only
their creation and tests (`crates/airi-channel/src/audit.rs:125-139`, whose
name is `archive_never_overwrites_and_keeps_history`). The 7-day prune does
not touch them. Archives therefore accumulate **forever**, growing disk usage
without bound, one archive per clear. The bridge doc comment already states
the intent: "never deletes or truncates history … so the forensic trail
survives" (`crates/airi-slint/src/bridges/daemon.rs:67-72`).

Reachability: `clear_audit()` is a Rust method on `DaemonState`
(`crates/airi-slint/src/bridges/daemon.rs:626`). It has **no callers** in the
repository and no `.slint` binding — there is no GUI deletion path today.

## Decision

1. **Default retention: retain archives forever.** Every `.cleared-*` file is
   kept permanently as forensic history. The current no-deletion behavior is
   the intended policy, not a gap.

2. **No GUI deletion path.** Forensic history must never be deletable, rotated,
   or pruned through any GUI surface. No button, callback, command palette, or
   settings control for deleting or rotating archives may be added. The
   existing absence of a Slint binding is mandatory, not incidental.

3. **Rotation/deletion, if ever needed, is a privileged manual operation.**
   Any reduction of archive data must be an explicitly-authorized,
   out-of-band, operator-driven filesystem action (e.g. an operator directly
   removing specific `.cleared-*` files under
   `<data_dir>/airi-slint/audit/`). It must never be automatic, scheduled, or
   built into the daemon or any client. Such an action requires fresh,
   explicit authorization from the owner for each occurrence.

4. **Owner:** the AIRI **daemon/ops operator** — the party that runs the
   `airi-daemon` session service and owns its data directory
   (`<data_dir>/airi-slint/audit/awareness-audit.jsonl` and its archives). This
   owner is the only party who may authorize the privileged manual deletion in
   (3). No UI end user is granted that authority.

5. **Existing `.cleared-*` files:** left untouched. All archives that exist at
   the time of this decision are retained under the forever default. Nothing
   is migrated, rewritten, re-encrypted, or deleted, and no backfill or
   cleanup pass is to be run.

6. **This decision authorizes no implementation.** It records policy only. In
   particular it does **not** authorize writing a rotation script, a cleanup
   command, a scheduled prune, removal logic in `audit.rs`/`daemon.rs`, or any
   GUI control. Any such code change requires its own explicit authorization
   and a separate change request. The current source already conforms to this
   policy and is to be left as-is.

## Rationale

Audit archives are forensic history: once deleted, the record is gone and the
loss is silent and irreversible. Bounded disk growth is a real concern, but it
is outweighed by preserving an intact trail, and the user-authorized constraint
on this bead forbids a GUI deletion path. Retaining by default and requiring a
named owner to authorize each manual deletion keeps the safer failure mode
(disk usage) reversible-by-operator while making evidence loss deliberate and
accountable.
