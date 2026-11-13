// SPDX-License-Identifier: GPL-3.0-or-later

//! Synchronous client for the `airi-channel` gateway.
//!
//! This is deliberately small: it speaks the same HTTP `Upgrade` handshake and
//! typed text frames as [`crate::server`], authenticates once, and exposes the
//! read-only `runtime.*` RPCs. It does not reconnect, persist credentials, or
//! know anything about UIs; those decisions belong to the daemon and clients.

use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rustls::pki_types::ServerName;
use serde_json::{json, Value};
use thiserror::Error;

use crate::base64::base64_encode;
use crate::wire::{GatewayClientFrame, GatewayServerFrame};
use crate::ws::{
    accept_key, encode_frame, Frame, FrameDecoder, MAX_HTTP_HEADER_BYTES, MAX_WS_PAYLOAD_BYTES,
    OP_CLOSE, OP_PING, OP_PONG, OP_TEXT,
};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_PATH: &str = "/ws";

trait ReadWrite: Read + Write + Send {}

impl<T: Read + Write + Send> ReadWrite for T {}

/// Errors returned by the blocking gateway client.
#[derive(Debug, Error)]
pub enum GatewayClientError {
    /// The URL is not a supported `ws://` or `wss://` URL.
    #[error("invalid gateway URL: {0}")]
    InvalidUrl(String),
    /// A socket, DNS, or TLS I/O operation failed.
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    /// TLS setup or CA validation failed.
    #[error("TLS error: {0}")]
    Tls(String),
    /// The HTTP WebSocket upgrade response was invalid.
    #[error("WebSocket handshake failed (status {status:?}): {message}")]
    Handshake {
        /// HTTP status code when one could be parsed.
        status: Option<u16>,
        /// Detail suitable for logs; never carries credentials.
        message: String,
    },
    /// The server closed the connection.
    #[error("server closed the connection (code {code:?}): {reason}")]
    Closed {
        /// RFC 6455 close code, when the close frame carried one.
        code: Option<u16>,
        /// Close reason, or a transport-level explanation.
        reason: String,
    },
    /// The server sent a protocol error frame or an unexpected frame.
    #[error("unexpected frame: {0}")]
    UnexpectedFrame(String),
    /// A typed server error frame arrived outside the RPC error path.
    #[error("server error {code}: {message}")]
    ServerError {
        /// Stable machine-readable code.
        code: String,
        /// Human-readable detail.
        message: String,
    },
    /// Authentication was rejected by the server.
    #[error("authentication rejected ({code}): {message}")]
    Authentication {
        /// Stable machine-readable code.
        code: String,
        /// Human-readable detail.
        message: String,
    },
    /// An RPC reply reported failure.
    #[error("RPC {action} failed ({code}): {message}")]
    Rpc {
        /// RPC action that failed.
        action: String,
        /// Stable machine-readable code.
        code: String,
        /// Human-readable detail.
        message: String,
    },
    /// A server frame could not be decoded.
    #[error("frame decode error: {0}")]
    Decode(#[from] crate::ws::DecodeError),
}

struct ParsedUrl {
    tls: bool,
    host: String,
    port: u16,
    authority: String,
    path: String,
}

/// Blocking client for the AIRI gateway WebSocket protocol.
///
/// Create one with [`GatewayClient::connect`], authenticate with
/// [`GatewayClient::authenticate`], then call RPCs or close the connection.
pub struct GatewayClient {
    stream: Box<dyn ReadWrite + Send>,
    decoder: FrameDecoder,
    counter: u64,
    closed: bool,
}

impl GatewayClient {
    /// Connect with the default five-second socket timeout.
    ///
    /// `ca_cert_pem` is required for `wss://` and rejected for `ws://`.
    /// `wss://` URLs that reach beyond loopback should always be used.
    pub fn connect(url: &str, ca_cert_pem: Option<&[u8]>) -> Result<Self, GatewayClientError> {
        Self::connect_with_timeout(url, ca_cert_pem, DEFAULT_TIMEOUT)
    }

    /// Connect with an explicit socket timeout.
    ///
    /// `ca_cert_pem` is required for `wss://` and rejected for `ws://`.
    pub fn connect_with_timeout(
        url: &str,
        ca_cert_pem: Option<&[u8]>,
        timeout: Duration,
    ) -> Result<Self, GatewayClientError> {
        let parsed = ParsedUrl::parse(url)?;
        if parsed.tls != ca_cert_pem.is_some() {
            return Err(GatewayClientError::Tls(if parsed.tls {
                "wss:// requires a CA PEM".to_string()
            } else {
                "ws:// does not use a CA PEM; use wss:// for network exposure".to_string()
            }));
        }
        let tcp = connect_tcp(&parsed, timeout)?;
        let stream: Box<dyn ReadWrite + Send> = if parsed.tls {
            Box::new(connect_tls(
                tcp,
                &parsed.host,
                ca_cert_pem.expect("checked above"),
            )?)
        } else {
            Box::new(tcp)
        };
        let mut client = Self {
            stream,
            decoder: FrameDecoder::new(MAX_WS_PAYLOAD_BYTES),
            counter: 0,
            closed: false,
        };
        client.perform_upgrade(&parsed.path, &parsed.authority)?;
        Ok(client)
    }

