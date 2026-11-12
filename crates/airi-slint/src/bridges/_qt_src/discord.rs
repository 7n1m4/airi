// SPDX-License-Identifier: GPL-3.0-or-later
//! Discord bridge (`DiscordController`) exposed to QML — the send-only REST slice.
//!
//! Drives `qml/pages/settings/modules/discord/DiscordSettingsPage.qml`. The
//! bridge reads/writes the Qt app's own Discord config file
//! (`<profile>/airi/discord.json`, or the platform data dir when `--profile`
//! is not set — same convention as Electron's `appData/airi/discord.json`),
//! verifies the bot token against `GET /users/@me`, sends human-typed
//! messages through the blocking `airi-discord` REST client, and fetches
//! the gateway URL + session-start budget for **display only**.
//!
//! Honesty contract:
//! * The stored token is never returned to QML (no qproperty exposes it) and
//!   never logged; the token field in the UI is write-only. QML sees only
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

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

use airi_discord::{DiscordError, DiscordRestClient};
use serde_json::json;

use crate::bridges;
use crate::bridges::qstring_to_string;

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
/// [`qobject::DiscordController::verify_bot`]; they never reflect a token
/// that has not been verified.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DiscordConfigFile {
    /// Bot token. Write-only from QML; never returned across the boundary.
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

/// Snapshot of the on-disk state used to fill the qproperties.
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

fn json_qstring(value: serde_json::Value) -> QString {
    QString::from(value.to_string().as_str())
}

/// cxx-qt bridge definitions for the Discord send-only REST bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Discord send-only REST view-model. Create one per page.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, configured)]
        #[qproperty(QString, bot_name, cxx_name = "botName")]
        #[qproperty(QString, bot_id, cxx_name = "botId")]
        #[qproperty(QString, channel_id, cxx_name = "channelId")]
        #[qproperty(QString, last_status, cxx_name = "lastStatus")]
        #[qproperty(QString, last_error, cxx_name = "lastError")]
        #[qproperty(bool, working)]
        #[qproperty(QString, config_dir, cxx_name = "configDir")]
        type DiscordController = super::DiscordControllerRust;
    }

    extern "RustQt" {
        /// Emitted after the config file changes (save / clear / verify cache update).
        #[qsignal]
        #[cxx_name = "configChanged"]
        fn config_changed(self: Pin<&mut DiscordController>);

        /// Persist `{"token","channel_id"}` atomically (0600 on unix), then
        /// call `verifyBot` once. An empty token is rejected and nothing is
        /// persisted. Returns `{"ok":true,"username","id"}` or `{"error": "..."}`.
        #[qinvokable]
        #[cxx_name = "saveConfig"]
        fn save_config(
            self: Pin<&mut DiscordController>,
            token: QString,
            channel_id: QString,
        ) -> QString;

        /// Delete `discord.json` only (never the profile directory).
        /// Returns `true` on success (including when the file was already absent).
        #[qinvokable]
        #[cxx_name = "clearConfig"]
        fn clear_config(self: Pin<&mut DiscordController>) -> bool;

        /// Verify the stored token via `GET /users/@me`; on success persists the
        /// returned username/id as the cached `bot_name`/`bot_id`.
        /// Returns `{"ok":true,"username","id"}` or `{"error": "..."}`.
        #[qinvokable]
        #[cxx_name = "verifyBot"]
        fn verify_bot(self: Pin<&mut DiscordController>) -> QString;

        /// Send exactly `content` to the configured channel. Nothing is sent
        /// automatically anywhere. Returns `{"ok":true,"id": "..."}` or `{"error": "..."}`.
        #[qinvokable]
        #[cxx_name = "sendTestMessage"]
        fn send_test_message(self: Pin<&mut DiscordController>, content: QString) -> QString;

        /// `GET /gateway/bot` for display only — the app does NOT connect to
        /// the gateway. Returns `{"ok":true,"url","shards","remaining"}` or `{"error": "..."}`.
        #[qinvokable]
        #[cxx_name = "gatewayInfo"]
        fn gateway_info(self: Pin<&mut DiscordController>) -> QString;
    }
}

/// Rust storage for `DiscordController`.
pub struct DiscordControllerRust {
    configured: bool,
    bot_name: QString,
    bot_id: QString,
    channel_id: QString,
    last_status: QString,
    last_error: QString,
    working: bool,
    config_dir: QString,
}

impl Default for DiscordControllerRust {
    /// Reads the config file once at construction so the qproperties are
    /// correct before the page touches the bridge.
    fn default() -> Self {
        let config_dir = QString::from(config_dir_display().as_str());
        match snapshot() {
            Ok(snap) => {
                let verified = !snap.bot_name.is_empty();
                Self {
                    configured: snap.configured,
                    bot_name: QString::from(snap.bot_name.as_str()),
                    bot_id: QString::from(snap.bot_id.as_str()),
                    channel_id: QString::from(snap.channel_id.as_str()),
                    last_status: QString::from(if snap.configured && verified {
                        "verified"
                    } else {
                        "unconfigured"
                    }),
                    last_error: QString::from(""),
                    working: false,
                    config_dir,
                }
            }
            Err(message) => Self {
                configured: false,
                bot_name: QString::from(""),
                bot_id: QString::from(""),
                channel_id: QString::from(""),
                last_status: QString::from("error"),
                last_error: QString::from(message.as_str()),
                working: false,
                config_dir,
            },
        }
    }
}

