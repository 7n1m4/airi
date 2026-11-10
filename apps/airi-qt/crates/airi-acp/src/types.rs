// SPDX-License-Identifier: GPL-3.0-or-later

//! Public value types exchanged with an ACP agent.
//!
//! These mirror the stable v1 schema in `@agentclientprotocol/sdk`
//! (`schema/v1/schema.json`, types in `dist/v1/schema/types.gen.d.ts`).
//! Parsing is deliberately lenient: unknown update kinds and unknown enum
//! values are preserved verbatim instead of failing the whole parse, because
//! agents in the wild ship ahead of the schema.

use std::fmt;

use serde_json::Value;

/// ACP protocol version this client sends in `initialize` (`PROTOCOL_VERSION`
/// in the SDK schema).
pub const ACP_PROTOCOL_VERSION: u64 = 1;

/// Identity of the client sent in the `initialize` handshake.
pub const CLIENT_NAME: &str = "airi-acp";

/// Default per-request timeout for short RPCs (`initialize`, `session/new`,
/// `session/close`, …). The Electron implementation relied on the SDK's
/// defaults (no explicit timeout — waits forever); this client bounds short
/// RPCs instead. Override with [`crate::AcpAgentClient::set_timeout`].
pub const DEFAULT_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Default timeout for a `session/prompt` turn. Prompt turns run an LLM and
/// can take minutes; the Electron implementation waited indefinitely. This
/// client bounds a turn to 5 minutes by default.
/// Override with [`crate::AcpAgentClient::set_prompt_timeout`].
pub const DEFAULT_PROMPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// A session identifier as returned by `session/new`.
///
/// Wire format is a plain JSON string; this alias keeps the public API
/// self-describing.
pub type SessionId = String;

/// Permission policy applied when the agent sends `session/request_permission`.
///
/// Mirrors the Electron `permissionPolicy` setting (`prompt` / `auto-read` /
/// `auto-all`), with one deliberate reinterpretation: the Electron `auto-read`
/// branch never actually inspected the tool call (it allowed anything, like
/// `auto-all`). This crate implements the documented intent — see the phase
/// note (`docs/phase-notes/p9-lane-acp-agents.md`) for the exact heuristic.
/// The `prompt` policy cannot ask a human from inside this crate, so it
/// always selects the reject-style option (also a behaviour change from
/// Electron, which round-tripped to the renderer).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PermissionPolicy {
    /// Reject the permission request. The `prompt` wire behaviour is "ask the
    /// user"; this crate has no UI, so it fails closed (selects the first
    /// `reject_*` option, or the last option when no reject option exists).
    #[default]
    Prompt,
    /// Allow only read-like tool calls; everything else is rejected. A tool
    /// call is read-like when its `kind` is `read` or its `title` contains
    /// `read` (case-insensitive).
    AutoRead,
    /// Allow every permission request (first `allow_*` option wins, falling
    /// back to the first option when the agent offers none).
    AutoAll,
}

impl PermissionPolicy {
    /// Lowercase string form matching the Electron config values.
    pub fn as_str(&self) -> &'static str {
        match self {
            PermissionPolicy::Prompt => "prompt",
            PermissionPolicy::AutoRead => "auto-read",
            PermissionPolicy::AutoAll => "auto-all",
        }
    }
}

impl fmt::Display for PermissionPolicy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Why the agent stopped processing a prompt turn (`StopReason` in the schema).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    /// The agent finished naturally (`end_turn`).
    EndTurn,
    /// The agent hit the model's token limit (`max_tokens`).
    MaxTokens,
    /// The agent hit its internal cap on turn requests (`max_turn_requests`).
    MaxTurnRequests,
    /// The agent refused to continue (`refusal`).
    Refusal,
    /// The turn was cancelled by the client (`cancelled`).
    Cancelled,
    /// A stop reason added by a newer protocol revision, preserved verbatim.
    Other(String),
}

