// SPDX-License-Identifier: GPL-3.0-or-later

//! OpenAI-compatible `POST {base}/audio/speech` client.
//!
//! Port of the xsai `generateSpeech` path used by the Vue registry for:
//! `openai-audio-speech`, `openai-compatible-audio-speech`, `comet-api-speech`,
//! `xai-audio-speech`, `airi-audio-server`, `chatterbox`, `index-tts-vllm`
//! (Index-TTS really is called through this path by the Vue code —
//! `{base}/tts/audio/speech` — there is no `/synthesize` in the repo or manifest).
//!
//! Body: `{ model, input, voice, speed?, response_format?, ...extra }`.
//! Headers: `Authorization: Bearer <key>` when a key is present.
//! Response: raw audio bytes (mp3 by default on OpenAI; whatever the server sends otherwise).

use serde_json::{Map, Value};

use crate::client_common::{byte_stream, error_body, url_join};
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};

/// Client for the OpenAI-compatible speech endpoint.
pub struct OpenAiCompatibleClient {
    pub(crate) id: String,
    pub(crate) base_url: String,
    pub(crate) api_key: Option<String>,
    pub(crate) model: String,
    pub(crate) voice: String,
    pub(crate) extra: Map<String, Value>,
}

impl OpenAiCompatibleClient {
    fn full_url(&self) -> String {
        url_join(&self.base_url, "audio/speech")
    }

    fn build_body(&self, text: &str, voice: &str, options: &SynthesizeOptions) -> Value {
        let model = options
            .model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| self.model.clone());

        let mut body = Map::new();
        body.insert("model".into(), Value::String(model));
        body.insert("input".into(), Value::String(text.to_string()));
        let resolved_voice = if voice.trim().is_empty() {
            self.voice.trim()
        } else {
            voice.trim()
        };
        if !resolved_voice.is_empty() {
            body.insert("voice".into(), Value::String(resolved_voice.to_string()));
        }
        if let Some(speed) = options.speed {
            body.insert(
                "speed".into(),
                serde_json::Number::from_f64(f64::from(speed)).map_or(Value::Null, Value::Number),
            );
        }
        if let Some(format) = options.response_format {
            body.insert(
                "response_format".into(),
                Value::String(format.as_str().into()),
            );
        }
        // Verbatim passthrough for provider-specific wire fields (e.g. `instructions`,
        // `language`, custom voice params). Explicit typed fields always win.
        for (key, value) in &self.extra {
            if key == "extra" || key == "game_key" || key == "secret_access_key" || key == "region"
            {
                continue;
            }
            body.entry(key.clone()).or_insert(value.clone());
        }
        for (key, value) in &options.extra {
            body.entry(key.clone()).or_insert(value.clone());
        }
        Value::Object(body)
    }
}

#[async_trait::async_trait]
impl SpeechSynthesizer for OpenAiCompatibleClient {
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

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let mut request = client
            .post(self.full_url())
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&self.build_body(text, voice, options));
        if let Some(key) = &self.api_key {
            request = request.bearer_auth(key);
        }

        let resp = request.send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = error_body(resp).await;
            return Err(SpeechError::Provider(format!(
                "{} answered {} for audio/speech: {body}",
                self.id,
                status.as_u16()
            )));
        }
        Ok(byte_stream(resp.bytes_stream()))
    }
}
