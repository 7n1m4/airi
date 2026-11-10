// SPDX-License-Identifier: GPL-3.0-or-later

//! Static catalog of every speech provider id in the AIRI port manifest
//! (`apps/airi-qt/docs/port-manifest/speech.md`) plus the builder that turns a
//! [`TtsProviderConfig`] into a boxed [`SpeechSynthesizer`].
//!
//! The catalog mirrors the Vue registry's `speech.ts` metadata: base URLs, default
//! models and credential requirements are the ones the frontend ships. Wire-shape
//! fidelity per family is documented on each def and in the phase note.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::client_elevenlabs::ElevenLabsClient;
use crate::client_gemini::GeminiTtsClient;
use crate::client_mimo::MimoAudioClient;
use crate::client_minimax::MinimaxClient;
use crate::client_openai::OpenAiCompatibleClient;
use crate::client_openrouter::OpenRouterAudioClient;
use crate::client_player2::Player2Client;
use crate::client_polly::PollyClient;
use crate::client_unspeech::{UnspeechBackend, UnspeechProxyClient};
use crate::client_voicevox::VoicevoxClient;
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;

/// Provider family / wire-shape selector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TtsProviderKind {
    /// `POST {base}/audio/speech`, `Authorization: Bearer` — the xsai `generateSpeech` shape.
    OpenAiCompatible,
    /// ElevenLabs native `POST /v1/text-to-speech/{voiceId}`.
    ElevenLabsNative,
    /// OpenAI-compatible via the unspeech proxy with provider-prefixed model ids
    /// (`microsoft/…`, `deepgram/…`, `alibaba/…`, `volcengine/…`) and a nested `extra_body`.
    UnspeechProxy(UnspeechBackend),
    /// VOICEVOX-family two-step `audio_query` → `synthesis` (VOICEVOX, AivisSpeech).
    VoicevoxFamily,
    /// Player2 local endpoint (`POST {base}/tts/speak`, JSON `{data: base64}` response).
    Player2,
    /// MiniMax native `POST {base}/t2a_v2` with hex-audio SSE stream.
    Minimax,
    /// Xiaomi MiMo chat-completions-with-audio.
    MimoAudio,
    /// Google Gemini native `generateContent` with `responseModalities: ["AUDIO"]`.
    GeminiNative,
    /// OpenRouter `chat/completions` streaming audio deltas (PCM16, wrapped to WAV).
    OpenRouterAudio,
    /// AWS Polly `POST https://polly.{region}.amazonaws.com/v1/speech` with SigV4.
    Polly,
    /// In-process Kokoro-82M ONNX inference (P9 lane 3). No network at inference time.
    KokoroLocal,
    /// Registered but intentionally not ported (see phase note); builds to a stub error.
    Unsupported,
    /// AIRI `speech-noop` ("None"): synthesizes an empty WAV, no network.
    Noop,
}

/// Free-form runtime configuration for one provider instance.
///
/// Mirrors the plan's `TtsProviderConfig { id, kind, api_key?, base_url?, model?, voice?, extra }`.
#[derive(Debug, Clone, Default)]
pub struct TtsProviderConfig {
    /// Registry id (e.g. `openai-audio-speech`). Selects the family + defaults when `kind` is `None`.
    pub id: String,
    /// Explicit family override. When `None`, the family is looked up from `id`.
    pub kind: Option<TtsProviderKind>,
    /// API key. Transport/meaning is family-specific (Bearer for OpenAI-compatible,
    /// `xi-api-key` for ElevenLabs native, `api-key` for MiMo, SigV4 access key id for Polly…).
    pub api_key: Option<String>,
    /// Base URL override. Falls back to the registry default for `id`.
    pub base_url: Option<String>,
    /// Model override. Falls back to the config/request, then the registry default.
    pub model: Option<String>,
    /// Voice override. Falls back to the per-call voice argument.
    pub voice: Option<String>,
    /// Free-form provider extras (region, secret access key, `extra_body`, voice settings…).
    /// Keys are family-specific; see each client.
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Static metadata for one registry id (base URL, default model, whether credentials are required).
#[derive(Debug, Clone)]
pub struct TtsProviderDef {
    /// Registry id.
    pub id: &'static str,
    /// Human name.
    pub name: &'static str,
    /// Provider family.
    pub kind: TtsProviderKind,
    /// Default base URL (empty when the family needs none / unsupported).
    pub default_base_url: &'static str,
    /// Default model id.
    pub default_model: &'static str,
    /// Default voice id.
    pub default_voice: &'static str,
    /// Whether an API key is required to use the provider.
    pub requires_api_key: bool,
    /// Port status.
    pub status: TtsStatus,
    /// Short note on wire-shape fidelity or why the provider is unsupported.
    pub note: &'static str,
}

/// Port status of a registry id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TtsStatus {
    /// HTTP wire shape ported faithfully from the Vue sources in this repo.
    Ported,
    /// Portable parts implemented; behavior inferred where the repo does not document the wire shape.
    Partial,
    /// In-process/WASM adapter or Vue-only composition; cannot be ported as an HTTP client.
    Unsupported,
}

