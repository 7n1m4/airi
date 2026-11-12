// SPDX-License-Identifier: GPL-3.0-or-later

//! Anthropic Messages API client (hand-rolled reqwest + SSE).
//!
//! `POST {base}/messages` with `anthropic-version: 2023-06-01` and `x-api-key`.
//! Auth uses headers only — the key never appears in URLs. The API takes
//! `system` as a top-level field (not a message) and requires `max_tokens`;
//! both are normalized here from [`crate::ChatRequest`].
//!
//! Streaming frames are SSE `event: <type>` + `data: <json>`; only `data:`
//! lines are consumed. `content_block_delta` (`text_delta`) yields text chunks;
//! `message_delta` carries `stop_reason`; `message_stop` terminates; `error`
//! frames surface as [`crate::LlmError::Provider`]. `input_json_delta`
//! (incremental tool-call arguments) is intentionally skipped — tool-call
//! streaming lands in a later phase.

use async_trait::async_trait;

use crate::common;
use crate::registry::{ProviderConfig, ProviderDef};
use crate::stream::sse_chat_stream;
use crate::types::{ChatChunk, ChatRequest, ModelInfo, Role};
use crate::{ChatProvider, ChatStream, LlmError};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// Client for the Anthropic Messages API.
pub struct AnthropicClient {
    /// Provider def from the registry.
    pub def: ProviderDef,
    /// Provider config.
    pub config: ProviderConfig,
    http: reqwest::Client,
}

impl AnthropicClient {
    /// Create a client for `def` using `config`.
    pub fn new(def: ProviderDef, config: ProviderConfig) -> Result<Self, LlmError> {
        let _ = common::effective_base_url(&def, &config)?;
        let _ = common::resolve_api_key(&def, &config)?; // anthropic schema requires api_key
        let http = common::http_client()?;
        Ok(Self { def, config, http })
    }

    fn base_url(&self) -> String {
        common::effective_base_url(&self.def, &self.config)
            .unwrap_or_else(|_| "https://api.anthropic.com/v1".to_owned())
    }

    fn api_key(&self) -> Option<String> {
        self.config.api_key.clone().filter(|k| !k.trim().is_empty())
    }
}

#[async_trait]
impl ChatProvider for AnthropicClient {
    fn id(&self) -> &str {
        self.def.id
    }

    async fn models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let key = self
            .api_key()
            .ok_or_else(|| LlmError::InvalidConfig("anthropic: api_key is required".into()))?;
        let resp = self
            .http
            .get(format!("{}/models", self.base_url()))
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .send()
            .await
            .map_err(LlmError::Transport)?;
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
                    owned_by: None,
                })
            })
            .collect())
    }

    async fn stream(&self, req: ChatRequest) -> Result<ChatStream, LlmError> {
        let key = self
            .api_key()
            .ok_or_else(|| LlmError::InvalidConfig("anthropic: api_key is required".into()))?;

        // Anthropic: system is a top-level field; messages are user/assistant only.
        let system = common::effective_system(&req);
        let mut messages = Vec::new();
        for m in common::non_system_messages(&req) {
            match m.role {
                Role::Tool => {
                    // Map tool results to Anthropic's tool_result content blocks.
                    let tool_use_id = m.tool_call_id.clone().unwrap_or_default();
                    messages.push(serde_json::json!({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": m.content,
                        }],
                    }));
                }
                role => {
                    messages.push(serde_json::json!({
                        "role": role.as_openai_str(), // "user" | "assistant"
                        "content": m.content,
                    }));
                }
            }
        }

        let mut body = serde_json::Map::new();
        body.insert("model".into(), req.model.clone().into());
        body.insert(
            "max_tokens".into(),
            req.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS).into(),
        );
        body.insert("messages".into(), serde_json::Value::Array(messages));
        body.insert("stream".into(), true.into());
        if let Some(system) = system {
            body.insert("system".into(), system.into());
        }
        if let Some(t) = req.temperature {
            body.insert("temperature".into(), t.into());
        }
        if !req.tools.is_empty() {
            let mut tools = Vec::with_capacity(req.tools.len());
            for spec in &req.tools {
                let schema = common::parse_tool_schema(spec)?;
                tools.push(serde_json::json!({
                    "name": spec.name,
                    "description": spec.description,
                    "input_schema": schema,
                }));
            }
            body.insert("tools".into(), serde_json::Value::Array(tools));
        }

        let resp = self
            .http
            .post(format!("{}/messages", self.base_url()))
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION)
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
                match v.get("type").and_then(|t| t.as_str()) {
                    Some("content_block_delta") => {
                        let delta = &v["delta"];
                        match delta.get("type").and_then(|t| t.as_str()) {
                            Some("text_delta") => Ok(Some(ChatChunk::text(
                                delta.get("text").and_then(|t| t.as_str()).unwrap_or(""),
                            ))),
                            // input_json_delta: tool-call argument streaming — later phase.
                            _ => Ok(None),
                        }
                    }
                    Some("message_delta") => {
                        let reason = v["delta"]
                            .get("stop_reason")
                            .and_then(|r| r.as_str())
                            .map(str::to_owned);
                        Ok(reason.map(ChatChunk::finish))
                    }
                    Some("error") => {
                        let msg = v["error"]
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("anthropic stream error")
                            .to_owned();
                        Err(LlmError::Provider(msg))
                    }
                    // message_start / content_block_start / content_block_stop /
                    // message_stop / ping — no user-visible payload.
                    _ => Ok(None),
                }
            }),
        ))
    }
}
