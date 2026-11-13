// SPDX-License-Identifier: GPL-3.0-or-later

//! Gateway hosting: the `airi-channel` WebSocket gateway, served from the
//! always-on daemon instead of the desktop app.
//!
//! ## Topology (see `docs/design-daemon-gateway.md`)
//!
//! ```text
//!   external clients ─── ws(s)://[hostname]:6121 ───▶ airi-daemon
//!                                                       │  org.moeru.airi.Daemon1 (control)
//!                                                       ▼
//!                                               D-Bus methods GetGatewayConfig /
//!                                               ApplyGatewayConfig / RegenerateGatewayToken
//! ```
//!
//! The gateway binds `<hostname>:<port>` (default loopback, port from
//! `SERVER_CHANNEL_PORT`, falling back to 6121). With a `tlsConfig` flag in
//! the config it serves `wss://` using a locally minted CA + SAN-covered
//! certificate (see [`airi_channel::certs`]) — required for anything beyond
//! loopback (LAN/VPN/tailnet). A public-internet relay with per-client
//! tokens does not exist yet; do not expose this to the open internet.
//!
//! ## Config adoption (upgrading from the in-app server)
//!
//! The Electrobun/Electron desktop app kept its gateway config at
//! `<userData>/server-channel-config.json`. On first start the daemon adopts
//! the newest matching file into its own daemon-owned path
//! (`<data>/airi-slint/server-channel/config.json`), preserving the
//! `authToken` so previously paired devices keep working. The daemon-owned
//! copy is authoritative from then on; the app's settings UI is expected to
//! talk to the daemon via D-Bus (`ApplyGatewayConfig`) instead of editing
//! files directly.
//!
//! `AIRI_SERVER_CHANNEL_CONFIG=<path>` overrides everything and is used
//! write-through (the daemon edits the file in place), so app and daemon
//! never diverge when both are pointed at it.
//!
//! ## Port contention during transition
//!
//! Until the desktop app stops hosting its own in-app server (it will once
//! the renderer is re-backed to D-Bus), exactly one of them can bind 6121.
//! The daemon retries every 15 s and reports `bound: false` + `lastError`
//! through `GetGatewayConfig` in the meantime; awareness functions are
//! unaffected either way.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use airi_channel::{
    get_or_create_certs, load_or_heal, san_domains, uuid::uuid_v4, ChannelConfig, ChannelServer,
    GatewayControlApply, GatewayControlStatus, ServerHandle,
};

/// How often the daemon re-tries a failed bind (e.g. while the desktop app
/// still holds the port).
const RETRY_INTERVAL: Duration = Duration::from_secs(15);

const SERVER_CHANNEL_DIR: &str = "server-channel";
const CERTS_DIR: &str = "certs";
const CONFIG_FILE: &str = "config.json";

/// A D-Bus caller's request (kept pure so tests can drive it without a bus).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayRequest {
    /// Read the effective config + listener state. Never logs credentials.
    Get,
    /// Apply a config patch (raw JSON object string, Electron handler shape:
    /// `{ websocketTlsConfig?: {} | null, authToken?, hostname? }`; the legacy
    /// `tlsConfig` spelling for the TLS flag is also accepted).
    Apply(String),
    /// Rotate the shared auth token; affects new connections (existing
    /// sessions are not force-closed, matching the in-app server).
    RegenerateToken,
}

struct Inner {
    hostname: String,
    auth_token: String,
    /// The persisted/user-configured TLS flag (`tlsConfig` in the file).
    tls_flag: bool,
    /// The transport actually bound: `tls_flag || !loopback(hostname)`.
    bound_tls: bool,
    bound: bool,
    last_error: Option<String>,
    adopted_from: Option<PathBuf>,
    server: Option<ServerHandle>,
    last_attempt: Instant,
}

/// The daemon's gateway state. Owns the listener handle (if any) and the
/// effective config; D-Bus handlers read/mutate it under a mutex.
pub struct Gateway {
    config_path: PathBuf,
    cert_dir: PathBuf,
    /// Explicit bind port, or `None` to use `SERVER_CHANNEL_PORT`/6121.
    /// Tests pass `Some(0)` for an ephemeral port.
    port_override: Option<u16>,
    inner: Mutex<Inner>,
}

