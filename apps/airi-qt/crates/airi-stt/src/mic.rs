// SPDX-License-Identifier: GPL-3.0-or-later

//! Microphone orchestration: capture → VAD → STT → events.
//!
//! Modes ([`MicMode`]):
//!
//! - **PushToTalk** — frames are buffered from [`MicService::start`] to
//!   [`MicService::stop`]; stopping flushes the whole buffer through the
//!   configured whole-blob [`SttClient`] and emits [`MicEvent::Final`].
//! - **Auto** — always-listening. Silero VAD segments the stream; on each
//!   `SpeechEnd` the segment is transcribed with the whole-blob client.
//!   `SpeechStart`/`SpeechEnd` are always emitted. True interim transcripts
//!   only flow when a streaming session is attached ([`MicConfig::streaming`]);
//!   otherwise `MicEvent::Interim` is never emitted (OpenAI-compatible
//!   transcription is whole-blob, not streaming).
//!
//! `duck_while_speaking` is a **reserved hook** for duplex operation: when TTS
//!   playback amplitude is high we must not transcribe our own voice. Wiring to
//!   `airi-speech` playback amplitude lands in a later phase; today it toggles
//!   a frame-shed gate ([`MicService::set_ducked`]). **There is no echo
//!   cancellation yet** — on laptop speakers the mic hears the TTS output and
//!   Auto mode will transcribe the assistant. Use headphones, or the duck gate
//!   once amplitude events are wired.
//!
//! Events are broadcast on [`MicService::subscribe`]; the QML bridge pumps them
//! into the UI in a later phase. Final transcripts are NOT injected into any
//! composer here — that wiring is the next phase (see phase notes).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use thiserror::Error;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use crate::capture::{AudioCapture, CaptureConfig, CaptureError, PcmChunk};
use crate::stt::{
    AliyunNlsClient, DeepgramStreamingClient, OpenAiTranscribeClient, SttClient, SttError,
    SttEvent, SttRequest, SttStream, WhisperLocalClient,
};
use crate::vad::{SileroVad, VadConfig, VadError, VadEvent};

/// Operating mode for the mic pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicMode {
    /// Buffer everything between [`MicService::start`] and [`MicService::stop`].
    PushToTalk,
    /// Continuous VAD-segmented listening with per-segment transcription.
    Auto,
}

/// Optional streaming STT session to attach to the mic pipeline.
///
/// When set, every captured frame is also forwarded to the session, and the
/// session's interim/final events are re-emitted as [`MicEvent::Interim`] /
/// [`MicEvent::Final`]. In this mode the whole-blob client is *not* used for
/// transcription (the streaming session is authoritative), though VAD still
/// segments and emits `SpeechStart`/`SpeechEnd`.
pub enum StreamingStt {
    /// Deepgram nova-3 streaming (interim + final).
    Deepgram(DeepgramStreamingClient),
    /// Aliyun NLS realtime transcription (interim + final).
    Aliyun(AliyunNlsClient),
}

impl std::fmt::Debug for StreamingStt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Deepgram(_) => f.write_str("Deepgram(..)"),
            Self::Aliyun(_) => f.write_str("Aliyun(..)"),
        }
    }
}
/// Additive whole-blob STT provider selection ("whisper-local" lane, P9).
///
/// Covers the whole-blob clients only; Deepgram/Aliyun are streaming
/// providers and stay on [`MicConfig::streaming`] ([`StreamingStt`]).
/// [`MicConfig::stt`] remains a free-form `Arc<dyn SttClient>` — set this
/// via [`SttConfig::build`] or [`MicConfig::with_stt_config`].
///
/// Default is [`SttConfig::OpenAi`] (the historical default path); the
/// `Default` impl does not read any environment.
#[derive(Clone)]
pub enum SttConfig {
    /// OpenAI-compatible `POST /audio/transcriptions` (works with Groq).
    OpenAi {
        /// e.g. `https://api.openai.com/v1` (default) or Groq's URL.
        base_url: String,
        /// Bearer token; `None` for keyless proxies.
        api_key: Option<String>,
        /// Model override; `None` → provider default.
        model: Option<String>,
    },
    /// Local on-device Whisper via whisper.cpp (`whisper-local`). `model_path`
    /// `None` → `AIRI_QT_WHISPER_MODEL` env → auto-downloaded `ggml-base.en.bin`
    /// in the platform data dir on first use (~148 MB).
    WhisperLocal {
        /// Explicit ggml model file; never committed to the repo.
        model_path: Option<std::path::PathBuf>,
    },
}

