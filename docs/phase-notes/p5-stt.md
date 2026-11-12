# P5 lane ② — Speech-to-Text + Silero VAD (`airi-stt`)

Status: **implemented and tested** on this machine (unit + mock e2e + real-model VAD + real capture smoke). Live-service verification (Deepgram / Aliyun) and composer injection are out of scope / pending.

## Deliverables

New crate `crates/airi-stt/` (workspace member; no Qt deps):

- `capture.rs` — `AudioCapture::start(CaptureConfig)` → 16 kHz mono f32 → s16 `PcmChunk`s of 512 samples (~32 ms) on `broadcast::Receiver<PcmChunk>` (`capture.rx`); device selection by `device_name` (exact match) or default-with-preference (PulseAudio → PipeWire → any 16 kHz-mono candidate → host default, with trial-open fallback since ALSA `default` is often a null device that refuses to open); peak/RMS level meter via `level()`/`level_handle`; `stop()`.
- `vad.rs` — `SileroVad` (ONNX Runtime via `ort` 2.0.0-rc.15) + `VadHysteresis` (pure deterministic state machine, synthetic-probability unit tests); `ensure_model()` downloads Silero VAD v5 from the official URL to `dirs::data_dir()/airi-qt/models/silero_vad.onnx` on first run (never committed; `SILERO_SKIP_DOWNLOAD=1` disables; temp-file + rename; SHA-256 logged).
- `stt.rs` + `stt/{openai,deepgram,aliyun}.rs` — `SttClient` whole-blob trait (`transcribe_pcm`), `SttStream` streaming sessions with shared `SttEvent::{Interim,Final,Error}` vocabulary and shared WebSocket pump.
- `mic.rs` — `MicService` (PushToTalk + Auto modes), `MicEvent::{CaptureStarted, CaptureStopped, SpeechStart, SpeechEnd{segment_ms}, Interim{text}, Final{text}, Error{message}}` on a broadcast channel.
- `tests/mock_stt.rs` + `tests/common/mod.rs` — raw-TCP mock OpenAI-compatible server; asserts wire shape end-to-end.
- `examples/{vad_probe,capture_probe}.rs` — dev probes (model I/O signature + per-frame probabilities; device enumeration with supported-config dump). Kept for hardware debugging.

## Key findings / decisions

