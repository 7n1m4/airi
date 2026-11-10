// SPDX-License-Identifier: GPL-3.0-or-later

//! STT (speech-to-text) clients.
//!
//! Two shapes of client:
//!
//! - Whole-blob via the [`SttClient`] trait (OpenAI-compatible
//!   `POST {base}/audio/transcriptions`, works with Groq etc.). The PCM blob is
//!   encoded to WAV in-memory and uploaded as multipart/form-data.
//! - Streaming via [`SttStream`] (Deepgram `wss://api.deepgram.com/v1/listen`,
//!   Aliyun NLS `wss://nls-gateway-<region>.aliyuncs.com/ws/v1`). The caller
//!   pushes 512-sample / arbitrary s16 PCM frames with [`SttStream::send_pcm`],
//!   and subscribes to [`SttEvent::Interim`] / [`SttEvent::Final`] on
//!   [`SttStream::events`]. Drop the stream after [`SttStream::finish`] —
//!   the server emits its terminal event and the pump tasks exit.
//!
//! [`SttEvent`] is the common interim/final vocabulary shared with the mic
//! orchestration ([`crate::mic`]).

pub mod aliyun;
pub mod deepgram;
pub mod openai;
pub mod whisper_local;

pub use aliyun::{parse_aliyun_ws_url, AliyunNlsClient, AliyunNlsConfig};
pub use deepgram::DeepgramStreamingClient;
pub use openai::OpenAiTranscribeClient;
pub use whisper_local::{
    ensure_model as ensure_whisper_model, WhisperLocalClient, WhisperModelError,
};

use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use thiserror::Error;
use tokio::sync::{broadcast, mpsc, watch};

/// One whole-utterance transcription request.
#[derive(Debug, Clone)]
pub struct SttRequest {
    /// Mono 16-bit little-endian PCM samples.
    pub pcm_s16le: Vec<i16>,
    /// Sample rate in Hz (16000 for everything this crate produces).
    pub sample_rate: u32,
    /// BCP-47 language hint, e.g. `"en"`, `"zh"`. Optional; provider-dependent.
    pub language: Option<String>,
    /// Model override; `None` → provider default (`whisper-1` for OpenAI).
    pub model: Option<String>,
    /// Optional prompt to bias the transcription. Optional.
    pub prompt: Option<String>,
}

impl SttRequest {
    /// Convenience constructor for 16 kHz mono PCM with no extra hints.
    #[must_use]
    pub fn from_pcm(pcm_s16le: Vec<i16>) -> Self {
        Self {
            pcm_s16le,
            sample_rate: 16_000,
            language: None,
            model: None,
            prompt: None,
        }
    }

    /// Duration of the audio in milliseconds.
    #[must_use]
    pub fn duration_ms(&self) -> u64 {
        if self.sample_rate == 0 {
            return 0;
        }
        (self.pcm_s16le.len() as u64 * 1000) / self.sample_rate as u64
    }
}

/// Common event vocabulary for streaming STT sessions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SttEvent {
    /// Provisional text (may change as more audio arrives). Deepgram:
    /// `is_final == false`. Aliyun: `TranscriptionResultChanged`.
    Interim { text: String },
    /// Final text for the current segment/utterance. Deepgram: `is_final == true`.
    /// Aliyun: `SentenceEnd`.
    Final { text: String },
    /// Non-fatal session error surfaced from the server or the transport.
    Error { message: String },
}

