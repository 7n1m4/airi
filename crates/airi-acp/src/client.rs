// SPDX-License-Identifier: GPL-3.0-or-later

//! The stdio ACP client: spawns the agent, speaks newline-delimited
//! JSON-RPC 2.0, routes responses to their requests by id, and fans out
//! `session/update` notifications to the session that subscribed.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::error::{AcpError, JSONRPC_METHOD_NOT_FOUND, JSONRPC_RESOURCE_NOT_FOUND};
use crate::jsonrpc::{
    self, normalize_response_id, response_to_result, JsonRpcNotification, JsonRpcRequest,
};
use crate::permission::{
    decide_permission, decide_prompt_decision, parse_permission_options, permission_result,
    select_allow, select_deny, PermissionOutcome,
};
use crate::types::{
    AgentCapabilities, CloseSessionResult, ContentBlock, ContentChunk, DeleteSessionResult,
    Implementation, InitializeResult, McpCapabilities, PermissionRequest, PromptCapabilities,
    PromptResult, SessionCapabilities, SessionConfigValue, SessionId, SessionMode,
    SessionModeState, SessionSetupResult, SessionSummary, SessionUpdate,
    SetSessionConfigOptionResult, StopReason, ToolCall, ToolCallUpdate, ACP_PROTOCOL_VERSION,
    CLIENT_NAME, DEFAULT_PROMPT_TIMEOUT, DEFAULT_REQUEST_TIMEOUT,
};

/// Internal callback type for slots in the pending-request map. Used instead
/// of a bare channel sender so `session/prompt` can forward the response into
/// the per-session event stream while ordinary RPCs forward into a plain
/// oneshot channel.
type PendingCallback = Box<dyn FnOnce(Result<Value, AcpError>) + Send>;

/// Events delivered to a session's subscription during a prompt turn.
///
/// Returned by [`AcpAgentClient::prompt_stream`]; consumed by
/// [`AcpAgentClient::prompt`] internally or by an embedder that wants the
/// turn's updates as they arrive (the Qt bridge does exactly that).
#[derive(Debug)]
pub enum SessionEvent {
    /// A `session/update` notification routed to this session.
    Update(SessionUpdate),
    /// The agent answered the outstanding `session/prompt` request. The
    /// payload is the raw `result` object (or the mapped error); the turn
    /// is over either way.
    Finished(Result<Value, AcpError>),
}

/// A `session/request_permission` request the client enqueued for the
/// human (the [`crate::PermissionPolicy::Prompt`] policy, when the session
/// is not auto-allowed). The reply is written by
/// [`AcpAgentClient::answer_permission`].
#[derive(Debug)]
struct PendingPermission {
    /// The raw JSON-RPC id of the agent's server-initiated request — echoed
    /// back verbatim in the reply.
    reply_id: Value,
    /// The session the tool call belongs to.
    session_id: SessionId,
    /// Options offered by the agent, in wire order.
    options: Vec<crate::types::PermissionOption>,
}

/// A JSON-RPC client for a single ACP agent reached over its stdio pipes.
///
/// Spawns `command` as a child process, wires its stdin/stdout, and runs a
/// background reader thread that parses newline-delimited JSON-RPC messages
/// from the agent's stdout. Responses are routed to the waiting caller **by
/// request id**; `session/update` notifications are routed to the session
/// subscription created by [`AcpAgentClient::prompt`]; server-initiated
/// `session/request_permission` requests are either answered from the
/// configured [`PermissionPolicy`](crate::PermissionPolicy) (`auto-*`) or
/// enqueued for the human (`prompt` policy) — see
/// [`AcpAgentClient::permission_requests`]. stderr is
/// drained into `tracing` so a chatty agent cannot block on a full pipe.
///
/// The wire protocol is JSON-RPC 2.0 as described by the Agent Client
/// Protocol (`https://agentclientprotocol.com`): one JSON object per line,
/// requests carry a numeric id, notifications do not.
///
/// Behaviour notes vs the Electron implementation
/// (`apps/stage-tamagotchi/src/main/services/airi/acp-agents/index.ts`,
/// which drives `@agentclientprotocol/sdk`):
///
/// * **Timeouts are bounded** (the SDK waited indefinitely): short RPCs use
///   10 s by default ([`crate::DEFAULT_REQUEST_TIMEOUT`]); a prompt
///   turn uses 5 minutes ([`crate::DEFAULT_PROMPT_TIMEOUT`]). Both are
///   configurable.
/// * **Permission policy semantics differ** — see the phase note
///   (`docs/phase-notes/p9-lane-acp-agents.md`) for the honest diff
///   (notably: Electron's `auto-read` behaved like `auto-all`; this crate
///   implements the documented read-only check).
/// * **`prompt` policy asks the human** — `session/request_permission`
///   requests are enqueued on the channel from
///   [`AcpAgentClient::permission_requests`]; the agent stays blocked until
///   [`AcpAgentClient::answer_permission`] writes the reply. Nothing is
///   asked or answered inside this crate.
/// * **`session/close` is attempted** — the Electron service only disposed
///   local routing on close. This client sends the (stable) `session/close`
///   RPC and tolerates JSON-RPC errors by falling back to local cleanup,
///   reporting which one happened via [`CloseSessionResult`].
/// * **Server-initiated agent methods other than
///   `session/request_permission`** are answered with `-32601`.
///   `fs/*` and `terminal/*` are never advertised in `clientCapabilities`, so
///   a compliant agent will not call them.
pub struct AcpAgentClient {
    child: Option<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, PendingCallback>>>,
    subscriptions: Arc<Mutex<HashMap<SessionId, mpsc::Sender<SessionEvent>>>>,
    policy: Arc<Mutex<crate::types::PermissionPolicy>>,
    /// Receiver side of the permission-request enqueue channel (capacity 8),
    /// shared with the embedder via [`AcpAgentClient::permission_requests`].
    permission_requests: Arc<Mutex<mpsc::Receiver<PermissionRequest>>>,
    /// Server-initiated `session/request_permission` requests awaiting a
    /// human decision, keyed by the normalized request id.
    pending_permissions: Arc<Mutex<HashMap<String, PendingPermission>>>,
    /// Sessions the human approved for the rest of the session
    /// (`AllowSession`). The agent re-asks; we answer `allow_*` without
    /// prompting. Client-side approximation only — see
    /// [`crate::PromptDecision::AllowSession`].
    session_allowlist: Arc<Mutex<HashSet<SessionId>>>,
    reader: Option<JoinHandle<()>>,
    next_id: AtomicU64,
    request_timeout: Duration,
    prompt_timeout: Duration,
    closed: Arc<AtomicBool>,
}

impl AcpAgentClient {
    /// Spawns `command` with `args` and optional extra environment entries.
    ///
    /// `env` is layered on top of the inherited process environment; pass
    /// `None` to inherit the environment unchanged.
    ///
    /// The agent is not initialised by this call — use
    /// [`AcpAgentClient::initialize`] to complete the protocol handshake
    /// before creating sessions.
    pub fn spawn(
        command: &str,
        args: &[&str],
        env: Option<&[(String, String)]>,
    ) -> Result<Self, AcpError> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(entries) = env {
            for (key, value) in entries {
                cmd.env(key, value);
            }
        }