impl std::fmt::Debug for SttConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OpenAi {
                base_url, model, ..
            } => f
                .debug_struct("OpenAi")
                .field("base_url", base_url)
                .field("model", model)
                .finish(),
            Self::WhisperLocal { model_path } => f
                .debug_struct("WhisperLocal")
                .field("model_path", model_path)
                .finish(),
        }
    }
}

impl Default for SttConfig {
    fn default() -> Self {
        Self::OpenAi {
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: None,
            model: None,
        }
    }
}

impl SttConfig {
    /// Stable identifier of the client this config builds.
    #[must_use]
    pub fn id(&self) -> &'static str {
        match self {
            Self::OpenAi { .. } => "openai-compatible",
            Self::WhisperLocal { .. } => "whisper-local",
        }
    }

    /// Build the whole-blob client. Infallible: local whisper loads its model
    /// lazily on first transcription, not here.
    #[must_use]
    pub fn build(&self) -> Arc<dyn SttClient> {
        match self {
            Self::OpenAi {
                base_url,
                api_key,
                model,
            } => {
                let client = OpenAiTranscribeClient::new(base_url.clone(), api_key.clone());
                let client = match model {
                    Some(model) => client.with_model(model.clone()),
                    None => client,
                };
                Arc::new(client)
            }
            Self::WhisperLocal { model_path } => {
                Arc::new(WhisperLocalClient::new(model_path.clone()))
            }
        }
    }
}

impl StreamingStt {
    async fn connect(&self) -> Result<SttStream, SttError> {
        match self {
            Self::Deepgram(client) => client.connect().await,
            Self::Aliyun(client) => client.connect().await,
        }
    }
}

/// Mic pipeline configuration.
#[derive(Clone)]
pub struct MicConfig {
    pub mode: MicMode,
    pub capture: CaptureConfig,
    pub vad: VadConfig,
    /// Reserved hook for duplex operation (shed mic frames while TTS amplitude is
    /// high). Gates [`MicService::set_ducked`]; TTS amplitude wiring lands with
    /// the QML bridge. **No echo cancellation is implemented.**
    pub duck_while_speaking: bool,
    /// Whole-blob client used for PTT flush and Auto segment transcription
    /// (ignored when [`MicConfig::streaming`] is set).
    pub stt: Option<Arc<dyn SttClient>>,
    /// Streaming session client (Deepgram / Aliyun). When set, transcription
    /// events come from the session instead of the whole-blob client.
    pub streaming: Option<Arc<StreamingStt>>,
}

impl std::fmt::Debug for MicConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MicConfig")
            .field("capture", &self.capture)
            .field("vad", &self.vad)
            .field("duck_while_speaking", &self.duck_while_speaking)
            .field("stt_configured", &self.stt.is_some())
            .field("streaming", &self.streaming)
            .finish()
    }
}

impl Default for MicConfig {
    fn default() -> Self {
        Self {
            mode: MicMode::PushToTalk,
            capture: CaptureConfig::default(),
            vad: VadConfig::default(),
            duck_while_speaking: false,
            stt: None,
            streaming: None,
        }
    }
}

impl MicConfig {
    /// Attach a whole-blob client built from a [`SttConfig`] (builder style).
    /// Leaves `streaming` untouched. Does not change the `Default`.
    #[must_use]
    pub fn with_stt_config(mut self, config: SttConfig) -> Self {
        self.stt = Some(config.build());
        self
    }
}

/// Events emitted by the mic pipeline for the QML bridge (and tests).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MicEvent {
    /// Capture (and, in [`MicMode::Auto`], the VAD model) is ready and running.
    CaptureStarted,
    /// Capture stopped; the pipeline is idle.
    CaptureStopped,
    /// VAD crossed into speech.
    SpeechStart,
    /// VAD confirmed end of speech after the configured silence window.
    SpeechEnd { segment_ms: u64 },
    /// Provisional transcript text (streaming sessions only).
    Interim { text: String },
    /// Final transcript for the segment/utterance. Empty only for PTT flushes
    /// of buffered silence, or when the provider yields no text.
    Final { text: String },
    /// Non-fatal pipeline error (transcription failure, VAD inference failure, …).
    Error { message: String },
}

