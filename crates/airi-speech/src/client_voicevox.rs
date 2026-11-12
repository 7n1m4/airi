// SPDX-License-Identifier: GPL-3.0-or-later

//! VOICEVOX-family localhost engines: VOICEVOX (:50021) and AivisSpeech (:10101).
//!
//! Faithful port of `packages/stage-ui/src/stores/providers/voicevox/engine.ts`.
//! Two-step HTTP contract (all plain JSON POSTs):
//!
//! 1. `POST {base}audio_query?speaker={styleId}&text={text}` → audio query JSON
//!    (intonationScale, pitchScale, speedScale, volumeScale + engine fields)
//! 2. `POST {base}synthesis?speaker={styleId}` with the (parameter-adjusted) audio
//!    query JSON as body → WAV bytes.
//!
//! Base URL defaults carry a trailing slash; query strings are URL-encoded.

use serde_json::{Map, Value};

use crate::client_common::{error_body, one_shot, truncate, url_join};
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};

/// Client for VOICEVOX-compatible engines (VOICEVOX, AivisSpeech).
pub struct VoicevoxClient {
    pub(crate) id: String,
    pub(crate) family_name: String,
    pub(crate) base_url: String,
    pub(crate) voice: String,
    pub(crate) extra: Map<String, Value>,
}

impl VoicevoxClient {
    fn endpoint(&self, path: &str, params: &[(&str, &str)]) -> String {
        let joined = url_join(&self.base_url, path);
        if params.is_empty() {
            return joined;
        }
        let query = params
            .iter()
            .map(|(key, value)| format!("{}={}", query_encode(key), query_encode(value)))
            .collect::<Vec<_>>()
            .join("&");
        format!("{joined}?{query}")
    }

    fn provider_params(&self) -> (f64, f64, f64, f64) {
        // Vue defaults: voiceSettings { intonation: 1, pitch: 0, speed: 1, volume: 1 }
        let settings = self
            .extra
            .get("voiceSettings")
            .or_else(|| self.extra.get("voice_settings"))
            .and_then(Value::as_object);
        let get = |key: &str| settings.and_then(|s| s.get(key)).and_then(Value::as_f64);
        let intonation = get("intonation").unwrap_or(1.0);
        let pitch = get("pitch").unwrap_or(0.0);
        let speed = get("speed").unwrap_or(1.0);
        let volume = get("volume").unwrap_or(1.0);
        (intonation, pitch, speed, volume)
    }

    fn apply_parameters(&self, query: &mut Value, options: &SynthesizeOptions) {
        let (intonation, pitch, speed, volume) = self.provider_params();
        let speed = options.speed.map_or(speed, f64::from);
        let pitch = options.pitch.map_or(pitch, f64::from);
        let intonation = options.intonation.map_or(intonation, f64::from);
        let volume = options.volume.map_or(volume, f64::from);

        if let Value::Object(map) = query {
            set_number(map, "speedScale", speed);
            set_number(map, "pitchScale", pitch);
            set_number(map, "intonationScale", intonation);
            set_number(map, "volumeScale", volume);
        }
    }
}

fn set_number(map: &mut Map<String, Value>, key: &str, value: f64) {
    map.insert(
        key.to_string(),
        serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number),
    );
}

fn query_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
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
impl SpeechSynthesizer for VoicevoxClient {
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
        let style_id = if voice.trim().is_empty() {
            self.voice.trim()
        } else {
            voice.trim()
        };
        if style_id.is_empty() {
            return Err(SpeechError::InvalidConfig(format!(
                "{} requires a style id (speaker) — pass it as the voice argument",
                self.family_name
            )));
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let query_url = self.endpoint("audio_query", &[("speaker", style_id), ("text", text)]);
        let query_resp = client
            .post(&query_url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .send()
            .await?;
        let status = query_resp.status();
        if !status.is_success() {
            let body = error_body(query_resp).await;
            return Err(SpeechError::Provider(format!(
                "{} answered {} for audio_query: {body}",
                self.family_name,
                status.as_u16()
            )));
        }
        let raw_query = query_resp.text().await.map_err(SpeechError::from)?;
        let mut audio_query: Value = serde_json::from_str(&raw_query).map_err(|_err| {
            SpeechError::Provider(format!(
                "Speech engine answered /audio_query with a body that is not JSON: {}",
                truncate(&raw_query, 200)
            ))
        })?;
        self.apply_parameters(&mut audio_query, options);

        let synthesis_url = self.endpoint("synthesis", &[("speaker", style_id)]);
        let synth_resp = client
            .post(&synthesis_url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&audio_query)
            .send()
            .await?;
        let status = synth_resp.status();
        if !status.is_success() {
            let body = error_body(synth_resp).await;
            return Err(SpeechError::Provider(format!(
                "{} answered {} for synthesis: {body}",
                self.family_name,
                status.as_u16()
            )));
        }
        let bytes = synth_resp.bytes().await.map_err(SpeechError::from)?;
        Ok(one_shot(bytes))
    }
}