        let mut child = cmd.spawn().map_err(AcpError::Spawn)?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AcpError::Protocol("child stdin pipe unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AcpError::Protocol("child stdout pipe unavailable".into()))?;
        let stderr = child.stderr.take();

        let stdin = Arc::new(Mutex::new(stdin));
        let pending: Arc<Mutex<HashMap<u64, PendingCallback>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let subscriptions: Arc<Mutex<HashMap<SessionId, mpsc::Sender<SessionEvent>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let policy = Arc::new(Mutex::new(crate::types::PermissionPolicy::default()));
        let closed = Arc::new(AtomicBool::new(false));
        let (permission_tx, permission_rx) = mpsc::sync_channel(8);
        let permission_requests = Arc::new(Mutex::new(permission_rx));
        let pending_permissions: Arc<Mutex<HashMap<String, PendingPermission>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let session_allowlist: Arc<Mutex<HashSet<SessionId>>> =
            Arc::new(Mutex::new(HashSet::new()));

        if let Some(stderr) = stderr {
            std::thread::Builder::new()
                .name("airi-acp-stderr".into())
                .spawn(move || {
                    for line in BufReader::new(stderr).lines() {
                        match line {
                            Ok(line) => {
                                let trimmed = line.trim_end();
                                if !trimmed.is_empty() {
                                    tracing::debug!(target: "airi-acp", "agent stderr: {trimmed}");
                                }
                            }
                            Err(_) => break,
                        }
                    }
                })
                .map_err(|e| {
                    AcpError::Transport(format!("failed to spawn stderr drain thread: {e}"))
                })?;
        }

        let reader = {
            let pending = Arc::clone(&pending);
            let subscriptions = Arc::clone(&subscriptions);
            let closed = Arc::clone(&closed);
            let stdin = Arc::clone(&stdin);
            let policy = Arc::clone(&policy);
            let pending_permissions = Arc::clone(&pending_permissions);
            let session_allowlist = Arc::clone(&session_allowlist);
            std::thread::Builder::new()
                .name("airi-acp-reader".into())
                .spawn(move || {
                    reader_loop(
                        stdout,
                        pending,
                        subscriptions,
                        closed,
                        stdin,
                        policy,
                        permission_tx,
                        pending_permissions,
                        session_allowlist,
                    )
                })
                .map_err(|e| AcpError::Transport(format!("failed to spawn reader thread: {e}")))?
        };

        Ok(Self {
            child: Some(child),
            stdin,
            pending,
            subscriptions,
            policy,
            permission_requests,
            pending_permissions,
            session_allowlist,
            reader: Some(reader),
            next_id: AtomicU64::new(1),
            request_timeout: DEFAULT_REQUEST_TIMEOUT,
            prompt_timeout: DEFAULT_PROMPT_TIMEOUT,
            closed,
        })
    }

    /// Overrides the per-request timeout for short RPCs.
    pub fn set_timeout(&mut self, timeout: Duration) {
        self.request_timeout = timeout;
    }

    /// Returns the current per-request timeout for short RPCs.
    pub fn timeout(&self) -> Duration {
        self.request_timeout
    }

    /// Overrides the per-turn timeout for `session/prompt`.
    pub fn set_prompt_timeout(&mut self, timeout: Duration) {
        self.prompt_timeout = timeout;
    }

    /// Returns the current per-turn timeout for `session/prompt`.
    pub fn prompt_timeout(&self) -> Duration {
        self.prompt_timeout
    }

