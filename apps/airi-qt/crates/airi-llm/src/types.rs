// SPDX-License-Identifier: GPL-3.0-or-later

//! Shared typed request/response shapes for chat providers.

use serde::{Deserialize, Serialize};

/// Chat message role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// System message.
    System,
    /// User message.
    User,
    /// Assistant message.
    Assistant,
    /// Tool message.
    Tool,
}

impl Role {
    /// Wire representation used by OpenAI-compatible APIs.
    pub fn as_openai_str(self) -> &'static str {
        match self {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Tool => "tool",
        }
    }
}

/// Chat message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// Role.
    pub role: Role,
    /// Content.
    pub content: String,
    /// Optional tool call id (for [`Role::Tool`] messages).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

/// A tool the model may call, described by a serialized JSON Schema.
///
/// `parameters_schema` holds the tool's JSON Schema as a JSON *string*
/// (e.g. `{"type":"object","properties":{...}}`). Keeping it a string keeps raw
/// `serde_json::Value` out of the public API; it is parsed back into a value
/// only at the HTTP boundary when a request body is assembled.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSpec {
    /// Tool name (unique within a request).
    pub name: String,
    /// Human-readable tool description sent to the model.
    pub description: String,
    /// Serialized JSON Schema for the tool parameters.
    pub parameters_schema: String,
}

impl ToolSpec {
    /// Create a tool spec from a name, description, and serialized JSON Schema.
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters_schema: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            parameters_schema: parameters_schema.into(),
        }
    }
}

/// Chat request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    /// Model name.
    pub model: String,
    /// Messages.
    pub messages: Vec<ChatMessage>,
    /// Optional system prompt (also appendable as a [`Role::System`] message).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    /// Temperature.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    /// Max tokens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    /// Tools the model may call.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<ToolSpec>,
}

impl ChatRequest {
    /// Create a minimal request with no optional fields set.
    pub fn new(model: impl Into<String>, messages: Vec<ChatMessage>) -> Self {
        Self {
            model: model.into(),
            messages,
            system: None,
            temperature: None,
            max_tokens: None,
            tools: Vec::new(),
        }
    }
}

/// One streamed chunk of a chat completion.
///
/// `delta` carries incremental text (empty for control-only chunks).
/// `finish_reason` is set on the terminal chunk (`"stop"`, `"length"`,
/// `"tool_calls"`, ... — provider-native spelling) when known.
/// `reasoning` carries incremental reasoning/thinking tokens for providers
/// that expose them separately (e.g. `reasoning_content`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChatChunk {
    /// Incremental text delta (may be empty).
    pub delta: String,
    /// Provider-reported finish reason, set on the terminal chunk when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    /// Incremental reasoning delta, for providers with a separate reasoning channel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

impl ChatChunk {
    /// Text-only delta chunk.
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            delta: text.into(),
            finish_reason: None,
            reasoning: None,
        }
    }

    /// Reasoning-only delta chunk.
    pub fn reasoning(text: impl Into<String>) -> Self {
        Self {
            delta: String::new(),
            finish_reason: None,
            reasoning: Some(text.into()),
        }
    }

    /// Terminal chunk carrying a finish reason.
    pub fn finish(reason: impl Into<String>) -> Self {
        Self {
            delta: String::new(),
            finish_reason: Some(reason.into()),
            reasoning: None,
        }
    }
}

/// Model descriptor returned by a provider's model list endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    /// Model identifier (as the provider expects it back in requests).
    pub id: String,
    /// Owning organization, when the provider reports one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owned_by: Option<String>,
}
