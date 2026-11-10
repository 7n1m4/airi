// SPDX-License-Identifier: GPL-3.0-or-later
//! ACP (Agent Client Protocol) bridge (`AcpController`) exposed to QML.
//!
//! Drives the `qml/pages/settings/modules/acp/` page: reads/writes the Qt
//! app's own ACP agent config file (`<profile>/airi/acp.json`, or the
//! platform data dir when `--profile` is not set — same convention as
//! Electron's `appData/airi/acp.json`), spawns configured agents through
//! `airi-acp` (`initialize` + `session/new` with `cwd` = the profile
//! directory), and runs one prompt turn at a time.
//!
//! Streaming: `promptAgent` starts a turn with `prompt_stream`; updates are
//! accumulated into `transcriptJson` (`[{"kind", "text"}]`) by `pumpUpdates`,
//! which QML calls on a 100 ms timer (same pump idiom as the chat/desktop
//! bridges). Permission requests from the agent are enqueued by the
//! `prompt` permission policy; `pumpUpdates` transfers them into
//! `pendingPermissionJson` (`null` when nothing is pending) and emits
//! `permissionRequested`. The QML page renders a modal and calls
//! `answerPermission`.
//!
//! Honesty contract: the configured agent list shown in the UI is read from
//! disk or is empty — never a fabricated default. The `fs/*` and
//! `terminal/*` client methods are not implemented in `airi-acp` (empty
//! `clientCapabilities`), so agents that want to touch the filesystem or
//! spawn terminals must be denied by policy or will ask and be answered
//! with whatever the human picks.
//!
//! Boundary contract (same as cards/providers/data/mcp bridges): JSON
//! document strings cross the boundary.

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::pin::Pin;
use std::sync::mpsc::{self, TryRecvError};
use std::sync::{Arc, Mutex};

use airi_acp::{
    AcpAgentClient, PermissionPolicy, PermissionRequest, PromptDecision, SessionEvent,
    SessionUpdate, ToolCallStatus, ToolCallUpdate,
};
use serde_json::json;

use crate::bridges;
use crate::bridges::qstring_to_string;

