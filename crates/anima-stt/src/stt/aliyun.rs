// SPDX-License-Identifier: GPL-3.0-or-later

//! Aliyun NLS realtime speech transcription over WebSocket.
//!
//! Ported from `packages/stage-ui/src/stores/providers/aliyun/`
//! (`index.ts`, `stream-transcription.ts`, `utils.ts`). Protocol:
//!
//! 1. `wss://nls-gateway-<region>.aliyuncs.com/ws/v1?token=<token>`
//!    (internal regions: `wss://nls-gateway-<region>-internal.aliyuncs.com:80/ws/v1?token=...`)
//! 2. Send `{"header":{…,"namespace":"SpeechTranscriber","name":"StartTranscription"},
//!    "payload":{"format":"pcm","sample_rate":16000, …}}`
//! 3. Stream s16le mono PCM binary frames.
//! 4. Server emits `TranscriptionStarted` → client may send audio;
//!    `TranscriptionResultChanged` (interim, only when
//!    `enable_intermediate_result`) → [`SttEvent::Interim`];
//!    `SentenceEnd` → [`SttEvent::Final`] with `payload.result`;
//!    `TranscriptionCompleted` (answer to `StopTranscription`) ends the session.
//! 5. `{"header":{…,"name":"StopTranscription"}}` — sent by [`SttStream::finish`].
//!
//! **Token acquisition is out of scope.** Aliyun issues NLS tokens via a
//! signed `CreateToken` call against `nls-meta.<region>.aliyuncs.com` using
//! AK/SK HMAC-SHA1 (see `token.ts`, unit-tested against a fixed vector).
//! This crate expects a **pre-issued token** in [`AliyunNlsConfig::token`] —
//! obtain it from the same token service, a proxy, or the Alibaba console.
//! Do not configure raw AK/SK here.

use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

use super::{spawn_ws_pump, stream_channels, PumpOutput, SttError, SttEvent, SttStream};

/// Default region.
pub const DEFAULT_REGION: &str = "cn-shanghai";

/// Parsed region → NLS WebSocket endpoint (`utils.ts: nlsWebSocketEndpointFromRegion`).
///
/// Public for tests and diagnostics. Internal regions map to the `:80`
/// `-internal.aliyuncs.com` host, matching the TypeScript implementation.
#[must_use]
pub fn parse_aliyun_ws_url(region: &str) -> String {
    match region {
        "cn-shanghai" | "cn-beijing" | "cn-shenzhen" => {
            format!("wss://nls-gateway-{region}.aliyuncs.com/ws/v1")
        }
        "cn-shanghai-internal" | "cn-beijing-internal" | "cn-shenzhen-internal" => {
            format!("wss://nls-gateway-{region}.aliyuncs.com:80/ws/v1")
        }
        // Unknown regions: keep the public pattern and let the server reject.
        other => format!("wss://nls-gateway-{other}.aliyuncs.com/ws/v1"),
    }
}

/// Regions accepted by [`parse_aliyun_ws_url`] (public + internal).
pub const REGIONS: [&str; 6] = [
    "cn-shanghai",
    "cn-beijing",
    "cn-shenzhen",
    "cn-shanghai-internal",
    "cn-beijing-internal",
    "cn-shenzhen-internal",
];

/// Aliyun NLS session configuration. `token` is pre-issued; see module docs.
#[derive(Debug, Clone, PartialEq)]
pub struct AliyunNlsConfig {
    /// Region key, e.g. `"cn-shanghai"`. Unknown regions fall back to the
    /// public `nls-gateway-<region>.aliyuncs.com` pattern.
    pub region: String,
    /// Aliyun NLS app key from the console.
    pub app_key: String,
    /// Pre-issued NLS token (constellation of AK/SK NOT supported — see docs).
    pub token: String,
    /// Request interim results (`TranscriptionResultChanged`). Default true.
    pub enable_intermediate_result: bool,
    /// Silence duration (ms) that closes a sentence; Aliyun range 200–2000,
    /// default 800 when `None`.
    pub max_sentence_silence_ms: Option<u32>,
    /// Enable punctuation post-processing (default true).
    pub enable_punctuation_prediction: bool,
    /// Enable inverse text normalization (Chinese numerals → digits), default true.
    pub enable_inverse_text_normalization: bool,
}

