// SPDX-License-Identifier: GPL-3.0-or-later

//! Google Gemini (Google AI Studio) native API client (hand-rolled reqwest + SSE).
//!
//! Streaming: `POST {base}/models/{model}:streamGenerateContent?alt=sse` with
//! the key in the `x-goog-api-key` **header** (never the URL — reqwest transport
//! errors embed the URL and would leak the key). System prompts map to
//! `systemInstruction`; assistant messages become role `model`; tool results
//! become `user` text messages (function-response blocks are a later phase).
//!
//! Models: `GET {base}/models` returns `{ models: [{ name: "models/<id>", ... }] }`;
//! the `models/` prefix is stripped from the returned [`ModelInfo::id`].
//!
//! Each SSE `data:` payload carries `candidates[0].content.parts[].text` deltas;
//! `candidates[0].finishReason` (e.g. `"STOP"`) maps to [`crate::ChatChunk::finish_reason`]
//! verbatim. `error` payloads surface as [`crate::LlmError::Provider`].

use async_trait::async_trait;

use crate::common;
use crate::registry::{ProviderConfig, ProviderDef};
use crate::stream::sse_chat_stream;
use crate::types::{ChatChunk, ChatRequest, ModelInfo, Role};
use crate::{ChatProvider, ChatStream, LlmError};

/// Client for the Google Gemini native API.
pub struct GoogleGeminiClient {
    /// Provider def from the registry.
    pub def: ProviderDef,
    /// Provider config.
    pub config: ProviderConfig,
    http: reqwest::Client,
}

impl GoogleGeminiClient {
    /// Create a client for `def` using `config`.
    pub fn new(def: ProviderDef, config: ProviderConfig) -> Result<Self, LlmError> {
        let _ = common::effective_base_url(&def, &config)?;
        let _ = common::resolve_api_key(&def, &config)?;
        let http = common::http_client()?;
        Ok(Self { def, config, http })
    }

    fn base_url(&self) -> String {
        common::effective_base_url(&self.def, &self.config)
            .unwrap_or_else(|_| "https://generativelanguage.googleapis.com/v1beta".to_owned())
    }

    fn api_key(&self) -> Option<String> {
        self.config.api_key.clone().filter(|k| !k.trim().is_empty())
    }
}

#[async_trait]
impl ChatProvider for GoogleGeminiClient {
    fn id(&self) -> &str {
        self.def.id
    }

    async fn models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let key = self.api_key().ok_or_else(|| {
            LlmError::InvalidConfig("google-generative-ai: api_key is required".into())
        })?;
        let resp = self
            .http
            .get(format!("{}/models", self.base_url()))
            .header("x-goog-api-key", key)
            .send()
            .await
            .map_err(LlmError::Transport)?;
        if !resp.status().is_success() {
            return Err(common::provider_error(resp).await);
        }
        let body: serde_json::Value = resp.json().await.map_err(LlmError::Transport)?;
        let models = body
            .get("models")
            .and_then(|m| m.as_array())
            .ok_or_else(|| LlmError::Decode("models response missing `models` array".into()))?;
        Ok(models
            .iter()
            .filter_map(|m| {
                m.get("name")
                    .and_then(|n| n.as_str())
                    .map(|name| ModelInfo {
                        id: name.strip_prefix("models/").unwrap_or(name).to_owned(),
                        owned_by: None,
                    })
            })
            .collect())
    }

    async fn stream(&self, req: ChatRequest) -> Result<ChatStream, LlmError> {
        let key = self.api_key().ok_or_else(|| {
            LlmError::InvalidConfig("google-generative-ai: api_key is required".into())
        })?;

        let system = common::effective_system(&req);
        let mut contents = Vec::new();
        for m in common::non_system_messages(&req) {
            let role = match m.role {
                Role::Assistant => "model",
                // user, tool results (as text)
                _ => "user",
            };
            contents.push(serde_json::json!({
                "role": role,
                "parts": [{ "text": m.content }],
            }));
        }

        let mut body = serde_json::Map::new();
        body.insert("contents".into(), serde_json::Value::Array(contents));
        if let Some(system) = system {
            body.insert(
                "systemInstruction".into(),
                serde_json::json!({ "parts": [{ "text": system }] }),
            );
        }
        let mut gen_config = serde_json::Map::new();
        if let Some(t) = req.temperature {
            gen_config.insert("temperature".into(), t.into());
        }
        if let Some(n) = req.max_tokens {
            gen_config.insert("maxOutputTokens".into(), n.into());
        }
        if !gen_config.is_empty() {
            body.insert(
                "generationConfig".into(),
                serde_json::Value::Object(gen_config),
            );
        }
        if !req.tools.is_empty() {
            let mut decls = Vec::with_capacity(req.tools.len());
            for spec in &req.tools {
                let schema = common::parse_tool_schema(spec)?;
                decls.push(serde_json::json!({
                    "name": spec.name,
                    "description": spec.description,
                    "parameters": schema,
                }));
            }
            body.insert(
                "tools".into(),
                serde_json::json!([{ "functionDeclarations": decls }]),
            );
        }

        let model = req.model.trim_start_matches("models/").to_owned();
        let url = format!(
            "{}/models/{model}:streamGenerateContent?alt=sse",
            self.base_url()
        );
        let resp = self
            .http
            .post(url)
            .header("x-goog-api-key", key)
            .header("content-type", "application/json")
            .header("accept", "text/event-stream")
            .json(&serde_json::Value::Object(body))
            .send()
            .await
            .map_err(LlmError::Transport)?;

        if !resp.status().is_success() {
            return Err(common::provider_error(resp).await);
        }

        Ok(sse_chat_stream(
            resp,
            Box::new(|payload: &str| {
                let v: serde_json::Value =
                    serde_json::from_str(payload).map_err(|e| LlmError::Decode(e.to_string()))?;
                if let Some(err) = v.get("error") {
                    let msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("gemini stream error");
                    return Err(LlmError::Provider(msg.to_owned()));
                }
                let candidate = v
                    .get("candidates")
                    .and_then(|c| c.as_array())
                    .and_then(|a| a.first());
                let text: String = candidate
                    .and_then(|c| c.get("content"))
                    .and_then(|c| c.get("parts"))
                    .and_then(|p| p.as_array())
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                            .collect()
                    })
                    .unwrap_or_default();
                let finish = candidate
                    .and_then(|c| c.get("finishReason"))
                    .and_then(|f| f.as_str())
                    .map(str::to_owned);
                if text.is_empty() && finish.is_none() {
                    return Ok(None);
                }
                Ok(Some(ChatChunk {
                    delta: text,
                    finish_reason: finish,
                    reasoning: None,
                }))
            }),
        ))
    }
}
