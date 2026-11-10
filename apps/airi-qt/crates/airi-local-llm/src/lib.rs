// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Native in-process LLM inference behind the [`airi_llm::ChatProvider`] trait.
//!
//! Runs GGUF models locally through [`llama-cpp-2`](https://crates.io/crates/llama-cpp-2)
//! (safe-ish bindings over ggerganov's llama.cpp) — no server, no HTTP, no
//! network. The model is loaded **once per provider instance** and cached;
//! callers must reuse the instance (the chat bridge registers it in the
//! shared provider table via `ChatService::register_client`).
//!
//! ## Configuration
//!
//! [`LocalLlmConfig`] carries `model_path`, `context_size` (2048),
//! `temperature` (0.8), `max_tokens` (512), `gpu_layers` (0) and `seed`
//! ([`DEFAULT_SEED`]). In the desktop app it is built from the environment
//! (`AIRI_QT_LLAMA_MODEL`) or the `settings/local-llm` typed section
//! (`{ modelPath, contextSize, temperature, maxTokens, gpuLayers }`) by
//! `airi-core`'s `resolve_provider`.
//!
//! ## Chat formatting
//!
//! If the GGUF carries a chat template, llama.cpp's built-in template engine
//! renders the prompt ([`LlamaModel::chat_template`] +
//! [`LlamaModel::apply_chat_template`], `add_ass = true`). Otherwise the
//! generic `### System:` / `### User:` / `### Assistant:` fallback from
//! [`mod@prompt`] is used — **this is a documented deviation**: it is not a
//! valid template for any specific model and will underperform on
//! template-less GGUFs. A warning is logged when the fallback path is taken.
//!
//! ## Stopping
//!
//! Generation stops at the first of:
//! 1. an EOG or control token (`vocab.is_eog` / `vocab.is_control` — covers
//!    `<|eot_id|>`, `<|im_end|>` & friends when the vocab marks them, which
//!    is the normal case for instruct GGUFs),
//! 2. a plain-text stop pattern from [`stop::DEFAULT_STOP_PATTERNS`]
//!    (`<|eot_id|>`, `<|end|>`, `<|im_end|>`, `<|endoftext|>`,
//!    `<|endofturn|>`, `<|end_of_turn|>`, `### User`) matched across the
//!    decoded text stream with a bounded holdback, or
//! 3. `max_tokens` from the request (or the configured default), or
//! 4. the caller dropping the stream (the blocking generation loop notices
//!    the channel closed and exits — this is the cancellation path).
//!
//! ## Determinism & threading
//!
//! `temperature <= 0` (or NaN/Infinite) selects greedy decoding; otherwise a
//! `top-1 sampled from temp(temperature)` distribution with `dist(seed)`.
//! The seed comes from [`LocalLlmConfig::seed`] for reproducible sampling on
//! a fixed build. `llama_new_context_with_model` mutates model state, so
//! context creation is serialized process-wide ([`CONTEXT_LOCK`]); the
//! contexts themselves are independent and decode concurrently. Inference
//! runs on `tokio::task::spawn_blocking` — never on the async executor.
//!
//! The model itself is `Send + Sync` (read-only weights); the context is
//! created, used and dropped entirely inside one blocking task.

use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use airi_llm::{ChatChunk, ChatProvider, ChatRequest, ChatStream, LlmError, ModelInfo, Role};
use async_trait::async_trait;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use serde::{Deserialize, Serialize};

mod prompt;
mod stop;
mod utf8;

use prompt::{fallback_prompt, prompt_has_bos_marker};
use stop::StopMatcher;
use utf8::PartialUtf8;

/// Provider id registered under the `airi_llm` catalog.
pub const PROVIDER_ID: &str = "llama-cpp-local";

