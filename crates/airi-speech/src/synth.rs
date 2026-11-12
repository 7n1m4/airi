// SPDX-License-Identifier: GPL-3.0-or-later

//! The canonical speech provider trait.

use crate::error::SpeechError;
use crate::types::{AudioStream, SynthesizeOptions};

/// Text-to-speech client. Mirrors the plan's `SpeechSynthesizer`:
///
/// `async fn synthesize(&self, text, voice, options) -> Result<AudioStream, SpeechError>`.
///
/// Implementations must be cheap to call: no global mutable state, no network I/O
/// outside of `synthesize`. Registry clients constructed via
/// [`crate::build_tts_client`] share these semantics.
#[async_trait::async_trait]
pub trait SpeechSynthesizer: Send + Sync {
    /// The registry id this instance was built for (e.g. `elevenlabs`).
    fn id(&self) -> &str;

    /// Synthesize `text` with `voice`.
    ///
    /// - `voice == ""` means "use the provider default voice".
    /// - The returned stream yields raw bytes of the provider's audio container
    ///   (mp3/wav/opus/pcm-wrapped-wav …). Consumers collect the stream; see
    ///   [`crate::SpeechPipeline`].
    async fn synthesize(
        &self,
        text: &str,
        voice: &str,
        options: &SynthesizeOptions,
    ) -> Result<AudioStream, SpeechError>;
}
