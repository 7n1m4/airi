<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 lane ① — Native llama.cpp chat (`airi-local-llm`)

Native in-process GGUF inference behind the `airi-llm` `ChatProvider` trait.
No server, no HTTP, no network — `llama-cpp-2` bindings (v0.1.161, llama.cpp
back-end) run the model in-process.

## Build outcome (real)

`cargo check -p airi-local-llm` — **clean**; llama-cpp-sys-2 v0.1.161
compiled from source with cmake 4.4.5 + clang 23.1.4 + g++ 16.2.1 (~50 s).
No feature flags beyond `default` (openmp + common); no CUDA/Metal/Vulkan in
this lane. `cargo test -p airi-local-llm` — 30 passed (10 utf8/stop/prompt
unit suites + config plumbing + 2 rejection-path tests + env-gated live
test). `cargo clippy -p airi-local-llm --all-targets` — clean. rustfmt
applied to all touched files.

## Crate layout (`crates/airi-local-llm/`)

- `src/lib.rs` — `LocalLlmConfig` (`model_path`, `context_size`=2048,
  `temperature`=0.8, `max_tokens`=512, `gpu_layers`=0, `seed`=`DEFAULT_SEED`
  = 0x5EED5EED), `LlamaChatProvider` (`ChatProvider` impl; `id()` =
  `PROVIDER_ID` = `llama-cpp-local`; `models()` = one `ModelInfo` with the
  model file stem, `owned_by: "local"`). Model loads **lazily on first
  `stream()`** on `tokio::task::spawn_blocking` and is cached on the
  provider instance (`Arc<Mutex<Option<Arc<LlamaModel>>>>`) for its lifetime.
  `llama_new_context_with_model` mutates model state, so context creation is
  serialized process-wide (`CONTEXT_LOCK`); contexts decode concurrently.
  Partial chunks stream deltas over an unbounded channel; drop of the stream
  = cancellation (blocking loop notices the closed channel and exits).
- `src/utf8.rs` — partial-UTF-8-safe accumulator (`token_to_piece` byte
  pieces may split multi-byte sequences); invalid bytes → U+FFFD.
  Model-independent unit tests.
- `src/stop.rs` — streaming plain-text stop matcher over a bounded holdback
  (`DEFAULT_STOP_PATTERNS`: `<|eot_id|>`, `<|eom_id|>`, `<|end|>`,
  `<|im_end|>`, `<|endoftext|>`, `<|endofturn|>`, `<|end_of_turn|>`,
  `### User`). Full match anywhere ⇒ stop; a longest trailing prefix of a
  pattern is held back until disambiguated. Model-independent unit tests.
- `src/prompt.rs` — generic fallback prompt (`### System:` / `### User:` /
  `### Assistant:`, trailing `### Assistant:\n`) used when the GGUF has no
  chat template or the template engine rejects it; `prompt_has_bos_marker`
  guards double-BOS on tokenize. Model-independent unit tests.

## Chat-template path chosen

**Prefer the GGUF's own template** — `LlamaModel::chat_template(None)` +
`LlamaModel::apply_chat_template(&tmpl, &messages, /* add_ass */ true)`
(llama.cpp's built-in HF Jinja template engine; the file ships a template
for instruct models such as SmolLM2). If either step fails, `tracing::warn`
and fall back to the generic `### ...:` prompt. **Documented deviation:** the
fallback is not a valid template for any specific model — template-less GGUFs
will underperform. This path is exercised by `stories15M-q8_0.gguf` (base
TinyLlama, no template), and the template path by
`SmolLM2-135M-Instruct-Q8_0.gguf`.

## Stopping

Generation ends at the first of: (1) `vocab.is_eog(token) ||
vocab.is_control(token)` — the normal instruct path (`<|im_end|>` etc.);
(2) a plain-text stop pattern from `stop::DEFAULT_STOP_PATTERNS` matched
across pieces; (3) `max_tokens` (request overrides config); (4) the caller
drops the stream (cancellation). Context-decode failures and over-length
prompts surface as `LlmError` over the channel (stream yields `Err`, chat
service reports `ChatStatus::Error`).

## Registry row (`airi-llm`)

One additive row in `PROVIDER_DEFS`: `llama-cpp-local`, kind `LocalServer`,
`base_url: None`, `LOCAL_CPP_LOCAL` compat (`chat: true, streaming: true,
tools: false, models_endpoint: false`), credential schema `local_engine()`
(no fields). Doc comments updated 44 → 45 rows; bridge test assertion 44 →
45. `build_client()` is untouched per plan: the row is intercepted by
`airi-core`'s `resolve_provider` **before** the static registry fallback,
and by `memory::short_term` with `None` (env-only). Note: `build_client` on
this id would still produce a base-url-less OpenAI-compatible client
pointing nowhere — nothing calls it on this path; the registry row exists so
UI/provider lists can enable it.

## airi-core wiring

- `ChatService` now holds `settings: SettingsRepo` (read-only,
  `settings/local-llm`).