impl qobject::DiscordController {
    fn report_error(mut self: Pin<&mut Self>, message: &str) {
        let s = QString::from(message);
        self.as_mut().rust_mut().last_error = s.clone();
        self.as_mut().set_last_error(s);
    }

    fn mark_working(mut self: Pin<&mut Self>, working: bool) {
        self.as_mut().rust_mut().working = working;
        self.as_mut().set_working(working);
    }

    /// Re-read the config file and push the qproperties. Emits `configChanged`.
    fn reload_from_disk(mut self: Pin<&mut Self>) {
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
        let bot_name = QString::from(snap.bot_name.as_str());
        let bot_id = QString::from(snap.bot_id.as_str());
        let channel_id = QString::from(snap.channel_id.as_str());
        let status_q = QString::from(status);
        let error_q = error
            .as_deref()
            .map(QString::from)
            .unwrap_or_else(|| QString::from(""));
        {
            let mut rust_mut = self.as_mut().rust_mut();
            rust_mut.configured = snap.configured;
            rust_mut.bot_name = bot_name.clone();
            rust_mut.bot_id = bot_id.clone();
            rust_mut.channel_id = channel_id.clone();
            rust_mut.last_status = status_q.clone();
            rust_mut.last_error = error_q.clone();
        }
        self.as_mut().set_configured(snap.configured);
        self.as_mut().set_bot_name(bot_name);
        self.as_mut().set_bot_id(bot_id);
        self.as_mut().set_channel_id(channel_id);
        self.as_mut().set_last_status(status_q);
        self.as_mut().set_last_error(error_q);
        self.as_mut()
            .set_config_dir(QString::from(config_dir_display().as_str()));
        qobject::DiscordController::config_changed(self.as_mut());
    }