/// Default context size (tokens) — mirrors `settings/local-llm.contextSize`.
pub const DEFAULT_CONTEXT_SIZE: u32 = 2048;
/// Default sampling temperature — mirrors `settings/local-llm.temperature`.
pub const DEFAULT_TEMPERATURE: f64 = 0.8;
/// Default generation cap — mirrors `settings/local-llm.maxTokens`.
pub const DEFAULT_MAX_TOKENS: u32 = 512;
/// Default GPU layer offload — mirrors `settings/local-llm.gpuLayers`
/// (0 = run the whole model on the CPU).
pub const DEFAULT_GPU_LAYERS: i32 = 0;
/// Default RNG seed for the distribution sampler. Fixed so repeated runs on
/// the same build with `temperature > 0` are reproducible; not exposed in
/// `settings/local-llm` (the section mirrors the Electron-facing knobs only).
pub const DEFAULT_SEED: u32 = 0x5EED_5EED;

/// Resolved configuration for a local GGUF chat provider.
///
/// Built by `airi-core` from `AIRI_QT_LLAMA_MODEL` and/or the
/// `settings/local-llm` typed section. `seed` is provider-internal and does
/// not appear in the settings section.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmConfig {
    /// Absolute path to the `.gguf` model file.
    pub model_path: String,
    /// KV context window in tokens.
    pub context_size: u32,
    /// Sampling temperature. `0.0` selects greedy decoding.
    pub temperature: f64,
    /// Maximum number of tokens to generate per completion.
    pub max_tokens: u32,
    /// Layers to offload to the GPU. `0` = all CPU, negative = all layers.
    pub gpu_layers: i32,
    /// RNG seed for the distribution sampler (ignored for greedy).
    pub seed: u32,
}

impl LocalLlmConfig {
    /// Create a config with the spec defaults (2048 / 0.8 / 512 / 0 layers).
    pub fn new(model_path: impl Into<String>) -> Self {
        Self {
            model_path: model_path.into(),
            context_size: DEFAULT_CONTEXT_SIZE,
            temperature: DEFAULT_TEMPERATURE,
            max_tokens: DEFAULT_MAX_TOKENS,
            gpu_layers: DEFAULT_GPU_LAYERS,
            seed: DEFAULT_SEED,
        }
    }
}

/// Process-wide llama.cpp backend handle.
///
/// `LlamaBackend::init` may only run once per process; a failure is stored
/// so callers get a diagnostic instead of a panic.
static BACKEND: std::sync::LazyLock<Result<LlamaBackend, String>> =
    std::sync::LazyLock::new(|| LlamaBackend::init().map_err(|err| err.to_string()));

fn backend() -> Result<&'static LlamaBackend, LlmError> {
    match &*BACKEND {
        Ok(backend) => Ok(backend),
        Err(err) => Err(LlmError::Provider(format!(
            "llama.cpp backend initialization failed (was it already initialized by another consumer?): {err}"
        ))),
    }
}

/// Serializes `llama_new_context_with_model`, which mutates model state.
static CONTEXT_LOCK: Mutex<()> = Mutex::new(());

/// Native in-process llama.cpp chat provider for GGUF models.
///
/// Loads the model lazily on the first [`stream`](ChatProvider::stream)
/// call (via `spawn_blocking`) and caches it for the lifetime of the
/// instance. Cheap to clone-share: wrap in `Arc` and register once.
pub struct LlamaChatProvider {
    config: LocalLlmConfig,
    model: Arc<Mutex<Option<Arc<LlamaModel>>>>,
}

impl std::fmt::Debug for LlamaChatProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LlamaChatProvider")
            .field("config", &self.config)
            .field(
                "model_loaded",
                &self.model.lock().map(|m| m.is_some()).unwrap_or(false),
            )
            .finish()
    }
}

impl LlamaChatProvider {
    /// Create a provider for `config`. The model loads lazily on first use.
    #[must_use]
    pub fn new(config: LocalLlmConfig) -> Self {
        Self {
            config,
            model: Arc::new(Mutex::new(None)),
        }
    }

    /// The configuration this provider was built with.
    #[must_use]
    pub fn config(&self) -> &LocalLlmConfig {
        &self.config
    }