impl Gateway {
    /// Start the gateway, adopting/healing config as documented. Never
    /// panics: every failure is captured into `bound: false` + `last_error`
    /// and reported via `GetGatewayConfig`.
    pub fn start() -> Self {
        Self::start_with(port_from_env(), None)
    }

    /// Same as [`Gateway::start`] with an explicit port (tests use `Some(0)`).
    pub fn start_with(port_override: Option<u16>, adopt_from: Option<PathBuf>) -> Self {
        let Some(data_dir) = dirs::data_dir() else {
            return Self::disabled(
                port_override,
                "no data dir for this platform; gateway disabled",
            );
        };
        Self::start_in(
            data_dir.join("airi-slint").join(SERVER_CHANNEL_DIR),
            port_override,
            adopt_from,
        )
    }

    fn start_in(
        config_dir: PathBuf,
        port_override: Option<u16>,
        adopt_from: Option<PathBuf>,
    ) -> Self {
        let config_path = config_dir.join(CONFIG_FILE);
        let cert_dir = config_dir.join(CERTS_DIR);

        // 1. Explicit override path: write through, never copy.
        let explicit = std::env::var("AIRI_SERVER_CHANNEL_CONFIG")
            .ok()
            .map(PathBuf::from);
        let (config_path, adopted_from) = match explicit {
            Some(path) => (path, None),
            None => match adopt_from {
                Some(source) => adopt(&source, &config_path).map_or_else(
                    |err| {
                        eprintln!("airi-daemon: gateway config adoption from {} failed: {err}; minting fresh", source.display());
                        (config_path.clone(), None)
                    },
                    |source| (config_path.clone(), Some(source)),
                ),
                None => {
                    if config_path.exists() {
                        (config_path.clone(), None)
                    } else {
                        match find_adoptable() {
                            Some(source) => adopt(&source, &config_path).map_or_else(
                                |err| {
                                    eprintln!("airi-daemon: gateway config adoption from {} failed: {err}; minting fresh", source.display());
                                    (config_path.clone(), None)
                                },
                                |source| (config_path.clone(), Some(source)),
                            ),
                            None => (config_path.clone(), None),
                        }
                    }
                }
            },
        };

        let gateway = Self {
            config_path,
            cert_dir,
            port_override,
            inner: Mutex::new(Inner {
                hostname: DEFAULT_HOSTNAME_PLACEHOLDER.to_string(),
                auth_token: String::new(),
                tls_flag: false,
                bound_tls: false,
                bound: false,
                last_error: None,
                adopted_from,
                server: None,
                last_attempt: Instant::now() - RETRY_INTERVAL,
            }),
        };

        // 2. Load/heal the persisted config, then bind.
        match load_or_heal(&gateway.config_path) {
            Ok(config) => {
                gateway.bind_once(&config);
                let inner = gateway.inner.lock().expect("gateway mutex poisoned");
                if inner.bound {
                    eprintln!(
                        "airi-daemon: gateway listening on {}:{} (TLS: {})",
                        inner.hostname,
                        gateway.port(),
                        inner.bound_tls
                    );
                } else {
                    eprintln!(
                        "airi-daemon: gateway not bound ({}); will retry",
                        inner.last_error.as_deref().unwrap_or("unknown error")
                    );
                }
            }
            Err(err) => {
                gateway.set_error(format!("config load/heal failed: {err}"));
            }
        }
        gateway
    }

    /// Create a non-binding gateway that reports `bound: false` with `reason`
    /// on every D-Bus query. Used by `--no-gateway`; keeps the control
    /// interface honest while the desktop app (still) hosts the server.
    pub fn start_disabled(reason: &str) -> Self {
        Self::disabled(port_from_env(), reason)
    }

