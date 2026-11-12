// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! AIRI speech (TTS) crate — P5 lane.
//!
//! Port of the AIRI speech provider registry (`packages/stage-ui/src/stores/providers/registry/speech.ts`)
//! to Rust: provider-family clients, an LRU disk cache, and a rodio-based playback pipeline
//! with lip-sync amplitude events on a broadcast bus.
//!
//! - [`SpeechSynthesizer`]: the provider trait. Implementations are plain HTTP clients
//!   (plus one noop); there are no in-process/WASM adapters in this crate.
//! - [`build_tts_client`]: config → `Arc<dyn SpeechSynthesizer>`; [`TTS_PROVIDER_DEFS`]
//!   is the full registry catalog (26 ids) with per-provider port status.
//! - [`SpeechPipeline`]: text → synthesize (or cache) → decode → amplitude tap → sink,
//!   emitting [`SpeechEvent`]s (`Started` / `Amplitude` / `Done` / `Aborted` / `Error`).
//! - [`SpeechAudioCache`]: disk LRU (200 entries / 50 MB), keyed by
//!   `sha256(scope | model | voice | format | speed | pitch | text)`.
//! - [`list_output_devices`]: rodio/cpal output device names; the pipeline selects a
//!   device via [`RodioSinkFactory::new`] and falls back to the default.
//!
//! Layering: no Qt, no `airi-core`. The stage bridge (airi-slint) consumes `SpeechEvent`s
//! on its own thread — wire-up is a later integration step, not this crate's concern.
//!
//! Verification status is documented in `docs/phase-notes/p5-tts.md`.

mod cache;
mod client_common;
mod client_elevenlabs;
mod client_gemini;
mod client_kokoro;
mod client_mimo;
mod client_minimax;
mod client_noop;
mod client_openai;
mod client_openrouter;
mod client_player2;
mod client_polly;
mod client_unspeech;
mod client_voicevox;
mod config;
mod error;
mod pipeline;
mod player;
mod synth;
mod tap;
mod types;
mod wav;

pub use cache::{CachedAudio, SpeechAudioCache};
pub use client_kokoro::{KokoroConfig, KokoroSynthesizer, DEFAULT_VOICE, SAMPLE_RATE};
pub use config::{
    build_tts_client, build_tts_client_with_voice, find_tts_provider, tts_provider_ids,
    tts_provider_map, TtsProviderConfig, TtsProviderDef, TtsProviderKind, TtsStatus,
    TTS_PROVIDER_DEFS,
};
pub use error::SpeechError;
pub use pipeline::{CacheStats, SpeechPipeline};
pub use player::{list_output_devices, CaptureSinkFactory, RodioSinkFactory, SpeechSinkFactory};
pub use synth::SpeechSynthesizer;
pub use tap::{AmplitudeTap, BoxedSource};
pub use types::{AudioFormat, AudioStream, SentenceId, SpeechEvent, SynthesizeOptions};
pub use wav::wav_from_pcm16;