    /// File stem of the model path — the id advertised in `models()` and
    /// used to sanity-check `request.model` mismatches (advisory only).
    #[must_use]
    pub fn model_stem(&self) -> String {
        Path::new(&self.config.model_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(PROVIDER_ID)
            .to_string()
    }

    async fn load_model(&self) -> Result<Arc<LlamaModel>, LlmError> {
        let cache = self.model.clone();
        let path = self.config.model_path.clone();
        let gpu_layers = self.config.gpu_layers;
        tokio::task::spawn_blocking(move || {
            let mut guard = cache
                .lock()
                .map_err(|_| LlmError::Provider("model cache mutex poisoned".to_string()))?;
            if let Some(model) = guard.as_ref() {
                return Ok(model.clone());
            }
            let backend = backend()?;
            let params = LlamaModelParams::default();
            let params = if gpu_layers >= 0 {
                params.with_n_gpu_layers(gpu_layers as u32)
            } else {
                // `with_n_gpu_layers` clamps u32::MAX to i32::MAX —
                // effectively "offload every layer".
                params.with_n_gpu_layers(u32::MAX)
            };
            let model = LlamaModel::load_from_file(backend, PathBuf::from(&path), &params)
                .map_err(|err| {
                    LlmError::Provider(format!("failed to load GGUF at {path}: {err}"))
                })?;
            let model = Arc::new(model);
            *guard = Some(model.clone());
            Ok(model)
        })
        .await
        .map_err(|err| LlmError::Provider(format!("model load task failed: {err}")))?
    }
}

#[async_trait]
impl ChatProvider for LlamaChatProvider {
    fn id(&self) -> &str {
        PROVIDER_ID
    }

    async fn models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        Ok(vec![ModelInfo {
            id: self.model_stem(),
            owned_by: Some("local".to_string()),
        }])
    }

    async fn stream(&self, req: ChatRequest) -> Result<ChatStream, LlmError> {
        let path = self.config.model_path.trim().to_string();
        if path.is_empty() {
            return Err(LlmError::InvalidConfig(
                "llama-cpp-local: model path is empty; set AIRI_QT_LLAMA_MODEL or \
                 settings/local-llm.modelPath"
                    .to_string(),
            ));
        }
        if !Path::new(&path).is_file() {
            return Err(LlmError::InvalidConfig(format!(
                "llama-cpp-local: model file not found: {path}"
            )));
        }
        let model = self.load_model().await?;
        let backend = backend()?;
        let config = self.config.clone();
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Result<ChatChunk, LlmError>>();
        tokio::task::spawn_blocking(move || run_generation(model, backend, config, req, &tx));
        Ok(Box::pin(async_stream::try_stream! {
            let mut rx = rx;
            while let Some(item) = rx.recv().await {
                match item {
                    Ok(chunk) => yield chunk,
                    Err(err) => Err(err)?,
                }
            }
        }))
    }
}

/// Which sampler the temperature resolves to. Split out for testing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SamplerSelection {
    /// Argmax decoding (`temperature <= 0`, NaN, or infinite).
    Greedy,
    /// `temp(t)` + `dist(seed)`.
    Temperature,
}

fn select_sampler(temperature: f64) -> SamplerSelection {
    if temperature.is_finite() && temperature > 0.0 {
        SamplerSelection::Temperature
    } else {
        SamplerSelection::Greedy
    }
}

fn sampler_for(temperature: f64, seed: u32) -> LlamaSampler {
    match select_sampler(temperature) {
        SamplerSelection::Greedy => LlamaSampler::greedy(),
        SamplerSelection::Temperature => LlamaSampler::chain_simple([
            LlamaSampler::temp(temperature as f32),
            LlamaSampler::dist(seed),
        ]),
    }
}

/// Send a chunk over the channel; returns `false` when the receiver
/// (i.e. the chat service after a user stop) is gone.
fn send_chunk(
    tx: &tokio::sync::mpsc::UnboundedSender<Result<ChatChunk, LlmError>>,
    chunk: ChatChunk,
) -> bool {
    tx.send(Ok(chunk)).is_ok()
}

fn send_error(tx: &tokio::sync::mpsc::UnboundedSender<Result<ChatChunk, LlmError>>, err: LlmError) {
    let _ = tx.send(Err(err));
}

