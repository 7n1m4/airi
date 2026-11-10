// SPDX-License-Identifier: GPL-3.0-or-later

//! Internal helpers shared by the client implementations.

use crate::registry::{ProviderConfig, ProviderDef};
use crate::types::{ChatMessage, ChatRequest, Role, ToolSpec};
use crate::LlmError;

/// Resolve the effective base URL: config override, then the registry default.
/// Returns an error if neither is set (e.g. the `openai-compatible` entry).
pub(crate) fn effective_base_url(
    def: &ProviderDef,
    config: &ProviderConfig,
) -> Result<String, LlmError> {
    config
        .base_url
        .clone()
        .or_else(|| def.base_url.map(str::to_owned))
        .filter(|u| !u.trim().is_empty())
        .map(|u| u.trim_end_matches('/').to_owned())
        .ok_or_else(|| LlmError::InvalidConfig(format!("{}: base_url is required", def.id)))
}

/// API key for providers whose credential schema requires one.
///
/// `Ok(None)` when the provider is keyless (Ollama, LM Studio, Pollinations).
pub(crate) fn resolve_api_key(
    def: &ProviderDef,
    config: &ProviderConfig,
) -> Result<Option<String>, LlmError> {
    let key = config.api_key.clone().filter(|k| !k.trim().is_empty());
    if key.is_none() && def.credential.requires_api_key() {
        return Err(LlmError::InvalidConfig(format!(
            "{}: api_key is required",
            def.id
        )));
    }
    Ok(key)
}

/// Build the HTTP client. No total timeout (streams are unbounded); a connect
/// timeout catches dead endpoints early.
pub(crate) fn http_client() -> Result<reqwest::Client, LlmError> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(LlmError::Transport)
}

/// Parse a tool's serialized JSON Schema at the HTTP boundary.
pub(crate) fn parse_tool_schema(spec: &ToolSpec) -> Result<serde_json::Value, LlmError> {
    serde_json::from_str(&spec.parameters_schema).map_err(|e| {
        LlmError::InvalidConfig(format!(
            "tool `{}`: parameters_schema is not valid JSON: {e}",
            spec.name
        ))
    })
}

/// Extract the effective system prompt: explicit `req.system` wins, otherwise
/// any leading (or interleaved) system messages are joined.
pub(crate) fn effective_system(req: &ChatRequest) -> Option<String> {
    if let Some(s) = &req.system {
        if !s.trim().is_empty() {
            return Some(s.clone());
        }
    }
    let joined: Vec<&str> = req
        .messages
        .iter()
        .filter(|m| m.role == Role::System)
        .map(|m| m.content.as_str())
        .collect();
    if joined.is_empty() {
        None
    } else {
        Some(joined.join("\n\n"))
    }
}

/// Messages with system entries removed (for APIs with a dedicated system field).
pub(crate) fn non_system_messages(req: &ChatRequest) -> Vec<&ChatMessage> {
    req.messages
        .iter()
        .filter(|m| m.role != Role::System)
        .collect()
}

/// Serialize messages for OpenAI-wire payloads, prepending the effective system
/// prompt as a leading system message when present.
pub(crate) fn openai_messages(req: &ChatRequest) -> Vec<serde_json::Value> {
    let mut out = Vec::with_capacity(req.messages.len() + 1);
    if let Some(system) = effective_system(req) {
        if !req.messages.iter().any(|m| m.role == Role::System) {
            out.push(serde_json::json!({ "role": "system", "content": system }));
        }
    }
    for m in &req.messages {
        let mut obj = serde_json::Map::new();
        obj.insert("role".into(), m.role.as_openai_str().into());
        obj.insert("content".into(), m.content.clone().into());
        if let Some(id) = &m.tool_call_id {
            obj.insert("tool_call_id".into(), id.clone().into());
        }
        out.push(serde_json::Value::Object(obj));
    }
    out
}

/// OpenAI-wire `tools` array.
pub(crate) fn openai_tools(req: &ChatRequest) -> Result<Option<serde_json::Value>, LlmError> {
    if req.tools.is_empty() {
        return Ok(None);
    }
    let mut tools = Vec::with_capacity(req.tools.len());
    for spec in &req.tools {
        let schema = parse_tool_schema(spec)?;
        tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": schema,
            }
        }));
    }
    Ok(Some(serde_json::Value::Array(tools)))
}

/// Read the error body of a non-success response and shape it into [`LlmError::Provider`].
pub(crate) async fn provider_error(resp: reqwest::Response) -> LlmError {
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    // Never leak a full key; providers echo the request sparingly, but truncate defensively.
    let truncated: String = text.chars().take(512).collect();
    LlmError::Provider(format!("HTTP {status}: {truncated}"))
}
