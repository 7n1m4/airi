// SPDX-License-Identifier: GPL-3.0-or-later

//! Integration tests for the `airi-discord` gateway WebSocket client.
//!
//! All tests run against a local mock gateway: a `TcpListener` on
//! `127.0.0.1:0`, `tungstenite::accept` in a thread, no live network, no
//! real Discord.

use std::io::ErrorKind;
use std::net::TcpListener;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use airi_discord::{DiscordError, GatewayClient, GatewayEvent, DEFAULT_INTENTS};
use serde_json::{json, Value};
use tungstenite::handshake::server::Request;
use tungstenite::protocol::frame::CloseFrame;
use tungstenite::{accept, Message, WebSocket};

const TOKEN: &str = "super-secret-bot-token";

type MockSocket = WebSocket<std::net::TcpStream>;

/// Bind a mock gateway on 127.0.0.1:0, run `script` against the first
/// accepted connection in a thread, and return the `ws://` URL (without
/// query string) the client should dial.
fn spawn_mock<F>(script: F) -> String
where
    F: FnOnce(MockSocket) + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock gateway");
    let addr = listener.local_addr().expect("mock addr");
    thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept mock connection");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("set read timeout");
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .expect("set write timeout");
        let ws = accept(stream).expect("mock websocket handshake");
        script(ws);
    });
    format!("ws://{addr}")
}

/// Like [`spawn_mock`], but the script also receives the request URI the
/// client dialed (captured via `accept_hdr`).
fn spawn_mock_with_uri<F>(script: F) -> (String, mpsc::Receiver<String>)
where
    F: FnOnce(MockSocket) + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock gateway");
    let addr = listener.local_addr().expect("mock addr");
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept mock connection");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("set read timeout");
        let tx = Arc::new(Mutex::new(Some(tx)));
        // The `Callback` trait fixes Response as the Err variant; box it away
        // to satisfy clippy::result_large_err.
        #[allow(clippy::result_large_err)]
        let ws = tungstenite::accept_hdr(stream, move |req: &Request, resp| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let uri = req
                    .uri()
                    .path_and_query()
                    .map(|pq| pq.to_string())
                    .unwrap_or_else(|| req.uri().to_string());
                let _ = tx.send(uri);
            }
            Ok(resp)
        })
        .expect("mock websocket handshake");
        script(ws);
    });
    (format!("ws://{addr}"), rx)
}

fn hello(ws: &mut MockSocket, heartbeat_interval_ms: u64) {
    send_frame(
        ws,
        json!({ "op": 10, "d": { "heartbeat_interval": heartbeat_interval_ms } }),
    );
}

fn send_frame(ws: &mut MockSocket, frame: Value) {
    ws.send(Message::Text(frame.to_string()))
        .expect("server write");
}

fn read_frame(ws: &mut MockSocket) -> Value {
    match ws.read() {
        Ok(Message::Text(text)) => serde_json::from_str(&text).expect("server read valid json"),
        Ok(other) => panic!("server expected text frame, got {other:?}"),
        Err(error) => {
            if let tungstenite::Error::Io(io_err) = &error {
                if matches!(io_err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) {
                    panic!("server timed out waiting for client frame");
                }
            }
            panic!("server read error: {error}");
        }
    }
}

fn assert_identify(frame: &Value) {
    assert_eq!(frame["op"], 2, "expected IDENTIFY (op 2), got {frame}");
    assert_eq!(frame["d"]["token"], TOKEN);
    assert_eq!(frame["d"]["intents"], DEFAULT_INTENTS);
    assert_eq!(frame["d"]["properties"]["os"], "linux");
    assert_eq!(frame["d"]["properties"]["browser"], "airi-qt");
    assert_eq!(frame["d"]["properties"]["device"], "airi-qt");
}