impl StopReason {
    /// The wire string for this stop reason.
    pub fn as_str(&self) -> &str {
        match self {
            StopReason::EndTurn => "end_turn",
            StopReason::MaxTokens => "max_tokens",
            StopReason::MaxTurnRequests => "max_turn_requests",
            StopReason::Refusal => "refusal",
            StopReason::Cancelled => "cancelled",
            StopReason::Other(s) => s.as_str(),
        }
    }

    pub(crate) fn from_wire(value: &str) -> Self {
        match value {
            "end_turn" => StopReason::EndTurn,
            "max_tokens" => StopReason::MaxTokens,
            "max_turn_requests" => StopReason::MaxTurnRequests,
            "refusal" => StopReason::Refusal,
            "cancelled" => StopReason::Cancelled,
            other => StopReason::Other(other.to_string()),
        }
    }
}

impl fmt::Display for StopReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Categories of tools an agent may invoke (`ToolKind` in the schema).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    /// Read-only file/resource access.
    Read,
    /// File modification.
    Edit,
    /// File deletion.
    Delete,
    /// File/directory move.
    Move,
    /// Search operations.
    Search,
    /// Command execution.
    Execute,
    /// Internal reasoning.
    Think,
    /// Network fetch.
    Fetch,
    /// Mode switch.
    SwitchMode,
    /// Any kind added by a newer protocol revision.
    #[serde(other)]
    Other,
}

impl ToolKind {
    /// The wire string for this kind.
    pub fn as_str(&self) -> &'static str {
        match self {
            ToolKind::Read => "read",
            ToolKind::Edit => "edit",
            ToolKind::Delete => "delete",
            ToolKind::Move => "move",
            ToolKind::Search => "search",
            ToolKind::Execute => "execute",
            ToolKind::Think => "think",
            ToolKind::Fetch => "fetch",
            ToolKind::SwitchMode => "switch_mode",
            ToolKind::Other => "other",
        }
    }
}

/// Execution status of a tool call (`ToolCallStatus` in the schema).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    /// Queued, not started.
    Pending,
    /// Currently executing.
    InProgress,
    /// Finished successfully.
    Completed,
    /// Finished with an error.
    Failed,
    /// Any status added by a newer protocol revision.
    #[serde(other)]
    Other,
}

/// A content block from the agent (`ContentBlock` in the schema).
///
/// Only text blocks are modelled structurally (they carry the LLM output the
/// AIRI UI renders); every other block type is preserved verbatim so nothing
/// the agent sent is dropped silently.
#[derive(Debug, Clone, PartialEq)]
pub enum ContentBlock {
    /// A `{ "type": "text", "text": … }` block.
    Text {
        /// The text payload.
        text: String,
    },
    /// Any other block type (`image`, `audio`, `resource`, `resource_link`, …).
    Other {
        /// The value of the block's `type` field, or `"unknown"` when absent.
        block_type: String,
        /// The full content block object.
        raw: Value,
    },
}

impl ContentBlock {
    pub(crate) fn from_value(value: &Value) -> Self {
        let block_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        if block_type == "text" {
            return ContentBlock::Text {
                text: value
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            };
        }
        ContentBlock::Other {
            block_type: block_type.to_string(),
            raw: value.clone(),
        }
    }
}

/// A streamed chunk of content (`ContentChunk` in the schema).
#[derive(Debug, Clone, PartialEq)]
pub struct ContentChunk {
    /// The content block carried by this chunk.
    pub content: ContentBlock,
    /// Identifier of the message this chunk belongs to (`messageId` in the
    /// schema). All chunks of one message share it.
    pub message_id: Option<String>,
}

/// A tool call reported by the agent (`ToolCall` in the schema).
///
/// `content` is kept as raw JSON blocks; everything else is typed. Unknown
/// fields are ignored rather than rejected.
#[derive(Debug, Clone, PartialEq, Default, serde::Deserialize)]
#[serde(default)]
pub struct ToolCall {
    /// Unique identifier of the tool call within the session (`toolCallId`).
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    /// Human-readable title of what the tool is doing.
    pub title: String,
    /// Programmatic name of the tool, when the agent provides one.
    pub name: Option<String>,
    /// The category of tool being invoked.
    pub kind: Option<ToolKind>,
    /// Current execution status.
    pub status: Option<ToolCallStatus>,
    /// Content produced by the tool call, kept verbatim.
    pub content: Vec<Value>,
    /// Raw input parameters sent to the tool, verbatim.
    #[serde(rename = "rawInput")]
    pub raw_input: Option<Value>,
    /// Raw output returned by the tool, verbatim.
    #[serde(rename = "rawOutput")]
    pub raw_output: Option<Value>,
}

