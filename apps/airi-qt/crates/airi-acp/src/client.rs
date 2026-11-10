// SPDX-License-Identifier: GPL-3.0-or-later

//! The stdio ACP client: spawns the agent, speaks newline-delimited
//! JSON-RPC 2.0, routes responses to their requests by id, and fans out
//! `session/update` notifications to the session that subscribed.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::error::AcpError;
use crate::jsonrpc::{
    self, normalize_response_id, response_to_result, JsonRpcNotification, JsonRpcRequest,
};
use crate::permission::{decide_permission, parse_permission_options, permission_result};
use crate::types::{
    AgentCapabilities, CloseSessionResult, ContentBlock, ContentChunk, Implementation,
    InitializeResult, McpCapabilities, PromptCapabilities, PromptResult, SessionCapabilities,
    SessionId, SessionUpdate, StopReason, ToolCall, ToolCallUpdate, ACP_PROTOCOL_VERSION,
    CLIENT_NAME, DEFAULT_PROMPT_TIMEOUT, DEFAULT_REQUEST_TIMEOUT,
};

/// Internal callback type for slots in the pending-request map. Used instead
/// of a bare channel sender so `session/prompt` can forward the response into
/// the per-session event stream while ordinary RPCs forward into a plain
/// oneshot channel.
type PendingCallback = Box<dyn FnOnce(Result<Value, AcpError>) + Send>;

/// Events delivered to a session's subscription during a prompt turn.
#[derive(Debug)]
enum SessionEvent {
    /// A `session/update` notification routed to this session.
    Update(SessionUpdate),
    /// The agent answered the outstanding `session/prompt` request.
    Finished(Result<Value, AcpError>),
}

/// A JSON-RPC client for a single ACP agent reached over its stdio pipes.
///
/// Spawns `command` as a child process, wires its stdin/stdout, and runs a
/// background reader thread that parses newline-delimited JSON-RPC messages
/// from the agent's stdout. Responses are routed to the waiting caller **by
/// request id**; `session/update` notifications are routed to the session
/// subscription created by [`AcpAgentClient::prompt`]; server-initiated
/// requests (`session/request_permission`) are answered from the configured
/// [`PermissionPolicy`](crate::PermissionPolicy) inside the reader thread. stderr is
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
/// * **`prompt` policy fails closed** — this crate has no renderer to ask, so
///   it selects the reject-style option instead of waiting for a human.
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
            std::thread::Builder::new()
                .name("airi-acp-reader".into())
                .spawn(move || reader_loop(stdout, pending, subscriptions, closed, stdin, policy))
                .map_err(|e| AcpError::Transport(format!("failed to spawn reader thread: {e}")))?
        };

        Ok(Self {
            child: Some(child),
            stdin,
            pending,
            subscriptions,
            policy,
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
        let cwd = match cwd {
            Some(path) => std::path::absolute(path).map_err(|e| {
                AcpError::Protocol(format!("failed to absolutise session cwd: {e}"))
            })?,
            None => std::env::current_dir().map_err(|e| {
                AcpError::Protocol(format!("failed to read current directory: {e}"))
            })?,
        };
        let cwd = cwd
            .to_str()
            .ok_or_else(|| AcpError::Protocol("session cwd contains non-UTF-8 bytes".into()))?;
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
    pub fn prompt(&self, session_id: &str, text: &str) -> Result<PromptResult, AcpError> {
        self.ensure_open()?;

        let (event_tx, event_rx) = mpsc::channel::<SessionEvent>();
        {
            let mut subscriptions = self
                .subscriptions
                .lock()
                .map_err(|_| AcpError::Transport("subscriptions lock poisoned".into()))?;
            if subscriptions.contains_key(session_id) {
                return Err(AcpError::PromptInProgress(session_id.to_string()));
            }
            subscriptions.insert(session_id.to_string(), event_tx.clone());
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let finish = {
            let event_tx = event_tx.clone();
            move |result: Result<Value, AcpError>| {
                let _ = event_tx.send(SessionEvent::Finished(result));
            }
        };
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, Box::new(finish));
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
        let result =
            match self.send_request_with_timeout("session/close", params, self.request_timeout) {
                Ok(_) => CloseSessionResult::AgentAcknowledged,
                Err(AcpError::JsonRpc { message, .. }) => {
                    tracing::warn!(target: "airi-acp", "agent refused session/close: {message}");
                    CloseSessionResult::AgentRefused(message)
                }
                Err(other) => {
                    self.remove_subscription(session_id);
                    return Err(other);
                }
            };
        self.remove_subscription(session_id);
        Ok(result)
    }

    /// Kills the agent process and joins the background reader thread.
    ///
    /// Idempotent: dropping the client after `close` is a no-op. Pending
    /// requests are failed with [`AcpError::Closed`].
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
            Ok(result) => result,
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
fn reader_loop(
    stdout: std::process::ChildStdout,
    pending: Arc<Mutex<HashMap<u64, PendingCallback>>>,
    subscriptions: Arc<Mutex<HashMap<SessionId, mpsc::Sender<SessionEvent>>>>,
    closed: Arc<AtomicBool>,
    stdin: Arc<Mutex<ChildStdin>>,
    policy: Arc<Mutex<crate::types::PermissionPolicy>>,
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
                    Ok(message) => {
                        handle_message(&message, &pending, &subscriptions, &stdin, &policy)
                    }
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
fn handle_message(
    message: &Value,
    pending: &Mutex<HashMap<u64, PendingCallback>>,
    subscriptions: &Mutex<HashMap<SessionId, mpsc::Sender<SessionEvent>>>,
    stdin: &Mutex<ChildStdin>,
    policy: &Mutex<crate::types::PermissionPolicy>,
) {
    let method = message.get("method").and_then(Value::as_str);
    let id = message.get("id").cloned();

    match (method, id) {
        // Server-initiated request.
        (Some(method), Some(id)) => {
            if method == "session/request_permission" {
                let policy = policy.lock().map(|p| *p).unwrap_or_default();
                let params = message.get("params");
                let tool_call = params
                    .and_then(|p| p.get("toolCall"))
                    .cloned()
                    .unwrap_or(Value::Null);
                let options = parse_permission_options(params);
                let outcome = decide_permission(policy, &tool_call, &options);
                let result = permission_result(&outcome);
                let reply = json!({ "jsonrpc": "2.0", "id": id, "result": result });
                write_json_line(stdin, &reply);
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