    fn disabled(port_override: Option<u16>, reason: &str) -> Self {
        Self {
            config_path: PathBuf::new(),
            cert_dir: PathBuf::new(),
            port_override,
            inner: Mutex::new(Inner {
                hostname: String::new(),
                auth_token: String::new(),
                tls_flag: false,
                bound_tls: false,
                bound: false,
                last_error: Some(reason.to_string()),
                adopted_from: None,
                server: None,
                last_attempt: Instant::now() - RETRY_INTERVAL,
            }),
        }
    }

    /// Re-attempt binding if the listener is down and the cooldown elapsed.
    /// Called from the daemon's poll loop; internally rate-limited. No-op
    /// when the gateway was never configured (`--no-gateway`).
    pub fn maybe_retry(&self) {
        if self.config_path.as_os_str().is_empty() {
            return; // disabled via --no-gateway
        }
        let do_retry = {
            let inner = self.inner.lock().expect("gateway mutex poisoned");
            !inner.bound && inner.last_attempt.elapsed() >= RETRY_INTERVAL
        };
        if do_retry {
            if let Ok(config) = load_or_heal(&self.config_path) {
                self.bind_once(&config);
            }
        }
    }

    /// Handle one D-Bus gateway request. Returns the reply payload string.
    pub fn handle(&self, request: &GatewayRequest) -> String {
        match request {
            GatewayRequest::Get => self.get_json(),
            GatewayRequest::Apply(raw) => self.apply(raw),
            GatewayRequest::RegenerateToken => self.regenerate_token(),
        }
    }

    fn get_json(&self) -> String {
        let inner = self.inner.lock().expect("gateway mutex poisoned");
        let ca_cert = self.cert_dir.join(airi_channel::certs::CA_CERT_FILE);
        serde_json::to_string(&GatewayControlStatus {
            hostname: inner.hostname.clone(),
            port: self.port(),
            tls_enabled: inner.bound_tls,
            bound: inner.bound,
            last_error: inner.last_error.clone(),
            adopted_from: inner.adopted_from.as_ref().map(|p| p.display().to_string()),
            ca_cert_path: ca_cert.is_file().then(|| ca_cert.display().to_string()),
            auth_token: inner.auth_token.clone(),
        })
        .expect("GatewayControlStatus serialization cannot fail")
    }

    fn apply(&self, raw: &str) -> String {
        let patch: GatewayControlApply = match serde_json::from_str(raw) {
            Ok(patch) => patch,
            Err(_) => {
                return serde_json::json!({ "ok": false, "error": "expected a JSON object payload" })
                    .to_string();
            }
        };

        let mut inner = self.inner.lock().expect("gateway mutex poisoned");
        let mut hostname = inner.hostname.clone();
        if let Some(h) = patch.hostname.as_deref() {
            let h = h.trim();
            if !h.is_empty() {
                hostname = h.to_string();
            }
        }

        let auth_token = match patch.auth_token.as_deref() {
            Some(t) if !t.trim().is_empty() => t.trim().to_string(),
            _ => inner.auth_token.clone(),
        };

        // `tlsConfig`/`websocketTlsConfig` are opaque flags: undefined =
        // keep, null = disable, anything else = enable (always `{}`).
        // The legacy `tlsConfig` spelling wins, as before.
        let tls_flag = patch.tls_config.as_ref().or(patch.websocket_tls_config.as_ref());
        let mut tls = inner.tls_flag;
        match tls_flag {
            None => {}                   // key absent: keep the current flag
            Some(serde_json::Value::Null) => tls = false, // explicit `null`: disable
            Some(_) => tls = true,      // any other value: enable
        }

        let config = ChannelConfig {
            hostname: hostname.clone(),
            auth_token: auth_token.clone(),
            tls_config: tls.then(|| serde_json::json!({})),
        };
        if let Err(err) = Self::persist(&self.config_path, &config) {
            let message = format!("failed to persist gateway config: {err}");
            inner.last_error = Some(message.clone());
            return serde_json::json!({ "ok": false, "error": message }).to_string();
        }

        // Rebind with the new effective config (bind_once syncs Inner).
        drop(inner);
        self.bind_once(&config);

        serde_json::json!({
            "websocketTlsConfig": if tls { serde_json::json!({}) } else { serde_json::Value::Null },
            "authToken": auth_token,
            "hostname": hostname,
        })
        .to_string()
    }

