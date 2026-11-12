// SPDX-License-Identifier: GPL-3.0-or-later
# P2 Wave B — Chat workspace (lane ②)

## What shipped

- **Bridge** `crates/airi-qt/src/bridges/chat.rs` — `ChatController` + `ChatMessageEntry` / `ChatSessionEntry` / `ChatCardEntry` qobjects.
  - Properties (camelCase in QML): `streaming`, `status` (`idle|streaming|waiting-on-tool|error`), `error`, `title`, `sessionId`, `providerLabel`, `assistantName`, `activeCardId`, `activeCardAvatar`, `streamingMessageId`, plus `messagesModel` / `sessionsModel` / `cardsModel`.
  - **List-property mechanism (deviation from bridge-pattern.md)**: the model properties are exposed as `QList<QVariant>` (`#[cxx_name = "QList_QVariant"]`, the using-declaration from `cxx-qt-lib/core/qlist/qlist_QVariant.h`) holding `QObjectMutPtr` entries (`QVariant::from`). A `QList<QObject*>` qproperty compiles but is NOT visible to QML as a sequence (unknown metatype), so delegates never saw `modelData`. Repeater delegates therefore declare `required property var modelData`; each `modelData` is the entry QObject. Deltas still mutate the streaming entry's `content` in place; the list notifies only on append/clear — same no-rebuild-while-streaming semantics as the spike decision.
  - Invokables: `pumpEvents()`, `newSession()`, `selectSession(id)`, `deleteSession(id)`, `send(text)`, `stop()`, `activateCard(id)`, `clearCard()`, `listCards()`, `clearError()`, `isSmoke()` (all camelCase in QML via `#[cxx_name]`).
  - Data flow: `ChatService` → broadcast → unbounded mpsc (forwarder task on Tokio) → QML calls `pumpEvents()` on a 33 ms timer → Qt-thread property updates. Persistence goes through `MessageRepo` directly (chat service's `send_message` path unused because the bridge needs a system-prompt channel). History is rebuilt from the store on `selectSession`.
- **Workspace QML** `qml/chat/{SessionListPanel,TranscriptList,MessageItem,Composer,CardPicker}.qml` and the `ChatWindow.qml` body (window chrome kept). Sidebar (search + new chat, active-session highlight), transcript (markdown `Text.MarkdownText` assistant bubbles, streaming caret, auto-scroll near bottom), composer (plain Enter sends, Shift/Alt+Enter newline, send↔stop swap), provider/model label, error banner, character-card picker.
- **Character cards**: `<profile>/cards/*.png|*.json` (CCv2/CCv3). Scan: `<XDG_DATA_HOME|~/.local/share>/airi-qt/cards` then `<profile>/cards` (profile wins on id collision) — works for the default ephemeral-temp-profile launch and for `--profile` runs. `--import-card <file>` (additive to `main.rs`, no GUI boot) parses PNG/JSON, slugifies the name, copies as `<slug>-<nanos>.<ext>` (platform dir, or the `--profile` cards dir when set).
  - Applying a card: name/avatar via qproperties; system prompt = explicit `system_prompt` else `description` + `Personality:` + `Scenario:` blocks; `first_mes` becomes a persisted assistant greeting (empty current session or new session only). Card choice is per app run, not stored per session.
- **Provider resolution**: smoke override (only `--smoke`) → `AIRI_QT_PROVIDER` / `AIRI_QT_MODEL` / `AIRI_QT_API_KEY` / `AIRI_QT_BASE_URL` env → first enabled row in the `providers` sqlite table (config JSON → `ProviderConfig`, `model` required) → unconfigured (sends fail with a user-facing error). The providers lane's `providers` bridge writes the same table, so a configured provider becomes chat-able through this path with zero coordination.
- **Smoke**: `--smoke` registers a local `127.0.0.1` OpenAI-compatible SSE mock (canned two-delta + `stop` response over real HTTP/reqwest) plus a provider override; the smoke ChatWindow sends `.smoke` on completion. `main.rs` fails the smoke run unless the tour reaches About **and** a chat `MessageDone` was pumped (`smoke_chat_outcome()` / `smoke_delta_count()`); proxy env vars are stripped in smoke mode only.
- **i18n**: `shell.chat.*` replaced with the workspace keys; identical 83-leaf key sets across all 10 locales. `npx vitest run src/locales.test.ts` ✅ 3/3.

## Verification (all green at time of writing)

- `cargo check -p airi-qt`, `cargo build -p airi-qt` ✅
- `QT_QPA_PLATFORM=offscreen cargo run -p airi-qt -- --smoke` ✅ exit 0; tour visits splash → control-strip → chat → settings → about; chat outcome `done`, 2 deltas applied; zero QML errors in the log. Note: smoke without `QT_QPA_PLATFORM=offscreen` also works on this machine (`DISPLAY=:0`, Wayland). No screenshot was taken (headless this run).
- `cargo test --workspace` ✅ (all suites pass)
- `cargo clippy --workspace --all-targets -- -D warnings` ✅
- `cargo fmt --all --check` ✅
- Locale parity script ✅ (all 10 locales, 83 leaves)

## Notes for Main

- QProperty `cxx_name = "camelCase"` is REQUIRED for camelCase QML property access — cxx-qt does NOT auto-camelCase (this is why `pumpEvents` initially missed, fixed with `#[cxx_name]`).
- The spike's `QList<QObject*>` property is kept as the storage type but surfaced to QML as `QVariantList`. `docs/bridge-pattern.md` (Main's file) may deserve a one-line amendment; I did not edit it.
- The `delegate: … required property var modelData` idiom is mandatory for `Repeater` over the sequence property; plain `entry: modelData` without `required` breaks with `ReferenceError: modelData is not defined` (fixed in TranscriptList and sessions list).
- `cargo clean -p airi-qt` was used once to recover from an `OUT_DIR`/rustc-fingerprint mismatch (undefined `airi_qt$cxxbridge1$205$I18nBridge$locale` etc.). The dependency rebuild then healed the link; no source change involved.
- Not verified: GUI screenshots (no capture tool used); the 33 ms pump latency budget is empirical only.
- Deleting the current session auto-creates a fresh one (documented, keep).

## Files touched

`crates/airi-qt/src/bridges/chat.rs` (new), `src/bridges/mod.rs` (additive: `pub mod chat`, `set_profile_dir`/`profile_dir`), `src/main.rs` (additive: `--import-card`, chat context wiring, smoke mock + outcome gate), `build.rs` (additive: `chat.rs` + 5 QML files), `qml/chat/*.qml` (new ×5), `qml/shell/ChatWindow.qml` (workspace body), `packages/i18n/src/locales/*/shell.yaml` ×10.