1. **Silero v5 ONNX needs a 64-sample left context.** The official wrapper (`silero_vad/utils_vad.py`, `OnnxWrapper`) prepends the previous frame's 64-sample tail to every 512-sample frame (`input` is `[1, 576]`), and carries `state` `[2,1,128]` across calls. Without the context the model runs fine but returns ≈0.001 probabilities for *any* input (verified with the probe: silence/noise/harmonics all ≈0.001; with context: synthetic harmonic ≈1.0, formant "vowel" ≈0.98). `SileroVad` owns and resets both context and state. This was the one real protocol trap — do not remove it.
2. **Default device is unusable on this class of Linux box.** ALSA's `default` ("Default Audio Device") is a null device whose streams fail to build; PipeWire's ALSA plugin also fails here ("requested audio device is not available"), while `PulseAudio Sound Server` works. Hence candidate selection with trial-open instead of trusting the host default. Hardware-verified: 30 chunks/s from "PulseAudio Sound Server", level meter alive (peak 0.000 — room silent).
3. **Hysteresis defaults** match the plan (0.35 / 0.15 / 300 ms). `segment_ms` on `SpeechEnd` excludes the trailing silence run.
4. **`SttStream::events`** is a single ordered broadcast channel (interim and final in sequence), not a split `interim`/`final_` pair from the plan sketch — one receiver preserves ordering and simplifies the QML pump.
5. **Aliyun NLS**: the *streaming* protocol is fully derivable from `packages/stage-ui/src/stores/providers/aliyun/` and is implemented (WSS gateway, `StartTranscription`/`StopTranscription`, `SpeechTranscriber` namespace, `TranscriptionResultChanged`→Interim, `SentenceEnd`→Final, `TranscriptionCompleted` ends session; audio held until `TranscriptionStarted`). **Token acquisition (AK/SK HMAC-SHA1 `CreateToken` against `nls-meta.<region>.aliyuncs.com`) is deliberately out of scope** — the client requires a pre-issued token in `AliyunNlsConfig::token`. AK/SK never touch this crate. No unspeech/HTTP proxy path was implemented (the WS path is what AIRI's stage-ui uses); see README provider table.
6. **No echo cancellation / no composer injection / no interim* for OpenAI-compatible** — all by design; `duck_while_speaking` is a frame-shed gate only (`set_ducked`), wired to TTS amplitude in the QML-bridge phase.
7. Model download works here (2,327,524 bytes; `spox` producer). Model is cached at `~/.local/share/airi-qt/models/silero_vad.onnx` on this machine — runtime location, never committed.
8. Device error honesty: non-16 kHz rates error out (`UnsupportedSampleRate`) rather than silently resampling; zero chunk size is rejected; capture without usable device errors; hardware tests skip, they don't fail.

## What is verified vs hardware-dependent

Verified (this machine):

- `cargo test -p airi-stt --all-targets` — 44 lib/bin/example tests + 5 mock e2e, all green (hysteresis determinism; cache-hit model path; real-model `SpeechStart`/`SpeechEnd`; mock OpenAI server wire shape incl. multipart boundary, `audio.wav` part, `RIFF`, `model`/`language`/`response_format`, Bearer header; PTT flush; Auto pipeline through the real model with mock STT — one `SpeechStart`, one `SpeechEnd`, one `Final{"segment transcript"}`, exactly one STT call; duck gate drops frames; error paths).
- `cargo clippy --workspace --all-targets -- -D warnings` — clean.
- `cargo fmt -p airi-stt -- --check` — clean.
- `cargo run -p airi-qt -- --smoke` — exit 0, pages visited incl. stage, chat outcome done (2 deltas), skinAndMorph ticks 30 (unchanged from before this lane — nothing of mine is on the smoke path).
- Real capture smoke: PulseAudio Sound Server, 30 chunks/s, levels exposed.
- Silero model real inference: harmonic-burst probabilities ≈1.0 after fix; silence ≈0.005.

Hardware-dependent / not verified:

- Microphones behind other routing (raw ALSA `hw:`, JACK, PipeWire-ALSA plugin on machines where it works) — code paths exist (candidate loop) but untested there; ALC897 raw reports configs but refuses 16 kHz mono builds on this box.
- Deepgram and Aliyun against **live services** — parsing/handshake/URL/payload shapes unit-tested against the upstream TypeScript behavior; no live keys available in this session. Groq/OpenAI-compatible live path untested (mock only).
- Capture permission denied cases (e.g. `HDA NVidia` reports permission denied) — surfaced as skip, not crash.

## Blockers / known limitations

- ALSA `default` unusable here; preference loop works around but silent device selection on exotic setups still needs operator `device_name`. Documented in README.
- No resampler (48 kHz-only devices error out).
- No echo cancellation — Auto mode on speakers hears TTS.
- `MicEvent::Interim` only fires with a streaming session; OpenAI-compatible = whole-blob only.

## Acceptance mapping

- "mock STT e2e" ✅ (`tests/mock_stt.rs`, TCP mock; multipart asserted).
- "voice input populates composer" — **not in this lane**; composer injection is the next phase (QML bridge: `MicEvent::Final{text}` → composer entry). The bridge point is `MicService::subscribe()` / `MicEvent::Final`.
- "IPC: CaptureEvent inventory" — not applicable (native, no electron).

## Next-phase TODOs

1. QML bridge pump for `MicEvent` → composer: transcript injection, PTT key wiring, auto-mode toggle, level meter UI (`AudioLevel`), mic permission prompt UX.
2. Wire `set_ducked` to `airi-speech` playback amplitude (loop-back sound check: assistant must not transcribe itself; manual QA with `--smoke` + voice).
3. Live verification with a real Deepgram key; Aliyun live check with a pre-issued token; Grafana the model download telemetry if any.
4. Echo cancellation (WebRTC AEC or PipeWire source filter) before shipping Auto mode on speakers.
5. Resampling fallback (rubato) for non-16 kHz devices; ALSA `dsnoop` hint docs.
6. If the STT mock should also cover Aliyun/Deepgram handshakes, extend `tests/common` with a tiny WS server (tungstenite accept) — deliberately not done now (no live keys; protocol unit tests cover parsing).

## Files

`apps/airi-qt/Cargo.toml` (workspace member, additive), `apps/airi-qt/crates/airi-stt/**`, this note. `airi-speech/`, `qml/`, `apps/airi-qt/src/` untouched.