/// The complete catalog — every id from the Vue speech registry (26 ids; the plan said 27,
/// the registry in this repo defines 26).
pub const TTS_PROVIDER_DEFS: &[TtsProviderDef] = &[
    TtsProviderDef { id: "speech-noop", name: "None", kind: TtsProviderKind::Noop, default_base_url: "", default_model: "noop", default_voice: "", requires_api_key: false, status: TtsStatus::Ported, note: "Empty WAV; plays silence. Matches the Vue noop semantics (empty buffer)." },
    TtsProviderDef { id: "virtual-audio-studio", name: "Audio Studio (Virtual)", kind: TtsProviderKind::Unsupported, default_base_url: "", default_model: "virtual", default_voice: "", requires_api_key: false, status: TtsStatus::Unsupported, note: "Vue-only composition over other engines with JS premium FX; no HTTP contract exists." },
    TtsProviderDef { id: "kokoro-local", name: "Kokoro TTS", kind: TtsProviderKind::KokoroLocal, default_base_url: "", default_model: "kokoro", default_voice: "af_heart", requires_api_key: false, status: TtsStatus::Partial, note: "In-process ONNX Runtime inference; G2P via espeak-ng when a binary is reachable (env AIRI_QT_ESPEAK or a standard location), rule-based fallback otherwise. Model + voices fetched on first run; never committed." },
    TtsProviderDef { id: "moss-nano-local", name: "Moss TTS (Nano)", kind: TtsProviderKind::Unsupported, default_base_url: "", default_model: "moss-tts-nano-100m", default_voice: "", requires_api_key: false, status: TtsStatus::Unsupported, note: "In-process adapter (getMossAdapterInstance), not an HTTP service." },
    TtsProviderDef { id: "pocket-tts-local", name: "Pocket TTS (Kyutai Local)", kind: TtsProviderKind::Unsupported, default_base_url: "", default_model: "english_2026-04", default_voice: "", requires_api_key: false, status: TtsStatus::Unsupported, note: "In-process adapter (getPocketTtsAdapterInstance), not an HTTP service." },
    TtsProviderDef { id: "ming3-local", name: "Ming 3.0 TTS", kind: TtsProviderKind::Unsupported, default_base_url: "", default_model: "ming3", default_voice: "", requires_api_key: false, status: TtsStatus::Unsupported, note: "In-process WASM adapter (getMing3AdapterInstance), not an HTTP service." },
    TtsProviderDef { id: "airi-audio-server", name: "AIRI Audio Server", kind: TtsProviderKind::OpenAiCompatible, default_base_url: "http://127.0.0.1:8095/v1/", default_model: "omnivoice-tts", default_voice: "", requires_api_key: false, status: TtsStatus::Ported, note: "OpenAI-compatible; the Vue registry points createOpenAI at it identically." },
    TtsProviderDef { id: "chatterbox", name: "Chatterbox (Legacy)", kind: TtsProviderKind::OpenAiCompatible, default_base_url: "http://127.0.0.1:8095/v1/", default_model: "omnivoice-tts", default_voice: "", requires_api_key: false, status: TtsStatus::Ported, note: "Legacy alias of AIRI Audio Server (same default base URL)." },
    TtsProviderDef { id: "openai-audio-speech", name: "OpenAI", kind: TtsProviderKind::OpenAiCompatible, default_base_url: "https://api.openai.com/v1/", default_model: "tts-1", default_voice: "alloy", requires_api_key: true, status: TtsStatus::Ported, note: "POST /audio/speech; speed sent when set; response_format sent when set." },
    TtsProviderDef { id: "openai-compatible-audio-speech", name: "OpenAI Compatible", kind: TtsProviderKind::OpenAiCompatible, default_base_url: "", default_model: "tts-1", default_voice: "alloy", requires_api_key: false, status: TtsStatus::Ported, note: "BYO endpoint; no default base URL (required)." },
    TtsProviderDef { id: "comet-api-speech", name: "CometAPI Speech", kind: TtsProviderKind::OpenAiCompatible, default_base_url: "https://api.cometapi.com/v1/", default_model: "tts-1", default_voice: "alloy", requires_api_key: true, status: TtsStatus::Ported, note: "OpenAI-compatible hosted gateway." },
    TtsProviderDef { id: "xai-audio-speech", name: "xAI", kind: TtsProviderKind::OpenAiCompatible, default_base_url: "https://api.x.ai/v1/", default_model: "grok-2-tts", default_voice: "Ara", requires_api_key: true, status: TtsStatus::Ported, note: "xAI has no model selection; grok-2-tts is the Vue-listed model id." },
    TtsProviderDef { id: "index-tts-vllm", name: "Index-TTS by Bilibili", kind: TtsProviderKind::OpenAiCompatible, default_base_url: "http://localhost:11996/tts/", default_model: "IndexTTS-1.5", default_voice: "", requires_api_key: false, status: TtsStatus::Ported, note: "Vue calls xsai generateSpeech against {base}/tts/ → POST localhost:11996/tts/audio/speech. There is NO /synthesize endpoint anywhere in this repo; the Control Center label was not verifiable. Voices at GET {base}/audio/voices." },
    TtsProviderDef { id: "elevenlabs", name: "ElevenLabs", kind: TtsProviderKind::ElevenLabsNative, default_base_url: "https://api.elevenlabs.io/v1/", default_model: "eleven_multilingual_v2", default_voice: "", requires_api_key: true, status: TtsStatus::Ported, note: "Native API (xi-api-key); voice id in URL path; voice_settings mapped from options." },
    TtsProviderDef { id: "microsoft-speech", name: "Microsoft / Azure Speech", kind: TtsProviderKind::UnspeechProxy(UnspeechBackend::Microsoft), default_base_url: "https://unspeech.hyp3r.link/v1/", default_model: "v1", default_voice: "", requires_api_key: true, status: TtsStatus::Ported, note: "unspeech proxy; model microsoft/{model}; extra_body: deployment_id/region/sample_rate/(lang,gender,voice|disable_ssml)." },
    TtsProviderDef { id: "deepgram-tts", name: "Deepgram", kind: TtsProviderKind::UnspeechProxy(UnspeechBackend::Deepgram), default_base_url: "https://unspeech.hyp3r.link/v1/", default_model: "aura-2", default_voice: "", requires_api_key: true, status: TtsStatus::Ported, note: "unspeech proxy; model deepgram/{model}." },
    TtsProviderDef { id: "alibaba-cloud-model-studio", name: "Alibaba Cloud Model Studio", kind: TtsProviderKind::UnspeechProxy(UnspeechBackend::Alibaba), default_base_url: "https://unspeech.hyp3r.link/v1/", default_model: "cosyvoice-v2", default_voice: "", requires_api_key: true, status: TtsStatus::Ported, note: "unspeech proxy; model alibaba/{model}; extra_body: pitch/rate/sample_rate/volume." },
    TtsProviderDef { id: "volcengine", name: "Volcengine", kind: TtsProviderKind::UnspeechProxy(UnspeechBackend::Volcengine), default_base_url: "https://unspeech.hyp3r.link/v1/", default_model: "v1", default_voice: "", requires_api_key: true, status: TtsStatus::Ported, note: "unspeech proxy; model volcengine/{model}; extra_body {app:{appid,token},user?,audio?}; requires extra.app_id (Vue: config.app.appId)." },
    TtsProviderDef { id: "voicevox", name: "VOICEVOX", kind: TtsProviderKind::VoicevoxFamily, default_base_url: "http://localhost:50021/", default_model: "default", default_voice: "", requires_api_key: false, status: TtsStatus::Ported, note: "Two-step audio_query → synthesis; speed/pitch/intonation/volume mapped to *Scale fields." },
    TtsProviderDef { id: "aivis-speech", name: "AivisSpeech", kind: TtsProviderKind::VoicevoxFamily, default_base_url: "http://localhost:10101/", default_model: "default", default_voice: "", requires_api_key: false, status: TtsStatus::Ported, note: "Identical VOICEVOX-family contract on port 10101." },
    TtsProviderDef { id: "player2-speech", name: "Player2 Speech", kind: TtsProviderKind::Player2, default_base_url: "http://localhost:4315/v1/", default_model: "player2-tts", default_voice: "", requires_api_key: false, status: TtsStatus::Ported, note: "Vue uses @xsai-ext createPlayer2: POST {base}/tts/speak, body {audio_format?, play_in_app:false, speed?, text, voice_ids:[voice]}, response JSON {data: base64}. game_key header defaults to 'airi'." },
    TtsProviderDef { id: "minimax-speech", name: "MiniMax Speech", kind: TtsProviderKind::Minimax, default_base_url: "https://api.minimax.io", default_model: "speech-2.8-hd", default_voice: "English_Graceful_Lady", requires_api_key: true, status: TtsStatus::Ported, note: "POST /v1/t2a_v2 stream:true; hex audio in SSE events (status != 2); mp3 out; music yields 32 kHz mono." },
    TtsProviderDef { id: "mimo-audio-speech", name: "Xiaomi MiMo", kind: TtsProviderKind::MimoAudio, default_base_url: "https://api.xiaomimimo.com/v1/", default_model: "mimo-v2.5-tts", default_voice: "mimo_default", requires_api_key: true, status: TtsStatus::Ported, note: "chat/completions with audio {voice, format:'wav'}; 'api-key' header (not Bearer); base64 WAV in choices[0].message.audio.data." },
    TtsProviderDef { id: "google-gemini-audio-speech", name: "Google Gemini", kind: TtsProviderKind::GeminiNative, default_base_url: "https://generativelanguage.googleapis.com/v1beta/", default_model: "gemini-2.5-flash-preview-tts", default_voice: "Kore", requires_api_key: true, status: TtsStatus::Ported, note: "Native generateContent responseModalities [AUDIO]; inlineData base64 PCM16 24 kHz mono wrapped to WAV. Dedicated key only (Vue also falls back to the Gemini chat key — not wired here)." },
    TtsProviderDef { id: "openrouter-audio-speech", name: "OpenRouter", kind: TtsProviderKind::OpenRouterAudio, default_base_url: "https://openrouter.ai/api/v1/", default_model: "openai/gpt-audio-mini", default_voice: "alloy", requires_api_key: true, status: TtsStatus::Ported, note: "chat/completions modalities [text,audio] stream:true; SSE delta.audio.data base64 PCM16 24 kHz wrapped to WAV (mirrors the Vue wrapper)." },
    TtsProviderDef { id: "aws-polly-tts", name: "Amazon AWS Polly", kind: TtsProviderKind::Polly, default_base_url: "", default_model: "neural", default_voice: "Ivy", requires_api_key: true, status: TtsStatus::Partial, note: "SigV4-signed POST https://polly.{region}.amazonaws.com/v1/speech {Engine,OutputFormat:mp3,Text,VoiceId}. api_key = Access Key ID; extra.secret_access_key + extra.region required. Signature is self-graded (no AWS test vector in-repo); verify against a live account before relying on it." },
];

