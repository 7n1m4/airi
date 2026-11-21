// SPDX-License-Identifier: GPL-3.0-or-later

//! MiniMax Speech (`POST {base}/v1/t2a_v2`).
//!
//! Port of the Vue registry entry (`minimax-speech`). The Vue code requests
//! `stream: true` and hex-decodes audio chunks from SSE events whose `status !== 2`:
//!
//! ```text
//! data: {"data": {"audio": "<hex mp3 bytes>", "status": 1}, …}
//! data: {"data": {"audio": "", "status": 2}, …}
//! ```
//!
//! The Rust client requests the same stream, parses the SSE lines, concatenates every
//! hex `audio` fragment and returns the resulting MP3 bytes as a single payload
//! (like every other client; incremental playback is a pipeline concern).

use futures_util::StreamExt;
use serde_json::{Map, Value};

use crate::client_common::{error_body, one_shot, truncate};
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};
use crate::wav::decode_hex;

/// Client for MiniMax's native t2a_v2 speech endpoint.
pub struct MinimaxClient {
    pub(crate) id: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    pub(crate) voice: String,
    pub(crate) extra: Map<String, Value>,
}

impl MinimaxClient {
    fn full_url(&self) -> String {
        let base = self.base_url.trim().trim_end_matches('/');
        format!("{base}/t2a_v2")
    }
}

#[async_trait::async_trait]
impl SpeechSynthesizer for MinimaxClient {
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
                "English_Graceful_Lady"
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

        let speed = options.speed.unwrap_or(1.0);
        let vol = options.volume.unwrap_or(1.0);
        // MiniMax pitch is integer-ish; clamp instead of failing.
        let pitch = options.pitch.unwrap_or(0.0);

        let mut body = serde_json::json!({
            "model": model,
            "text": text,
            "stream": true,
            "voice_setting": {
                "voice_id": resolved_voice,
                "speed": speed,
                "vol": vol,
                "pitch": pitch,
            },
            "audio_setting": {
                "sample_rate": 32000,
                "bitrate": 128000,
                "format": "mp3",
                "channel": 1,
            },
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
            .bearer_auth(&self.api_key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = error_body(resp).await;
            return Err(SpeechError::Provider(format!(
                "{} answered {} for t2a_v2: {body}",
                self.id,
                status.as_u16()
            )));
        }

        // Collect the SSE stream and hex-decode the audio fragments (status != 2),
        // exactly like `readSSEAudioStream(response, event => …, 'audio/mpeg')`.
        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut chunks: Vec<u8> = Vec::new();

        let flush_line = |line: &str, chunks: &mut Vec<u8>| {
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                return;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                return;
            }
            if let Ok(event) = serde_json::from_str::<Value>(data) {
                let payload = event.get("data");
                let status = payload
                    .and_then(|d| d.get("status"))
                    .and_then(Value::as_i64);
                let audio = payload.and_then(|d| d.get("audio")).and_then(Value::as_str);
                if let (Some(audio), Some(status)) = (audio, status) {
                    if status != 2 {
                        if let Some(bytes) = decode_hex(audio) {
                            chunks.extend_from_slice(&bytes);
                        }
                    }
                }
            }
        };

        while let Some(item) = stream.next().await {
            let bytes = item.map_err(SpeechError::from)?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].to_string();
                buffer.drain(..=pos);
                flush_line(&line, &mut chunks);
            }
        }
        if !buffer.trim().is_empty() {
            flush_line(&buffer, &mut chunks);
        }

        if chunks.is_empty() {
            return Err(SpeechError::Provider(format!(
                "{} returned no audio chunks (SSE stream was empty or malformed): {}",
                self.id,
                truncate(&buffer, 300)
            )));
        }
        Ok(one_shot(bytes::Bytes::from(chunks)))
    }
}
