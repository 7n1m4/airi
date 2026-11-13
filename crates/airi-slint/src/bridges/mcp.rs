// SPDX-License-Identifier: GPL-3.0-or-later
//! MCP (Model Context Protocol) bridge (`McpControllerState`) exposed to Slint.
//!
//! Drives the settings MCP page: reads/writes the app's own MCP config file
//! (`<profile>/airi/mcp.json`, or the platform data dir when `--profile` is
//! not set — same convention as Electron's `appData/airi/mcp.json`), probes
//! configured servers through `airi-mcp` (initialize + tools/list), and
//! executes tool calls on demand.
//!
//! Honesty contract: the configured server list shown in the UI is read from
//! disk or is empty — never a fabricated default. When no config file
//! exists, the page shows the documented Electron default as a suggestion
//! with an explicit "add it" action; nothing is persisted until the user
//! acts. Remote (streamable HTTP) servers connect with the optional static
//! bearer token from their `authToken` entry field; servers that require
//! OAuth (or any non-static-token scheme) are not reachable from this build.
//!
//! Boundary contract (same as cards/providers/data bridges): the server list
//! crosses as a `Vec<McpServerView>` (one plain struct per configured
//! server, the same row shape the settings page's list view read out of the
//! old JSON array); `save_servers` takes the same shape back. Everything else
//! (probe reports, tool-call reports) stays a JSON document string. Remote
//! (streamable HTTP) servers connect with the optional static bearer token
//! from the `authToken` field of their `mcp.json` remote entry — sent only to
//! the configured `url` as `Authorization: Bearer <token>`, never logged,
//! never returned by any bridge method (the server view-model never contains
//! the token; sensitive `headers` values are redacted to `***`), redacted in
//! `Debug`, and scrubbed from error strings by `airi-mcp`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use std::sync::Mutex;
use std::time::Instant;

use airi_mcp::{McpHttpClient, McpStdioClient, McpToolResult};
use serde_json::json;

use crate::bridges;

/// `<profile>/airi/mcp.json` or `<platform-data>/airi-slint/mcp.json`.
fn mcp_config_path() -> std::path::PathBuf {
    bridges::profile_dir()
        .map(|p| p.join("airi").join("mcp.json"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint").join("mcp.json")))
        .unwrap_or_else(|| std::path::PathBuf::from("mcp.json"))
}

/// Redaction sentinel used for sensitive values in the server view-model.
/// Values equal to this sentinel in an incoming `save_servers` payload are
/// restored from (or dropped in favour of) the on-disk entry — a redacted
/// placeholder must never be persisted as if it were a real secret.
const REDACTED: &str = "***";

/// Header names whose values are considered credentials. Matched
/// case-insensitively as a substring of the header name.
fn is_sensitive_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    const NEEDLES: &[&str] = &[
        "auth",
        "token",
        "secret",
        "password",
        "credential",
        "api-key",
        "apikey",
    ];
    NEEDLES.iter().any(|needle| lower.contains(needle))
}

/// Returns a copy of `headers` with sensitive values replaced by
/// [`REDACTED`]. Non-sensitive values pass through unchanged.
fn redact_headers(headers: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    headers
        .iter()
        .map(|(k, v)| {
            if is_sensitive_header(k) {
                (k.clone(), REDACTED.to_string())
            } else {
                (k.clone(), v.clone())
            }
        })
        .collect()
}

/// Restores on-disk values for headers whose values are the [`REDACTED`]
/// sentinel (round-trip protection); drops sentinel values that have no
/// on-disk counterpart so a sentinel never lands in `mcp.json`.
fn restore_redacted_headers(
    incoming: BTreeMap<String, String>,
    disk: Option<&McpServerEntry>,
) -> BTreeMap<String, String> {
    incoming
        .into_iter()
        .filter_map(|(k, v)| {
            if v != REDACTED {
                return Some((k, v));
            }
            disk.and_then(|d| d.headers.get(&k).cloned())
                .map(|restored| (k, restored))
        })
        .collect()
}

/// Extracts the optional bearer token from a remote entry, trimmed.
/// Empty/whitespace-only tokens are treated as absent.
fn bearer_token(entry: &McpServerEntry) -> Option<&str> {
    entry
        .auth_token
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
}

/// One configured server entry (mirrors the Electron `mcpConfigSchema`).
#[derive(Clone, Serialize, Deserialize)]
pub struct McpServerEntry {
    /// Command to spawn for stdio servers (e.g. `npx`).
    #[serde(default)]
    pub command: Option<String>,
    /// Stdio arguments.
    #[serde(default)]
    pub args: Vec<String>,
    /// Environment overrides for the server process.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Remote streamable-HTTP endpoint URL.
    #[serde(default)]
    pub url: Option<String>,
    /// Remote HTTP headers (sent to the configured `url` only, currently
    /// unused by the transport; see `authToken` for credentials).
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// Static bearer token for remote servers that require authorization.
    /// Plaintext in the user's own `mcp.json` (same posture as the gateway
    /// `authToken`). **Never** emitted to the UI, redacted in `Debug`,
    /// scrubbed from error strings by `airi-mcp`.
    #[serde(default, rename = "authToken", skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    /// Whether the server is enabled.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

impl fmt::Debug for McpServerEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("McpServerEntry")
            .field("command", &self.command)
            .field("args", &self.args)
            .field("env", &self.env)
            .field("url", &self.url)
            .field("headers", &redact_headers(&self.headers))
            .field("auth_token", &self.auth_token.as_ref().map(|_| "***"))
            .field("enabled", &self.enabled)
            .finish()
    }
}

