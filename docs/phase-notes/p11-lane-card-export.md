<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P11 Lane — Card export: download-a-card-file flow for the Qt library page

Wave ⑪ lane. Scope (owned exclusively):

- `apps/airi-qt/crates/airi-qt/src/bridges/cards.rs` (additive only)
- `apps/airi-qt/qml/pages/cards/CardExportDialog.qml` (new)
- `apps/airi-qt/qml/pages/cards/CardLibraryPage.qml` (additive wiring only)
- `apps/airi-qt/docs/phase-notes/p11-lane-card-export.md` (this note)

Untouched by lane rule: `build.rs`, `bridges/mod.rs`, `Cargo.toml`, locales, components,
`SettingsWindow.qml`, import flow, save path, delete flow, and every other lane's in-progress files.

## What this ports (and what it deliberately does not)

Electron `settings/airi-card/components/CardExportDialog` + `use-card-export` composable
(`packages/stage-pages/src/pages/settings/airi-card/composables/use-card-export.ts`) offer
JSON download, PNG (framed, with `tEXt` chara chunk injected), and a ZIP package with models,
background, voice profiles, and memories. None of that is re-serialized on the Qt side in this
lane, by design: the Qt card store is the on-disk `<profile>/cards/*.png|*.json` directory, and
`airi_core::cards::save_card_file` already round-trips PNG `tEXt` chunks. The honest equivalent
of "download as file" here is a **byte copy** of the card file the user already has — PNG cards
export with their embedded `tEXt` chunks intact, JSON cards export as-is.

Electron's PNG re-embed (generating a fresh `chara_card_v2` JSON and injecting it as a new `tEXt`
chunk), the framed-cover render pipeline, and the ZIP package format are **not** ported. Byte copy
only, per lane spec — no card re-serialization of any kind happens in Rust or QML.

## Bridge — `bridges/cards.rs` (additive)

New `#[qinvokable]` on `CardController` (namespace `airi_qt`):

| Method | Signature |
| --- | --- |
| `exportCardToFile` | `(cardId: QString, destination: QString) -> bool` |

`destination` is the full file path the user confirmed in a `FileDialog.SaveFile`.

Behavior, exactly:

1. `card not found: <id>` when `locate_card(id)` finds nothing. `locate_card` is the same
   resolver the load path (`loadCard`) uses: `<platform-data>/airi-qt/cards/<id>.{png,json}`,
   then `<profile>/cards/<id>.{png,json}`. PNG is checked before JSON, same as scan order.
2. Refuses a destination that is a directory (`the destination is a directory, not a file`).
3. Refuses to copy a card onto itself (`the destination is the card's own file`) — without this,
   `std::fs::copy` would truncate the source first and destroy the card. Comparison canonicalizes
   both paths when the destination exists (catches symlinks), and falls back to an absolute
   lexical comparison against `current_dir()` for a not-yet-existing destination.
4. `std::fs::copy(source, destination)`. The destination is used **as given** and **overwrites
   silently if it exists** — this mirrors desktop convention; the SaveFile dialog already asked
   the user to confirm the overwrite (Qt Quick Dialogs shows its native replace confirmation by
   default; `FileDialog.DontConfirmOverwrite` is deliberately *not* set).
5. **No parent directories are created** — an unwritable/missing parent surfaces as the copy's
   error. `destination.trim().is_empty()` is rejected before touching disk.
6. On failure: `error` qproperty set via the bridge's existing `set_error_msg` with a
   human-readable, token-free, path-safe message (the destination path is never echoed; the
   `std::io::Error` string contains no path). On success the `error` property is cleared.
   **No new persisted settings. No rescan / `cardsChanged` emission** — the card library is
   unchanged by an export, so the page refreshes nothing.
7. **PNG bytes are copied verbatim** — embedded `tEXt`/`iTXt` chunks survive untouched. JSON is
   copied as-is. Nothing is parsed, re-encoded, or pretty-printed.

The bridge was already registered in `build.rs`'s `files` list and `bridges/mod.rs`
(`pub mod cards` + `pub fn` in this file only), so no registration work is needed for the Rust side.

## Dialog — `qml/pages/cards/CardExportDialog.qml` (new)

