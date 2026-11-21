// SPDX-License-Identifier: GPL-3.0-or-later

//! Shared typed shapes for the speech pipeline: options, formats and events.

use std::pin::Pin;

use bytes::Bytes;
use futures_util::Stream;
use serde::{Deserialize, Serialize};

use crate::error::SpeechError;

/// Container format of the audio bytes produced by a synthesizer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    /// MPEG layer-3 (`audio/mpeg`), the OpenAI default.
    Mp3,
    /// Opus in Ogg or CAF container (`audio/opus`).
    Opus,
    /// AAC (`audio/aac`).
    Aac,
    /// FLAC (`audio/flac`).
    Flac,
    /// WAV / RIFF (`audio/wav`). Raw PCM16 producers are wrapped to WAV by the clients.
    Wav,
    /// `.pcm` / raw s16le stream. Clients that produce raw PCM wrap it into WAV instead;
    /// this variant exists for completeness of the format negotiation.
    Pcm,
}

impl AudioFormat {
    /// Lowercase file/extension tag used for cache entries and format reporting.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            AudioFormat::Mp3 => "mp3",
            AudioFormat::Opus => "opus",
            AudioFormat::Aac => "aac",
            AudioFormat::Flac => "flac",
            AudioFormat::Wav => "wav",
            AudioFormat::Pcm => "pcm",
        }
    }

    /// Parse a `response_format` style string. Unknown values yield `None`.
    #[must_use]
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "mp3" | "mpeg" => Some(Self::Mp3),
            "opus" => Some(Self::Opus),
            "aac" => Some(Self::Aac),
            "flac" => Some(Self::Flac),
            "wav" | "wave" => Some(Self::Wav),
            "pcm" | "pcm16" | "lpcm" => Some(Self::Pcm),
            _ => None,
        }
    }
}

/// Per-call synthesis options. Provider support varies; unsupported fields are ignored
/// (each client documents what it maps).
#[derive(Debug, Clone, Default)]
pub struct SynthesizeOptions {
    /// Model id override. Falls back to the provider config's model, then the provider default.
    pub model: Option<String>,
    /// Speaking rate (1.0 = normal). Honored by OpenAI-compatible `speed`, VOICEVOX family,
    /// Player2 and MiniMax (`speed`).
    pub speed: Option<f32>,
    /// Pitch. Honored by VOICEVOX family (`pitchScale`); OpenAI has no pitch parameter.
    pub pitch: Option<f32>,
    /// Desired response format. OpenAI-compatible clients send it as `response_format`.
    pub response_format: Option<AudioFormat>,
    /// ElevenLabs `style` (0.0-1.0).
    pub style: Option<f32>,
    /// ElevenLabs `stability` (0.0-1.0).
    pub stability: Option<f32>,
    /// ElevenLabs `similarity_boost` (0.0-1.0).
    pub similarity_boost: Option<f32>,
    /// ElevenLabs `use_speaker_boost`.
    pub speaker_boost: Option<bool>,
    /// Voice `intonation` for the VOICEVOX family (`intonationScale`).
    pub intonation: Option<f32>,
    /// Voice `volume` for the VOICEVOX family (`volumeScale`) and MiniMax (`vol`).
    pub volume: Option<f32>,
    /// Provider-specific extra fields, passed through VERBATIM into the request.
    ///
    /// - OpenAI-compatible family: merged into the JSON body (wire-shaped keys).
    /// - unspeech proxy family: merged into the nested `extra_body` object (wire-shaped keys
    ///   — the unspeech server does NOT re-snake_case these; pass e.g. `region`,
    ///   `sample_rate`, `pitch`, `rate`, `volume` as your provider expects).
    /// - ElevenLabs: ignored (use the typed fields above).
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// A byte stream of (usually encoded) audio, as produced by a synthesizer.
///
/// The pipeline collects the whole stream before decoding (the output format is
/// only reliably known once the body is in hand, and the lip-sync tap needs the
/// decoded samples anyway). A 64 MiB cap guards against abusive providers.
pub type AudioStream = Pin<Box<dyn Stream<Item = Result<Bytes, SpeechError>> + Send>>;

/// Correlation id for one synthesized+played sentence.
pub type SentenceId = String;

/// Events emitted by [`crate::SpeechPipeline`] on its broadcast bus.
///
/// Mirrors `airi-core`'s `ChatEvent` pattern: one-way `tokio::sync::broadcast`,
/// Slint (or any consumer) pumps these on its own thread.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SpeechEvent {
    /// A sentence started playing (or would have, on the null/capture sink).
    Started {
        /// Caller-visible sentence id (also returned by `SpeechPipeline::speak`).
        sentence_id: SentenceId,
    },
    /// RMS amplitude of the last ~50 ms window, `0.0..=1.0`. Fires at ~15-40 Hz
    /// depending on sample rate (sample-aligned windows, not wall-clock).
    Amplitude {
        /// Clamped normalized level.
        level: f32,
    },
    /// Playback of the sentence finished naturally.
    Done {},
    /// The sentence was aborted (by `cancel_current` or a
    /// fresh `speak`, per AIRI barge-in semantics).
    Aborted {},
    /// Synthesis or playback failed. `sentence_id` is attached when known.
    Error {
        /// Failure message (provider body truncated to 512 chars where applicable).
        message: String,
    },
}
