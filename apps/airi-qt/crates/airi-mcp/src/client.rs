// SPDX-License-Identifier: GPL-3.0-or-later

//! The stdio MCP client: spawns the server, speaks newline-delimited
//! JSON-RPC 2.0, routes responses to their requests by id.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde_json::Value;

use crate::error::McpError;
use crate::jsonrpc::{
    self, normalize_response_id, parse_initialize_result, parse_tool_result, parse_tools_list,
    response_to_result, JsonRpcNotification, JsonRpcRequest,
};
use crate::types::{
    McpInitializeResult, McpToolDescriptor, McpToolResult, CLIENT_NAME, DEFAULT_REQUEST_TIMEOUT,
};

type PendingMap = HashMap<u64, mpsc::Sender<Result<Value, McpError>>>;

/// A JSON-RPC client for a single MCP server reached over its stdio pipes.
///
/// Spawns `command` as a child process, wires its stdin/stdout, and runs a
/// background reader thread that parses newline-delimited JSON-RPC messages
/// from the child's stdout and routes responses back to the request that was
/// waiting for them (matched by id). stderr is drained into `tracing` so a
/// chatty server cannot block on a full pipe.
///
/// The wire protocol is JSON-RPC 2.0 as specified by the MCP spec for stdio
/// transports: one JSON object per line, requests carry a numeric id,
/// notifications do not.
///
/// Behaviour notes vs the Electron implementation
/// (`apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts`,
/// which uses `@modelcontextprotocol/sdk`):
///
/// * **Environment**: provided `env` entries are layered on top of the
///   inherited parent environment (`Command::env` semantics). The SDK merged
///   its own safe-default environment plus the provided map; inheriting the
///   parent env is the closest std-only equivalent and is generally what you
///   want for `npx`-style launchers.
/// * **Timeout**: a single per-request timeout of 5 s by default, raisable
///   via [`McpStdioClient::set_timeout`]. The Electron code used a 10 s
///   request timeout with a 15 s `maxTotalTimeout` for retries; there is no
///   retry in this client — one request, one response, one timeout.
/// * **Timeouts/errors are typed**: spawn failure, transport loss, JSON-RPC
///   error object, timeout, and protocol violations are distinct
///   [`McpError`] variants.
/// * **Server-initiated requests** (e.g. `roots/list`, `sampling/…`) are
///   answered with a `-32601` (method not found) error so the server does not
///   block forever; notifications from the server are ignored.
/// * **Streamable HTTP** is not implemented here. It maps to
///   [`McpError::UnsupportedTransport`] if a caller tries to force it.
pub struct McpStdioClient {
    child: Option<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<PendingMap>>,
    reader: Option<JoinHandle<()>>,
    next_id: AtomicU64,
    timeout: Duration,
    closed: Arc<AtomicBool>,
}

