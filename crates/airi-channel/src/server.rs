// SPDX-License-Identifier: GPL-3.0-or-later

//! The TCP WebSocket channel server.
//!
//! One thread per accepted connection; the accept loop is non-blocking and
//! polls a stop flag every ~10 ms so [`ServerHandle::stop`] can shut it down
//! cleanly. Reads after the handshake have **no timeout** — idle clients
//! (e.g. the desktop app and a paired phone) are expected. The auth
//! handshake itself has a 10-second deadline; sockets that do not complete
//! the upgrade and auth within it are dropped.
//!
//! When constructed with a rustls [`rustls::ServerConfig`] the listener
//! speaks `wss://`; otherwise it speaks plaintext. The cert chain is loaded
//! by the caller (see [`crate::certs::server_config`]); this module performs
//! no certificate management of its own.

use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use crate::config::ChannelConfig;
use crate::dispatch::{RendererHandlers, RpcContext};
use crate::session::{
    Session, CLOSE_MESSAGE_TOO_BIG, CLOSE_PROTOCOL_ERROR, CLOSE_UNSUPPORTED_DATA,
};
use crate::ws::{
    accept_key, encode_frame, parse_upgrade_request, upgrade_request_complete, upgrade_response,
    DecodeError, Frame, FrameDecoder, UpgradeError, MAX_HTTP_HEADER_BYTES, MAX_WS_PAYLOAD_BYTES,
    OP_BINARY, OP_CLOSE, OP_CONTINUATION, OP_PING, OP_PONG, OP_TEXT,
};

/// How long a client may take to send the HTTP upgrade headers.
const HANDSHAKE_READ_TIMEOUT: Duration = Duration::from_secs(10);

/// One accepted connection, either plaintext or TLS-wrapped.
///
/// The enum exists so the connection handler can be written once; the
/// underlying `Read`/`Write` impls delegate to the concrete stream. The
/// 10-second handshake deadline is configured on the `TcpStream` *before* it
/// is wrapped, and cleared after the HTTP upgrade completes.
enum ConnectionStream {
    Plain(TcpStream),
    Tls(rustls::StreamOwned<rustls::ServerConnection, TcpStream>),
}

impl ConnectionStream {
    /// Clear the handshake read timeout (post-upgrade reads are unbounded).
    fn clear_read_timeout(&mut self) -> io::Result<()> {
        match self {
            Self::Plain(stream) => stream.set_read_timeout(None),
            Self::Tls(stream) => stream.sock.set_read_timeout(None),
        }
    }
}

impl Read for ConnectionStream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Self::Plain(stream) => stream.read(buf),
            Self::Tls(stream) => stream.read(buf),
        }
    }
}

impl Write for ConnectionStream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Self::Plain(stream) => stream.write(buf),
            Self::Tls(stream) => stream.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            Self::Plain(stream) => stream.flush(),
            Self::Tls(stream) => stream.flush(),
        }
    }
}

/// The bound, not-yet-running channel server.
pub struct ChannelServer {
    listener: TcpListener,
    token: Arc<str>,
    rpc: RpcContext,
    renderer_handlers: Arc<RendererHandlers>,
    tls: Option<Arc<rustls::ServerConfig>>,
}

impl ChannelServer {
    /// Bind `hostname:port`. Port `0` asks the OS for an ephemeral port.
    ///
    /// Binding is loopback-only by convention: the config defaults to
    /// `127.0.0.1` and `0.0.0.0` should be a deliberate choice (LAN access).
    /// No renderer handlers are registered; `renderer.*` replies with
    /// `rpc_not_implemented`. Use [`ChannelServer::bind_with_renderer`] to
    /// register some.
    pub fn bind(hostname: &str, port: u16, config: &ChannelConfig) -> io::Result<Self> {
        Self::bind_with_renderer(hostname, port, config, RendererHandlers::new())
    }

