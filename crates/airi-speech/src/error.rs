// SPDX-License-Identifier: GPL-3.0-or-later

//! Speech error type shared by all clients, the pipeline and the cache.

/// Error type for speech synthesis, playback and caching.
#[derive(Debug, thiserror::Error)]
pub enum SpeechError {
    /// I/O or transport failure talking to the provider.
    #[error("transport error: {0}")]
    Transport(#[from] reqwest::Error),
    /// Invalid or incomplete provider configuration.
    #[error("invalid config: {0}")]
    InvalidConfig(String),
    /// Provider is registered in the catalog but not ported to Rust.
    #[error("unsupported provider: {0}")]
    UnsupportedProvider(String),
    /// The provider returned a non-success status or an undecodable payload.
    #[error("provider error: {0}")]
    Provider(String),
    /// Decoding the returned audio bytes failed.
    #[error("decode error: {0}")]
    Decode(String),
    /// Audio playback (output device) failed.
    #[error("playback error: {0}")]
    Playback(String),
    /// Cache I/O failure (best-effort caches report this, callers may ignore it).
    #[error("cache error: {0}")]
    Cache(String),
}

impl From<std::io::Error> for SpeechError {
    fn from(err: std::io::Error) -> Self {
        SpeechError::Cache(format!("io: {err}"))
    }
}