impl Default for AliyunNlsConfig {
    fn default() -> Self {
        Self {
            region: DEFAULT_REGION.to_string(),
            app_key: String::new(),
            token: String::new(),
            enable_intermediate_result: true,
            max_sentence_silence_ms: None,
            enable_punctuation_prediction: true,
            enable_inverse_text_normalization: true,
        }
    }
}

/// Streaming Aliyun NLS transcription client.
pub struct AliyunNlsClient {
    config: AliyunNlsConfig,
}

impl std::fmt::Debug for AliyunNlsClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AliyunNlsClient")
            .field("region", &self.config.region)
            .field("app_key_configured", &!self.config.app_key.is_empty())
            .field("token_configured", &!self.config.token.is_empty())
            .finish_non_exhaustive()
    }
}

impl AliyunNlsClient {
    pub fn new(config: AliyunNlsConfig) -> Result<Self, SttError> {
        if config.app_key.trim().is_empty() {
            return Err(SttError::Config(
                "aliyun NLS app_key must be configured".into(),
            ));
        }
        if config.token.trim().is_empty() {
            return Err(SttError::Config(
                "aliyun NLS token must be configured (pre-issued; AK/SK exchange is out of scope, see README)".into(),
            ));
        }
        if let Some(ms) = config.max_sentence_silence_ms {
            if !(200..=2000).contains(&ms) {
                return Err(SttError::Config(format!(
                    "max_sentence_silence_ms must be within 200..=2000, got {ms}"
                )));
            }
        }
        Ok(Self { config })
    }

    /// The WebSocket URL (without the token query param) this client connects to.
    #[must_use]
    pub fn ws_url(&self) -> String {
        parse_aliyun_ws_url(&self.config.region)
    }

    /// Full handshake URL including the token (used internally and in tests).
    #[must_use]
    pub fn handshake_url(&self) -> String {
        format!("{}?token={}", self.ws_url(), self.config.token)
    }

    /// The `StartTranscription` payload sent on connect.
    #[must_use]
    pub fn start_payload(&self, task_id: &str, message_id: &str) -> serde_json::Value {
        let mut payload = serde_json::json!({
            "format": "pcm",
            "sample_rate": 16000,
            "enable_intermediate_result": self.config.enable_intermediate_result,
            "enable_punctuation_prediction": self.config.enable_punctuation_prediction,
            "enable_inverse_text_normalization": self.config.enable_inverse_text_normalization,
        });
        if let Some(ms) = self.config.max_sentence_silence_ms {
            payload["max_sentence_silence"] = serde_json::json!(ms);
        }
        serde_json::json!({
            "header": {
                "appkey": self.config.app_key,
                "message_id": message_id,
                "task_id": task_id,
                "namespace": "SpeechTranscriber",
                "name": "StartTranscription",
            },
            "payload": payload,
        })
    }

    /// The `StopTranscription` payload sent on finish.
    #[must_use]
    pub fn stop_payload(&self, task_id: &str, message_id: &str) -> serde_json::Value {
        serde_json::json!({
            "header": {
                "appkey": self.config.app_key,
                "message_id": message_id,
                "task_id": task_id,
                "namespace": "SpeechTranscriber",
                "name": "StopTranscription",
            },
        })
    }

    /// Open a streaming session. Returns the [`SttStream`] to push frames into.
    /// Audio sent before `TranscriptionStarted` is held back by the writer task.
    pub async fn connect(&self) -> Result<SttStream, SttError> {
        let task_id = nls_message_id();
        let start_message = self.start_payload(&task_id, &nls_message_id()).to_string();
        let stop_message = self.stop_payload(&task_id, &nls_message_id()).to_string();

        let request = self
            .handshake_url()
            .into_client_request()
            .map_err(|e| SttError::Config(format!("invalid aliyun NLS URL: {e}")))?;

        let (ws, _response) = connect_async(request)
            .await
            .map_err(|e| SttError::WebSocket(format!("aliyun NLS handshake failed: {e}")))?;

        let channels = stream_channels(true);
        let stream = spawn_ws_pump(
            ws,
            channels,
            super::WsPumpConfig {
                close_message: stop_message,
                parse: parse_aliyun_message,
                pre_text: Some(start_message),
            },
        );
        Ok(stream)
    }
}