fn default_enabled() -> bool {
    true
}

/// The whole config file: `{"mcpServers": {name: entry}}`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct McpConfigFile {
    /// Configured servers by name.
    #[serde(default)]
    pub mcp_servers: BTreeMap<String, McpServerEntry>,
}

/// One configured server as the UI list sees it (the former `serversJson`
/// row). Secrets never appear here: sensitive header values are [`REDACTED`]
/// and the bearer token collapses to the `auth_configured` flag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerView {
    /// Config key of the server.
    pub name: String,
    /// `"remote"` when a `url` is configured, else `"stdio"`.
    pub transport: &'static str,
    /// One-line description (`command args…`, or the remote URL).
    pub summary: String,
    /// Persisted enabled flag.
    pub enabled: bool,
    /// Stdio command, `None` for remote servers.
    pub command: Option<String>,
    /// Stdio arguments.
    pub args: Vec<String>,
    /// Environment overrides for the server process.
    pub env: BTreeMap<String, String>,
    /// Remote endpoint URL, `None` for stdio servers.
    pub url: Option<String>,
    /// Remote headers with sensitive values replaced by [`REDACTED`].
    pub headers: BTreeMap<String, String>,
    /// Whether a static bearer token is configured (the token itself is
    /// never emitted).
    pub auth_configured: bool,
}

/// Load the config file; `None` when missing, `Some(Err)` when unreadable.
fn load_config() -> Result<Option<McpConfigFile>, String> {
    let path = mcp_config_path();
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| format!("{} is not a valid mcp.json: {e}", path.display()))
}

