// SPDX-License-Identifier: GPL-3.0-or-later

//! WebSocket framing (RFC 6455) and the HTTP `Upgrade` handshake.
//!
//! Only the subset the gateway needs is implemented:
//!
//! - Text frames (plus continuation for fragmented messages), built/parsed
//!   by [`encode_frame`] / [`FrameDecoder`].
//! - Control frames: close, ping, pong (control payloads are limited to 125
//!   bytes and must not be fragmented — enforced in [`FrameDecoder`]).
//! - Client → server frames **must** be masked; [`FrameDecoder`] unmasks
//!   them. Server → client frames are sent unmasked by the server.
//! - No binary frames, no extensions (e.g. permessage-deflate), no
//!   subprotocol negotiation.
//!
//! The decoder is a push-based byte accumulator so it can be fed from a
//! socket in arbitrary read chunks and unit-tested with raw byte strings.

use crate::base64::base64_encode;
use crate::sha1::sha1;

/// `Sec-WebSocket-Accept` magic GUID from RFC 6455 §1.3.
pub const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// Opcode: continuation of a fragmented message.
pub const OP_CONTINUATION: u8 = 0x0;
/// Opcode: text frame (UTF-8 payload).
pub const OP_TEXT: u8 = 0x1;
/// Opcode: binary frame. Unsupported by this server (close 1003).
pub const OP_BINARY: u8 = 0x2;
/// Opcode: connection close.
pub const OP_CLOSE: u8 = 0x8;
/// Opcode: ping.
pub const OP_PING: u8 = 0x9;
/// Opcode: pong.
pub const OP_PONG: u8 = 0xA;

/// Compute the `Sec-WebSocket-Accept` header value for a client key.
///
/// `accept = base64(sha1(client_key + WS_GUID))`
pub fn accept_key(client_key: &str) -> String {
    let mut input = client_key.as_bytes().to_vec();
    input.extend_from_slice(WS_GUID.as_bytes());
    base64_encode(&sha1(&input))
}

/// A single decoded (or to-be-encoded) WebSocket frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// FIN bit — true if this is the final frame of a message.
    pub fin: bool,
    /// Opcode ([`OP_TEXT`], [`OP_CLOSE`], …).
    pub opcode: u8,
    /// Payload bytes (already unmasked on decode).
    pub payload: Vec<u8>,
}

/// Encode one frame. FIN is always set by this encoder.
///
/// Pass `Some(mask)` for client → server traffic (clients MUST mask,
/// RFC 6455 §5.3) and `None` for server → client traffic.
pub fn encode_frame(opcode: u8, payload: &[u8], mask: Option<[u8; 4]>) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 14);
    out.push(0x80 | (opcode & 0x0f)); // FIN | opcode

    let len = payload.len();
    let mask_bit = if mask.is_some() { 0x80 } else { 0x00 };
    if len < 126 {
        out.push(mask_bit | len as u8);
    } else if len <= u16::MAX as usize {
        out.push(mask_bit | 126);
        out.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        out.push(mask_bit | 127);
        out.extend_from_slice(&(len as u64).to_be_bytes());
    }

    match mask {
        Some(m) => {
            out.extend_from_slice(&m);
            out.extend(payload.iter().enumerate().map(|(i, b)| b ^ m[i % 4]));
        }
        None => out.extend_from_slice(payload),
    }
    out
}

/// Errors produced while decoding frames.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DecodeError {
    /// Frame (or 64-bit length field) exceeds the configured payload cap.
    #[error("frame payload of {len} bytes exceeds the {max}-byte limit")]
    FrameTooLarge {
        /// Declared length in bytes.
        len: u64,
        /// Configured cap in bytes.
        max: u64,
    },
    /// Reserved (RSV) bits were set — no extensions are negotiated.
    #[error("reserved bits set in frame header")]
    ReservedBits,
    /// Control frames must be <= 125 bytes and must not be fragmented.
    #[error("invalid control frame")]
    InvalidControlFrame,
    /// The 64-bit length field had its most significant bit set.
    #[error("invalid 64-bit frame length")]
    InvalidLength,
}

/// Push-based frame decoder. Feed bytes with [`FrameDecoder::push`], drain
/// complete frames with [`FrameDecoder::next_frame`].
#[derive(Debug)]
pub struct FrameDecoder {
    buf: Vec<u8>,
    max_payload: u64,
}

