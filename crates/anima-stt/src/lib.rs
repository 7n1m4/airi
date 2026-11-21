// SPDX-License-Identifier: GPL-3.0-or-later

//! Native capture + Silero VAD + STT clients for the AIRI Slint rewrite.
//! No Slint dependencies; pure tokio/cpal/ort/reqwest. See `README.md` for the
//! runtime Silero model download location and Linux capture notes.

pub mod capture;
pub mod mic;
pub mod stt;
pub mod vad;

pub use capture::{AudioCapture, AudioLevel, CaptureConfig, CaptureError, PcmChunk};
pub use mic::{MicConfig, MicError, MicEvent, MicMode, MicService, StreamingStt, SttConfig};
pub use stt::{
    AliyunNlsClient, AliyunNlsConfig, DeepgramStreamingClient, OpenAiTranscribeClient, SttClient,
    SttError, SttEvent, SttRequest, SttStream, WhisperLocalClient,
};
pub use vad::{SileroVad, VadConfig, VadEvent, VadHysteresis};
