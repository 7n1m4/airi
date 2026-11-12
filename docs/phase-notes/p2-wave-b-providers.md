// SPDX-License-Identifier: GPL-3.0-or-later
# P2 Wave B — Provider settings pages (lane ③)

## What shipped

- **Bridge** `crates/airi-qt/src/bridges/providers.rs` — `ProviderSettingsController` (qobject).
  - Properties (camelCase QML names, `#[cxx_name]`): `testing` (bool), `lastTestId` (QString), `lastTestStatus` (`""|success|failed|unsupported"`), `modelsLoading` (bool), `models` (`QStringList`), `modelsError` (QString).
  - Signals: `testFinished(QString id, bool ok, QString message)`, `modelsLoaded(QString id, QStringList models)`.
  - Invokables: `listProviders()` (one-shot JSON array), `loadConfig(id)` → flat JSON object string, `saveConfig(id, configJson)` → bool, `saveEnabled(id, bool)` → bool, `deleteConfig(id)` → bool, `testConnection(id)` (async), `listModels(id)` (async), `drainEvents()` (Qt-thread pump).
  - Design notes:
    - 44 registry rows render as data from `airi_llm::PROVIDER_DEFS` (via `ProviderRegistry::all()`); zero per-provider QML. The detail form is built entirely from each row's `CredentialSchema` fields.
    - JSON is used at the `listProviders()`/`loadConfig`/`saveConfig` boundary: cxx-qt 0.10 cannot express a Rust-subclassed `QAbstractListModel` (see `docs/bridge-pattern.md`) and the payloads are consumed wholesale on page load/refresh. `enabled` stays out of the `loadConfig` payload so a save round-trip cannot smuggle it into `extra_json`.
    - Well-known keys (`api_key`, `base_url`, `model`) map to typed `ProviderConfig` fields; everything else (`account_id`, `region`, `aws_*`) is kept in `extra_json`. Reserved record keys (`id|kind|enabled|updated_at|config`) are stripped on save. Empty string clears a field.
    - Async shape per spec: `testConnection`/`listModels` spawn on the shared Tokio handle registered from `main` (`bridges::set_runtime_handle`), push results onto a per-instance `mpsc`; a QML `Timer` (50 ms) drains via `drainEvents()`, which writes properties and emits `testFinished`/`modelsLoaded`. Async tasks never touch the Qt thread.
    - `testConnection()` tests the **stored** configuration; the QML Test button runs `saveConfig()` first, then `testConnection(id)`.
    - HTTP probes share `fetch_models()` (build_client → `models()`), wrapped in `tokio::time::timeout(15s)` because `airi-llm` clients have no total timeout by design (streams unbounded).
    - Persistence via `airi_store::ProviderRepo` (id, kind, config JSON, enabled, updated_at). Saving a config for a *new* provider enables it; existing records keep their flag. Non-chat rows (Bedrock, Laya/OpenJev on-device engines, TypeSafe-AI) are saved/rendered but `testConnection`/`listModels` return `unsupported` without any network call.
    - Cross-thread `ProviderRepo` handle is a second `db.clone()` from `main.rs` (cheap, shares the `Arc<Mutex<Connection>>`), registered via `bridges::set_provider_repo`.
- **QML** `qml/pages/settings/providers/{ProvidersPage,ProviderRow,ProviderDetail}.qml`.
  - `ProvidersPage`: search-filtered `ListView` (left) + detail (right). `ProviderRow`: glyph circle (first alphanumeric of label, `Theme.accent` fill, `accentContrast` letter — no icon dependency), label, localized kind line, green dot when enabled, `ATooltip` "not yet available" on hover for non-chat rows (rows remain selectable so the form renders, with all controls disabled behind `enabled: chatCapable`). `ProviderDetail`: label/kind/configured/not-available badges, enable `ASwitch`, `CredentialSchema`-driven fields (secrets as `TextInput.Password`, `model` as an editable `ASelect` populated by `listModels`, free text always allowed), Test (saves first, `AProgress` indeterminate while `testing`), Save (accent), Remove (danger, only when `configured`), status area (localized success/failure labels + diagnostic detail from the bridge).
  - Same-id page-list refreshes (enable toggle, post-save badge) preserve in-progress field edits via a `loadedId` guard; switching providers reloads from the store.
- **i18n**: `packages/i18n/src/locales/*/shell.yaml` ×10 — added 28 `providers.*` keys (search, search-empty, enabled, not-available(+hint), configured, test(+success/failed/unsupported), save/saved/save-failed, delete, models-refresh, models-empty, kind.*, field.*), removed dead `providers.placeholder.*`. `settings.nav.soon` kept (still used by ChatWindow). All 10 locales: **83 leaf keys, exact parity** (verified programmatically); `npx vitest run src/locales.test.ts` ✅ 3/3.
- **SettingsWindow.qml** (additive, minimal): slot 0 now hosts `ProvidersPage {}` instead of the `AEmptyState` placeholder; stale `subtitle: "Wave B"` on the Providers nav item removed; header comment updated. Nav chrome untouched.
- **build.rs** (additive, Wave A-owned file): `src/bridges/providers.rs` added to `.files()`; `ProvidersPage`, `ProviderRow`, `ProviderDetail` registered from `qml/pages/settings/providers/`. The `chat.rs` entry + `qml/chat/*` block come from lane ② — **kept**.
- **mod.rs** (additive): `pub mod providers`; statics/`OnceLock`s `PROVIDERS` (`ProviderRepo`) and `RUNTIME` (`tokio::runtime::Handle`) plus `set_provider_repo` / `provider_repo` / `set_runtime_handle` / `runtime_handle` and the registration helpers. `main.rs` (additive): `bridges::set_runtime_handle(rt.handle().clone())` after runtime build; `set_provider_repo(ProviderRepo::new(db.clone()))` next to the settings-store registration.