impl McpStdioClient {
    /// Spawns `command` with `args` and optional extra environment entries.
    ///
    /// `env` is layered on top of the inherited process environment; pass
    /// `None` to inherit the environment unchanged.
    ///
    /// The server is not initialised by this call — use
    /// [`McpStdioClient::initialize`] to complete the MCP handshake before
    /// listing or calling tools.
    pub fn spawn(
        command: &str,
        args: &[&str],
        env: Option<&[(String, String)]>,
    ) -> Result<Self, McpError> {
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

        let mut child = cmd.spawn().map_err(McpError::Spawn)?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| McpError::Protocol("child stdin pipe unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| McpError::Protocol("child stdout pipe unavailable".into()))?;
        let stderr = child.stderr.take();

        let stdin = Arc::new(Mutex::new(stdin));
        let pending: Arc<Mutex<PendingMap>> = Arc::new(Mutex::new(HashMap::new()));
        let closed = Arc::new(AtomicBool::new(false));

        if let Some(stderr) = stderr {
            std::thread::Builder::new()
                .name("airi-mcp-stderr".into())
                .spawn(move || {
                    for line in BufReader::new(stderr).lines() {
                        match line {
                            Ok(line) => {
                                let trimmed = line.trim_end();
                                if !trimmed.is_empty() {
                                    tracing::debug!(target: "airi-mcp", "server stderr: {trimmed}");
                                }
                            }
                            Err(_) => break,
                        }
                    }
                })
                .map_err(|e| {
                    McpError::Transport(format!("failed to spawn stderr drain thread: {e}"))
                })?;
        }

        let reader = {
            let pending = Arc::clone(&pending);
            let closed = Arc::clone(&closed);
            let stdin = Arc::clone(&stdin);
            std::thread::Builder::new()
                .name("airi-mcp-reader".into())
                .spawn(move || reader_loop(stdout, pending, closed, stdin))
                .map_err(|e| McpError::Transport(format!("failed to spawn reader thread: {e}")))?
        };

        Ok(Self {
            child: Some(child),
            stdin,
            pending,
            reader: Some(reader),
            next_id: AtomicU64::new(1),
            timeout: DEFAULT_REQUEST_TIMEOUT,
            closed,
        })
    }

    /// Overrides the per-request timeout. Defaults to 5 s (see
    /// [`DEFAULT_REQUEST_TIMEOUT`]).
    pub fn set_timeout(&mut self, timeout: Duration) {
        self.timeout = timeout;
    }

    /// Returns the current per-request timeout.
    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    /// Returns the OS process id of the server, when it is running.
    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(Child::id)
    }

    /// Returns `true` once the server has closed its output stream or the
    /// client has been shut down.
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Performs the MCP `initialize` handshake and then sends the
    /// `notifications/initialized` notification.
    ///
    /// Negotiates protocol version `"2024-11-05"` with empty client
    /// capabilities and clientInfo `{ name: "airi-mcp", version: <crate
    /// version> }`. The server's reported protocol version is surfaced in
    /// [`McpInitializeResult::protocol_version`] but is not validated.
    pub fn initialize(&mut self) -> Result<McpInitializeResult, McpError> {
        let params = jsonrpc::initialize_params(CLIENT_NAME, env!("CARGO_PKG_VERSION"));
        let result = self.send_request("initialize", params)?;
        let parsed = parse_initialize_result(&result);
        self.send_notification(
            "notifications/initialized",
            Value::Object(Default::default()),
        )?;
        Ok(parsed)
    }

    /// Lists the tools the server exposes via `tools/list`.
    ///
    /// Entries without a string `name` are skipped. `inputSchema` (spec) and
    /// `input_schema` (non-standard alias) are both accepted.
    pub fn tools_list(&self) -> Result<Vec<McpToolDescriptor>, McpError> {
        let result = self.send_request("tools/list", Value::Object(Default::default()))?;
        Ok(parse_tools_list(&result))
    }