- `chat::resolve_provider` gained `local_llm: Option<&SettingsRepo>` and the
  intercept: `provider_id == "llama-cpp-local"` → `LlamaChatProvider::new(
  LocalLlmConfig { model_path, .. })`. `AIRI_QT_LLAMA_MODEL` env wins over
  the stored `modelPath`; `contextSize` / `temperature` / `maxTokens` /
  `gpuLayers` come from the settings section (spec defaults when absent).
  No match/intercept in any other lane; short_term passes `None`
  (env-only — **limitation**, documented).
- `chat.rs` module docs updated; two `llama_cpp_local_*` resolve tests added
  (settings-based resolution; unconfigured ⇒ `InvalidConfig`-ish bail
  mentioning both `AIRI_QT_LLAMA_MODEL` and `settings/local-llm`).
- `memory/short_term.rs` call site passes `None` (no settings handle there).

## Settings section (`settings/local-llm`, airi-core settings.rs)

`LocalLlmSettings` — additive typed section, key `settings/local-llm`,
camelCase blob: `modelPath: string` (default `""`), `contextSize: u32`
(2048), `temperature: f64` (0.8), `maxTokens: u32` (512), `gpuLayers: i32`
(0). `SettingsSection` impl + default impl + round-trip test asserts in
`settings::tests::stage_sections_round_trip_and_keys`-adjacent assertions.
**Deviation from the Electron flat-key model**: one typed blob (consistent
with the rest of the port); `AIRI_QT_LLAMA_MODEL` is the only env override
and only for `modelPath`. `seed` is intentionally *not* in the section (the
section mirrors the Electron-facing knobs); `LocalLlmConfig::seed` defaults
to `DEFAULT_SEED` (0x5EED5EED) for reproducible `dist(seed)` sampling.

## Live-inference gate (`LLAMA_TEST_MODEL`)

`live_generate_four_tokens_from_say_ok` generates 4 tokens from
`Say 'ok':` with greedy decoding (`temperature = 0`, `max_tokens = 4`).
Skipped with an stderr note when `LLAMA_TEST_MODEL` is unset — **it was
skipped by default in `cargo test -p airi-local-llm`**. When set, it ran and
passed against:

- `stories15M-q8_0.gguf` (TinyLlama-15M, base, no template) → generated
  `"Mommy:"`, `finish=Some("length")` — fallback path.
- `SmolLM2-135M-Instruct-Q8_0.gguf` (135M instruct, has template) →
  generated `"\"ok\" is"`, `finish=Some("length")` — GGUF-template path.

A scratch eos-path check (temporary test, since removed) confirmed a natural
`finish=Some("stop")` before the `max_tokens` cap (SmolLM2,
`Reply with exactly one word: ok` → `<|im_end|>` via `vocab.is_control`).

Pass criteria of the gated test are deliberately weak (finish reason
present) because tiny test models generate garbage-ish text; **it does not
assert quality, and `ok` is not guaranteed to appear**.

## Deviations & limitations (loud)

1. Generic `### ...:` prompt fallback for template-less GGUFs (see above) —
   not model-valid.
2. `settings/local-llm` resolution does not reach
   `memory::short_term`'s summarizer (no settings handle; env-only there).
3. `tools` are ignored — no function calling; tool specs passed by callers
   are silently dropped in the native path.
4. Stop patterns are plain-text backstop only; the primary stop signal is
   `vocab.is_eog || vocab.is_control`. Additional stop strings (user/system
   phrases) are not supported.
5. Double-BOS guard is marker-string based (`<|begin_of_text|>`,
   `<|start_of_text|>`, `<bos>`, `<s>`) — a template that emits a BOS in an
   unrecognized spelling will yield `should_add_bos` + emitted BOS twice.
6. CPU-only in this lane; `gpu_layers < 0` maps to `i32::MAX` ("offload
all"); CUDA/Vulkan/Metal are `llama-cpp-2` feature flags left unenabled.
7. `models()` reports exactly one model; ids are file stems — `request.model`
   from callers is ignored (advisory only).
8. `llama-cpp-local` through `build_client()` still yields a pointing-
   nowhere OpenAI-compatible client — documented in the registry note; the
   intercept prevents use of that path in-service.

## Integration TODOs

- UI: `ProvidersPage.qml` renders the row automatically (data-driven); the
  detail form shows no credential fields — a native "Local model" page
  (file picker + `settings/local-llm` editing + test-load button) is the
  natural next lane.
- Chat bridge: nothing to change — stored provider rows with id
  `llama-cpp-local` resolve through `ChatService::resolve_client`.
- Emit a reasoning/thinking channel if a template distinguishes
  `<think>...</think>` (currently not split out).
- Context creation serialization (`CONTEXT_LOCK`) is process-global; if
  multiple native providers are added later, revisit.
- GPU back-ends (CUDA/Vulkan) as a `gpu` feature pass-through once the
  workstation story is defined.
- Streaming assistant-message persistence + incremental truncation on stop
  (unchanged from other lanes; still absent in `airi-store`).