#[test]
fn hello_identify_ready_message_create_then_heartbeat_observed() {
    let heartbeats: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let beats = Arc::clone(&heartbeats);

    let url = spawn_mock(move |mut ws| {
        hello(&mut ws, 100);
        let identify = read_frame(&mut ws);
        assert_identify(&identify);

        send_frame(
            &mut ws,
            json!({
                "op": 0,
                "t": "READY",
                "s": 1,
                "d": {
                    "session_id": "sess-1",
                    "resume_gateway_url": "wss://resume.example.invalid",
                    "user": { "id": "42", "username": "airi-bot" }
                }
            }),
        );
        send_frame(
            &mut ws,
            json!({
                "op": 0,
                "t": "MESSAGE_CREATE",
                "s": 2,
                "d": {
                    "id": "msg-1",
                    "channel_id": "chan-1",
                    "guild_id": "guild-1",
                    "author": { "id": "7", "username": "kristal", "bot": false },
                    "content": "hello airi",
                    "timestamp": "2026-11-11T00:00:00.000Z"
                }
            }),
        );

        // Observe the client's heartbeat, then release the blocked reader
        // with a fresh dispatch.
        loop {
            match ws.read() {
                Ok(Message::Text(text)) => {
                    let frame: Value = serde_json::from_str(&text).expect("valid json");
                    if frame["op"] == 1 {
                        beats.lock().unwrap().push(frame["d"].clone());
                        send_frame(
                            &mut ws,
                            json!({
                                "op": 0,
                                "t": "MESSAGE_CREATE",
                                "s": 3,
                                "d": {
                                    "id": "msg-2",
                                    "channel_id": "chan-1",
                                    "author": { "id": "7", "username": "kristal" },
                                    "content": "beat-ack",
                                    "timestamp": "2026-11-11T00:00:01.000Z"
                                }
                            }),
                        );
                        break;
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });

    let mut client = GatewayClient::connect(&url, TOKEN, DEFAULT_INTENTS).expect("connect");

    match client.next_event().expect("ready event") {
        GatewayEvent::Ready {
            session_id,
            resume_gateway_url,
            user,
        } => {
            assert_eq!(session_id, "sess-1");
            assert_eq!(resume_gateway_url, "wss://resume.example.invalid");
            assert_eq!(user.id, "42");
            assert_eq!(user.username, "airi-bot");
        }
        other => panic!("expected Ready, got {other:?}"),
    }
    assert_eq!(client.session_id(), Some("sess-1"));
    assert_eq!(client.seq(), Some(1));

    match client.next_event().expect("message create event") {
        GatewayEvent::MessageCreate {
            id,
            channel_id,
            guild_id,
            author,
            content,
            timestamp,
        } => {
            assert_eq!(id, "msg-1");
            assert_eq!(channel_id, "chan-1");
            assert_eq!(guild_id.as_deref(), Some("guild-1"));
            assert_eq!(author.id, "7");
            assert_eq!(author.username, "kristal");
            assert!(!author.bot);
            assert_eq!(content, "hello airi");
            assert_eq!(timestamp, "2026-11-11T00:00:00.000Z");
        }
        other => panic!("expected MessageCreate, got {other:?}"),
    }
    assert_eq!(client.seq(), Some(2));

    // Drive the client from a thread; the mock observes the op 1 heartbeat
    // and replies with a dispatch that releases the client's read loop.
    let worker = thread::spawn(move || client.next_event());

    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if !heartbeats.lock().unwrap().is_empty() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "mock server saw no heartbeat within 2 s"
        );
        thread::sleep(Duration::from_millis(10));
    }

    match worker
        .join()
        .expect("worker panicked")
        .expect("worker event")
    {
        GatewayEvent::MessageCreate { content, id, .. } => {
            assert_eq!(id, "msg-2");
            assert_eq!(content, "beat-ack");
        }
        other => panic!("expected MessageCreate(beat-ack), got {other:?}"),
    }

    // The heartbeat must carry the last dispatch sequence number.
    assert_eq!(heartbeats.lock().unwrap()[0], json!(2));
}

#[test]
fn invalid_session_maps_to_typed_error() {
    let url = spawn_mock(|mut ws| {
        hello(&mut ws, 60_000);
        let identify = read_frame(&mut ws);
        assert_identify(&identify);
        send_frame(&mut ws, json!({ "op": 9, "d": false }));
    });

    let mut client = GatewayClient::connect(&url, TOKEN, DEFAULT_INTENTS).expect("connect");
    match client.next_event() {
        Err(DiscordError::InvalidSession { resumable }) => assert!(!resumable),
        other => panic!("expected InvalidSession {{ resumable: false }}, got {other:?}"),
    }
}

#[test]
fn invalid_session_resumable_true_is_preserved() {
    let url = spawn_mock(|mut ws| {
        hello(&mut ws, 60_000);
        let identify = read_frame(&mut ws);
        assert_identify(&identify);
        send_frame(&mut ws, json!({ "op": 9, "d": true }));
    });

    let mut client = GatewayClient::connect(&url, TOKEN, DEFAULT_INTENTS).expect("connect");
    match client.next_event() {
        Err(DiscordError::InvalidSession { resumable }) => assert!(resumable),
        other => panic!("expected InvalidSession {{ resumable: true }}, got {other:?}"),
    }
}

#[test]
fn resume_after_reconnect_sends_op6_and_yields_resumed() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock gateway");
    let addr = listener.local_addr().expect("mock addr");
    let server = thread::spawn(move || {
        // Phase 1: full handshake to READY + one dispatch, then drop.
        let (stream, _) = listener.accept().expect("accept phase 1");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut ws1 = accept(stream).expect("phase 1 handshake");
        hello(&mut ws1, 60_000);
        let identify = read_frame(&mut ws1);
        assert_identify(&identify);
        send_frame(
            &mut ws1,
            json!({
                "op": 0,
                "t": "READY",
                "s": 1,
                "d": {
                    "session_id": "sess-resume",
                    "resume_gateway_url": "wss://resume.example.invalid",
                    "user": { "id": "42", "username": "airi-bot" }
                }
            }),
        );
        send_frame(
            &mut ws1,
            json!({
                "op": 0,
                "t": "MESSAGE_CREATE",
                "s": 2,
                "d": {
                    "id": "msg-1",
                    "channel_id": "chan-1",
                    "author": { "id": "7", "username": "kristal" },
                    "content": "before the drop",
                    "timestamp": "2026-11-11T00:00:00.000Z"
                }
            }),
        );
        drop(ws1); // simulate the network going away

        // Phase 2: reconnect. Expect HELLO, then op 6 RESUME.
        let (stream, _) = listener.accept().expect("accept phase 2");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut ws2 = accept(stream).expect("phase 2 handshake");
        hello(&mut ws2, 60_000);
        let resume = read_frame(&mut ws2);
        assert_eq!(resume["op"], 6, "expected RESUME (op 6), got {resume}");
        assert_eq!(resume["d"]["token"], TOKEN);
        assert_eq!(resume["d"]["session_id"], "sess-resume");
        assert_eq!(resume["d"]["seq"], 2);
        send_frame(
            &mut ws2,
            json!({ "op": 0, "t": "RESUMED", "s": 3, "d": {} }),
        );
    });
    let url = format!("ws://{addr}");

    let mut client = GatewayClient::connect(&url, TOKEN, DEFAULT_INTENTS).expect("connect");
    assert!(matches!(
        client.next_event().expect("ready"),
        GatewayEvent::Ready { .. }
    ));
    assert!(matches!(
        client.next_event().expect("message create"),
        GatewayEvent::MessageCreate { .. }
    ));
    assert_eq!(client.seq(), Some(2));

    client.reconnect().expect("reconnect");
    // Session state survives the reconnect.
    assert_eq!(client.session_id(), Some("sess-resume"));
    assert_eq!(client.seq(), Some(2));

    client.resume().expect("resume");
    assert!(matches!(
        client.next_event().expect("resumed event"),
        GatewayEvent::Resumed
    ));

    server.join().expect("mock server panicked");
}

#[test]
fn heartbeat_ack_yields_event_not_panic() {
    let url = spawn_mock(|mut ws| {
        hello(&mut ws, 60_000);
        let identify = read_frame(&mut ws);
        assert_identify(&identify);
        send_frame(&mut ws, json!({ "op": 11, "d": null }));
    });

    let mut client = GatewayClient::connect(&url, TOKEN, DEFAULT_INTENTS).expect("connect");
    assert!(matches!(
        client.next_event().expect("heartbeat ack"),
        GatewayEvent::HeartbeatAck
    ));
}

#[test]
fn close_4004_maps_to_unauthorized() {
    let url = spawn_mock(|mut ws| {
        hello(&mut ws, 60_000);
        let identify = read_frame(&mut ws);
        assert_identify(&identify);
        ws.send(Message::Close(Some(CloseFrame {
            code: tungstenite::protocol::frame::coding::CloseCode::Library(4004),
            reason: "authentication failed".into(),
        })))
        .expect("send close frame");
    });

    let mut client = GatewayClient::connect(&url, TOKEN, DEFAULT_INTENTS).expect("connect");
    assert!(matches!(
        client.next_event(),
        Err(DiscordError::Unauthorized)
    ));
}

#[test]
fn close_other_code_yields_closed_event() {
    let url = spawn_mock(|mut ws| {
        hello(&mut ws, 60_000);
        let identify = read_frame(&mut ws);
        assert_identify(&identify);
        ws.send(Message::Close(Some(CloseFrame {
            code: tungstenite::protocol::frame::coding::CloseCode::Library(1000),
            reason: "normal closure".into(),
        })))
        .expect("send close frame");
    });

    let mut client = GatewayClient::connect(&url, TOKEN, DEFAULT_INTENTS).expect("connect");
    assert!(matches!(
        client.next_event(),
        Ok(GatewayEvent::Closed { code: Some(1000) })
    ));
}

#[test]
fn url_without_query_gets_v10_encoding_appended() {
    let (base, rx) = spawn_mock_with_uri(|mut ws| {
        hello(&mut ws, 60_000);
        let _ = read_frame(&mut ws);
    });
    let _client = GatewayClient::connect(&base, TOKEN, DEFAULT_INTENTS).expect("connect");
    let uri = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("uri captured");
    assert_eq!(uri, "/?v=10&encoding=json");
}

#[test]
fn url_with_query_is_not_double_appended() {
    let (base, rx) = spawn_mock_with_uri(|mut ws| {
        hello(&mut ws, 60_000);
        let _ = read_frame(&mut ws);
    });
    let url = format!("{base}?v=10&encoding=json");
    let _client = GatewayClient::connect(&url, TOKEN, DEFAULT_INTENTS).expect("connect");
    let uri = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("uri captured");
    assert_eq!(uri, "/?v=10&encoding=json");
}
