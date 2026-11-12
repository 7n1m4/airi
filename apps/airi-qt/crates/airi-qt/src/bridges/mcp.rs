// SPDX-License-Identifier: GPL-3.0-or-later
//! MCP (Model Context Protocol) bridge (`McpController`) exposed to QML.
//!
//! Drives the `qml/pages/settings/modules/mcp/` page: reads/writes the Qt
//! app's own MCP config file (`<profile>/airi/mcp.json`, or the platform
//! data dir when `--profile` is not set — same convention as Electron's
//! `appData/airi/mcp.json`), probes configured servers through `airi-mcp`
//! (initialize + tools/list), and executes tool calls on demand.
//!
//! Honesty contract: the configured server list shown in the UI is read from
//! disk or is empty — never a fabricated default. When no config file
//! exists, the page shows the documented Electron default as a suggestion
//! with an explicit "add it" action; nothing is persisted until the user
//! acts. Remote (streamable HTTP) servers connect with the optional static
//! bearer token from their `authToken` entry field; servers that require
//! OAuth (or any non-static-token scheme) are not reachable from this build.
//!
//! Boundary contract (same as cards/providers/data bridges): JSON document
//! strings cross the boundary. Remote (streamable HTTP) servers connect
//! with the optional static bearer token from the `authToken` field of
//! their `mcp.json` remote entry — sent only to the configured `url` as
//! `Authorization: Bearer <token>`, never logged, never returned by any
//! QML-invokable (the `serversJson` view-model never contains the token;
//! sensitive `headers` values are redacted to `***`), redacted in `Debug`,
//! and scrubbed from error strings by `airi-mcp`.

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use std::pin::Pin;
use std::time::Instant;

use airi_mcp::{McpHttpClient, McpStdioClient, McpToolResult};
use serde_json::json;

use crate::bridges;
use crate::bridges::qstring_to_string;