#[derive(Debug, Error)]
pub enum MicError {
    #[error(transparent)]
    Capture(#[from] CaptureError),
    #[error(transparent)]
    Stt(#[from] SttError),
    #[error(transparent)]
    Vad(#[from] VadError),
    #[error("mic service is already running")]
    AlreadyRunning,
    #[error("mic service is not running")]
    NotRunning,
}

#[derive(Debug, Default)]
struct MicState {
    /// PTT: whole utterance. Auto: current segment since SpeechStart.
    pcm: Vec<i16>,
    speaking: bool,
}

/// Handle to a mic pipeline. One instance per capture session;
/// call [`MicService::start`] then [`MicService::stop`].
pub struct MicService {
    config: MicConfig,
    events_tx: broadcast::Sender<MicEvent>,
    state: Arc<Mutex<MicState>>,
    /// Frame-shed gate for [`MicConfig::duck_while_speaking`].
    ducked: Arc<AtomicBool>,
    capture: Option<AudioCapture>,
    pump: Option<JoinHandle<()>>,
}

impl std::fmt::Debug for MicService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MicService")
            .field("duck_while_speaking", &self.config.duck_while_speaking)
            .field("ducked", &self.ducked.load(Ordering::Relaxed))
            .field("capture_running", &self.capture.is_some())
            .finish_non_exhaustive()
    }
}

impl MicService {
    pub fn new(config: MicConfig) -> Self {
        let (events_tx, _) = broadcast::channel(64);
        Self {
            config,
            events_tx,
            state: Arc::new(Mutex::new(MicState::default())),
            ducked: Arc::new(AtomicBool::new(false)),
            capture: None,
            pump: None,
        }
    }

    /// Subscribe to pipeline events.
    pub fn subscribe(&self) -> broadcast::Receiver<MicEvent> {
        self.events_tx.subscribe()
    }

    /// True while capture is running.
    pub fn is_running(&self) -> bool {
        self.capture.is_some()
    }

    /// Set the duck gate (frame shedding while TTS speaks). The gate is honored
    /// whenever set; wiring it to TTS amplitude lands with the QML bridge.
    pub fn set_ducked(&self, ducked: bool) {
        self.ducked.store(ducked, Ordering::Relaxed);
    }