    /// Authenticate with the gateway token.
    ///
    /// This must be the first message sent on a fresh connection.
    pub fn authenticate(&mut self, token: &str) -> Result<(), GatewayClientError> {
        let frame = GatewayClientFrame::Auth {
            auth_token: token.to_string(),
        };
        self.send_json_frame(&frame)?;
        match self.read_json_frame()? {
            GatewayServerFrame::Auth { ok: true } => Ok(()),
            GatewayServerFrame::Error { error } => Err(GatewayClientError::Authentication {
                code: error.code,
                message: error.message,
            }),
            frame => Err(GatewayClientError::UnexpectedFrame(format!(
                "expected auth reply, got {:?}",
                std::mem::discriminant(&frame)
            ))),
        }
    }

    /// Call an RPC action and return its JSON result on success.
    ///
    /// `None` sends an empty object payload, matching the server dispatch
    /// behavior for omitted payloads.
    pub fn rpc(
        &mut self,
        action: &str,
        payload: Option<Value>,
    ) -> Result<Value, GatewayClientError> {
        if self.closed {
            return Err(GatewayClientError::Closed {
                code: None,
                reason: "client already closed".to_string(),
            });
        }
        let frame = GatewayClientFrame::Rpc {
            action: action.to_string(),
            payload: Some(payload.unwrap_or_else(|| json!({}))),
            id: None,
        };
        self.send_json_frame(&frame)?;
        match self.read_json_frame()? {
            GatewayServerFrame::Rpc {
                action: reply_action,
                ok: true,
                data,
                error: None,
                ..
            } if reply_action == action => Ok(data.unwrap_or(Value::Null)),
            GatewayServerFrame::Rpc {
                action: reply_action,
                ok: false,
                error: Some(error),
                ..
            } if reply_action == action => Err(GatewayClientError::Rpc {
                action: action.to_string(),
                code: error.code,
                message: error.message,
            }),
            GatewayServerFrame::Error { error } => Err(GatewayClientError::ServerError {
                code: error.code,
                message: error.message,
            }),
            frame => Err(GatewayClientError::UnexpectedFrame(format!(
                "expected RPC reply for {action}, got {:?}",
                std::mem::discriminant(&frame)
            ))),
        }
    }

    /// Call `runtime.ping` and decode the typed reply.
    pub fn runtime_ping(&mut self) -> Result<crate::wire::RuntimePingReply, GatewayClientError> {
        let value = self.rpc("runtime.ping", None)?;
        serde_json::from_value(value).map_err(|err| {
            GatewayClientError::UnexpectedFrame(format!("invalid runtime.ping reply: {err}"))
        })
    }

    /// Call `runtime.status` and decode the typed reply.
    pub fn runtime_status(
        &mut self,
    ) -> Result<crate::wire::RuntimeStatusReply, GatewayClientError> {
        let value = self.rpc("runtime.status", None)?;
        serde_json::from_value(value).map_err(|err| {
            GatewayClientError::UnexpectedFrame(format!("invalid runtime.status reply: {err}"))
        })
    }

    /// Send a normal close frame. Repeated calls are no-ops.
    pub fn close(&mut self) -> Result<(), GatewayClientError> {
        if self.closed {
            return Ok(());
        }
        let payload = 1000u16.to_be_bytes();
        let result = self.send_frame(OP_CLOSE, &payload);
        self.closed = true;
        result
    }

    fn perform_upgrade(&mut self, path: &str, authority: &str) -> Result<(), GatewayClientError> {
        let key_bytes = self.next_randomish_16();
        let key = base64_encode(&key_bytes);
        let request = format!(
			"GET {path} HTTP/1.1\r\nHost: {authority}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
		);
        self.stream.write_all(request.as_bytes())?;
        self.stream.flush()?;

        let headers = self.read_http_header()?;
        let (status, headers) = parse_upgrade_response(&headers)?;
        if status != 101 {
            return Err(GatewayClientError::Handshake {
                status: Some(status),
                message: format!("expected 101, got {status}"),
            });
        }
        let expected = accept_key(&key);
        let actual = header_value(&headers, "sec-websocket-accept").ok_or_else(|| {
            GatewayClientError::Handshake {
                status: Some(status),
                message: "missing Sec-WebSocket-Accept header".to_string(),
            }
        })?;
        if actual != expected {
            return Err(GatewayClientError::Handshake {
                status: Some(status),
                message: "Sec-WebSocket-Accept mismatch".to_string(),
            });
        }
        Ok(())
    }

