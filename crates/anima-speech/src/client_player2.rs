// SPDX-License-Identifier: GPL-3.0-or-later

//! Player2 localhost speech endpoint.
//!
//! Faithful port of `@xsai-ext/providers/special/create#createPlayer2`
//! (`node_modules/@xsai-ext/providers/dist/player2-D788vRq_.js`):
//!
//! - `POST {base}/tts/speak` with header `player2-game-key: <game_key>` (default `airi`
//!   in AIRI; `xsai` upstream)
//! - body `{ audio_format?, play_in_app: false, speed?, text, voice_ids: [voice] }`
//! - response `application/json` `{ "data": "<base64 audio/mpeg>" }` — decoded to bytes
//!
//! (`{base}` is the configured URL with any trailing slash; the default is
//! `http://localhost:4315/v1/` → `http://localhost:4315/v1/tts/speak`.)

use serde_json::{Map, Value};

use crate::client_common::{error_body, one_shot, url_join};
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};
use crate::wav::decode_base64;

/// Client for the Player2 local speech endpoint.
pub struct Player2Client {
    pub(crate) id: String,
    pub(crate) base_url: String,
    pub(crate) voice: String,
    pub(crate) game_key: String,
    pub(crate) extra: Map<String, Value>,
}

impl Player2Client {
    fn full_url(&self) -> String {
        url_join(&self.base_url, "tts/speak")
    }
}

#[async_trait::async_trait]
impl SpeechSynthesizer for Player2Client {
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
            self.voice.trim().to_string()
        } else {
            voice.trim().to_string()
        };

        let mut body = Map::new();
        if let Some(format) = options.response_format {
            body.insert("audio_format".into(), Value::String(format.as_str().into()));
        }
        body.insert("play_in_app".into(), Value::Bool(false));
        body.insert(
            "speed".into(),
            serde_json::Number::from_f64(f64::from(options.speed.unwrap_or(1.0)))
                .map_or(Value::Number(1.into()), Value::Number),
        );
        body.insert("text".into(), Value::String(text.to_string()));
        body.insert(
            "voice_ids".into(),
            Value::Array(if resolved_voice.is_empty() {
                Vec::new()
            } else {
                vec![Value::String(resolved_voice)]
            }),
        );
        // Verbatim passthrough (e.g. `audio_format` overrides live above; other fields pass here).
        for (key, value) in &self.extra {
            if key == "game_key"
                || key == "secret_access_key"
                || key == "region"
                || key == "extra_body"
                || key == "app_id"
            {
                continue;
            }
            body.entry(key.clone()).or_insert(value.clone());
        }
        for (key, value) in &options.extra {
            body.entry(key.clone()).or_insert(value.clone());
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let resp = client
            .post(self.full_url())
            .header("player2-game-key", &self.game_key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&Value::Object(body))
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = error_body(resp).await;
            return Err(SpeechError::Provider(format!(
                "{} answered {} for tts/speak: {body}",
                self.id,
                status.as_u16()
            )));
        }
        let payload: Value = resp.json().await.map_err(|err| {
            SpeechError::Provider(format!(
                "{} returned non-JSON from tts/speak: {err}",
                self.id
            ))
        })?;
        let data = payload.get("data").and_then(Value::as_str).ok_or_else(|| {
            SpeechError::Provider(format!("{} response missing string field `data`", self.id))
        })?;
        let bytes = decode_base64(data).ok_or_else(|| {
            SpeechError::Provider(format!("{} response `data` is not valid base64", self.id))
        })?;
        Ok(one_shot(bytes::Bytes::from(bytes)))
    }
}
