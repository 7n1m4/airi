// SPDX-License-Identifier: GPL-3.0-or-later

//! OpenRouter audio models.
//!
//! Port of the Vue registry entry (`openrouter-audio-speech`). OpenRouter does not expose
//! a plain `/audio/speech` for arbitrary audio models; the Vue app routes through
//! `chat/completions` with `modalities: ['text', 'audio']` and `stream: true`, then
//! concatenates the base64 PCM16 deltas and wraps them in a WAV header:
//!
//! - POST `{base}chat/completions` (`https://openrouter.ai/api/v1/`)
//! - headers `Authorization: Bearer`, `Content-Type: application/json`
//! - body `{model: model || 'openai/gpt-audio-mini',
//!          messages: [{role:'user', content: 'Read this text aloud exactly as written, without any commentary or extra words:\n\n{text}'}],
//!          modalities: ['text', 'audio'],
//!          audio: {voice: voice || 'alloy', format: 'pcm16'},
//!          stream: true}`
//! - SSE `data: {choices:[{delta:{audio:{data: "<base64>"}}}]}` → concat → PCM16 24 kHz mono → WAV
//!
//! This is intentionally minimal — it implements exactly what the Vue code does and no more.

use futures_util::StreamExt;
use serde_json::{Map, Value};

use crate::client_common::{error_body, one_shot, truncate, url_join};
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};
use crate::wav::{decode_base64, wav_from_pcm16};

/// Client for OpenRouter-hosted audio models.
pub struct OpenRouterAudioClient {
    pub(crate) id: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    pub(crate) voice: String,
    pub(crate) extra: Map<String, Value>,
}

impl OpenRouterAudioClient {
    fn full_url(&self) -> String {
        url_join(&self.base_url, "chat/completions")
    }
}

#[async_trait::async_trait]
impl SpeechSynthesizer for OpenRouterAudioClient {
    fn id(&self) -> &str {
        &self.id
    }

    async fn synthesize(
        &self,
        text: &str,
        voice: &str,
        options: &SynthesizeOptions,
    ) -> Result<AudioStream, SpeechError> {
        if text.trim().is_empty() {
            return Err(SpeechError::InvalidConfig(
                "cannot synthesize empty text".into(),
            ));
        }
        if self.api_key.trim().is_empty() {
            return Err(SpeechError::InvalidConfig(
                "API key required for OpenRouter".into(),
            ));
        }
        let resolved_voice = if voice.trim().is_empty() {
            if self.voice.trim().is_empty() {
                "alloy"
            } else {
                self.voice.trim()
            }
        } else {
            voice.trim()
        };
        let model = options
            .model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| self.model.clone());

        let mut body = serde_json::json!({
            "model": model,
            "messages": [
                { "role": "user", "content": format!("Read this text aloud exactly as written, without any commentary or extra words:\n\n{text}") },
            ],
            "modalities": ["text", "audio"],
            "audio": { "voice": resolved_voice, "format": "pcm16" },
            "stream": true,
        });
        if let Value::Object(map) = &mut body {
            for (key, value) in &self.extra {
                map.entry(key.clone()).or_insert(value.clone());
            }
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .build()?;

        let resp = client
            .post(self.full_url())
            .bearer_auth(&self.api_key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = error_body(resp).await;
            return Err(SpeechError::Provider(format!(
                "{} answered {} for chat/completions: {body}",
                self.id,
                status.as_u16()
            )));
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut base64_audio = String::new();

        let flush_line = |line: &str, sink: &mut String| {
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                return;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                return;
            }
            if let Ok(chunk) = serde_json::from_str::<Value>(data) {
                if let Some(audio) = chunk
                    .get("choices")
                    .and_then(Value::as_array)
                    .and_then(|c| c.first())
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("audio"))
                    .and_then(|a| a.get("data"))
                    .and_then(Value::as_str)
                {
                    sink.push_str(audio);
                }
            }
        };

        while let Some(item) = stream.next().await {
            let bytes = item.map_err(SpeechError::from)?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].to_string();
                buffer.drain(..=pos);
                flush_line(&line, &mut base64_audio);
            }
        }
        if !buffer.trim().is_empty() {
            flush_line(&buffer, &mut base64_audio);
        }

        if base64_audio.is_empty() {
            return Err(SpeechError::Provider(format!(
                "{} returned no audio deltas; tail of stream: {}",
                self.id,
                truncate(&buffer, 300)
            )));
        }
        let pcm = decode_base64(&base64_audio).ok_or_else(|| {
            SpeechError::Provider(format!("{} audio deltas are not valid base64", self.id))
        })?;
        let wav = wav_from_pcm16(&pcm, 24_000, 1);
        Ok(one_shot(bytes::Bytes::from(wav)))
    }
}
