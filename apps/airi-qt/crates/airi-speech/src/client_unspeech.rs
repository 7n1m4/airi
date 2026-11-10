// SPDX-License-Identifier: GPL-3.0-or-later

//! Unspeech proxy client (Azure/Microsoft, Deepgram, Alibaba, Volcengine).
//!
//! The AIRI frontend never talks to these providers natively; it points xsai's
//! `generateSpeech` at an `unspeech` instance (default public instance
//! `https://unspeech.hyp3r.link/v1/`) with a provider-prefixed model id
//! (`microsoft/v1`, `deepgram/aura-2`, `alibaba/cosyvoice-v2`, `volcengine/v1`).
//!
//! Wire body (observed via `node_modules/unspeech/dist/index.mjs` and
//! `node_modules/@xsai/generate-speech/dist/index.js`):
//!
//! ```json
//! {
//!   "model": "microsoft/v1",
//!   "input": "…",
//!   "voice": "Aria",
//!   "extra_body": { "region": "westus", "sample_rate": 24000 }
//! }
//! ```
//!
//! The unspeech server relays `extra_body` to the upstream provider unchanged; inner
//! keys are snake_case **as produced by the frontend's own `objCamelToSnake` call**.
//! Callers must therefore pass wire-shaped keys in `extra.extra_body` / `options.extra`
//! (e.g. `deployment_id`, `region`, `sample_rate`, `pitch`, `rate`, `volume`,
//! `lang`, `gender`, `voice`, `disable_ssml`, or volcengine's `app`/`user`/`audio`).
//!
//! Volcengine additionally nests `app: {appid, token}` — the Vue code builds it from
//! `config.app.appId` (required) and the API key as token. The Rust port mirrors that:
//! `api_key` is the token, `extra.app_id` is the AppID.
//!
//! If the hosted unspeech instance is not reachable / not desired, point `base_url` at a
//! self-hosted unspeech (`http://localhost:5933/v1/`) or set `extra.extra_body` for a
//! direct upstream shim. There is no client-side fallback to the native vendor APIs.

use serde_json::{Map, Value};

use crate::client_common::{byte_stream, error_body, url_join};
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};

/// Which unspeech upstream this instance fronts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnspeechBackend {
    Microsoft,
    /// Deepgram Aura (`deepgram/{model}`).
    Deepgram,
    /// Alibaba Cloud Model Studio / CosyVoice (`alibaba/{model}`).
    Alibaba,
    /// Volcengine / ByteDance speech (`volcengine/{model}`).
    Volcengine,
}

impl UnspeechBackend {
    /// Model id prefix used on the wire.
    #[must_use]
    pub fn model_prefix(self) -> &'static str {
        match self {
            UnspeechBackend::Microsoft => "microsoft",
            UnspeechBackend::Deepgram => "deepgram",
            UnspeechBackend::Alibaba => "alibaba",
            UnspeechBackend::Volcengine => "volcengine",
        }
    }
}

/// Client for an unspeech proxy instance.
pub struct UnspeechProxyClient {
    pub(crate) id: String,
    pub(crate) backend: UnspeechBackend,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    pub(crate) voice: String,
    pub(crate) extra: Map<String, Value>,
}

impl UnspeechProxyClient {
    fn build_extra_body(&self, options: &SynthesizeOptions) -> Map<String, Value> {
        // Config-level extra_body (deployment-shaped), then options-level passthrough,
        // then backend-derived defaults. Options win over config; explicit backend
        // derivation (volcengine app block) only fills gaps.
        let mut body = Map::new();

        if let Some(configured) = self.extra.get("extra_body").and_then(Value::as_object) {
            body.extend(configured.clone());
        }
        body.extend(options.extra.clone());

        for key in ["pitch", "rate", "sample_rate", "volume"] {
            // Promote top-level provider extras into extra_body when they speak unspeech's language.
            if let Some(value) = self.extra.get(key) {
                body.entry(key.to_string()).or_insert_with(|| value.clone());
            }
        }

        match self.backend {
            UnspeechBackend::Volcengine => {
                let app_id = self
                    .extra
                    .get("app_id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty());
                if let Some(app_id) = app_id {
                    let entry = body
                        .entry("app".to_string())
                        .or_insert_with(|| Value::Object(Map::new()));
                    if let Value::Object(app) = entry {
                        app.entry("appid".to_string())
                            .or_insert_with(|| Value::String(app_id.to_string()));
                        if !self.api_key.trim().is_empty() {
                            app.entry("token".to_string())
                                .or_insert_with(|| Value::String(self.api_key.clone()));
                        }
                    }
                }
            }
            UnspeechBackend::Microsoft => {
                for key in [
                    "deployment_id",
                    "region",
                    "sample_rate",
                    "lang",
                    "gender",
                    "voice",
                    "disable_ssml",
                ] {
                    if let Some(value) = self.extra.get(key) {
                        body.entry(key.to_string()).or_insert_with(|| value.clone());
                    }
                }
            }
            UnspeechBackend::Alibaba | UnspeechBackend::Deepgram => {}
        }

        body
    }

    fn full_url(&self) -> String {
        url_join(&self.base_url, "audio/speech")
    }
}

#[async_trait::async_trait]
impl SpeechSynthesizer for UnspeechProxyClient {
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
            return Err(SpeechError::InvalidConfig(format!(
                "API key required for unspeech proxy provider {}",
                self.id
            )));
        }
        if self.backend == UnspeechBackend::Volcengine
            && !self.extra.contains_key("app_id")
            && !self.extra.contains_key("extra_body")
        {
            return Err(SpeechError::InvalidConfig(
                "volcengine requires extra.app_id (the Volcengine AppID; config.app.appId in the Vue app)".into(),
            ));
        }

        let model = options
            .model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| self.model.clone());
        let prefixed_model = if model.starts_with(&format!("{}/", self.backend.model_prefix())) {
            model
        } else {
            format!("{}/{model}", self.backend.model_prefix())
        };

        let resolved_voice = if voice.trim().is_empty() {
            self.voice.trim()
        } else {
            voice.trim()
        };

        let mut body = Map::new();
        body.insert("model".into(), Value::String(prefixed_model));
        body.insert("input".into(), Value::String(text.to_string()));
        if !resolved_voice.is_empty() {
            body.insert("voice".into(), Value::String(resolved_voice.to_string()));
        }
        let extra_body = self.build_extra_body(options);
        if !extra_body.is_empty() {
            body.insert("extra_body".into(), Value::Object(extra_body));
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let resp = client
            .post(self.full_url())
            .bearer_auth(&self.api_key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&Value::Object(body))
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = error_body(resp).await;
            return Err(SpeechError::Provider(format!(
                "{} (unspeech) answered {} for audio/speech: {body}",
                self.id,
                status.as_u16()
            )));
        }
        Ok(byte_stream(resp.bytes_stream()))
    }
}