/// An update to an existing tool call (`ToolCallUpdate` in the schema).
///
/// All fields except `tool_call_id` are optional; only changed fields are sent.
#[derive(Debug, Clone, PartialEq, Default, serde::Deserialize)]
#[serde(default)]
pub struct ToolCallUpdate {
    /// The id of the tool call being updated (`toolCallId`).
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    /// Updated execution status, when changed.
    pub status: Option<ToolCallStatus>,
    /// Updated human-readable title, when changed.
    pub title: Option<String>,
    /// Programmatic name of the tool, when changed.
    pub name: Option<String>,
    /// Updated tool kind, when changed.
    pub kind: Option<ToolKind>,
    /// Replacement content collection, when changed.
    pub content: Option<Vec<Value>>,
    /// Raw input parameters, when changed.
    #[serde(rename = "rawInput")]
    pub raw_input: Option<Value>,
    /// Raw output parameters, when changed.
    #[serde(rename = "rawOutput")]
    pub raw_output: Option<Value>,
}

/// One update from a `session/update` notification (`SessionUpdate` in the
/// schema).
#[derive(Debug, Clone, PartialEq)]
pub enum SessionUpdate {
    /// A chunk of the user's own message, echoed by the agent
    /// (`user_message_chunk`).
    UserMessageChunk(ContentChunk),
    /// A chunk of the agent's reply (`agent_message_chunk`).
    AgentMessageChunk(ContentChunk),
    /// A chunk of the agent's reasoning (`agent_thought_chunk`).
    AgentThoughtChunk(ContentChunk),
    /// The agent started a tool call (`tool_call`).
    ToolCall(ToolCall),
    /// An existing tool call changed status/title/content
    /// (`tool_call_update`).
    ToolCallUpdate(ToolCallUpdate),
    /// The agent updated its task plan (`plan`). Kept as raw JSON — the plan
    /// schema is still churning and AIRI does not render plans yet.
    Plan(Value),
    /// Any update kind added by a newer protocol revision, preserved verbatim.
    Other {
        /// The value of the update's `sessionUpdate` field.
        update: String,
        /// The full update object.
        raw: Value,
    },
}

impl SessionUpdate {
    /// The `sessionUpdate` wire tag for this update.
    pub fn update_kind(&self) -> &str {
        match self {
            SessionUpdate::UserMessageChunk(_) => "user_message_chunk",
            SessionUpdate::AgentMessageChunk(_) => "agent_message_chunk",
            SessionUpdate::AgentThoughtChunk(_) => "agent_thought_chunk",
            SessionUpdate::ToolCall(_) => "tool_call",
            SessionUpdate::ToolCallUpdate(_) => "tool_call_update",
            SessionUpdate::Plan(_) => "plan",
            SessionUpdate::Other { update, .. } => update.as_str(),
        }
    }

    /// Text payload when this update is an agent message chunk, else `None`.
    pub fn agent_text(&self) -> Option<&str> {
        match self {
            SessionUpdate::AgentMessageChunk(chunk) => match &chunk.content {
                ContentBlock::Text { text } => Some(text.as_str()),
                ContentBlock::Other { .. } => None,
            },
            _ => None,
        }
    }
}

/// Result of a completed `session/prompt` turn.
#[derive(Debug, Clone, PartialEq)]
pub struct PromptResult {
    /// The session the prompt was sent to.
    pub session_id: SessionId,
    /// Why the agent stopped (`stopReason` in the prompt response).
    pub stop_reason: StopReason,
    /// Concatenated text of all `agent_message_chunk` updates in the turn.
    pub final_text: String,
    /// All `session/update` notifications received during the turn, in wire
    /// order.
    pub updates: Vec<SessionUpdate>,
}

