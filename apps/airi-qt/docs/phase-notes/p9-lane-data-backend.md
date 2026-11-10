<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ④ (vault backend) — Data export/import/scrub, real and local

Implements the vault backend that Lane B specced in `p9-laneB-data.md`, and wires the four `qml/pages/settings/data/` surfaces to it. UI shows real results; nothing fakes success anywhere.

## Deliverables

**airi-store** (`crates/airi-store/src/lib.rs`)
- Migration **v4**: new `scrub_runs` table (`id, started_at, sessions_scanned, images_extracted, bytes_extracted, backup_path`) + index; `SCHEMA_VERSION` 3 → 4; `ScrubRunRepo` (`insert`, `list_recent`); `MessageRepo::list_all()` for full-history scans. Existing v1/v2/v3 migration tests updated to expect v4 and the new table.

**airi-core** (`crates/airi-core/src/vault.rs`, new)
- Stored (uncompressed) **ZIP writer + reader** (`zip_stored` / `zip_read`), hand-rolled with its own table-driven CRC-32; reader validates EOCD, central directory, per-entry method == stored, path safety, and CRC-32. Verified externally with `python3 -m zipfile` (lists + reads + `testzip() == None`).
- `VaultSelection { characters, chats, memory, providers, backgrounds }`.
- `stats(db, card_dirs) -> VaultStats` — per-domain count/bytes: chats = sessions count + `length(content|metadata)` sums; memory = summaries + journal + embeddings; providers = config bytes (credentials — flagged); characters = card files on disk; backgrounds = 0 (not implemented in this build).
- `collect_archive(db, card_dirs, selection) -> Vec<u8>` — human-readable JSON docs (`chats/sessions.json`, `chats/messages.json`, `memory/*.json`, `providers/providers.json`, `characters/cards/*` + names, `manifest.json` with `{format: airi-vault, version, created_at, includes_secrets, counts, notes}`).
- `inspect_archive(bytes) -> InspectionReport` — reads the archive: format/version/created_at/secrets flag, per-domain entry counts, session/message counts, companion names.
- `commit_archive(db, bytes) -> CommitReport` — **chats + memory only**, `INSERT OR IGNORE` (existing rows win, nothing is ever deleted or overwritten). `providers`/`characters` are reported in `not_applied`. No card writes, no credential application — by design.
- `scrub_session_media(db, backgrounds_dir, card_dirs, create_backup) -> ScrubReport` — scans `messages` for inline `data:image/*;base64,` payloads (length > 64), decodes, writes to `<backgrounds>/scrubbed/<fnv1a-64>.<ext>`, rewrites those messages to `![image](airi-asset://<hash>.<ext>)`, logs a `scrub_runs` row. `create_backup = true` writes a pre-scrub archive first (default for the UI's "Create Backup & Scrub").

**airi-qt bridge** (`crates/airi-qt/src/bridges/data.rs`, new, registered in `build.rs`)
- `DataController` qobject: `refreshStats`, `exportVault(selectionJson, destPath)` (default → `<profile>/exports/airi-vault-<ms>.zip`), `inspectVault(path)`, `commitVaultImport(path)`, `scrubRun(createBackup)`, `listScrubRuns()`. JSON boundary like the cards/providers bridges. Database handle registered from `main` (`set_database`).

**QML wiring**
- `DataExportDialog` — Confirm → real export; estimated size row shows actual selected-domain bytes (from `refreshStats`); success banner with path+size; error banner with backend message.
- `DataImportDialog` — Confirm → per-file `commitVaultImport` (skips nothing; result line per file with inserted counts and `not applied: …` list); success/error banner.
- `ScrubHistoryDialog` — Both buttons run the real scrub; the "Without Backup" path passes `createBackup=false`; "Create Backup & Scrub" backs up first. Result banner replaces the not-wired one. Working state disables buttons.
- `DataSettingsPage` — Scrub history card renders the real `listScrubRuns()` rows (date, sessions, images, bytes, backup marker); empty state stays until the first run. Vault/import dialogs open as before.
- 3 new i18n keys (`status.exportDone`, `status.importDone`, `status.scrubDone`) + rewrite of `importDialog.waveNote` — all 10 locales; `locales.test.ts` 4/4 green; `yaml-manager.js audit` clean.

## Verification

- `cargo test -p airi-core vault` — 7 tests green (crc vector, zip roundtrip, stats domains, collect/inspect roundtrip, commit inserts-then-skips, **scrub extracts image → message rewritten → backup archive inspects → run logged → second pass finds nothing**, inspect rejects non-vault zip).
- Hand-rolled ZIP verified by Python's `zipfile` (`python3 -m zipfile -l` + read + `testzip()`).
- `cargo test --workspace` — 23 suites green, 0 failures (store migration tests updated for v4).
- `cargo clippy --workspace --all-targets -- -D warnings` clean; `cargo fmt --all --check` clean.
- Offscreen smoke exit 0 (`settings` loads with the new `DataController` wiring; the Data pages instantiate).

## Honest limits / deviations

- **Export writes no fake anything** — but paths in the success banner are raw backend strings (not localized, and shouldn't be).
- **Restore covers chats+memory only** by design; importing providers (credentials) or cards requires separate UX and isn't silently done. The import result says exactly what was/wasn't applied.
- **Scrub is lossless-but-mutating**: it rewrites message content. It always extracts before rewriting, and the UI's default path backs up first; `scrubWithoutBackup` is the user's explicit choice.
- **Orphan detection stays unwired** — Qt sessions carry no `characterCardId` linkage (`sessions.metadata` defaults to `{}`), so the unlinked-data card remains an honest empty state rather than a lie.
- **Destructive resets** (delete all chats/models/all data/reset providers/modules/desktop) remain no-op confirmations; they need a dedicated destructive-action bridge with explicit gating, not a drive-by.
- **Cloud Sync** untouched (sync engine bridge is a separate phase).
- Background gallery does not exist in Qt (`backgrounds` domain is 0/empty everywhere).
- In-GUI verification of the dialog flows was not possible offscreen; backend behavior is unit-tested, page-load is smoke-verified, actual clicking is a desk check.