/// `<profile>/airi/acp.json` or `<platform-data>/airi-qt/acp.json`.
fn acp_config_path() -> std::path::PathBuf {
    bridges::profile_dir()
        .map(|p| p.join("airi").join("acp.json"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-qt").join("acp.json")))
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

/// cxx-qt bridge definitions for the ACP bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// ACP agents view-model. Create one per page.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, agents_json, cxx_name = "agentsJson")]
        #[qproperty(QString, active_agent, cxx_name = "activeAgent")]
        #[qproperty(QString, session_id, cxx_name = "sessionId")]
        #[qproperty(QString, agent_state, cxx_name = "agentState")]
        #[qproperty(QString, last_error, cxx_name = "lastError")]
        #[qproperty(bool, working)]
        #[qproperty(QString, transcript_json, cxx_name = "transcriptJson")]
        #[qproperty(QString, pending_permission_json, cxx_name = "pendingPermissionJson")]
        type AcpController = super::AcpControllerRust;
    }

    extern "RustQt" {
        /// Emitted after accumulated transcript entries change.
        #[qsignal]
        #[cxx_name = "transcriptChanged"]
        fn transcript_changed(self: Pin<&mut AcpController>);

        /// Emitted when the agent asks for permission and the `prompt`
        /// policy enqueued the request. The pending payload is available in
        /// `pendingPermissionJson`.
        #[qsignal]
        #[cxx_name = "permissionRequested"]
        fn permission_requested(self: Pin<&mut AcpController>);

        /// Re-read the config file; updates `agentsJson`.
        #[qinvokable]
        #[cxx_name = "refreshAgents"]
        fn refresh_agents(self: Pin<&mut AcpController>);

        /// Add (or replace) a stdio agent. `args_json` is a JSON array of
        /// strings; `env_json` is a JSON object of string values;
        /// `permission_policy` is one of `prompt` | `auto-read` | `auto-all`.
        /// Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "addStdioAgent"]
        fn add_stdio_agent(
            self: Pin<&mut AcpController>,
            name: QString,
            command: QString,
            args_json: QString,
            env_json: QString,
            permission_policy: QString,
        ) -> bool;

        /// Remove an agent by name. If it is the active agent, it is stopped
        /// first. Returns `true` if it existed and was removed.
        #[qinvokable]
        #[cxx_name = "removeAgent"]
        fn remove_agent(self: Pin<&mut AcpController>, name: QString) -> bool;

        /// Enable/disable an agent by name. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "setAgentEnabled"]
        fn set_agent_enabled(self: Pin<&mut AcpController>, name: QString, enabled: bool) -> bool;

        /// Set the permission policy (`prompt` | `auto-read` | `auto-all`)
        /// of an agent. Live-applies to the running agent when it is the
        /// active one. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "setAgentPermissionPolicy"]
        fn set_agent_permission_policy(
            self: Pin<&mut AcpController>,
            name: QString,
            policy: QString,
        ) -> bool;

        /// Start an agent (`spawn` → `initialize` → `session/new` with
        /// `cwd` = the profile directory). Only one agent session at a
        /// time; starting a second agent while one runs fails.
        /// Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "startAgent"]
        fn start_agent(self: Pin<&mut AcpController>, name: QString) -> bool;

        /// Stop the running agent (`session/close` then kill). Idempotent.
        /// Returns `true`.
        #[qinvokable]
        #[cxx_name = "stopAgent"]
        fn stop_agent(self: Pin<&mut AcpController>) -> bool;

        /// Send `text` as a `session/prompt` to the active agent's session
        /// and start streaming updates. Returns `true` when the turn was
        /// started (updates arrive via `pumpUpdates`).
        #[qinvokable]
        #[cxx_name = "promptAgent"]
        fn prompt_agent(self: Pin<&mut AcpController>, text: QString) -> bool;

        /// Request cancellation of the in-flight turn (`session/cancel`).
        /// Returns `true` when the notification was written.
        #[qinvokable]
        #[cxx_name = "cancelPrompt"]
        fn cancel_prompt(self: Pin<&mut AcpController>) -> bool;

        /// Answer a pending permission request (`requestId` as delivered in
        /// `pendingPermissionJson`). `decision` is one of `allow_once` |
        /// `allow_session` | `reject`. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "answerPermission"]
        fn answer_permission(
            self: Pin<&mut AcpController>,
            request_id: QString,
            decision: QString,
        ) -> bool;

        /// Drain queued agent events and permission requests into the
        /// QObject state. QML calls this on a 100 ms timer.
        #[qinvokable]
        #[cxx_name = "pumpUpdates"]
        fn pump_updates(self: Pin<&mut AcpController>);
    }
}

/// Rust storage for `AcpController`.
pub struct AcpControllerRust {
    agents_json: QString,
    active_agent: QString,
    session_id: QString,
    agent_state: QString,
    last_error: QString,
    working: bool,
    transcript_json: QString,
    pending_permission_json: QString,
    // Runtime state (never crosses the bridge directly).
    client: Option<AcpAgentClient>,
    session_id_inner: Option<String>,
    transcript: Vec<TranscriptEntry>,
    events: Option<mpsc::Receiver<SessionEvent>>,
    permission_requests: Option<Arc<Mutex<mpsc::Receiver<PermissionRequest>>>>,
    pending_permissions: Vec<PermissionRequest>,
}

impl Default for AcpControllerRust {
    fn default() -> Self {
        Self {
            agents_json: QString::from("[]"),
            active_agent: QString::from(""),
            session_id: QString::from(""),
            agent_state: QString::from("stopped"),
            last_error: QString::from(""),
            working: false,
            transcript_json: QString::from("[]"),
            pending_permission_json: QString::from("null"),
            client: None,
            session_id_inner: None,
            transcript: Vec::new(),
            events: None,
            permission_requests: None,
            pending_permissions: Vec::new(),
        }
    }
}

impl qobject::AcpController {
    fn set_error(mut self: std::pin::Pin<&mut Self>, message: String) {
        let s = QString::from(message.as_str());
        self.as_mut().rust_mut().last_error = s.clone();
        self.as_mut().set_last_error(s);
    }

    fn clear_error(mut self: std::pin::Pin<&mut Self>) {
        let s = QString::from("");
        self.as_mut().rust_mut().last_error = s.clone();
        self.as_mut().set_last_error(s);
    }

    // `agentState`'s auto-generated `agentStateChanged` notify signal is the
    // state-change signal; the cxx-qt `set_agent_state` setter emits it.
    fn apply_agent_state(mut self: std::pin::Pin<&mut Self>, state: &str) {
        let s = QString::from(state);
        self.as_mut().rust_mut().agent_state = s.clone();
        self.as_mut().set_agent_state(s);
    }

    fn apply_working(mut self: std::pin::Pin<&mut Self>, working: bool) {
        self.as_mut().rust_mut().working = working;
        self.as_mut().set_working(working);
    }

    fn publish_transcript(mut self: std::pin::Pin<&mut Self>) {
        let text = serde_json::to_string(&self.as_ref().get_ref().transcript)
            .unwrap_or_else(|_| "[]".to_string());
        let s = QString::from(text.as_str());
        self.as_mut().rust_mut().transcript_json = s.clone();
        self.as_mut().set_transcript_json(s);
        qobject::AcpController::transcript_changed(self.as_mut());
    }

    fn push_transcript_entry(mut self: std::pin::Pin<&mut Self>, kind: &str, text: &str) {
        if text.is_empty() {
            return;
        }
        let mut coalesced = false;
        {
            let mut rust = self.as_mut().rust_mut();
            // Coalesce consecutive chunks of the same speaker into one entry
            // so a streaming reply does not flood the transcript with one
            // row per token.
            if matches!(kind, "agent" | "thought" | "user") {
                if let Some(last) = rust.transcript.last_mut() {
                    if last.kind == kind {
                        last.text.push_str(text);
                        coalesced = true;
                    }
                }
            }
            if !coalesced {
                rust.transcript.push(TranscriptEntry {
                    kind: kind.to_string(),
                    text: text.to_string(),
                });
            }
        }
        self.as_mut().publish_transcript();
    }

    fn publish_pending_permission_json(mut self: std::pin::Pin<&mut Self>) {
        let text = match self.as_ref().get_ref().pending_permissions.first() {
            Some(request) => permission_request_json(request).to_string(),
            None => "null".to_string(),
        };
        let s = QString::from(text.as_str());
        self.as_mut().rust_mut().pending_permission_json = s.clone();
        self.as_mut().set_pending_permission_json(s);
    }

    fn reload_agents(mut self: std::pin::Pin<&mut Self>) {
        let (agents, error) = match load_config() {
            Ok(Some(config)) => (agents_value(Some(&config)), None),
            Ok(None) => (Vec::new(), None),
            Err(e) => (Vec::new(), Some(e)),
        };
        let s = QString::from(
            serde_json::to_string(&agents)
                .unwrap_or_else(|_| "[]".into())
                .as_str(),
        );
        self.as_mut().rust_mut().agents_json = s.clone();
        self.as_mut().set_agents_json(s);
        if let Some(e) = error {
            self.as_mut().set_error(e);
        } else {
            self.as_mut().clear_error();
        }
    }

    /// Re-read the config file.
    pub fn refresh_agents(mut self: Pin<&mut Self>) {
        self.as_mut().reload_agents();
    }

    /// Add a stdio agent entry.
    pub fn add_stdio_agent(
        mut self: Pin<&mut Self>,
        name: QString,
        command: QString,
        args_json: QString,
        env_json: QString,
        permission_policy: QString,
    ) -> bool {
        self.as_mut().clear_error();
        let name = qstring_to_string(&name);
        let command = qstring_to_string(&command);
        if name.trim().is_empty() || command.trim().is_empty() {
            self.as_mut()
                .set_error("name and command must not be empty".into());
            return false;
        }
        let args: Vec<String> = match serde_json::from_str(&qstring_to_string(&args_json)) {
            Ok(a) => a,
            Err(e) => {
                self.as_mut()
                    .set_error(format!("args must be a JSON array of strings: {e}"));
                return false;
            }
        };
        let env_text = qstring_to_string(&env_json);
        let env: BTreeMap<String, String> = if env_text.trim().is_empty() {
            BTreeMap::new()
        } else {
            match serde_json::from_str::<serde_json::Value>(&env_text) {
                Ok(serde_json::Value::Object(map)) => map
                    .into_iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
                    .collect(),
                Ok(_) => {
                    self.as_mut()
                        .set_error("env must be a JSON object of string values".into());
                    return false;
                }
                Err(e) => {
                    self.as_mut()
                        .set_error(format!("env must be a JSON object of string values: {e}"));
                    return false;
                }
            }
        };
        let permission_policy = qstring_to_string(&permission_policy);
        if !policy_is_valid(&permission_policy) {
            self.as_mut().set_error(format!(
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
                self.as_mut().reload_agents();
                true
            }
            Err(e) => {
                self.as_mut().set_error(e);
                false
            }
        }
    }

    /// Remove an agent by name. Stops it first when it is the active agent.
    pub fn remove_agent(mut self: Pin<&mut Self>, name: QString) -> bool {
        self.as_mut().clear_error();
        let name = qstring_to_string(&name);
        if qstring_to_string(&self.as_ref().get_ref().active_agent) == name {
            self.as_mut().stop_active_agent();
        }
        let mut config = match load_config().ok().flatten() {
            Some(c) => c,
            None => {
                self.as_mut().set_error("no acp.json to modify".into());
                return false;
            }
        };
        let removed = config.agents.remove(&name).is_some();
        match save_config(&config) {
            Ok(()) => {
                self.as_mut().reload_agents();
                removed
            }
            Err(e) => {
                self.as_mut().set_error(e);
                false
            }
        }
    }

    /// Enable/disable an agent.
    pub fn set_agent_enabled(mut self: Pin<&mut Self>, name: QString, enabled: bool) -> bool {
        self.as_mut()
            .set_agent_field(name, |entry| entry.enabled = enabled)
    }

    /// Set the permission policy of an agent; live-applies to the running
    /// agent when it is the active one.
    pub fn set_agent_permission_policy(
        mut self: Pin<&mut Self>,
        name: QString,
        policy: QString,
    ) -> bool {
        let policy = qstring_to_string(&policy);
        if !policy_is_valid(&policy) {
            self.as_mut().set_error(format!(
                "permissionPolicy must be one of prompt | auto-read | auto-all, got {policy:?}"
            ));
            return false;
        }
        let is_active =
            qstring_to_string(&self.as_ref().get_ref().active_agent) == qstring_to_string(&name);
        let ok = self
            .as_mut()
            .set_agent_field(name, |entry| entry.permission_policy = policy.clone());
        if ok && is_active {
            if let Some(client) = self.as_ref().get_ref().client.as_ref() {
                client.set_permission_policy(policy_from_str(&policy));
            }
        }
        ok
    }

    /// Shared read-modify-write for a single agent entry.
    fn set_agent_field(
        mut self: Pin<&mut Self>,
        name: QString,
        mutate: impl FnOnce(&mut AcpAgentEntry),
    ) -> bool {
        self.as_mut().clear_error();
        let name = qstring_to_string(&name);
        let mut config = match load_config().ok().flatten() {
            Some(c) => c,
            None => {
                self.as_mut().set_error("no acp.json to modify".into());
                return false;
            }
        };
        match config.agents.get_mut(&name) {
            Some(entry) => mutate(entry),
            None => {
                self.as_mut()
                    .set_error(format!("agent {name:?} is not configured"));
                return false;
            }
        }
        match save_config(&config) {
            Ok(()) => {
                self.as_mut().reload_agents();
                true
            }
            Err(e) => {
                self.as_mut().set_error(e);
                false
            }
        }
    }

    /// Start an agent.
    pub fn start_agent(mut self: Pin<&mut Self>, name: QString) -> bool {
        self.as_mut().clear_error();
        let name = qstring_to_string(&name);
        if self.as_ref().get_ref().client.is_some() {
            self.as_mut()
                .set_error("an agent is already running — stop it before starting another".into());
            return false;
        }
        let config = match load_config() {
            Ok(Some(c)) => c,
            Ok(None) => {
                self.as_mut()
                    .set_error("no acp.json configured — add an agent first".into());
                return false;
            }
            Err(e) => {
                self.as_mut().set_error(e);
                return false;
            }
        };
        let Some(entry) = config.agents.get(&name) else {
            self.as_mut()
                .set_error(format!("agent {name:?} is not configured"));
            return false;
        };
        if !entry.enabled {
            self.as_mut()
                .set_error(format!("agent {name:?} is disabled"));
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
                self.as_mut()
                    .set_error(format!("failed to spawn {}: {e}", entry.command));
                self.as_mut().apply_agent_state("error");
                return false;
            }
        };
        client.set_permission_policy(policy_from_str(&entry.permission_policy));
        if let Err(e) = client.initialize() {
            self.as_mut().set_error(format!("initialize failed: {e}"));
            self.as_mut().apply_agent_state("error");
            drop(client);
            return false;
        }
        let cwd = bridges::profile_dir()
            .cloned()
            .or_else(|| std::env::current_dir().ok());
        let session_id = match client.new_session(cwd.as_deref()) {
            Ok(session_id) => session_id,
            Err(e) => {
                self.as_mut().set_error(format!("session/new failed: {e}"));
                self.as_mut().apply_agent_state("error");
                drop(client);
                return false;
            }
        };
        let permission_requests = client.permission_requests();
        {
            let mut rust = self.as_mut().rust_mut();
            rust.client = Some(client);
            rust.session_id_inner = Some(session_id.clone());
            rust.permission_requests = Some(permission_requests);
            rust.transcript.clear();
            rust.events = None;
            rust.pending_permissions.clear();
        }
        self.as_mut().publish_transcript();
        self.as_mut().publish_pending_permission_json();
        let s = QString::from(name.as_str());
        self.as_mut().rust_mut().active_agent = s.clone();
        self.as_mut().set_active_agent(s);
        let s = QString::from(session_id.as_str());
        self.as_mut().rust_mut().session_id = s.clone();
        self.as_mut().set_session_id(s);
        self.as_mut().apply_working(false);
        self.as_mut().apply_agent_state("running");
        true
    }

    /// Stop the running agent. Idempotent.
    pub fn stop_agent(mut self: Pin<&mut Self>) -> bool {
        self.as_mut().stop_active_agent();
        true
    }

    /// Stop whatever agent is running; drop runtime state.
    fn stop_active_agent(mut self: Pin<&mut Self>) {
        let (client, session_id) = {
            let mut rust = self.as_mut().rust_mut();
            (rust.client.take(), rust.session_id_inner.take())
        };
        if let Some(client) = client {
            if let Some(session_id) = &session_id {
                if let Err(e) = client.close_session(session_id) {
                    tracing::warn!(target: "airi-qt", "session/close failed during stop: {e}");
                }
            }
            client.close();
        }
        {
            let mut rust = self.as_mut().rust_mut();
            rust.events = None;
            rust.permission_requests = None;
            rust.pending_permissions.clear();
        }
        self.as_mut().publish_pending_permission_json();
        let s = QString::from("");
        {
            let mut rust = self.as_mut().rust_mut();
            rust.active_agent = s.clone();
            rust.session_id = QString::from("");
        }
        self.as_mut().set_active_agent(s);
        self.as_mut().set_session_id(QString::from(""));
        self.as_mut().apply_working(false);
        self.as_mut().apply_agent_state("stopped");
    }

    /// Send a prompt and start streaming updates.
    pub fn prompt_agent(mut self: Pin<&mut Self>, text: QString) -> bool {
        self.as_mut().clear_error();
        let text = qstring_to_string(&text);
        if text.trim().is_empty() {
            self.as_mut().set_error("prompt must not be empty".into());
            return false;
        }
        if self.as_ref().get_ref().working {
            self.as_mut().set_error(
                "a turn is already in flight — cancel it or wait for it to finish".into(),
            );
            return false;
        }
        let session_id = match self.as_ref().get_ref().session_id_inner.clone() {
            Some(session_id) => session_id,
            None => {
                self.as_mut()
                    .set_error("no agent running — start one first".into());
                return false;
            }
        };
        let events = {
            let rust = self.as_ref().get_ref();
            let Some(client) = rust.client.as_ref() else {
                self.as_mut()
                    .set_error("no agent running — start one first".into());
                return false;
            };
            match client.prompt_stream(&session_id, &text) {
                Ok(events) => events,
                Err(e) => {
                    self.as_mut()
                        .set_error(format!("failed to send session/prompt: {e}"));
                    return false;
                }
            }
        };
        self.as_mut().rust_mut().events = Some(events);
        self.as_mut().push_transcript_entry("user", text.trim());
        self.as_mut().apply_working(true);
        true
    }

    /// Cancel the in-flight turn.
    pub fn cancel_prompt(mut self: Pin<&mut Self>) -> bool {
        self.as_mut().clear_error();
        let session_id = self.as_ref().get_ref().session_id_inner.clone();
        let Some(session_id) = session_id else {
            self.as_mut().set_error("no agent running".into());
            return false;
        };
        let result = {
            let rust = self.as_ref().get_ref();
            rust.client
                .as_ref()
                .map(|client| client.cancel(&session_id))
        };
        match result {
            Some(Ok(())) => true,
            Some(Err(e)) => {
                self.as_mut()
                    .set_error(format!("failed to send session/cancel: {e}"));
                false
            }
            None => {
                self.as_mut().set_error("no agent running".into());
                false
            }
        }
    }

    /// Answer a pending permission request.
    pub fn answer_permission(
        mut self: Pin<&mut Self>,
        request_id: QString,
        decision: QString,
    ) -> bool {
        self.as_mut().clear_error();
        let request_id = qstring_to_string(&request_id);
        let decision = match qstring_to_string(&decision).as_str() {
            "allow_once" => PromptDecision::AllowOnce,
            "allow_session" => PromptDecision::AllowSession,
            "reject" => PromptDecision::Reject,
            other => {
                self.as_mut().set_error(format!(
                    "decision must be one of allow_once | allow_session | reject, got {other:?}"
                ));
                return false;
            }
        };
        let result = {
            let rust = self.as_ref().get_ref();
            rust.client
                .as_ref()
                .map(|client| client.answer_permission(&request_id, decision))
        };
        match result {
            Some(Ok(())) => {}
            Some(Err(e)) => {
                self.as_mut()
                    .set_error(format!("failed to answer permission {request_id:?}: {e}"));
                return false;
            }
            None => {
                self.as_mut().set_error("no agent running".into());
                return false;
            }
        }
        {
            let mut rust = self.as_mut().rust_mut();
            rust.pending_permissions
                .retain(|request| request.request_id != request_id);
        }
        self.as_mut().publish_pending_permission_json();
        true
    }

    /// Drain agent events and permission requests into the QObject state.
    pub fn pump_updates(mut self: Pin<&mut Self>) {
        // Session events (transcript).
        let events = self.as_mut().rust_mut().events.take();
        if let Some(rx) = events {
            let mut finished = false;
            loop {
                match rx.try_recv() {
                    Ok(SessionEvent::Update(update)) => {
                        self.as_mut().apply_session_update(update);
                    }
                    Ok(SessionEvent::Finished(result)) => {
                        finished = true;
                        self.as_mut().apply_turn_finished(result);
                        break;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        finished = true;
                        self.as_mut().apply_working(false);
                        self.as_mut().set_error(
                            "the agent closed the turn's event stream unexpectedly".into(),
                        );
                        break;
                    }
                }
            }
            if !finished {
                self.as_mut().rust_mut().events = Some(rx);
            }
        }

        // Permission requests.
        let permission_requests = self.as_mut().rust_mut().permission_requests.take();
        if let Some(permission_requests) = permission_requests {
            let mut enqueued_any = false;
            let mut disconnected = false;
            match permission_requests.lock() {
                Ok(guard) => {
                    // Collect out of the std receiver without holding our
                    // borrow of `self` across the loop.
                    let mut drained: Vec<PermissionRequest> = Vec::new();
                    {
                        // Recover the guard's receiver; `try_recv` needs a
                        // mutable reference to the receiver, which the guard
                        // provides.
                        let receiver = guard;
                        loop {
                            match receiver.try_recv() {
                                Ok(request) => drained.push(request),
                                Err(TryRecvError::Empty) => break,
                                Err(TryRecvError::Disconnected) => {
                                    disconnected = true;
                                    break;
                                }
                            }
                        }
                    }
                    if !drained.is_empty() {
                        self.as_mut().rust_mut().pending_permissions.extend(drained);
                        enqueued_any = true;
                    }
                }
                Err(_) => {
                    disconnected = true;
                }
            }
            if !disconnected {
                self.as_mut().rust_mut().permission_requests = Some(permission_requests);
            }
            if enqueued_any {
                self.as_mut().publish_pending_permission_json();
                qobject::AcpController::permission_requested(self.as_mut());
            }
        }

        // Detect an agent that died while a session is supposed to be live.
        let state = qstring_to_string(&self.as_ref().get_ref().agent_state);
        if state == "running" {
            let closed = self
                .as_ref()
                .get_ref()
                .client
                .as_ref()
                .map(|client| client.is_closed())
                .unwrap_or(false);
            if closed {
                self.as_mut()
                    .set_error("the agent closed its output stream".into());
                self.as_mut().apply_working(false);
                self.as_mut().apply_agent_state("error");
            }
        }
    }

    /// Fold one `session/update` into the transcript.
    fn apply_session_update(mut self: Pin<&mut Self>, update: SessionUpdate) {
        match update {
            SessionUpdate::AgentMessageChunk(chunk) => {
                if let Some(text) = content_block_text(&chunk.content) {
                    self.as_mut().push_transcript_entry("agent", &text);
                }
            }
            SessionUpdate::AgentThoughtChunk(chunk) => {
                if let Some(text) = content_block_text(&chunk.content) {
                    self.as_mut().push_transcript_entry("thought", &text);
                }
            }
            SessionUpdate::UserMessageChunk(chunk) => {
                if let Some(text) = content_block_text(&chunk.content) {
                    self.as_mut().push_transcript_entry("user", &text);
                }
            }
            SessionUpdate::ToolCall(call) => {
                let text = if call.title.is_empty() {
                    call.tool_call_id
                } else {
                    call.title
                };
                self.as_mut().push_transcript_entry("tool", &text);
            }
            SessionUpdate::ToolCallUpdate(update) => {
                let text = tool_call_update_text(&update);
                if let Some(text) = text {
                    self.as_mut().push_transcript_entry("tool", &text);
                }
            }
            SessionUpdate::Plan(plan) => {
                let text = serde_json::to_string(&plan).unwrap_or_default();
                self.as_mut().push_transcript_entry("plan", &text);
            }
            SessionUpdate::Other { update, raw } => {
                let text = format!(
                    "{update}: {}",
                    serde_json::to_string(&raw).unwrap_or_default()
                );
                self.as_mut().push_transcript_entry("other", &text);
            }
        }
    }

    /// Turn-end bookkeeping: stop the spinner, note the stop reason.
    fn apply_turn_finished(
        mut self: Pin<&mut Self>,
        result: Result<serde_json::Value, airi_acp::AcpError>,
    ) {
        self.as_mut().apply_working(false);
        match result {
            Ok(value) => {
                let stop_reason = value
                    .get("stopReason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                self.as_mut()
                    .push_transcript_entry("system", &format!("turn finished ({stop_reason})"));
            }
            Err(e) => {
                self.as_mut().set_error(format!("prompt failed: {e}"));
                self.as_mut()
                    .push_transcript_entry("system", &format!("prompt failed: {e}"));
            }
        }
    }
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
