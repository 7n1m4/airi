// SPDX-License-Identifier: GPL-3.0-or-later
//! ACP (Agent Client Protocol) bridge (`AcpState`) exposed to Slint.
//!
//! Drives the ACP settings page: reads/writes the app's own ACP agent config
//! file (`<profile>/airi/acp.json`, or the
//! platform data dir when `--profile` is not set — same convention as
//! Electron's `appData/airi/acp.json`), spawns configured agents through
//! `airi-acp` (`initialize` + `session/new` with `cwd` = the profile
//! directory), and runs one prompt turn at a time.
//!
//! Streaming: `prompt_agent` starts a turn with `prompt_stream`; updates are
//! accumulated into `transcript_json` (`[{"kind", "text"}]`) by `pump_updates`,
//! which the UI calls on a 100 ms timer (same pump idiom as the chat bridge).
//! Permission requests from the agent are enqueued by the `prompt`
//! permission policy; `pump_updates` transfers them into
//! `pending_permission_json` (`null` when nothing is pending). The page
//! renders a modal and calls `answer_permission`.
//!
//! Honesty contract: the configured agent list shown in the UI is read from
//! disk or is empty — never a fabricated default. The `fs/*` and
//! `terminal/*` client methods are not implemented in `airi-acp` (empty
//! `clientCapabilities`), so agents that want to touch the filesystem or
//! spawn terminals must be denied by policy or will ask and be answered
//! with whatever the human picks.
//!
//! Boundary contract (same as the cards/providers/data bridges): the agent
//! list and transcript are plain Rust values; the JSON document strings are
//! only the persistence format and the D-Bus wire.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::mpsc::{self, TryRecvError};
use std::sync::{Arc, Mutex};

use airi_acp::{
    AcpAgentClient, PermissionPolicy, PermissionRequest, PromptDecision, SessionEvent,
    SessionUpdate, ToolCallStatus, ToolCallUpdate,
};
use serde_json::json;

use crate::bridges;

/// `<profile>/airi/acp.json` or `<platform-data>/airi-slint/acp.json`.
fn acp_config_path() -> std::path::PathBuf {
    bridges::profile_dir()
        .map(|p| p.join("airi").join("acp.json"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint").join("acp.json")))
        .unwrap_or_else(|| std::path::PathBuf::from("acp.json"))
}

/// One configured agent entry (mirrors the Electron `acpConfigSchema`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpAgentEntry {
    /// Command to spawn (e.g. `npx`).
    pub command: String,
    /// Stdio arguments.
    #[serde(default)]
    pub args: Vec<String>,
    /// Environment overrides for the agent process (layered on the
    /// inherited environment).
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Whether the agent is enabled.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// `prompt` | `auto-read` | `auto-all` (Electron `permissionPolicy`).
    #[serde(default = "default_permission_policy", rename = "permissionPolicy")]
    pub permission_policy: String,
}

fn default_enabled() -> bool {
    true
}

fn default_permission_policy() -> String {
    "prompt".to_string()
}

/// The whole config file: `{"agents": {name: entry}}`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AcpConfigFile {
    /// Configured agents by name.
    #[serde(default)]
    pub agents: BTreeMap<String, AcpAgentEntry>,
}

/// Load the config file; `None` when missing, `Err` when unreadable.
fn load_config() -> Result<Option<AcpConfigFile>, String> {
    let path = acp_config_path();
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| format!("{} is not a valid acp.json: {e}", path.display()))
}

fn save_config(config: &AcpConfigFile) -> Result<(), String> {
    let path = acp_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize config: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("failed to rename {}: {e}", path.display()))
}

/// Wire form -> typed policy. Unknown values fall back to `Prompt` (the safe
/// default: ask the human).
fn policy_from_str(value: &str) -> PermissionPolicy {
    match value {
        "auto-read" => PermissionPolicy::AutoRead,
        "auto-all" => PermissionPolicy::AutoAll,
        _ => PermissionPolicy::Prompt,
    }
}

fn policy_is_valid(value: &str) -> bool {
    matches!(value, "prompt" | "auto-read" | "auto-all")
}