    /// Bind `hostname:port` with a renderer handler registry for
    /// `renderer.<method>` RPC dispatch. The map is wrapped in an `Arc` and
    /// shared with every accepted connection; handlers run on the
    /// connection's reader thread and receive/return plain JSON (never the
    /// token or the config).
    pub fn bind_with_renderer(
        hostname: &str,
        port: u16,
        config: &ChannelConfig,
        handlers: RendererHandlers,
    ) -> io::Result<Self> {
        Self::bind_common(hostname, port, config, handlers, None)
    }

    /// Like [`ChannelServer::bind_with_renderer`] but serves `wss://` using
    /// the given rustls configuration (see [`crate::certs::server_config`]).
    pub fn bind_with_renderer_tls(
        hostname: &str,
        port: u16,
        config: &ChannelConfig,
        handlers: RendererHandlers,
        tls: Arc<rustls::ServerConfig>,
    ) -> io::Result<Self> {
        Self::bind_common(hostname, port, config, handlers, Some(tls))
    }

    /// Like [`ChannelServer::bind`] but serves `wss://`.
    pub fn bind_tls(
        hostname: &str,
        port: u16,
        config: &ChannelConfig,
        tls: Arc<rustls::ServerConfig>,
    ) -> io::Result<Self> {
        Self::bind_with_renderer_tls(hostname, port, config, RendererHandlers::new(), tls)
    }

    fn bind_common(
        hostname: &str,
        port: u16,
        config: &ChannelConfig,
        handlers: RendererHandlers,
        tls: Option<Arc<rustls::ServerConfig>>,
    ) -> io::Result<Self> {
        let listener = TcpListener::bind((hostname, port))?;
        let bound_port = listener.local_addr()?.port();
        Ok(Self {
            listener,
            token: Arc::from(config.auth_token.as_str()),
            rpc: RpcContext::new(hostname.to_string(), bound_port),
            renderer_handlers: Arc::new(handlers),
            tls,
        })
    }

    /// The local address the socket is bound to (useful with port `0`).
    pub fn local_addr(&self) -> io::Result<std::net::SocketAddr> {
        self.listener.local_addr()
    }

    /// The bound port.
    pub fn local_port(&self) -> io::Result<u16> {
        Ok(self.listener.local_addr()?.port())
    }

    /// Serve forever (blocking). Used by the desktop app once it decides to
    /// start the channel server.
    pub fn run(self) -> io::Result<()> {
        let stop = Arc::new(AtomicBool::new(false));
        serve(
            self.listener,
            self.token,
            self.rpc,
            self.renderer_handlers,
            self.tls,
            stop,
        )
    }

    /// Spawn the accept loop on a background thread.
    pub fn spawn(self) -> io::Result<ServerHandle> {
        let port = self.listener.local_addr()?.port();
        self.listener.set_nonblocking(true)?;
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let token = self.token;
        let rpc = self.rpc;
        let renderer_handlers = self.renderer_handlers;
        let tls = self.tls;
        let join = std::thread::Builder::new()
            .name("airi-channel-accept".to_string())
            .spawn(move || serve(self.listener, token, rpc, renderer_handlers, tls, thread_stop))?;
        Ok(ServerHandle {
            port,
            stop,
            join: Some(join),
        })
    }
}

/// Handle to a running background server. Dropping it stops the accept loop
/// (existing connections are not force-closed).
pub struct ServerHandle {
    port: u16,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<io::Result<()>>>,
}