#[derive(Debug, Error)]
pub enum SttError {
    #[error("http transport: {0}")]
    Http(#[from] reqwest::Error),
    #[error("provider returned HTTP {status}: {body}")]
    Provider { status: u16, body: String },
    #[error("websocket error: {0}")]
    WebSocket(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("configuration: {0}")]
    Config(String),
    #[error("protocol: {0}")]
    Protocol(String),
    #[error("stream is already finished")]
    Finished,
}

/// Whole-blob transcription client (e.g. OpenAI-compatible
/// `/audio/transcriptions`). For streaming sessions see [`SttStream`].
#[async_trait]
pub trait SttClient: Send + Sync {
    /// Stable provider identifier (`"openai-compatible"`, `"groq"`, …).
    fn id(&self) -> &str;
    /// Transcribe a complete PCM blob. Returns the final transcript text.
    async fn transcribe_pcm(&self, req: SttRequest) -> Result<String, SttError>;
}

/// WAV (RIFF) encoding of mono s16 PCM. Public for reuse by tests and the mic pipeline.
pub fn wav_bytes(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let data_len = samples.len() * 2;
    let mut out = Vec::with_capacity(44 + data_len);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    for &sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

/// Raw s16 little-endian bytes of mono PCM (what Deepgram/Aliyun frames want).
pub fn s16le_bytes(samples: &[i16]) -> bytes::Bytes {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    bytes::Bytes::from(out)
}

// ---------------------------------------------------------------------------
// Streaming plumbing shared by Deepgram and Aliyun
// ---------------------------------------------------------------------------

/// Commands from [`SttStream`] into the WebSocket writer task.
pub(crate) enum StreamCommand {
    Pcm(Vec<i16>),
    Close,
}

/// Outcome of parsing one server text message.
pub(crate) struct PumpOutput {
    /// Event to forward to [`SttStream::events`], if any.
    pub event: Option<SttEvent>,
    /// Server acknowledged session start (Aliyun `TranscriptionStarted`).
    pub started: bool,
    /// Server completed the session (Aliyun `TranscriptionCompleted`).
    pub completed: bool,
}

impl PumpOutput {
    pub(crate) const IGNORED: Self = Self {
        event: None,
        started: false,
        completed: false,
    };
}

/// A live streaming STT session. Frames go in via [`SttStream::send_pcm`];
/// interim/final events come out on [`SttStream::events`].
pub struct SttStream {
    /// Broadcast of interim/final/error events from the server.
    pub events: broadcast::Receiver<SttEvent>,
    audio_tx: mpsc::Sender<StreamCommand>,
    finished: AtomicBool,
}

impl std::fmt::Debug for SttStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SttStream").finish_non_exhaustive()
    }
}

impl SttStream {
    /// Queue PCM frames for sending. Cheap; frames are handed to the writer task.
    /// Errors once [`SttStream::finish`] has been called.
    pub async fn send_pcm(&self, samples: &[i16]) -> Result<(), SttError> {
        if self.finished.load(Ordering::Acquire) {
            return Err(SttError::Finished);
        }
        self.audio_tx
            .send(StreamCommand::Pcm(samples.to_vec()))
            .await
            .map_err(|_| SttError::Finished)
    }

    /// Request session shutdown. The provider-specific close handshake runs in
    /// the background (deepgram: `CloseStream`; aliyun: `StopTranscription`);
    /// the server is expected to close the connection after its terminal event,
    /// and any interim/final events it emits before closing are delivered on
    /// [`SttStream::events`].
    pub async fn finish(&self) -> Result<(), SttError> {
        if self.finished.swap(true, Ordering::AcqRel) {
            return Err(SttError::Finished);
        }
        // Best-effort: the writer task may have already exited.
        let _ = self.audio_tx.send(StreamCommand::Close).await;
        Ok(())
    }
}

/// The halves of a streaming session, before tasks are spawned.
pub(crate) struct StreamChannels {
    pub(crate) stream: SttStream,
    pub(crate) audio_rx: mpsc::Receiver<StreamCommand>,
    pub(crate) events_tx: broadcast::Sender<SttEvent>,
    pub(crate) started_tx: Option<watch::Sender<bool>>,
    pub(crate) started_rx: Option<watch::Receiver<bool>>,
}

/// Provider-specific bits the shared WebSocket pump needs.
pub(crate) struct WsPumpConfig {
    /// Text frame sent when the caller finishes the session (provider-specific close).
    pub(crate) close_message: String,
    /// Decode one server text message.
    pub(crate) parse: fn(&str) -> PumpOutput,
    /// Optional frame sent before anything else (e.g. aliyun StartTranscription).
    pub(crate) pre_text: Option<String>,
}