/// Blocking generation loop; owns the context for its whole lifetime.
/// Streams deltas over `tx`. Returns when generation finishes, errors, or
/// the receiver drops (cancellation).
#[allow(clippy::too_many_lines)]
fn run_generation(
    model: Arc<LlamaModel>,
    backend: &'static LlamaBackend,
    config: LocalLlmConfig,
    req: ChatRequest,
    tx: &tokio::sync::mpsc::UnboundedSender<Result<ChatChunk, LlmError>>,
) {
    let temperature = req.temperature.unwrap_or(config.temperature);
    let max_tokens = req.max_tokens.unwrap_or(config.max_tokens);

    // ---- Build the prompt ------------------------------------------------
    let mut template_messages: Vec<LlamaChatMessage> = Vec::new();
    if let Some(system) = req.system.as_deref() {
        match LlamaChatMessage::new("system".to_string(), system.to_string()) {
            Ok(message) => template_messages.push(message),
            Err(err) => {
                send_error(
                    tx,
                    LlmError::InvalidConfig(format!("system message rejected by llama.cpp: {err}")),
                );
                return;
            }
        }
    }
    for message in &req.messages {
        let role = match message.role {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Tool => "tool",
        };
        match LlamaChatMessage::new(role.to_string(), message.content.clone()) {
            Ok(message) => template_messages.push(message),
            Err(err) => {
                send_error(
                    tx,
                    LlmError::InvalidConfig(format!("chat message rejected by llama.cpp: {err}")),
                );
                return;
            }
        }
    }

    let prompt = match model.chat_template(None) {
        Ok(template) => match model.apply_chat_template(&template, &template_messages, true) {
            Ok(rendered) => rendered,
            Err(err) => {
                tracing::warn!(
                    error = %err,
                    "llama-cpp-local: GGUF chat template failed to apply; \
                     falling back to the generic prompt (documented deviation)"
                );
                fallback_prompt(req.system.as_deref(), &req.messages)
            }
        },
        Err(err) => {
            tracing::warn!(
                error = %err,
                "llama-cpp-local: model has no usable chat template; \
                 falling back to the generic prompt (documented deviation)"
            );
            fallback_prompt(req.system.as_deref(), &req.messages)
        }
    };

    // ---- Tokenize ---------------------------------------------------------
    let vocab = model.vocab();
    let add_special = vocab.should_add_bos() && !prompt_has_bos_marker(&prompt);
    let tokens = vocab.tokenize(prompt.as_bytes(), add_special, true);
    if tokens.is_empty() {
        send_error(
            tx,
            LlmError::Provider("prompt tokenized to zero tokens".to_string()),
        );
        return;
    }
    let context_size = config.context_size.max(64) as usize;
    if tokens.len() >= context_size {
        send_error(
            tx,
            LlmError::InvalidConfig(format!(
                "prompt of {} tokens exceeds configured contextSize of {context_size}; \
                 raise settings/local-llm.contextSize or shorten the prompt",
                tokens.len()
            )),
        );
        return;
    }
    let budget = (max_tokens as usize).min(context_size - tokens.len());

    // ---- Context ----------------------------------------------------------
    let context_params =
        LlamaContextParams::default().with_n_ctx(NonZeroU32::new(config.context_size.max(64)));
    let ctx_result = {
        let _guard = CONTEXT_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        model.new_context(backend, context_params)
    };
    let mut ctx = match ctx_result {
        Ok(ctx) => ctx,
        Err(err) => {
            send_error(
                tx,
                LlmError::Provider(format!("failed to create llama.cpp context: {err}")),
            );
            return;
        }
    };

    // Decode the prompt in chunks; logits only on the final prompt token.
    const DECODE_CHUNK: usize = 2048;
    let mut batch = LlamaBatch::new(DECODE_CHUNK.min(tokens.len()).max(1), 1);
    let mut pos = 0usize;
    while pos < tokens.len() {
        batch.clear();
        let end = (pos + DECODE_CHUNK).min(tokens.len());
        for (offset, &token) in tokens[pos..end].iter().enumerate() {
            let index = pos + offset;
            if batch
                .add(token, index as i32, &[0], index == tokens.len() - 1)
                .is_err()
            {
                send_error(tx, LlmError::Provider("batch add failed".to_string()));
                return;
            }
        }
        if let Err(err) = ctx.decode(&mut batch) {
            send_error(
                tx,
                LlmError::Provider(format!("prompt decode failed: {err}")),
            );
            return;
        }
        pos = end;
    }

    // ---- Generation ---------------------------------------------------------
    let mut sampler = sampler_for(temperature, config.seed);
    let mut utf8 = PartialUtf8::new();
    let mut stop = StopMatcher::with_defaults();
    let mut generated = 0usize;
    let finish_reason: &'static str;

    loop {
        if generated >= budget {
            finish_reason = "length";
            break;
        }

        let token: LlamaToken = sampler.sample(&ctx, -1);
        sampler.accept(token);

        if vocab.is_eog(token) || vocab.is_control(token) {
            finish_reason = "stop";
            break;
        }

        let piece = vocab.token_to_piece(token, false, None);
        let text = utf8.push(&piece);
        if !text.is_empty() {
            let (emit, hit) = stop.feed(&text);
            if !emit.is_empty() && !send_chunk(tx, ChatChunk::text(emit)) {
                return; // receiver dropped — cancelled
            }
            if hit {
                finish_reason = "stop";
                break;
            }
        }

        batch.clear();
        if batch
            .add(token, (tokens.len() + generated) as i32, &[0], true)
            .is_err()
        {
            send_error(tx, LlmError::Provider("batch add failed".to_string()));
            return;
        }
        if let Err(err) = ctx.decode(&mut batch) {
            send_error(
                tx,
                LlmError::Provider(format!("generation decode failed: {err}")),
            );
            return;
        }
        generated += 1;
    }

    // Flush the partial-UTF-8 tail, then the stop-matcher holdback.
    let tail = utf8.finish();
    if !tail.is_empty() {
        let (emit, _) = stop.feed(&tail);
        if !emit.is_empty() {
            let _ = send_chunk(tx, ChatChunk::text(emit));
        }
    }
    let rest = stop.flush();
    if !rest.is_empty() {
        let _ = send_chunk(tx, ChatChunk::text(rest));
    }

    let _ = send_chunk(tx, ChatChunk::finish(finish_reason));
}

