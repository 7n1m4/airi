// SPDX-License-Identifier: GPL-3.0-or-later

//! ElevenLabs native text-to-speech client.
//!
//! Faithful port of `packages/stage-ui/src/stores/providers/elevenlabs/native.ts`:
//! `POST {base}/text-to-speech/{voiceId}` with `xi-api-key` header; body `{text, model_id,
//! voice_settings:{stability, similarity_boost, style?, use_speaker_boost?}}`; response
//! `audio/mpeg` (chunked). The `elevenlabs/` model prefix is stripped, matching the Vue code.

use serde_json::{json, Map, Value};

use crate::client_common::{byte_stream, error_body, url_join};
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};

/// Client for ElevenLabs' native `/text-to-speech/{voice_id}` endpoint.
pub struct ElevenLabsClient {
    pub(crate) id: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    pub(crate) voice: String,
    /// Provider-level defaults (`voice_settings` as a nested object, if present).
    pub(crate) extra: Map<String, Value>,
}

impl ElevenLabsClient {
    fn voice_settings(&self, options: &SynthesizeOptions) -> Value {
        // Priority (Vue): per-request options > provider-level config > hardcoded defaults.
        let provider_vs = self
            .extra
            .get("voiceSettings")
            .or_else(|| self.extra.get("voice_settings"));

        let provider_stability = provider_vs
            .and_then(|v| v.get("stability"))
            .and_then(Value::as_f64);
        let provider_similarity = provider_vs
            .and_then(|v| {
                v.get("similarityBoost")
                    .or_else(|| v.get("similarity_boost"))
            })
            .and_then(Value::as_f64);
        let provider_style = provider_vs
            .and_then(|v| v.get("style"))
            .and_then(Value::as_f64);
        let provider_boost = provider_vs
            .and_then(|v| {
                v.get("useSpeakerBoost")
                    .or_else(|| v.get("use_speaker_boost"))
            })
            .and_then(Value::as_bool);

        let stability = options
            .stability
            .map(f64::from)
            .or(provider_stability)
            .unwrap_or(0.5);
        let similarity_boost = options
            .similarity_boost
            .map(f64::from)
            .or(provider_similarity)
            .unwrap_or(0.75);
        let style = options.style.map(f64::from).or(provider_style);
        let boost = options.speaker_boost.or(provider_boost);

        let mut vs = Map::new();
        vs.insert(
            "stability".into(),
            serde_json::Number::from_f64(stability).map_or(Value::Null, Value::Number),
        );
        vs.insert(
            "similarity_boost".into(),
            serde_json::Number::from_f64(similarity_boost).map_or(Value::Null, Value::Number),
        );
        if let Some(style) = style {
            vs.insert(
                "style".into(),
                serde_json::Number::from_f64(style).map_or(Value::Null, Value::Number),
            );
        }
        if let Some(boost) = boost {
            vs.insert("use_speaker_boost".into(), Value::Bool(boost));
        }
        Value::Object(vs)
    }

    fn full_url(&self, voice_id: &str) -> String {
        // Vue: `${baseUrl}/text-to-speech/${encodeURIComponent(voiceId)}`
        let encoded = urlencoding_path_segment(voice_id);
        url_join(&self.base_url, &format!("text-to-speech/{encoded}"))
    }
}

fn urlencoding_path_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(byte));
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[async_trait::async_trait]
impl SpeechSynthesizer for ElevenLabsClient {
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
            self.voice.trim()
        } else {
            voice.trim()
        };
        if resolved_voice.is_empty() {
            return Err(SpeechError::InvalidConfig(
                "ElevenLabs requires a voice id (config.voice or the per-call voice)".into(),
            ));
        }
        if self.api_key.trim().is_empty() {
            return Err(SpeechError::InvalidConfig(
                "API key required for ElevenLabs (xi-api-key)".into(),
            ));
        }

        let model = options
            .model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| self.model.clone());
        let model_id = model
            .strip_prefix("elevenlabs/")
            .unwrap_or(&model)
            .to_string();

        let body = json!({
            "text": text,
            "model_id": model_id,
            "voice_settings": self.voice_settings(options),
        });

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let resp = client
            .post(self.full_url(resolved_voice))
            .header("xi-api-key", &self.api_key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::ACCEPT, "audio/mpeg")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = error_body(resp).await;
            return Err(SpeechError::Provider(format!(
                "{} answered {} for text-to-speech: {body}",
                self.id,
                status.as_u16()
            )));
        }
        Ok(byte_stream(resp.bytes_stream()))
    }
}