fn agents_value(config: Option<&AcpConfigFile>) -> Vec<serde_json::Value> {
    config
        .map(|c| {
            c.agents
                .iter()
                .map(|(name, entry)| {
                    let summary = format!("{} {}", entry.command, entry.args.join(" "))
                        .trim()
                        .to_string();
                    json!({
                        "name": name,
                        "command": entry.command,
                        "args": entry.args,
                        "env": entry.env,
                        "enabled": entry.enabled,
                        "permissionPolicy": entry.permission_policy,
                        "summary": summary,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// One transcript entry. `kind` is one of `user`, `agent`, `thought`,
/// `tool`, `plan`, `system`, `other`.
#[derive(Debug, Clone, Serialize)]
struct TranscriptEntry {
    kind: String,
    text: String,
}

/// Extract the human-readable text of a permission request for the pending
/// payload (`null`-free; the modal renders title/kind from `toolCall`).
fn permission_request_json(request: &PermissionRequest) -> serde_json::Value {
    json!({
        "requestId": request.request_id,
        "sessionId": request.session_id,
        "toolCall": request.tool_call,
        "options": request
            .options
            .iter()
            .map(|o| json!({ "optionId": o.option_id, "name": o.name, "kind": o.kind }))
            .collect::<Vec<_>>(),
    })
}

/// ACP agents view-model (one process-wide instance).
pub struct AcpState {
    /// JSON array of configured agents (from `acp.json`).
    pub agents_json: String,
    /// Name of the running agent (`""` when stopped).
    pub active_agent: String,
    /// Session id of the running agent (`""` when stopped).
    pub session_id: String,
    /// `stopped` | `running` | `error`.
    pub agent_state: String,
    /// Last error line.
    pub last_error: String,
    /// `true` while a turn is in flight.
    pub working: bool,
    /// JSON array of `{kind, text}` transcript rows.
    pub transcript_json: String,
    /// JSON of the pending permission request (`null` when none).
    pub pending_permission_json: String,

    client: Option<AcpAgentClient>,
    session_id_inner: Option<String>,
    transcript: Vec<TranscriptEntry>,
    events: Option<mpsc::Receiver<SessionEvent>>,
    permission_requests: Option<Arc<Mutex<mpsc::Receiver<PermissionRequest>>>>,
    pending_permissions: Vec<PermissionRequest>,
}

impl Default for AcpState {
    fn default() -> Self {
        Self {
            agents_json: "[]".to_string(),
            active_agent: String::new(),
            session_id: String::new(),
            agent_state: "stopped".to_string(),
            last_error: String::new(),
            working: false,
            transcript_json: "[]".to_string(),
            pending_permission_json: "null".to_string(),
            client: None,
            session_id_inner: None,
            transcript: Vec::new(),
            events: None,
            permission_requests: None,
            pending_permissions: Vec::new(),
        }
    }
}

impl AcpState {
    fn set_error(&mut self, message: String) {
        self.last_error = message;
    }

    fn clear_error(&mut self) {
        self.last_error = String::new();
    }

    fn apply_agent_state(&mut self, state: &str) {
        self.agent_state = state.to_string();
    }

    fn apply_working(&mut self, working: bool) {
        self.working = working;
    }

    fn publish_transcript(&mut self) {
        self.transcript_json =
            serde_json::to_string(&self.transcript).unwrap_or_else(|_| "[]".to_string());
    }

    fn push_transcript_entry(&mut self, kind: &str, text: &str) {
        if text.is_empty() {
            return;
        }
        // Coalesce consecutive chunks of the same speaker into one entry
        // so a streaming reply does not flood the transcript with one
        // row per token.
        let mut coalesced = false;
        if matches!(kind, "agent" | "thought" | "user") {
            if let Some(last) = self.transcript.last_mut() {
                if last.kind == kind {
                    last.text.push_str(text);
                    coalesced = true;
                }
            }
        }
        if !coalesced {
            self.transcript.push(TranscriptEntry {
                kind: kind.to_string(),
                text: text.to_string(),
            });
        }
        self.publish_transcript();
    }

    fn publish_pending_permission_json(&mut self) {
        self.pending_permission_json = match self.pending_permissions.first() {
            Some(request) => permission_request_json(request).to_string(),
            None => "null".to_string(),
        };
    }

    fn reload_agents(&mut self) {
        let (agents, error) = match load_config() {
            Ok(Some(config)) => (agents_value(Some(&config)), None),
            Ok(None) => (Vec::new(), None),
            Err(e) => (Vec::new(), Some(e)),
        };
        self.agents_json = serde_json::to_string(&agents).unwrap_or_else(|_| "[]".to_string());
        if let Some(e) = error {
            self.set_error(e);
        } else {
            self.clear_error();
        }
    }

    /// Re-read the config file.
    pub fn refresh_agents(&mut self) {
        self.reload_agents();
    }

    /// Add a stdio agent entry.
    pub fn add_stdio_agent(
        &mut self,
        name: &str,
        command: &str,
        args_json: &str,
        env_json: &str,
        permission_policy: &str,
    ) -> bool {
        self.clear_error();
        let name = name.to_string();
        let command = command.to_string();
        if name.trim().is_empty() || command.trim().is_empty() {
            self.set_error("name and command must not be empty".into());
            return false;
        }
        let args: Vec<String> = match serde_json::from_str(args_json) {
            Ok(a) => a,
            Err(e) => {
                self.set_error(format!("args must be a JSON array of strings: {e}"));
                return false;
            }
        };
        let env_text = env_json;
        let env: BTreeMap<String, String> = if env_text.trim().is_empty() {
            BTreeMap::new()
        } else {
            match serde_json::from_str::<serde_json::Value>(env_text) {
                Ok(serde_json::Value::Object(map)) => map
                    .into_iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
                    .collect(),
                Ok(_) => {
                    self.set_error("env must be a JSON object of string values".into());
                    return false;
                }
                Err(e) => {
                    self.set_error(format!("env must be a JSON object of string values: {e}"));
                    return false;
                }
            }
        };
        let permission_policy = permission_policy.to_string();
        if !policy_is_valid(&permission_policy) {
            self.set_error(format!(
                "permissionPolicy must be one of prompt | auto-read | auto-all, got {permission_policy:?}"
            ));
            return false;
        }
        let mut config = load_config().ok().flatten().unwrap_or_default();
        config.agents.insert(
            name,
            AcpAgentEntry {
                command,
                args,
                env,
                enabled: true,
                permission_policy,
            },
        );
        match save_config(&config) {
            Ok(()) => {
                self.reload_agents();
                true
            }
            Err(e) => {
                self.set_error(e);
                false
            }
        }
    }

    /// Remove an agent by name. Stops it first when it is the active agent.
    pub fn remove_agent(&mut self, name: &str) -> bool {
        self.clear_error();
        if self.active_agent == name {
            self.stop_active_agent();
        }
        let mut config = match load_config().ok().flatten() {
            Some(c) => c,
            None => {
                self.set_error("no acp.json to modify".into());
                return false;
            }
        };
        let removed = config.agents.remove(name).is_some();
        match save_config(&config) {
            Ok(()) => {
                self.reload_agents();
                removed
            }
            Err(e) => {
                self.set_error(e);
                false
            }
        }
    }

    /// Enable/disable an agent.
    pub fn set_agent_enabled(&mut self, name: &str, enabled: bool) -> bool {
        self.set_agent_field(name, |entry| entry.enabled = enabled)
    }

    /// Set the permission policy of an agent; live-applies to the running
    /// agent when it is the active one.
    pub fn set_agent_permission_policy(&mut self, name: &str, policy: &str) -> bool {
        if !policy_is_valid(policy) {
            self.set_error(format!(
                "permissionPolicy must be one of prompt | auto-read | auto-all, got {policy:?}"
            ));
            return false;
        }
        let is_active = self.active_agent == name;
        let ok = self.set_agent_field(name, |entry| entry.permission_policy = policy.to_string());
        if ok && is_active {
            if let Some(client) = self.client.as_ref() {
                client.set_permission_policy(policy_from_str(policy));
            }
        }
        ok
    }

    /// Shared read-modify-write for a single agent entry.
    fn set_agent_field(&mut self, name: &str, mutate: impl FnOnce(&mut AcpAgentEntry)) -> bool {
        self.clear_error();
        let mut config = match load_config().ok().flatten() {
            Some(c) => c,
            None => {
                self.set_error("no acp.json to modify".into());
                return false;
            }
        };
        match config.agents.get_mut(name) {
            Some(entry) => mutate(entry),
            None => {
                self.set_error(format!("agent {name:?} is not configured"));
                return false;
            }
        }
        match save_config(&config) {
            Ok(()) => {
                self.reload_agents();
                true
            }
            Err(e) => {
                self.set_error(e);
                false
            }
        }
    }

    /// Start an agent.
    pub fn start_agent(&mut self, name: &str) -> bool {
        self.clear_error();
        if self.client.is_some() {
            self.set_error("an agent is already running — stop it before starting another".into());
            return false;
        }
        let config = match load_config() {
            Ok(Some(c)) => c,
            Ok(None) => {
                self.set_error("no acp.json configured — add an agent first".into());
                return false;
            }
            Err(e) => {
                self.set_error(e);
                return false;
            }
        };
        let Some(entry) = config.agents.get(name) else {
            self.set_error(format!("agent {name:?} is not configured"));
            return false;
        };
        if !entry.enabled {
            self.set_error(format!("agent {name:?} is disabled"));
            return false;
        }
        let args: Vec<&str> = entry.args.iter().map(String::as_str).collect();
        let env: Option<Vec<(String, String)>> = if entry.env.is_empty() {
            None
        } else {
            Some(
                entry
                    .env
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
            )
        };
        let spawn_result = AcpAgentClient::spawn(&entry.command, &args, env.as_deref());
        let client = match spawn_result {
            Ok(client) => client,
            Err(e) => {
                self.set_error(format!("failed to spawn {}: {e}", entry.command));
                self.apply_agent_state("error");
                return false;
            }
        };
        client.set_permission_policy(policy_from_str(&entry.permission_policy));
        if let Err(e) = client.initialize() {
            self.set_error(format!("initialize failed: {e}"));
            self.apply_agent_state("error");
            drop(client);
            return false;
        }
        let cwd = bridges::profile_dir()
            .cloned()
            .or_else(|| std::env::current_dir().ok());
        let session_id = match client.new_session(cwd.as_deref()) {
            Ok(session_id) => session_id,
            Err(e) => {
                self.set_error(format!("session/new failed: {e}"));
                self.apply_agent_state("error");
                drop(client);
                return false;
            }
        };
        let permission_requests = client.permission_requests();
        self.client = Some(client);
        self.session_id_inner = Some(session_id.clone());
        self.permission_requests = Some(permission_requests);
        self.transcript.clear();
        self.events = None;
        self.pending_permissions.clear();
        self.publish_transcript();
        self.publish_pending_permission_json();
        self.active_agent = name.to_string();
        self.session_id = session_id;
        self.apply_working(false);
        self.apply_agent_state("running");
        true
    }

    /// Stop the running agent. Idempotent.
    pub fn stop_agent(&mut self) -> bool {
        self.stop_active_agent();
        true
    }

    /// Stop whatever agent is running; drop runtime state.
    fn stop_active_agent(&mut self) {
        let (client, session_id) = (self.client.take(), self.session_id_inner.take());
        if let Some(client) = client {
            if let Some(session_id) = &session_id {
                if let Err(e) = client.close_session(session_id) {
                    tracing::warn!(target: "airi-slint", "session/close failed during stop: {e}");
                }
            }
            client.close();
        }
        self.events = None;
        self.permission_requests = None;
        self.pending_permissions.clear();
        self.publish_pending_permission_json();
        self.active_agent = String::new();
        self.session_id = String::new();
        self.apply_working(false);
        self.apply_agent_state("stopped");
    }

    /// Send a prompt and start streaming updates.
    pub fn prompt_agent(&mut self, text: &str) -> bool {
        self.clear_error();
        let text = text.to_string();
        if text.trim().is_empty() {
            self.set_error("prompt must not be empty".into());
            return false;
        }
        if self.working {
            self.set_error(
                "a turn is already in flight — cancel it or wait for it to finish".into(),
            );
            return false;
        }
        let session_id = match self.session_id_inner.clone() {
            Some(session_id) => session_id,
            None => {
                self.set_error("no agent running — start one first".into());
                return false;
            }
        };
        let Some(client) = self.client.as_ref() else {
            self.set_error("no agent running — start one first".into());
            return false;
        };
        let events = match client.prompt_stream(&session_id, &text) {
            Ok(events) => events,
            Err(e) => {
                self.set_error(format!("failed to send session/prompt: {e}"));
                return false;
            }
        };
        self.events = Some(events);
        self.push_transcript_entry("user", text.trim());
        self.apply_working(true);
        true
    }

    /// Cancel the in-flight turn.
    pub fn cancel_prompt(&mut self) -> bool {
        self.clear_error();
        let session_id = self.session_id_inner.clone();
        let Some(session_id) = session_id else {
            self.set_error("no agent running".into());
            return false;
        };
        let result = self
            .client
            .as_ref()
            .map(|client| client.cancel(&session_id));
        match result {
            Some(Ok(())) => true,
            Some(Err(e)) => {
                self.set_error(format!("failed to send session/cancel: {e}"));
                false
            }
            None => {
                self.set_error("no agent running".into());
                false
            }
        }
    }

    /// Answer a pending permission request.
    pub fn answer_permission(&mut self, request_id: &str, decision: &str) -> bool {
        self.clear_error();
        let decision = match decision {
            "allow_once" => PromptDecision::AllowOnce,
            "allow_session" => PromptDecision::AllowSession,
            "reject" => PromptDecision::Reject,
            other => {
                self.set_error(format!(
                    "decision must be one of allow_once | allow_session | reject, got {other:?}"
                ));
                return false;
            }
        };
        let result = self
            .client
            .as_ref()
            .map(|client| client.answer_permission(request_id, decision));
        match result {
            Some(Ok(())) => {}
            Some(Err(e)) => {
                self.set_error(format!("failed to answer permission {request_id:?}: {e}"));
                return false;
            }
            None => {
                self.set_error("no agent running".into());
                return false;
            }
        }
        self.pending_permissions
            .retain(|request| request.request_id != request_id);
        self.publish_pending_permission_json();
        true
    }

    /// Drain agent events and permission requests into the state.
    pub fn pump_updates(&mut self) {
        // Session events (transcript).
        let events = self.events.take();
        if let Some(rx) = events {
            let mut finished = false;
            loop {
                match rx.try_recv() {
                    Ok(SessionEvent::Update(update)) => {
                        self.apply_session_update(update);
                    }
                    Ok(SessionEvent::Finished(result)) => {
                        finished = true;
                        self.apply_turn_finished(result);
                        break;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        finished = true;
                        self.apply_working(false);
                        self.set_error(
                            "the agent closed the turn's event stream unexpectedly".into(),
                        );
                        break;
                    }
                }
            }
            if !finished {
                self.events = Some(rx);
            }
        }

        // Permission requests.
        let permission_requests = self.permission_requests.take();
        if let Some(permission_requests) = permission_requests {
            let mut enqueued_any = false;
            let mut disconnected = false;
            match permission_requests.lock() {
                Ok(guard) => {
                    // Collect out of the std receiver without holding our
                    // borrow of `self` across the loop.
                    let mut drained: Vec<PermissionRequest> = Vec::new();
                    // `try_recv` needs a mutable receiver, which the guard
                    // provides.
                    loop {
                        match guard.try_recv() {
                            Ok(request) => drained.push(request),
                            Err(TryRecvError::Empty) => break,
                            Err(TryRecvError::Disconnected) => {
                                disconnected = true;
                                break;
                            }
                        }
                    }
                    if !drained.is_empty() {
                        self.pending_permissions.extend(drained);
                        enqueued_any = true;
                    }
                }
                Err(_) => {
                    disconnected = true;
                }
            }
            if !disconnected {
                self.permission_requests = Some(permission_requests);
            }
            if enqueued_any {
                self.publish_pending_permission_json();
            }
        }

        // Detect an agent that died while a session is supposed to be live.
        let state = self.agent_state.clone();
        if state == "running" {
            let closed = self
                .client
                .as_ref()
                .map(|client| client.is_closed())
                .unwrap_or(false);
            if closed {
                self.set_error("the agent closed its output stream".into());
                self.apply_working(false);
                self.apply_agent_state("error");
            }
        }
    }

    /// Fold one `session/update` into the transcript.
    fn apply_session_update(&mut self, update: SessionUpdate) {
        match update {
            SessionUpdate::AgentMessageChunk(chunk) => {
                if let Some(text) = content_block_text(&chunk.content) {
                    self.push_transcript_entry("agent", &text);
                }
            }
            SessionUpdate::AgentThoughtChunk(chunk) => {
                if let Some(text) = content_block_text(&chunk.content) {
                    self.push_transcript_entry("thought", &text);
                }
            }
            SessionUpdate::UserMessageChunk(chunk) => {
                if let Some(text) = content_block_text(&chunk.content) {
                    self.push_transcript_entry("user", &text);
                }
            }
            SessionUpdate::ToolCall(call) => {
                let text = if call.title.is_empty() {
                    call.tool_call_id
                } else {
                    call.title
                };
                self.push_transcript_entry("tool", &text);
            }
            SessionUpdate::ToolCallUpdate(update) => {
                let text = tool_call_update_text(&update);
                if let Some(text) = text {
                    self.push_transcript_entry("tool", &text);
                }
            }
            SessionUpdate::Plan(plan) => {
                let text = serde_json::to_string(&plan).unwrap_or_default();
                self.push_transcript_entry("plan", &text);
            }
            SessionUpdate::Other { update, raw } => {
                let text = format!(
                    "{update}: {}",
                    serde_json::to_string(&raw).unwrap_or_default()
                );
                self.push_transcript_entry("other", &text);
            }
        }
    }

    /// Turn-end bookkeeping: stop the spinner, note the stop reason.
    fn apply_turn_finished(&mut self, result: Result<serde_json::Value, airi_acp::AcpError>) {
        self.apply_working(false);
        match result {
            Ok(value) => {
                let stop_reason = value
                    .get("stopReason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                self.push_transcript_entry("system", &format!("turn finished ({stop_reason})"));
            }
            Err(e) => {
                self.set_error(format!("prompt failed: {e}"));
                self.push_transcript_entry("system", &format!("prompt failed: {e}"));
            }
        }
    }
}

/// Process-wide state guarded by a mutex (a poisoned lock is recovered so a
/// panicking agent thread must not wedge the UI).
static STATE: std::sync::Mutex<Option<AcpState>> = std::sync::Mutex::new(None);

/// Lock the process-wide ACP state for a UI-thread operation, creating it on
/// first use.
pub fn with_state<R>(f: impl FnOnce(&mut AcpState) -> R) -> R {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let state = guard.get_or_insert_with(AcpState::default);
    f(state)
}

fn content_block_text(block: &airi_acp::ContentBlock) -> Option<String> {
    match block {
        airi_acp::ContentBlock::Text { text } => Some(text.clone()),
        airi_acp::ContentBlock::Other { .. } => None,
    }
}

fn tool_call_status_str(status: &ToolCallStatus) -> &'static str {
    match status {
        ToolCallStatus::Pending => "pending",
        ToolCallStatus::InProgress => "in_progress",
        ToolCallStatus::Completed => "completed",
        ToolCallStatus::Failed => "failed",
        ToolCallStatus::Other => "other",
    }
}

fn tool_call_update_text(update: &ToolCallUpdate) -> Option<String> {
    if let Some(status) = &update.status {
        return Some(format!(
            "{} → {}",
            update.tool_call_id,
            tool_call_status_str(status)
        ));
    }
    update
        .title
        .as_ref()
        .map(|title| format!("{}: {title}", update.tool_call_id))
}
