// SPDX-License-Identifier: GPL-3.0-or-later

//! OpenAI-compatible client (hand-rolled reqwest + SSE).
//!
//! Covers `POST {base}/chat/completions` with `stream: true` and
//! `GET {base}/models`. `data: [DONE]` terminates the stream. Both
//! `delta.content` and `delta.reasoning_content` (DeepSeek-style) are surfaced.
//!
//! Why not `async-openai`: its typed request builder is rigid about provider
//! quirks (non-standard delta fields, `[DONE]` sentinel, custom base URLs with
//! path prefixes) and buys nothing over ~150 lines of reqwest here. Hand-rolling
//! keeps every OpenAI-compatible provider a config row, per the crate design.

use async_trait::async_trait;

use crate::common;
use crate::registry::{ProviderConfig, ProviderDef};
use crate::stream::sse_chat_stream;
use crate::types::{ChatChunk, ChatRequest, ModelInfo};
use crate::{ChatProvider, ChatStream, LlmError};

/// Client for OpenAI-compatible HTTP APIs.
pub struct OpenAiCompatibleClient {
    /// Provider def from the registry.
    pub def: ProviderDef,
    /// Provider config.
    pub config: ProviderConfig,
    http: reqwest::Client,
}

impl OpenAiCompatibleClient {
    /// Create a client for `def` using `config`.
    pub fn new(def: ProviderDef, config: ProviderConfig) -> Result<Self, LlmError> {
        // Validate eagerly: base_url and (if required) api_key.
        let _ = common::effective_base_url(&def, &config)?;
        let _ = common::resolve_api_key(&def, &config)?;
        let http = common::http_client()?;
        Ok(Self { def, config, http })
    }

    fn base_url(&self) -> String {
        // Validated in `new`; fall back rather than panic.
        common::effective_base_url(&self.def, &self.config)
            .unwrap_or_else(|_| "http://127.0.0.1:1234/v1".to_owned())
    }

    fn api_key(&self) -> Option<String> {
        self.config.api_key.clone().filter(|k| !k.trim().is_empty())
    }
}

#[async_trait]
impl ChatProvider for OpenAiCompatibleClient {
    fn id(&self) -> &str {
        self.def.id
    }

    async fn models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let mut req = self.http.get(format!("{}/models", self.base_url()));
        if let Some(key) = self.api_key() {
            req = req.bearer_auth(key);
        }
        let resp = req.send().await.map_err(LlmError::Transport)?;
        if !resp.status().is_success() {
            return Err(common::provider_error(resp).await);
        }
        let body: serde_json::Value = resp.json().await.map_err(LlmError::Transport)?;
        let data = body
            .get("data")
            .and_then(|d| d.as_array())
            .ok_or_else(|| LlmError::Decode("models response missing `data` array".into()))?;
        Ok(data
            .iter()
            .filter_map(|m| {
                m.get("id").and_then(|id| id.as_str()).map(|id| ModelInfo {
                    id: id.to_owned(),
                    owned_by: m
                        .get("owned_by")
                        .and_then(|o| o.as_str())
                        .map(str::to_owned),
                })
            })
            .collect())
    }

    async fn stream(&self, req: ChatRequest) -> Result<ChatStream, LlmError> {
        let base = self.base_url();
        let mut body = serde_json::Map::new();
        body.insert("model".into(), req.model.clone().into());
        body.insert(
            "messages".into(),
            serde_json::Value::Array(common::openai_messages(&req)),
        );
        body.insert("stream".into(), true.into());
        if let Some(t) = req.temperature {
            body.insert("temperature".into(), t.into());
        }
        if let Some(n) = req.max_tokens {
            body.insert("max_tokens".into(), n.into());
        }
        if let Some(tools) = common::openai_tools(&req)? {
            body.insert("tools".into(), tools);
        }

        let mut http_req = self.http.post(format!("{base}/chat/completions"));
        if let Some(key) = self.api_key() {
            http_req = http_req.bearer_auth(key);
        }
        let resp = http_req
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
                        .unwrap_or("provider error");
                    return Err(LlmError::Provider(msg.to_owned()));
                }
                let Some(choice) = v
                    .get("choices")
                    .and_then(|c| c.as_array())
                    .and_then(|a| a.first())
                else {
                    return Ok(None);
                };
                let finish = choice
                    .get("finish_reason")
                    .and_then(|f| f.as_str())
                    .map(str::to_owned);
                let delta = choice.get("delta");
                let content = delta
                    .and_then(|d| d.get("content"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                let reasoning = delta
                    .and_then(|d| d.get("reasoning_content"))
                    .and_then(|c| c.as_str())
                    .map(str::to_owned);
                if content.is_empty() && reasoning.is_none() && finish.is_none() {
                    return Ok(None);
                }
                Ok(Some(ChatChunk {
                    delta: content.to_owned(),
                    finish_reason: finish,
                    reasoning,
                }))
            }),
        ))
    }
}