## Bridge API surface (QML-visible)

`ProviderSettingsController` in module `com.airi.airiqt`:
`testing` : bool · `lastTestId` : QString · `lastTestStatus` : QString · `modelsLoading` : bool · `models` : QStringList · `modelsError` : QString
`listProviders() : QString` · `loadConfig(id) : QString` · `saveConfig(id, configJson) : bool` · `saveEnabled(id, enabled) : bool` · `deleteConfig(id) : bool`
`testConnection(id)` · `listModels(id)` · `drainEvents()` · signals `testFinished(QString, bool, QString)` · `modelsLoaded(QString, QStringList)`

`listProviders()` JSON shape: `[{ id, label, kind, chatCapable, enabled, configured, defaultBaseUrl, compatNote, fields: [{ key, label, secret, required, placeholder }] }]` (camelCase). The kind tag is kebab-case (`open-ai-compatible|anthropic|google-gemini|aws-bedrock|local-server`) and maps to `shell.providers.kind.*`.

## Verification (honest)

- `npx vitest run src/locales.test.ts` ✅ 3/3. Shell 10-locale key parity ✅ (83/83, verified with a flattening script).
- `cargo check -p airi-qt` ✅ 0 errors. `qmlcachegen` compiles `ProvidersPage/ProviderRow/ProviderDetail.qml` ✅ (re-generated `*.o` artifacts).
- `cargo build -p airi-qt` ✅ green. `--smoke` ✅ exit 0 — settings window with `ProvidersPage` opened, zero `ProvidersPage` runtime/QML warnings in the log (lane ②'s `chat/*.qml` files logged pre-existing `.length of undefined` noise, unrelated); `splash, control-strip, chat, settings, about` visited; `smoke: chat outcome: done (2 deltas applied)`; `1412` i18n keys embedded.
- `cargo test --workspace` ✅ all green, incl. `airi-qt` binary: `provider_records_covers_registry` ✅, `save_load_roundtrip_and_delete` ✅, `fetch_models_success_against_mock` ✅ (loopback mock: `GET /v1/models` → both mock ids), `fetch_models_401_surfaces_provider_error` ✅. No live provider was ever contacted; nothing here has been verified against OpenAI/OpenRouter/etc. — mock-verified only.
- `cargo clippy --workspace -- -D warnings` ✅ green (one lane-② clippy lint — `unnecessary_sort_by` in `chat.rs` — fixed by that lane).
- `cargo fmt`: `providers.rs`, `mod.rs`, `main.rs` clean (rustfmt run on the three files directly + `cargo fmt --check`). `chat.rs` has pending fmt diffs — lane ②'s file, left alone. Full-workspace fmt would touch lane ②'s in-progress file.
- One mid-session incident: **lane ② deleted `pub mod i18n;` from `bridges/mod.rs`** (their edit adding `pub mod chat;`), which orphaned the i18n bridge's C++ symbols and broke the shared link (`undefined symbol: airi_qt$cxxbridge1$205$I18nBridge$…`). Restored the one-line `pub mod i18n;`; noted to lane ②.
- Rust signal emission path verified by reading the `#[cxx_qt::bridge]` macro output (`impl Probe { pub fn test_finished(...) }` — signals are inherent methods on the qobject type, no `unsafe` thunk) and by matching the crate's own `windows.rs`/`shell.rs` conventions.

## Deviations / notes

- **Corruption incident (fixed)**: a scripted edit (`python` refactor with substring `str.index`) mangled `providers.rs` mid-session; it was rewritten in full and re-verified (registry tests text-identical intent). `ProviderDetail.qml` was likewise mangled by a bad `edit` (misplaced `AButton` inside the notice row + unbalanced braces) and repaired by hand; braces balanced and `qmlcachegen` green after repair.
- `testConnection`/`listModels` test the **stored** config by design (spec signature `testConnection(id)`); UX consequence: the Test button saves first.
- `enabled` records created by `saveEnabled` with no config carry `config: {}` → `configured=false`, `enabled=true` — deliberate.
- `compatNote` (registry diagnostic English) renders raw as secondary text; `modelsError` carries raw provider error text for the same reason (diagnostic data, not prose). Everything else user-visible goes through `I18n.tr`.
- i18n: `shell.providers.kind.aws-bedrock` key keeps its hyphen; kind key slug must stay in sync with `kind_str()` in `providers.rs`.
- QML detail holds credentials in a plain JS `fieldValues` map; no redaction beyond password echo (matches Edit-in-place semantics; never logged).
- `AProgress` `indeterminate` used for the test spinner.
- Did **not** touch `apps/stage-qt/`, `apps/airi-qt` frozen dirs, or lane ②'s files (2 remaining compile errors there reported via IRC, not edited).

## Files touched

`crates/airi-qt/src/bridges/providers.rs` (new), `crates/airi-qt/src/bridges/mod.rs` (additive: `pub mod providers` + `set_provider_repo`/`set_runtime_handle`/`provider_repo`/`runtime_handle` + restore of `pub mod i18n;` removed by lane ②), `crates/airi-qt/src/main.rs` (additive, 3 hunks), `crates/airi-qt/build.rs` (additive: providers.rs + 3 QML registrations; lane ② entries kept), `qml/pages/settings/providers/{ProvidersPage,ProviderRow,ProviderDetail}.qml` (new), `qml/shell/SettingsWindow.qml` (slot 0 + nav subtitle removal + header comment), `packages/i18n/src/locales/*/shell.yaml` ×10, this file.
