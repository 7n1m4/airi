// SPDX-License-Identifier: GPL-3.0-or-later
//! Discord bridge (`DiscordState`) exposed to Slint — the send-only REST slice.
//!
//! Drives the Discord settings page. The bridge reads/writes the app's own
//! Discord config file (`<profile>/airi/discord.json`, or the platform data
//! dir when `--profile` is not set — same convention as Electron's
//! `appData/airi/discord.json`), verifies the bot token against
//! `GET /users/@me`, sends human-typed messages through the blocking
//! `airi-discord` REST client, and fetches the gateway URL + session-start
//! budget for **display only**.
//!
//! Honesty contract:
//! * The stored token is never returned to the UI (no field exposes it) and
//!   never logged; the token field in the UI is write-only. The UI sees only
//!   `configured`, `botName`/`botId` (cached last-verified values),
//!   `channelId`, `lastStatus`, `lastError`, `working` and `configDir`.
//! * Nothing here connects to the Discord gateway. Receiving messages is not
//!   wired and never happens automatically; a `GatewayClient` exists in
//!   `airi-discord` (another lane, mid-flight) but this app never
//!   auto-connects to it — receiving is opt-in only, by design.
//! * No message is ever sent automatically. Every send is the direct result
//!   of the user pressing Send in the UI.
//! * The config file is written atomically (tmp + rename) with owner-only
//!   permissions (0600 on unix).
//!
//! Boundary contract (same as the other bridges): JSON document strings
//! cross the boundary.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use airi_discord::{DiscordError, DiscordRestClient};
use serde_json::json;

use crate::bridges;

/// `<profile>/airi/discord.json` or `<platform-data>/airi-slint/discord.json`.
fn discord_config_path() -> std::path::PathBuf {
    bridges::profile_dir()
        .map(|p| p.join("airi").join("discord.json"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint").join("discord.json")))
        .unwrap_or_else(|| std::path::PathBuf::from("discord.json"))
}

/// Resolve the directory holding the config file (for display only).
fn config_dir_display() -> String {
    let path = discord_config_path();
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_string_lossy().into_owned(),
        _ => ".".to_string(),
    }
}

/// The whole config file: `{"token","channel_id","bot_name","bot_id"}`.
///
/// `bot_name`/`bot_id` are the cached last-verified values written back by
/// [`DiscordState::verify_bot`]; they never reflect a token that has not been
/// verified.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DiscordConfigFile {
    /// Bot token. Write-only from the UI; never returned across the boundary.
    #[serde(default)]
    pub token: String,
    /// Channel the test message is sent to.
    #[serde(default)]
    pub channel_id: String,
    /// Last verified bot username (empty until `verifyBot` succeeds).
    #[serde(default)]
    pub bot_name: String,
    /// Last verified bot id (empty until `verifyBot` succeeds).
    #[serde(default)]
    pub bot_id: String,
}

/// Load the config file; `None` when missing, `Err` when unreadable.
fn load_config() -> Result<Option<DiscordConfigFile>, String> {
    let path = discord_config_path();
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| format!("{} is not a valid discord.json: {e}", path.display()))
}