/// Wire up the shared stream halves. Returns the public stream, the writer-side
/// command receiver, the event sender, and optional start gates used by
/// providers that require an acknowledgement dance before audio can flow.
pub(crate) fn stream_channels(with_gate: bool) -> StreamChannels {
    let (events_tx, events_rx) = broadcast::channel(64);
    let (audio_tx, audio_rx) = mpsc::channel(512);
    let stream = SttStream {
        events: events_rx,
        audio_tx,
        finished: AtomicBool::new(false),
    };
    if with_gate {
        let (started_tx, started_rx) = watch::channel(false);
        StreamChannels {
            stream,
            audio_rx,
            events_tx,
            started_tx: Some(started_tx),
            started_rx: Some(started_rx),
        }
    } else {
        StreamChannels {
            stream,
            audio_rx,
            events_tx,
            started_tx: None,
            started_rx: None,
        }
    }
}

/// Spawn the writer + reader tasks for a connected WebSocket.
///
/// `parse` decodes one server text message; its gate flags are wired to the
/// optional `started` watch. The writer holds PCM until `started` is set when
/// a gate is present (aliyun), else sends immediately (deepgram).
pub(crate) fn spawn_ws_pump(
    ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    channels: StreamChannels,
    config: WsPumpConfig,
) -> SttStream {
    let StreamChannels {
        stream,
        audio_rx,
        events_tx,
        started_tx,
        started_rx,
    } = channels;
    let WsPumpConfig {
        close_message,
        parse,
        pre_text,
    } = config;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let (mut sink, mut read) = ws.split();

    // Writer task.
    tokio::spawn(async move {
        // Handshake frame sent before any audio (e.g. aliyun StartTranscription).
        if let Some(text) = pre_text {
            let _ = sink.send(Message::Text(text.into())).await;
        }
        if let Some(mut started_rx) = started_rx {
            // Hold audio until the server acknowledges the session, or proceed
            // if the subscription was already set.
            if !*started_rx.borrow() {
                let _ = started_rx.wait_for(|v| *v).await;
            }
        }
        let mut audio_rx = audio_rx;
        while let Some(cmd) = audio_rx.recv().await {
            match cmd {
                StreamCommand::Pcm(samples) => {
                    if sink
                        .send(Message::Binary(s16le_bytes(&samples)))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                StreamCommand::Close => {
                    let _ = sink.send(Message::Text(close_message.clone().into())).await;
                    // Give the server a beat to flush terminal events, then close.
                    let _ = sink.close().await;
                    break;
                }
            }
        }
    });

    // Reader task.
    tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let text = text.to_string();
                    let output = parse(&text);
                    if output.started {
                        if let Some(tx) = &started_tx {
                            let _ = tx.send(true);
                        }
                    }
                    if let Some(event) = output.event {
                        let _ = events_tx.send(event);
                    }
                    if output.completed {
                        // Session is done; the read half ends and the WS closes.
                        break;
                    }
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(err) => {
                    let _ = events_tx.send(SttEvent::Error {
                        message: format!("websocket receive failed: {err}"),
                    });
                    break;
                }
            }
        }
    });

    stream
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_is_well_formed() {
        let samples = vec![0i16, 100, -100, 32767, -32768];
        let wav = wav_bytes(&samples, 16_000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(u32::from_le_bytes(wav[16..20].try_into().unwrap()), 16); // fmt size
        assert_eq!(u16::from_le_bytes(wav[20..22].try_into().unwrap()), 1); // PCM
        assert_eq!(u16::from_le_bytes(wav[22..24].try_into().unwrap()), 1); // mono
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(
            u32::from_le_bytes(wav[40..44].try_into().unwrap()) as usize,
            samples.len() * 2
        );
        assert_eq!(wav.len(), 44 + samples.len() * 2);
        assert_eq!(
            u32::from_le_bytes(wav[4..8].try_into().unwrap()) as usize,
            wav.len() - 8
        );
    }

    #[test]
    fn s16le_roundtrip_bytes() {
        let samples = vec![1i16, -2, 256, i16::MAX];
        let bytes = s16le_bytes(&samples);
        assert_eq!(bytes.len(), 8);
        assert_eq!(i16::from_le_bytes([bytes[0], bytes[1]]), 1);
        assert_eq!(i16::from_le_bytes([bytes[6], bytes[7]]), i16::MAX);
    }

    #[test]
    fn request_duration_ms() {
        let req = SttRequest::from_pcm(vec![0; 16000]);
        assert_eq!(req.duration_ms(), 1000);
    }
}