#[cfg(test)]
mod tests {
    use super::*;
    use airi_llm::ChatMessage;

    #[test]
    fn local_llm_config_defaults_match_spec() {
        let config = LocalLlmConfig::new("/models/test.gguf");
        assert_eq!(config.context_size, 2048);
        assert_eq!(config.temperature, 0.8);
        assert_eq!(config.max_tokens, 512);
        assert_eq!(config.gpu_layers, 0);
        assert_eq!(config.seed, DEFAULT_SEED);
    }

    #[test]
    fn local_llm_config_serializes_camel_case() {
        let config = LocalLlmConfig::new("/models/test.gguf");
        let json = serde_json::to_value(&config).expect("serialize config");
        for key in [
            "modelPath",
            "contextSize",
            "temperature",
            "maxTokens",
            "gpuLayers",
            "seed",
        ] {
            assert!(json.get(key).is_some(), "missing key {key}");
        }
        let roundtrip: LocalLlmConfig = serde_json::from_value(json).expect("deserialize config");
        assert_eq!(roundtrip, config);
    }

    #[test]
    fn sampler_selection_treats_nonpositive_and_nan_as_greedy() {
        assert_eq!(select_sampler(0.0), SamplerSelection::Greedy);
        assert_eq!(select_sampler(-0.5), SamplerSelection::Greedy);
        assert_eq!(select_sampler(f64::NAN), SamplerSelection::Greedy);
        assert_eq!(select_sampler(f64::INFINITY), SamplerSelection::Greedy);
        assert_eq!(select_sampler(0.8), SamplerSelection::Temperature);
        assert_eq!(
            select_sampler(f64::MIN_POSITIVE),
            SamplerSelection::Temperature
        );
    }