/// Persist the config atomically: write a sibling tmp file, fsync, rename.
/// On unix the tmp file is created owner-only (0600) and permissions are
/// re-asserted after the rename.
fn write_config_atomic(config: &DiscordConfigFile) -> Result<(), String> {
    let path = discord_config_path();
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
        }
    }
    let text = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize config: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    #[cfg(unix)]
    {
        use std::io::Write as _;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
        file.write_all(text.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&tmp, &text)
            .map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    }
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("failed to rename {}: {e}", path.display()));
    }
    #[cfg(unix)]
    {
        // Belt and suspenders: a pre-existing tmp file may carry broader
        // permissions; force 0600 on the final file.
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Snapshot of the on-disk state used to fill the state fields.
struct ConfigSnapshot {
    configured: bool,
    bot_name: String,
    bot_id: String,
    channel_id: String,
}

/// Read the config file and derive the display state. `Err` when the file
/// exists but cannot be read or parsed.
fn snapshot() -> Result<ConfigSnapshot, String> {
    match load_config()? {
        Some(config) if !config.token.trim().is_empty() => Ok(ConfigSnapshot {
            configured: true,
            bot_name: config.bot_name.trim().to_string(),
            bot_id: config.bot_id.trim().to_string(),
            channel_id: config.channel_id.trim().to_string(),
        }),
        _ => Ok(ConfigSnapshot {
            configured: false,
            bot_name: String::new(),
            bot_id: String::new(),
            channel_id: String::new(),
        }),
    }
}

/// Map a client error to a human-readable, token-free message.
/// No variant ever carries the bot token (see `airi-discord`'s `DiscordError`).
fn discord_error_message(error: &DiscordError) -> String {
    match error {
        DiscordError::Unauthorized => {
            "Discord rejected the bot token (401 Unauthorized) — check the token and try again."
                .to_string()
        }
        DiscordError::RateLimited {
            retry_after,
            global,
        } => format!(
            "Discord rate limit (global={global}) — retry after {:.1}s.",
            retry_after.as_secs_f64()
        ),
        DiscordError::Http { status, message } => {
            format!("Discord returned HTTP {status}: {message}")
        }
        DiscordError::Transport(err) => format!("could not reach Discord: {err}"),
        DiscordError::Decode(message) => {
            format!("failed to decode Discord's response: {message}")
        }
        // Gateway variants — unreachable from the REST paths used here (the
        // app never opens a gateway connection), mapped honestly anyway.
        // Neither variant ever carries the token.
        DiscordError::GatewayTransport(message) => {
            format!("gateway connection failed: {message}")
        }
        DiscordError::InvalidSession { resumable } => {
            format!("Discord invalidated the gateway session (resumable={resumable})")
        }
    }
}

fn json_ok(value: serde_json::Value) -> String {
    value.to_string()
}

/// Discord send-only REST view-model (one process-wide instance).
pub struct DiscordState {
    /// Whether a non-empty token is stored.
    pub configured: bool,
    /// Last verified bot username (cached; empty until a verify succeeds).
    pub bot_name: String,
    /// Last verified bot id (cached; empty until a verify succeeds).
    pub bot_id: String,
    /// Channel the test message is sent to.
    pub channel_id: String,
    /// `verified` | `unconfigured` | `error`.
    pub last_status: String,
    /// Last error line (token-free by construction).
    pub last_error: String,
    /// `true` while a REST call is in flight.
    pub working: bool,
    /// Directory holding `discord.json` (display only).
    pub config_dir: String,
}

impl Default for DiscordState {
    /// Reads the config file once at construction so the fields are
    /// correct before the page touches the bridge.
    fn default() -> Self {
        let config_dir = config_dir_display();
        match snapshot() {
            Ok(snap) => {
                let verified = !snap.bot_name.is_empty();
                Self {
                    configured: snap.configured,
                    bot_name: snap.bot_name,
                    bot_id: snap.bot_id,
                    channel_id: snap.channel_id,
                    last_status: if snap.configured && verified {
                        "verified".to_string()
                    } else {
                        "unconfigured".to_string()
                    },
                    last_error: String::new(),
                    working: false,
                    config_dir,
                }
            }
            Err(message) => Self {
                configured: false,
                bot_name: String::new(),
                bot_id: String::new(),
                channel_id: String::new(),
                last_status: "error".to_string(),
                last_error: message,
                working: false,
                config_dir,
            },
        }
    }
}

/// Process-wide state guarded by a mutex (a poisoned lock is recovered so a
/// panicking REST callback must not wedge the UI).
static STATE: Mutex<Option<DiscordState>> = Mutex::new(None);

/// Lock the process-wide Discord state for a UI-thread operation, creating it
/// on first use.
pub fn with_state<R>(f: impl FnOnce(&mut DiscordState) -> R) -> R {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let state = guard.get_or_insert_with(DiscordState::default);
    f(state)
}

impl DiscordState {
    fn report_error(&mut self, message: &str) {
        self.last_error = message.to_string();
    }

    fn mark_working(&mut self, working: bool) {
        self.working = working;
    }

    /// Re-read the config file and push the fields. (The notify hop is the
    /// UI layer's; the former `configChanged` signal.)
    fn reload_from_disk(&mut self) {
        let (snap, error) = match snapshot() {
            Ok(snap) => (snap, None),
            Err(message) => (
                ConfigSnapshot {
                    configured: false,
                    bot_name: String::new(),
                    bot_id: String::new(),
                    channel_id: String::new(),
                },
                Some(message),
            ),
        };
        let verified = !snap.bot_name.is_empty();
        let status = if error.is_some() {
            "error"
        } else if snap.configured && verified {
            "verified"
        } else {
            "unconfigured"
        };
        self.configured = snap.configured;
        self.bot_name = snap.bot_name;
        self.bot_id = snap.bot_id;
        self.channel_id = snap.channel_id;
        self.last_status = status.to_string();
        self.last_error = error.unwrap_or_default();
        self.config_dir = config_dir_display();
    }

    /// Common failure path for `verify_bot`: mark the status as `error`, keep
    /// the configured flag untouched, end the `working` state and report.
    fn fail_verify(&mut self, message: String) -> String {
        self.last_status = "error".to_string();
        self.last_error = message.clone();
        self.mark_working(false);
        json_ok(json!({ "error": message }))
    }

    /// Load the config, require a non-empty token, build a client.
    /// Returns the client and config, or an error string for the caller to surface.
    fn client_from_config() -> Result<(DiscordRestClient, DiscordConfigFile), String> {
        let config = match load_config()? {
            Some(config) if !config.token.trim().is_empty() => config,
            _ => return Err("no bot token configured — save a token first".to_string()),
        };
        let client =
            DiscordRestClient::new(config.token.as_str()).map_err(|e| discord_error_message(&e))?;
        Ok((client, config))
    }

    /// Save the config then verify once. An empty token is rejected without
    /// touching the disk. A fresh token discards any cached verification of a
    /// previous token (the cached `bot_name`/`bot_id` are cleared up front).
    pub fn save_config(&mut self, token: &str, channel_id: &str) -> String {
        self.mark_working(true);
        let token = token.trim().to_string();
        if token.is_empty() {
            self.mark_working(false);
            self.report_error("bot token must not be empty");
            return json_ok(json!({ "error": "bot token must not be empty" }));
        }
        let channel_id = channel_id.trim().to_string();
        let config = DiscordConfigFile {
            token,
            channel_id,
            bot_name: String::new(),
            bot_id: String::new(),
        };
        if let Err(message) = write_config_atomic(&config) {
            self.mark_working(false);
            self.report_error(message.as_str());
            return json_ok(json!({ "error": message }));
        }
        self.reload_from_disk();
        let result = self.verify_bot();
        self.mark_working(false);
        result
    }

    /// Delete `discord.json` (never the profile). Resets the fields.
    pub fn clear_config(&mut self) -> bool {
        let path = discord_config_path();
        let result = if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("failed to delete {}: {e}", path.display()))
        } else {
            Ok(())
        };
        match result {
            Ok(()) => {
                self.configured = false;
                self.bot_name = String::new();
                self.bot_id = String::new();
                self.channel_id = String::new();
                self.last_status = "unconfigured".to_string();
                self.last_error = String::new();
                true
            }
            Err(message) => {
                self.report_error(message.as_str());
                false
            }
        }
    }

    /// Verify the stored token against `GET /users/@me`. On success, persist
    /// the username/id as the cached verification and mark the status
    /// `verified`. On failure the configured flag is kept (a token exists)
    /// and the status goes to `error`.
    pub fn verify_bot(&mut self) -> String {
        self.mark_working(true);
        self.report_error("");
        let (mut client, config) = match Self::client_from_config() {
            Ok(pair) => pair,
            Err(message) => return self.fail_verify(message),
        };
        match client.get_current_bot_user() {
            Ok(user) => {
                let username = user.username;
                let id = user.id;
                let mut updated = config;
                updated.bot_name = username.clone();
                updated.bot_id = id.clone();
                if let Err(message) = write_config_atomic(&updated) {
                    return self.fail_verify(message);
                }
                self.configured = true;
                self.bot_name = username.clone();
                self.bot_id = id.clone();
                self.channel_id = updated.channel_id.trim().to_string();
                self.last_status = "verified".to_string();
                self.report_error("");
                self.mark_working(false);
                json_ok(json!({ "ok": true, "username": username, "id": id }))
            }
            Err(error) => {
                let message = discord_error_message(&error);
                self.last_status = "error".to_string();
                self.report_error(message.as_str());
                self.mark_working(false);
                json_ok(json!({ "error": message }))
            }
        }
    }

    /// Send exactly `content` to the configured channel. Requires a stored
    /// token and a non-empty channel id; empty content is rejected before
    /// any network call. Never called by the bridge itself.
    pub fn send_test_message(&mut self, content: &str) -> String {
        self.mark_working(true);
        let content = content.to_string();
        if content.trim().is_empty() {
            self.mark_working(false);
            return json_ok(json!({ "error": "message content must not be empty" }));
        }
        let (mut client, config) = match Self::client_from_config() {
            Ok(pair) => pair,
            Err(message) => {
                self.mark_working(false);
                return json_ok(json!({ "error": message }));
            }
        };
        let channel_id = config.channel_id.trim().to_string();
        if channel_id.is_empty() {
            self.mark_working(false);
            let message = "no channel id configured — set the Channel ID and save";
            self.report_error(message);
            return json_ok(json!({ "error": message }));
        }
        match client.send_message(&channel_id, &content) {
            Ok(message) => {
                self.mark_working(false);
                self.report_error("");
                json_ok(json!({ "ok": true, "id": message.id }))
            }
            Err(error) => {
                let message = discord_error_message(&error);
                self.mark_working(false);
                self.report_error(message.as_str());
                json_ok(json!({ "error": message }))
            }
        }
    }

    /// `GET /gateway/bot` — gateway URL, recommended shard count and the
    /// remaining IDENTIFY budget for display only. The app never opens a
    /// gateway connection.
    pub fn gateway_info(&mut self) -> String {
        self.mark_working(true);
        let (mut client, _config) = match Self::client_from_config() {
            Ok(pair) => pair,
            Err(message) => {
                self.mark_working(false);
                return json_ok(json!({ "error": message }));
            }
        };
        match client.get_gateway_url() {
            Ok(info) => {
                self.mark_working(false);
                self.report_error("");
                json_ok(json!({
                    "ok": true,
                    "url": info.url,
                    "shards": info.shards,
                    "remaining": info.session_start_limit.remaining,
                }))
            }
            Err(error) => {
                let message = discord_error_message(&error);
                self.mark_working(false);
                self.report_error(message.as_str());
                json_ok(json!({ "error": message }))
            }
        }
    }
}