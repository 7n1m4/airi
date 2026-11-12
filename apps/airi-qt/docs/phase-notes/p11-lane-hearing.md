# P11 — Hearing (microphone) settings page (`/settings/modules/hearing`)

Lane D3. Scope: port the Vue `/settings/modules/hearing` page's *intent* to the
Qt settings surface. Three files added, nothing else touched:

- `qml/pages/settings/modules/hearing/HearingSettingsPage.qml` (NEW)
- `crates/airi-qt/src/bridges/hearing.rs` (NEW — `HearingController`)
- `docs/phase-notes/p11-lane-hearing.md` (this file)

Backend status before this lane: `airi-stt` is fully ported (capture via
`cpal` 16 kHz mono f32→s16, Silero VAD, OpenAI-compatible whole-blob STT,
Deepgram streaming, Aliyun NLS streaming with pre-issued token, whisper-local
via whisper-rs). **No Qt settings surface existed.** This lane adds one —
and nothing more.

## Bridge API (`HearingController`, namespace `airi_qt`)

QML element: `HearingController`. Signals and properties:

| Member | Type | Notes |
|---|---|---|
| `enabled` | qproperty bool | persisted (`settings/hearing.enabled`), default `false` |
| `pttMode` | qproperty bool | `true` = push-to-talk, `false` = automatic/VAD (default, Vue parity) |
| `hotkey` | qproperty QString | persisted verbatim; default `"Scroll"` |
| `deviceName` | qproperty QString | persisted verbatim; `""` = system default |
| `devicesJson` | qproperty QString | **always `"[]"` today** — see verdict below |
| `statusLine` | qproperty QString | raw English status line (bridge convention, like discord) |
| `stateChanged` | qsignal | emitted on every mirror mutation / refresh / save |

Invokables (all `set*` return `bool`, `true` = persisted):

- `setEnabled(bool)` — persists `enabled`.
- `setPttMode(bool)` — persists `pttMode`.
- `setHotkey(QString)` — trims; rejects empty, > 64 chars, control chars
  (mirror left unchanged, `false` returned).
- `setDevice(QString)` — `""` clears (system default); non-empty values trimmed,
  ≤ 256 chars, no control chars; kept verbatim.
- `refresh()` — re-reads the blob into the mirror, recomputes `devicesJson`.
- `save()` — idempotent re-persist of the current mirror; returns `bool`.

The qproperties `enabled` / `pttMode` / `hotkey` / `deviceName` are
`READ, NOTIFY` only (no auto-generated `set<Property>` slots — same pattern
as `bridges/memory.rs`). The qinvokables above are the writers; they mutate
the mirror, emit `<prop>Changed` manually, and persist immediately. The
QML-facing API is byte-identical to the spec. `devicesJson` / `statusLine`
stay auto (`setDevicesJson`/`setStatusLine` are generated; their
`devicesJsonChanged`/`statusLineChanged` signals coexist with `stateChanged`).
QML sees the properties as read-only — the page never assigns them.

Setters persist **immediately** (theme.rs / MMD idiom), so the page has no
Save button; it surfaces persistence failures via a `saveError` line instead
of pretending success. `save()` exists for explicit save points and central
wiring.

## Devices enumeration verdict (what `airi-stt` exposes today)

**Not enumerable. `devicesJson` is always `"[]"` this wave, by necessity, not
by choice.**

- `airi-stt` has **no public device enumeration API**. The enumerator lives in
  `capture.rs` as the private `fn candidate_devices(host, device_name)` and
  the private `fn supports_16k_mono(device)`; `AudioCapture::start()` is the
  only public device path, and it **opens the microphone stream** — a hard no
  for a settings page refresh.
- `airi-qt` does not (and must not, this wave) grow a `cpal` dependency of its
  own, and adding a public `airi_stt::list_input_devices()` means editing
  `airi-stt`, which is outside this lane's file ownership.
- `is_running()` / `device_name()` exist only on a *running* `AudioCapture` —
  again, opening the mic is out of scope.

The single seam for a future fix is `enumerate_devices_json()` in
`hearing.rs`; when `airi-stt` grows a public read-only enumerator (recommended
shape: `pub fn list_input_devices() -> Result<Vec<String>, CaptureError>` in
`capture.rs`, no stream opened), that one function changes and the QML device
card (already coded for the non-empty path) lights up.

