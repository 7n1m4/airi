// SPDX-License-Identifier: GPL-3.0-or-later

//! Shared HTTP helpers for the provider clients.

use futures_util::StreamExt;

use crate::error::SpeechError;
use crate::types::AudioStream;

/// Join `path` onto `base` with `new URL(path, base)` semantics (WHATWG):
/// a trailing slash is ensured on `base`, then the relative path is resolved.
/// `path` must not start with `/` (that would drop `base`'s prefix, matching `new URL`).
#[must_use]
pub fn url_join(base: &str, path: &str) -> String {
    let base = base.trim();
    let with_slash = if base.ends_with('/') {
        base.to_string()
    } else {
        format!("{base}/")
    };
    // WHATWG drops the last segment of base for relative paths unless base ends with '/'.
    format!("{with_slash}{path}")
}

/// Wrap a single in-memory buffer as a one-shot [`AudioStream`].
pub fn one_shot(bytes: bytes::Bytes) -> AudioStream {
    Box::pin(futures_util::stream::once(async move { Ok(bytes) }))
}

/// Convert a reqwest byte stream into an [`AudioStream`].
pub fn byte_stream(
    stream: impl futures_util::Stream<Item = reqwest::Result<bytes::Bytes>> + Send + 'static,
) -> AudioStream {
    Box::pin(stream.map(|chunk| chunk.map_err(SpeechError::from)))
}

/// Collect an [`AudioStream`] into memory, enforcing a size cap.
///
/// # Errors
/// [`SpeechError::Provider`] when the cap is exceeded; transport errors propagate.
pub async fn collect_stream(stream: AudioStream, cap_bytes: usize) -> Result<Vec<u8>, SpeechError> {
    let mut out = Vec::new();
    futures_util::pin_mut!(stream);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if out.len() + chunk.len() > cap_bytes {
            return Err(SpeechError::Provider(format!(
                "audio payload exceeds the {cap_bytes} byte cap"
            )));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// Read an error body, truncated for inclusion in [`SpeechError::Provider`].
pub async fn error_body(resp: reqwest::Response) -> String {
    match resp.text().await {
        Ok(text) => truncate(text.trim(), 512),
        Err(_) => "<unreadable body>".to_string(),
    }
}

/// Truncate to `max` chars (not bytes) on a char boundary.
#[must_use]
pub fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    text.chars().take(max).collect::<String>() + "…"
}

/// Detect the container of an encoded audio payload from its magic bytes.
/// Best-effort; falls back to `None` (caller decides how to handle).
#[must_use]
pub fn sniff_format(bytes: &[u8]) -> Option<crate::types::AudioFormat> {
    use crate::types::AudioFormat;
    if bytes.len() >= 3
        && (&bytes[..3] == b"ID3" || (bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0))
    {
        return Some(AudioFormat::Mp3);
    }
    if bytes.len() >= 12 && &bytes[8..12] == b"WAVE" {
        return Some(AudioFormat::Wav);
    }
    if bytes.len() >= 4 && &bytes[..4] == b"fLaC" {
        return Some(AudioFormat::Flac);
    }
    if bytes.len() >= 4 && &bytes[..4] == b"OggS" {
        return Some(AudioFormat::Opus);
    }
    None
}
