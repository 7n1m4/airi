// SPDX-License-Identifier: GPL-3.0-or-later

//! Google Gemini native text-to-speech.
//!
//! Port of the Vue registry entry (`google-gemini-audio-speech`):
//! `POST {base}models/{model}:generateContent` with header `x-goog-api-key`;
//! body `{contents: [{parts: [{text}]}], generationConfig: {responseModalities: ["AUDIO"],
//! speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName}}}}}`
//! (optional `temperature`).
//!
//! Response: `candidates[0].content.parts[].inlineData.data` — base64 **PCM16 24 kHz mono**,
//! wrapped here into a WAV container (the Vue app does the same via `toWavFromPCM16`).
//!
//! Note (faithful-but-narrower): the Vue code can fall back to the Gemini *chat* provider's
//! API key when no dedicated key is configured; the Rust port requires the dedicated key
//! (cross-provider secret fallback is a store concern, not a client concern).

use serde_json::{json, Map, Value};

use crate::client_common::{error_body, one_shot, url_join};
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};
use crate::wav::{decode_base64, wav_from_pcm16};

/// Client for Gemini's native `generateContent` audio modality.
pub struct GeminiTtsClient {
    pub(crate) id: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    pub(crate) voice: String,
    pub(crate) extra: Map<String, Value>,
}

impl GeminiTtsClient {
    fn full_url(&self, model: &str) -> String {
        // Vue: new URL(`models/${targetModel}:generateContent`, baseUrl)
        url_join(&self.base_url, &format!("models/{model}:generateContent"))
    }
}

#[async_trait::async_trait]
impl SpeechSynthesizer for GeminiTtsClient {
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
                "missing input text for Gemini TTS".into(),
            ));
        }
        let resolved_voice = if voice.trim().is_empty() {
            if self.voice.trim().is_empty() {
                "Kore"
            } else {
                self.voice.trim()
            }
        } else {
            voice.trim()
        };
        if self.api_key.trim().is_empty() {
            return Err(SpeechError::InvalidConfig(
                "API key required for Gemini TTS".into(),
            ));
        }
        let model = options
            .model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| self.model.clone());

        let mut generation_config = Map::new();
        generation_config.insert(
            "responseModalities".into(),
            Value::Array(vec![Value::String("AUDIO".into())]),
        );
        generation_config.insert(
            "speechConfig".into(),
            json!({ "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": resolved_voice } } }),
        );
        if let Some(temperature) = self.extra.get("temperature").and_then(Value::as_f64) {
            generation_config.insert(
                "temperature".into(),
                serde_json::Number::from_f64(temperature).map_or(Value::Null, Value::Number),
            );
        }
        if let Some(temperature) = options.extra.get("temperature").and_then(Value::as_f64) {
            generation_config.insert(
                "temperature".into(),
                serde_json::Number::from_f64(temperature).map_or(Value::Null, Value::Number),
            );
        }

        let body = json!({
            "contents": [{ "parts": [{ "text": text }] }],
            "generationConfig": Value::Object(generation_config),
        });

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let resp = client
            .post(self.full_url(&model))
            .header("x-goog-api-key", &self.api_key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = error_body(resp).await;
            return Err(SpeechError::Provider(format!(
                "{} answered {} for generateContent: {body}",
                self.id,
                status.as_u16()
            )));
        }
        let payload: Value = resp.json().await.map_err(|err| {
            SpeechError::Provider(format!(
                "{} returned non-JSON from generateContent: {err}",
                self.id
            ))
        })?;
        let audio_base64 = payload
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|c| c.first())
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(Value::as_array)
            .and_then(|parts| {
                parts.iter().find_map(|part| {
                    part.get("inlineData")
                        .or_else(|| part.get("inline_data"))
                        .and_then(|d| d.get("data"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
            })
            .ok_or_else(|| {
                SpeechError::Provider(format!(
                    "{} response missing candidates[0].content.parts[].inlineData.data",
                    self.id
                ))
            })?;
        let pcm = decode_base64(&audio_base64).ok_or_else(|| {
            SpeechError::Provider(format!("{} inlineData.data is not valid base64", self.id))
        })?;
        // PCM16 24 kHz mono → WAV (matches the Vue app's toWavFromPCM16(pcmBytes, 24000)).
        let wav = wav_from_pcm16(&pcm, 24_000, 1);
        Ok(one_shot(bytes::Bytes::from(wav)))
    }
}