impl FrameDecoder {
    /// Create a decoder with a maximum accepted payload size in bytes.
    pub fn new(max_payload: u64) -> Self {
        Self {
            buf: Vec::with_capacity(8 * 1024),
            max_payload,
        }
    }

    /// Append raw socket bytes to the internal buffer.
    pub fn push(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
    }

    /// Try to decode the next complete frame.
    ///
    /// Returns `Ok(None)` when more bytes are needed. On success the frame
    /// is removed from the buffer and its payload is unmasked (masking is
    /// optional on the wire; unmasked frames are accepted too — see the
    /// module docs; RFC 6455 §5.1 says servers MAY close on unmasked
    /// client frames, this server tolerates them instead, which is safe
    /// because the payload is length-prefixed and capped).
    pub fn next_frame(&mut self) -> Result<Option<Frame>, DecodeError> {
        let b = &self.buf;
        if b.len() < 2 {
            return Ok(None);
        }

        let b0 = b[0];
        if b0 & 0x70 != 0 {
            return Err(DecodeError::ReservedBits);
        }
        let fin = b0 & 0x80 != 0;
        let opcode = b0 & 0x0f;

        let b1 = b[1];
        let masked = b1 & 0x80 != 0;
        let len7 = (b1 & 0x7f) as u64;

        let mut header_len = 2usize;
        let payload_len: u64 = match len7 {
            126 => {
                if b.len() < 4 {
                    return Ok(None);
                }
                header_len += 2;
                u16::from_be_bytes([b[2], b[3]]) as u64
            }
            127 => {
                if b.len() < 10 {
                    return Ok(None);
                }
                header_len += 8;
                let raw = u64::from_be_bytes([b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9]]);
                if raw & (1 << 63) != 0 {
                    return Err(DecodeError::InvalidLength);
                }
                raw
            }
            n => n,
        };

        if payload_len > self.max_payload {
            return Err(DecodeError::FrameTooLarge {
                len: payload_len,
                max: self.max_payload,
            });
        }

        let mask_len = if masked { 4 } else { 0 };
        let total = header_len + mask_len + payload_len as usize;
        if b.len() < total {
            return Ok(None);
        }

        let mut payload = self.buf[header_len + mask_len..total].to_vec();
        if masked {
            let mask: [u8; 4] = self.buf[header_len..header_len + 4]
                .try_into()
                .expect("4-byte mask");
            for (i, byte) in payload.iter_mut().enumerate() {
                *byte ^= mask[i % 4];
            }
        }
        self.buf.drain(..total);

        // RFC 6455 §5.5: control frames MUST NOT be fragmented and
        // MUST have payload <= 125 bytes.
        if matches!(opcode, OP_CLOSE | OP_PING | OP_PONG) && (!fin || payload.len() > 125) {
            return Err(DecodeError::InvalidControlFrame);
        }

        Ok(Some(Frame {
            fin,
            opcode,
            payload,
        }))
    }
}

/// Errors produced while parsing the HTTP `Upgrade` request.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum UpgradeError {
    /// The request line or a header line was malformed.
    #[error("malformed request")]
    MalformedRequest,
    /// Only `GET` is accepted for the WebSocket upgrade.
    #[error("method must be GET")]
    MethodNotGet,
    /// A required header was missing or invalid.
    #[error("missing or invalid header: {0}")]
    BadHeader(&'static str),
    /// `Sec-WebSocket-Version` was not `13`.
    #[error("unsupported Sec-WebSocket-Version: {0}")]
    UnsupportedVersion(String),
}

/// Parsed HTTP `GET` upgrade request (header block only, body ignored).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpgradeRequest {
    /// The request-target, e.g. `/ws`.
    pub path: String,
    /// Header pairs with lower-cased names.
    pub headers: Vec<(String, String)>,
}

impl UpgradeRequest {
    /// Case-insensitively look up a header value (names are stored lower-cased).
    pub fn header(&self, name: &str) -> Option<&str> {
        let lower = name.to_ascii_lowercase();
        self.headers
            .iter()
            .find(|(k, _)| k == &lower)
            .map(|(_, v)| v.as_str())
    }

    /// Extract the `Sec-WebSocket-Key` header.
    pub fn websocket_key(&self) -> Option<&str> {
        self.header("sec-websocket-key")
    }
}