A small `AModal` port of the Electron dialog's *intent* (filename → confirm destination → copy),
using the existing Qt dialogs idiom (`DataImportDialog.qml` for `localPath()`,
`StageSettingsPage.qml` for `selectedFile`, `QtQuick.Dialogs` + `QtCore/StandardPaths`).

- Root `AModal`, title `shell.cards.exportDialogTitle`.
- Two properties set by the page's `openExport()`: `card` (row model: `{id, name, kind, path}`)
  and `ext` (`"png" | "json"`, derived from `kind`, falling back to the `path` suffix).
- Signal `exportRequested(string destination)` carrying the absolute local path; the **page** calls
  the bridge.
- Filename `ATextField`, prefilled `<sanitized card-name>.<ext>`:
  name trimmed, characters hostile to filenames on any platform (`\ / : * ? " < > |` and
  `\u0000–\u001f`) mapped to `_`, trailing dots/spaces stripped, empty ⇒ `card`. If the name
  already ends with the matching extension, it is kept as-is.
- Cancel (Ghost) + **Export** (Accent, disabled while the field is empty or whitespace).
  The Export button and `onAccepted` of Enter both call `openSaveDialog()`.
- `openSaveDialog()`: `currentFolder`/`selectedFile` on the `FileDialog` are set to
  `StandardPaths.writableLocation(StandardPaths.DocumentsLocation)` + `/` +
  `encodeURIComponent(fileName)` when Documents resolves, so the native Save dialog opens there
  with the suggested name. When Documents is unavailable the Save dialog opens on its default
  folder with an empty name and the user types one — never a hard failure.
- `FileDialog { fileMode: FileDialog.SaveFile; defaultSuffix: ext }` with `nameFilters`
  `PNG card (*.png) / JSON card (*.json)` + `All files (*)`, both via new `shell.cards.*` keys.
  Accepting emits `exportRequested(localPath(selectedFile))`; the SaveFile's own overwrite
  confirmation is the single confirmation step, so the bridge does not second-guess it.
- `localPath()` handles `file://` + percent-decoding + the `file:///C:/…` → `C:/…` Windows case.

## Page wiring — `qml/pages/cards/CardLibraryPage.qml` (additive)

1. New properties: `statusMessage: ""`, `exportTargetCard: null`.
2. New `statusTimer` (4 s, `Timer`) clearing `statusMessage`; new transient green
   `Text` (`Theme.success`, same slot pattern as the existing red `errorMessage` row) under the
   header — this is the page's existing idiom for transient feedback (mirrors
   `StageSettingsPage`'s notice timer), now reused for export success.
3. New functions: `openExport(cardEntry)` (stores the row model, opens the dialog with the
   prefilled name) and `exportCard(destination)` (calls
   `controller.exportCardToFile(exportTargetCard.id, destination)`; on success clears
   `errorMessage`, sets `statusMessage = "Card exported."` and restarts `statusTimer`; on failure
   closes the dialog and routes the bridge's `error` into the page's existing red `errorMessage`
   row — same handling as import/delete failures).
4. New `CardExportDialog { id: exportDialog; onExportRequested: … }` instantiation next to the
   existing `importDialog`.
5. New per-row **Export** `AButton` between *Edit* and *Delete* in every row — every pixel around
   it untouched (`Use`/`Edit`/`Delete`, avatar, greeting, kind/path line, layout, delete-confirm
   modal, empty footer unchanged).
6. **No refresh on export** — card contents don't change; the library is not rescanned and
   `cardsChanged` is not needed.
7. `localPath` was already in the page (used by import); the dialog carries its own copy with
   Windows-drive handling.

## i18n keys (English source; NO locale files edited)

New under `shell.cards.*` (lands in `packages/i18n/src/locales/*/shell.yaml`, `cards:` map,
after `save: Save` — line 273 in `en/shell.yaml`):

| Key | Suggested English source |
| --- | --- |
| `shell.cards.export` | Export |
| `shell.cards.exportDialogTitle` | Export card |
| `shell.cards.exportHint` | Save a byte-identical copy of this card to a file. |
| `shell.cards.exportFileName` | File name |
| `shell.cards.exportDone` | Card exported. |
| `shell.cards.exportFilterPng` | PNG card (*.png) |
| `shell.cards.exportFilterJson` | JSON card (*.json) |
| `shell.cards.exportFilterAll` | All files (*) |

