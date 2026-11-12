<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ① lane ③ — Kokoro-82M TTS (`airi-speech`)

In-process neural TTS: ONNX Runtime inference of `hexgrad/Kokoro-82M` (Apache-2.0, 82M params), plus a real espeak-ng G2P. No HTTP service, no server, no WASM — one forward pass per sentence, 24 kHz mono s16 PCM out.

## Deliverables

- `crates/airi-speech/src/client_kokoro.rs` — `KokoroSynthesizer` implementing the crate's `SpeechSynthesizer` trait. Model + voice bins fetched on first run into `dirs::data_dir()/airi-qt/models/kokoro/` (never committed, temp+rename). Lazy session load behind `Arc<Mutex<Option<_>>>`; CPU-bound inference on `tokio::task::spawn_blocking`.
- `crates/airi-speech/src/client_kokoro/kokoro_vocab.rs` — the exact 177-entry phoneme→id vocab from `onnx-community/Kokoro-82M-v1.0-ONNX`'s `tokenizer.json`. Verified byte-for-byte identical to the shipped `tokenizer.json` via a verification script (`vocab: 177, table: 177, mismatches: none`).
- Registry row `kokoro-local` (`TtsProviderKind::KokoroLocal`, `TtsStatus::Partial`) — build-time clients now construct it. `Partial` because G2P quality depends on espeak-ng availability (see limits).
- Model inputs/outputs verified by runtime probe **before** implementing: `input_ids` i64 `[1, N]` (`[0, *ids, 0]`, boundary `$` = 0), `style` f32 `[1, 256]` (row `n_phoneme_tokens − 1` of the voice bin, capped 509), `speed` f32 `[1]` → `waveform` f32 at 24 kHz.
- Voice embedding bins `(510, 256)` f32 LE, 522,240 bytes each; `af_heart.bin` cached at `~/.local/share/airi-qt/models/kokoro/voices/af_heart.bin` (sha256 `d583ccff…`).

## espeak-ng (the G2P that upstream uses)

The prior stub assumed espeak-ng was unavailable; it is now built from source at `~/.local/espeak-ng` (v1.52.0, no sudo, install prefix `$HOME/.local/espeak-ng`). The client finds it via `AIRI_QT_ESPEAK`, then `PATH`/`~/.local/espeak-ng/bin`, then `/usr/bin/espeak-ng`. With espeak-ng, Kokoro runs the same G2P `kokoro-onnx` ships with (`phonemizer`/`espeak-ng -v en-us --ipa=3`). Without it, the module falls back to a **degraded rule-based US-English letter-to-sound** (~30 digraphs + ~30 single letters, uppercase kept); quality is materially worse and non-English voices produce garbage.

## Verification (real)

- `cargo build -p airi-speech` — clean.
- `cargo test -p airi-speech --all-targets` — 17 lib + mock e2e, all green (`live_synthesize_af_heart` skips without `KOKORO_TEST_MODEL`).
- `KOKORO_TEST_MODEL=1 cargo test -p airi-speech live_synthesize_af_heart` — **passes** (~0.74 s) against the real int8 model at `~/.local/share/airi-qt/models/kokoro/kokoro-v1.0.onnx` (sha256 `8fbea51…`, exactly 325,532,232 bytes). WAV asserted: RIFF/WAVE, mono 24 kHz, >10 kB, peak > 1000 (non-silent).
- Unit tests of the module: vocab table totality (all 177 ids resolve), boundary wrapping, unknown-glyph skipping (incl. ZWJ from espeak output), voice-id validation, voice-row style selection with a synthetic bin, WAV round trip, sentence splitting, espeak-missing error path (no silent degrade into accuracy garbage).
- `cargo clippy --workspace --all-targets -- -D warnings` — clean. `cargo fmt --all --check` — clean. `cargo test --workspace` — all suites green (23 `test result: ok`). `QT_QPA_PLATFORM=offscreen cargo run -p airi-qt -- --smoke` — exit 0.
- Live G2P sanity: `espeak-ng -v en-us --ipa=3 -q "Hello world."` → `həlˈoʊ wˈɜːld` — matches the vocab glyph set.

## Honest limits

- **Speech isn't bit-perfect upstream parity**: espeak-ng vs `misaki[en]` output can differ in stress marks; both are valid IPA for the checkpoint but load quality varies per sentence. Workable, not scored.
- **Segmentation**: text is split on `.`/`!`/`?`/`;`/newline with delimiters kept; long sentences hard-truncate at 510 ids with a (silent) loss of context — no re-windowing loop yet.
- **Pinned English model path only**: non-English voices need matching `--ipa` language tag handling (not wired); punt to a later lane.
- **Voice availability**: only `af_heart` is cached locally; other voices download on first use via the same repo id (`voices/<voice>.bin`).
- **No streaming**: whole-utterance synthesis through the 24 kHz buffer; rodio playback consumes it as one chunk. Lip-sync amplitude tap is unchanged.
- `speed` clamped to `0.5..=2.0`; `pitch`/`style` options ignored (Kokoro has no such knobs).
- Registry stays `Partial` until a live multi-voice eval exists; `Unsupported` → `Partial` is the one status flip of this lane.

## Files

`crates/airi-speech/src/client_kokoro.rs` (rewritten from the 56-line doc stub), `crates/airi-speech/src/client_kokoro/kokoro_vocab.rs` (new, generated+verified), `crates/airi-speech/src/config.rs` (`TtsProviderKind::KokoroLocal` + `kokoro-local` row/arm), `crates/airi-speech/src/lib.rs` (module + re-exports). `~/.local/share/airi-qt/models/kokoro/` is the runtime cache; nothing large is in the repo. `espeak-ng` installed at `~/.local/espeak-ng` (user-local, not a system dependency).
