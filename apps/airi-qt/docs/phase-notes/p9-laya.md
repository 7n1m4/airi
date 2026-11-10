<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ① lane ④ — Laya ModernBERT decision model (`airi-laya`)

Native in-process port of AIRI's System-1 Laya gate: question preparation, span-marker prompt assembly, ONNX inference, and per-type answer decoding, faithful to the reference implementation (`packages/stage-ui/src/workers/laya/worker.ts` + `prep.ts`, Laya family). No Python, no web server, no WASM — `ort` (ONNX Runtime 2.0 rc.15) + the `tokenizers` crate on CPU.

## Deliverables

All inside `apps/airi-qt/crates/airi-laya/` (new crate, workspace member; no Qt deps, no LLM wiring by design):

- `src/model.rs` — `LayaModel` (compiled `ort::session::Session` behind `Arc<Mutex<_>>`, tokenizer, `LAYA_TEST_MODEL`-gated live test). Loads from disk, or auto-downloads on first run from `bgoldfarb93/laya-int8` @ `e6c564dc…` / `laya.onnx` (~633 MB int8, 632,723,730 bytes) into `dirs::data_dir()/airi-qt/models/laya/`; tokenizer from `onnx-community/laya-ONNX` @ `42e2a6e3…` (`tokenizer.json`, 3.58 MB, BPE vocab 50,280). Never committed. `ModelConfig` carries repo/revision/file/min-size/manifest knobs; `LAYA_TEST_MODEL` overrides the path for tests.
- `src/question.rs` — the Laya-family preparation pipeline ported verbatim:
  - `LayaQuestion::{Choice, Score, Noul}` — typed question model; `from_json` parses AIRI's loose `questions[qid]` wire shape (array/object criteria, both score-criteria forms).
  - `build_sequence` — `CLS head SEP (MASK option)* SEP state SEP` with the worker's exact token budgeting (`HEAD_MAX_LEN=192`, `OPTION_TOKEN_CAP=48`, per-option allocation, 8-token head floor, 4096 cap), marker positions recorded at each option's leading `MASK`.
  - Temperature tables (`choice:2 → 1.9063563…`, verbatim IEEE-754 doubles from `DEFAULT_TEMPERATURES`), `softmax`, `confidence_from_probs` (normalized-entropy confidence), `temp_bucket`.
  - `py_json_dumps` — byte-compatible port of the worker's Python `json.dumps`-style serializer for the state tail.
  - Special token ids are the worker's fallbacks (`CLS=50281, SEP=50282, PAD=50283, MASK=50284`); the shipped `tokenizer.json` has no `added_tokens`, so these are the effective ids.
- `src/tokenizer.rs` — thin wrapper over `tokenizers::Tokenizer`; `encode(text, add_special_tokens)` (the graph aligns span markers to absolute raw ids, so sequences are assembled without specials).
- `src/error.rs` — typed `LayaError` (`NotFound`, `ModelLoad`, `TokenizerLoad`, `Tokenize`, `Inference`, `OutputShape`, `Input`, `Download`, `Integrity`, `HttpStatus`, `Io`, `Numeric`); `is_transient()` for retry decisions.
- `lib.rs` — public re-exports; `#![deny(missing_docs)]`.

## Build outcome (real)

- `cargo build -p airi-laya` — clean.
- `cargo test -p airi-laya --all-targets` — 20 lib tests, all green (sequence assembly, cap enforcement, marker/pointing alignment, temperatures, JSON boundary parsing, softmax, decoding).
- `LAYA_TEST_MODEL=~/.local/share/airi-qt/models/laya/laya.onnx cargo test -p airi-laya live_decide` — **passes** (1.6 s) against the real weights. Outputs with `LAYA_DEBUG=1`:
  - choice "yes" 0.9385 / "no" 0.0615, confidence 0.6665
  - score expectation 1.5643 (levels hostile/neutral/eager), probabilities sum ≈ 1.0
  - noul `false` 0.2462 / `true` 0.7538
- `cargo clippy -p airi-laya --all-targets -- -D warnings` — clean.
- `cargo fmt --all --check` — clean.
- Workspace `cargo clippy --workspace --all-targets -- -D warnings` — clean. `cargo test --workspace` — all suites green, zero failures. `QT_QPA_PLATFORM=offscreen cargo run -p airi-qt -- --smoke` — exit 0 (pages: splash, control-strip, chat, settings, about, stage; stage skinAndMorph ticks: 30). The offscreen Quick3D QRhi warnings are the pre-existing offscreen-QPA limitation, unchanged.

## Graph signature (verified, not assumed)

Probed the exported model before implementing inference:

`input_ids i64[batch, seq]`, `attention_mask i64[batch, seq]`, `marker_pos i64[batch, options]`, `marker_mask bool[batch, options]`, `qtype i64[batch]` → outputs `logits f32[batch, options]`, `act_probs f32[batch, 2]`.

`act_probs` is exported but unconsumed, mirroring the web worker. The act head's unconditional `topk(2)` is why a batch whose widest question has one option is fed a 2-wide marker axis (`K = max(2, max_options)`), exactly as the worker comments.

## Honest limits

- The OpenJev family (ModernBERT-base, 12 heads, `heman10x/rlcd-modernbert-151m`) is **not** ported — same pipeline modulo the `<<LABEL>>`-embedded prompt variant; deferred until there's a pinned OpenJev ONNX export to target.
- `noul` reports `p[1]` (probability of the "false" option) as its `noul` field, preserving upstream semantics verbatim rather than silently "fixing" it.
- Temperature table falls back to 1.0 for buckets absent upstream (e.g. `score:2`, `score:11+`), same as the JS lookup.
- fp16 external-data export (`onnx-community/laya-ONNX` `model_fp16.onnx`) is unsupported; int8 single-file only.
- Sub-batching by attention-buffer budget is omitted (host RAM is the guard); the WebGPU 1.34 GB budget logic is not applicable.
- Live outputs are coherent (choice picked "yes" 0.94 for "tell me a joke") but this is a 633 MB int8 ModernBERT-large — quality is whatever the checkpoint gives; no quality eval was run.

## Integration sketch (deliberately not wired)

`airi-llm` keeps its `laya-local`/`typesafe-ai` stubs as `Unsupported`. A future lane wraps `LayaModel` behind the existing `airi_llm::ChatProvider` trait (`stream()` emits the decoded answer as a final delta) or behind a dedicated `System1Evaluator` facade consumed by the director/Jev path. No other crate depends on `airi-laya` yet.

## Files

`crates/airi-laya/Cargo.toml`, `src/{lib,model,question,tokenizer,error}.rs` (rewritten wholesale this session), `docs/phase-notes/p9-laya.md` (this note). Deleted the unworkable first skeleton (`classifier.rs`, `labels.rs` — a 3-way argmax that misread the graph as a plain classifier) and the throwaway `examples/probe.rs`. Model artifacts stay on disk at `~/.local/share/airi-qt/models/laya/` (never committed).
