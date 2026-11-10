// SPDX-License-Identifier: GPL-3.0-or-later

//! WebSocket client for the AIRI stage protocol.
//!
//! Handshake: `module:authenticate` → wait `module:authenticated` →
//! `module:announce` → expect server push `stage:state:sync`. Reconnects with
//! capped backoff unless the server rejects auth (`authenticated: false`).
//!
//! The socket has a single read/write loop (`run_once`); outbound messages
//! pushed while connected are written from a `tokio::sync::mpsc` channel the
//! caller owns (see [`run`]).

use super::WireMessage;
use futures_util::{SinkExt, StreamExt};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Backoff cap for reconnects.
const MAX_BACKOFF: Duration = Duration::from_secs(5);

/// One outbound half of the socket (spawned as its own task).
pub type OutChannel = tokio::sync::mpsc::UnboundedSender<WireMessage>;

/// Drive the handshake + read loop until the socket closes or auth fails.
/// `on_message` is called for every post-handshake inbound message.
/// Outbound messages can be pushed through the returned channel (if provided
/// by a previous call to [`run_with_outbound`]); callers that only need the
/// inbound side call [`run`].
pub async fn run(
    url: String,
    token: String,
    mut on_message: impl FnMut(WireMessage) + Send,
) {
    run_inner(url, token, &mut on_message).await;
}

/// Run the loop with an outbound channel; the mutex-protected queue is shared
/// with the socket write half inside `run_once`.
pub async fn run_with_outbound(
    url: String,
    token: String,
    mut on_message: impl FnMut(WireMessage) + Send + 'static,
) -> OutChannel {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<WireMessage>();
    let queue = Arc::new(Mutex::new(Vec::new()));
    let queue_rx = queue.clone();
    tokio::spawn(async move {
        let mut rx = rx;
        while let Some(msg) = rx.recv().await {
            queue_rx.lock().unwrap().push(msg);
        }
    });
    let queue2 = queue.clone();
    tokio::spawn(async move {
        run_inner_with_queue(url, token, &mut on_message, queue2).await;
    });
    tx
}

/// Core reconnect loop.
async fn run_inner(
    url: String,
    token: String,
    on_message: &mut impl FnMut(WireMessage),
) {
    let queue = Arc::new(Mutex::new(Vec::new()));
    run_inner_with_queue(url, token, on_message, queue).await;
}

/// Reconnect loop with an outbound queue drained after handshake.
async fn run_inner_with_queue(
    url: String,
    token: String,
    on_message: &mut impl FnMut(WireMessage),
    queue: Arc<Mutex<Vec<WireMessage>>>,
) {
    let mut backoff = Duration::from_millis(200);
    loop {
        match run_once(&url, &token, on_message, &queue).await {
            Ok(()) => {
                eprintln!("[stage-qt] closed cleanly");
                return;
            }
            Err(StepError::AuthRejected) => {
                eprintln!("[stage-qt] authentication rejected; giving up");
                return;
            }
            Err(e) => {
                eprintln!("[stage-qt] socket error: {e:?}; retry in {backoff:?}");
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(MAX_BACKOFF);
            }
        }
    }
}

/// One connection attempt incl. handshake + queued outbound flush.
async fn run_once(
    url: &str,
    token: &str,
    on_message: &mut impl FnMut(WireMessage),
    queue: &Arc<Mutex<Vec<WireMessage>>>,
) -> Result<(), StepError> {
    let (mut ws, _) = connect_async(url).await.map_err(StepError::Connect)?;
    let auth = WireMessage::new(
        "module:authenticate",
        serde_json::json!({ "token": token, "caller": "stage-qt" }),
    );
    ws.send(Message::Text(serde_json::to_string(&auth).unwrap()))
        .await
        .map_err(|e| StepError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

    let mut authenticated = false;
    let mut announced = false;
    while let Some(msg) = ws.next().await {
        // Flush queued outbound messages before handling the next inbound.
        if authenticated && announced {
            let pending: Vec<WireMessage> = queue.lock().unwrap().drain(..).collect();
            for out in pending {
                ws.send(Message::Text(serde_json::to_string(&out).unwrap()))
                    .await
                    .map_err(|e| StepError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;
            }
        }
        let text = match msg.map_err(|e| StepError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))? {
            Message::Text(t) => t,
            Message::Close(_) => return Err(StepError::Io(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "server closed connection",
            ))),
            _ => continue,
        };
        let wire: WireMessage = match serde_json::from_str(&text) {
            Ok(w) => w,
            Err(_) => continue,
        };
        match wire.r#type.as_str() {
            "module:authenticated" => {
                let ok = wire
                    .effective_data()
                    .and_then(|d| d.get("authenticated"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if !ok {
                    return Err(StepError::AuthRejected);
                }
                authenticated = true;
                let announce = WireMessage::new(
                    "module:announce",
                    serde_json::json!({ "name": "stage-qt" }),
                );
                ws.send(Message::Text(serde_json::to_string(&announce).unwrap()))
                    .await
                    .map_err(|e| StepError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;
            }
            "module:announced" => {
                announced = true;
            }
            "stage:state:sync" if authenticated && announced => {
                on_message(wire);
            }
            _ if authenticated && announced => {
                on_message(wire);
            }
            _ => {}
        }
    }
    Err(StepError::Io(std::io::Error::new(
        std::io::ErrorKind::UnexpectedEof,
        "stream ended",
    )))
}

/// Socket-step failure classification.
#[derive(Debug)]
pub enum StepError {
    /// TCP/TLS connect failure.
    Connect(tokio_tungstenite::tungstenite::Error),
    /// IO while streaming.
    Io(std::io::Error),
    /// Server sent `authenticated: false`.
    AuthRejected,
}

impl From<tokio_tungstenite::tungstenite::Error> for StepError {
    fn from(e: tokio_tungstenite::tungstenite::Error) -> Self {
        match e {
            tokio_tungstenite::tungstenite::Error::Io(io) => StepError::Io(io),
            other => StepError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("{other:?}"),
            )),
        }
    }
}
