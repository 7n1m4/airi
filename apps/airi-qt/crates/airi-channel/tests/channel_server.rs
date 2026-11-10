// SPDX-License-Identifier: GPL-3.0-or-later

//! Integration test for the channel server. Spins the real server on an
//! ephemeral port (or `CHANNEL_TEST_PORT` if set) and drives it with a
//! hand-rolled client over raw TCP.
//!
//! Covers: HTTP upgrade handshake (known accept-key vector), the
//! mandatory auth flow for both accepted auth shapes, ping/pong, the `rpc`
//! echo placeholder, typed error frames, and rejection of a bad token
//! (error frame + close 1008) before any state is reached.
//!
//! Not marked `#[ignore]` — it is fully deterministic (ephemeral port,
//! 5 s read timeouts, no shared state). Set `CHANNEL_TEST_PORT` only if you
//! want a fixed port; binding failure then fails loudly rather than hangs.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use airi_channel::ws::MAX_WS_PAYLOAD_BYTES;
use airi_channel::{
    accept_key, encode_frame, ChannelConfig, ChannelServer, Frame, FrameDecoder, OP_CLOSE, OP_PING,
    OP_TEXT,
};

const CLIENT_KEY: &str = "dGhlIHNhbXBsZSBub25jZQ==";
const TOKEN: &str = "integration-test-token";

// A fixed port (CHANNEL_TEST_PORT) cannot be shared by five tests running
// `cargo test`'s parallel harness — every test binds. Serialize them. With
// an ephemeral port (the default, `0`) this is harmless.
static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn test_port() -> u16 {
    std::env::var("CHANNEL_TEST_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn start_server() -> airi_channel::ServerHandle {
    let config = ChannelConfig {
        hostname: "127.0.0.1".to_string(),
        auth_token: TOKEN.to_string(),
    };
    let server =
        ChannelServer::bind("127.0.0.1", test_port(), &config).expect("bind channel server");
    server.spawn().expect("spawn channel server")
}

fn tcp_connect(port: u16) -> TcpStream {
    let stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("read timeout");
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .expect("write timeout");
    stream
}

/// Send the HTTP upgrade request; return the response header block.
fn http_upgrade(stream: &mut TcpStream, port: u16) -> String {
    let request = format!(
        "GET /ws HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {CLIENT_KEY}\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
    stream.write_all(request.as_bytes()).expect("send upgrade");

    let mut response = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let n = stream.read(&mut chunk).expect("read upgrade response");
        assert!(n > 0, "server closed connection during upgrade");
        response.extend_from_slice(&chunk[..n]);
        if response.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8(response).expect("utf8 response")
}

/// Send a masked text frame (client → server frames must be masked).
fn send_masked_text(stream: &mut TcpStream, text: &str) {
    stream
        .write_all(&encode_frame(
            OP_TEXT,
            text.as_bytes(),
            Some([0x11, 0x22, 0x33, 0x44]),
        ))
        .expect("send text frame");
}

/// Read exactly one frame from the server (unmasked).
fn read_frame(stream: &mut TcpStream, decoder: &mut FrameDecoder) -> Frame {
    let mut chunk = [0u8; 4096];
    loop {
        if let Some(frame) = decoder.next_frame().expect("decode frame") {
            return frame;
        }
        let n = stream.read(&mut chunk).expect("read frame");
        assert!(n > 0, "server closed connection while a frame was expected");
        decoder.push(&chunk[..n]);
    }
}

#[test]
fn upgrade_auth_ping_pong_rpc_and_close() {
    let _guard = TEST_LOCK.lock().unwrap();
    let handle = start_server();
    let port = handle.port();
    let mut stream = tcp_connect(port);
    let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);

    // --- Upgrade -----------------------------------------------------------
    let response = http_upgrade(&mut stream, port);
    assert!(response.starts_with("HTTP/1.1 101 Switching Protocols\r\n"));
    assert_eq!(
        accept_key(CLIENT_KEY),
        "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
        "RFC 6455 accept vector"
    );
    assert!(response.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n"));

    // --- Auth handshake ----------------------------------------------------
    send_masked_text(
        &mut stream,
        r#"{"type":"auth","authToken":"integration-test-token"}"#,
    );
    let frame = read_frame(&mut stream, &mut decoder);
    assert_eq!(frame.opcode, OP_TEXT);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&frame.payload).unwrap(),
        serde_json::json!({"type":"auth","ok":true})
    );

    // --- Ping → pong ---------------------------------------------------------
    send_masked_text(&mut stream, r#"{"type":"ping"}"#);
    let frame = read_frame(&mut stream, &mut decoder);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&frame.payload).unwrap(),
        serde_json::json!({"type":"pong"})
    );

    // --- Heartbeat mirror ----------------------------------------------------
    send_masked_text(
        &mut stream,
        r#"{"type":"transport:connection:heartbeat","data":{"kind":"ping","message":"🩵"}}"#,
    );
    let frame = read_frame(&mut stream, &mut decoder);
    let heartbeat: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
    assert_eq!(heartbeat["type"], "transport:connection:heartbeat");
    assert_eq!(heartbeat["data"]["kind"], "pong");

    // --- RPC echo placeholder ------------------------------------------------
    send_masked_text(
        &mut stream,
        r#"{"type":"rpc","action":"stage.say","payload":{"text":"hi"}}"#,
    );
    let frame = read_frame(&mut stream, &mut decoder);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&frame.payload).unwrap(),
        serde_json::json!({"type":"rpc","action":"stage.say","ok":true,"payload":{"text":"hi"}})
    );

    // --- Unknown type → typed error, connection stays open -------------------
    send_masked_text(&mut stream, r#"{"type":"teleport"}"#);
    let frame = read_frame(&mut stream, &mut decoder);
    let error: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
    assert_eq!(error["type"], "error");
    assert_eq!(error["error"]["code"], "unsupported_type");

    // Connection still usable after the error frame.
    send_masked_text(&mut stream, r#"{"type":"ping"}"#);
    let frame = read_frame(&mut stream, &mut decoder);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&frame.payload).unwrap(),
        serde_json::json!({"type":"pong"})
    );

    // --- Clean close ---------------------------------------------------------
    stream
        .write_all(&encode_frame(
            OP_CLOSE,
            &1000u16.to_be_bytes(),
            Some([1, 2, 3, 4]),
        ))
        .expect("send close");
    let frame = read_frame(&mut stream, &mut decoder);
    assert_eq!(frame.opcode, OP_CLOSE);

    handle.stop();
}