    #[test]
    fn seed_plumbing_is_stable_for_reproducible_sampling() {
        // Same config twice → identical seed; changing the path does not
        // perturb it. This is the determinism contract of `dist(seed)`.
        let a = LocalLlmConfig::new("/a.gguf");
        let b = LocalLlmConfig::new("/b.gguf");
        assert_eq!(a.seed, b.seed);
        let mut custom = LocalLlmConfig::new("/c.gguf");
        custom.seed = 42;
        assert_eq!(custom.seed, 42);
    }

    #[test]
    fn model_stem_handles_plain_and_odd_paths() {
        let provider =
            LlamaChatProvider::new(LocalLlmConfig::new("/models/qwen2.5-7b-instruct.gguf"));
        assert_eq!(provider.model_stem(), "qwen2.5-7b-instruct");
        let provider = LlamaChatProvider::new(LocalLlmConfig::new(""));
        assert_eq!(provider.model_stem(), PROVIDER_ID);
    }

    #[tokio::test]
    async fn models_reports_single_local_model() {
        let provider = LlamaChatProvider::new(LocalLlmConfig::new("/models/My Model.gguf"));
        let models = provider.models().await.expect("models");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "My Model");
        assert_eq!(models[0].owned_by.as_deref(), Some("local"));
    }

    #[tokio::test]
    async fn stream_rejects_empty_model_path() {
        let provider = LlamaChatProvider::new(LocalLlmConfig::new(""));
        let request = ChatRequest::new(
            PROVIDER_ID,
            vec![ChatMessage {
                role: Role::User,
                content: "hi".to_string(),
                tool_call_id: None,
            }],
        );
        let err = match provider.stream(request).await {
            Ok(_) => panic!("empty model path must be rejected"),
            Err(err) => err,
        };
        assert!(matches!(err, LlmError::InvalidConfig(_)));
    }

    #[tokio::test]
    async fn stream_rejects_missing_file() {
        let provider =
            LlamaChatProvider::new(LocalLlmConfig::new("/definitely/does/not/exist/model.gguf"));
        let request = ChatRequest::new(
            PROVIDER_ID,
            vec![ChatMessage {
                role: Role::User,
                content: "hi".to_string(),
                tool_call_id: None,
            }],
        );
        let err = match provider.stream(request).await {
            Ok(_) => panic!("missing model file must be rejected"),
            Err(err) => err,
        };
        assert!(matches!(err, LlmError::InvalidConfig(_)));
    }

    /// Live inference smoke test. Requires a real GGUF at `LLAMA_TEST_MODEL`.
    /// Skipped (passes silently with a note on stderr) when the env var is
    /// unset; fails the test when the file is set but unusable.
    #[tokio::test]
    async fn live_generate_four_tokens_from_say_ok() {
        let Ok(model_path) = std::env::var("LLAMA_TEST_MODEL") else {
            eprintln!("LLAMA_TEST_MODEL not set; skipping live inference test");
            return;
        };
        let model_path = model_path.trim().to_string();
        if model_path.is_empty() {
            eprintln!("LLAMA_TEST_MODEL is empty; skipping live inference test");
            return;
        }
        let mut config = LocalLlmConfig::new(model_path);
        config.temperature = 0.0; // greedy — deterministic
        config.max_tokens = 4;
        let provider = LlamaChatProvider::new(config);
        let request = ChatRequest::new(
            PROVIDER_ID,
            vec![ChatMessage {
                role: Role::User,
                content: "Say 'ok':".to_string(),
                tool_call_id: None,
            }],
        );
        let mut stream = provider.stream(request).await.expect("stream opens");
        use futures_util::StreamExt;
        let mut text = String::new();
        let mut finish_reason = None;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.expect("chunk decodes");
            text.push_str(&chunk.delta);
            if chunk.finish_reason.is_some() {
                finish_reason = chunk.finish_reason;
            }
        }
        assert!(
            finish_reason.is_some(),
            "stream must terminate with a finish reason"
        );
        eprintln!("live inference generated {text:?}, finish={finish_reason:?}");
    }
}