    /// Calls `tools/call` and returns the structured result.
    ///
    /// `arguments` is sent verbatim as the `arguments` member (the MCP spec
    /// requires an object; servers may reject non-object arguments with a
    /// JSON-RPC error, which surfaces as [`McpError::JsonRpc`]).
    pub fn tools_call(
        &self,
        name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpToolResult, McpError> {
        let params = serde_json::json!({
            "name": name,
            "arguments": arguments,
        });
        let result = self.send_request("tools/call", params)?;
        Ok(parse_tool_result(&result))
    }

    /// Kills the server process and joins the background reader thread.
    ///
    /// Idempotent: dropping the client after `close` is a no-op. Pending
    /// requests are failed with [`McpError::Closed`].
    pub fn close(mut self) {
        self.shutdown();
    }

    /// Sends a request and waits for the response routed by id.
    fn send_request(&self, method: &str, params: Value) -> Result<Value, McpError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(McpError::Closed);
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending_insert(id, tx);

        let request = JsonRpcRequest::new(id, method, params);
        let line = match jsonrpc::encode_line(&request) {
            Ok(line) => line,
            Err(e) => {
                self.pending_remove(id);
                return Err(e);
            }
        };

        if let Err(e) = self.write_line(&line) {
            self.pending_remove(id);
            return Err(e);
        }

        match rx.recv_timeout(self.timeout) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => {
                self.pending_remove(id);
                Err(McpError::Timeout {
                    method: method.to_string(),
                    timeout: self.timeout,
                })
            }
            Err(RecvTimeoutError::Disconnected) => Err(McpError::Closed),
        }
    }

    /// Sends a notification (no id, no response expected).
    fn send_notification(&self, method: &str, params: Value) -> Result<(), McpError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(McpError::Closed);
        }
        let notification = JsonRpcNotification::new(method, params);
        let line = jsonrpc::encode_line(&notification)?;
        self.write_line(&line)
    }

    fn write_line(&self, line: &str) -> Result<(), McpError> {
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|_| McpError::Transport("stdin lock poisoned".into()))?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|()| stdin.flush())
            .map_err(|e| McpError::Transport(format!("failed to write to server stdin: {e}")))
    }

    fn pending_insert(&self, id: u64, tx: mpsc::Sender<Result<Value, McpError>>) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, tx);
        }
    }

    fn pending_remove(&self, id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
    }

    /// Shared shutdown path for `close` and `Drop`.
    fn shutdown(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
        // Fail all in-flight requests instead of letting callers wait out the timeout.
        if let Ok(mut pending) = self.pending.lock() {
            for (_, tx) in pending.drain() {
                let _ = tx.send(Err(McpError::Closed));
            }
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

impl Drop for McpStdioClient {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Background reader: parses JSON-RPC lines from the child's stdout and routes
/// responses to pending requests by id.
fn reader_loop(
    stdout: std::process::ChildStdout,
    pending: Arc<Mutex<PendingMap>>,
    closed: Arc<AtomicBool>,
    stdin: Arc<Mutex<ChildStdin>>,
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
                    Ok(message) => handle_message(&message, &pending, &stdin),
                    Err(e) => {
                        tracing::debug!(target: "airi-mcp", "ignoring non-JSON line from server: {e}");
                    }
                }
            }
            Err(e) => {
                tracing::debug!(target: "airi-mcp", "stdout read error: {e}");
                break;
            }
        }
    }

    closed.store(true, Ordering::SeqCst);
    // EOF: fail every pending request so callers wake up with `Closed`.
    if let Ok(mut pending) = pending.lock() {
        for (_, tx) in pending.drain() {
            let _ = tx.send(Err(McpError::Closed));
        }
    }
}

/// Classifies one parsed message and dispatches it.
fn handle_message(message: &Value, pending: &Mutex<PendingMap>, stdin: &Mutex<ChildStdin>) {
    let has_method = message.get("method").is_some();
    let id = message.get("id").cloned();

    match (has_method, id) {
        // Server-initiated request: answer with -32601 so the server does not hang.
        (true, Some(id_value)) => {
            let reply = serde_json::json!({
                "jsonrpc": "2.0",
                "id": id_value,
                "error": {
                    "code": -32601,
                    "message": "client does not support server-initiated requests"
                }
            });
            if let Ok(line) = jsonrpc::encode_line(&reply) {
                if let Ok(mut stdin) = stdin.lock() {
                    let _ = stdin.write_all(line.as_bytes());
                    let _ = stdin.flush();
                }
            }
        }
        // Notification: nothing to route.
        (true, None) => {
            tracing::trace!(target: "airi-mcp", method = ?message.get("method"), "ignoring server notification");
        }
        // Response: route by id.
        (false, Some(id_value)) => {
            let Some(key) = normalize_response_id(&id_value) else {
                tracing::debug!(target: "airi-mcp", "dropping response with unusable id: {id_value}");
                return;
            };
            let result = response_to_result(message);
            let tx = pending.lock().ok().and_then(|mut map| map.remove(&key));
            match tx {
                Some(tx) => {
                    let _ = tx.send(result);
                }
                None => {
                    tracing::debug!(target: "airi-mcp", "dropping response for unknown id {key}");
                }
            }
        }
        (false, None) => {
            tracing::debug!(target: "airi-mcp", "ignoring message with neither method nor id");
        }
    }
}