    fn read_http_header(&mut self) -> Result<Vec<u8>, GatewayClientError> {
        let mut buf = Vec::with_capacity(1024);
        let mut byte = [0u8; 1];
        loop {
            self.stream.read_exact(&mut byte)?;
            buf.push(byte[0]);
            if buf.windows(4).any(|window| window == b"\r\n\r\n") {
                return Ok(buf);
            }
            if buf.len() > MAX_HTTP_HEADER_BYTES {
                return Err(GatewayClientError::Handshake {
                    status: None,
                    message: "HTTP header block exceeded the size limit".to_string(),
                });
            }
        }
    }

    fn send_json_frame(&mut self, frame: &GatewayClientFrame) -> Result<(), GatewayClientError> {
        let payload = serde_json::to_vec(frame).map_err(|err| {
            GatewayClientError::UnexpectedFrame(format!("failed to serialize client frame: {err}"))
        })?;
        self.send_frame(OP_TEXT, &payload)
    }

    fn send_frame(&mut self, opcode: u8, payload: &[u8]) -> Result<(), GatewayClientError> {
        let mask = self.next_mask();
        let frame = encode_frame(opcode, payload, Some(mask));
        self.stream.write_all(&frame)?;
        self.stream.flush()?;
        Ok(())
    }

    fn read_json_frame(&mut self) -> Result<GatewayServerFrame, GatewayClientError> {
        let text = self.read_text_frame()?;
        serde_json::from_str(&text).map_err(|err| {
            GatewayClientError::UnexpectedFrame(format!("invalid server frame JSON: {err}"))
        })
    }

    fn read_text_frame(&mut self) -> Result<String, GatewayClientError> {
        let frame = self.read_frame()?;
        if frame.opcode != OP_TEXT {
            return Err(GatewayClientError::UnexpectedFrame(format!(
                "expected text frame, got opcode 0x{:x}",
                frame.opcode
            )));
        }
        if !frame.fin {
            return Err(GatewayClientError::UnexpectedFrame(
                "fragmented text frames are not supported".to_string(),
            ));
        }
        String::from_utf8(frame.payload).map_err(|err| {
            GatewayClientError::UnexpectedFrame(format!("server text frame was not UTF-8: {err}"))
        })
    }

    fn read_frame(&mut self) -> Result<Frame, GatewayClientError> {
        loop {
            while let Some(frame) = self.decoder.next_frame()? {
                match frame.opcode {
                    OP_PING => {
                        self.send_frame(OP_PONG, &frame.payload)?;
                        continue;
                    }
                    OP_PONG => continue,
                    OP_CLOSE => return Err(close_error(&frame.payload, "server sent close")),
                    OP_TEXT => return Ok(frame),
                    opcode => {
                        return Err(GatewayClientError::UnexpectedFrame(format!(
                            "unsupported opcode 0x{opcode:x}"
                        )));
                    }
                }
            }
            let mut buf = [0u8; 4096];
            let read = self.stream.read(&mut buf)?;
            if read == 0 {
                return Err(GatewayClientError::Closed {
                    code: None,
                    reason: "connection closed without a close frame".to_string(),
                });
            }
            self.decoder.push(&buf[..read]);
        }
    }

    fn next_randomish_16(&mut self) -> [u8; 16] {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mixed = nanos ^ ((std::process::id() as u128) << 64) ^ ((self.counter as u128) << 1);
        self.counter = self.counter.wrapping_add(1);
        mixed.to_be_bytes()
    }