/// `<profile>/airi/mcp.json` or `<platform-data>/airi-qt/mcp.json`.
fn mcp_config_path() -> std::path::PathBuf {
    bridges::profile_dir()
        .map(|p| p.join("airi").join("mcp.json"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-qt").join("mcp.json")))
        .unwrap_or_else(|| std::path::PathBuf::from("mcp.json"))
}

/// Redaction sentinel used for sensitive values in the `serversJson`
/// view-model. Values equal to this sentinel in an incoming `saveServers`
/// payload are restored from (or dropped in favour of) the on-disk entry —
/// a redacted placeholder must never be persisted as if it were a real
/// secret.
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
    /// `authToken`). **Never** emitted to QML, redacted in `Debug`,
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

fn servers_value(config: Option<&McpConfigFile>) -> Vec<serde_json::Value> {
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
                    json!({
                        "name": name,
                        "transport": transport,
                        "summary": summary,
                        "enabled": entry.enabled,
                        "command": entry.command,
                        "args": entry.args,
                        "env": entry.env,
                        "url": entry.url,
                        "headers": redact_headers(&entry.headers),
                        // The view-model never carries secrets: sensitive
                        // header values are redacted to `***` and the
                        // bearer token itself is never emitted — only a
                        // boolean "is one configured" flag.
                        "authConfigured": entry.auth_token.is_some(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
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

/// cxx-qt bridge definitions for the MCP bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// MCP servers view-model. Create one per page.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, servers_json, cxx_name = "serversJson")]
        #[qproperty(QString, config_path, cxx_name = "configPath")]
        #[qproperty(bool, config_loaded, cxx_name = "configLoaded")]
        #[qproperty(QString, last_error, cxx_name = "lastError")]
        #[qproperty(bool, working)]
        type McpController = super::McpControllerRust;
    }

    extern "RustQt" {
        /// Emitted after the configured server list changes.
        #[qsignal]
        #[cxx_name = "serversChanged"]
        fn servers_changed(self: Pin<&mut McpController>);

        /// Re-read the config file; updates `serversJson`, `configLoaded` and `configPath`.
        #[qinvokable]
        #[cxx_name = "refreshServers"]
        fn refresh_servers(self: Pin<&mut McpController>);

        /// Save the current server list (replaces the config file atomically).
        /// Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "saveServers"]
        fn save_servers(self: Pin<&mut McpController>, servers_json: QString) -> bool;

        /// Add a stdio server. `args_json` is a JSON array of strings
        /// (e.g. `["-y","open-websearch@latest"]`). Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "addStdioServer"]
        fn add_stdio_server(
            self: Pin<&mut McpController>,
            name: QString,
            command: QString,
            args_json: QString,
        ) -> bool;

        /// Remove a server by name. Returns `true` if it existed and was removed.
        #[qinvokable]
        #[cxx_name = "removeServer"]
        fn remove_server(self: Pin<&mut McpController>, name: QString) -> bool;

        /// Enable/disable a server by name. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "setServerEnabled"]
        fn set_server_enabled(self: Pin<&mut McpController>, name: QString, enabled: bool) -> bool;

        /// Probe a configured server (spawn → initialize → tools/list).
        /// Returns `{"ok":true,"server","durationMs","toolCount","tools":[...]}` or `{"error": "..."}`.
        #[qinvokable]
        #[cxx_name = "probeServer"]
        fn probe_server(self: &McpController, name: QString) -> QString;

        /// Call a tool on a configured server.
        /// `arguments_json` is a JSON object string. Returns `{"ok":true,...}` or `{"error": "..."}`.
        #[qinvokable]
        #[cxx_name = "callTool"]
        fn call_tool(
            self: &McpController,
            name: QString,
            tool: QString,
            arguments_json: QString,
        ) -> QString;
    }
}

/// Rust storage for `McpController`.
pub struct McpControllerRust {
    servers_json: QString,
    config_path: QString,
    config_loaded: bool,
    last_error: QString,
    working: bool,
}

impl Default for McpControllerRust {
    fn default() -> Self {
        Self {
            servers_json: QString::from("[]"),
            config_path: QString::from(""),
            config_loaded: false,
            last_error: QString::from(""),
            working: false,
        }
    }
}

impl qobject::McpController {
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

    fn reload(mut self: std::pin::Pin<&mut Self>) {
        let path = mcp_config_path();
        let path_s = path.to_string_lossy().into_owned();
        let (servers, loaded, error) = match load_config() {
            Ok(Some(config)) => (servers_value(Some(&config)), true, None),
            Ok(None) => (Vec::new(), false, None),
            Err(e) => (Vec::new(), false, Some(e)),
        };
        let s = QString::from(
            serde_json::to_string(&servers)
                .unwrap_or_else(|_| "[]".into())
                .as_str(),
        );
        {
            let mut rust_mut = self.as_mut().rust_mut();
            rust_mut.servers_json = s.clone();
            rust_mut.config_path = QString::from(path_s.as_str());
            rust_mut.config_loaded = loaded;
        }
        self.as_mut().set_servers_json(s);
        self.as_mut()
            .set_config_path(QString::from(path_s.as_str()));
        self.as_mut().set_config_loaded(loaded);
        if let Some(e) = error {
            self.as_mut().set_error(e);
        } else {
            self.as_mut().clear_error();
        }
        qobject::McpController::servers_changed(self.as_mut());
    }

    /// Re-read the config file.
    pub fn refresh_servers(self: Pin<&mut Self>) {
        self.reload();
    }

    /// Save the whole server list atomically.
    pub fn save_servers(mut self: Pin<&mut Self>, servers_json: QString) -> bool {
        self.as_mut().clear_error();
        let text = qstring_to_string(&servers_json);
        let parsed: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                self.set_error(format!("servers payload is not valid JSON: {e}"));
                return false;
            }
        };
        let Some(array) = parsed.as_array() else {
            self.set_error("servers payload must be a JSON array".into());
            return false;
        };
        // The QML view-model never carries secrets, so the payload we get
        // back may hold redacted placeholders (`***`) for sensitive header
        // values and omit `authToken` entirely. Merge with the on-disk
        // config to avoid destroying real secrets on save (see
        // restore_redacted_headers).
        let disk = load_config().ok().flatten();
        let mut config = McpConfigFile::default();
        for item in array {
            let Some(name) = item.get("name").and_then(|v| v.as_str()) else {
                self.set_error("every server entry needs a name".into());
                return false;
            };
            if name.trim().is_empty() {
                self.set_error("server names must not be empty".into());
                return false;
            }
            let disk_entry = disk.as_ref().and_then(|c| c.mcp_servers.get(name));
            let incoming_headers = item
                .get("headers")
                .and_then(|v| v.as_object())
                .map(|o| {
                    o.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect::<BTreeMap<_, _>>()
                })
                .unwrap_or_default();
            // Explicit `authToken` strings in the payload overwrite the
            // disk value; anything else (absent key / null) preserves it.
            // There is intentionally no way to *clear* a token from QML —
            // remove it by editing mcp.json directly.
            let auth_token = match item.get("authToken") {
                Some(serde_json::Value::String(s)) if !s.trim().is_empty() => Some(s.to_string()),
                _ => disk_entry.and_then(|d| d.auth_token.clone()),
            };
            let entry = McpServerEntry {
                command: item
                    .get("command")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                args: item
                    .get("args")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
                env: item
                    .get("env")
                    .and_then(|v| v.as_object())
                    .map(|o| {
                        o.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect()
                    })
                    .unwrap_or_default(),
                url: item.get("url").and_then(|v| v.as_str()).map(str::to_string),
                headers: restore_redacted_headers(incoming_headers, disk_entry),
                auth_token,
                enabled: item
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true),
            };
            if entry.command.is_none() && entry.url.is_none() {
                self.set_error(format!("server {name:?} needs either a command or a url"));
                return false;
            }
            config.mcp_servers.insert(name.to_string(), entry);
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

    /// Add a stdio server entry.
    pub fn add_stdio_server(
        mut self: Pin<&mut Self>,
        name: QString,
        command: QString,
        args_json: QString,
    ) -> bool {
        self.as_mut().clear_error();
        let name = qstring_to_string(&name);
        let command = qstring_to_string(&command);
        if name.trim().is_empty() || command.trim().is_empty() {
            self.set_error("name and command must not be empty".into());
            return false;
        }
        let args: Vec<String> =
            match serde_json::from_str::<Vec<String>>(&qstring_to_string(&args_json)) {
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

    /// Remove a server by name.
    pub fn remove_server(mut self: Pin<&mut Self>, name: QString) -> bool {
        self.as_mut().clear_error();
        let name = qstring_to_string(&name);
        let mut config = match load_config().ok().flatten() {
            Some(c) => c,
            None => {
                self.set_error("no mcp.json to modify".into());
                return false;
            }
        };
        let removed = config.mcp_servers.remove(&name).is_some();
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

    /// Enable/disable a server.
    pub fn set_server_enabled(mut self: Pin<&mut Self>, name: QString, enabled: bool) -> bool {
        self.as_mut().clear_error();
        let name = qstring_to_string(&name);
        let mut config = match load_config().ok().flatten() {
            Some(c) => c,
            None => {
                self.set_error("no mcp.json to modify".into());
                return false;
            }
        };
        match config.mcp_servers.get_mut(&name) {
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

    /// Probe a configured server (initialize + tools/list).
    pub fn probe_server(&self, name: QString) -> QString {
        let name = qstring_to_string(&name);
        let config = match load_config().ok().flatten() {
            Some(c) => c,
            None => return json_ok(json!({ "error": "no mcp.json configured" })),
        };
        let Some(entry) = config.mcp_servers.get(&name) else {
            return json_ok(json!({ "error": format!("server {name:?} is not configured") }));
        };
        if !entry.enabled {
            return json_ok(json!({ "error": format!("server {name:?} is disabled") }));
        }
        match probe(entry, &name) {
            Ok(report) => json_ok(report),
            Err(e) => json_ok(json!({ "error": e })),
        }
    }

    /// Call a tool on a configured server.
    pub fn call_tool(&self, name: QString, tool: QString, arguments_json: QString) -> QString {
        let name = qstring_to_string(&name);
        let tool = qstring_to_string(&tool);
        let arguments_text = qstring_to_string(&arguments_json);
        let arguments: serde_json::Value = if arguments_text.trim().is_empty() {
            json!({})
        } else {
            match serde_json::from_str(&arguments_text) {
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
        let Some(entry) = config.mcp_servers.get(&name) else {
            return json_ok(json!({ "error": format!("server {name:?} is not configured") }));
        };
        if !entry.enabled {
            return json_ok(json!({ "error": format!("server {name:?} is disabled") }));
        }
        match call_tool(entry, &name, &tool, arguments) {
            Ok(report) => json_ok(report),
            Err(e) => json_ok(json!({ "error": e })),
        }
    }
}

fn json_ok(value: serde_json::Value) -> QString {
    QString::from(value.to_string().as_str())
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
}
