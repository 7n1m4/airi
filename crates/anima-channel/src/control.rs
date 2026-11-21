// SPDX-License-Identifier: GPL-3.0-or-later

//! D-Bus control-plane DTOs for the daemon's gateway surface
//! (`org.moeru.airi.Daemon1`: `GetGatewayConfig` / `ApplyGatewayConfig` /
//! `RegenerateGatewayToken`).
//!
//! These mirror the JSON payloads the D-Bus handlers speak today — the
//! Electrobun app consumes them over eventa once re-backed to D-Bus (see
//! `docs/design-daemon-gateway.md`, increment 2). They are exported to
//! TypeScript by the `export-wire-types` example, alongside the wire frames.
//!
//! Field names match the hand-built payloads byte-for-byte: `tlsEnabled`,
//! `lastError`, `adoptedFrom`, `caCertPath`, `authToken`,
//! `websocketTlsConfig`. Do not rename them without migrating the callers.

use serde::{Deserialize, Serialize};

/// Reply of `GetGatewayConfig`. Field order matches the historical payload;
/// `None`s serialize as explicit `null` (no `skip_serializing_if`) so older
/// consumers see the same keys as before.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct GatewayControlStatus {
    /// Bind address (`127.0.0.1` by default).
    pub hostname: String,
    /// Port the gateway listens on.
    pub port: u16,
    /// Whether the bound transport is `wss://` (flag or enforced non-loopback).
    #[serde(rename = "tlsEnabled")]
    pub tls_enabled: bool,
    /// Whether the listener is currently bound.
    pub bound: bool,
    /// Why the listener is not bound, if it is not.
    #[serde(rename = "lastError", default)]
    pub last_error: Option<String>,
    /// Path of the desktop-app config this daemon adopted at first start, if any.
    #[serde(rename = "adoptedFrom", default)]
    pub adopted_from: Option<String>,
    /// Path of the CA certificate clients must trust, present only once minted.
    #[serde(rename = "caCertPath", default)]
    pub ca_cert_path: Option<String>,
    /// Shared secret clients must present (the D-Bus client is local and
    /// trusted with it, same as the web settings UI today).
    #[serde(rename = "authToken")]
    pub auth_token: String,
}

/// Deserialize a present key (including `null`) as `Some(value)`.
///
/// Paired with `#[serde(default)]`, this is how the TLS flag fields keep
/// three states straight: absent = `None` (keep), `null` = `Some(null)`
/// (disable), anything else = `Some(v)` (enable). Plain `Option<T>` would
/// collapse an explicit `null` into `None`, losing the "disable" signal.
fn deserialize_some<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Ok(Some(T::deserialize(deserializer)?))
}

/// Patch payload of `ApplyGatewayConfig` (Electron handler shape).
///
/// All fields are optional; absent means "keep the current value".
/// `websocketTlsConfig` is an opaque TLS flag: `null` disables TLS, any
/// other value (object, even `{}`) enables it. The legacy `tlsConfig`
/// spelling is accepted as well (and wins over `websocketTlsConfig`, as
/// before) but is deliberately not part of the exported schema.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct GatewayControlApply {
    /// Opaque TLS flag: `null` = disable, present (any JSON value) = enable.
    #[serde(rename = "websocketTlsConfig", default, deserialize_with = "deserialize_some", skip_serializing_if = "Option::is_none")]
    #[specta(type = specta_typescript::Unknown)]
    pub websocket_tls_config: Option<serde_json::Value>,
    /// New shared secret; empty/whitespace is rejected (kept as-is).
    #[serde(rename = "authToken", default, skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    /// New bind address; empty/whitespace is rejected (kept as-is).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    /// Legacy alias for `websocketTlsConfig`, kept for the Electron handler
    /// contract. Not exported to TypeScript. Three-state like
    /// `websocket_tls_config` (absent / `null` / other value).
    #[serde(rename = "tlsConfig", default, deserialize_with = "deserialize_some", skip_serializing_if = "Option::is_none")]
    #[specta(skip)]
    pub tls_config: Option<serde_json::Value>,
}
