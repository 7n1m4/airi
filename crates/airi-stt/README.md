<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# airi-stt

Native microphone capture + Silero VAD + speech-to-text clients for the AIRI Qt
rewrite. **No Qt dependencies** — pure tokio / cpal / `ort` / reqwest. This
crate is consumed by `airi-qt`; the QML bridge pumps [`MicEvent`]s into the
UI in a later phase.

[`MicEvent`]: src/mic.rs

## Layout

| Module | Contents |
|---|---|
| `capture` | `AudioCapture::start(CaptureConfig)` — cpal input → 16 kHz mono f32 → s16 PCM as `broadcast::Receiver<PcmChunk>` (`capture.rx`); 512-sample chunks (32 ms, the VAD window); peak/RMS level meter via `level()` / `level_handle()`; `stop()` ends capture |
| `vad` | Silero VAD v5 via `ort` (ONNX Runtime): `SileroVad` inference + `VadHysteresis`, a pure, deterministic speech/silence state machine with configurable `speech_start` / `speech_end` / `min_silence_duration_ms` (defaults 0.35 / 0.15 / 300 ms); `VadEvent::{SpeechStart, SpeechEnd { segment_ms }, Speaking(bool)}` |
| `stt` | `SttClient` whole-blob trait (`transcribe_pcm`) + streaming sessions (`SttStream`) with the shared interim/final event vocabulary (`SttEvent`) |
| `stt::openai` | `OpenAiTranscribeClient` — `POST {base}/audio/transcriptions` multipart (`file=audio.wav`, `model`, `response_format=json`), Bearer auth. Works against any OpenAI-compatible endpoint incl. **Groq** (`base_url` = `https://api.groq.com/openai/v1`) |
| `stt::deepgram` | `DeepgramStreamingClient` — `wss://api.deepgram.com/v1/listen?model=nova-3&interim_results=true&encoding=linear16&sample_rate=16000&channels=1`, `Authorization: Token <key>`; `is_final=false` → interim, `true` → final. Constructor errors without a key |
| `stt::aliyun` | `AliyunNlsClient` — full WebSocket streaming implementation of Alibaba Cloud NLS `SpeechTranscriber` (`StartTranscription` / PCM binary frames / `TranscriptionResultChanged` / `SentenceEnd` / `StopTranscription` / `TranscriptionCompleted`), ported from `packages/stage-ui/src/stores/providers/aliyun/`. Region→gateway mapping (`nls-gateway-<region>.aliyuncs.com/ws/v1`, internal regions on `:80`) matches `utils.ts` |
| `mic` | `MicService` — start/stop capture, Fan frames to VAD, PTT + Auto modes, broadcast `MicEvent`s |

## Silero VAD model (never committed)

The model file is **not** in this repo. On first run, `ensure_model()`
downloads `silero_vad.onnx` (~2.3 MB) from the official URL:

```
https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx
```

into the platform data dir (`dirs::data_dir()`):

```
<data_dir>/airi-qt/models/silero_vad.onnx   # Linux: ~/.local/share/airi-qt/models/silero_vad.onnx
```

Download integrity: the SHA-256 is computed and logged (`tracing::info`); a
suspiciously small file (<100 kB) is rejected. Downloads go to a temp sibling
file then `rename(2)` — a crash never leaves a truncated model at the cache
path. A cache hit is the fast path and needs no network. Set
`SILERO_SKIP_DOWNLOAD=1` to disable the download path entirely (tests then
cover only the cache-hit path).

### Silero v5 ONNX protocol (subtle, do not "simplify")

From the official wrapper (`silero_vad/utils_vad.py`): the model does not
take a bare 512-sample frame. Every frame is **64 samples of left context
(the tail of the previous frame) prepended** — `input` is `[1, 576]`.
Additionally the recurrent `state` `[2, 1, 128]` flows across calls. Feeding
only 512 samples "works" (dynamic shape) but yields ~0 probabilities for
everything. `SileroVad` owns and resets both the context and the state.
`reset()` clears both (e.g. after a segment flush).

Frames are **512 samples at 16 kHz** (32 ms — `FRAME_MS`). The hysteresis
state machine (`VadHysteresis`) is pure and unit-tested with synthetic
probability sequences; `SileroVad` only produces probabilities.

## Linux capture notes (ALSA / PulseAudio / PipeWire)

`cpal` talks to ALSA directly. On modern desktops PulseAudio or PipeWire is
exposed through ALSA plugins, so the sound server's device usually appears as
`PulseAudio Sound Server` / `PipeWire Sound Server` and works with 16 kHz mono
f32. This crate **tries candidates in order** until one builds a working
stream (because ALSA's `default` can be a null device that refuses to open, or
advertise configs it cannot honour):

1. Explicit `CaptureConfig::device_name` (exact match on the cpal device
   `description().name()`; failure errors — no fallback).