**Do not fake it.** Until then the page renders an `AEmptyState` ("no input
devices enumerated… audio capture not wired in this build") instead of
showing invented device names.

## Persistence

- Key: `settings/hearing` (single JSON blob, camelCase fields: `enabled`,
  `pttMode`, `hotkey`, `deviceName`).
- Store pattern: same as `settings_stage.rs` / `theme.rs` — `SettingsStore`
  via `bridges::settings_store()`, synchronous SQLite, `store.load`/`store.save`
  with a generic (non-`SettingsSection`) key because `airi-core` has no
  `HearingSettings` type and `airi-core` is read-only for this lane.
- Missing/corrupt blob → defaults. Failed load → persist is skipped and the
  error is logged, never silently overwritten.
- No secrets anywhere: device names are local metadata; nothing sensitive is
  persisted or logged.

### Defaults (intentional)

| Field | Default | Source |
|---|---|---|
| `enabled` | `false` | Vue `settings/audio/input/enabled` default `false` |
| `pttMode` | `false` (automatic) | Vue `settings/hearing/detection-mode` default `'vad'` |
| `hotkey` | `"Scroll"` | Vue `MicToggleHotkey` documented default (`Scroll`/`Caps`/`Num`) |
| `deviceName` | `""` (system default) | empty selection |

The Vue page's hotkey is a PttToggle over Electron mic-toggle keys; the Qt
page ports the *stored value* verbatim and shows `Ctrl+Space` only as the
text field's placeholder — it does not rename Electron keys, and it does not
claim any registration happens.

## What is honestly absent (this build)

1. **No capture pipeline wired to chat.** `airi-stt` (capture/VAD/STT) builds
   and is tested, but no Qt code feeds its events into the chat composer or
   the UI. The enable switch records intent only.
2. **No VAD loop / no input level meter.** Would need an audio thread + a Qt
   event-pump bridge; explicitly out of scope this wave.
3. **No global hotkey registration.** Needs a platform service (the desktop
   lane has `global-hotkey` in `airi-qt` already, but wiring mic-toggle is a
   separate lane). The stored string is inert.
4. **No device enumeration** (verdict above). No STT provider picker here —
   that lives under `/settings/providers/transcription/*` (Vue) and is a
   separate port.
5. **No auto-send/VAD threshold/PTT tap-to-talk parity.** Vue persists
   `settings/hearing/auto-send-enabled`, `auto-send-delay`,
   `settings/hearing/vad-threshold`, `tap-to-talk`; this page does not port
   them (no consumers in this build — they would be inert UI).
6. **Capture starts will fail closed.** Nothing calls `MicService::start`,
   so no device is touched at runtime in this build.

## Central integration steps (none done by this lane)

1. `Cargo.toml` (`crates/airi-qt/Cargo.toml`): `airi-stt = { path =
   "../airi-stt" }` is **optional and currently unused** — see the
   "airi-stt / ggml link collision" section below before wiring it in. The
   bridge deliberately references nothing from `airi-stt`.
2. `crates/airi-qt/build.rs`: add `manifest_dir.join("src/bridges/hearing.rs")`
   to the bridge `files` list; add
   `module = module.qml_file("qml/pages/settings/modules/hearing/HearingSettingsPage.qml");`
3. `crates/airi-qt/src/bridges/mod.rs`: add `pub mod hearing;`
4. `qml/shell/SettingsWindow.qml`: new nav entry (index 25) + `StackLayout`
   child; needs a nav string (see keys below).
5. Locales: add the `shell.hearing.*` keys below to the source locale
   (then the usual `i18n` flow). **No locale files were edited by this lane.**
6. `qmllint`/smoke registration parity with the other module pages.

## airi-stt / ggml link collision (verified, affects step 1)

Linking **anything** from `airi-stt` into `airi-qt` breaks the binary link
with duplicate ggml symbols: `whisper-rs-sys` (airi-stt's VAD/STT stack) and
`llama-cpp-sys-2` (airi-core → airi-local-llm → llama-cpp-2) both vendor the
ggml sources, and rust-lld reports `duplicate symbol: ggml_backend_buft_name`
& co. across the two archives. Verified empirically in the /tmp copy: with
the bridge calling `airi_stt::CaptureConfig::default()`, **both**
`cargo test -p airi-qt` and `cargo build -p airi-qt --bin airi-qt` failed at
link. After removing the reference (status line now uses a synced literal
`16000`), both pass — the archive is never pulled in for zero referenced
symbols, so merely declaring the dep does not collide, but it is fragile.

Per this lane's discovery, central should treat the `airi-stt` dep as
**dormant**: add it only when a real consumer lands (e.g. the public device
enumerator in airi-stt), and re-verify the app build then. If it turns out
unused at merge time, drop the dep — nothing in this bridge needs it.
A proper fix (shared ggml via one sys crate, or a fork unification) belongs
to the audio/LLM native-deps lanes, not here.

## i18n keys (`shell.hearing.*`) — NOT added anywhere yet

- `shell.hearing.title`, `shell.hearing.description`, `shell.hearing.badge`
- `shell.hearing.enable.title`, `shell.hearing.enable.caption`
- `shell.hearing.mode.title`, `shell.hearing.mode.caption`,
  `shell.hearing.mode.auto`, `shell.hearing.mode.ptt`
- `shell.hearing.hotkey.title`, `shell.hearing.hotkey.placeholder`,
  `shell.hearing.hotkey.caption`
- `shell.hearing.device.title`, `shell.hearing.device.caption`,
  `shell.hearing.device.emptyTitle`, `shell.hearing.device.emptySubtitle`,
  `shell.hearing.device.useDefault`
- `shell.hearing.footerWarning`, `shell.hearing.saveError`
- Central (nav): `shell.settings.nav.hearing`

Suggested English copy: title "Hearing"; badge "Intent only"; enable caption
"Records that you want AIRI to hear you. Takes effect when the capture
pipeline lands — persisting this does not open your microphone."; footer
warning: "The capture pipeline and Silero VAD are not wired to chat in this Qt
build. These settings persist your intent only; nothing here listens."

## Verification (this lane)

Done in a `/tmp` copy (`/tmp/opencode/airi-qt-hearing-check`, rsync of
`apps/airi-qt` excluding `target/`) with the bridge registered there only
(mod.rs + build.rs + `airi-stt = { path = "../airi-stt" }` in the copy's
Cargo.toml — the real tree has no build.rs/Cargo.toml/mod.rs edits):

- `cargo check -p airi-qt` — **PASS** (rustc + cxx-qt codegen + moc + C++).
  Generated `hearing.cxxqt.h` confirms the spec'd surface: READ-only
  qproperties (`getEnabled`/`getPttMode`/`getHotkey`/`getDeviceName`,
  NOTIFY `enabledChanged`/`pttModeChanged`/`hotkeyChanged`/`deviceNameChanged`),
  spec'd `Q_INVOKABLE bool setEnabled / setPttMode / setHotkey / setDevice`,
  `void refresh()`, `bool save()`, plus auto `devicesJson`/`statusLine`;
  **no `set<Property>` slots, no signature collisions.**
- `cargo build -p airi-qt --bin airi-qt` — **PASS** (links with the
  airi-stt dep declared, because the bridge references no airi-stt symbols —
  see the link-collision section).
- `cargo test -p airi-qt` — **PASS** (17 passed, 0 failed; the bridge itself
  has no unit tests, mirroring `bridges/` convention where only some bridges
  carry tests).
- `cargo clippy -p airi-qt` — **PASS**, zero warnings (two `drop_non_drop`
  warnings in an earlier iteration were fixed via scoped borrows).
- `rustfmt --check --edition 2021 crates/airi-qt/src/bridges/hearing.rs` — **PASS**.
- `qmllint` (Qt 6.12.0, `-I <copy>/target/cxxqt/qml_modules`, the cxx-qt
  generated module, i.e. the real layout) on `HearingSettingsPage.qml` —
  **PASS, zero errors, zero warnings** (one iteration: `controller.deviceName
  !== ""` instead of `.length`/`.trim()` — QString members are not resolvable
  from qmltypes; comparisons against string literals are the codebase idiom
  for this).
- `qmlformat` — not run; the page follows the existing pages' formatting
  (4-space indent, QtQuick 2.15 imports, `pragma` not used, matching the
  modules/ pages that predate `pragma ComponentBehavior`).

Two build iterations were needed for the ABI name collision: cxx-qt
generates `Q_SLOT void set<Property>(T value)` for every writable qproperty,
which collided in C++ with the spec'd qinvokable cxx names
("cannot be overloaded with"). **Fixed the way lane D1 did** (see
`bridges/memory.rs`): the paired qproperties are now `READ, NOTIFY` only
(no setter slots at all); the `<prop>_changed` notify signals are generated
and emitted manually by the qinvokables after each mutation. An earlier,
alternative resolution (custom `WRITE = <qinvokable>`, Qt 6 moc tolerates
non-void WRITE) was tried and worked, but was replaced to match D1's shipped
pattern — simpler and not dependent on moc's leniency.

## Not done / deferred

- Public device enumeration in `airi-stt` (blocks the device card lighting up).
- Capture ↔ chat wiring (`MicService` events → composer / stage pipeline).
- Global hotkey registration via `global-hotkey` (desktop lane).
- Input level meter + VAD probability display (audio thread + Qt pump).
- STT provider/model selection UI (transcription providers page, separate port).
- `settings/hearing/vad-threshold` and auto-send parity — deferred until a
  consumer exists.
- i18n keys are reported, not added; nav registration is central's call.