    /// Returns the OS process id of the agent, when it is running.
    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(Child::id)
    }

    /// Returns `true` once the agent has closed its output stream or the
    /// client has been shut down.
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Sets the permission policy applied to `session/request_permission`
    /// requests. Defaults to [`crate::PermissionPolicy::Prompt`].
    pub fn set_permission_policy(&self, policy: crate::types::PermissionPolicy) {
        if let Ok(mut guard) = self.policy.lock() {
            *guard = policy;
        }
    }

    /// Returns the configured permission policy.
    pub fn permission_policy(&self) -> crate::types::PermissionPolicy {
        self.policy.lock().map(|p| *p).unwrap_or_default()
    }

    /// Returns the channel carrying `session/request_permission` requests
    /// that the [`crate::PermissionPolicy::Prompt`] policy enqueued for the
    /// human.
    ///
    /// The same `Arc` is handed out on every call, so an embedder can hold it
    /// for the client's lifetime and poll/`recv` it from a worker thread or
    /// drain it from a UI timer. The channel is bounded (capacity 8); when
    /// it is full, new requests fail closed (reject-style answer) instead of
    /// blocking the agent. When the client is dropped, the send half is
    /// dropped and receivers observe `Disconnected`.
    ///
    /// Embedders that also want streaming prompt updates should use
    /// [`AcpAgentClient::prompt_stream`] and drain both channels.
    pub fn permission_requests(&self) -> Arc<Mutex<mpsc::Receiver<PermissionRequest>>> {
        Arc::clone(&self.permission_requests)
    }

    /// Answers a pending permission request previously delivered through
    /// [`AcpAgentClient::permission_requests`].
    ///
    /// Maps `decision` onto the options the agent offered (see
    /// [`crate::PromptDecision`]), writes the `session/request_permission`
    /// reply to the agent's stdin, and — for
    /// [`crate::PromptDecision::AllowSession`] — records the request's
    /// session in an internal allowlist so subsequent requests from that
    /// session are auto-allowed (the agent re-asks; we answer `allow_*`
    /// without prompting — a client-side approximation of "allow for
    /// session"; see [`crate::PromptDecision::AllowSession`]).
    ///
    /// # Errors
    ///
    /// [`AcpError::UnknownPermissionRequest`] when `request_id` does not
    /// match a pending request (already answered, never enqueued, or the
    /// enqueue queue was full and the request failed closed). Transport
    /// errors when the reply cannot be written.
    pub fn answer_permission(
        &self,
        request_id: &str,
        decision: crate::types::PromptDecision,
    ) -> Result<(), AcpError> {
        self.ensure_open()?;
        let pending = {
            let mut map = self
                .pending_permissions
                .lock()
                .map_err(|_| AcpError::Transport("pending-permissions lock poisoned".into()))?;
            map.remove(request_id)
        };
        let Some(pending) = pending else {
            return Err(AcpError::UnknownPermissionRequest(request_id.to_string()));
        };
        let outcome = decide_prompt_decision(decision, &pending.options);
        if matches!(decision, crate::types::PromptDecision::AllowSession) {
            if let Ok(mut allowlist) = self.session_allowlist.lock() {
                allowlist.insert(pending.session_id.clone());
            }
        }
        let reply = json!({
            "jsonrpc": "2.0",
            "id": pending.reply_id,
            "result": permission_result(&outcome),
        });
        let line = jsonrpc::encode_line(&reply)?;
        self.write_line(&line)
    }

    /// Performs the ACP `initialize` handshake.
    ///
    /// Sends `protocolVersion: 1`, empty `clientCapabilities` (the agent must
    /// not call `fs/*` or `terminal/*` against us), and `clientInfo` with this
    /// crate's name and version. The agent's reported protocol version is
    /// surfaced in [`InitializeResult::protocol_version`] but is not
    /// validated, mirroring the Electron behaviour of not checking it.
    pub fn initialize(&self) -> Result<InitializeResult, AcpError> {
        let params = json!({
            "protocolVersion": ACP_PROTOCOL_VERSION,
            "clientCapabilities": {},
            "clientInfo": { "name": CLIENT_NAME, "version": env!("CARGO_PKG_VERSION") },
        });
        let result = self.send_request_with_timeout("initialize", params, self.request_timeout)?;
        Ok(parse_initialize_result(&result))
    }

    /// Creates a new ACP session (`session/new`).
    ///
    /// `cwd` defaults to the process's current directory when `None`. Relative
    /// paths are absolutised (the schema requires absolute paths). Sends an
    /// empty `mcpServers` list — ACP session setup with MCP servers is not
    /// exposed by this crate yet.
    pub fn new_session(&self, cwd: Option<&Path>) -> Result<SessionId, AcpError> {
        let cwd = absolutise_cwd(cwd)?;
        let params = json!({ "cwd": cwd, "mcpServers": [] });
        let result = self.send_request_with_timeout("session/new", params, self.request_timeout)?;
        result
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                AcpError::Protocol("session/new response missing string `sessionId`".into())
            })
    }

    /// Starts a prompt turn and returns the event receiver immediately,
    /// instead of collecting the events like [`AcpAgentClient::prompt`]
    /// does.
    ///
    /// The returned receiver yields every `session/update` notification for
    /// the session in wire order, then exactly one
    /// [`SessionEvent::Finished`] carrying the agent's raw prompt response
    /// (or the mapped error). The caller must keep draining the receiver —
    /// there is no timeout in this mode; cancel the turn with
    /// [`AcpAgentClient::cancel`] if the agent stalls. If the caller drops
    /// the receiver without draining, the turn's updates are dropped
    /// silently (the pending-request entry is still removed when the agent's
    /// response arrives).
    ///
    /// Only one prompt may be in flight per session, exactly as with
    /// [`AcpAgentClient::prompt`]; a second concurrent call returns
    /// [`AcpError::PromptInProgress`]. Callers are responsible for the
    /// same cleanup [`AcpAgentClient::prompt`] does internally: drop the
    /// receiver and call [`AcpAgentClient::close_session`] (or
    /// [`AcpAgentClient::cancel`]) when abandoning a turn.
    pub fn prompt_stream(
        &self,
        session_id: &str,
        text: &str,
    ) -> Result<mpsc::Receiver<SessionEvent>, AcpError> {
        let (_, event_rx) = self.start_prompt(session_id, text)?;
        Ok(event_rx)
    }

    /// Shared prompt setup: registers the per-session subscription, inserts
    /// the pending-request callback that forwards the agent's prompt
    /// response into the event stream, and writes `session/prompt`.
    /// Returns the request id and the event receiver.
    fn start_prompt(
        &self,
        session_id: &str,
        text: &str,
    ) -> Result<(u64, mpsc::Receiver<SessionEvent>), AcpError> {
        self.ensure_open()?;

        let (event_tx, event_rx) = self.register_subscription(session_id)?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let finish = make_finish_callback(event_tx);
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, finish);
        } else {
            self.remove_subscription(session_id);
            return Err(AcpError::Transport("pending-requests lock poisoned".into()));
        }

        let params = json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": text }],
        });
        if let Err(error) = self.write_request_with_id(id, "session/prompt", params) {
            self.remove_pending(id);
            self.remove_subscription(session_id);
            return Err(error);
        }

        Ok((id, event_rx))
    }

    /// Registers a per-session event subscription. Fails with
    /// [`AcpError::PromptInProgress`] when the session already has a
    /// subscription (an in-flight prompt turn, or an in-flight
    /// `session/load` / `session/resume`).
    fn register_subscription(
        &self,
        session_id: &str,
    ) -> Result<(mpsc::Sender<SessionEvent>, mpsc::Receiver<SessionEvent>), AcpError> {
        let (event_tx, event_rx) = mpsc::channel::<SessionEvent>();
        let mut subscriptions = self
            .subscriptions
            .lock()
            .map_err(|_| AcpError::Transport("subscriptions lock poisoned".into()))?;
        if subscriptions.contains_key(session_id) {
            return Err(AcpError::PromptInProgress(session_id.to_string()));
        }
        subscriptions.insert(session_id.to_string(), event_tx.clone());
        Ok((event_tx, event_rx))
    }

    /// Shared setup for `session/load` and `session/resume`: registers the
    /// per-session subscription, sends the RPC with an empty `mcpServers`
    /// list, accumulates every `session/update` notification the agent
    /// replays while answering (wire order), and parses the result.
    fn session_setup(
        &self,
        session_id: &str,
        method: &str,
        cwd: Option<&Path>,
    ) -> Result<SessionSetupResult, AcpError> {
        self.ensure_open()?;
        let cwd = absolutise_cwd(cwd)?;

        let (event_tx, event_rx) = self.register_subscription(session_id)?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let finish = make_finish_callback(event_tx);
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, finish);
        } else {
            self.remove_subscription(session_id);
            return Err(AcpError::Transport("pending-requests lock poisoned".into()));
        }

        let params = json!({ "sessionId": session_id, "cwd": cwd, "mcpServers": [] });
        if let Err(error) = self.write_request_with_id(id, method, params) {
            self.remove_pending(id);
            self.remove_subscription(session_id);
            return Err(error);
        }

        // The stream ends when the agent answers the RPC (like a very short
        // prompt turn). Bound the whole operation by the short-RPC timeout:
        // agents that replay very long histories may need `set_timeout`
        // raised accordingly.
        let deadline = Instant::now() + self.request_timeout;
        let mut updates: Vec<SessionUpdate> = Vec::new();
        let response = loop {
            let remaining = match deadline.checked_duration_since(Instant::now()) {
                Some(remaining) => remaining,
                None => {
                    self.remove_pending(id);
                    self.remove_subscription(session_id);
                    return Err(AcpError::Timeout {
                        method: method.to_string(),
                        timeout: self.request_timeout,
                    });
                }
            };
            match event_rx.recv_timeout(remaining) {
                Ok(SessionEvent::Update(update)) => updates.push(update),
                Ok(SessionEvent::Finished(Ok(result))) => break result,
                Ok(SessionEvent::Finished(Err(error))) => {
                    self.remove_subscription(session_id);
                    return Err(map_session_error(error, method, session_id));
                }
                Err(RecvTimeoutError::Timeout) => {
                    self.remove_pending(id);
                    self.remove_subscription(session_id);
                    return Err(AcpError::Timeout {
                        method: method.to_string(),
                        timeout: self.request_timeout,
                    });
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.remove_pending(id);
                    self.remove_subscription(session_id);
                    return Err(AcpError::Closed);
                }
            }
        };

        self.remove_subscription(session_id);
        Ok(parse_session_setup_result(&response, session_id, updates))
    }

    /// Sends a text prompt to a session (`session/prompt`) and collects the
    /// turn's `session/update` notifications.
    ///
    /// All updates (message chunks, thought chunks, tool calls, plans, and
    /// protocol extensions) are returned in wire order in
    /// [`PromptResult::updates`]. [`PromptResult::final_text`] concatenates
    /// the `agent_message_chunk` text for convenience. The turn ends when the
    /// agent answers `session/prompt`; the response's `stopReason` is parsed
    /// into [`PromptResult::stop_reason`].
    ///
    /// Only one prompt may be in flight per session; a second call returns
    /// [`AcpError::PromptInProgress`].
    ///
    /// Embedders that need the updates as they arrive (e.g. a UI rendering a
    /// growing transcript) should use [`AcpAgentClient::prompt_stream`]
    /// instead.
    pub fn prompt(&self, session_id: &str, text: &str) -> Result<PromptResult, AcpError> {
        let (id, event_rx) = self.start_prompt(session_id, text)?;

        let deadline = Instant::now() + self.prompt_timeout;
        let mut updates: Vec<SessionUpdate> = Vec::new();
        let prompt_response = loop {
            let remaining = match deadline.checked_duration_since(Instant::now()) {
                Some(remaining) => remaining,
                None => {
                    self.remove_pending(id);
                    self.remove_subscription(session_id);
                    return Err(AcpError::Timeout {
                        method: "session/prompt".to_string(),
                        timeout: self.prompt_timeout,
                    });
                }
            };
            match event_rx.recv_timeout(remaining) {
                Ok(SessionEvent::Update(update)) => updates.push(update),
                Ok(SessionEvent::Finished(Ok(result))) => break result,
                Ok(SessionEvent::Finished(Err(error))) => {
                    self.remove_subscription(session_id);
                    return Err(error);
                }
                Err(RecvTimeoutError::Timeout) => {
                    self.remove_pending(id);
                    self.remove_subscription(session_id);
                    return Err(AcpError::Timeout {
                        method: "session/prompt".to_string(),
                        timeout: self.prompt_timeout,
                    });
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.remove_pending(id);
                    self.remove_subscription(session_id);
                    return Err(AcpError::Closed);
                }
            }
        };

        self.remove_subscription(session_id);

        let stop_reason = prompt_response
            .get("stopReason")
            .and_then(Value::as_str)
            .map(StopReason::from_wire)
            .unwrap_or_else(|| StopReason::Other(String::new()));
        let final_text = updates
            .iter()
            .filter_map(SessionUpdate::agent_text)
            .collect::<String>();

        Ok(PromptResult {
            session_id: session_id.to_string(),
            stop_reason,
            final_text,
            updates,
        })
    }

    /// Cancels the in-flight turn of a session (`session/cancel`,
    /// a notification — the agent does not respond).
    pub fn cancel(&self, session_id: &str) -> Result<(), AcpError> {
        self.ensure_open()?;
        let notification =
            JsonRpcNotification::new("session/cancel", json!({ "sessionId": session_id }));
        let line = jsonrpc::encode_line(&notification)?;
        self.write_line(&line)
    }

    /// Closes a session (`session/close`) and drops local routing for it.
    ///
    /// The Electron service only disposed its local update routing and never
    /// told the agent. This client sends the stable `session/close` RPC; if
    /// the agent answers with a JSON-RPC error (for example because it does
    /// not advertise `sessionCapabilities.close`), local state is still
    /// cleaned up and the outcome is reported as
    /// [`CloseSessionResult::AgentRefused`]. Transport-level failures
    /// (timeout, EOF) are returned as [`AcpError`] instead.
    pub fn close_session(&self, session_id: &str) -> Result<CloseSessionResult, AcpError> {
        self.ensure_open()?;
        let params = json!({ "sessionId": session_id });
        let result = match self.send_request_with_timeout(
            "session/close",
            params,
            self.request_timeout,
        ) {
            Ok(_) => CloseSessionResult::AgentAcknowledged,
            Err(AcpError::JsonRpc { message, .. }) => {
                tracing::warn!(target: "airi-acp", "agent refused session/close: {message}");
                CloseSessionResult::AgentRefused(message)
            }
            Err(AcpError::Unsupported { method }) => {
                tracing::warn!(target: "airi-acp", "agent refused session/close: `{method}` not supported");
                CloseSessionResult::AgentRefused(format!("agent does not support `{method}`"))
            }
            Err(other) => {
                self.remove_subscription(session_id);
                return Err(other);
            }
        };
        self.remove_subscription(session_id);
        Ok(result)
    }

    /// Re-attaches to an existing session (`session/load`).
    ///
    /// The agent replays the conversation history as `session/update`
    /// notifications and then answers the RPC; the replayed updates are
    /// accumulated and returned in [`SessionSetupResult::updates`], in wire
    /// order. The session's local routing is registered for the duration of
    /// the call and removed afterwards — a later [`AcpAgentClient::prompt`]
    /// re-registers its own subscription.
    ///
    /// `cwd` defaults to the process's current directory when `None` and is
    /// absolutised before sending (the schema requires absolute paths).
    /// `mcpServers` is sent as `[]` — one outstanding operation per session
    /// is enforced, exactly like [`AcpAgentClient::prompt`]; a second
    /// concurrent call (or one concurrent with an in-flight prompt) fails
    /// with [`AcpError::PromptInProgress`].
    ///
    /// # Errors
    ///
    /// [`AcpError::Unsupported`] when the agent does not implement
    /// `session/load` (JSON-RPC `-32601`); [`AcpError::SessionNotFound`] when
    /// the agent reports the session does not exist (JSON-RPC `-32002`, the
    /// documented "resource not found" code — ACP has no session-specific
    /// not-found code); other JSON-RPC errors pass through as
    /// [`AcpError::JsonRpc`]. Bounded by the short-RPC timeout
    /// ([`crate::DEFAULT_REQUEST_TIMEOUT`], raisable via
    /// [`AcpAgentClient::set_timeout`]).
    pub fn load_session(
        &self,
        session_id: &str,
        cwd: Option<&Path>,
    ) -> Result<SessionSetupResult, AcpError> {
        self.session_setup(session_id, "session/load", cwd)
    }

    /// Resumes an existing session without replaying its history
    /// (`session/resume`).
    ///
    /// Unlike [`AcpAgentClient::load_session`], no conversation replay is
    /// expected; any `session/update` notifications the agent emits while
    /// answering are still accumulated and returned (normally empty).
    ///
    /// Only available when the agent advertises
    /// `sessionCapabilities.resume`; the capability is not pre-checked — a
    /// non-supporting agent answers `-32601` and this returns
    /// [`AcpError::Unsupported`]. Same error semantics as
    /// [`AcpAgentClient::load_session`].
    pub fn resume_session(
        &self,
        session_id: &str,
        cwd: Option<&Path>,
    ) -> Result<SessionSetupResult, AcpError> {
        self.session_setup(session_id, "session/resume", cwd)
    }

    /// Lists the sessions the agent knows about (`session/list`).
    ///
    /// Follows the `nextCursor` pagination cursor until the agent stops
    /// returning one (hard cap: 100 pages — exceeding it fails with
    /// [`AcpError::Protocol`] rather than looping forever). Entries the
    /// agent sends that do not parse as `SessionInfo` (no string
    /// `sessionId`) are skipped rather than failing the whole listing,
    /// mirroring the schema's skip-invalid-items semantics.
    ///
    /// Only available when the agent advertises `sessionCapabilities.list`;
    /// a non-supporting agent answers `-32601` and this returns
    /// [`AcpError::Unsupported`]. Other JSON-RPC errors pass through as
    /// [`AcpError::JsonRpc`].
    ///
    /// The schema's optional `cwd` filter and `cursor` parameters are not
    /// exposed yet; the client always lists everything.
    pub fn list_sessions(&self) -> Result<Vec<SessionSummary>, AcpError> {
        const MAX_PAGES: usize = 100;
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let params = match &cursor {
                Some(cursor) => json!({ "cursor": cursor }),
                None => json!({}),
            };
            let result =
                self.send_request_with_timeout("session/list", params, self.request_timeout)?;
            let sessions = result
                .get("sessions")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    AcpError::Protocol("session/list response missing `sessions` array".into())
                })?;
            for entry in sessions {
                if let Some(summary) = parse_session_summary(entry) {
                    out.push(summary);
                } else {
                    tracing::debug!(target: "airi-acp", "skipping unparseable SessionInfo entry in session/list");
                }
            }
            match result.get("nextCursor").and_then(Value::as_str) {
                Some(next) if !next.is_empty() => cursor = Some(next.to_string()),
                _ => return Ok(out),
            }
        }
        Err(AcpError::Protocol(
            "session/list pagination exceeded 100 pages; refusing to loop forever".into(),
        ))
    }

    /// Deletes a session (`session/delete`) — best effort.
    ///
    /// Mirrors [`AcpAgentClient::close_session`]: local routing for the
    /// session is removed regardless of the outcome. A normal response
    /// yields [`DeleteSessionResult::AgentAcknowledged`]; a JSON-RPC error
    /// other than `-32601`/`-32002` yields [`DeleteSessionResult::AgentRefused`]
    /// (the session may leak on the agent side). `-32601` (method not
    /// found) fails with [`AcpError::Unsupported`] and `-32002` (resource
    /// not found) with [`AcpError::SessionNotFound`]; transport-level
    /// failures (timeout, EOF) are returned as [`AcpError`] either way.
    pub fn delete_session(&self, session_id: &str) -> Result<DeleteSessionResult, AcpError> {
        self.ensure_open()?;
        let params = json!({ "sessionId": session_id });
        let result = self.send_request_with_timeout("session/delete", params, self.request_timeout);
        let result = map_session_not_found(result, session_id);
        let outcome = match result {
            Ok(_) => DeleteSessionResult::AgentAcknowledged,
            Err(AcpError::JsonRpc { message, .. }) => {
                tracing::warn!(target: "airi-acp", "agent refused session/delete: {message}");
                DeleteSessionResult::AgentRefused(message)
            }
            Err(other) => {
                self.remove_subscription(session_id);
                return Err(other);
            }
        };
        self.remove_subscription(session_id);
        Ok(outcome)
    }

    /// Sets a session's mode (`session/set_mode`).
    ///
    /// Available when the agent reports modes (e.g. via
    /// [`SessionSetupResult::modes`]); there is no dedicated capability flag.
    /// A non-supporting agent answers `-32601` and this returns
    /// [`AcpError::Unsupported`]; `-32002` maps to
    /// [`AcpError::SessionNotFound`].
    pub fn set_mode(&self, session_id: &str, mode_id: &str) -> Result<(), AcpError> {
        self.ensure_open()?;
        let params = json!({ "sessionId": session_id, "modeId": mode_id });
        let result =
            self.send_request_with_timeout("session/set_mode", params, self.request_timeout);
        map_session_not_found(result, session_id)?;
        Ok(())
    }

    /// Sets a session configuration option (`session/set_config_option`).
    ///
    /// `value` selects one arm of the schema's union: a string value id
    /// ([`SessionConfigValue::ValueId`], the default when `type` is absent
    /// on the wire) or an explicit boolean toggle
    /// ([`SessionConfigValue::Boolean`]). The response carries the full set
    /// of configuration options with their current values, kept verbatim.
    ///
    /// A non-supporting agent answers `-32601` and this returns
    /// [`AcpError::Unsupported`]; `-32002` maps to
    /// [`AcpError::SessionNotFound`].
    pub fn set_config_option(
        &self,
        session_id: &str,
        config_id: &str,
        value: &SessionConfigValue,
    ) -> Result<SetSessionConfigOptionResult, AcpError> {
        self.ensure_open()?;
        let params = match value {
            SessionConfigValue::ValueId(id) => {
                json!({ "sessionId": session_id, "configId": config_id, "value": id })
            }
            SessionConfigValue::Boolean(flag) => {
                json!({ "sessionId": session_id, "configId": config_id, "type": "boolean", "value": flag })
            }
        };
        let result = map_session_not_found(
            self.send_request_with_timeout(
                "session/set_config_option",
                params,
                self.request_timeout,
            ),
            session_id,
        )?;
        let config_options = result
            .get("configOptions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(SetSessionConfigOptionResult {
            config_options,
            raw: result,
        })
    }

    /// Kills the agent process and joins the background reader thread.
    ///
    /// Idempotent: dropping the client after `close` is a no-op. Pending
    /// requests are failed with [`AcpError::Closed`]; pending permission
    /// requests are dropped (their replies are never written — the agent is
    /// being killed, and an `UnknownPermissionRequest`-style answer would
    /// arrive after the agent can no longer read it anyway).
    pub fn close(mut self) {
        self.shutdown();
    }

    /// Sends a request and waits for the response routed by id.
    fn send_request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, AcpError> {
        self.ensure_open()?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| AcpError::Transport("pending-requests lock poisoned".into()))?;
            pending.insert(
                id,
                Box::new(move |result| {
                    let _ = tx.send(result);
                }),
            );
        }

        if let Err(error) = self.write_request_with_id(id, method, params) {
            self.remove_pending(id);
            return Err(error);
        }

        match rx.recv_timeout(timeout) {
            Ok(result) => map_method_not_found(result, method),
            Err(RecvTimeoutError::Timeout) => {
                self.remove_pending(id);
                Err(AcpError::Timeout {
                    method: method.to_string(),
                    timeout,
                })
            }
            Err(RecvTimeoutError::Disconnected) => Err(AcpError::Closed),
        }
    }

    fn ensure_open(&self) -> Result<(), AcpError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(AcpError::Closed);
        }
        Ok(())
    }

    fn write_request_with_id(&self, id: u64, method: &str, params: Value) -> Result<(), AcpError> {
        let request = JsonRpcRequest::new(id, method, params);
        let line = jsonrpc::encode_line(&request)?;
        self.write_line(&line)
    }

    fn write_line(&self, line: &str) -> Result<(), AcpError> {
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|_| AcpError::Transport("stdin lock poisoned".into()))?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|()| stdin.flush())
            .map_err(|e| AcpError::Transport(format!("failed to write to agent stdin: {e}")))
    }

    fn remove_pending(&self, id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
    }

    fn remove_subscription(&self, session_id: &str) {
        if let Ok(mut subscriptions) = self.subscriptions.lock() {
            subscriptions.remove(session_id);
        }
    }

    /// Shared shutdown path for `Drop`.
    fn shutdown(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
        // Fail in-flight requests instead of letting callers wait out the timeout.
        if let Ok(mut pending) = self.pending.lock() {
            for (_, callback) in pending.drain() {
                callback(Err(AcpError::Closed));
            }
        }
        // Drop subscriptions so prompt loops observing them terminate.
        if let Ok(mut subscriptions) = self.subscriptions.lock() {
            subscriptions.clear();
        }
        if let Ok(mut pending_permissions) = self.pending_permissions.lock() {
            let dropped = pending_permissions.len();
            if dropped > 0 {
                tracing::warn!(target: "airi-acp", dropped, "dropping unanswered permission requests on shutdown");
            }
            pending_permissions.clear();
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

impl Drop for AcpAgentClient {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Absolutises `cwd` (the schema requires absolute paths); defaults to the
/// process's current directory when `None`.
fn absolutise_cwd(cwd: Option<&Path>) -> Result<String, AcpError> {
    let cwd = match cwd {
        Some(path) => std::path::absolute(path)
            .map_err(|e| AcpError::Protocol(format!("failed to absolutise session cwd: {e}")))?,
        None => std::env::current_dir()
            .map_err(|e| AcpError::Protocol(format!("failed to read current directory: {e}")))?,
    };
    cwd.to_str()
        .map(str::to_string)
        .ok_or_else(|| AcpError::Protocol("session cwd contains non-UTF-8 bytes".into()))
}

/// Builds the pending-request callback that forwards the agent's response
/// into the session's event stream as [`SessionEvent::Finished`].
fn make_finish_callback(event_tx: mpsc::Sender<SessionEvent>) -> PendingCallback {
    Box::new(move |result: Result<Value, AcpError>| {
        let _ = event_tx.send(SessionEvent::Finished(result));
    })
}

/// Maps a JSON-RPC `-32601` (method not found) error onto
/// [`AcpError::Unsupported`]. Everything else passes through unchanged.
fn map_method_not_found(result: Result<Value, AcpError>, method: &str) -> Result<Value, AcpError> {
    match result {
        Err(AcpError::JsonRpc {
            code: JSONRPC_METHOD_NOT_FOUND,
            ..
        }) => Err(AcpError::Unsupported {
            method: method.to_string(),
        }),
        other => other,
    }
}

/// Maps a JSON-RPC `-32002` (resource not found) error onto
/// [`AcpError::SessionNotFound`]. Everything else passes through unchanged
/// (`-32601` has already been mapped to [`AcpError::Unsupported`] by the
/// time results reach here, either by `send_request_with_timeout` or by
/// `map_session_error`).
fn map_session_not_found(
    result: Result<Value, AcpError>,
    session_id: &str,
) -> Result<Value, AcpError> {
    match result {
        Err(AcpError::JsonRpc {
            code: JSONRPC_RESOURCE_NOT_FOUND,
            ..
        }) => Err(AcpError::SessionNotFound(session_id.to_string())),
        other => other,
    }
}

/// Applies both session-error mappings for the callback-based RPCs
/// (`session/load`, `session/resume`), whose responses bypass
/// [`AcpAgentClient::send_request_with_timeout`].
fn map_session_error(error: AcpError, method: &str, session_id: &str) -> AcpError {
    match error {
        AcpError::JsonRpc {
            code: JSONRPC_METHOD_NOT_FOUND,
            ..
        } => AcpError::Unsupported {
            method: method.to_string(),
        },
        AcpError::JsonRpc {
            code: JSONRPC_RESOURCE_NOT_FOUND,
            ..
        } => AcpError::SessionNotFound(session_id.to_string()),
        other => other,
    }
}

/// Parses the `result` object of the `initialize` response, leniently.
fn parse_initialize_result(result: &Value) -> InitializeResult {
    let protocol_version = result
        .get("protocolVersion")
        .and_then(Value::as_u64)
        .unwrap_or(ACP_PROTOCOL_VERSION);

    let caps_value = result
        .get("agentCapabilities")
        .cloned()
        .unwrap_or(Value::Null);
    let agent_capabilities = parse_agent_capabilities(&caps_value);

    let auth_methods = result
        .get("authMethods")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let agent_info = result.get("agentInfo").and_then(|info| {
        Some(Implementation {
            name: info.get("name")?.as_str()?.to_string(),
            title: info
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_string),
            version: info
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        })
    });

    InitializeResult {
        protocol_version,
        agent_capabilities,
        auth_methods,
        agent_info,
        raw: result.clone(),
    }
}

fn parse_agent_capabilities(value: &Value) -> AgentCapabilities {
    let prompt = value.get("promptCapabilities").map(|p| PromptCapabilities {
        image: p.get("image").and_then(Value::as_bool),
        audio: p.get("audio").and_then(Value::as_bool),
        embedded_context: p.get("embeddedContext").and_then(Value::as_bool),
    });
    let mcp = value.get("mcpCapabilities").map(|m| McpCapabilities {
        http: m.get("http").and_then(Value::as_bool),
        sse: m.get("sse").and_then(Value::as_bool),
    });
    let session = value
        .get("sessionCapabilities")
        .map(|s| SessionCapabilities {
            list: capabilities_present(s, "list"),
            delete: capabilities_present(s, "delete"),
            resume: capabilities_present(s, "resume"),
            close: capabilities_present(s, "close"),
            additional_directories: capabilities_present(s, "additionalDirectories"),
        });
    AgentCapabilities {
        load_session: value.get("loadSession").and_then(Value::as_bool),
        prompt,
        mcp,
        session,
        raw: value.clone(),
    }
}

/// ACP "presence" semantics: `Some({})` means supported; `null`/absent/`false`
/// means not. Anything non-null is treated as supported.
fn capabilities_present(value: &Value, key: &str) -> bool {
    value
        .get(key)
        .is_some_and(|v| !v.is_null() && v != &Value::Bool(false))
}

/// Parses one `SessionInfo` entry from `session/list`, leniently. Returns
/// `None` when `sessionId` is missing or not a string (the schema requires
/// it); callers skip such entries.
fn parse_session_summary(value: &Value) -> Option<SessionSummary> {
    let session_id = value.get("sessionId").and_then(Value::as_str)?.to_string();
    let additional_directories = value
        .get("additionalDirectories")
        .and_then(Value::as_array)
        .map(|dirs| {
            dirs.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Some(SessionSummary {
        session_id,
        cwd: value
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        title: value
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string),
        updated_at: value
            .get("updatedAt")
            .and_then(Value::as_str)
            .map(str::to_string),
        additional_directories,
        raw: value.clone(),
    })
}

/// Parses a `SessionModeState` object (`modes` in `session/load` /
/// `session/resume` responses), leniently. Returns `None` when the
/// `currentModeId` string is missing.
fn parse_session_mode_state(value: &Value) -> Option<SessionModeState> {
    let current_mode_id = value
        .get("currentModeId")
        .and_then(Value::as_str)?
        .to_string();
    let available_modes = value
        .get("availableModes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|mode| {
            Some(SessionMode {
                id: mode.get("id").and_then(Value::as_str)?.to_string(),
                name: mode
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                description: mode
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect();
    Some(SessionModeState {
        current_mode_id,
        available_modes,
    })
}

/// Builds the [`SessionSetupResult`] returned by `session/load` and
/// `session/resume` from the raw response and the updates accumulated while
/// waiting for it.
fn parse_session_setup_result(
    response: &Value,
    session_id: &str,
    updates: Vec<SessionUpdate>,
) -> SessionSetupResult {
    let modes = response.get("modes").and_then(parse_session_mode_state);
    let config_options = response
        .get("configOptions")
        .and_then(Value::as_array)
        .cloned();
    SessionSetupResult {
        session_id: session_id.to_string(),
        modes,
        config_options,
        updates,
        raw: response.clone(),
    }
}

/// Parses a `session/update` notification's `update` object, leniently.
/// Unparseable or unknown updates become [`SessionUpdate::Other`]; this
/// function never fails.
fn parse_session_update(value: &Value) -> SessionUpdate {
    let tag = value
        .get("sessionUpdate")
        .and_then(Value::as_str)
        .unwrap_or("");
    match tag {
        "user_message_chunk" => parse_content_chunk(value)
            .map(SessionUpdate::UserMessageChunk)
            .unwrap_or_else(|| fallback_update(tag, value)),
        "agent_message_chunk" => parse_content_chunk(value)
            .map(SessionUpdate::AgentMessageChunk)
            .unwrap_or_else(|| fallback_update(tag, value)),
        "agent_thought_chunk" => parse_content_chunk(value)
            .map(SessionUpdate::AgentThoughtChunk)
            .unwrap_or_else(|| fallback_update(tag, value)),
        "tool_call" => serde_json::from_value::<ToolCall>(value.clone())
            .map(SessionUpdate::ToolCall)
            .unwrap_or_else(|_| fallback_update(tag, value)),
        "tool_call_update" => serde_json::from_value::<ToolCallUpdate>(value.clone())
            .map(SessionUpdate::ToolCallUpdate)
            .unwrap_or_else(|_| fallback_update(tag, value)),
        "plan" => SessionUpdate::Plan(value.clone()),
        other => fallback_update(other, value),
    }
}

fn fallback_update(tag: &str, value: &Value) -> SessionUpdate {
    SessionUpdate::Other {
        update: tag.to_string(),
        raw: value.clone(),
    }
}

fn parse_content_chunk(value: &Value) -> Option<ContentChunk> {
    let content = value.get("content")?;
    let message_id = value
        .get("messageId")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(ContentChunk {
        content: ContentBlock::from_value(content),
        message_id,
    })
}

/// Background reader: parses JSON-RPC lines from the agent's stdout and
/// routes responses / notifications / server-initiated requests.
#[allow(clippy::too_many_arguments)]
fn reader_loop(
    stdout: std::process::ChildStdout,
    pending: Arc<Mutex<HashMap<u64, PendingCallback>>>,
    subscriptions: Arc<Mutex<HashMap<SessionId, mpsc::Sender<SessionEvent>>>>,
    closed: Arc<AtomicBool>,
    stdin: Arc<Mutex<ChildStdin>>,
    policy: Arc<Mutex<crate::types::PermissionPolicy>>,
    permission_tx: mpsc::SyncSender<PermissionRequest>,
    pending_permissions: Arc<Mutex<HashMap<String, PendingPermission>>>,
    session_allowlist: Arc<Mutex<HashSet<SessionId>>>,
) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(message) => handle_message(
                        &message,
                        &pending,
                        &subscriptions,
                        &stdin,
                        &policy,
                        &permission_tx,
                        &pending_permissions,
                        &session_allowlist,
                    ),
                    Err(e) => {
                        tracing::debug!(target: "airi-acp", "ignoring non-JSON line from agent: {e}");
                    }
                }
            }
            Err(e) => {
                tracing::debug!(target: "airi-acp", "stdout read error: {e}");
                break;
            }
        }
    }

    closed.store(true, Ordering::SeqCst);
    // EOF: fail every pending request so callers wake up with `Closed`.
    if let Ok(mut pending) = pending.lock() {
        for (_, callback) in pending.drain() {
            callback(Err(AcpError::Closed));
        }
    }
}

/// Classifies one parsed message and dispatches it.
#[allow(clippy::too_many_arguments)]
fn handle_message(
    message: &Value,
    pending: &Mutex<HashMap<u64, PendingCallback>>,
    subscriptions: &Mutex<HashMap<SessionId, mpsc::Sender<SessionEvent>>>,
    stdin: &Mutex<ChildStdin>,
    policy: &Mutex<crate::types::PermissionPolicy>,
    permission_tx: &mpsc::SyncSender<PermissionRequest>,
    pending_permissions: &Mutex<HashMap<String, PendingPermission>>,
    session_allowlist: &Mutex<HashSet<SessionId>>,
) {
    let method = message.get("method").and_then(Value::as_str);
    let id = message.get("id").cloned();

    match (method, id) {
        // Server-initiated request.
        (Some(method), Some(id)) => {
            if method == "session/request_permission" {
                let policy = policy.lock().map(|p| *p).unwrap_or_default();
                let params = message.get("params");
                let session_allowlisted = params
                    .and_then(|p| p.get("sessionId"))
                    .and_then(Value::as_str)
                    .is_some_and(|sid| {
                        session_allowlist
                            .lock()
                            .map(|set| set.contains(sid))
                            .unwrap_or(false)
                    });
                match plan_permission(
                    policy,
                    session_allowlisted,
                    permission_tx,
                    pending_permissions,
                    &id,
                    params,
                ) {
                    PermissionPlan::Immediate(outcome) => {
                        let result = permission_result(&outcome);
                        let reply = json!({ "jsonrpc": "2.0", "id": id, "result": result });
                        write_json_line(stdin, &reply);
                    }
                    PermissionPlan::Enqueued => {
                        // The reply is written later by `answer_permission`.
                    }
                }
            } else {
                let reply = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": crate::error::JSONRPC_METHOD_NOT_FOUND,
                        "message": "client does not support this server-initiated request"
                    }
                });
                write_json_line(stdin, &reply);
            }
        }
        // Notification.
        (Some("session/update"), None) => {
            let Some(params) = message.get("params") else {
                return;
            };
            let session_id = params
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let update = params.get("update").cloned().unwrap_or(Value::Null);
            let parsed = parse_session_update(&update);
            if let Ok(subscriptions) = subscriptions.lock() {
                if let Some(sender) = subscriptions.get(&session_id) {
                    let _ = sender.send(SessionEvent::Update(parsed));
                } else {
                    tracing::trace!(target: "airi-acp", session_id, "session/update with no subscriber (dropped)");
                }
            }
        }
        (Some(method), None) => {
            tracing::trace!(target: "airi-acp", method, "ignoring agent notification");
        }
        // Response: route by id.
        (None, Some(id)) => {
            let Some(key) = normalize_response_id(&id) else {
                tracing::debug!(target: "airi-acp", "dropping response with unusable id: {id}");
                return;
            };
            let result = response_to_result(message);
            let callback = pending.lock().ok().and_then(|mut map| map.remove(&key));
            match callback {
                Some(callback) => callback(result),
                None => {
                    tracing::debug!(target: "airi-acp", "dropping response for unknown id {key}");
                }
            }
        }
        (None, None) => {
            tracing::debug!(target: "airi-acp", "ignoring message with neither method nor id");
        }
    }
}