    /// Start capture (and, in Auto mode, load the VAD model — downloading it to
    /// the data dir on first run). Emits [`MicEvent::CaptureStarted`].
    ///
    /// Fails if already running, if no capture device is usable, or if the VAD
    /// model cannot be loaded in Auto mode.
    pub async fn start(&mut self) -> Result<(), MicError> {
        if self.capture.is_some() {
            return Err(MicError::AlreadyRunning);
        }

        // In Auto mode, load the VAD first so misconfiguration fails before the mic opens.
        let vad = match self.config.mode {
            MicMode::Auto => {
                let path = crate::vad::ensure_model().await?;
                Some(SileroVad::load(&path, self.config.vad)?)
            }
            MicMode::PushToTalk => None,
        };

        // Open the streaming session before the mic starts so no frames are lost.
        let streaming_session = match &self.config.streaming {
            Some(streaming) => Some(streaming.connect().await?),
            None => None,
        };

        // Forward the session's interim/final/error events into MicEvent.
        if let Some(session) = &streaming_session {
            let mut events_rx = session.events.resubscribe();
            let events_tx = self.events_tx.clone();
            tokio::spawn(async move {
                loop {
                    match events_rx.recv().await {
                        Ok(SttEvent::Interim { text }) => {
                            let _ = events_tx.send(MicEvent::Interim { text });
                        }
                        Ok(SttEvent::Final { text }) => {
                            let _ = events_tx.send(MicEvent::Final { text });
                        }
                        Ok(SttEvent::Error { message }) => {
                            let _ = events_tx.send(MicEvent::Error { message });
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
            });
        }

        let capture = AudioCapture::start(self.config.capture.clone())?;
        let capture_rx = capture.rx.resubscribe();

        {
            let mut guard = self.state.lock().expect("mic state mutex poisoned");
            guard.pcm.clear();
            guard.speaking = false;
        }
        let _ = self.events_tx.send(MicEvent::CaptureStarted);

        let state = Arc::clone(&self.state);
        let events_tx = self.events_tx.clone();
        let config = self.config.clone();
        let ducked = Arc::clone(&self.ducked);
        let stt = self.config.stt.clone();

        let pump = tokio::spawn(async move {
            pump_frames(
                capture_rx,
                config,
                state,
                events_tx,
                stt,
                vad,
                ducked,
                streaming_session,
            )
            .await;
        });
        self.pump = Some(pump);
        self.capture = Some(capture);
        Ok(())
    }

    /// Stop capture and finalize.
    ///
    /// - PushToTalk: flushes the buffered utterance through the whole-blob
    ///   client (if no streaming session is attached) and emits
    ///   [`MicEvent::Final`].
    /// - Auto: stops the pump; any in-flight segment is flushed the same way.
    ///
    /// Emits [`MicEvent::CaptureStopped`]. Returns [`MicError::NotRunning`] if
    /// called while stopped.
    pub async fn stop(&mut self) -> Result<(), MicError> {
        let capture = self.capture.take().ok_or(MicError::NotRunning)?;
        capture.stop(); // drops the ALSA stream; the pump observes Closed and finalizes

        if let Some(pump) = self.pump.take() {
            let _ = pump.await; // finalize + whole-blob flush happen inside
        }

        let _ = self.events_tx.send(MicEvent::CaptureStopped);
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
async fn pump_frames(
    mut rx: broadcast::Receiver<PcmChunk>,
    config: MicConfig,
    state: Arc<Mutex<MicState>>,
    events_tx: broadcast::Sender<MicEvent>,
    stt: Option<Arc<dyn SttClient>>,
    mut vad: Option<SileroVad>,
    ducked: Arc<AtomicBool>,
    streaming: Option<SttStream>,
) {
    let has_streaming = streaming.is_some();
    loop {
        match rx.recv().await {
            Ok(chunk) => {
                if ducked.load(Ordering::Relaxed) {
                    // Duck gate: shed frames wholesale while TTS is speaking.
                    continue;
                }
                // Forward to the streaming session, if attached.
                if let Some(session) = &streaming {
                    // Backpressure by awaiting; the session's writer drains quickly.
                    if session.send_pcm(&chunk.samples).await.is_err() {
                        let _ = events_tx.send(MicEvent::Error {
                            message: "streaming session closed unexpectedly".into(),
                        });
                    }
                }
                match config.mode {
                    MicMode::PushToTalk => {
                        state
                            .lock()
                            .expect("mic state mutex poisoned")
                            .pcm
                            .extend_from_slice(&chunk.samples);
                    }
                    MicMode::Auto => {
                        let Some(vad) = vad.as_mut() else {
                            let _ = events_tx.send(MicEvent::Error {
                                message: "auto mode requires a loaded VAD".into(),
                            });
                            continue;
                        };
                        match vad.push(&chunk.samples) {
                            Ok(vad_events) => {
                                for event in vad_events {
                                    match event {
                                        VadEvent::SpeechStart => {
                                            let mut guard =
                                                state.lock().expect("mic state mutex poisoned");
                                            guard.pcm.clear();
                                            guard.speaking = true;
                                            drop(guard);
                                            let _ = events_tx.send(MicEvent::SpeechStart);
                                        }
                                        VadEvent::SpeechEnd { segment_ms } => {
                                            let segment = {
                                                let mut guard =
                                                    state.lock().expect("mic state mutex poisoned");
                                                guard.speaking = false;
                                                std::mem::take(&mut guard.pcm)
                                            };
                                            let _ =
                                                events_tx.send(MicEvent::SpeechEnd { segment_ms });
                                            transcribe_segment(
                                                segment,
                                                !has_streaming,
                                                &stt,
                                                &events_tx,
                                            );
                                        }
                                        VadEvent::Speaking(speaking) => {
                                            if speaking {
                                                state
                                                    .lock()
                                                    .expect("mic state mutex poisoned")
                                                    .pcm
                                                    .extend_from_slice(&chunk.samples);
                                            }
                                        }
                                    }
                                }
                            }
                            Err(err) => {
                                let _ = events_tx.send(MicEvent::Error {
                                    message: format!("VAD inference failed: {err}"),
                                });
                            }
                        }
                    }
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {
                let _ = events_tx.send(MicEvent::Error {
                    message: "capture subscriber lagged; audio frames were dropped".into(),
                });
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }

    // Close the streaming session (server flushes terminal events; the forwarder
    // task re-emits them as MicEvent::Final).
    if let Some(session) = streaming {
        let _ = session.finish().await;
    }

    // Finalize: flush any buffered audio through the whole-blob client (PTT
    // stop, or Auto with a partial in-flight segment).
    let buffered = std::mem::take(&mut state.lock().expect("mic state mutex poisoned").pcm);
    if !buffered.is_empty() {
        transcribe_segment(buffered, !has_streaming, &stt, &events_tx);
    }
}

/// Dispatch the whole-blob transcription for one segment; `emit` is false when
/// a streaming session owns final events.
fn transcribe_segment(
    segment: Vec<i16>,
    emit: bool,
    stt: &Option<Arc<dyn SttClient>>,
    events_tx: &broadcast::Sender<MicEvent>,
) {
    if !emit {
        return; // streaming session is authoritative for the transcript
    }
    if segment.is_empty() {
        return;
    }
    let Some(stt) = stt.clone() else {
        let _ = events_tx.send(MicEvent::Error {
            message: "no STT client configured (set MicConfig::stt or MicConfig::streaming)".into(),
        });
        return;
    };
    let events_tx = events_tx.clone();
    tokio::spawn(async move {
        match stt.transcribe_pcm(SttRequest::from_pcm(segment)).await {
            Ok(text) => {
                let _ = events_tx.send(MicEvent::Final { text });
            }
            Err(err) => {
                let _ = events_tx.send(MicEvent::Error {
                    message: format!("transcription failed: {err}"),
                });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use async_trait::async_trait;

    use super::*;
    use crate::capture::PcmChunk;

    struct MockStt {
        text: String,
        calls: std::sync::Mutex<Vec<Vec<i16>>>,
    }

    #[async_trait]
    impl SttClient for MockStt {
        fn id(&self) -> &str {
            "mock"
        }

        async fn transcribe_pcm(&self, req: SttRequest) -> Result<String, SttError> {
            self.calls.lock().unwrap().push(req.pcm_s16le.clone());
            Ok(self.text.clone())
        }
    }

    fn test_chunk(samples: Vec<i16>, seq: u64) -> PcmChunk {
        PcmChunk {
            samples,
            sample_rate: 16_000,
            seq,
            peak: 0.5,
            rms: 0.25,
        }
    }

    fn collect_events(rx: &mut broadcast::Receiver<MicEvent>) -> Vec<MicEvent> {
        let mut out = Vec::new();
        while let Ok(event) = rx.try_recv() {
            out.push(event);
        }
        out
    }

    #[tokio::test]
    async fn ptt_full_flow_emits_final() {
        let mock = Arc::new(MockStt {
            text: "hello world".to_string(),
            calls: std::sync::Mutex::new(Vec::new()),
        });
        let mock_dyn: Arc<dyn SttClient> = mock.clone();

        let (chunk_tx, chunk_rx) = broadcast::channel(16);
        let (events_tx, mut events_rx) = broadcast::channel(16);
        let config = MicConfig {
            mode: MicMode::PushToTalk,
            ..Default::default()
        };
        let state = Arc::new(Mutex::new(MicState::default()));
        let ducked = Arc::new(AtomicBool::new(false));

        let pump = tokio::spawn(pump_frames(
            chunk_rx,
            config,
            state,
            events_tx,
            Some(mock_dyn),
            None,
            ducked,
            None,
        ));

        chunk_tx.send(test_chunk(vec![0; 512], 0)).unwrap();
        chunk_tx.send(test_chunk(vec![100; 512], 1)).unwrap();
        drop(chunk_tx); // close → pump flushes and exits
        pump.await.unwrap();

        // transcribe_segment spawns a task; give it a moment to emit Final.
        let mut events = collect_events(&mut events_rx);
        for _ in 0..50 {
            if events.iter().any(|e| matches!(e, MicEvent::Final { .. })) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            events = collect_events(&mut events_rx);
        }
        let finals: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                MicEvent::Final { text } => Some(text.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(finals, vec!["hello world".to_string()]);
        assert_eq!(mock.calls.lock().unwrap().len(), 1);
        assert_eq!(mock.calls.lock().unwrap()[0].len(), 1024);
    }

    #[tokio::test]
    async fn duck_gate_drops_frames() {
        let mock = Arc::new(MockStt {
            text: "should not happen".to_string(),
            calls: std::sync::Mutex::new(Vec::new()),
        });
        let mock_dyn: Arc<dyn SttClient> = mock.clone();

        let (chunk_tx, chunk_rx) = broadcast::channel(16);
        let (events_tx, mut events_rx) = broadcast::channel(16);
        let config = MicConfig::default();
        let state = Arc::new(Mutex::new(MicState::default()));
        let ducked = Arc::new(AtomicBool::new(true));

        let pump = tokio::spawn(pump_frames(
            chunk_rx,
            config,
            state,
            events_tx,
            Some(mock_dyn),
            None,
            ducked,
            None,
        ));

        chunk_tx.send(test_chunk(vec![0; 512], 0)).unwrap();
        drop(chunk_tx);
        pump.await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(
            mock.calls.lock().unwrap().is_empty(),
            "ducked frames must not reach STT"
        );
        assert!(collect_events(&mut events_rx).is_empty());
    }

    #[tokio::test]
    async fn ptt_without_stt_emits_error() {
        let (chunk_tx, chunk_rx) = broadcast::channel(16);
        let (events_tx, mut events_rx) = broadcast::channel(16);
        let config = MicConfig::default(); // no stt, no streaming
        let state = Arc::new(Mutex::new(MicState::default()));
        let ducked = Arc::new(AtomicBool::new(false));

        let pump = tokio::spawn(pump_frames(
            chunk_rx, config, state, events_tx, None, None, ducked, None,
        ));

        chunk_tx.send(test_chunk(vec![0; 512], 0)).unwrap();
        drop(chunk_tx);
        pump.await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let events = collect_events(&mut events_rx);
        assert!(events.iter().any(
            |e| matches!(e, MicEvent::Error { message } if message.contains("no STT client"))
        ));
    }

    #[test]
    fn stt_config_whisper_local_builds_local_client() {
        let config = SttConfig::WhisperLocal {
            model_path: Some(std::path::PathBuf::from("/tmp/ignored.bin")),
        };
        assert_eq!(config.id(), "whisper-local");
        assert_eq!(config.build().id(), "whisper-local");
        let mic = MicConfig::default().with_stt_config(config);
        assert!(mic.stt.is_some());
        assert_eq!(mic.stt.as_ref().map(|c| c.id()), Some("whisper-local"));
    }

    #[test]
    fn stt_config_default_is_openai_and_does_not_read_env() {
        let config = SttConfig::default();
        assert_eq!(config.id(), "openai-compatible");
        assert_eq!(config.build().id(), "openai-compatible");
    }

    #[test]
    fn stt_config_openai_with_model_override() {
        let config = SttConfig::OpenAi {
            base_url: "https://api.groq.com/openai/v1".into(),
            api_key: Some("key".into()),
            model: Some("whisper-large-v3-turbo".into()),
        };
        assert_eq!(config.build().id(), "openai-compatible");
    }
}

#[cfg(test)]
mod auto_tests {
    use async_trait::async_trait;

    use super::*;
    use crate::capture::PcmChunk;

    struct MockStt {
        text: String,
        calls: std::sync::Mutex<usize>,
    }

    #[async_trait]
    impl SttClient for MockStt {
        fn id(&self) -> &str {
            "mock"
        }

        async fn transcribe_pcm(&self, _req: SttRequest) -> Result<String, SttError> {
            *self.calls.lock().unwrap() += 1;
            Ok(self.text.clone())
        }
    }

    fn test_chunk(samples: Vec<i16>, seq: u64) -> PcmChunk {
        PcmChunk {
            samples,
            sample_rate: 16_000,
            seq,
            peak: 0.5,
            rms: 0.25,
        }
    }

    /// Auto-mode e2e: silence → synthetic voiced burst → silence, through the
    /// real model when it is available (cached or downloadable). Verifies
    /// SpeechStart/SpeechEnd are emitted and the segment reaches the mock STT.
    /// Skips gracefully when the model cannot be obtained.
    #[tokio::test]
    async fn auto_mode_segments_and_transcribes() {
        // Serialize env-var mutation with other silero tests, then drop the
        // guard before the await (never hold a std Mutex across `.await`).
        {
            let _guard = crate::vad::SILERO_ENV_LOCK.lock().unwrap();
            std::env::remove_var("SILERO_SKIP_DOWNLOAD");
        }
        let vad_path = match crate::vad::ensure_model().await {
            Ok(path) => path,
            Err(err) => {
                eprintln!("skipping auto-mode e2e: silero model unavailable: {err}");
                return;
            }
        };

        let mock = Arc::new(MockStt {
            text: "segment transcript".to_string(),
            calls: std::sync::Mutex::new(0),
        });
        let mock_dyn: Arc<dyn SttClient> = mock.clone();

        let (chunk_tx, chunk_rx) = broadcast::channel(256);
        let (events_tx, mut events_rx) = broadcast::channel(256);
        let config = MicConfig {
            mode: MicMode::Auto,
            ..Default::default()
        };
        let state = Arc::new(Mutex::new(MicState::default()));
        let ducked = Arc::new(AtomicBool::new(false));
        let vad = SileroVad::load(&vad_path, VadConfig::default()).expect("load silero model");

        let pump = tokio::spawn(pump_frames(
            chunk_rx,
            config,
            state,
            events_tx,
            Some(mock_dyn),
            Some(vad),
            ducked,
            None,
        ));

        // 1 s silence, ~1.6 s of synthetic voiced harmonics, 1.3 s silence.
        let mut seq = 0u64;
        let mut send = |config_chunk: Vec<i16>| {
            let s = seq;
            seq += 1;
            chunk_tx.send(test_chunk(config_chunk, s)).unwrap();
        };
        for _ in 0..31 {
            send(vec![0i16; crate::vad::FRAME_SAMPLES]);
        }
        for f in 0..50usize {
            let frame: Vec<i16> = (0..crate::vad::FRAME_SAMPLES)
                .map(|i| {
                    let t = (f * crate::vad::FRAME_SAMPLES + i) as f32 / 16000.0;
                    let f0 = 140.0f32;
                    let mut s = 0.0f32;
                    for (harmonic, amp) in [
                        (1.0f32, 1.0f32),
                        (2.0, 0.6),
                        (3.0, 0.4),
                        (4.0, 0.25),
                        (5.0, 0.15),
                    ] {
                        s += amp * (t * f0 * harmonic * std::f32::consts::TAU).sin();
                    }
                    let am = 0.5 + 0.5 * (t * 6.0 * std::f32::consts::TAU).sin();
                    (s * 0.45 * am * i16::MAX as f32) as i16
                })
                .collect();
            send(frame);
        }
        for _ in 0..42 {
            send(vec![0i16; crate::vad::FRAME_SAMPLES]);
        }
        drop(chunk_tx);
        pump.await.unwrap();

        // Give the spawned transcription task a moment.
        let mut events = Vec::new();
        for _ in 0..100 {
            while let Ok(event) = events_rx.try_recv() {
                events.push(event);
            }
            if events.iter().any(|e| matches!(e, MicEvent::Final { .. })) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }

        assert!(
            events.iter().any(|e| matches!(e, MicEvent::SpeechStart)),
            "expected SpeechStart, got {events:?}"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, MicEvent::SpeechEnd { .. })),
            "expected SpeechEnd, got {events:?}"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, MicEvent::Final { text } if text == "segment transcript")),
            "expected Final with mock transcript, got {events:?}"
        );
        assert_eq!(*mock.calls.lock().unwrap(), 1);
    }
}
