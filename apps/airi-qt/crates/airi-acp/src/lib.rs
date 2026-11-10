// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! `airi-acp` — native Rust ACP (Agent Client Protocol) agent client for AIRI.
//!
//! Ports the stdio side of the Electron main-process implementation
//! (`apps/stage-tamagotchi/src/main/services/airi/acp-agents/index.ts`, which
//! drives `@agentclientprotocol/sdk`) to a std-only, synchronous client:
//!
//! * [`AcpAgentClient::spawn`] launches the agent as a child process and
//!   wires its stdin/stdout; a background reader thread parses the
//!   newline-delimited JSON-RPC 2.0 stream and routes responses to the
//!   waiting caller **by request id**.
//! * [`AcpAgentClient::initialize`] sends `initialize` with protocol version
//!   `1`, empty `clientCapabilities`, and this crate as `clientInfo`; the
//!   agent's capabilities are returned (typed where meaningful, raw otherwise).
//! * [`AcpAgentClient::new_session`] sends `session/new` and returns the
//!   agent-assigned [`SessionId`].
//! * [`AcpAgentClient::prompt`] sends `session/prompt`, collects every
//!   `session/update` notification for the session until the prompt response
//!   arrives, and returns them in wire order together with the parsed
//!   [`StopReason`] and the concatenated agent message text.
//! * [`AcpAgentClient::cancel`] sends the `session/cancel` notification;
//!   [`AcpAgentClient::close_session`] sends `session/close` and always cleans
//!   up local routing, reporting whether the agent acknowledged.
//! * `session/request_permission` requests from the agent are answered from a
//!   configurable [`PermissionPolicy`]: `auto-read` allows read-like tool
//!   calls only; `auto-all` allows everything; `prompt` **enqueues** the
//!   request for the embedder — see [`AcpAgentClient::permission_requests`]
//!   and [`AcpAgentClient::answer_permission`]. A turn's updates can be
//!   streamed to the embedder with [`AcpAgentClient::prompt_stream`]. See
//!   the phase note (`docs/phase-notes/p9-lane-acp-hitl.md`) for the exact
//!   heuristic and how it differs from the Electron code.
//!
//! # Not implemented (out of scope for this port)
//!
//! * Filesystem (`fs/*`) and terminal (`terminal/*`) client methods —
//!   `clientCapabilities` is sent empty, so a compliant agent will not call
//!   them. Server-initiated requests other than `session/request_permission`
//!   are answered with JSON-RPC `-32601`.
//! * MCP servers in `session/new` (`mcpServers` is sent as `[]`).
//! * `session/load`, `session/list`, `session/delete`, `session/resume`,
//!   `session/set_mode`, `session/set_config_option`, `authenticate`,
//!   `logout`, elicitation, and the unstable v2 protocol.
//! * The `prompt` policy no longer answers `session/request_permission`
//!   itself — it hands the request to the embedder. Embedders without a UI
//!   should drain [`AcpAgentClient::permission_requests`] and answer with
//!   [`AcpAgentClient::answer_permission`] (failing closed is an embedder
//!   choice). `answer_permission(AllowSession)` records the session in an
//!   internal allowlist, which is a client-side approximation of "allow for
//!   session", not a protocol-level grant.
//!
//! See `docs/phase-notes/p9-lane-acp-hitl.md` for the full semantics diff.

mod client;
mod error;
mod jsonrpc;
mod permission;
mod types;

pub use client::{AcpAgentClient, SessionEvent};
pub use error::{AcpError, JSONRPC_METHOD_NOT_FOUND};
pub use types::{
    AgentCapabilities, CloseSessionResult, ContentBlock, ContentChunk, Implementation,
    InitializeResult, McpCapabilities, PermissionOption, PermissionPolicy, PermissionRequest,
    PromptCapabilities, PromptDecision, PromptResult, SessionCapabilities, SessionId,
    SessionUpdate, StopReason, ToolCall, ToolCallStatus, ToolCallUpdate, ToolKind,
    ACP_PROTOCOL_VERSION, CLIENT_NAME, DEFAULT_PROMPT_TIMEOUT, DEFAULT_REQUEST_TIMEOUT,
};
