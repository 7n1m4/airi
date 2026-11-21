// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! AIRi LLM provider registry, config, and streaming chat clients.
//!
//! - [`ProviderRegistry`] / [`PROVIDER_DEFS`]: static data-driven registry of the
//!   44 provider ids from `docs/port-manifest/providers.md` plus the port-native
//!   `llama-cpp-local` row (45 total). OpenAI-compatible
//! - [`ChatProvider`]: the canonical client trait (`id` / `models` / `stream`).
//! - [`ChatClient`]: compat trait exposing `stream_chat` (used by `airi-core`),
//!   blanket-implemented for every [`ChatProvider`].
//! - [`build_client`]: constructs the right client for a [`ProviderDef`].
//!
//! Layering: no toolkit, no `airi-store`, no `airi-core`, no `airi-i18n` — only
//! tokio-compatible async deps and `reqwest`. JSON appears only at the HTTP and
//! config boundaries; public APIs use typed structs.
//!
//! Streaming wire strategy is hand-rolled `reqwest` + an incremental SSE parser
//! for all providers (see `client_openai` for the rationale). `data: [DONE]`
//! terminates OpenAI streams; Anthropic `message_stop` and Gemini end-of-body
//! terminate theirs.

use std::pin::Pin;
use std::sync::Arc;

use futures_util::Stream;
use thiserror::Error;

mod client_anthropic;
mod client_gemini;
mod client_openai;
mod client_stub;
mod common;
mod registry;
mod sse;
mod stream;
mod types;

pub use client_anthropic::AnthropicClient;
pub use client_gemini::GoogleGeminiClient;
pub use client_openai::OpenAiCompatibleClient;
pub use client_stub::UnsupportedChatClient;
pub use registry::{
    CompatFlags, CredentialField, CredentialSchema, ProviderConfig, ProviderDef, ProviderKind,
    ProviderRegistry, PROVIDER_DEFS,
};
pub use types::{ChatChunk, ChatMessage, ChatRequest, ModelInfo, Role, ToolSpec};

/// Alias mapping the plan's `ProviderError` name onto [`LlmError`].
pub type ProviderError = LlmError;

/// Chat stream type: a boxed stream of typed chunks.
pub type ChatStream = Pin<Box<dyn Stream<Item = Result<ChatChunk, LlmError>> + Send>>;

/// LLM error.
#[derive(Debug, Error)]
pub enum LlmError {
    /// I/O or transport failure.
    #[error("transport error: {0}")]
    Transport(#[from] reqwest::Error),
    /// Invalid provider config.
    #[error("invalid config: {0}")]
    InvalidConfig(String),
    /// Unsupported provider (stubbed or not wired yet).
    #[error("unsupported provider: {0}")]
    UnsupportedProvider(String),
    /// Provider returned error payload.
    #[error("provider error: {0}")]
    Provider(String),
    /// Streaming decode error.
    #[error("decode error: {0}")]
    Decode(String),
}

/// Canonical streaming chat provider trait.
#[async_trait::async_trait]
pub trait ChatProvider: Send + Sync {
    /// Provider id from the registry.
    fn id(&self) -> &str;

    /// List models offered by the provider.
    async fn models(&self) -> Result<Vec<ModelInfo>, ProviderError>;