    fn regenerate_token(&self) -> String {
        let config = {
            let inner = self.inner.lock().expect("gateway mutex poisoned");
            ChannelConfig {
                hostname: inner.hostname.clone(),
                auth_token: uuid_v4(),
                tls_config: inner.tls_flag.then(|| serde_json::json!({})),
            }
        };
        if let Err(err) = Self::persist(&self.config_path, &config) {
            // Keep listening with the old token on write failure; the
            // rotation did not happen and the caller gets the plain truth.
            let message = format!("failed to persist rotated token: {err}");
            self.set_error(message.clone());
            return serde_json::json!({ "ok": false, "error": message }).to_string();
        }
        let token = config.auth_token.clone();
        self.bind_once(&config);
        serde_json::json!({ "authToken": token }).to_string()
    }

    fn port(&self) -> u16 {
        self.port_override
            .or_else(|| {
                std::env::var("SERVER_CHANNEL_PORT")
                    .ok()
                    .and_then(|v| v.parse().ok())
            })
            .unwrap_or(airi_channel::DEFAULT_PORT)
    }

    fn set_error(&self, message: String) {
        let mut inner = self.inner.lock().expect("gateway mutex poisoned");
        inner.last_error = Some(message);
        inner.bound = false;
        inner.last_attempt = Instant::now();
    }

    /// Persist config atomically (tmp file + rename in the same directory).
    /// Written `0600`: the file carries the auth token.
    fn persist(path: &Path, config: &ChannelConfig) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(config)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        #[cfg(unix)]
        {
            use std::io::Write as _;
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            // mode(0o600) only applies at creation; a pre-existing 0644
            // tmp would survive otherwise, and rename() would then hand
            // the daemon a 0644 config.
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&tmp)?;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
            file.write_all(json.as_bytes())?;
        }
        #[cfg(not(unix))]
        {
            fs::write(&tmp, json)?;
        }
        fs::rename(&tmp, path)
    }

    /// Stop the current listener (if any) and bind a fresh one with `config`.
    fn bind_once(&self, config: &ChannelConfig) {
        let mut inner = self.inner.lock().expect("gateway mutex poisoned");
        inner.last_attempt = Instant::now();
        // Single sync point: the effective config lives in Inner, kept in
        // lockstep with whatever was persisted/loaded.
        inner.hostname = config.hostname.clone();
        inner.auth_token = config.auth_token.clone();
        // Transport policy: loopback may run plaintext (`ws://`); anything
        // beyond loopback is wss-only, enforced regardless of the flag.
        // The forced value is deliberately NOT written back to the stored
        // flag, so switching back to loopback restores plaintext.
        inner.tls_flag = config.tls_config.is_some();
        let loopback = is_loopback_hostname(&config.hostname);
        let effective_tls = inner.tls_flag || !loopback;
        if !inner.tls_flag && !loopback {
            eprintln!(
                "airi-daemon: gateway hostname '{}' is not loopback; TLS is enforced (wss) even though tlsConfig is unset",
                config.hostname
            );
        }
        inner.bound_tls = effective_tls;
        // Detach first so the old server is told to stop even when the new
        // bind fails; existing sessions are NOT force-closed, matching the
        // in-app server (token rotation affects new connections only).
        let old = inner.server.take();
        if let Some(old) = old {
            old.stop();
        }

        let port = self.port();
        let result = if effective_tls {
            let domains = san_domains(&hostname_sans(&config.hostname));
            match get_or_create_certs(&self.cert_dir, &domains) {
                Ok(bundle) => {
                    let tls_config =
                        match airi_channel::tls_server_config(&bundle.cert_pem, &bundle.key_pem) {
                            Ok(cfg) => std::sync::Arc::new(cfg),
                            Err(err) => {
                                inner.last_error =
                                    Some(format!("TLS configuration unusable: {err}"));
                                inner.bound = false;
                                return;
                            }
                        };
                    ChannelServer::bind_tls(&config.hostname, port, config, tls_config)
                }
                Err(err) => {
                    inner.last_error = Some(format!("certificate management failed: {err}"));
                    inner.bound = false;
                    return;
                }
            }
        } else {
            ChannelServer::bind(&config.hostname, port, config)
        };

        match result {
            Ok(server) => match server.spawn() {
                Ok(handle) => {
                    inner.bound = true;
                    inner.last_error = None;
                    inner.server = Some(handle);
                }
                Err(err) => {
                    inner.last_error = Some(format!("failed to spawn gateway listener: {err}"));
                    inner.bound = false;
                }
            },
            Err(err) => {
                inner.last_error = Some(format!(
                    "failed to bind {}:{} — {err}",
                    config.hostname, port
                ));
                inner.bound = false;
            }
        }
    }
}