fn save_config(config: &McpConfigFile) -> Result<(), String> {
    let path = mcp_config_path();
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

fn servers_value(config: Option<&McpConfigFile>) -> Vec<McpServerView> {
    config
        .map(|c| {
            c.mcp_servers
                .iter()
                .map(|(name, entry)| {
                    let transport = if entry.url.is_some() {
                        "remote"
                    } else {
                        "stdio"
                    };
                    let summary = if let Some(cmd) = &entry.command {
                        format!("{cmd} {}", entry.args.join(" ")).trim().to_string()
                    } else {
                        entry.url.clone().unwrap_or_default()
                    };
                    McpServerView {
                        name: name.clone(),
                        transport,
                        summary,
                        enabled: entry.enabled,
                        command: entry.command.clone(),
                        args: entry.args.clone(),
                        env: entry.env.clone(),
                        url: entry.url.clone(),
                        // The view-model never carries secrets: sensitive
                        // header values are redacted to `***` and the
                        // bearer token itself is never emitted — only a
                        // boolean "is one configured" flag.
                        headers: redact_headers(&entry.headers),
                        auth_configured: entry.auth_token.is_some(),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Turn one view-model row back into a config entry. `disk` is the on-disk
/// entry with the same name (when any) and carries the redacted-header and
/// bearer-token round-trip.
fn entry_from_view(view: &McpServerView, disk: Option<&McpServerEntry>) -> McpServerEntry {
    let incoming_headers = view.headers.clone();
    // Explicit `authToken` strings in the payload overwrite the disk value;
    // anything else (absent / null) preserves it. The UI never sends the
    // token, so this is the path that keeps it. There is intentionally no
    // way to *clear* a token from the UI — remove it by editing mcp.json
    // directly.
    let auth_token = disk.and_then(|d| d.auth_token.clone());
    McpServerEntry {
        command: view.command.clone(),
        args: view.args.clone(),
        env: view.env.clone(),
        url: view.url.clone(),
        headers: restore_redacted_headers(incoming_headers, disk),
        auth_token,
        enabled: view.enabled,
    }
}

fn stdio_env(entry: &McpServerEntry) -> Option<Vec<(String, String)>> {
    if entry.env.is_empty() {
        None
    } else {
        Some(
            entry
                .env
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        )
    }
}

fn stdio_command(entry: &McpServerEntry, name: &str) -> Result<(String, Vec<String>), String> {
    let command = entry
        .command
        .as_deref()
        .filter(|c| !c.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("server {name:?} is not a stdio server (no command configured)"))?;
    let args = entry.args.clone();
    Ok((command, args))
}

fn probe(entry: &McpServerEntry, name: &str) -> Result<serde_json::Value, String> {
    let started = Instant::now();
    let is_remote = entry
        .command
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
        && entry
            .url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .is_some();
    let (tools, duration_ms) = if is_remote {
        let url = entry.url.as_deref().unwrap_or_default().to_string();
        let token = bearer_token(entry);
        // Static bearer token only, sent solely to the configured `url`.
        let mut client = McpHttpClient::connect_with_auth(&url, token)
            .map_err(|e| format!("cannot connect to {url}: {e}"))?;
        client
            .initialize()
            .map_err(|e| format!("initialize failed: {e}"))?;
        let tools = client
            .tools_list()
            .map_err(|e| format!("tools/list failed: {e}"))?;
        let duration_ms = started.elapsed().as_millis() as u64;
        client.close();
        (tools, duration_ms)
    } else {
        let (command, args) = stdio_command(entry, name)?;
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        let env = stdio_env(entry);
        let mut client = McpStdioClient::spawn(&command, &args, env.as_deref())
            .map_err(|e| format!("failed to spawn {command}: {e}"))?;
        client
            .initialize()
            .map_err(|e| format!("initialize failed: {e}"))?;
        let tools = client
            .tools_list()
            .map_err(|e| format!("tools/list failed: {e}"))?;
        let duration_ms = started.elapsed().as_millis() as u64;
        drop(client); // Drop kills the child process.
        (tools, duration_ms)
    };
    let tool_values: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| json!({ "name": t.name, "description": t.description }))
        .collect();
    Ok(json!({
        "ok": true,
        "server": name,
        "durationMs": duration_ms,
        "toolCount": tool_values.len(),
        "tools": tool_values,
    }))
}

fn call_tool(
    entry: &McpServerEntry,
    name: &str,
    tool: &str,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let is_remote = entry
        .command
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
        && entry
            .url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .is_some();
    let result: McpToolResult = if is_remote {
        let url = entry.url.as_deref().unwrap_or_default().to_string();
        let token = bearer_token(entry);
        let mut client = McpHttpClient::connect_with_auth(&url, token)
            .map_err(|e| format!("cannot connect to {url}: {e}"))?;
        client
            .initialize()
            .map_err(|e| format!("initialize failed: {e}"))?;
        let result = client
            .tools_call(tool, arguments)
            .map_err(|e| format!("tools/call {tool:?} failed: {e}"))?;
        client.close();
        result
    } else {
        let (command, args) = stdio_command(entry, name)?;
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        let env = stdio_env(entry);
        let mut client = McpStdioClient::spawn(&command, &args, env.as_deref())
            .map_err(|e| format!("failed to spawn {command}: {e}"))?;
        client
            .initialize()
            .map_err(|e| format!("initialize failed: {e}"))?;
        let result = client
            .tools_call(tool, arguments)
            .map_err(|e| format!("tools/call {tool:?} failed: {e}"))?;
        drop(client);
        result
    };
    let content: Vec<serde_json::Value> = result
        .content
        .iter()
        .map(|c| match c {
            airi_mcp::McpToolContent::Text(text) => json!({ "type": "text", "text": text }),
            airi_mcp::McpToolContent::Other { content_type, raw } => {
                json!({ "type": content_type, "raw": raw })
            }
        })
        .collect();
    Ok(json!({
        "ok": true,
        "tool": tool,
        "isError": result.is_error,
        "content": content,
        "structuredContent": result.structured_content,
    }))
}

/// MCP servers view-model state (one process-wide instance).
#[derive(Default)]
pub struct McpControllerState {
    /// Configured servers, from the last reload.
    pub servers: Vec<McpServerView>,
    /// Path of the config file (display only).
    pub config_path: String,
    /// Whether a config file was read successfully.
    pub config_loaded: bool,
    /// Last error message, empty when none.
    pub last_error: String,
    /// `true` while a long operation runs.
    pub working: bool,
}

/// Process-wide controller guarded by a mutex (a poisoned lock is recovered
/// so a panicking MCP call must not wedge the UI).
static STATE: Mutex<McpControllerState> = Mutex::new(McpControllerState {
    servers: Vec::new(),
    config_path: String::new(),
    config_loaded: false,
    last_error: String::new(),
    working: false,
});

/// Lock the process-wide controller for a UI-thread operation.
pub fn with_state<R>(f: impl FnOnce(&mut McpControllerState) -> R) -> R {
    match STATE.lock() {
        Ok(mut guard) => f(&mut guard),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

impl McpControllerState {
    fn set_error(&mut self, message: String) {
        self.last_error = message;
    }

    fn clear_error(&mut self) {
        self.last_error = String::new();
    }

    fn reload(&mut self) {
        let path = mcp_config_path();
        let path_s = path.to_string_lossy().into_owned();
        let (servers, loaded, error) = match load_config() {
            Ok(Some(config)) => (servers_value(Some(&config)), true, None),
            Ok(None) => (Vec::new(), false, None),
            Err(e) => (Vec::new(), false, Some(e)),
        };
        self.servers = servers;
        self.config_path = path_s;
        self.config_loaded = loaded;
        if let Some(e) = error {
            self.set_error(e);
        } else {
            self.clear_error();
        }
    }

    /// Re-read the config file; updates the server list, `configLoaded` and
    /// `configPath`.
    pub fn refresh_servers(&mut self) {
        self.reload();
    }

    /// Save the current server list (replaces the config file atomically).
    /// Returns `true` on success.
    pub fn save_servers(&mut self, servers: &[McpServerView]) -> bool {
        self.clear_error();
        // The view-model never carries secrets, so the payload we get back
        // holds redacted placeholders (`***`) for sensitive header values and
        // omits `authToken` entirely. Merge with the on-disk config to avoid
        // destroying real secrets on save (see restore_redacted_headers).
        let disk = load_config().ok().flatten();
        let mut config = McpConfigFile::default();
        for view in servers {
            if view.name.trim().is_empty() {
                self.set_error("server names must not be empty".into());
                return false;
            }
            let disk_entry = disk.as_ref().and_then(|c| c.mcp_servers.get(&view.name));
            let entry = entry_from_view(view, disk_entry);
            if entry.command.is_none() && entry.url.is_none() {
                self.set_error(format!(
                    "server {:?} needs either a command or a url",
                    view.name
                ));
                return false;
            }
            config.mcp_servers.insert(view.name.clone(), entry);
        }
        match save_config(&config) {
            Ok(()) => {
                self.reload();
                true
            }
            Err(e) => {
                self.set_error(e);
                false
            }
        }
    }

    /// Add a stdio server. `args_json` is a JSON array of strings
    /// (e.g. `["-y","open-websearch@latest"]`). Returns `true` on success.
    pub fn add_stdio_server(&mut self, name: &str, command: &str, args_json: &str) -> bool {
        self.clear_error();
        let name = name.to_string();
        let command = command.to_string();
        if name.trim().is_empty() || command.trim().is_empty() {
            self.set_error("name and command must not be empty".into());
            return false;
        }
        let args: Vec<String> = match serde_json::from_str::<Vec<String>>(args_json) {
            Ok(a) => a,
            Err(e) => {
                self.set_error(format!("args must be a JSON array of strings: {e}"));
                return false;
            }
        };
        let mut config = load_config().ok().flatten().unwrap_or_default();
        config.mcp_servers.insert(
            name,
            McpServerEntry {
                command: Some(command),
                args,
                env: BTreeMap::new(),
                url: None,
                headers: BTreeMap::new(),
                auth_token: None,
                enabled: true,
            },
        );
        match save_config(&config) {
            Ok(()) => {
                self.reload();
                true
            }
            Err(e) => {
                self.set_error(e);
                false
            }
        }
    }

    /// Remove a server by name. Returns `true` if it existed and was removed.
    pub fn remove_server(&mut self, name: &str) -> bool {
        self.clear_error();
        let mut config = match load_config().ok().flatten() {
            Some(c) => c,
            None => {
                self.set_error("no mcp.json to modify".into());
                return false;
            }
        };
        let removed = config.mcp_servers.remove(name).is_some();
        match save_config(&config) {
            Ok(()) => {
                self.reload();
                removed
            }
            Err(e) => {
                self.set_error(e);
                false
            }
        }
    }

    /// Enable/disable a server by name. Returns `true` on success.
    pub fn set_server_enabled(&mut self, name: &str, enabled: bool) -> bool {
        self.clear_error();
        let mut config = match load_config().ok().flatten() {
            Some(c) => c,
            None => {
                self.set_error("no mcp.json to modify".into());
                return false;
            }
        };
        match config.mcp_servers.get_mut(name) {
            Some(entry) => entry.enabled = enabled,
            None => {
                self.set_error(format!("server {name:?} is not configured"));
                return false;
            }
        }
        match save_config(&config) {
            Ok(()) => {
                self.reload();
                true
            }
            Err(e) => {
                self.set_error(e);
                false
            }
        }
    }

    /// Probe a configured server (spawn → initialize → tools/list).
    /// Returns `{"ok":true,"server","durationMs","toolCount","tools":[...]}` or `{"error": "..."}`.
    pub fn probe_server(&self, name: &str) -> String {
        let config = match load_config().ok().flatten() {
            Some(c) => c,
            None => return json_ok(json!({ "error": "no mcp.json configured" })),
        };
        let Some(entry) = config.mcp_servers.get(name) else {
            return json_ok(json!({ "error": format!("server {name:?} is not configured") }));
        };
        if !entry.enabled {
            return json_ok(json!({ "error": format!("server {name:?} is disabled") }));
        }
        match probe(entry, name) {
            Ok(report) => json_ok(report),
            Err(e) => json_ok(json!({ "error": e })),
        }
    }

    /// Call a tool on a configured server.
    /// `arguments_json` is a JSON object string. Returns `{"ok":true,...}` or `{"error": "..."}`.
    pub fn call_tool(&self, name: &str, tool: &str, arguments_json: &str) -> String {
        let arguments: serde_json::Value = if arguments_json.trim().is_empty() {
            json!({})
        } else {
            match serde_json::from_str(arguments_json) {
                Ok(v) => v,
                Err(e) => {
                    return json_ok(
                        json!({ "error": format!("arguments must be a JSON object: {e}") }),
                    )
                }
            }
        };
        let config = match load_config().ok().flatten() {
            Some(c) => c,
            None => return json_ok(json!({ "error": "no mcp.json configured" })),
        };
        let Some(entry) = config.mcp_servers.get(name) else {
            return json_ok(json!({ "error": format!("server {name:?} is not configured") }));
        };
        if !entry.enabled {
            return json_ok(json!({ "error": format!("server {name:?} is disabled") }));
        }
        match call_tool(entry, name, tool, arguments) {
            Ok(report) => json_ok(report),
            Err(e) => json_ok(json!({ "error": e })),
        }
    }
}

fn json_ok(value: serde_json::Value) -> String {
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "bridge-test-token-9f8e7d6c5b4a";

    fn entry_with_token() -> McpServerEntry {
        McpServerEntry {
            command: None,
            args: Vec::new(),
            env: BTreeMap::new(),
            url: Some("https://mcp.example.com/mcp".to_string()),
            headers: BTreeMap::new(),
            auth_token: Some(TOKEN.to_string()),
            enabled: true,
        }
    }

    #[test]
    fn auth_token_serializes_as_camel_case_auth_token_key() {
        let entry = entry_with_token();
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["authToken"], TOKEN);
        assert!(json.get("auth_token").is_none());
    }

    #[test]
    fn missing_auth_token_deserializes_to_none_and_omits_the_key() {
        let value = serde_json::json!({ "url": "https://mcp.example.com/mcp" });
        let entry: McpServerEntry = serde_json::from_value(value).unwrap();
        assert!(entry.auth_token.is_none());
        let json = serde_json::to_value(&entry).unwrap();
        assert!(json.get("authToken").is_none());
    }

    #[test]
    fn debug_output_redacts_the_token() {
        let entry = entry_with_token();
        let debug = format!("{entry:?}");
        assert!(debug.contains("***"));
        assert!(!debug.contains(TOKEN));
    }

    #[test]
    fn sensitive_headers_are_redacted_case_insensitively() {
        let mut headers = BTreeMap::new();
        headers.insert("Authorization".to_string(), "Bearer abc".to_string());
        headers.insert("X-Api-Key".to_string(), "key-123".to_string());
        headers.insert("X-Custom".to_string(), "visible".to_string());
        let redacted = redact_headers(&headers);
        assert_eq!(redacted["Authorization"], "***");
        assert_eq!(redacted["X-Api-Key"], "***");
        assert_eq!(redacted["X-Custom"], "visible");
    }

    #[test]
    fn redacted_sentinels_are_restored_from_disk_on_save() {
        let mut disk = entry_with_token();
        disk.headers
            .insert("Authorization".to_string(), "real-secret".to_string());
        let mut incoming = BTreeMap::new();
        incoming.insert("Authorization".to_string(), REDACTED.to_string());
        incoming.insert("X-Custom".to_string(), "kept".to_string());
        let restored = restore_redacted_headers(incoming, Some(&disk));
        assert_eq!(restored["Authorization"], "real-secret");
        assert_eq!(restored["X-Custom"], "kept");
    }

    #[test]
    fn redacted_sentinel_without_disk_counterpart_is_dropped() {
        let mut incoming = BTreeMap::new();
        incoming.insert("Authorization".to_string(), REDACTED.to_string());
        let restored = restore_redacted_headers(incoming, None);
        assert!(restored.is_empty());
    }

    #[test]
    fn bearer_token_trims_and_rejects_whitespace() {
        let mut entry = entry_with_token();
        assert_eq!(bearer_token(&entry), Some(TOKEN));
        entry.auth_token = Some("   ".to_string());
        assert_eq!(bearer_token(&entry), None);
        entry.auth_token = None;
        assert_eq!(bearer_token(&entry), None);
    }

    #[test]
    fn servers_value_never_carries_the_token_or_an_unredacted_header() {
        let mut entry = entry_with_token();
        entry.headers.insert(
            "Authorization".to_string(),
            "Bearer real-secret".to_string(),
        );
        entry
            .headers
            .insert("X-Custom".to_string(), "visible".to_string());
        let mut config = McpConfigFile::default();
        config.mcp_servers.insert("remote".to_string(), entry);
        let views = servers_value(Some(&config));
        assert_eq!(views.len(), 1);
        let view = &views[0];
        assert_eq!(view.name, "remote");
        assert_eq!(view.transport, "remote");
        assert!(view.auth_configured);
        assert_eq!(view.headers["Authorization"], REDACTED);
        assert_eq!(view.headers["X-Custom"], "visible");
        assert!(!serde_json::to_string(view).unwrap().contains(TOKEN));
    }

    #[test]
    fn save_servers_restores_the_token_and_header_from_disk() {
        let mut entry = entry_with_token();
        entry
            .headers
            .insert("Authorization".to_string(), "real-secret".to_string());
        let mut config = McpConfigFile::default();
        config.mcp_servers.insert("remote".to_string(), entry);
        let view = servers_value(Some(&config)).remove(0);
        let disk = config.mcp_servers.get("remote");
        let round_tripped = entry_from_view(&view, disk);
        assert_eq!(round_tripped.auth_token.as_deref(), Some(TOKEN));
        assert_eq!(round_tripped.headers["Authorization"], "real-secret");
    }

    #[test]
    fn save_servers_rejects_a_nameless_row() {
        let mut state = McpControllerState::default();
        let row = McpServerView {
            name: "   ".to_string(),
            ..test_view("npx", None)
        };
        assert!(!state.save_servers(&[row]));
        assert_eq!(state.last_error, "server names must not be empty");
    }

    #[test]
    fn save_servers_rejects_a_row_without_command_or_url() {
        let mut state = McpControllerState::default();
        // `test_view` fills in a command for stdio rows, so strip both here:
        // a row with neither a command nor a url cannot be saved.
        let row = McpServerView {
            command: None,
            url: None,
            ..test_view("broken", None)
        };
        assert!(!state.save_servers(&[row]));
        assert_eq!(
            state.last_error,
            "server \"broken\" needs either a command or a url"
        );
    }

    fn test_view(name: &str, url: Option<&str>) -> McpServerView {
        McpServerView {
            name: name.to_string(),
            transport: if url.is_some() { "remote" } else { "stdio" },
            summary: String::new(),
            enabled: true,
            command: url.is_none().then(|| "npx".to_string()),
            args: Vec::new(),
            env: BTreeMap::new(),
            url: url.map(str::to_string),
            headers: BTreeMap::new(),
            auth_configured: false,
        }
    }
}