/// Look up a registry def by id.
#[must_use]
pub fn find_tts_provider(id: &str) -> Option<&'static TtsProviderDef> {
    TTS_PROVIDER_DEFS.iter().find(|d| d.id == id)
}

/// Registry ids, in catalog order.
#[must_use]
pub fn tts_provider_ids() -> Vec<&'static str> {
    TTS_PROVIDER_DEFS.iter().map(|d| d.id).collect()
}

/// Map from id → def for O(1) lookups.
#[must_use]
pub fn tts_provider_map() -> HashMap<&'static str, &'static TtsProviderDef> {
    TTS_PROVIDER_DEFS.iter().map(|d| (d.id, d)).collect()
}

fn merged_base_url(
    cfg: &TtsProviderConfig,
    def: Option<&'static TtsProviderDef>,
) -> Option<String> {
    cfg.base_url
        .clone()
        .or_else(|| {
            def.map(|d| d.default_base_url.to_string())
                .filter(|s| !s.is_empty())
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn merged_model(cfg: &TtsProviderConfig, def: Option<&'static TtsProviderDef>) -> Option<String> {
    cfg.model
        .clone()
        .or_else(|| def.map(|d| d.default_model.to_string()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn merged_voice(
    cfg: &TtsProviderConfig,
    def: Option<&'static TtsProviderDef>,
    call_voice: &str,
) -> String {
    let v = cfg
        .voice
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match v {
        Some(v) => v.to_string(),
        None if !call_voice.trim().is_empty() => call_voice.trim().to_string(),
        None => def.map(|d| d.default_voice).unwrap_or_default().to_string(),
    }
}

/// Build a boxed synthesizer for a provider configuration.
///
/// Resolution order for family: `cfg.kind` → catalog lookup of `cfg.id` → error.
/// Resolution order for `base_url`/`model`: explicit config → catalog default → family default.
///
/// # Errors
///
/// Returns [`SpeechError::InvalidConfig`] for unknown ids, missing required credentials or
/// missing base URLs, and [`SpeechError::UnsupportedProvider`] for catalog entries that are
/// registered but intentionally not ported.
pub fn build_tts_client(cfg: TtsProviderConfig) -> Result<Arc<dyn SpeechSynthesizer>, SpeechError> {
    build_tts_client_with_voice(cfg, "")
}

/// As [`build_tts_client`], with a per-call default voice seed used when neither the config
/// nor the catalog provide one.
///
/// # Errors
///
/// See [`build_tts_client`].
pub fn build_tts_client_with_voice(
    cfg: TtsProviderConfig,
    call_voice: &str,
) -> Result<Arc<dyn SpeechSynthesizer>, SpeechError> {
    let def = find_tts_provider(&cfg.id);
    let kind = match cfg.kind {
        Some(k) => k,
        None => def.map(|d| d.kind).ok_or_else(|| {
            SpeechError::InvalidConfig(format!("unknown speech provider id: {}", cfg.id))
        })?,
    };

    let api_key = cfg
        .api_key
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let base_url = merged_base_url(&cfg, def);
    let model = merged_model(&cfg, def);
    let voice = merged_voice(&cfg, def, call_voice);

    let requires_key = def.map(|d| d.requires_api_key).unwrap_or(false);
    if requires_key && api_key.is_none() {
        return Err(SpeechError::InvalidConfig(format!(
            "API key required for speech provider {}",
            cfg.id
        )));
    }

    match kind {
        TtsProviderKind::Noop => Ok(Arc::new(crate::client_noop::NoopSynthesizer::new(
            cfg.id.clone(),
        ))),
        TtsProviderKind::Unsupported => {
            let note = def.map(|d| d.note).unwrap_or("no port exists");
            Err(SpeechError::UnsupportedProvider(format!(
                "{}: {note}",
                cfg.id
            )))
        }
        TtsProviderKind::KokoroLocal => {
            let mut kcfg = crate::KokoroConfig::default();
            if !voice.is_empty() {
                kcfg.voice = voice;
            }
            Ok(Arc::new(crate::KokoroSynthesizer::with_config(kcfg)?))
        }
        TtsProviderKind::OpenAiCompatible => {
            let base = base_url.ok_or_else(|| {
                SpeechError::InvalidConfig(format!("base_url required for {}", cfg.id))
            })?;
            Ok(Arc::new(OpenAiCompatibleClient {
                id: cfg.id.clone(),
                base_url: base,
                api_key,
                model: model.unwrap_or_else(|| "tts-1".into()),
                voice,
                extra: cfg.extra,
            }))
        }
        TtsProviderKind::ElevenLabsNative => Ok(Arc::new(ElevenLabsClient {
            id: cfg.id.clone(),
            base_url: base_url.unwrap_or_else(|| "https://api.elevenlabs.io/v1/".into()),
            api_key: api_key.unwrap_or_default(),
            model: model.unwrap_or_else(|| "eleven_multilingual_v2".into()),
            voice,
            extra: cfg.extra,
        })),
        TtsProviderKind::UnspeechProxy(backend) => Ok(Arc::new(UnspeechProxyClient {
            id: cfg.id.clone(),
            backend,
            base_url: base_url.unwrap_or_else(|| "https://unspeech.hyp3r.link/v1/".into()),
            api_key: api_key.unwrap_or_default(),
            model: model.unwrap_or_default(),
            voice,
            extra: cfg.extra,
        })),
        TtsProviderKind::VoicevoxFamily => Ok(Arc::new(VoicevoxClient {
            id: cfg.id.clone(),
            family_name: def.map(|d| d.name).unwrap_or("VOICEVOX").to_string(),
            base_url: base_url.unwrap_or_else(|| "http://localhost:50021/".into()),
            voice,
            extra: cfg.extra,
        })),
        TtsProviderKind::Player2 => Ok(Arc::new(Player2Client {
            id: cfg.id.clone(),
            base_url: base_url.unwrap_or_else(|| "http://localhost:4315/v1/".into()),
            voice,
            game_key: cfg
                .extra
                .get("game_key")
                .and_then(|v| v.as_str())
                .unwrap_or("airi")
                .to_string(),
            extra: cfg.extra,
        })),
        TtsProviderKind::Minimax => Ok(Arc::new(MinimaxClient {
            id: cfg.id.clone(),
            base_url: base_url.unwrap_or_else(|| "https://api.minimax.io".into()),
            api_key: api_key.unwrap_or_default(),
            model: model.unwrap_or_else(|| "speech-2.8-hd".into()),
            voice,
            extra: cfg.extra,
        })),
        TtsProviderKind::MimoAudio => Ok(Arc::new(MimoAudioClient {
            id: cfg.id.clone(),
            base_url: base_url.unwrap_or_else(|| "https://api.xiaomimimo.com/v1/".into()),
            api_key: api_key.unwrap_or_default(),
            model: model.unwrap_or_else(|| "mimo-v2.5-tts".into()),
            voice,
            extra: cfg.extra,
        })),
        TtsProviderKind::GeminiNative => Ok(Arc::new(GeminiTtsClient {
            id: cfg.id.clone(),
            base_url: base_url
                .unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta/".into()),
            api_key: api_key.unwrap_or_default(),
            model: model.unwrap_or_else(|| "gemini-2.5-flash-preview-tts".into()),
            voice,
            extra: cfg.extra,
        })),
        TtsProviderKind::OpenRouterAudio => Ok(Arc::new(OpenRouterAudioClient {
            id: cfg.id.clone(),
            base_url: base_url.unwrap_or_else(|| "https://openrouter.ai/api/v1/".into()),
            api_key: api_key.unwrap_or_default(),
            model: model.unwrap_or_else(|| "openai/gpt-audio-mini".into()),
            voice,
            extra: cfg.extra,
        })),
        TtsProviderKind::Polly => {
            // Vue maps config.apiKey onto accessKeyId; secret + region are separate fields.
            let secret = cfg
                .extra
                .get("secret_access_key")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    SpeechError::InvalidConfig(
                        "aws-polly-tts requires extra.secret_access_key (config.api_key is the Access Key ID)".into(),
                    )
                })?;
            let region = cfg
                .extra
                .get("region")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("us-east-1")
                .to_string();
            Ok(Arc::new(PollyClient {
                id: cfg.id.clone(),
                region,
                access_key_id: api_key.unwrap_or_default(),
                secret_access_key: secret,
                model: model.unwrap_or_else(|| "neural".into()),
                voice,
            }))
        }
    }
}
