// SPDX-License-Identifier: GPL-3.0-or-later

//! Auto-healing `server-channel/config.json` persistence.
//!
//! Mirrors the Electron stage-tamagotchi contract (`createConfig('server-channel',
//! 'config.json', …, { autoHeal: true })`): if the file is missing or invalid,
//! a fresh random `authToken` (UUIDv4) is generated and the file is rewritten.
//! The token is stored in **plaintext** — same posture as the Electron build,
//! no worse, no better. Protect the data dir accordingly.
//!
//! On-disk shape (extra keys such as the Electron `tlsConfig: null` are
//! tolerated on read but not rewritten unless they were already present):
//!
//! ```json
//! { "hostname": "127.0.0.1", "authToken": "<uuid-v4>" }
//! ```

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::uuid::uuid_v4;

/// Default bind address. Loopback-only by default — see crate docs.
pub const DEFAULT_HOSTNAME: &str = "127.0.0.1";

/// The persisted channel-server configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelConfig {
    /// Bind address. Defaults to `127.0.0.1`; use `0.0.0.0` deliberately and
    /// only to permit LAN access (see crate-level security notes).
    pub hostname: String,
    /// Shared secret clients must present as the first message.
    #[serde(rename = "authToken")]
    pub auth_token: String,
}

impl ChannelConfig {
    /// Construct a fresh config with a random token bound to loopback.
    pub fn healed() -> Self {
        Self {
            hostname: DEFAULT_HOSTNAME.to_string(),
            auth_token: uuid_v4(),
        }
    }
}

/// Errors from config load/heal.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// Filesystem failure while reading or writing the config.
    #[error("config I/O error: {0}")]
    Io(#[from] io::Error),
}

/// Default config path: `<data-dir>/airi-qt/server-channel/config.json`.
///
/// Data dir resolution: `dirs::data_dir()` (Linux: `$XDG_DATA_HOME` or
/// `~/.local/share`; macOS: `~/Library/Application Support`; Windows:
/// `%APPDATA%`). Returns `None` when no data dir can be determined.
pub fn default_config_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("airi-qt").join("server-channel").join("config.json"))
}

/// Load the config at `path`, healing it if missing or invalid.
///
/// - Missing file → created (parent dirs included) with a fresh token.
/// - Unreadable/unparseable JSON, or an empty/missing `authToken` → the token
///   is regenerated (a valid `hostname` is preserved if one was present;
///   otherwise loopback default) and the file is rewritten.
/// - Valid config → returned unchanged.
pub fn load_or_heal(path: &Path) -> Result<ChannelConfig, ConfigError> {
    match fs::read_to_string(path) {
        Ok(raw) => match parse_config(&raw) {
            Some(cfg) => Ok(cfg),
            None => heal_in_place(path, &raw),
        },
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            let cfg = ChannelConfig::healed();
            write_config(path, &cfg)?;
            Ok(cfg)
        }
        Err(err) => Err(ConfigError::Io(err)),
    }
}

/// Parse and validate raw JSON. Returns `None` if the config is unusable
/// (caller regenerates the token).
fn parse_config(raw: &str) -> Option<ChannelConfig> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let obj = value.as_object()?;

    let auth_token = obj.get("authToken")?.as_str()?.trim();
    if auth_token.is_empty() {
        return None;
    }

    let hostname = match obj.get("hostname") {
        Some(v) => v.as_str()?.trim().to_string(),
        None => DEFAULT_HOSTNAME.to_string(),
    };
    if hostname.is_empty() {
        return None;
    }

    Some(ChannelConfig {
        hostname,
        auth_token: auth_token.to_string(),
    })
}

/// Rewrite `path` with a fresh token, preserving a usable hostname if present.
fn heal_in_place(path: &Path, raw: &str) -> Result<ChannelConfig, ConfigError> {
    let hostname = serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| {
            v.get("hostname")
                .and_then(|h| h.as_str())
                .map(str::to_string)
        })
        .filter(|h| !h.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_HOSTNAME.to_string());

    let cfg = ChannelConfig {
        hostname,
        auth_token: uuid_v4(),
    };
    write_config(path, &cfg)?;
    Ok(cfg)
}

/// Write the config, creating parent directories.
fn write_config(path: &Path, cfg: &ChannelConfig) -> Result<(), ConfigError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| ConfigError::Io(io::Error::new(io::ErrorKind::InvalidData, e)))?;
    fs::write(path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_created_with_token() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join("nested")
            .join("server-channel")
            .join("config.json");

        let cfg = load_or_heal(&path).unwrap();
        assert_eq!(cfg.hostname, DEFAULT_HOSTNAME);
        assert_eq!(cfg.auth_token.len(), 36); // canonical UUID shape
        assert!(path.exists());

        // Second load preserves the generated token.
        let again = load_or_heal(&path).unwrap();
        assert_eq!(again, cfg);
    }

    #[test]
    fn invalid_json_regenerates_token() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, "{ not json !").unwrap();

        let cfg = load_or_heal(&path).unwrap();
        assert_eq!(cfg.hostname, DEFAULT_HOSTNAME);
        assert_eq!(cfg.auth_token.len(), 36);

        let rewritten: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(rewritten["authToken"].as_str().unwrap(), cfg.auth_token);
    }

    #[test]
    fn empty_auth_token_regenerates_token() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, r#"{ "hostname": "127.0.0.1", "authToken": "" }"#).unwrap();

        let cfg = load_or_heal(&path).unwrap();
        assert!(!cfg.auth_token.is_empty());
        assert_eq!(cfg.auth_token.len(), 36);
    }

    #[test]
    fn valid_config_is_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(
            &path,
            r#"{ "hostname": "0.0.0.0", "authToken": "keep-me" }"#,
        )
        .unwrap();

        let cfg = load_or_heal(&path).unwrap();
        assert_eq!(cfg.hostname, "0.0.0.0");
        assert_eq!(cfg.auth_token, "keep-me");
    }

    #[test]
    fn hostname_preserved_when_token_regenerated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, r#"{ "hostname": "0.0.0.0", "authToken": "" }"#).unwrap();

        let cfg = load_or_heal(&path).unwrap();
        assert_eq!(cfg.hostname, "0.0.0.0");
        assert_ne!(cfg.auth_token, "");
    }
}
