# P5 lane ① — Text-to-speech pipeline + cloud/HTTP speech providers

Status: **code complete and self-verified; manual desk verification against live engines pending.**
Crate: `apps/airi-qt/crates/airi-speech/` (new; workspace member; no Qt; no changes to `airi-core` yet — no re-export added).

## Delivered

- `SpeechSynthesizer` trait (`synthesize(text, voice, options) -> Result<AudioStream, SpeechError>`),
  `TtsProviderConfig { id, kind, api_key, base_url, model, voice, extra }`,
  `build_tts_client()`, `TTS_PROVIDER_DEFS` (26 registry ids + port status) — catalog mirrors
  `packages/stage-ui/src/stores/providers/registry/speech.ts`.
- Provider families, one client per family:
  - **OpenAI-compatible** (`POST {base}/audio/speech`, Bearer) — `openai-audio-speech`,
    `openai-compatible-audio-speech`, `comet-api-speech`, `xai-audio-speech`,
    `airi-audio-server` (`127.0.0.1:8095/v1/`), `chatterbox` (same, legacy),
    `index-tts-vllm` (`localhost:11996/tts/`; per the Vue code the real path is
    `{base}/tts/audio/speech` — **there is no `/synthesize` endpoint anywhere in this
    repo**; the Control Center label in the tasking could not be verified against it).
    `speed`/`response_format` sent only when set; `extra` merged verbatim.
  - **ElevenLabs native** — `xi-api-key`, `POST /v1/text-to-speech/{voiceId}`,
    `{text, model_id (prefix stripped), voice_settings{stability, similarity_boost, style?, use_speaker_boost?}}`,
    `accept: audio/mpeg`.
  - **unspeech proxy** — `microsoft-speech` (`microsoft/{model}`), `deepgram-tts`,
    `alibaba-cloud-model-studio`, `volcengine` (`volcengine/{model}`). `POST {unspeech}/audio/speech`
    with Bearer; `extra_body` nested object passed verbatim (wire-shaped keys, as produced by
    the Vue client's `objCamelToSnake`). Volcengine requires `extra.app_id`
    (Vue: `config.app.appId`) and derives `app:{appid, token:<api_key>}` itself.
    Default instance `https://unspeech.hyp3r.link/v1/`; self-host at `http://localhost:5933/v1/`.
  - **VOICEVOX family** — `POST {base}audio_query?speaker=&text=` → apply
    `speed/pitch/intonation/volume` (+ `voiceSettings` defaults `speed 1, pitch 0, intonation 1, volume 1`)
    → `POST {base}synthesis?speaker=` → WAV. `voicevox` :50021, `aivis-speech` :10101.
  - **Player2** — faithful port of `@xsai-ext/providers/special/create#createPlayer2`:
    `POST {base}/tts/speak`, header `player2-game-key: <game_key>` (default `airi`),
    body `{audio_format?, play_in_app: false, speed?, text, voice_ids: [voice]}`,
    response `{data: "<base64>"}` → bytes. Voices endpoint `{base}/tts/voices` NOT ported (listVoices out of scope).
  - **MiniMax** — `POST {base}/v1/t2a_v2` `stream: true`; SSE `data:` lines; hex `audio` chunks
    (`status != 2`) concatenated; `audio_setting` 32 kHz/128 kbps/mp3 (Vue's exact values).
  - **MiMo** — `POST {base}chat/completions`, header `api-key` (not Bearer), messages
    `[user: "Synthesize speech", assistant: <text>]`, `audio: {voice, format: "wav"}`;
    base64 WAV at `choices[0].message.audio.data`.
  - **Gemini native** — `POST {base}models/{model}:generateContent`, `x-goog-api-key`,
    `generationConfig{responseModalities:["AUDIO"], speechConfig{voiceConfig{prebuiltVoiceConfig{voiceName}}}}`;
    `candidates[0].content.parts[].inlineData.data` base64 PCM16 24 kHz mono → WAV.
    No Gemini chat-key fallback (Vue has it; the Rust client requires the dedicated key).
  - **OpenRouter audio** — `POST {base}chat/completions` stream:true,
    `modalities: ['text','audio']`, `audio: {voice, format: 'pcm16'}`, same
    read-aloud prompt as Vue; SSE `delta.audio.data` base64 PCM16 → WAV.
  - **AWS Polly** — SigV4-signed `POST https://polly.{region}.amazonaws.com/v1/speech`
    `{Engine, OutputFormat: "mp3", Text, VoiceId}`, region/secret from `extra.region` /
    `extra.secret_access_key` (`api_key` = Access Key ID, matching Vue).
    **Signature is self-graded**: unit tests prove determinism/format only; never
    run against live AWS from this environment. If Polly matters, verify with a real account.
  - **speech-noop** — 44-byte silent WAV (no network).
  - **Unsupported (explicit `UnsupportedProvider` error)**: `kokoro-local`, `moss-nano-local`,
    `pocket-tts-local`, `ming3-local` (in-process WASM/native adapters — no HTTP contract),
    `virtual-audio-studio` (Vue-only FX composition over other engines).
  - The plan said "27 providers"; **this repo's registry defines 26 ids**, all covered here.
- Playback: dedicated OS thread owns cpal output; `RodioSinkFactory::new(Option<device_name>)` —
  cpal description match (ci exact → substring), default fallback with a `tracing::warn`,
  `list_output_devices() -> Vec<String>`. `Player::stop()` flushes the queue; replacing a
  sentence drops the previous player.
- Amplitude tap: RMS over ~50 ms sample-aligned windows (~20 Hz at any sample rate), broadcast
  as `SpeechEvent::Amplitude { level }`; `Started/Done/Aborted/Error` lifecycle events.
  Done vs Aborted is disambiguated by a shared abort flag: natural exhaustion → `Done`,
  barge-in/`cancel_current` → `Aborted` (tap suppresses the trailing `Done`).
- Cache: `SpeechAudioCache::open(<data>/airi-qt/speech-cache)` (or explicit path) —
  200 entries / 50 MB hard caps, LRU by last-used tick seeded from file mtimes at boot,
  tmp+rename writes, corrupt/dangling index entries dropped, read/write failure degrades
  to "no cache" with a warning (never blocks TTS). Key:
  `sha256(scope | modelHint | voice | formatHint | speed | pitch | trimmed text)` where
  `formatHint` = `response_format` or the sniffed container. Deviation from the literal
  plan key: `speed`/`pitch` mixed in (Vue caches the same way; prosody changes the bytes).
- Pipeline: `speak()` cancels any in-flight sentence (barge-in), synthesizes (cache short-circuit),
  decodes with rodio/symphonia (mp3/flac/wav/ogg-vorbis/aac/isomp4), emits `Started` right before
  sink commit, then tap-driven `Amplitude`s; cache-hit path skips the network entirely.
- 64 MiB cap on collected payloads.

## Verification (all run in this environment)

- `cargo test -p airi-speech --all-targets` — **green**: 4 Polly sign unit tests + 3 e2e tests.
  The required mock-TTS e2e (`mock_tts_server_end_to_end`) spins up a `mockito` server on a
  local port answering `POST /v1/audio/speech` with a canned 500 ms sine WAV; asserts
  - request payload = `{model:"tts-1", input:"hello world", voice:"alloy"}` + `Authorization: Bearer test-key` (via `PartialJsonString`),
  - exactly **one** HTTP hit across two speaks (`.expect(1)`), i.e. second speak served from the disk cache after WAV bytes hit the capture sink and cache files persisted (`entries == 1`),
  - **10 amplitude events** observed (≥ 3 required), levels within `0.0..=1.0`,
  - capture sink holds ≈ 12 000 f32 samples (0.5 s @ 24 kHz),
  - `Started{sentence_id}` → … → `Done` lifecycle,
  - `provider_error_surfaces_as_error_event`: HTTP 500 → `SpeechError::Provider` + `SpeechEvent::Error { message }` on the bus,
  - `cancel_current_aborts_playback`: stash sink, `cancel_current()` → `Aborted` emitted, `Done` suppressed.
- `cargo clippy -p airi-speech --all-targets -- -D warnings` — **green**.
- `cargo fmt --all --check` — airi-speech **clean**. (`airi-stt` shows diffs — that lane's files,
  out of scope; left untouched.) `cargo fmt -p airi-speech` was applied.
- `cargo clippy --workspace --all-targets -- -D warnings` — **blocked by `airi-stt`**:
  `crates/airi-stt/examples/vad_probe.rs:13` trips `clippy::type_complexity` (`-D warnings`).
  p5-stt is actively editing that crate; not fixed here (lane scope). airi-speech passes.
- `--smoke` not re-run: the GUI smoke binary (`cargo run -p airi-qt -- --smoke`) does not depend on
  this crate (`airi-qt` has no `airi-speech` dependency), so this lane cannot break it; building
  a GUI stack was judged out of scope for this assignment.

## Not done / next-phase TODOs

1. Wire `airi-core`/`airi-qt` to consume `SpeechEvent` (lip-sync → mouth rig is P6/P7 stage work).
   Nothing here stops that; the bus pattern matches `airi-core`'s `ChatEvent`.
2. True streaming decode (play chunks as they arrive) — all clients collect first; lip-sync
   already works on decoded samples.
3. `listVoices`/`listModels` capability APIs — manifest wants them eventually; not implemented.
4. Polly: live verification with real AWS credentials (signature currently self-graded).
5. VOICEVOX/AivisSpeech/Player2/airi-audio-server/Index-TTS: desk-run against real engines.
6. Gemini dedicated-key fallback to chat-provider key (Vue behavior) — deliberately not ported.
7. `speech-noop` semantic difference: emits silent WAV instead of empty buffer (documented).
8. Cache `scope` param: the eventual `build_client` wiring should mix `base_url` into
   `cache_scope` to avoid key aliasing across same-id-different-credential configs.
9. `airi-stt` clippy failure is for p5-stt to resolve; workspace clippy goes green after that.

## Manual desk-verification steps (recommended before calling TTS "done")

1. `VOICEVOX`/AivisSpeech: launch engine, `SpeechPipeline` with `id: "voicevox"` /
   `"aivis-speech"` (default base URLs), `speak("テストです", "1", default)`; expect Started →
   ~20 amplitude events/s → Done; mouth (once wired) tracks level.
2. OpenAI: real key, `id: "openai-audio-speech"`, speak a sentence; confirm cache file appears
   under `<data>/airi-qt/speech-cache/<sha256>.mp3`; repeat → instant, no network.
3. ElevenLabs: real key, voice id from the dashboard; check `xi-api-key` auth, mp3 plays.
4. Barge-in: `speak(long_text)`, then `speak("stop")` immediately; first sentence aborts with
   `Aborted`, second plays; `Done` never fires for the first.
5. Output device: `list_output_devices()`, set `RodioSinkFactory::new(Some(<name>))`, confirm
   sound routes there; bogus name → warning + default device.
6. Error path: point `base_url` at a dead port; `speak` → `SpeechEvent::Error`, no panic,
   cache untouched.