fn hostname_sans(hostname: &str) -> Vec<String> {
    // Wildcard binds are not DNS names; never put them in a cert.
    if hostname == "0.0.0.0" || hostname == "::" {
        Vec::new()
    } else {
        vec![hostname.to_string()]
    }
}

/// Whether `hostname` resolves to this machine. IPs classify by loopback
/// bit; anything unparseable that is not the literal `localhost` is treated
/// as remote (e.g. mDNS / tailnet DNS names) — i.e. TLS-enforced.
fn is_loopback_hostname(hostname: &str) -> bool {
    let trimmed = hostname.trim().trim_end_matches('.');
    if trimmed.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match trimmed.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.is_loopback(),
        Err(_) => false,
    }
}

fn port_from_env() -> Option<u16> {
    // `0` is accepted (ephemeral, tests); empty/garbage falls back to 6121.
    std::env::var("SERVER_CHANNEL_PORT")
        .ok()
        .and_then(|v| v.trim().parse::<u16>().ok())
}

const DEFAULT_HOSTNAME_PLACEHOLDER: &str = "127.0.0.1";

/// Copy `source` into the daemon-owned config path (atomic), preserving
/// everything including `tlsConfig`. Returns the source path on success.
fn adopt(source: &Path, dest: &Path) -> io::Result<PathBuf> {
    let raw = fs::read_to_string(source)?;
    // Basic validity check: it must parse as a JSON object. We deliberately
    // do not require a token here — load_or_heal decides freshness.
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    if !value.is_object() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "adoptable config is not a JSON object",
        ));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("json.tmp");
    fs::write(&tmp, raw)?;
    // fs::write is umask-dependent; never let the renamed copy be 0644.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(&tmp, dest)?;
    Ok(source.to_path_buf())
}

