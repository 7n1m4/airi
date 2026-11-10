// SPDX-License-Identifier: GPL-3.0-or-later

//! Deepgram streaming transcription over WebSocket.
//!
//! Endpoint: `wss://api.deepgram.com/v1/listen?model=nova-3&interim_results=true
//! &encoding=linear16&sample_rate=16000&channels=1`
//! Auth: `Authorization: Token <api_key>` header on the WS handshake.
//!
//! Audio is raw s16le mono PCM at 16 kHz in binary frames. Deepgram replies
//! with `Results` JSON messages; `is_final == false` yields [`SttEvent::Interim`],
//! `is_final == true` yields [`SttEvent::Final`]. `Metadata`, keepalive and
//! other message types are ignored. Sending `{"type":"CloseStream"}` (done by
//! [`SttStream::finish`]) asks the server to finish any in-flight utterance and
//! close; final events are still delivered until the server closes.
//!
//! The constructor errors when no API key is available — there is no
//! unauthenticated mode.

use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header;

use super::{spawn_ws_pump, stream_channels, PumpOutput, SttError, SttEvent, SttStream};

pub const DEFAULT_BASE_URL: &str = "wss://api.deepgram.com";
pub const DEFAULT_MODEL: &str = "nova-3";

/// Streaming Deepgram transcription client.
pub struct DeepgramStreamingClient {
    base_url: String,
    api_key: String,
    model: String,
    language: Option<String>,
}

impl std::fmt::Debug for DeepgramStreamingClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeepgramStreamingClient")
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("api_key_configured", &true)
            .finish_non_exhaustive()
    }
}

impl DeepgramStreamingClient {
    /// `api_key` must be non-empty — construction fails otherwise.
    pub fn new(api_key: Option<String>) -> Result<Self, SttError> {
        let api_key = api_key.filter(|k| !k.trim().is_empty()).ok_or_else(|| {
            SttError::Config("deepgram api_key must be configured (non-empty)".into())
        })?;
        Ok(Self {
            base_url: DEFAULT_BASE_URL.to_string(),
            api_key,
            model: DEFAULT_MODEL.to_string(),
            language: None,
        })
    }

    /// Override the WebSocket base URL (proxy/test setups).
    #[must_use]
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into().trim_end_matches('/').to_string();
        self
    }

    /// Override the model (default `nova-3`).
    #[must_use]
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    /// Set a BCP-47 language hint (`&language=` query param).
    #[must_use]
    pub fn with_language(mut self, language: impl Into<String>) -> Self {
        self.language = Some(language.into());
        self
    }

    /// The endpoint URL the next session will connect to (for diagnostics).
    #[must_use]
    pub fn listen_url(&self) -> String {
        let mut url = format!(
            "{}/v1/listen?model={}&interim_results=true&encoding=linear16&sample_rate=16000&channels=1",
            self.base_url, self.model
        );
        if let Some(language) = &self.language {
            url.push_str("&language=");
            url.push_str(language);
        }
        url
    }

    /// Open a streaming session. Returns the [`SttStream`] to push frames into.
    pub async fn connect(&self) -> Result<SttStream, SttError> {
        let mut request = self
            .listen_url()
            .into_client_request()
            .map_err(|e| SttError::Config(format!("invalid deepgram URL: {e}")))?;
        request.headers_mut().insert(
            header::AUTHORIZATION,
            header::HeaderValue::from_str(&format!("Token {}", self.api_key))
                .map_err(|e| SttError::Config(format!("invalid deepgram api_key header: {e}")))?,
        );

        let (ws, _response) = connect_async(request)
            .await
            .map_err(|e| SttError::WebSocket(format!("deepgram handshake failed: {e}")))?;

        let channels = stream_channels(false);
        let stream = spawn_ws_pump(
            ws,
            channels,
            super::WsPumpConfig {
                close_message: r#"{"type":"CloseStream"}"#.to_string(),
                parse: parse_deepgram_message,
                pre_text: None,
            },
        );
        Ok(stream)
    }
}

