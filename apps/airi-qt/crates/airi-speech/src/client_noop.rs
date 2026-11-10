// SPDX-License-Identifier: GPL-3.0-or-later

//! `speech-noop` synthesizer ("None"). Emits a valid empty WAV instead of touching
//! the network, mirroring the Vue provider's "no speech output" semantics.

use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};
use crate::wav::wav_from_pcm16;

/// No-op synthesizer for the `speech-noop` registry id.
pub struct NoopSynthesizer {
    id: String,
}

impl NoopSynthesizer {
    /// Create a noop synthesizer for `id`.
    #[must_use]
    pub fn new(id: String) -> Self {
        Self { id }
    }
}

#[async_trait::async_trait]
impl SpeechSynthesizer for NoopSynthesizer {
    fn id(&self) -> &str {
        &self.id
    }

    async fn synthesize(
        &self,
        _text: &str,
        _voice: &str,
        _options: &SynthesizeOptions,
    ) -> Result<AudioStream, crate::error::SpeechError> {
        // 44-byte WAV header, zero PCM data — decodes to an empty source which
        // completes playback immediately.
        let wav = wav_from_pcm16(&[], 24_000, 1);
        Ok(crate::client_common::one_shot(bytes::Bytes::from(wav)))
    }
}
