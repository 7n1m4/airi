<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ① lane ② — Local whisper STT via whisper-rs (`airi-stt`)

Native on-device transcription behind the existing whole-blob `SttClient` trait (`id() = "whisper-local"`). No server, no HTTP, no network at inference time — `whisper-rs` 0.16 (whisper.cpp bindings) runs `ggml` / `gguf` models in-process on CPU.

## Deliverables

All inside `apps/airi-qt/crates/airi-stt/` (P5 crate; no Qt deps):

- `src/stt/whisper_local.rs` — `WhisperLocalClient { model_path, language, translate }` implementing `SttClient` (`transcribe_pcm`). PCM s16 16 kHz mono → f32 `[-1, 1]` → whisper.cpp `FullParams` (Greedy, `no_context`, `suppress_blank`, `no_timestamps`, `n_threads` clamped 1–8). Model loads lazily on first `transcribe_pcm` and is cached (`Arc<Mutex<Option<Arc<WhisperContext>>>>`) for the client's lifetime. Inference runs on `tokio::task::spawn_blocking` (CPU-bound, synchronous whisper.cpp).
- Model acquisition mirroring `vad.rs` Silero `ensure_model()`: default `ggml-base.en.bin` (~148 MB, English-only) downloaded from ggerganov/whisper.cpp on first run into `dirs::data_dir()/airi-qt/models/ggml-base.en.bin`; never committed; temp-file + `rename` so a crash never leaves a truncated model; SHA-256 logged. `AIRI_QT_WHISPER_MODEL` env var overrides the path (used verbatim, no download). `AIRI_QT_WHISPER_SKIP_DOWNLOAD=1` disables the download path (CI).
- `SttConfig` extended additively in `src/mic.rs` with `WhisperLocal { model_path }`; default stays `OpenAi`; existing defaults untouched; `SttConfig::build()` maps `WhisperLocal` → `WhisperLocalClient::new(model_path)`.
- Model-independent unit tests (no model / no network): id, config plumbing (default stays OpenAI, WhisperLocal builds local client), `WhisperRunConfig` param builder, `check_request` WAV/PCM precondition asserts (empty / non-16kHz rejected), `s16_to_f32` scaling, `resolve_model_path` explicit/env precedence, `ensure_model_at` cache-hit + skip-download, transcribe-before-model-load error paths.
- Live transcription gated on `WHISPER_TEST_MODEL=<path-to-ggml-model>`; skipped with an stderr note when unset (state honestly reported: did not run in CI). Optionally `WHISPER_TEST_AUDIO=<16 kHz mono s16 WAV>` asserts non-empty text; otherwise a 1 s 440 Hz tone asserts the pipeline runs end-to-end without error.

## Build outcome (real)

- `cargo build -p airi-stt` — clean.
- `cargo test -p airi-stt --all-targets` — 62 lib tests + 5 mock e2e, all green. `live_transcription_roundtrip` skips (no `WHISPER_TEST_MODEL`).
- `cargo clippy -p airi-stt --all-targets -- -D warnings` — clean (test-only `MutexGuard`-across-await and `chunks_exact` nits fixed).
- `cargo fmt -p airi-stt -- --check` — clean.

At the time this lane landed, `crates/airi-laya` briefly broke workspace-wide commands; that has since been fixed and the full gate is green: `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all`, `cargo test --workspace`, and `--smoke` all pass.

## Model chosen

`ggml-base.en.bin` (~148 MB, English-only, ~200 MB RAM, ~3× real-time on a modern laptop CPU) — smallest model class with usable English accuracy, matching the plan's default. `small`/`medium` are better but 3–10× heavier; override via `AIRI_QT_WHISPER_MODEL`.

## Wiring shape

`SttConfig::WhisperLocal { model_path }` is additive beside `OpenAi`. `MicConfig::stt` remains `Arc<dyn SttClient>` — callers set it via `SttConfig::build()` or `MicConfig::with_stt_config()`. `SttConfig::Default` unchanged (`OpenAi` at `https://api.openai.com/v1`, no env reads). Deepgram/Aliyun stay streaming-only on `MicConfig::streaming`; whisper-local is whole-blob only, consistent with OpenAI-compatible.

`lib.rs` re-exports `WhisperLocalClient` at the crate root (already present); `stt.rs` re-exports `ensure_whisper_model`, `WhisperLocalClient`, `WhisperModelError` (already present).

## Honest limits

- `base.en` is **English-only**; non-English needs a multilingual model via `AIRI_QT_WHISPER_MODEL`.
- whisper.cpp pads audio to its internal 30 s window with ~500 ms of leading/trailing context; very short clips may hallucinate ("Thank you." etc.). Whole-blob only — no streaming.
- No live model was available in this session, so `live_transcription_roundtrip` **did not run**; the prior attempt reported an exact JFK quote with a downloaded model (network-permitting). The test harness is in place; run with `WHISPER_TEST_MODEL=<path> [WHISPER_TEST_AUDIO=<wav>] cargo test -p airi-stt live_transcription_roundtrip`.
- Model download (~148 MB) not performed here; network gating respected (`AIRI_QT_WHISPER_SKIP_DOWNLOAD` honored).
- Workspace-wide `cargo clippy --workspace` / `cargo fmt --all` blocked by the pre-existing untracked `airi-laya` empty-crate manifest issue; scoped `airi-stt` checks are green.

## Files

`apps/airi-qt/crates/airi-stt/src/stt/whisper_local.rs` (new), `apps/airi-qt/crates/airi-stt/src/stt.rs` (re-export already present), `apps/airi-qt/crates/airi-stt/src/mic.rs` (`SttConfig::WhisperLocal` + `build()` arm — additive), `apps/airi-qt/crates/airi-stt/src/lib.rs` (re-export — already present), this note. `qml/`, `airi-speech/`, composer injection untouched (next phase).
