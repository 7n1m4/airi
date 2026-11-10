# SPDX-License-Identifier: GPL-3.0-or-later

# airi-speech

AIRI text-to-speech (TTS) lane — Rust port of the AIRI speech provider registry.

## What this is

- `SpeechSynthesizer` — the provider trait:
  `async fn synthesize(&self, text, voice, options) -> Result<AudioStream, SpeechError>`.
- `build_tts_client(TtsProviderConfig) -> Arc<dyn SpeechSynthesizer>` — registry builder.
  `TTS_PROVIDER_DEFS` is the complete catalog (26 ids from the Vue `speech.ts` registry in
  this repo; the plan document called it 27 — see *Known gaps*).
- `SpeechPipeline` — text → synthesize (or disk cache) → rodio decode → amplitude tap
  (RMS windows, ~20 Hz) → sink. Events on a `tokio::sync::broadcast` bus (`SpeechEvent`):
  `Started { sentence_id }` / `Amplitude { level }` / `Done {}` / `Aborted {}` / `Error { message }`.
  Barge-in: `speak` cancels any in-flight sentence first; `cancel_current()` aborts explicitly.
- `SpeechAudioCache` — disk LRU, 200 entries / 50 MB, key
  `sha256(scope | model | voice | format | speed | pitch | trimmed text)`, stored as
  `<sha256>.<ext>` under `<dirs::data_dir()>/airi-qt/speech-cache`.
- Output device selection: `RodioSinkFactory::new(Some("device name"))` — cpal description
  match (case-insensitive exact → substring), fallback to default; `list_output_devices()`.
- `CaptureSinkFactory` — test sink that drains samples into memory (used by the mock e2e).

## Provider support matrix (26 ids)

| id | family | port | notes |
|---|---|---|---|
| openai-audio-speech | OpenAI-compatible | Ported | POST `{base}/audio/speech`, Bearer |
| openai-compatible-audio-speech | OpenAI-compatible | Ported | BYO base URL (required) |
| comet-api-speech | OpenAI-compatible | Ported | `api.cometapi.com/v1/` |
| xai-audio-speech | OpenAI-compatible | Ported | `api.x.ai/v1/`, model `grok-2-tts` |
| airi-audio-server | OpenAI-compatible | Ported | `127.0.0.1:8095/v1/` |
| chatterbox | OpenAI-compatible | Ported | `127.0.0.1:8095/v1/` (legacy alias) |
| index-tts-vllm | OpenAI-compatible | Ported | `localhost:11996/tts/` → `…/tts/audio/speech`; **no `/synthesize` exists in this repo** |
| elevenlabs | ElevenLabs native | Ported | `xi-api-key`, `/v1/text-to-speech/{voiceId}` |
| microsoft-speech | unspeech proxy | Ported | `microsoft/{model}`, `extra_body` |
| deepgram-tts | unspeech proxy | Ported | `deepgram/{model}` |
| alibaba-cloud-model-studio | unspeech proxy | Ported | `alibaba/{model}` |
| volcengine | unspeech proxy | Ported | `volcengine/{model}`; needs `extra.app_id` |
| voicevox | VOICEVOX family | Ported | `localhost:50021` two-step `audio_query` → `synthesis` |
| aivis-speech | VOICEVOX family | Ported | same, `localhost:10101` |
| player2-speech | Player2 local | Ported | `{base}/tts/speak`, `player2-game-key` header, base64 `{data}` JSON |
| minimax-speech | MiniMax native | Ported | `POST /v1/t2a_v2` SSE hex mp3 (`status != 2`) |
| mimo-audio-speech | MiMo | Ported | `chat/completions`, `api-key` header, base64 WAV |
| google-gemini-audio-speech | Gemini native | Ported | `generateContent`, AUDIO modality, PCM16 24 kHz → WAV |
| openrouter-audio-speech | OpenRouter audio | Ported | `chat/completions` stream, PCM16 24 kHz → WAV |
| aws-polly-tts | Polly (SigV4) | **Partial** | signed locally with HMAC-SHA256; **never verified against live AWS**; signature covered by unit tests only |
| speech-noop | noop | Ported | emits a 44-byte silent WAV, no network |
| kokoro-local | in-process WASM | Unsupported | needs the WASM adapter, not HTTP |
| moss-nano-local | in-process | Unsupported | |
| pocket-tts-local | in-process | Unsupported | |
| ming3-local | in-process WASM | Unsupported | |
| virtual-audio-studio | Vue-only FX composition | Unsupported | no wire contract exists |

Unsupported ids yield `SpeechError::UnsupportedProvider` with the reason; they are present
in the catalog so a UI can enumerate and explain them.

## Configuration example

```rust
use airi_speech::{build_tts_client, TtsProviderConfig};

let client = build_tts_client(TtsProviderConfig {
    id: "openai-audio-speech".into(),
    kind: None,
    api_key: Some("sk-…".into()),
    base_url: None,           // catalog default (https://api.openai.com/v1/)
    model: None,              // catalog default (tts-1)
    voice: None,
    extra: Default::default(),
})?;
```

For Polly: `api_key` = Access Key ID; `extra.secret_access_key` and `extra.region`
(default `us-east-1`) are required. For unspeech Volcengine: `extra.app_id` is required.
`extra.extra_body` (object, wire-shaped keys) is merged into unspeech requests verbatim.

## Known gaps / honest status

- No streaming-into-playback: all clients collect bytes, then decode. Lip-sync amplitude
  events fire from the decoded sample stream, so they track audible output regardless.
- `Amplitude` events fire in sample-aligned windows, not on wall-clock pacing; with a real
  rodio sink the mixer pulls at playback rate, so they are wall-clock-aligned in practice.
- AWS Polly signature unverified against the live service.
- VOICEVOX/AivisSpeech/Player2 have no sandbox in this environment; their ports are
  byte-faithful from the Vue/xsai sources but not yet desk-verified against live engines.
- The cache key deviates from the plan's literal `sha256(provider|model|voice|format|text)`
  by also mixing `speed`/`pitch` (they alter the audio bytes; the Vue cache does the same).
- `speech-noop` emits WAV silence, not an empty buffer (empty doesn't decode); this differs
  from the Vue provider, whose output never reaches a decoder.
- Where the plan said "27 providers", this repo's registry defines **26** ids.
- `airi-core` does not re-export this crate yet (integration step for a later phase).
- `--smoke` (the GUI tour) is unaffected by this crate; `airi-qt` does not depend on it.

## Tests

`cargo test -p airi-speech --all-targets` — Polly signing unit tests, and a mock-TTS e2e:
`mockito` server answers `POST /v1/audio/speech` with a canned WAV; the test asserts the
request payload (model/input/voice + Bearer), ≥ 3 amplitude events (observed 10),
Started/Done/Error events, disk-cache persistence (`expect(1)` HTTP hit across two speaks),
and graceful `Error` mapping for HTTP 500. Abort test uses a stash sink to verify
`Cancel → Aborted, Done suppressed`.