/// 32-char lowercase hex identifier (Aliyun requires exact 32-hex message ids).
/// Derived by hashing high-resolution timestamp, a process-local counter and the
/// pid with SHA-256 — unique enough for NLS session/message correlation.
pub fn nls_message_id() -> String {
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let mut hasher = Sha256::new();
    hasher.update(nanos.to_le_bytes());
    hasher.update(counter.to_le_bytes());
    hasher.update(pid.to_le_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(32);
    for byte in &digest[..16] {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Parse one Aliyun server message. Pure; unit-tested against the payload
/// shapes from `index.ts` (`ServerEvent`).
pub(crate) fn parse_aliyun_message(text: &str) -> PumpOutput {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return PumpOutput {
            event: Some(SttEvent::Error {
                message: format!("unparseable aliyun NLS message: {text:.200}"),
            }),
            ..PumpOutput::IGNORED
        };
    };

    let header = value.get("header");
    let name = header
        .and_then(|h| h.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("");
    let status = header
        .and_then(|h| h.get("status"))
        .and_then(|s| s.as_u64());

    // Any non-20000000 status is an error frame (e.g. invalid token, throttling).
    if let Some(status) = status {
        if status != 20_000_000 {
            let message = header
                .and_then(|h| h.get("status_message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown aliyun NLS error")
                .to_string();
            return PumpOutput {
                event: Some(SttEvent::Error {
                    message: format!("aliyun NLS status {status}: {message}"),
                }),
                ..PumpOutput::IGNORED
            };
        }
    }

    match name {
        "TranscriptionStarted" => PumpOutput {
            started: true,
            ..PumpOutput::IGNORED
        },
        "TranscriptionResultChanged" => {
            let result = value
                .get("payload")
                .and_then(|p| p.get("result"))
                .and_then(|r| r.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if result.is_empty() {
                return PumpOutput::IGNORED;
            }
            PumpOutput {
                event: Some(SttEvent::Interim { text: result }),
                ..PumpOutput::IGNORED
            }
        }
        "SentenceEnd" => {
            let result = value
                .get("payload")
                .and_then(|p| p.get("result"))
                .and_then(|r| r.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            PumpOutput {
                event: Some(SttEvent::Final { text: result }),
                ..PumpOutput::IGNORED
            }
        }
        "TranscriptionCompleted" => PumpOutput {
            completed: true,
            ..PumpOutput::IGNORED
        },
        // SentenceBegin, others: not surfaced.
        _ => PumpOutput::IGNORED,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_url_matches_typescript_mapping() {
        assert_eq!(
            parse_aliyun_ws_url("cn-shanghai"),
            "wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1"
        );
        assert_eq!(
            parse_aliyun_ws_url("cn-beijing"),
            "wss://nls-gateway-cn-beijing.aliyuncs.com/ws/v1"
        );
        assert_eq!(
            parse_aliyun_ws_url("cn-shenzhen"),
            "wss://nls-gateway-cn-shenzhen.aliyuncs.com/ws/v1"
        );
        assert_eq!(
            parse_aliyun_ws_url("cn-shanghai-internal"),
            "wss://nls-gateway-cn-shanghai-internal.aliyuncs.com:80/ws/v1"
        );
        assert_eq!(
            parse_aliyun_ws_url("cn-beijing-internal"),
            "wss://nls-gateway-cn-beijing-internal.aliyuncs.com:80/ws/v1"
        );
        assert_eq!(
            parse_aliyun_ws_url("cn-shenzhen-internal"),
            "wss://nls-gateway-cn-shenzhen-internal.aliyuncs.com:80/ws/v1"
        );
    }

    #[test]
    fn constructor_requires_app_key_and_token() {
        assert!(AliyunNlsClient::new(AliyunNlsConfig::default()).is_err());
        let app_only = AliyunNlsConfig {
            app_key: "ak-app".to_string(),
            ..Default::default()
        };
        assert!(AliyunNlsClient::new(app_only.clone()).is_err());
        let with_token = AliyunNlsConfig {
            token: "tok".to_string(),
            ..app_only
        };
        assert!(AliyunNlsClient::new(with_token).is_ok());
    }

    #[test]
    fn constructor_validates_max_sentence_silence_range() {
        let base = AliyunNlsConfig {
            app_key: "app".into(),
            token: "tok".into(),
            ..Default::default()
        };
        let mut cfg = base.clone();
        cfg.max_sentence_silence_ms = Some(199);
        assert!(AliyunNlsClient::new(cfg).is_err());
        let mut cfg = base.clone();
        cfg.max_sentence_silence_ms = Some(2000);
        assert!(AliyunNlsClient::new(cfg).is_ok());
        let mut cfg = base;
        cfg.max_sentence_silence_ms = Some(2001);
        assert!(AliyunNlsClient::new(cfg).is_err());
    }

    #[test]
    fn start_payload_matches_typescript_shape() {
        let cfg = AliyunNlsConfig {
            region: "cn-shanghai".into(),
            app_key: "my-app".into(),
            token: "my-token".into(),
            enable_intermediate_result: true,
            max_sentence_silence_ms: Some(800),
            enable_punctuation_prediction: true,
            enable_inverse_text_normalization: true,
        };
        let client = AliyunNlsClient::new(cfg).unwrap();
        let payload = client.start_payload("task123", "msg123");
        assert_eq!(payload["header"]["appkey"], "my-app");
        assert_eq!(payload["header"]["namespace"], "SpeechTranscriber");
        assert_eq!(payload["header"]["name"], "StartTranscription");
        assert_eq!(payload["header"]["task_id"], "task123");
        assert_eq!(payload["header"]["message_id"], "msg123");
        assert_eq!(payload["payload"]["format"], "pcm");
        assert_eq!(payload["payload"]["sample_rate"], 16000);
        assert_eq!(payload["payload"]["enable_intermediate_result"], true);
        assert_eq!(payload["payload"]["max_sentence_silence"], 800);

        let stop = client.stop_payload("task123", "msg124");
        assert_eq!(stop["header"]["name"], "StopTranscription");
        assert!(stop.get("payload").is_none());
    }

    #[test]
    fn nls_message_id_is_32_hex() {
        let id = nls_message_id();
        assert_eq!(id.len(), 32);
        assert!(id
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(nls_message_id(), id);
    }

    #[test]
    fn parses_transcription_started() {
        let msg = r#"{"header":{"appkey":"a","message_id":"m","task_id":"t","namespace":"SpeechTranscriber","name":"TranscriptionStarted","status":20000000,"status_message":"GATEWAY"},"payload":{"session_id":"s"}}"#;
        let out = parse_aliyun_message(msg);
        assert!(out.started);
        assert_eq!(out.event, None);
    }

    #[test]
    fn parses_interim_result_changed() {
        let msg = r#"{"header":{"namespace":"SpeechTranscriber","name":"TranscriptionResultChanged","status":20000000},"payload":{"index":1,"time":800,"result":"你好","status":20000000}}"#;
        let out = parse_aliyun_message(msg);
        assert_eq!(
            out.event,
            Some(SttEvent::Interim {
                text: "你好".into()
            })
        );
    }

    #[test]
    fn parses_sentence_end_as_final() {
        let msg = r#"{"header":{"namespace":"SpeechTranscriber","name":"SentenceEnd","status":20000000},"payload":{"index":1,"time":1500,"begin_time":0,"result":"你好世界","confidence":0.98,"status":20000000}}"#;
        let out = parse_aliyun_message(msg);
        assert_eq!(
            out.event,
            Some(SttEvent::Final {
                text: "你好世界".into()
            })
        );
    }

    #[test]
    fn parses_transcription_completed() {
        let msg = r#"{"header":{"namespace":"SpeechTranscriber","name":"TranscriptionCompleted","status":20000000},"payload":{}}"#;
        assert!(parse_aliyun_message(msg).completed);
    }

    #[test]
    fn error_status_is_forwarded() {
        let msg = r#"{"header":{"namespace":"SpeechTranscriber","name":"SentenceEnd","status":40000001,"status_message":"INVALID_TOKEN"},"payload":{}}"#;
        let out = parse_aliyun_message(msg);
        assert!(
            matches!(out.event, Some(SttEvent::Error { ref message }) if message.contains("40000001"))
        );
    }

    #[test]
    fn sentence_begin_is_ignored() {
        let msg = r#"{"header":{"namespace":"SpeechTranscriber","name":"SentenceBegin","status":20000000},"payload":{"index":1,"time":0}}"#;
        assert_eq!(parse_aliyun_message(msg).event, None);
    }
}