    /// Common failure path for `verify_bot`: mark the status as `error`, keep
    /// the configured flag untouched, end the `working` state and report.
    fn fail_verify(mut self: Pin<&mut Self>, message: String) -> QString {
        {
            let mut rust_mut = self.as_mut().rust_mut();
            rust_mut.last_status = QString::from("error");
            rust_mut.last_error = QString::from(message.as_str());
        }
        self.as_mut().set_last_status(QString::from("error"));
        self.as_mut()
            .set_last_error(QString::from(message.as_str()));
        self.as_mut().mark_working(false);
        json_qstring(json!({ "error": message }))
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
    pub fn save_config(mut self: Pin<&mut Self>, token: QString, channel_id: QString) -> QString {
        self.as_mut().mark_working(true);
        let token = qstring_to_string(&token).trim().to_string();
        if token.is_empty() {
            self.as_mut().mark_working(false);
            self.as_mut().report_error("bot token must not be empty");
            return json_qstring(json!({ "error": "bot token must not be empty" }));
        }
        let channel_id = qstring_to_string(&channel_id).trim().to_string();
        let config = DiscordConfigFile {
            token,
            channel_id,
            bot_name: String::new(),
            bot_id: String::new(),
        };
        if let Err(message) = write_config_atomic(&config) {
            self.as_mut().mark_working(false);
            self.as_mut().report_error(message.as_str());
            return json_qstring(json!({ "error": message }));
        }
        self.as_mut().reload_from_disk();
        let result = self.as_mut().verify_bot();
        self.as_mut().mark_working(false);
        result
    }

    /// Delete `discord.json` (never the profile). Resets the qproperties.
    pub fn clear_config(mut self: Pin<&mut Self>) -> bool {
        let path = discord_config_path();
        let result = if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("failed to delete {}: {e}", path.display()))
        } else {
            Ok(())
        };
        match result {
            Ok(()) => {
                let empty = QString::from("");
                {
                    let mut rust_mut = self.as_mut().rust_mut();
                    rust_mut.configured = false;
                    rust_mut.bot_name = empty.clone();
                    rust_mut.bot_id = empty.clone();
                    rust_mut.channel_id = empty.clone();
                    rust_mut.last_status = QString::from("unconfigured");
                    rust_mut.last_error = empty.clone();
                }
                self.as_mut().set_configured(false);
                self.as_mut().set_bot_name(empty.clone());
                self.as_mut().set_bot_id(empty.clone());
                self.as_mut().set_channel_id(empty.clone());
                self.as_mut().set_last_status(QString::from("unconfigured"));
                self.as_mut().set_last_error(empty);
                qobject::DiscordController::config_changed(self.as_mut());
                true
            }
            Err(message) => {
                self.as_mut().report_error(message.as_str());
                false
            }
        }
    }

    /// Verify the stored token against `GET /users/@me`. On success, persist
    /// the username/id as the cached verification and mark the status
    /// `verified`. On failure the configured flag is kept (a token exists)
    /// and the status goes to `error`.
    pub fn verify_bot(mut self: Pin<&mut Self>) -> QString {
        self.as_mut().mark_working(true);
        self.as_mut().report_error("");
        let (mut client, config) = match Self::client_from_config() {
            Ok(pair) => pair,
            Err(message) => return self.as_mut().fail_verify(message),
        };
        match client.get_current_bot_user() {
            Ok(user) => {
                let username = user.username;
                let id = user.id;
                let mut updated = config;
                updated.bot_name = username.clone();
                updated.bot_id = id.clone();
                if let Err(message) = write_config_atomic(&updated) {
                    return self.as_mut().fail_verify(message);
                }
                let username_q = QString::from(username.as_str());
                let id_q = QString::from(id.as_str());
                let channel_id_q = QString::from(updated.channel_id.trim().to_string().as_str());
                {
                    let mut rust_mut = self.as_mut().rust_mut();
                    rust_mut.configured = true;
                    rust_mut.bot_name = username_q.clone();
                    rust_mut.bot_id = id_q.clone();
                    rust_mut.channel_id = channel_id_q.clone();
                    rust_mut.last_status = QString::from("verified");
                    rust_mut.last_error = QString::from("");
                }
                self.as_mut().set_configured(true);
                self.as_mut().set_bot_name(username_q);
                self.as_mut().set_bot_id(id_q);
                self.as_mut().set_channel_id(channel_id_q);
                self.as_mut().set_last_status(QString::from("verified"));
                self.as_mut().report_error("");
                self.as_mut().mark_working(false);
                qobject::DiscordController::config_changed(self.as_mut());
                json_qstring(json!({ "ok": true, "username": username, "id": id }))
            }
            Err(error) => {
                let message = discord_error_message(&error);
                {
                    let mut rust_mut = self.as_mut().rust_mut();
                    rust_mut.last_status = QString::from("error");
                    rust_mut.last_error = QString::from(message.as_str());
                }
                self.as_mut().set_last_status(QString::from("error"));
                self.as_mut().report_error(message.as_str());
                self.as_mut().mark_working(false);
                json_qstring(json!({ "error": message }))
            }
        }
    }

    /// Send exactly `content` to the configured channel. Requires a stored
    /// token and a non-empty channel id; empty content is rejected before
    /// any network call. Never called by the bridge itself.
    pub fn send_test_message(mut self: Pin<&mut Self>, content: QString) -> QString {
        self.as_mut().mark_working(true);
        let content = qstring_to_string(&content);
        if content.trim().is_empty() {
            self.as_mut().mark_working(false);
            return json_qstring(json!({ "error": "message content must not be empty" }));
        }
        let (mut client, config) = match Self::client_from_config() {
            Ok(pair) => pair,
            Err(message) => {
                self.as_mut().mark_working(false);
                return json_qstring(json!({ "error": message }));
            }
        };
        let channel_id = config.channel_id.trim().to_string();
        if channel_id.is_empty() {
            self.as_mut().mark_working(false);
            let message = "no channel id configured — set the Channel ID and save";
            self.as_mut().report_error(message);
            return json_qstring(json!({ "error": message }));
        }
        match client.send_message(&channel_id, &content) {
            Ok(message) => {
                self.as_mut().mark_working(false);
                self.as_mut().report_error("");
                json_qstring(json!({ "ok": true, "id": message.id }))
            }
            Err(error) => {
                let message = discord_error_message(&error);
                self.as_mut().mark_working(false);
                self.as_mut().report_error(message.as_str());
                json_qstring(json!({ "error": message }))
            }
        }
    }

    /// `GET /gateway/bot` — gateway URL, recommended shard count and the
    /// remaining IDENTIFY budget for display only. The app never opens a
    /// gateway connection.
    pub fn gateway_info(mut self: Pin<&mut Self>) -> QString {
        self.as_mut().mark_working(true);
        let (mut client, _config) = match Self::client_from_config() {
            Ok(pair) => pair,
            Err(message) => {
                self.as_mut().mark_working(false);
                return json_qstring(json!({ "error": message }));
            }
        };
        match client.get_gateway_url() {
            Ok(info) => {
                self.as_mut().mark_working(false);
                self.as_mut().report_error("");
                json_qstring(json!({
                    "ok": true,
                    "url": info.url,
                    "shards": info.shards,
                    "remaining": info.session_start_limit.remaining,
                }))
            }
            Err(error) => {
                let message = discord_error_message(&error);
                self.as_mut().mark_working(false);
                self.as_mut().report_error(message.as_str());
                json_qstring(json!({ "error": message }))
            }
        }
    }
}
