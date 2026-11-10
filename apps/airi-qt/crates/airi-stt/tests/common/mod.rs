// SPDX-License-Identifier: GPL-3.0-or-later

//! Mock OpenAI-compatible transcription server over a raw TCP socket.
//!
//! Accepts exactly one HTTP/1.1 request, records its method/path/headers/body,
//! responds with a canned transcript, and returns the captured request for
//! assertions. No `mockito`/axum needed — the wire shape is the assertion.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[derive(Debug)]
pub struct CapturedRequest {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl CapturedRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        let lower = name.to_lowercase();
        self.headers
            .iter()
            .find(|(k, _)| k.to_lowercase() == lower)
            .map(|(_, v)| v.as_str())
    }

    pub fn body_contains(&self, needle: &[u8]) -> bool {
        self.body
            .windows(needle.len())
            .any(|window| window == needle)
    }
}

pub fn serve_once(response_body: &'static str) -> (String, mpsc::Receiver<CapturedRequest>) {
    serve_once_with(200, "OK", response_body)
}

/// Start a one-shot mock server with an explicit status. Returns (base_url, handle).
pub fn serve_once_with(
    status_code: u16,
    status_text: &'static str,
    response_body: &'static str,
) -> (String, mpsc::Receiver<CapturedRequest>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let addr = listener.local_addr().expect("mock server addr");
    let (tx, rx) = mpsc::channel();

    std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("mock server accept");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("set read timeout");
        match read_request(&stream) {
            Ok(captured) => {
                let body = response_body.as_bytes();
                let response = format!(
                    "HTTP/1.1 {status_code} {status_text}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                let mut stream = stream;
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.write_all(body);
                let _ = stream.flush();
                let _ = tx.send(captured);
            }
            Err(err) => {
                eprintln!("mock server failed to read request: {err}");
            }
        }
    });

    (format!("http://{addr}"), rx)
}

fn read_request(mut stream: &TcpStream) -> std::io::Result<CapturedRequest> {
    // Read until end of headers, then continue until Content-Length bytes of body.
    let mut buf = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];
    let deadline = Instant::now() + Duration::from_secs(10);

    let header_end = loop {
        if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
            break pos;
        }
        if Instant::now() > deadline {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "headers never completed",
            ));
        }
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "client closed before headers",
            ));
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > 1 << 20 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "headers too large",
            ));
        }
    };

    let header_text = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();

    let mut headers = Vec::new();
    let mut content_length = 0usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_string();
            let value = value.trim().to_string();
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.parse().unwrap_or(0);
            }
            headers.push((name, value));
        }
    }

    let mut body = buf.split_off(header_end + 4);
    while body.len() < content_length {
        if Instant::now() > deadline {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "body never completed",
            ));
        }
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "client closed before body",
            ));
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);

    Ok(CapturedRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
