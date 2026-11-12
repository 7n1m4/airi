// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! `airi-channel` — the AIRI gateway channel server for the Qt desktop app.
//!
//! A local WebSocket server on port **6121** (override with
//! `SERVER_CHANNEL_PORT`, see [`server_channel_port`]) implementing the
//! auth-token handshake from the `airi-gateway-websocket-protocol` skill:
//!
//! 1. Waits for an HTTP `Upgrade: websocket` on a raw TCP socket.
//! 2. Speaks just enough WebSocket (text frames, close, ping/pong) for a
//!    gateway — no TLS, no extensions, no subprotocols.
//! 3. Requires the client's **first message to authenticate** with the
//!    `authToken` from `<data>/airi-qt/server-channel/config.json`.
//!    Unauthenticated peers receive nothing else and are closed with 1008.
//! 4. After auth: `ping` → `pong` (plus the server-runtime
//!    `transport:connection:heartbeat` mirror), and a typed `rpc` dispatch
//!    registry (`runtime.ping`, `runtime.status`, `gateway.config`,
//!    `gateway.auth`) with stable `rpc_*` error codes. See [`dispatch`].
//!    Unknown types get a typed `error` frame.
//!
//! ## Security posture (read before enabling on a network)
//!
//! - **No TLS.** Traffic, including the auth token, crosses the wire in
//!   plaintext. This matches the Electron gateway's *default* only when the
//!   Electron build runs without mkcert TLS configured — the Electron build
//!   can additionally mint a local CA; this crate cannot. TLS/mkcert support
//!   is **deferred** and tracked in the phase note.
//! - **Loopback-only by default.** The healed config binds `127.0.0.1`.
//!   Binding `0.0.0.0` for LAN clients is possible but is plaintext over the
//!   LAN and MUST be weighed against the mkcert-less posture — do not do it
//!   casually.
//! - **Token in plaintext config.** `server-channel/config.json` holds the
//!   `authToken` in clear text, exactly like the Electron build's
//!   `createConfig('server-channel', 'config.json', …)`. File permissions on
//!   the data dir are the only protection; protect them.
//! - **Auto-heal.** Missing/invalid config → a fresh UUIDv4 token is
//!   generated and the file is rewritten (same contract as `autoHeal: true`
//!   upstream). Clients must re-read or re-pair after a regeneration.
//! - **No origin validation.** Any local process (or, if bound to LAN, any
//!   host) can attempt the handshake; possession of the token is the only
//!   gate. Origin checking is deferred — see the phase note.
//! - **No rate limiting / brute-force protection** on the token. Loopback
//!   exposure makes online guessing impractical only for high-entropy
//!   tokens; tokens are UUIDv4 (122 bits), which is the mitigation.
//! - Token comparison avoids early-exit timing leaks on content (length is
//!   compared first, which is acceptable for fixed-shape UUIDs).
//!
//! ## What this is not (yet)
//!
//! Not a general-purpose RPC bridge, not a module registry, not audio
//! streaming, not LAN discovery. The `rpc` registry is a small, fully local
//! slice of the gateway protocol. `renderer.*` methods dispatch to
//! embedder-registered [`RendererHandlers`] (read-only, plain-JSON handlers
//! registered via [`ChannelServer::bind_with_renderer`]); unregistered
//! methods reply `rpc_not_implemented`. Wiring Qt GUI-thread targets into
//! that registry is a separate decision — handlers here must never touch
//! `QObject`s directly; they get plain JSON and return plain JSON.

pub mod base64;
pub mod config;
pub mod dispatch;
pub mod server;
pub mod session;
pub mod sha1;
pub mod uuid;
pub mod ws;

pub use config::{default_config_path, load_or_heal, ChannelConfig, ConfigError, DEFAULT_HOSTNAME};
pub use dispatch::{
    RendererHandler, RendererHandlers, RpcContext, RpcError, RpcRegistry, APP_NAME, PROTOCOL,
};
pub use server::{ChannelServer, ServerHandle};
pub use session::{CloseInfo, Session, SessionOutcome, SessionState, CLOSE_POLICY_VIOLATION};
pub use ws::{accept_key, encode_frame, Frame, FrameDecoder, OP_CLOSE, OP_PING, OP_PONG, OP_TEXT};

/// Default channel-server port (`SERVER_CHANNEL_PORT` overrides).
pub const DEFAULT_PORT: u16 = 6121;

/// Parse a `SERVER_CHANNEL_PORT`-style value. Returns `None` for empty,
/// non-numeric, or out-of-range input. `0` is allowed (ephemeral, tests).
pub fn parse_port(raw: &str) -> Option<u16> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed.parse::<u16>().ok()
}

/// Port from `SERVER_CHANNEL_PORT`, falling back to [`DEFAULT_PORT`].
pub fn server_channel_port() -> u16 {
    std::env::var("SERVER_CHANNEL_PORT")
        .ok()
        .as_deref()
        .and_then(parse_port)
        .unwrap_or(DEFAULT_PORT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_port_accepts_valid() {
        assert_eq!(parse_port("6121"), Some(6121));
        assert_eq!(parse_port(" 6122 "), Some(6122));
        assert_eq!(parse_port("0"), Some(0));
        assert_eq!(parse_port("65535"), Some(65535));
    }

    #[test]
    fn parse_port_rejects_invalid() {
        assert_eq!(parse_port(""), None);
        assert_eq!(parse_port("abc"), None);
        assert_eq!(parse_port("65536"), None);
        assert_eq!(parse_port("-1"), None);
        assert_eq!(parse_port("99999999999"), None);
    }

    #[test]
    fn server_channel_port_defaults_to_6121() {
        // Save/restore so the test doesn't leak env state into other tests.
        let saved = std::env::var("SERVER_CHANNEL_PORT").ok();
        std::env::remove_var("SERVER_CHANNEL_PORT");
        assert_eq!(server_channel_port(), DEFAULT_PORT);
        match saved {
            Some(v) => std::env::set_var("SERVER_CHANNEL_PORT", v),
            None => std::env::remove_var("SERVER_CHANNEL_PORT"),
        }
    }
}