/// Identity block from the `initialize` response (`Implementation` in the
/// schema).
#[derive(Debug, Clone, PartialEq)]
pub struct Implementation {
    /// Programmatic name of the agent.
    pub name: String,
    /// Human-readable title, when provided.
    pub title: Option<String>,
    /// Version of the agent.
    pub version: String,
}

/// Prompt capabilities advertised by the agent (`PromptCapabilities`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PromptCapabilities {
    /// Agent accepts image content blocks in prompts.
    pub image: Option<bool>,
    /// Agent accepts audio content blocks in prompts.
    pub audio: Option<bool>,
    /// Agent accepts embedded resource content blocks in prompts
    /// (`embeddedContext`).
    pub embedded_context: Option<bool>,
}

/// MCP capabilities advertised by the agent (`McpCapabilities`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct McpCapabilities {
    /// Agent can connect to HTTP MCP servers.
    pub http: Option<bool>,
    /// Agent can connect to SSE MCP servers.
    pub sse: Option<bool>,
}

/// Session-lifecycle capabilities advertised by the agent
/// (`SessionCapabilities`). Presence of a `Some({})` key means supported;
/// booleans here are decoded as "present and not null".
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SessionCapabilities {
    /// Agent supports `session/list`.
    pub list: bool,
    /// Agent supports `session/delete`.
    pub delete: bool,
    /// Agent supports `session/resume`.
    pub resume: bool,
    /// Agent supports `session/close`.
    pub close: bool,
    /// Agent supports `additionalDirectories` on session lifecycle requests.
    pub additional_directories: bool,
}

/// Capabilities advertised by the agent in `initialize` (`AgentCapabilities`).
///
/// The raw object is always available in [`AgentCapabilities::raw`]; the typed
/// fields cover the areas AIRI cares about. Unknown keys are ignored.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct AgentCapabilities {
    /// Whether the agent supports `session/load` (`loadSession`).
    pub load_session: Option<bool>,
    /// Prompt content-type capabilities, when advertised.
    pub prompt: Option<PromptCapabilities>,
    /// MCP server connection capabilities, when advertised.
    pub mcp: Option<McpCapabilities>,
    /// Session-lifecycle capabilities, when advertised.
    pub session: Option<SessionCapabilities>,
    /// The raw `agentCapabilities` object, verbatim.
    pub raw: Value,
}

/// Result of the `initialize` handshake.
#[derive(Debug, Clone, PartialEq)]
pub struct InitializeResult {
    /// The protocol version the agent wants to speak, surfaced but not
    /// validated (the client disconnects by choice, not automatically, when it
    /// is newer than supported).
    pub protocol_version: u64,
    /// Agent capabilities, typed where meaningful.
    pub agent_capabilities: AgentCapabilities,
    /// Authentication methods offered by the agent, kept verbatim.
    pub auth_methods: Vec<Value>,
    /// Agent identity, when provided.
    pub agent_info: Option<Implementation>,
    /// The raw `result` object, for fields this struct does not model.
    pub raw: Value,
}

/// A permission option offered by the agent in `session/request_permission`
/// (`PermissionOption` in the schema).
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionOption {
    /// Unique identifier of the option (`optionId`).
    pub option_id: String,
    /// Human-readable label.
    pub name: String,
    /// The option kind as sent on the wire (`allow_once` | `allow_always` |
    /// `reject_once` | `reject_always`). Unknown values are preserved
    /// verbatim; matching is done with `starts_with("allow")` /
    /// `starts_with("reject")`.
    pub kind: String,
}

/// Outcome of [`crate::AcpAgentClient::close_session`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloseSessionResult {
    /// The agent acknowledged `session/close` with a normal response.
    AgentAcknowledged,
    /// The agent rejected `session/close` (e.g. older agents without the
    /// `sessionCapabilities.close` capability, answering with a JSON-RPC
    /// error). Local state was still cleaned up; the session may leak on the
    /// agent side until it exits.
    AgentRefused(String),
}