#[test]
fn bad_token_gets_error_then_close() {
    let _guard = TEST_LOCK.lock().unwrap();
    let handle = start_server();
    let port = handle.port();
    let mut stream = tcp_connect(port);
    let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);

    let response = http_upgrade(&mut stream, port);
    assert!(response.starts_with("HTTP/1.1 101"));

    send_masked_text(
        &mut stream,
        r#"{"type":"auth","authToken":"definitely-wrong"}"#,
    );

    // First frame: typed error. Second: close with code 1008.
    let frame = read_frame(&mut stream, &mut decoder);
    let error: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
    assert_eq!(error["type"], "error");
    assert_eq!(error["error"]["code"], "invalid_token");

    let frame = read_frame(&mut stream, &mut decoder);
    assert_eq!(frame.opcode, OP_CLOSE);
    let code = u16::from_be_bytes([frame.payload[0], frame.payload[1]]);
    assert_eq!(code, 1008);

    handle.stop();
}

#[test]
fn non_auth_first_message_gets_error_then_close() {
    let _guard = TEST_LOCK.lock().unwrap();
    let handle = start_server();
    let port = handle.port();
    let mut stream = tcp_connect(port);
    let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);

    let response = http_upgrade(&mut stream, port);
    assert!(response.starts_with("HTTP/1.1 101"));

    // A ping is NOT a valid first message; the server must not leak state.
    send_masked_text(&mut stream, r#"{"type":"ping"}"#);

    let frame = read_frame(&mut stream, &mut decoder);
    let error: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
    assert_eq!(error["error"]["code"], "auth_required");

    let frame = read_frame(&mut stream, &mut decoder);
    assert_eq!(frame.opcode, OP_CLOSE);

    handle.stop();
}

#[test]
fn server_runtime_auth_shape_also_authenticates() {
    let _guard = TEST_LOCK.lock().unwrap();
    let handle = start_server();
    let port = handle.port();
    let mut stream = tcp_connect(port);
    let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);

    let response = http_upgrade(&mut stream, port);
    assert!(response.starts_with("HTTP/1.1 101"));

    send_masked_text(
        &mut stream,
        r#"{"type":"module:authenticate","data":{"token":"integration-test-token","caller":"integration-test"}}"#,
    );
    let frame = read_frame(&mut stream, &mut decoder);
    let auth: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
    assert_eq!(
        auth,
        serde_json::json!({"type":"module:authenticated","data":{"authenticated":true}})
    );

    // And the session is usable, e.g. ping.
    send_masked_text(&mut stream, r#"{"type":"ping"}"#);
    let frame = read_frame(&mut stream, &mut decoder);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&frame.payload).unwrap(),
        serde_json::json!({"type":"pong"})
    );

    handle.stop();
}

#[test]
fn websocket_ping_frame_gets_pong_frame() {
    let _guard = TEST_LOCK.lock().unwrap();
    let handle = start_server();
    let port = handle.port();
    let mut stream = tcp_connect(port);
    let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);

    let _ = http_upgrade(&mut stream, port);

    // RFC 6455 control-frame ping → pong, even before application auth
    // (control frames carry no application state).
    stream
        .write_all(&encode_frame(OP_PING, b"ciao", Some([5, 6, 7, 8])))
        .expect("send ping frame");
    let frame = read_frame(&mut stream, &mut decoder);
    assert_eq!(frame.opcode, 0xA); // pong
    assert_eq!(frame.payload, b"ciao");

    handle.stop();
}