/// Parse one Deepgram server message. Pure; unit-tested.
pub(crate) fn parse_deepgram_message(text: &str) -> PumpOutput {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return PumpOutput {
            event: Some(SttEvent::Error {
                message: format!("unparseable deepgram message: {text:.200}"),
            }),
            ..PumpOutput::IGNORED
        };
    };

    match value.get("type").and_then(|t| t.as_str()) {
        Some("Results") => {
            let transcript = value
                .get("channel")
                .and_then(|c| c.get("alternatives"))
                .and_then(|a| a.get(0))
                .and_then(|a| a.get("transcript"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if transcript.is_empty() {
                return PumpOutput::IGNORED;
            }
            let is_final = value
                .get("is_final")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            PumpOutput {
                event: Some(if is_final {
                    SttEvent::Final { text: transcript }
                } else {
                    SttEvent::Interim { text: transcript }
                }),
                ..PumpOutput::IGNORED
            }
        }
        Some("Error") | Some("error") => {
            let message = value
                .get("message")
                .or_else(|| value.get("description"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown deepgram error")
                .to_string();
            PumpOutput {
                event: Some(SttEvent::Error { message }),
                ..PumpOutput::IGNORED
            }
        }
        // Metadata, SpeechStarted, UtteranceEnd, KeepAlive acks: not surfaced.
        _ => PumpOutput::IGNORED,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructor_requires_api_key() {
        assert!(DeepgramStreamingClient::new(None).is_err());
        assert!(DeepgramStreamingClient::new(Some(String::new())).is_err());
        assert!(DeepgramStreamingClient::new(Some("   ".to_string())).is_err());
        assert!(DeepgramStreamingClient::new(Some("dg-key".to_string())).is_ok());
    }

    #[test]
    fn listen_url_contains_expected_params() {
        let client = DeepgramStreamingClient::new(Some("dg-key".into())).unwrap();
        let url = client.listen_url();
        assert!(url.starts_with("wss://api.deepgram.com/v1/listen?model=nova-3"));
        assert!(url.contains("interim_results=true"));
        assert!(url.contains("encoding=linear16"));
        assert!(url.contains("sample_rate=16000"));
        assert!(url.contains("channels=1"));
        let with_lang = client.with_language("en-US");
        assert!(with_lang.listen_url().contains("language=en-US"));
    }

    #[test]
    fn parses_interim_result() {
        let msg = r#"{"type":"Results","channel":{"alternatives":[{"transcript":"hello"}]},"is_final":false}"#;
        let out = parse_deepgram_message(msg);
        assert_eq!(
            out.event,
            Some(SttEvent::Interim {
                text: "hello".into()
            })
        );
        assert!(!out.started && !out.completed);
    }

    #[test]
    fn parses_final_result() {
        let msg = r#"{"type":"Results","channel":{"alternatives":[{"transcript":"hello world"}]},"is_final":true,"speech_final":true}"#;
        let out = parse_deepgram_message(msg);
        assert_eq!(
            out.event,
            Some(SttEvent::Final {
                text: "hello world".into()
            })
        );
    }

    #[test]
    fn empty_transcript_is_ignored() {
        let msg =
            r#"{"type":"Results","channel":{"alternatives":[{"transcript":""}]},"is_final":true}"#;
        assert_eq!(parse_deepgram_message(msg).event, None);
    }

    #[test]
    fn metadata_is_ignored() {
        let msg = r#"{"type":"Metadata","request_id":"abc"}"#;
        assert_eq!(parse_deepgram_message(msg).event, None);
    }

    #[test]
    fn error_message_is_forwarded() {
        let msg = r#"{"type":"Error","message":"invalid credentials"}"#;
        let out = parse_deepgram_message(msg);
        assert_eq!(
            out.event,
            Some(SttEvent::Error {
                message: "invalid credentials".into()
            })
        );
    }

    #[test]
    fn garbage_message_becomes_error_event() {
        let out = parse_deepgram_message("not json");
        assert!(matches!(out.event, Some(SttEvent::Error { .. })));
    }
}