/// How [`plan_permission`] decided to answer (or not answer) a
/// `session/request_permission` request.
#[derive(Debug, PartialEq, Eq)]
enum PermissionPlan {
    /// Reply immediately with this outcome (auto policies, an
    /// allow-for-session session, or a fail-closed fallback).
    Immediate(PermissionOutcome),
    /// The request was enqueued for the human; the reply is written later
    /// by [`AcpAgentClient::answer_permission`].
    Enqueued,
}

/// Plans the answer to a `session/request_permission` request.
///
/// Split out from [`handle_message`] so the enqueue path can be unit-tested
/// without a child process. Pure with respect to I/O: it reads no streams,
/// it only mutates the enqueue channel and the pending-permissions map.
///
/// Decision order:
///
/// 1. `Prompt` policy + session in the allow-for-session list → allow
///    immediately (first `allow_*` option, else first option, else
///    `cancelled`). The agent re-asks; we allow without prompting.
/// 2. `Prompt` policy → enqueue the request for the human and stash the
///    reply context in `pending_permissions`. If the enqueue queue is full
///    or disconnected (or the pending-permissions lock is poisoned), the
///    request fails closed: the first `reject_*` option, or the last option,
///    or `cancelled`.
/// 3. Anything else → the configured [`crate::PermissionPolicy`]
///    (unchanged `auto-*` semantics).
fn plan_permission(
    policy: crate::types::PermissionPolicy,
    session_allowlisted: bool,
    permission_tx: &mpsc::SyncSender<PermissionRequest>,
    pending_permissions: &Mutex<HashMap<String, PendingPermission>>,
    reply_id: &Value,
    params: Option<&Value>,
) -> PermissionPlan {
    let tool_call = params
        .and_then(|p| p.get("toolCall"))
        .cloned()
        .unwrap_or(Value::Null);
    let options = parse_permission_options(params);
    let session_id = params
        .and_then(|p| p.get("sessionId"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if policy == crate::types::PermissionPolicy::Prompt {
        if session_allowlisted {
            // "Allow for session" approximation: silently allow this re-ask.
            return PermissionPlan::Immediate(
                select_allow(&options)
                    .or_else(|| options.first().map(|o| o.option_id.clone()))
                    .map(PermissionOutcome::Select)
                    .unwrap_or(PermissionOutcome::Cancelled),
            );
        }
        let request_id = normalize_response_id(reply_id)
            .map(|n| n.to_string())
            .unwrap_or_else(|| reply_id.to_string());
        let request = PermissionRequest {
            request_id: request_id.clone(),
            session_id: session_id.clone(),
            tool_call,
            options: options.clone(),
        };
        let Ok(mut pending) = pending_permissions.lock() else {
            // Fail closed: nobody will ever see this request.
            return PermissionPlan::Immediate(
                select_deny(&options)
                    .map(PermissionOutcome::Select)
                    .unwrap_or(PermissionOutcome::Cancelled),
            );
        };
        pending.insert(
            request_id.clone(),
            PendingPermission {
                reply_id: reply_id.clone(),
                session_id,
                options: options.clone(),
            },
        );
        return match permission_tx.try_send(request) {
            Ok(()) => PermissionPlan::Enqueued,
            Err(_) => {
                // The queue is full or the receiver is gone: fail closed.
                pending.remove(&request_id);
                PermissionPlan::Immediate(
                    select_deny(&options)
                        .map(PermissionOutcome::Select)
                        .unwrap_or(PermissionOutcome::Cancelled),
                )
            }
        };
    }

    PermissionPlan::Immediate(decide_permission(policy, &tool_call, &options))
}

fn write_json_line(stdin: &Mutex<ChildStdin>, reply: &Value) {
    if let Ok(line) = jsonrpc::encode_line(reply) {
        if let Ok(mut stdin) = stdin.lock() {
            let _ = stdin.write_all(line.as_bytes());
            let _ = stdin.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn permission_test_args() -> (
        mpsc::SyncSender<PermissionRequest>,
        mpsc::Receiver<PermissionRequest>,
        Mutex<HashMap<String, PendingPermission>>,
    ) {
        let (tx, rx) = mpsc::sync_channel(8);
        (tx, rx, Mutex::new(HashMap::new()))
    }

    fn prompt_params(session: &str, tool_call: Value) -> Value {
        json!({
            "sessionId": session,
            "toolCall": tool_call,
            "options": [
                {"optionId": "allow-1", "name": "Allow once", "kind": "allow_once"},
                {"optionId": "reject-1", "name": "Reject once", "kind": "reject_once"},
            ],
        })
    }

    #[test]
    fn plan_permission_enqueues_for_prompt_policy() {
        let (tx, rx, pending) = permission_test_args();
        let plan = plan_permission(
            crate::types::PermissionPolicy::Prompt,
            false,
            &tx,
            &pending,
            &json!(9001),
            Some(&prompt_params(
                "sess-1",
                json!({"toolCallId": "tc-1", "kind": "read"}),
            )),
        );
        assert_eq!(plan, PermissionPlan::Enqueued);
        let request = rx.try_recv().expect("permission request enqueued");
        assert_eq!(request.request_id, "9001");
        assert_eq!(request.session_id, "sess-1");
        assert_eq!(request.options.len(), 2);
        let stored = pending.lock().unwrap();
        let entry = stored.get("9001").expect("pending permission stored");
        assert_eq!(entry.session_id, "sess-1");
        assert_eq!(entry.reply_id, json!(9001));
    }

    #[test]
    fn plan_permission_enqueue_normalizes_string_ids_like_responses() {
        let (tx, rx, pending) = permission_test_args();
        let plan = plan_permission(
            crate::types::PermissionPolicy::Prompt,
            false,
            &tx,
            &pending,
            &json!(" 9002 "),
            Some(&prompt_params("sess-1", json!({}))),
        );
        assert_eq!(plan, PermissionPlan::Enqueued);
        assert_eq!(rx.try_recv().unwrap().request_id, "9002");
        assert!(pending.lock().unwrap().contains_key("9002"));
    }

    #[test]
    fn plan_permission_full_queue_fails_closed() {
        let (tx, _rx, pending) = {
            let (tx, rx) = mpsc::sync_channel(0);
            (tx, rx, Mutex::new(HashMap::new()))
        };
        let plan = plan_permission(
            crate::types::PermissionPolicy::Prompt,
            false,
            &tx,
            &pending,
            &json!(9003),
            Some(&prompt_params("sess-1", json!({"kind": "read"}))),
        );
        assert_eq!(
            plan,
            PermissionPlan::Immediate(PermissionOutcome::Select("reject-1".into())),
            "a full queue must fail closed with the reject-style option"
        );
        assert!(pending.lock().unwrap().is_empty());
    }

    #[test]
    fn plan_permission_allowlisted_session_allows_without_enqueue() {
        let (tx, rx, pending) = permission_test_args();
        let plan = plan_permission(
            crate::types::PermissionPolicy::Prompt,
            true,
            &tx,
            &pending,
            &json!(9004),
            Some(&prompt_params(
                "sess-1",
                json!({"kind": "edit", "title": "Edit file"}),
            )),
        );
        assert_eq!(
            plan,
            PermissionPlan::Immediate(PermissionOutcome::Select("allow-1".into()))
        );
        assert!(
            rx.try_recv().is_err(),
            "allowlisted sessions must not enqueue"
        );
        assert!(pending.lock().unwrap().is_empty());
    }

    #[test]
    fn plan_permission_allowlisted_session_with_no_options_cancels() {
        let (tx, _rx, pending) = permission_test_args();
        let plan = plan_permission(
            crate::types::PermissionPolicy::Prompt,
            true,
            &tx,
            &pending,
            &json!(9005),
            Some(&json!({"sessionId": "sess-1", "toolCall": {}, "options": []})),
        );
        assert_eq!(
            plan,
            PermissionPlan::Immediate(PermissionOutcome::Cancelled)
        );
    }

    #[test]
    fn plan_permission_auto_read_and_auto_all_unchanged() {
        let (tx, rx, pending) = permission_test_args();
        let read_params = prompt_params("sess-1", json!({"kind": "read"}));
        let edit_params = prompt_params("sess-1", json!({"kind": "edit"}));

        let auto_read_hit = plan_permission(
            crate::types::PermissionPolicy::AutoRead,
            false,
            &tx,
            &pending,
            &json!(9006),
            Some(&read_params),
        );
        assert_eq!(
            auto_read_hit,
            PermissionPlan::Immediate(PermissionOutcome::Select("allow-1".into()))
        );

        let auto_read_miss = plan_permission(
            crate::types::PermissionPolicy::AutoRead,
            false,
            &tx,
            &pending,
            &json!(9007),
            Some(&edit_params),
        );
        assert_eq!(
            auto_read_miss,
            PermissionPlan::Immediate(PermissionOutcome::Select("reject-1".into()))
        );

        let auto_all = plan_permission(
            crate::types::PermissionPolicy::AutoAll,
            false,
            &tx,
            &pending,
            &json!(9008),
            Some(&edit_params),
        );
        assert_eq!(
            auto_all,
            PermissionPlan::Immediate(PermissionOutcome::Select("allow-1".into()))
        );

        assert!(rx.try_recv().is_err(), "auto policies must not enqueue");
        assert!(pending.lock().unwrap().is_empty());
    }

    #[test]
    fn parse_initialize_result_lenient() {
        let result = json!({
            "protocolVersion": 1,
            "agentCapabilities": {
                "loadSession": true,
                "promptCapabilities": {"image": true, "audio": false, "embeddedContext": true},
                "mcpCapabilities": {"http": true, "sse": false},
                "sessionCapabilities": {"list": {}, "close": {}, "future": {"surprise": true}}
            },
            "agentInfo": {"name": "mock", "version": "0.1.0", "title": "Mock Agent"}
        });
        let parsed = parse_initialize_result(&result);
        assert_eq!(parsed.protocol_version, 1);
        let caps = &parsed.agent_capabilities;
        assert_eq!(caps.load_session, Some(true));
        assert_eq!(caps.prompt.as_ref().unwrap().image, Some(true));
        assert_eq!(caps.prompt.as_ref().unwrap().embedded_context, Some(true));
        assert_eq!(caps.mcp.as_ref().unwrap().http, Some(true));
        let session = caps.session.as_ref().unwrap();
        assert!(session.list);
        assert!(session.close);
        assert!(!session.delete);
        let info = parsed.agent_info.unwrap();
        assert_eq!(info.name, "mock");
        assert_eq!(info.title.as_deref(), Some("Mock Agent"));
    }

    #[test]
    fn parse_initialize_result_tolerates_missing_blocks() {
        let result = json!({"protocolVersion": 1});
        let parsed = parse_initialize_result(&result);
        assert_eq!(parsed.protocol_version, 1);
        assert!(parsed.agent_capabilities.prompt.is_none());
        assert!(parsed.agent_info.is_none());
        assert!(parsed.auth_methods.is_empty());
    }

    #[test]
    fn parse_session_update_message_chunk() {
        let update = json!({
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "hi"},
            "messageId": "m1"
        });
        match parse_session_update(&update) {
            SessionUpdate::AgentMessageChunk(chunk) => {
                assert_eq!(chunk.message_id.as_deref(), Some("m1"));
                assert_eq!(chunk.content, ContentBlock::Text { text: "hi".into() });
            }
            other => panic!("expected AgentMessageChunk, got {other:?}"),
        }
    }

    #[test]
    fn parse_session_update_thought_chunk() {
        let update = json!({
            "sessionUpdate": "agent_thought_chunk",
            "content": {"type": "text", "text": "hmm"}
        });
        assert!(matches!(
            parse_session_update(&update),
            SessionUpdate::AgentThoughtChunk(_)
        ));
    }

    #[test]
    fn parse_session_update_tool_call() {
        let update = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "tc-1",
            "title": "Read main.rs",
            "kind": "read",
            "status": "in_progress"
        });
        match parse_session_update(&update) {
            SessionUpdate::ToolCall(call) => {
                assert_eq!(call.tool_call_id, "tc-1");
                assert_eq!(call.kind, Some(crate::types::ToolKind::Read));
                assert_eq!(call.status, Some(crate::types::ToolCallStatus::InProgress));
            }
            other => panic!("expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn parse_session_update_tool_call_update() {
        let update = json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "tc-1",
            "status": "completed"
        });
        match parse_session_update(&update) {
            SessionUpdate::ToolCallUpdate(update) => {
                assert_eq!(update.tool_call_id, "tc-1");
                assert_eq!(update.status, Some(crate::types::ToolCallStatus::Completed));
            }
            other => panic!("expected ToolCallUpdate, got {other:?}"),
        }
    }

    #[test]
    fn parse_session_update_unknown_kind_is_preserved() {
        let update = json!({"sessionUpdate": "usage_update", "used": 42});
        match parse_session_update(&update) {
            SessionUpdate::Other { update, raw } => {
                assert_eq!(update, "usage_update");
                assert_eq!(raw["used"], 42);
            }
            other => panic!("expected Other, got {other:?}"),
        }
    }

    #[test]
    fn parse_session_update_malformed_tool_call_falls_back_to_other() {
        let update = json!({"sessionUpdate": "tool_call", "kind": "read", "status": 7});
        match parse_session_update(&update) {
            SessionUpdate::ToolCall(_) => {}
            SessionUpdate::Other { .. } => {}
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn capabilities_present_treats_null_and_false_as_absent() {
        let value = json!({"a": {}, "b": null, "c": false, "d": true});
        assert!(capabilities_present(&value, "a"));
        assert!(!capabilities_present(&value, "b"));
        assert!(!capabilities_present(&value, "c"));
        assert!(capabilities_present(&value, "d"));
        assert!(!capabilities_present(&value, "missing"));
    }

    #[test]
    fn stop_reason_from_wire() {
        assert_eq!(StopReason::from_wire("end_turn"), StopReason::EndTurn);
        assert_eq!(StopReason::from_wire("cancelled"), StopReason::Cancelled);
        assert_eq!(
            StopReason::from_wire("some_future_reason"),
            StopReason::Other("some_future_reason".into())
        );
    }
}