    /// Open a streaming chat completion.
    async fn stream(&self, req: ChatRequest) -> Result<ChatStream, ProviderError>;
}

/// Compat trait with the P0 `stream_chat` method name (used by `airi-core`).
///
/// Supertrait of [`ChatProvider`], so `Arc<dyn ChatClient>` also exposes
/// `id` / `models` / `stream`. Blanket-implemented for every [`ChatProvider`];
/// new code should use [`ChatProvider`] directly.
#[async_trait::async_trait]
pub trait ChatClient: ChatProvider {
    /// Stream a chat completion.
    async fn stream_chat(&self, req: ChatRequest) -> Result<ChatStream, LlmError> {
        self.stream(req).await
    }
}

#[async_trait::async_trait]
impl<T: ChatProvider> ChatClient for T {}

/// Build a provider client from a registry def and stored config.
///
/// Routing:
/// - `compat.chat == false` (Bedrock, on-device engines, TypeSafe) →
///   [`UnsupportedChatClient`] stub that reports
///   [`LlmError::UnsupportedProvider`] from `models()`/`stream()`.
/// - [`ProviderKind::OpenAiCompatible`] / [`ProviderKind::LocalServer`] →
///   [`OpenAiCompatibleClient`].
/// - [`ProviderKind::Anthropic`] → [`AnthropicClient`].
/// - [`ProviderKind::GoogleGemini`] → [`GoogleGeminiClient`].
/// - [`ProviderKind::AwsBedrock`] → [`UnsupportedChatClient`] (SigV4 not wired yet).
///
/// Fails with [`LlmError::InvalidConfig`] when required config is missing
/// (e.g. `api_key` for hosted providers, `base_url` for `openai-compatible`).
pub fn build_client(
    def: &ProviderDef,
    config: ProviderConfig,
) -> Result<Arc<dyn ChatClient>, LlmError> {
    if !def.compat.chat {
        return Ok(Arc::new(UnsupportedChatClient::new(def)));
    }
    match def.kind {
        ProviderKind::OpenAiCompatible | ProviderKind::LocalServer => {
            Ok(Arc::new(OpenAiCompatibleClient::new(*def, config)?))
        }
        ProviderKind::Anthropic => Ok(Arc::new(AnthropicClient::new(*def, config)?)),
        ProviderKind::GoogleGemini => Ok(Arc::new(GoogleGeminiClient::new(*def, config)?)),
        ProviderKind::AwsBedrock => Ok(Arc::new(UnsupportedChatClient::new(def))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_has_exactly_45_unique_providers() {
        let reg = ProviderRegistry::new();
        assert_eq!(reg.len(), 45);
        assert_eq!(reg.all().len(), 45);
        let mut ids: Vec<&str> = reg.ids().collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 45);
    }

    #[test]
    fn registry_manifest_ids_present() {
        let reg = ProviderRegistry::new();
        for id in [
            "302-ai",
            "aihubmix",
            "alibaba-cloud",
            "amazon-bedrock",
            "anthropic",
            "atlascloud",
            "azure-ai-foundry",
            "azure-openai",
            "byteplus",
            "byteplus-coding-plan",
            "cerebras-ai",
            "cloudflare-workers-ai",
            "comet-api",
            "deepseek",
            "featherless-ai",
            "fireworks-ai",
            "google-generative-ai",
            "groq",
            "kilo",
            "laya-local",
            "lm-studio",
            "mimo",
            "minimax",
            "mistral-ai",
            "modelscope",
            "moonshot-ai",
            "n1n",
            "novita-ai",
            "nvidia",
            "ollama",
            "openai",
            "openai-compatible",
            "opencode-go",
            "openjev-local",
            "openpaths",
            "openrouter-ai",
            "opper",
            "perplexity-ai",
            "pollinations",
            "together-ai",
            "typesafe-ai",
            "volcengine-coding-plan",
            "xai",
            "zai",
        ] {
            assert!(reg.get(id).is_some(), "missing provider id: {id}");
        }
    }

    #[test]
    fn every_chat_provider_with_default_base_url_builds() {
        let reg = ProviderRegistry::new();
        for def in reg.all() {
            if !def.compat.chat || def.base_url.is_none() {
                continue;
            }
            let cfg = ProviderConfig {
                api_key: Some("sk-test".into()),
                base_url: None,
                model: Some("test-model".into()),
                extra_json: serde_json::Map::new(),
            };
            let client = build_client(def, cfg);
            assert!(
                client.is_ok(),
                "build_client failed for {}: {:?}",
                def.id,
                client.err()
            );
        }
    }

    #[test]
    fn build_openai_compatible_client() {
        let reg = ProviderRegistry::new();
        let def = reg.get("openai-compatible").unwrap();
        let client = build_client(
            def,
            ProviderConfig {
                api_key: Some("sk-test".into()),
                base_url: Some("http://127.0.0.1:1234/v1".into()),
                model: Some("local-model".into()),
                extra_json: serde_json::Map::new(),
            },
        )
        .unwrap();
        assert_eq!(client.id(), "openai-compatible");
    }

    #[test]
    fn missing_api_key_is_invalid_config() {
        let reg = ProviderRegistry::new();
        let def = reg.get("openai").unwrap();
        let err = match build_client(def, ProviderConfig::default()) {
            Ok(_) => panic!("expected InvalidConfig for missing api_key"),
            Err(e) => e,
        };
        assert!(matches!(err, LlmError::InvalidConfig(_)));
    }

    #[test]
    fn non_chat_providers_build_a_stub() {
        let reg = ProviderRegistry::new();
        for id in [
            "amazon-bedrock",
            "laya-local",
            "openjev-local",
            "typesafe-ai",
        ] {
            let def = reg.get(id).unwrap();
            // Stub builds fine; failures surface at call time.
            let client = build_client(def, ProviderConfig::default()).unwrap();
            assert_eq!(client.id(), id);
        }
    }

    #[test]
    fn compat_chat_client_trait_object() {
        // airi-core consumes Arc<dyn ChatClient>; ensure the blanket impl works.
        let reg = ProviderRegistry::new();
        let def = reg.get("ollama").unwrap();
        let compat: Arc<dyn ChatClient> =
            Arc::new(OpenAiCompatibleClient::new(*def, ProviderConfig::default()).unwrap());
        let _ = compat;
    }
}