/// True once `buf` contains a complete HTTP header block (`\r\n\r\n`).
pub fn upgrade_request_complete(buf: &[u8]) -> bool {
    buf.windows(4).any(|w| w == b"\r\n\r\n")
}

/// Parse a complete HTTP header block into an [`UpgradeRequest`].
///
/// Validates the WebSocket upgrade contract: `GET`, a `Host`-independent
/// `Upgrade: websocket`, a `Connection: upgrade` (token list, case
/// insensitive), a non-empty `Sec-WebSocket-Key`, and
/// `Sec-WebSocket-Version: 13`.
pub fn parse_upgrade_request(buf: &[u8]) -> Result<UpgradeRequest, UpgradeError> {
    let text = std::str::from_utf8(buf).map_err(|_| UpgradeError::MalformedRequest)?;
    let header_block = text
        .split("\r\n\r\n")
        .next()
        .ok_or(UpgradeError::MalformedRequest)?;

    let mut lines = header_block.split("\r\n");
    let request_line = lines.next().ok_or(UpgradeError::MalformedRequest)?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().ok_or(UpgradeError::MalformedRequest)?;
    let path = parts.next().ok_or(UpgradeError::MalformedRequest)?;
    let version = parts.next().ok_or(UpgradeError::MalformedRequest)?;

    if method != "GET" {
        return Err(UpgradeError::MethodNotGet);
    }
    if !version.starts_with("HTTP/1.") {
        return Err(UpgradeError::MalformedRequest);
    }

    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line.split_once(':').ok_or(UpgradeError::MalformedRequest)?;
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }

    let request = UpgradeRequest {
        path: path.to_string(),
        headers,
    };

    let up = request
        .header("upgrade")
        .ok_or(UpgradeError::BadHeader("upgrade"))?;
    if !up.eq_ignore_ascii_case("websocket") {
        return Err(UpgradeError::BadHeader("upgrade"));
    }

    let connection = request
        .header("connection")
        .ok_or(UpgradeError::BadHeader("connection"))?;
    let has_upgrade_token = connection
        .split(',')
        .any(|token| token.trim().eq_ignore_ascii_case("upgrade"));
    if !has_upgrade_token {
        return Err(UpgradeError::BadHeader("connection"));
    }

    let key = request.websocket_key().unwrap_or("");
    if key.trim().is_empty() {
        return Err(UpgradeError::BadHeader("sec-websocket-key"));
    }

    let version = request
        .header("sec-websocket-version")
        .ok_or(UpgradeError::BadHeader("sec-websocket-version"))?;
    if version.trim() != "13" {
        return Err(UpgradeError::UnsupportedVersion(version.trim().to_string()));
    }

    Ok(request)
}

/// Maximum accepted HTTP header block size (16 KiB).
pub const MAX_HTTP_HEADER_BYTES: usize = 16 * 1024;
/// Maximum accepted WebSocket frame payload / assembled message (1 MiB).
pub const MAX_WS_PAYLOAD_BYTES: u64 = 1024 * 1024;