Reused existing keys: `shell.cards.cancel`, `shell.cards.edit`, `shell.cards.delete`.
`shell.cards.exportDialogTitle` (new) is reused as the SaveFile dialog's own title.
Electron-parity keys `shell.data.export*` are untouched. No `cards:`-section collision — the
referenced keys are all new; until the locale lane embeds them, `airi_i18n` falls back to English,
then to the raw key.

## Integration needed from central (NOT applied here)

`apps/airi-qt/crates/airi-qt/build.rs` — register the new dialog in the `qml_file` block, next to
the existing cards pages (after line ~137):

```rust
module = module.qml_file("qml/pages/cards/CardExportDialog.qml");
```

Without this one line the page fails at runtime to instantiate `CardExportDialog` ("unknown
type"). **`cargo check` still passes without it** (qmlcachegen/QML module registration tolerate
an unresolvable leaf type at cache-compile time), so a green check is not evidence the wiring is
complete. Verified passing in this lane both before (check rebuilt with the new page present) and
after a sandboxed registration + qmllint pass (below).

Locale keys must also be embedded by the locale lane — without them the new UI strings render as
raw `shell.cards.export…` keys (English fallback exists only after they are added to `en`).

## Verification

| Step | Result |
| --- | --- |
| `cargo check -p airi-qt` | ✅ clean (1m 17s; build.rs re-ran, qmlcachegen compiled the edited pages without error) |
| `cargo clippy -p airi-qt -- -D warnings` | ✅ clean (2m 01s) |
| `cargo fmt -p airi-qt -- --check` | ✅ clean after one fmt pass on the new `same_file` helper |
| `qmllint` (sandbox: verbatim `qml/` copy + generated `qmldir`/`plugin.qmltypes` from `target/cxxqt`, plus a `CardExportDialog 1.0` line in the *sandbox* qmldir, fresh plugin.qmltypes regenerated with `exportCardToFile`) | `CardExportDialog.qml`: **0 warnings, exit 0**. `CardLibraryPage.qml`: exit 0; only the page's pre-existing unqualified-access infos and one pre-existing unused-import info — none from this lane's new code (`exportCardToFile` resolves after regeneration) |
| `qmlcachegen` (manual invocation, pre-registration qmldir) | exit 0 |
| `cargo fmt` footprint | only this lane's files; `git diff` confirms other lanes' untracked/modified files untouched |

Not verified: **GUI smoke** — per lane rule this is CENTRAL's gate; the real Save dialog
(GTK/quickimpl fallback), Documents-folder prefill, and end-to-end copy were not exercised on a
compositor. Not verified: Windows `file:///C:/…` path handling (code path present, untested).

## Not done / out of scope

- No PNG `tEXt` re-embed of updated card JSON — byte copy only, always.
- No framed-cover PNG generation, no ZIP package export, no whole-library export.
- No export of episodic memories/backups/vaults — cards only.
- No new persisted settings; nothing written to `settings/cards` (or anywhere) by an export.
- No refresh/rescan after export (deliberate; cards unchanged).
- Export filename conflicts resolve via the Save dialog's native replace confirmation; no
  timestamping, no auto-unique suffixes.
- The per-row Export button adds ~90 px to a row that already holds three buttons; no layout
  metrics were adjusted and none were smoke-tested.

## Notes for central

- After registration, Settings → Cards should show an Export button per row; failure states
  surface in the page's existing red error row, success shows a 4 s transient green line.
- If GUI smoke reveals the row overflows at narrow widths, the fix is a `Layout.preferredWidth`
  tweak on the row's export button — not a bridge change.
- `plugin.qmltypes` at `target/cxxqt/.../plugin.qmltypes` now carries `exportCardToFile`
  (regenerated by this lane's `cargo check`); nothing to hand-edit there.
- `/tmp/opencode/qmllint-cards/` is a disposable sandbox; nothing in `target/` is intended for
  commit.

— Lane D5 (module services chrome, wave ⑪).
