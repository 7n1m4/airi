// SPDX-License-Identifier: GPL-3.0-or-later

//! Public value types exchanged with an MCP server.
//!
//! These mirror, in struct form, the renderer-side types in
//! `packages/stage-ui/src/stores/mcp-tool-bridge.ts`:
//! [`McpToolDescriptor`] matches `McpToolDescriptor`, and the structured
//! payload of a `tools/call` response is broken into [`McpToolResult`] /
//! [`McpToolContent`] matching `McpCallToolResult`.

use serde_json::{Map, Value};

/// JSON-RPC protocol revision this client speaks to the server.
pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// Separator used by the Electron implementation to qualify a tool name with
/// its server name (`server::tool`). Not used by the wire format — the wire
/// always carries the bare tool name — but documented here so the port has a
/// single obvious reference point.
pub const TOOL_NAME_SEPARATOR: &str = "::";

/// Default per-request timeout, matching the mission spec (5 s). The Electron
/// implementation used 10 s (`mcpRequestTimeoutMsec`) with a 15 s ceiling; the
/// Rust client uses a single 5 s default and lets callers override it via
/// [`crate::McpStdioClient::set_timeout`].
pub const DEFAULT_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Identity of the client sent in the `initialize` handshake, matching the
/// Electron client's `Client({ name, version })` shape.
pub const CLIENT_NAME: &str = "airi-mcp";

/// Result of the `initialize` handshake.
#[derive(Debug, Clone, PartialEq)]
pub struct McpInitializeResult {
    /// Protocol version reported by the server (usually `"2024-11-05"`, but
    /// never validated against [`MCP_PROTOCOL_VERSION`] by this client).
    pub protocol_version: String,
    /// Server capabilities, verbatim from the `initialize` result.
    pub capabilities: Value,
    /// Optional server identity (`serverInfo`).
    pub server_info: Option<McpServerInfo>,
    /// The raw `result` object, for callers that need fields this struct
    /// does not model.
    pub raw: Value,
}

/// Identity of the server from the `initialize` handshake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServerInfo {
    /// Server name, e.g. `serverInfo.name`.
    pub name: String,
    /// Server version, e.g. `serverInfo.version`.
    pub version: String,
}

/// A tool advertised by the server's `tools/list` response.
///
/// Note the field name: the wire key is `inputSchema` (camelCase, per the MCP
/// spec) or the non-standard `input_schema` alias; both are accepted during
/// parsing and this struct exposes the normalised `input_schema`.
#[derive(Debug, Clone, PartialEq)]
pub struct McpToolDescriptor {
    /// Bare tool name as reported by the server (no `server::` prefix).
    pub name: String,
    /// Optional human-readable description.
    pub description: Option<String>,
    /// JSON Schema object describing the tool's arguments. Empty when the
    /// server omitted it or sent a non-object schema.
    pub input_schema: Map<String, Value>,
}

/// One content block from a `tools/call` result.
#[derive(Debug, Clone, PartialEq)]
pub enum McpToolContent {
    /// A `{ "type": "text", "text": "…" }` block.
    Text(String),
    /// Any other content block (`image`, `resource`, …), kept verbatim.
    Other {
        /// The value of the block's `type` field, or `"unknown"` when absent.
        content_type: String,
        /// The full content block object.
        raw: Value,
    },
}

/// Structured result of `tools/call`.
#[derive(Debug, Clone, PartialEq)]
pub struct McpToolResult {
    /// The `content` array, normalised into typed blocks. Text blocks are
    /// turned into [`McpToolContent::Text`]; everything else is preserved in
    /// [`McpToolContent::Other`].
    pub content: Vec<McpToolContent>,
    /// The optional `structuredContent` object, when the server sent one and
    /// it is a JSON object.
    pub structured_content: Option<Value>,
    /// The optional `isError` flag. MCP uses this to signal a tool-level
    /// failure *without* a JSON-RPC error; this client does not retry or
    /// error out on it — it is surfaced to the caller verbatim.
    pub is_error: bool,
}

impl McpToolResult {
    /// Concatenates all [`McpToolContent::Text`] blocks with `\n` separators.
    /// This is the quickest way to render a text tool result for an LLM or a
    /// log line.
    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter_map(|block| match block {
                McpToolContent::Text(text) => Some(text.as_str()),
                McpToolContent::Other { .. } => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}