    fn next_mask(&mut self) -> [u8; 4] {
        let bytes = self.next_randomish_16();
        [bytes[0], bytes[1], bytes[2], bytes[3]]
    }
}

impl ParsedUrl {
    fn parse(url: &str) -> Result<Self, GatewayClientError> {
        let (scheme, rest) = url
            .split_once("://")
            .ok_or_else(|| GatewayClientError::InvalidUrl("missing scheme".to_string()))?;
        let tls = match scheme {
            "ws" => false,
            "wss" => true,
            other => {
                return Err(GatewayClientError::InvalidUrl(format!(
                    "unsupported scheme {other}; expected ws or wss"
                )))
            }
        };

        let rest = rest.split('#').next().unwrap_or(rest);
        let (authority, path) = match rest.find('/') {
            Some(index) => (&rest[..index], &rest[index..]),
            None => (rest, DEFAULT_PATH),
        };
        if authority.is_empty() || authority.contains('@') {
            return Err(GatewayClientError::InvalidUrl(
                "authority is empty or contains user information".to_string(),
            ));
        }

        let (host, port) = parse_authority(authority, if tls { 443 } else { 80 })?;
        let path = if path.is_empty() {
            DEFAULT_PATH.to_string()
        } else if path.starts_with('/') {
            path.to_string()
        } else {
            return Err(GatewayClientError::InvalidUrl(
                "path does not start with /".to_string(),
            ));
        };

        Ok(Self {
            tls,
            host,
            port,
            authority: authority.to_string(),
            path,
        })
    }
}

fn parse_authority(
    authority: &str,
    default_port: u16,
) -> Result<(String, u16), GatewayClientError> {
    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest
            .find(']')
            .ok_or_else(|| GatewayClientError::InvalidUrl("unterminated IPv6 host".to_string()))?;
        let host = &rest[..end];
        let suffix = &rest[end + 1..];
        let port = if suffix.is_empty() {
            default_port
        } else if let Some(port) = suffix.strip_prefix(':') {
            port.parse::<u16>().map_err(|_| {
                GatewayClientError::InvalidUrl(format!("invalid port in {authority}"))
            })?
        } else {
            return Err(GatewayClientError::InvalidUrl(format!(
                "unexpected characters after bracketed host in {authority}"
            )));
        };
        if host.is_empty() {
            return Err(GatewayClientError::InvalidUrl("empty host".to_string()));
        }
        return Ok((host.to_string(), port));
    }

    let colon_count = authority.matches(':').count();
    if colon_count > 1 {
        return Err(GatewayClientError::InvalidUrl(
            "unbracketed IPv6 addresses are not supported".to_string(),
        ));
    }
    match authority.rsplit_once(':') {
        Some((host, port)) => {
            if host.is_empty() {
                return Err(GatewayClientError::InvalidUrl("empty host".to_string()));
            }
            let port = port.parse::<u16>().map_err(|_| {
                GatewayClientError::InvalidUrl(format!("invalid port in {authority}"))
            })?;
            Ok((host.to_string(), port))
        }
        None => {
            if authority.is_empty() {
                return Err(GatewayClientError::InvalidUrl("empty host".to_string()));
            }
            Ok((authority.to_string(), default_port))
        }
    }
}

fn connect_tcp(parsed: &ParsedUrl, timeout: Duration) -> Result<TcpStream, GatewayClientError> {
    let mut last_error = None;
    for addr in (parsed.host.as_str(), parsed.port).to_socket_addrs()? {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(stream) => {
                stream.set_read_timeout(Some(timeout))?;
                stream.set_write_timeout(Some(timeout))?;
                let _ = stream.set_nodelay(true);
                return Ok(stream);
            }
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error
        .unwrap_or_else(|| io::Error::other("no addresses resolved"))
        .into())
}

fn connect_tls(
    tcp: TcpStream,
    host: &str,
    ca_cert_pem: &[u8],
) -> Result<rustls::StreamOwned<rustls::ClientConnection, TcpStream>, GatewayClientError> {
    crate::install_default_crypto_provider();
    let certs: Vec<_> = rustls_pemfile::certs(&mut &ca_cert_pem[..])
        .filter_map(Result::ok)
        .collect();
    if certs.is_empty() {
        return Err(GatewayClientError::Tls(
            "CA PEM did not contain any certificates".to_string(),
        ));
    }
    let mut roots = rustls::RootCertStore::empty();
    for der in certs {
        roots.add(der).map_err(|err| {
            GatewayClientError::Tls(format!("failed to add CA certificate: {err}"))
        })?;
    }
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let server_name = ServerName::try_from(host.to_string())
        .map_err(|_| GatewayClientError::Tls(format!("invalid TLS server name {host:?}")))?;
    let conn = rustls::ClientConnection::new(Arc::new(config), server_name)
        .map_err(|err| GatewayClientError::Tls(err.to_string()))?;
    Ok(rustls::StreamOwned::new(conn, tcp))
}

fn parse_upgrade_response(
    headers: &[u8],
) -> Result<(u16, Vec<(String, String)>), GatewayClientError> {
    let text = std::str::from_utf8(headers).map_err(|err| GatewayClientError::Handshake {
        status: None,
        message: format!("HTTP headers were not UTF-8: {err}"),
    })?;
    let mut lines = text.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| GatewayClientError::Handshake {
            status: None,
            message: format!("malformed status line {status_line:?}"),
        })?;
    let mut parsed = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        parsed.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }
    Ok((status, parsed))
}

fn header_value<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(header, _)| header == name)
        .map(|(_, value)| value.as_str())
}

fn close_error(payload: &[u8], fallback: &str) -> GatewayClientError {
    let (code, reason) = if payload.len() >= 2 {
        let code = u16::from_be_bytes([payload[0], payload[1]]);
        let reason = String::from_utf8(payload[2..].to_vec()).unwrap_or_default();
        (Some(code), reason)
    } else {
        (None, fallback.to_string())
    };
    GatewayClientError::Closed { code, reason }
}