impl ServerHandle {
    /// The bound port.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Signal the accept loop to stop and wait for it.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn serve(
    listener: TcpListener,
    token: Arc<str>,
    rpc: RpcContext,
    renderer_handlers: Arc<RendererHandlers>,
    tls: Option<Arc<rustls::ServerConfig>>,
    stop: Arc<AtomicBool>,
) -> io::Result<()> {
    listener.set_nonblocking(true)?;
    loop {
        if stop.load(Ordering::SeqCst) {
            return Ok(());
        }
        match listener.accept() {
            Ok((tcp, peer)) => {
                let token = Arc::clone(&token);
                let rpc = rpc.for_session();
                let renderer_handlers = Arc::clone(&renderer_handlers);
                // Configure the socket *before* any TLS wrapping: the
                // handshake deadline applies to the raw TCP stream, and the
                // HTTP upgrade phase must complete within it.
                if let Err(err) = tcp
                    .set_read_timeout(Some(HANDSHAKE_READ_TIMEOUT))
                    .and_then(|_| tcp.set_nonblocking(false))
                {
                    tracing::debug!(%peer, %err, "channel connection rejected at socket setup");
                    continue;
                }
                let stream = match &tls {
                    Some(config) => match rustls::ServerConnection::new(Arc::clone(config)) {
                        Ok(conn) => ConnectionStream::Tls(rustls::StreamOwned::new(conn, tcp)),
                        Err(err) => {
                            tracing::warn!(%peer, %err, "TLS connection setup failed");
                            continue;
                        }
                    },
                    None => ConnectionStream::Plain(tcp),
                };
                std::thread::Builder::new()
                    .name(format!("airi-channel-conn-{peer}"))
                    .spawn(move || {
                        if let Err(err) = handle_connection(stream, &token, rpc, &renderer_handlers)
                        {
                            tracing::debug!(%peer, %err, "channel connection ended with error");
                        }
                    })?;
            }
            Err(err) if err.kind() == io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(err) => {
                tracing::warn!(%err, "channel accept failed");
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

fn handle_connection(
    mut stream: ConnectionStream,
    token: &str,
    rpc: RpcContext,
    renderer_handlers: &Arc<RendererHandlers>,
) -> io::Result<()> {
    // --- HTTP Upgrade phase -------------------------------------------------
    let mut header_buf = Vec::with_capacity(1024);
    loop {
        if upgrade_request_complete(&header_buf) {
            break;
        }
        if header_buf.len() > MAX_HTTP_HEADER_BYTES {
            write_http_error(&mut stream, 431, "Request Header Fields Too Large")?;
            return Ok(());
        }
        let mut chunk = [0u8; 4096];
        match stream.read(&mut chunk) {
            Ok(0) => return Ok(()), // client went away mid-headers
            Ok(n) => header_buf.extend_from_slice(&chunk[..n]),
            Err(err)
                if err.kind() == io::ErrorKind::WouldBlock
                    || err.kind() == io::ErrorKind::TimedOut =>
            {
                tracing::debug!("channel handshake timed out");
                return Ok(());
            }
            Err(err) if err.kind() == io::ErrorKind::Interrupted => continue,
            Err(err) => return Err(err),
        }
    }

    let request = match parse_upgrade_request(&header_buf) {
        Ok(req) => req,
        Err(UpgradeError::UnsupportedVersion(v)) => {
            tracing::debug!(version = %v, "channel upgrade rejected: bad version");
            write_http_error(&mut stream, 426, "Upgrade Required")?;
            return Ok(());
        }
        Err(err) => {
            tracing::debug!(%err, "channel upgrade rejected");
            write_http_error(&mut stream, 400, "Bad Request")?;
            return Ok(());
        }
    };

    let accept = accept_key(request.websocket_key().unwrap_or_default());
    stream.write_all(&upgrade_response(&accept))?;
    tracing::debug!(path = %request.path, "channel client upgraded");

    // --- WebSocket phase ----------------------------------------------------
    stream.clear_read_timeout()?; // idle clients are fine post-handshake
    let mut session = Session::with_renderer(token.to_string(), rpc, Arc::clone(renderer_handlers));
    let mut decoder = FrameDecoder::new(MAX_WS_PAYLOAD_BYTES);
    let mut fragments: Option<(u8, Vec<u8>)> = None;

    loop {
        let mut chunk = [0u8; 16 * 1024];
        let n = match stream.read(&mut chunk) {
            Ok(0) => return Ok(()),
            Ok(n) => n,
            Err(err) if err.kind() == io::ErrorKind::Interrupted => continue,
            Err(err) => return Err(err),
        };
        decoder.push(&chunk[..n]);

        loop {
            match decoder.next_frame() {
                Ok(Some(frame)) => {
                    if !handle_frame(&mut stream, &frame, &mut session, &mut fragments)? {
                        return Ok(());
                    }
                }
                Ok(None) => break,
                Err(DecodeError::FrameTooLarge { .. }) => {
                    send_close(&mut stream, CLOSE_MESSAGE_TOO_BIG, "message too big");
                    return Ok(());
                }
                Err(_) => {
                    send_close(&mut stream, CLOSE_PROTOCOL_ERROR, "protocol error");
                    return Ok(());
                }
            }
        }
    }
}

/// Handle one decoded frame. Returns `false` when the connection should close.
fn handle_frame(
    stream: &mut impl Write,
    frame: &Frame,
    session: &mut Session,
    fragments: &mut Option<(u8, Vec<u8>)>,
) -> io::Result<bool> {
    match frame.opcode {
        OP_CLOSE => {
            // Echo the close payload back, then drop the connection.
            let _ = stream.write_all(&encode_frame(OP_CLOSE, &frame.payload, None));
            return Ok(false);
        }
        OP_PING => {
            stream.write_all(&encode_frame(OP_PONG, &frame.payload, None))?;
            return Ok(true);
        }
        OP_PONG => return Ok(true), // unsolicited pongs are fine
        OP_BINARY => {
            send_close(
                stream,
                CLOSE_UNSUPPORTED_DATA,
                "binary frames not supported",
            );
            return Ok(false);
        }
        OP_TEXT | OP_CONTINUATION => {}
        _ => {
            send_close(stream, CLOSE_PROTOCOL_ERROR, "unknown opcode");
            return Ok(false);
        }
    }

    // Text / continuation: reassemble fragmented messages.
    let message: Option<Vec<u8>> = match frame.opcode {
        OP_TEXT => {
            if fragments.is_some() {
                send_close(
                    stream,
                    CLOSE_PROTOCOL_ERROR,
                    "new text frame during fragmented message",
                );
                return Ok(false);
            }
            if frame.fin {
                Some(frame.payload.clone())
            } else {
                *fragments = Some((OP_TEXT, frame.payload.clone()));
                None
            }
        }
        OP_CONTINUATION => {
            let Some((_, buf)) = fragments.as_mut() else {
                send_close(
                    stream,
                    CLOSE_PROTOCOL_ERROR,
                    "continuation without initial frame",
                );
                return Ok(false);
            };
            buf.extend_from_slice(&frame.payload);
            if buf.len() as u64 > MAX_WS_PAYLOAD_BYTES {
                send_close(stream, CLOSE_MESSAGE_TOO_BIG, "message too big");
                return Ok(false);
            }
            if frame.fin {
                fragments.take().map(|(_, buf)| buf)
            } else {
                None
            }
        }
        _ => unreachable!("handled above"),
    };

    let Some(message) = message else {
        return Ok(true); // fragment buffered, wait for more
    };

    let text = match String::from_utf8(message) {
        Ok(t) => t,
        Err(_) => {
            // RFC 6455 §8.1: close 1007 on invalid UTF-8 in a text message.
            send_close(stream, 1007, "invalid UTF-8 in text message");
            return Ok(false);
        }
    };

    let outcome = session.handle_text(&text);
    for reply in &outcome.replies {
        stream.write_all(&encode_frame(OP_TEXT, reply.as_bytes(), None))?;
    }
    if let Some(close) = outcome.close {
        send_close(stream, close.code, &close.reason);
        return Ok(false);
    }
    Ok(true)
}

/// Send a close frame; errors are ignored (we are tearing down anyway).
fn send_close(stream: &mut impl Write, code: u16, reason: &str) {
    let mut payload = code.to_be_bytes().to_vec();
    let bytes = reason.as_bytes();
    let keep = bytes.len().min(123); // close payloads are capped at 125 bytes
    payload.extend_from_slice(&bytes[..keep]);
    let _ = stream.write_all(&encode_frame(OP_CLOSE, &payload, None));
    let _ = stream.flush();
}

fn write_http_error(stream: &mut impl Write, code: u16, reason: &str) -> io::Result<()> {
    let body = format!("{code} {reason}\n");
    let response = format!(
        "HTTP/1.1 {code} {reason}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes())
}