/// Scan for the Electrobun/Electron desktop app's gateway config
/// (`<userData>/server-channel-config.json`) and return the newest match by
/// modification time. Best-effort: directories that fail to read are skipped.
fn find_adoptable() -> Option<PathBuf> {
    let config_home = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".config")
        });

    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
    let matches = match fs::read_dir(&config_home) {
        Ok(entries) => entries,
        Err(_) => return None,
    };
    for entry in matches.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("ai.moeru.airi") {
            continue;
        }
        let candidate = entry.path().join("server-channel-config.json");
        if let Ok(meta) = fs::metadata(&candidate) {
            let modified = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            match &best {
                Some((_, current)) if *current >= modified => {}
                _ => best = Some((candidate, modified)),
            }
        }
    }
    best.map(|(path, _)| path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_gateway() -> (Gateway, tempfile::TempDir) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("server-channel");
        // Isolate from the real data dir by overriding paths directly.
        let gateway = Gateway {
            config_path: dir.join(CONFIG_FILE),
            cert_dir: dir.join(CERTS_DIR),
            port_override: Some(0),
            inner: Mutex::new(Inner {
                hostname: DEFAULT_HOSTNAME_PLACEHOLDER.to_string(),
                auth_token: String::new(),
                tls_flag: false,
                bound_tls: false,
                bound: false,
                last_error: None,
                adopted_from: None,
                server: None,
                last_attempt: Instant::now() - RETRY_INTERVAL,
            }),
        };
        // Heal the log path: write a fresh config and bind.
        let config = ChannelConfig::healed();
        fs::create_dir_all(&dir).unwrap();
        let json = serde_json::to_string_pretty(&config).unwrap();
        fs::write(&gateway.config_path, json).unwrap();
        gateway.bind_once(&config);
        (gateway, tmp)
    }

    fn get_json(gateway: &Gateway) -> serde_json::Value {
        serde_json::from_str(&gateway.handle(&GatewayRequest::Get)).unwrap()
    }

    #[test]
    fn fresh_gateway_binds_and_reports() {
        let (gateway, _tmp) = fresh_gateway();
        let v = get_json(&gateway);
        assert_eq!(v["bound"], true);
        assert_eq!(v["tlsEnabled"], false);
        assert!(v["authToken"].as_str().map(|t| t.len()) == Some(36));
        assert!(v["lastError"].is_null());
    }

    #[test]
    fn apply_changes_hostname_and_keeps_token() {
        airi_channel::install_default_crypto_provider();
        let (gateway, _tmp) = fresh_gateway();
        let before = get_json(&gateway)["authToken"]
            .as_str()
            .unwrap()
            .to_string();
        let reply = gateway.handle(&GatewayRequest::Apply(
            r#"{"hostname": "0.0.0.0"}"#.to_string(),
        ));
        let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
        assert_eq!(v["hostname"], "0.0.0.0");
        assert_eq!(v["authToken"], before);

        // Transport policy: non-loopback is wss-only, even with the flag unset.
        let after = get_json(&gateway);
        assert_eq!(after["hostname"], "0.0.0.0");
        assert_eq!(after["tlsEnabled"], true);
        assert_eq!(after["bound"], true, "TLS must bind after minting certs");

        // Back to loopback: plaintext by default again.
        gateway.handle(&GatewayRequest::Apply(
            r#"{"hostname": "127.0.0.1"}"#.to_string(),
        ));
        let after = get_json(&gateway);
        assert_eq!(after["tlsEnabled"], false);
        assert_eq!(after["bound"], true);
    }

    #[test]
    fn apply_rejects_garbage() {
        let (gateway, _tmp) = fresh_gateway();
        for raw in ["not json", "[1,2]", "5", "\"string\""] {
            let reply = gateway.handle(&GatewayRequest::Apply(raw.to_string()));
            let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
            assert_eq!(v["ok"], false, "input {raw} must be rejected");
        }
    }

    #[test]
    fn regenerate_token_rotates_and_persists() {
        let (gateway, _tmp) = fresh_gateway();
        let before = get_json(&gateway)["authToken"]
            .as_str()
            .unwrap()
            .to_string();
        let reply = gateway.handle(&GatewayRequest::RegenerateToken);
        let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
        let after = v["authToken"].as_str().unwrap();
        assert_ne!(after, before);
        assert_eq!(get_json(&gateway)["authToken"], after);
        // Persisted: a fresh load sees the rotated token.
        let reloaded = load_or_heal(&gateway.config_path).unwrap();
        assert_eq!(reloaded.auth_token, after);
    }

    #[test]
    fn loopback_classification() {
        assert!(is_loopback_hostname("127.0.0.1"));
        assert!(is_loopback_hostname("127.0.1.17")); // loopback range
        assert!(is_loopback_hostname("::1"));
        assert!(is_loopback_hostname("localhost"));
        assert!(is_loopback_hostname("LOCALHOST"));
        assert!(!is_loopback_hostname("0.0.0.0"));
        assert!(!is_loopback_hostname("192.168.1.10"));
        assert!(!is_loopback_hostname("my-host.tailnet.ts.net"));
        assert!(!is_loopback_hostname("::"));
    }

    #[test]
    fn tls_config_round_trips_through_apply() {
        let (gateway, _tmp) = fresh_gateway();
        // Enable TLS.
        gateway.handle(&GatewayRequest::Apply(
            r#"{"websocketTlsConfig": {}}"#.to_string(),
        ));
        let v = get_json(&gateway);
        assert_eq!(v["tlsEnabled"], true);
        assert_eq!(v["bound"], true, "TLS must bind with freshly minted certs");
        let reloaded = load_or_heal(&gateway.config_path).unwrap();
        assert!(reloaded.tls_config.is_some());
        // Disable TLS.
        gateway.handle(&GatewayRequest::Apply(
            r#"{"websocketTlsConfig": null}"#.to_string(),
        ));
        let v = get_json(&gateway);
        assert_eq!(v["tlsEnabled"], false);
        assert_eq!(v["bound"], true);
    }

    #[test]
    fn tls_flag_three_state_and_legacy_alias_precedence() {
        let (gateway, _tmp) = fresh_gateway();
        // Any non-null value (not just objects) enables TLS.
        gateway.handle(&GatewayRequest::Apply(
            r#"{"websocketTlsConfig": 0}"#.to_string(),
        ));
        assert_eq!(get_json(&gateway)["tlsEnabled"], true);

        // The legacy `tlsConfig` spelling wins over `websocketTlsConfig`
        // when both are present, including an explicit `null`.
        gateway.handle(&GatewayRequest::Apply(
            r#"{"tlsConfig": null, "websocketTlsConfig": {}}"#.to_string(),
        ));
        assert_eq!(get_json(&gateway)["tlsEnabled"], false);

        // Explicit `null` on the canonical key disables TLS.
        gateway.handle(&GatewayRequest::Apply(
            r#"{"websocketTlsConfig": {}}"#.to_string(),
        ));
        assert_eq!(get_json(&gateway)["tlsEnabled"], true);
        gateway.handle(&GatewayRequest::Apply(
            r#"{"websocketTlsConfig": null}"#.to_string(),
        ));
        assert_eq!(get_json(&gateway)["tlsEnabled"], false);

        // Absent key keeps the current flag.
        gateway.handle(&GatewayRequest::Apply(
            r#"{"websocketTlsConfig": {}}"#.to_string(),
        ));
        gateway.handle(&GatewayRequest::Apply(r#"{"hostname": "127.0.0.1"}"#.to_string()));
        assert_eq!(get_json(&gateway)["tlsEnabled"], true);
    }

    #[test]
    fn persist_tightens_preexisting_0644_tmp() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("config.json");
        let tmp_path = path.with_extension("json.tmp");
        fs::write(&tmp_path, "stale").unwrap();
        fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o644)).unwrap();
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        Gateway::persist(&path, &ChannelConfig::healed()).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "persisted config must be owner-only");
    }

    #[test]
    fn adoption_tightens_preexisting_0644_dest() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let source_dir = tmp.path().join("ai.moeru.airi.test");
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("server-channel-config.json");
        fs::write(
            &source,
            r#"{ "hostname": "127.0.0.1", "authToken": "keep-me-123" }"#,
        )
        .unwrap();
        let dest = tmp.path().join("daemon").join(CONFIG_FILE);
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        fs::write(&dest, "old").unwrap();
        fs::set_permissions(&dest, fs::Permissions::from_mode(0o644)).unwrap();
        // A stale 0644 tmp must not survive either.
        fs::write(dest.with_extension("json.tmp"), "stale").unwrap();
        fs::set_permissions(
            dest.with_extension("json.tmp"),
            fs::Permissions::from_mode(0o644),
        )
        .unwrap();

        adopt(&source, &dest).expect("adopt");
        let mode = fs::metadata(&dest).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "adopted config must be owner-only");
    }

    #[test]
    fn adoption_preserves_token_and_tls() {
        let tmp = tempfile::tempdir().unwrap();
        let source_dir = tmp.path().join("ai.moeru.airi.test");
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("server-channel-config.json");
        fs::write(
            &source,
            r#"{ "hostname": "0.0.0.0", "authToken": "keep-me-123", "tlsConfig": {} }"#,
        )
        .unwrap();
        let dest = tmp
            .path()
            .join("daemon")
            .join("server-channel")
            .join(CONFIG_FILE);
        let adopted = adopt(&source, &dest).expect("adopt");
        assert_eq!(adopted, source);
        let raw = fs::read_to_string(&dest).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["authToken"], "keep-me-123");
        assert_eq!(v["tlsConfig"], serde_json::json!({}));
    }
}