2. `PulseAudio Sound Server`, then `PipeWire Sound Server` (they respect the
   user's desktop mic selection).
3. Any device supporting 16 kHz mono f32 or i16 (null/discarding devices and
   ALSA rate-converter plugins are excluded).
4. The host default device, whatever it is.

Hard-won specifics of a PipeWire machine seen in the wild here:

- ALSA's `default` ("Default Audio Device") may refuse to build a stream at
  all — do not rely on it.
- Raw hardware can use `dsnoop` and may fail on busy mics; the sound server
  devices are more forgiving.
- `arecord -l` lists raw hardware (`hw:…`); `pactl list sources` lists what
  Pulse/PipeWire sees; the cpal names above look like `HD-Audio Generic,
  ALC897 Analog` or `PulseAudio Sound Server`.

Permissions: with Pulse/PipeWire no special group is required. With raw ALSA
the user may need the `audio` group (or a Pulse/PipeWire session). In VMs /
containers without capture devices, `AudioCapture::start` errors out, and
hardware-dependent tests skip gracefully instead of failing (see "Testing").

## STT providers: what is real and what is not

| Path | Status | Notes |
|---|---|---|
| OpenAI-compatible (`OpenAiTranscribeClient`) | ✅ implemented & tested against a mock TCP server | Multipart `file=audio.wav` + `model` + `response_format=json`; `language` / `prompt` forwarded when set; non-2xx → `SttError::Provider` with the body truncated to 512 chars; `{"text": ...}` missing/not-JSON → `SttError::Protocol`. **Works with Groq** via `base_url=https://api.groq.com/openai/v1` |
| Deepgram streaming (`DeepgramStreamingClient`) | ✅ implemented & unit-tested (message parsing, URL building, constructor validation); **not verified against the live service** | `wss://api.deepgram.com/v1/listen?model=nova-3&interim_results=true&encoding=linear16&sample_rate=16000&channels=1`, `Authorization: Token <key>`; interim/final from `is_final`; `{"type":"CloseStream"}` on `finish()`. Constructor errors without a non-empty key. Live verification needs a real key (pending — see phase notes) |
| Aliyun NLS (`AliyunNlsClient`) | ✅ WebSocket streaming path implemented & unit-tested; **not verified against the live service** | Ported from `packages/stage-ui/src/stores/providers/aliyun/` (`index.ts`, `stream-transcription.ts`, `utils.ts`). **Token acquisition is out of scope**: Aliyun issues tokens via a signed `CreateToken` call against `nls-meta.<region>.aliyuncs.com` (AK/SK HMAC-SHA1, `token.ts`, unit-tested upstream). This crate expects a **pre-issued token** in `AliyunNlsConfig::token` — from the Alibaba console, a proxy, or your own token service. Raw AK/SK is never handled. Message ids are 32-hex (SHA-256 over time+counter+pid). Audio sent before `TranscriptionStarted` is held by the writer task; final events flow until the server closes |
| Aliyun unspeech / HTTP round-trip proxy | ❌ not implemented | The streaming path above is the production path used by AIRI's stage-ui; a separate HTTP wrapper adds nothing the WS path doesn't cover. Documented as deliberately absent |

Streaming sessions (`SttStream`) are created with
`client.connect().await?`, frames are pushed with `send_pcm(&[i16])`, and
interim/final/error events arrive on `stream.events`
(`broadcast::Receiver<SttEvent>` — one ordered sequence, unlike a split
interim/final pair; that is deliberate). `finish()` sends the provider's close
handshake (`CloseStream` / `StopTranscription`); the server then flushes its
terminal events and closes.

## Modes and duplex behaviour

`MicService` has two modes:

- `MicMode::PushToTalk` — buffers everything between `start()` and `stop()`;
  `stop()` transcribes the whole blob (OpenAI-compatible path → one
  `MicEvent::Final`).
- `MicMode::Auto` — continuous VAD segmentation; each `SpeechEnd` flushes the
  segment (whole-blob) and emits `SpeechStart`/`SpeechEnd`. With a streaming
  session attached (`MicConfig::streaming`), frames are forwarded live and
  `MicEvent::Interim`/`Final` come from the session (OpenAI-compatible
  transcription has no interim mode — only Deepgram/Aliyun emit true interim).

**`duck_while_speaking` is a reserved hook, not a feature.** It toggles a
frame-shed gate (`MicService::set_ducked(true)` drops all mic frames, e.g.
while TTS playback is hot). Wiring it to `airi-speech` playback amplitude and
**echo cancellation** are explicitly **not** done. On laptop speakers the mic
hears the TTS output and Auto mode will transcribe the assistant. Use
headphones, PTT, or the ducked gate until echo cancellation lands.

## Testing

```
cargo test -p airi-stt --all-targets
```

- Pure hysteresis state machine: deterministic tests, no model needed.
- `SileroVad` against the real model (downloads once into the data dir, or
  uses the cache): synthetic harmonic "voiced" burst → `SpeechStart`; silence →
  `SpeechEnd`. The test prints a skip message and passes when the model cannot
  be obtained; `SILERO_SKIP_DOWNLOAD=1` exercises only the cache-hit path.
- OpenAI-compatible path end-to-end against an in-process **mock TCP server**
  (`tests/common/mod.rs` — raw HTTP/1.1, no framework): asserts request line,
  `Authorization`, multipart content-type + boundary, `audio.wav` file part,
  model/language/`response_format` fields, WAV `RIFF` framing, and
  `SttError::Provider`/`Protocol` mapping.
- Mic pipeline pump: PTT buffer-and-flush through a mock `SttClient`; Auto
  mode end-to-end through the real model (skips gracefully without it);
  duck-gate frame shedding; missing-STT error path.
- Hardware capture test: starts a ~1 s capture from the default candidate on
  the local machine and skips (passes) when no usable input device exists,
  e.g. CI VMs.

Hardware-verified here: PulseAudio Sound Server capture (30 chunks/s, levels
exposed). Not hardware-verified: microphones other than PulseAudio routing,
48 kHz-only devices (they error, by design — no resampler yet).

## Deliberately out of scope (this lane)

- Echo cancellation / duplex self-listening (see above).
- Composer transcript injection (QML bridge + composer wiring — next phase).
- Resampling (<-> non-16 kHz devices error out; `rubato`-based fallback TODO).
- Aliyun AK/SK token exchange (`token.ts`) — pre-issued tokens only.
- Hot-swapping streaming providers mid-session.
