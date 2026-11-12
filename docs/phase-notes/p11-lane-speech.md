<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P11 Lane D2 — Speech settings surface: one Qt page for TTS provider, voice & sample synthesis

Wave ⑪ lane D2. Scope (owned exclusively):

- `apps/airi-qt/qml/pages/settings/modules/speech/SpeechSettingsPage.qml` (new)
- `apps/airi-qt/crates/airi-qt/src/bridges/speech.rs` (new)
- `apps/airi-qt/docs/phase-notes/p11-lane-speech.md` (this note)

Scope (read-only): `build.rs`, `bridges/mod.rs`, `Cargo.toml`, `SettingsWindow.qml`, locales — none were touched. The repo is under active multi-lane edit; re-verify snippets against the tree before applying.

This lane folds **`/settings/modules/speech` (#70)** and **`/settings/providers/speech` (#108, the speech providers landing)** into ONE Qt settings surface. There was no speech settings surface in Qt at all before this lane; only the `airi-speech` (TTS) and `airi-stt` (STT) backends existed.

## What the page does, exactly

**Wired, live:**

1. **Provider picker card** — a scrollable `ListView` of all 26 rows from `TTS_PROVIDER_DEFS`, rendered through the bridge's `defsJson`. Each row shows: name, status badge (`Ported`→accent, `Partial`→info, `Unsupported`→default grey), the default base URL (or a localized "no default endpoint" caption when empty — e.g. kokoro-local and the Unsupported rows), and the crate's `note` as subtext. Unsupported rows render dimmed (opacity 0.45), ignore clicks, and show an `ATooltip` with the note. Clicking a selectable row calls `selectProvider(id)`; invalid ids bounce to `statusLine` without state change. Selection is **not** persisted until Save.
2. **Voice/speed card** — visible only when a provider is selected. Voice `ATextField` (placeholder = the selected def's `defaultVoice`, or a localized "provider default voice" when empty) and a `0.25–4.0` `ASlider` (step 0.05) with a `×N.NN` badge. When the selected provider `requiresApiKey` and the store has **no** key for it, the card's inputs are disabled and a warning caption is shown; Save stays enabled (selection persists; synthesis then fails with the honest "API key required" error).
3. **Sample card** — `ATextArea` + "Synthesize sample" button. Result is shown inline: the absolute path of the written file (green), or the bridge's `"error: …"` string (red). Nothing is played, no autoplay, no auto-open.
4. **Save** — persists `{providerId, voice, speed}` to the `settings/speech` blob (camelCase, matching the Electron `settings/<group>` namespace) through the same `SettingsStore` pattern as `settings_stage.rs`. `statusLine` becomes `saved` on success.
5. **STT row** — an honest placeholder card (caption + body text only, no navigation, no controls): speech-to-text clients are ported in `airi-stt` (OpenAI-compatible `/audio/transcriptions` whole-blob client, Deepgram streaming, Aliyun NLS streaming, whisper-local in-process), but the Qt hearing surface does not exist yet (manifest item #61, `(a)`, medium). This page configures TTS only.

**Not wired / honestly unavailable:**

- **Sample playback.** Files are written to disk and are not playable in-app. Qt Multimedia Audio playback is not wired anywhere in this QML stack; the card says so in a caption (`shell.speech.sample.notPlayable`). `airi-speech`'s rodio pipeline could play on another thread later — that is a separate decision.
- **Kokoro.** `kokoro-local` synthesis is short-circuited before `build_tts_client` is called (which would otherwise trigger an ~82 MB ONNX model download from a settings-page button) with `"error: requires model download — not bundled in v1"`.
- **Playback/STT/mic** — no playback wiring beyond writing one WAV, no mic capture, no STT UI on this page.
- **No new external Rust crates** — see "Central steps" below; one workspace-internal dep (`futures-util`) is required to consume `airi_speech::AudioStream` and is flagged explicitly.
- **No key entry UI here.** Speech provider keys are read from the providers store (LLM path's store, keyed by speech provider id); no speech-scoped key entry exists in the Qt providers UI yet (see "Key resolution").

## The bridge — `bridges/speech.rs` (`SpeechController`, JSON boundary)

`#[cxx_qt::bridge]`, namespace `airi_qt`, `SpeechControllerRust` storage type, `Default` reads the blob once (same idiom as the other bridges).

### qproperties

| QML name | Type | Meaning |
| --- | --- | --- |
| `defsJson` | QString | One-shot JSON array (see shape below) of all 26 catalog rows, built once from `TTS_PROVIDER_DEFS`. Static — never mutated. |
| `selectedProviderId` | QString | Persisted selection; `""` when unset |
| `voice` | QString | Voice override; `""` = provider default |
| `speed` | f64 (double) | Speaking rate, clamped `0.25..=4.0` (NaN ⇒ 1.0) |
| `statusLine` | QString | `"saved"` on success, `"error: …"` otherwise, `""` when clean |
| `missingKey` | bool | `true` when selected def `requiresApiKey` and the store has no key for it. **Spec-superset**: not in the lane's qproperties list — needed to implement the missing-key caption without leaking keys. Read-only, credential-derived boolean only. |

`defsJson` row shape (exactly nine keys, straight from the crate; port status is the crate's, never reinvented):

```json
{
  "id": "openai-audio-speech",
  "name": "OpenAI",
  "kind": "open-ai-compatible",
  "defaultBaseUrl": "https://api.openai.com/v1/",
  "defaultModel": "tts-1",
  "defaultVoice": "alloy",
  "requiresApiKey": true,
  "status": "ported",
  "note": "POST /audio/speech; speed sent when set; response_format sent when set."
}
```

`status` ∈ `ported | partial | unsupported` (`TtsStatus`). `kind` is a kebab-case tag mirroring the crate's `TtsProviderKind`; `unspeech-proxy:<backend>` carries the backend suffix (`microsoft|deepgram|alibaba|volcengine`). 26 rows, order = catalog order.

**Deviation note:** `missingKey` is an added read-only qproperty (no spec pruning of the spec-listed five). Everything else matches the lane spec exactly.

### qinvokables

| Method | Behavior | Returns |
| --- | --- | --- |
| `refresh()` | Re-read `settings/speech` into the mirror; emits `stateChanged`. | — |
| `selectProvider(id)` | Validates against `TTS_PROVIDER_DEFS`; on no-match: `statusLine = "error: unknown speech provider '…'"`, no state change. On match: selection + `missingKey` updated, `statusLine` cleared, `stateChanged` emitted. | `bool` applied |
| `applyVoice(v)` | Trims and stores; emits `stateChanged`. **Renamed from the spec's `setVoice`** — `voice` is a qproperty, and cxx-qt always generates an inherent `setVoice` property setter, so a same-named qinvokable cannot compile (the `sync.rs` `saveTargetPath` precedent). QML calls `applyVoice`. | — |
| `applySpeed(f)` | Clamps to `0.25..=4.0` (NaN ⇒ 1.0); emits `stateChanged`. Renamed from the spec's `setSpeed` for the same reason. | — |
| `save()` | Requires a known selection; persists `{providerId, voice, speed}`; `statusLine = "saved"`; emits `stateChanged`. | `bool` |
| `synthesizeSample(text)` | See below. | `QString` (path or `"error: …"`) |

The auto-generated property setters `setVoice`/`setSpeed` (plain member assignment + property notify) also exist and are valid QML; the page calls the `apply*` invokables so trim/clamp/notify-stateChanged semantics are honored. `refresh`, `selectProvider`, `save`, `synthesizeSample` match the spec names exactly.

Signal: `stateChanged()` — emitted on refresh/select/applyVoice/applySpeed/save.

`selectProvider` note: the bridge validates against **all** catalog ids including `unsupported` rows (the page disables those rows for clicks instead). Defense in depth, not a security boundary.

### Key resolution (where keys come from today — or what's stubbed)

Same store + lookup pattern as the LLM path (`providers.rs`): `provider_repo().get(speech_provider_id)` on `airi_store::ProviderRepo`, expecting a stored record whose `config` object is the flat credential blob — `api_key` (non-empty), optional `base_url`, optional `model`, `extra_json` bag forwarded verbatim as `TtsProviderConfig::extra` (e.g. Polly's `secret_access_key`/`region`). Top-level unknown keys in the stored object are also forwarded as extras (mirrors the LLM bridge's flat↔nested round trip). Keys never cross into QML, are never logged, and never appear in `defsJson`.

**Honest stub:** the Qt providers UI (`ProvidersPage.qml`) today only writes records for the LLM registry ids; no speech-scoped records can be created there yet. Practically, every `requiresApiKey` speech provider therefore reports `missingKey == true` until credentials are seeded into the `providers` table (id = speech provider id, e.g. `openai-audio-speech`) by a migration/provisioning step or a future speech-scoped UI. That is deliberate: this lane builds no OAuth flows and no key entry UI beyond the providers store.

### `synthesizeSample(text)` — exact contract

1. Empty/whitespace text ⇒ `"error: enter some text to synthesize"`.
2. No selection / unknown id ⇒ `"error: …"` (never reaches the network).
3. `kokoro-local` ⇒ `"error: requires model download — not bundled in v1"` (short-circuited pre-`build_tts_client`; no ~82 MB fetch).
4. Otherwise builds `TtsProviderConfig` from the store overlay (id, api_key, base_url, model, extra) + catalog defaults, then `build_tts_client`. Validation errors from the crate itself (`InvalidConfig`, `UnsupportedProvider` e.g. virtual-audio-studio) surface verbatim, token-free, capped at 512 chars.
5. Runs synthesis on the shared tokio runtime handle (`runtime_handle().block_on`, same as `update.rs`) under a 30 s timeout; `response_format: wav` is requested (OpenAI family honors it; VOICEVOX/Gemini/MiMo/Player2/noop are WAV anyway).
6. On success: writes exactly one fresh file `<profile>/airi/speech-samples/speech-sample-<millis>.<ext>` (`<data>/airi-qt/speech-samples/` when `--profile` is unset — same resolution order as `discord.rs`), extension sniffed from magic bytes (`wav`/`mp3`/`flac`/`ogg`/`bin`) so the name is truthful even if a provider ignores the WAV request. Returns the absolute path. **Nothing else is written** (no cache entries — this path does not touch `SpeechAudioCache`).
7. On failure: `"error: …"` with the crate's display string (provider body truncated to 512 chars upstream), never the API key.
8. Known hosted endpoints (OpenAI, xAI, CometAPI, Minimax, MiMo, Google, OpenRouter, Polly, unspeech hyp3r.link) are **live-network calls when clicked** — they are click-initiated and short; this is expected for a "test synthesis" button and mirrors the providers page's Test button.
9. Kokoro/in-process/Unsupported are fully offline; localhost HTTP providers (voicevox, aivis-speech, player2-speech, airi-audio-server, chatterbox, index-tts-vllm) hit localhost and fail fast with connection-refused when the service is down — surfaced as `"error: transport error: …"`.

**Known caveat:** sample synthesis for keyed providers against their **default** base URL would send the stored key to that default host. That is the same behavior as the LLM path's Test Connection and is accepted here; a user-overridden `base_url` in the stored record is forwarded, and is presumably where the key was intended to go.

## The page — `SpeechSettingsPage.qml`

Structure (Flickable → ColumnLayout, same idiom as Spine/Discord pages):

1. Header — title + description (`shell.speech.title`, `shell.speech.description`).
2. **Provider picker** — `SectionCaption` + `ACard` containing a `ListView` (`implicitHeight: 420`, clipped, vertical ScrollBar) of catalog rows as delegate `ACard`s. Badges per status; unsupported rows dimmed + click-inert + tooltip; selected row gets an accent border. Empty catalog ⇒ red caption.
3. **Voice/speed** (visible only when a provider is selected) — warning caption when `missingKey` (inputs disabled), voice field (default-voice placeholder), speed slider + badge, then a row with the `statusLine` (green/red) and the **Save** button.
4. **Sample** — `ATextArea`, accent-enabled "Synthesize sample" button, inline result (path in green / error in red), plus the not-playable-yet caption.
5. **STT** — caption + a card: descriptive text only (ported clients listed), states the Qt hearing surface doesn't exist yet (#61) and this page covers TTS only.

`ATooltip` is used for the Unsupported-row explanation (hover works even on dimmed rows because clicks are ignored in the handler rather than by disabling the `MouseArea` — a disabled `MouseArea` would never hover). i18n namespace: `shell.speech.*` (keys below). No new components were introduced; no locale edits were made.

## Central steps (NOT applied by this lane)

### 1. `Cargo.toml` of `crates/airi-qt` — add (in addition to airi-stt, which is NOT needed by this page — no reference to airi-stt APIs exists in this lane's code; the STT card is descriptive text only):

```toml
airi-speech = { path = "../airi-speech" }
futures-util = { workspace = true } # REQUIRED by bridges/speech.rs to consume airi_speech::AudioStream
```

`futures-util` is already a workspace dependency (`futures-util = "0.3"` in the virtual manifest) and is used by `airi-speech` itself — **no new external crate enters the lockfile**. This is a deviation from the lane's "NO new Rust deps" rail, flagged honestly: without `StreamExt` there is no way to drain `Pin<Box<dyn Stream<Item = Result<Bytes, SpeechError>> + Send>>` from `airi-qt` (the crate's own `collect_stream` lives in a private module). If the zero-new-deps reading is strict, the fallback is `airi_speech::SpeechPipeline` + `CaptureSinkFactory`, which was rejected: it decodes via rodio (fine) but loses the sample rate/channel metadata needed to write a correctly-labeled WAV (the decoded source's rate is not observable through the tap from this crate). Adding `futures-util` is the smaller, honest price. `cargo tree --locked` will show it as already present in the workspace.

### 2. `build.rs` of `crates/airi-qt`

```rust
manifest_dir.join("src/bridges/speech.rs"),   // in the files list, after spine.rs
module = module.qml_file("qml/pages/settings/modules/speech/SpeechSettingsPage.qml");  // after the acp line
```

### 3. `bridges/mod.rs`

```rust
pub mod speech;
```

(alphabetical: between `spine` and `stage`)

### 4. `SettingsWindow.qml` — add nav entry + StackLayout page (index 25, after ACP Agents #24). Suggested icon glyph: `🗣️` (or a Theme-consistent glyph); nav label key `shell.settings.nav.speech` (English source: "Speech").

### 5. Locales — add the `shell.speech.*` keys below (English source strings; flatten into the `speech:` section of `shell.yaml` per the existing single-quote style). Add `shell.settings.nav.speech: "Speech"`. **This lane edited no locale files.**

```yaml
speech:
  title: 'Speech'
  description: 'Text-to-speech for AIRI. Pick a provider from the catalog, tune voice and speed, and write a sample file to check it. Port status comes from the Rust speech registry verbatim.'
  providers:
    caption: 'Text-to-speech provider'
    empty: 'The provider catalog failed to load — see console.'
  noDefaultEndpoint: 'no default endpoint (required)'
  save: 'Save'
  missingKey: 'This provider requires an API key and the store has none for it. Keys are read from the providers store (id = this provider); the Qt providers UI does not write speech-scoped credentials yet.'
  status:
    ported: 'Ported'
    partial: 'Partial'
    unsupported: 'Unsupported'
  voice:
    caption: 'Voice & speed'
    label: 'Voice'
    placeholderDefault: 'Provider default voice'
  speed:
    label: 'Speed'
  sample:
    caption: 'Sample synthesis'
    description: "Synthesize a short sample with the selected provider and write it to a new file under your profile dir. Uses the provider's default endpoint; nothing is played."
    label: 'Sample text'
    placeholder: "Hello, I'm AIRI."
    button: 'Synthesize sample'
    written: 'Sample written:'
    notPlayable: 'Sample files are written to disk and are not playable in-app yet — open them with your system player.'
  stt:
    caption: 'Speech-to-text'
    title: 'Speech-to-text lives elsewhere (not wired here)'
    body: 'airi-stt ports the STT clients: Whisper (in-process, whisper-rs), an OpenAI-compatible /audio/transcriptions client, a Deepgram streaming client, and Aliyun NLS (streaming, pre-issued token required). The Qt hearing surface that would drive them does not exist yet (manifest #61) — this page configures text-to-speech only.'
```

Keys used by the page (exact): `shell.speech.title`, `shell.speech.description`, `shell.speech.providers.caption`, `shell.speech.providers.empty`, `shell.speech.noDefaultEndpoint`, `shell.speech.save`, `shell.speech.missingKey`, `shell.speech.status.ported`, `shell.speech.status.partial`, `shell.speech.status.unsupported`, `shell.speech.voice.caption`, `shell.speech.voice.label`, `shell.speech.voice.placeholderDefault`, `shell.speech.speed.label`, `shell.speech.sample.caption`, `shell.speech.sample.description`, `shell.speech.sample.label`, `shell.speech.sample.placeholder`, `shell.speech.sample.button`, `shell.speech.sample.written`, `shell.speech.sample.notPlayable`, `shell.speech.stt.caption`, `shell.speech.stt.title`, `shell.speech.stt.body`. Missing keys fall back per the I18n bridge's default (key echo) — same posture as every other untranslated key in the app today.

## Manifest ticks central should apply

- **#70 `/settings/modules/speech`** (a→?) → recommend **(b)**: a Qt surface now exists and is usable (selection + voice/speed + sample synthesis for reachable HTTP providers), but the full modules-landing parity (module store state/enable toggle wired to a stage runtime, TTS actually speaking through the app) is not; note stays "Qt speech surface landed via p11-lane-speech; sample synthesis live; in-app playback not wired; STT hearing surface is #61".
- **#108 `/settings/providers/speech`** (a→?) → recommend **(b)** (subsumed by this page). The per-provider Vue pages (`providers/speech/<id>.vue`) were already folded into the registry-driven picker here; no dedicated per-provider Qt pages, per the same registry-collapsed-not-per-page architecture as the chat providers page. Note: "subsumed by SpeechSettingsPage.qml (p11-lane-speech)".
- **#99–#119 speech provider rows** (all per-provider rows: airi-audio-server, alibaba-cloud-model-studio, chatterbox, comet-api-speech, deepgram-tts, elevenlabs, index-tts-vllm, kokoro-local, microsoft-speech, openai-audio-speech, openai-compatible-audio-speech, openrouter-audio-speech, player2-speech, volcengine, xai-audio-speech; excluding the landing #108 and the special rows below) → stay **(b)**; they are now reachable in the UI but remain backend-parity rows, not per-page rows, per the audit's own "(a) for the settings surface — split item" calibration. No tick changes.
- **#101 `app-local-audio-speech`** → stays **(a)**/low (unreviewed local path, not ported, not in the picker as a working row — it is not in TTS_PROVIDER_DEFS at all, correct: it never was a TTS engine, it was a device-id path through the hearing store; flag again to the map owner).
- **#111 `moss-nano-local`, #116 `pocket-tts-local`** → stay **(a)** (explicit `TtsProviderKind::Unsupported` in the crate; shown disabled with note; correctly not ported).
- **#117 `virtual-audio-studio`** → stays **(c)**.
- **#122 `aliyun-nls-transcription`, #124 `comet-api-transcription`, #125 `deepgram-transcription`, #127 `openai-audio-transcription`, #128 `openai-compatible-audio-transcription`, #129 `whisper-local`, #130 `xai-audio-transcription`** → STAY **(b)**, unchanged — backend ported (p5-stt / p9-whisper), no Qt surface, no new work in this lane; the STT caption on the page points at them.
- **#126 `/settings/providers/transcription` (transcription landing)** → stays **(a)** — unchanged; it is the STT-analogous landing this lane deliberately did not build (out of scope).
- **#61 `/settings/modules/hearing`** → stays **(a)** — unchanged; STT backend ported, no Qt hearing surface.
- `port-manifest/features.md` — the two rows (`/settings/modules/speech`, `/settings/providers/speech`) can tick `[x]` once central applies the integration and the built page is smoke-verified; **this lane does not flip them**.
- `port-manifest/speech.md` — `stores/modules/speech.ts` row unchanged (the Qt side does not port the Vue speech store; it uses a single settings blob instead).

## Verification evidence

Environment note: the repo tree is under active multi-lane edit. All checks below ran against a **copy** at `/tmp/opencode/airi-qt-speech-check` (tar of `apps/airi-qt` minus `target/`, integration applied in the copy only), with a fresh `CARGO_TARGET_DIR=/tmp/opencode/airi-qt-speech-target`. The real tree received only the three new files.

1. **cargo check -p airi-qt** — PASS (in the copy; `Finished dev profile` 33.89s after dependency build). First attempt FAILED with `associated function SpeechController::set_voice defined multiple times` and same for `set_speed` — the cxx-qt auto-generated property setters collide with same-named qinvokables; fixed by renaming the invokables to `applyVoice`/`applySpeed` (see the qinvokables table). Re-check PASS.
2. **cargo test -p airi-qt bridges::speech** — PASS, 5/5:
   ```
   test bridges::speech::tests::clamp_speed_bounds_and_nan ... ok
   test bridges::speech::tests::kind_str_covers_every_catalog_variant ... ok
   test bridges::speech::tests::sniff_extension_detects_wav_and_mp3 ... ok
   test bridges::speech::tests::speech_blob_roundtrip_and_defaults ... ok
   test bridges::speech::tests::defs_json_is_valid_array_with_catalog_rows ... ok
   test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 17 filtered out
   ```
3. **rustfmt --edition 2021 --check** on `speech.rs` — clean.
4. **qmllint 6.x** (`/usr/lib/qt6/bin/qmllint`, Qt 6.x, `-I` pointing at a module sandbox `/tmp/opencode/qmllint-speech/com/airi/airiqt/` — copy of the current `qml/` sources plus the **cxx-qt-generated** `qmldir` (lists `SpeechSettingsPage 1.0` and `SpeechController`) and `plugin.qmltypes` from the scratch build) — **0 errors, 0 warnings**. Initial warnings fixed: `pragma ComponentBehavior: Bound` added (AcpAgentsPage idiom), and `indexOf` on the `QString`-typed properties moved behind a `String(...)` coercion so the type checker sees a JS string.
5. **Not run**: `cargo build`/`--smoke`/Qt link, locales, SettingsWindow wiring, live network synthesis (no keys in the sandbox; mock-server coverage for sample synthesis would need `mockito` in airi-qt's dev-deps — deliberately not added; the JSON shaping is unit-tested instead, and the synthesis path is `airi-speech`'s own tested code path — the crate's `tests/mock_tts_e2e.rs` pattern is the reference for a future integration test if central wants one).
6. **cargo clippy -p airi-qt** — PASS: `Finished dev profile … in 1m 08s` with **zero** `warning:`/`error:` lines for the airi-qt crate (an earlier background clippy invocation was blocked on the build-dir lock held by the test run; the foreground re-run above is the evidence).

## Not-done list (explicit)

- No OAuth flows; only stored-record keys (see "Key resolution").
- No in-app playback of samples (Qt Multimedia Audio not wired in this stack); files are written and shown by path only.
- No STT UI on the page (placeholder card only); no mic capture; no hearing surface (#61 untouched).
- No locale edits; no `SettingsWindow.qml` edit; no `build.rs`/`mod.rs`/`Cargo.toml` edits in the real tree.
- No new external Rust crates; one workspace-internal dep (`futures-util`) required and flagged (see Central steps §1).
- The `defsJson` payload is built once at construction; there is no defs refresh path (catalog is static).
- Unsupported rows are unselectable in the page; the bridge would still accept them (documented, deliberate).
- The inline ATooltip on unsupported rows relies on hover; keyboard focus does not open it (no focus handler wired — a11y follow-up for central/QML polish).
- `missingKey` for speech rows is effectively always true today (Qt providers UI writes no speech-scoped records); the caption says so.
