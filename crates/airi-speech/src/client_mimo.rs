// SPDX-License-Identifier: GPL-3.0-or-later

//! Xiaomi MiMo audio speech.
//!
//! Port of the Vue registry entry (`mimo-audio-speech`):
//! `POST {base}chat/completions` with header `api-key: <key>` (NOT Bearer); body
//! `{model, messages: [{role:'user', content:'Synthesize speech'}, {role:'assistant', content: input}],
//!    audio: {voice, format: 'wav'}}`.
//! Response: `{choices: [{message: {audio: {data: "<base64 wav>"}}}]}`.

use serde_json::{Map, Value};

use crate::client_common::{error_body, one_shot, url_join};
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};
use crate::wav::decode_base64;

/// Client for the Xiaomi MiMo chat-completions-with-audio endpoint.
pub struct MimoAudioClient {
    pub(crate) id: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    pub(crate) voice: String,
    pub(crate) extra: Map<String, Value>,
}

impl MimoAudioClient {
    fn full_url(&self) -> String {
        url_join(&self.base_url, "chat/completions")
    }
}

#[async_trait::async_trait]
impl SpeechSynthesizer for MimoAudioClient {
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
        let resolved_voice = if voice.trim().is_empty() {
            if self.voice.trim().is_empty() {
                "mimo_default"
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

        let audio_format = options
            .response_format
            .map(|f| f.as_str().to_string())
            .unwrap_or_else(|| "wav".to_string());

        let mut body = serde_json::json!({
            "model": model,
            "messages": [
                { "role": "user", "content": "Synthesize speech" },
                { "role": "assistant", "content": text },
            ],
            "audio": { "voice": resolved_voice, "format": audio_format },
        });
        if let Value::Object(map) = &mut body {
            for (key, value) in &self.extra {
                map.entry(key.clone()).or_insert(value.clone());
            }
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let resp = client
            .post(self.full_url())
            .header("api-key", &self.api_key)
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
        let payload: Value = resp.json().await.map_err(|err| {
            SpeechError::Provider(format!(
                "{} returned non-JSON from chat/completions: {err}",
                self.id
            ))
        })?;
        let audio_base64 = payload
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|c| c.first())
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("audio"))
            .and_then(|a| a.get("data"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                SpeechError::Provider(format!(
                    "{} response missing choices[0].message.audio.data",
                    self.id
                ))
            })?;
        let bytes = decode_base64(audio_base64).ok_or_else(|| {
            SpeechError::Provider(format!("{} audio.data is not valid base64", self.id))
        })?;
        Ok(one_shot(bytes::Bytes::from(bytes)))
    }
}
