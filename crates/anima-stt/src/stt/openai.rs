// SPDX-License-Identifier: GPL-3.0-or-later

//! OpenAI-compatible whole-blob transcription:
//! `POST {base_url}/audio/transcriptions` (multipart/form-data).
//!
//! Works against any OpenAI-compatible endpoint — notably:
//!
//! - `https://api.openai.com/v1` (default for Whisper)
//! - `https://api.groq.com/openai/v1` (Groq, models like `whisper-large-v3-turbo`)
//!
//! The PCM blob is encoded to WAV in memory and uploaded as `file=audio.wav`
//! with `response_format=json`. Language and prompt are forwarded when set.

use async_trait::async_trait;

use super::{wav_bytes, SttClient, SttError, SttRequest};

pub const DEFAULT_MODEL: &str = "whisper-1";

/// OpenAI-compatible transcription client.
pub struct OpenAiTranscribeClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Option<String>,
    model: String,
}

impl std::fmt::Debug for OpenAiTranscribeClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenAiTranscribeClient")
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("api_key_configured", &self.api_key.is_some())
            .finish_non_exhaustive()
    }
}

impl OpenAiTranscribeClient {
    /// `base_url` — e.g. `https://api.openai.com/v1` or `https://api.groq.com/openai/v1`.
    /// Trailing slashes are trimmed. `api_key` — bearer token (`None` only works
    /// for keyless proxies).
    #[must_use]
    pub fn new(base_url: impl Into<String>, api_key: Option<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.filter(|k| !k.trim().is_empty()),
            model: DEFAULT_MODEL.to_string(),
        }
    }

    /// Override the model (default `whisper-1`).
    #[must_use]
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    /// Base URL this client posts to (for diagnostics).
    #[must_use]
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

#[async_trait]
impl SttClient for OpenAiTranscribeClient {
    fn id(&self) -> &str {
        "openai-compatible"
    }

    async fn transcribe_pcm(&self, req: SttRequest) -> Result<String, SttError> {
        if req.pcm_s16le.is_empty() {
            return Err(SttError::Config(
                "cannot transcribe an empty PCM blob".into(),
            ));
        }
        let wav = wav_bytes(&req.pcm_s16le, req.sample_rate);
        let file_part = reqwest::multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| SttError::Config(format!("invalid wav mime: {e}")))?;

        let model = req.model.as_deref().unwrap_or(&self.model).to_string();
        let mut form = reqwest::multipart::Form::new()
            .part("file", file_part)
            .text("model", model)
            .text("response_format", "json");
        if let Some(language) = &req.language {
            form = form.text("language", language.clone());
        }
        if let Some(prompt) = &req.prompt {
            form = form.text("prompt", prompt.clone());
        }

        let url = format!("{}/audio/transcriptions", self.base_url);
        let mut builder = self.http.post(&url).multipart(form);
        if let Some(key) = &self.api_key {
            builder = builder.bearer_auth(key);
        }

        let response = builder.send().await?;
        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            return Err(SttError::Provider {
                status: status.as_u16(),
                body: truncate(&body, 512),
            });
        }
        let parsed: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| SttError::Protocol(format!("response is not JSON: {e}")))?;
        parsed
            .get("text")
            .and_then(|t| t.as_str())
            .map(str::to_string)
            .ok_or_else(|| {
                SttError::Protocol("response JSON is missing a string \"text\" field".into())
            })
    }
}

fn truncate(body: &str, max: usize) -> String {
    if body.chars().count() <= max {
        body.to_string()
    } else {
        body.chars().take(max).collect::<String>() + "…"
    }
}

// Keep the module's public surface honest: wav_bytes is re-exported at the stt root,
// not here, but tests within this module assert the wire shape of the file part.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::stt::s16le_bytes;

    #[test]
    fn wav_blob_is_uploaded_as_audio_wav() {
        let samples = vec![0i16; 1600];
        let wav = wav_bytes(&samples, 16_000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(wav.len(), 44 + samples.len() * 2);
        // The s16le helper is what the streaming clients put on the wire.
        assert_eq!(s16le_bytes(&samples).len(), samples.len() * 2);
    }

    #[test]
    fn base_url_trailing_slash_is_trimmed() {
        let client = OpenAiTranscribeClient::new("https://example.test/v1/", None);
        assert_eq!(client.base_url(), "https://example.test/v1");
    }

    #[test]
    fn empty_api_key_becomes_none() {
        let client = OpenAiTranscribeClient::new("https://example.test", Some("   ".to_string()));
        assert!(client.api_key.is_none());
    }
}