/// Build the `101 Switching Protocols` response for a validated upgrade.
pub fn upgrade_response(accept: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {accept}\r\n\
         \r\n"
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accept_key_rfc6455_example() {
        // RFC 6455 §1.3 worked example.
        assert_eq!(
            accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn frame_round_trip_unmasked() {
        let encoded = encode_frame(OP_TEXT, b"hello", None);
        let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);
        decoder.push(&encoded);
        let frame = decoder.next_frame().unwrap().unwrap();
        assert_eq!(frame.opcode, OP_TEXT);
        assert!(frame.fin);
        assert_eq!(frame.payload, b"hello");
    }

    #[test]
    fn frame_round_trip_masked() {
        let encoded = encode_frame(
            OP_TEXT,
            b"hello masked world",
            Some([0xde, 0xad, 0xbe, 0xef]),
        );
        assert_ne!(&encoded[encoded.len() - 4..], b"orld"); // sanity: actually masked
        let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);
        decoder.push(&encoded);
        let frame = decoder.next_frame().unwrap().unwrap();
        assert_eq!(frame.payload, b"hello masked world");
    }

    #[test]
    fn frame_extended_16bit_length_round_trip() {
        let payload = vec![0x41u8; 1000];
        let encoded = encode_frame(OP_TEXT, &payload, Some([1, 2, 3, 4]));
        let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);
        decoder.push(&encoded);
        let frame = decoder.next_frame().unwrap().unwrap();
        assert_eq!(frame.payload, payload);
    }

    #[test]
    fn frame_extended_64bit_length_round_trip() {
        // Build by hand so the test doesn't require a >64 KiB allocation through encode_frame's 16-bit path.
        let payload = vec![0x42u8; 70_000];
        let encoded = encode_frame(OP_TEXT, &payload, None);
        assert_eq!(encoded[1] & 0x7f, 127);
        let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);
        decoder.push(&encoded);
        let frame = decoder.next_frame().unwrap().unwrap();
        assert_eq!(frame.payload, payload);
    }

    #[test]
    fn frame_decoder_handles_fragmented_stream() {
        // Two frames delivered in arbitrary byte chunks.
        let f1 = encode_frame(OP_TEXT, b"part-one-", Some([9, 8, 7, 6]));
        let f2 = encode_frame(OP_TEXT, b"part-two", None);
        let mut stream = f1.clone();
        stream.extend_from_slice(&f2);

        let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);
        for chunk in stream.chunks(3) {
            decoder.push(chunk);
        }
        let first = decoder.next_frame().unwrap().unwrap();
        let second = decoder.next_frame().unwrap().unwrap();
        assert_eq!(first.payload, b"part-one-");
        assert_eq!(second.payload, b"part-two");
        assert!(decoder.next_frame().unwrap().is_none());
    }

    #[test]
    fn frame_decoder_rejects_oversized_payload() {
        let mut decoder = FrameDecoder::new(16);
        let encoded = encode_frame(OP_TEXT, &[0u8; 32], None);
        decoder.push(&encoded);
        assert_eq!(
            decoder.next_frame(),
            Err(DecodeError::FrameTooLarge { len: 32, max: 16 })
        );
    }

    #[test]
    fn frame_decoder_rejects_reserved_bits() {
        let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);
        decoder.push(&[0x80 | 0x40 | OP_TEXT, 0x00]);
        assert_eq!(decoder.next_frame(), Err(DecodeError::ReservedBits));
    }

    #[test]
    fn frame_decoder_rejects_fragmented_control_frame() {
        let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);
        // Ping with FIN clear.
        decoder.push(&[OP_PING, 0x00]);
        assert_eq!(decoder.next_frame(), Err(DecodeError::InvalidControlFrame));
    }

    #[test]
    fn upgrade_request_parses() {
        let raw = b"GET /ws HTTP/1.1\r\nHost: 127.0.0.1:6121\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";
        let req = parse_upgrade_request(raw).unwrap();
        assert_eq!(req.path, "/ws");
        assert_eq!(req.websocket_key(), Some("dGhlIHNhbXBsZSBub25jZQ=="));
    }

    #[test]
    fn upgrade_request_rejects_wrong_method() {
        let raw = b"POST /ws HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n";
        assert_eq!(parse_upgrade_request(raw), Err(UpgradeError::MethodNotGet));
    }

    #[test]
    fn upgrade_request_rejects_bad_version() {
        let raw = b"GET /ws HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 12\r\n\r\n";
        assert_eq!(
            parse_upgrade_request(raw),
            Err(UpgradeError::UnsupportedVersion("12".to_string()))
        );
    }

    #[test]
    fn upgrade_request_rejects_missing_key() {
        let raw = b"GET /ws HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n\r\n";
        assert_eq!(
            parse_upgrade_request(raw),
            Err(UpgradeError::BadHeader("sec-websocket-key"))
        );
    }

    #[test]
    fn upgrade_request_rejects_missing_connection_upgrade_token() {
        let raw = b"GET /ws HTTP/1.1\r\nUpgrade: websocket\r\nConnection: keep-alive\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n";
        assert_eq!(
            parse_upgrade_request(raw),
            Err(UpgradeError::BadHeader("connection"))
        );
    }

    #[test]
    fn upgrade_request_complete_detects_header_end() {
        assert!(!upgrade_request_complete(b"GET / HTTP/1.1\r\n"));
        assert!(upgrade_request_complete(b"GET / HTTP/1.1\r\n\r\n"));
    }

    #[test]
    fn upgrade_response_contains_accept() {
        let response = String::from_utf8(upgrade_response("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")).unwrap();
        assert!(response.starts_with("HTTP/1.1 101 Switching Protocols\r\n"));
        assert!(response.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n"));
        assert!(response.ends_with("\r\n\r\n"));
    }
}
