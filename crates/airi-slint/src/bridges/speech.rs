// SPDX-License-Identifier: GPL-3.0-or-later
//! Speech settings bridge (`SpeechController`) exposed to Slint.
//!
//! Drives the speech settings page. The page folds the old
//! `/settings/modules/speech` modules surface and the
//! `/settings/providers/speech` landing into one settings surface.
//!
//! Backed by `airi-speech` ([`TTS_PROVIDER_DEFS`], [`find_tts_provider`],
//! [`build_tts_client`]) — the provider catalog is read straight from the
//! crate; port status, kind and notes are never re-derived in the UI or here.
//!
//! Boundary contract (same as the other bridges): JSON crosses the boundary.
//! `defs_json` is a one-shot JSON *array* string of the whole catalog. Field
//! records are flattened into plain objects; no API keys ever cross — the
//! only credential-derived signal the UI sees is the `missing_key` boolean for
//! the currently selected provider.
//!
//! Key resolution (same lookup pattern as the LLM path in `providers.rs`):
//! the key for a speech provider id is read from [`airi_store::ProviderRepo`]
//! (`provider_repo().get(id)`), expecting a stored record whose `config`
//! object carries a non-empty `api_key` — plus optional `base_url` / `model`
//! overrides and an `extra_json` bag that is forwarded verbatim as the
//! [`TtsProviderConfig::extra`] map (e.g. Polly's `secret_access_key` /
//! `region`). When the stored record is missing or carries no key, a
//! `requires_api_key` provider reports `missing_key == true` and
//! `synthesize_sample` fails with a token-free "API key required" error
//! (produced by `build_tts_client` itself). Keys never leave the bridge.
//!
//! Persistence: the selection is persisted into the settings blob
//! `settings/speech` as `{"providerId":"…","voice":"…","speed":1.0}` via the
//! same `SettingsStore` pattern the stage bridge uses — except the struct
//! is local to this file, because `airi-core::settings` owns the typed
//! section structs and this lane may not add one.
//!
//! Honesty contract:
//! * `synthesize_sample` never triggers a model download. `kokoro-local`
//!   answers `"error: requires model download — not bundled in v1"` instead
//!   of fetching ~82 MB on a settings-page button.
//! * [`TtsStatus::Unsupported`] providers answer with the crate's own
//!   `UnsupportedProvider` note; nothing about them is re-invented here.
//! * Sample audio is written to exactly one file under the profile dir
//!   (`<profile>/airi/speech-samples/`, or the platform data dir when no
//!   `--profile` is set); no cache entry, no index, no other file is
//!   created. The file is not played — in-app playback is not wired.

use std::path::PathBuf;
use std::sync::Mutex;

use airi_speech::{
    build_tts_client, find_tts_provider, SynthesizeOptions, TtsProviderConfig, TtsProviderKind,
    TtsStatus, TTS_PROVIDER_DEFS,
};
use serde::{Deserialize, Serialize};

/// Settings blob key (Electron `settings/<group>` namespace).
const SPEECH_SETTINGS_KEY: &str = "settings/speech";
/// Cap applied to diagnostics crossing the boundary.
const MESSAGE_CAP: usize = 512;
/// Hard timeout for one sample synthesis round trip.
const SAMPLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Speech settings view-model. One process-wide instance; the UI re-reads
/// the fields after each call.
pub struct SpeechControllerState {
    /// One-shot JSON array of the whole TTS provider catalog.
    pub defs_json: String,
    /// Registry id of the selected provider; `""` when unset.
    pub selected_provider_id: String,
    /// Voice override; `""` means the provider default.
    pub voice: String,
    /// Speaking rate, clamped to `0.25..=4.0`.
    pub speed: f64,
    /// Last user-facing status line (empty, `"saved"`, or `"error: …"`).
    pub status_line: String,
    /// Whether the selected provider needs an API key the store lacks.
    pub missing_key: bool,
}

impl Default for SpeechControllerState {
    fn default() -> Self {
        let blob = load_blob();
        let missing = missing_key_for(&blob.provider_id);
        Self {
            defs_json: defs_json(),
            selected_provider_id: blob.provider_id,
            voice: blob.voice,
            speed: clamp_speed(blob.speed),
            status_line: String::new(),
            missing_key: missing,
        }
    }
}

static STATE: Mutex<SpeechControllerState> = Mutex::new(SpeechControllerState {
    defs_json: String::new(),
    selected_provider_id: String::new(),
    voice: String::new(),
    speed: 1.0,
    status_line: String::new(),
    missing_key: false,
});

/// Lock the process-wide speech settings state for a UI-thread operation.
pub fn with_state<R>(f: impl FnOnce(&mut SpeechControllerState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

impl SpeechControllerState {
    /// Re-read the persisted blob into the mirror fields. Called once after
    /// the page is created.
    pub fn refresh(&mut self) {
        let blob = load_blob();
        let missing = missing_key_for(&blob.provider_id);
        self.selected_provider_id = blob.provider_id;
        self.voice = blob.voice;
        self.speed = clamp_speed(blob.speed);
        self.missing_key = missing;
    }

    /// Select a provider id from the catalog. On no-match the `status_line`
    /// carries an error and no state changes. Returns whether the selection
    /// was applied.
    pub fn select_provider(&mut self, id: &str) -> bool {
        let id = id.trim();
        if find_tts_provider(id).is_none() {
            self.status_line = format!("error: unknown speech provider '{id}'");
            return false;
        }
        let missing = missing_key_for(id);
        self.selected_provider_id = id.to_string();
        self.missing_key = missing;
        self.status_line = String::new();
        true
    }

    /// Set the voice override (`""` clears it; the provider default is
    /// used at synthesis time then).
    pub fn apply_voice(&mut self, voice: &str) {
        self.voice = voice.trim().to_string();
    }

    /// Set the speaking rate; clamped to `0.25..=4.0` (NaN ⇒ 1.0).
    pub fn apply_speed(&mut self, speed: f64) {
        self.speed = clamp_speed(speed);
    }

    /// Persist `{providerId, voice, speed}` into `settings/speech`.
    /// `status_line` becomes `"saved"` on success. Returns `true` on success.
    pub fn save(&mut self) -> bool {
        let id = self.selected_provider_id.trim().to_string();
        if id.is_empty() {
            self.status_line = "error: select a provider before saving".to_string();
            return false;
        }
        if find_tts_provider(&id).is_none() {
            self.status_line =
                "error: selected provider is not in the catalog; reload the page".to_string();
            return false;
        }
        let blob = SpeechSettingsBlob {
            provider_id: id,
            voice: self.voice.trim().to_string(),
            speed: clamp_speed(self.speed),
        };
        match save_blob(&blob) {
            Ok(()) => {
                self.status_line = "saved".to_string();
                true
            }
            Err(err) => {
                eprintln!("[airi-slint] speech: failed to persist {SPEECH_SETTINGS_KEY}: {err}");
                self.status_line = truncate_chars(
                    &format!("error: could not persist settings: {err}"),
                    MESSAGE_CAP,
                );
                false
            }
        }
    }

    /// Synthesize a short sample with the selected provider and write it to
    /// a fresh temp file. Returns the absolute path of the file, or
    /// `"error: …"` (token-free, length-capped) on failure. Never plays the
    /// file.
    pub fn synthesize_sample(&self, text: &str) -> String {
        synthesize_sample_inner(
            text.trim(),
            self.selected_provider_id.trim(),
            self.voice.trim(),
            clamp_speed(self.speed),
        )
    }
}

/// The async worker for `synthesize_sample`. Always returns a user-presentable
/// string — absolute path on success, `"error: …"` on failure (token-free,
/// capped at [`MESSAGE_CAP`] chars).
fn synthesize_sample_inner(text: &str, selected: &str, voice: &str, speed: f64) -> String {
    if text.is_empty() {
        return "error: enter some text to synthesize".to_string();
    }
    if selected.is_empty() {
        return "error: select a provider before synthesizing a sample".to_string();
    }
    let Some(def) = find_tts_provider(selected) else {
        return format!("error: unknown speech provider '{selected}'");
    };
    // Never trigger an ~82 MB model download from a settings-page button.
    if matches!(def.kind, TtsProviderKind::KokoroLocal) {
        return "error: requires model download — not bundled in v1".to_string();
    }
    // Credentials come from the store; the bridge is the only place they exist.
    let stored = stored_speech_config(selected);
    let api_key = stored.as_ref().and_then(api_key_from_config);
    let base_url = stored.as_ref().and_then(base_url_from_config);
    let model = stored.as_ref().and_then(model_from_config);
    let extra = stored.as_ref().map(extras_from_config).unwrap_or_default();

    let config = TtsProviderConfig {
        id: selected.to_string(),
        kind: None,
        api_key,
        base_url,
        model,
        voice: non_empty(voice),
        extra,
    };
    let client = match build_tts_client(config) {
        Ok(client) => client,
        Err(err) => return format!("error: {}", truncate_chars(&err.to_string(), MESSAGE_CAP)),
    };
    let Some(handle) = crate::bridges::runtime_handle() else {
        // No tokio runtime (unit tests): report instead of panicking.
        return "error: tokio runtime unavailable".to_string();
    };
    let options = SynthesizeOptions {
        speed: Some(speed as f32),
        // Ask for WAV explicitly; providers that can honor it do (OpenAI
        // family, VOICEVOX, Gemini, MiMo, Player2, noop). Others are named
        // truthfully by sniffing the returned bytes below.
        response_format: Some(airi_speech::AudioFormat::Wav),
        ..SynthesizeOptions::default()
    };
    let text = text.to_string();
    let voice = voice.to_string();
    let result = handle.block_on(async move {
        match tokio::time::timeout(SAMPLE_TIMEOUT, client.synthesize(&text, &voice, &options)).await
        {
            Ok(Ok(stream)) => collect_stream_bytes(stream).await,
            Ok(Err(err)) => Err(err.to_string()),
            Err(_) => Err(format!(
                "synthesis timed out after {}s",
                SAMPLE_TIMEOUT.as_secs()
            )),
        }
    });
    let bytes = match result {
        Ok(bytes) => bytes,
        Err(message) => return format!("error: {}", truncate_chars(&message, MESSAGE_CAP)),
    };

    let dir = sample_dir();
    if let Err(err) = std::fs::create_dir_all(&dir) {
        return format!(
            "error: could not create {}: {err}",
            truncate_chars(&dir.display().to_string(), MESSAGE_CAP)
        );
    }
    let ext = sniff_extension(&bytes);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("speech-sample-{millis}.{ext}"));
    if let Err(err) = std::fs::write(&path, &bytes) {
        return format!(
            "error: could not write {}: {err}",
            truncate_chars(&path.display().to_string(), MESSAGE_CAP)
        );
    }
    path.display().to_string()
}

/// Collect an [`airi_speech::AudioStream`] into memory with a 64 MiB cap.
/// Mirrors `airi-speech`'s own `collect_stream`; needed because the crate's
/// helper lives in a private module. Requires `futures-util` in `airi-slint`
/// (already a workspace dependency — see the phase note).
async fn collect_stream_bytes(stream: airi_speech::AudioStream) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;

    let mut stream = Box::pin(stream);
    let mut out = Vec::new();
    const CAP: usize = 64 * 1024 * 1024;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| err.to_string())?;
        if out.len() + chunk.len() > CAP {
            return Err(format!("audio payload exceeds the {CAP} byte cap"));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

fn clamp_speed(speed: f64) -> f64 {
    if speed.is_nan() {
        1.0
    } else {
        // f64::clamp is fine with ±inf inputs (they clamp to the bounds).
        speed.clamp(0.25, 4.0)
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    value.chars().take(max).collect::<String>() + "…"
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Port status tag for the JSON boundary (`ported` | `partial` | `unsupported`).
fn status_str(status: TtsStatus) -> &'static str {
    match status {
        TtsStatus::Ported => "ported",
        TtsStatus::Partial => "partial",
        TtsStatus::Unsupported => "unsupported",
    }
}

/// Kebab-case family tag for the JSON boundary. `unspeech-proxy:<backend>`
/// carries the backend suffix (microsoft/deepgram/alibaba/volcengine).
fn kind_str(kind: TtsProviderKind) -> String {
    match kind {
        TtsProviderKind::OpenAiCompatible => "open-ai-compatible".to_string(),
        TtsProviderKind::ElevenLabsNative => "elevenlabs-native".to_string(),
        TtsProviderKind::UnspeechProxy(backend) => {
            format!("unspeech-proxy:{}", backend.model_prefix())
        }
        TtsProviderKind::VoicevoxFamily => "voicevox-family".to_string(),
        TtsProviderKind::Player2 => "player2".to_string(),
        TtsProviderKind::Minimax => "minimax".to_string(),
        TtsProviderKind::MimoAudio => "mimo-audio".to_string(),
        TtsProviderKind::GeminiNative => "gemini-native".to_string(),
        TtsProviderKind::OpenRouterAudio => "openrouter-audio".to_string(),
        TtsProviderKind::Polly => "aws-polly".to_string(),
        TtsProviderKind::KokoroLocal => "kokoro-local".to_string(),
        TtsProviderKind::Unsupported => "unsupported".to_string(),
        TtsProviderKind::Noop => "noop".to_string(),
    }
}

/// Build the `defs_json` payload. Free function so unit tests can exercise it.
fn defs_json() -> String {
    let defs: Vec<serde_json::Value> = TTS_PROVIDER_DEFS
        .iter()
        .map(|def| {
            serde_json::json!({
                "id": def.id,
                "name": def.name,
                "kind": kind_str(def.kind),
                "defaultBaseUrl": def.default_base_url,
                "defaultModel": def.default_model,
                "defaultVoice": def.default_voice,
                "requiresApiKey": def.requires_api_key,
                "status": status_str(def.status),
                "note": def.note,
            })
        })
        .collect();
    serde_json::to_string(&defs).unwrap_or_else(|_| "[]".to_string())
}

/// `Some(trimmed)` for non-empty strings; absent store record ⇒ `None`.
fn stored_speech_config(id: &str) -> Option<serde_json::Value> {
    let stored = crate::bridges::provider_repo()?.get(id).ok().flatten()?;
    Some(stored.config)
}

/// The API key from a stored config, tolerating the flat and nested shapes
/// written by the LLM providers bridge (`api_key` top-level; anything else
/// rides in `extra_json`).
fn api_key_from_config(config: &serde_json::Value) -> Option<String> {
    config
        .get("api_key")
        .and_then(|v| v.as_str())
        .and_then(non_empty)
}

/// Optional stored `base_url` override.
fn base_url_from_config(config: &serde_json::Value) -> Option<String> {
    config
        .get("base_url")
        .and_then(|v| v.as_str())
        .and_then(non_empty)
}

/// Optional stored `model` override.
fn model_from_config(config: &serde_json::Value) -> Option<String> {
    config
        .get("model")
        .and_then(|v| v.as_str())
        .and_then(non_empty)
}

/// Provider-specific extras: `extra_json` object verbatim, plus any
/// top-level keys that are not the well-known ones (mirrors the LLM
/// bridge's flat ↔ nested round trip).
fn extras_from_config(config: &serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    if let Some(obj) = config.get("extra_json").and_then(|v| v.as_object()) {
        for (key, value) in obj {
            out.insert(key.clone(), value.clone());
        }
    }
    if let Some(obj) = config.as_object() {
        for (key, value) in obj {
            match key.as_str() {
                "api_key" | "base_url" | "model" | "extra_json" | "id" | "kind" | "enabled"
                | "updated_at" | "config" => {}
                _ => {
                    out.entry(key.clone()).or_insert_with(|| value.clone());
                }
            }
        }
    }
    out
}

/// Whether the store carries an API key for `id`.
fn has_key(id: &str) -> bool {
    stored_speech_config(id)
        .as_ref()
        .and_then(api_key_from_config)
        .is_some()
}

/// Whether the given provider (probably the selected one) requires a key
/// the store does not have. Unknown ids report `false`.
fn missing_key_for(id: &str) -> bool {
    match find_tts_provider(id) {
        Some(def) => def.requires_api_key && !has_key(id),
        None => false,
    }
}

/// Persisted `settings/speech` blob (`{providerId, voice, speed}`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SpeechSettingsBlob {
    /// Registry id of the selected provider; `""` when unset.
    #[serde(default)]
    provider_id: String,
    /// Voice override; `""` means the provider default.
    #[serde(default)]
    voice: String,
    /// Speaking rate; defaults to 1.0.
    #[serde(default = "default_speed")]
    speed: f64,
}

impl Default for SpeechSettingsBlob {
    fn default() -> Self {
        Self {
            provider_id: String::new(),
            voice: String::new(),
            speed: default_speed(),
        }
    }
}

fn default_speed() -> f64 {
    1.0
}

fn load_blob() -> SpeechSettingsBlob {
    crate::bridges::settings_store()
        .and_then(|store| store.load::<SpeechSettingsBlob>(SPEECH_SETTINGS_KEY).ok())
        .unwrap_or_default()
}

fn save_blob(blob: &SpeechSettingsBlob) -> anyhow::Result<()> {
    let Some(store) = crate::bridges::settings_store() else {
        anyhow::bail!("settings store not registered");
    };
    store.save(SPEECH_SETTINGS_KEY, blob)
}

/// `<profile>/airi/speech-samples`, or the platform data dir equivalent
/// when no `--profile` is set. Same resolution order as `discord.rs`.
fn sample_dir() -> PathBuf {
    crate::bridges::profile_dir()
        .map(|p| p.join("airi").join("speech-samples"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint").join("speech-samples")))
        .unwrap_or_else(|| PathBuf::from("speech-samples"))
}

/// Best-effort container sniffing on the produced bytes; used to name the
/// temp file truthfully when a provider ignores `response_format: wav`.
fn sniff_extension(bytes: &[u8]) -> &'static str {
    if bytes.len() >= 12 && &bytes[8..12] == b"WAVE" {
        "wav"
    } else if bytes.len() >= 3
        && (&bytes[..3] == b"ID3" || (bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0))
    {
        "mp3"
    } else if bytes.len() >= 4 && &bytes[..4] == b"fLaC" {
        "flac"
    } else if bytes.len() >= 4 && &bytes[..4] == b"OggS" {
        "ogg"
    } else {
        "bin"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defs_json_is_valid_array_with_catalog_rows() {
        let raw = defs_json();
        let parsed: Vec<serde_json::Value> =
            serde_json::from_str(&raw).expect("defsJson must parse as an array");
        assert_eq!(
            parsed.len(),
            TTS_PROVIDER_DEFS.len(),
            "every catalog row must be present"
        );
        let by_id: std::collections::HashMap<&str, &serde_json::Value> = parsed
            .iter()
            .map(|row| (row["id"].as_str().expect("id is a string"), row))
            .collect();
        for def in TTS_PROVIDER_DEFS {
            let row = by_id.get(def.id).expect("catalog id missing from defsJson");
            assert_eq!(row["name"].as_str().unwrap(), def.name);
            assert_eq!(
                row["requiresApiKey"].as_bool().unwrap(),
                def.requires_api_key
            );
            assert_eq!(row["status"].as_str().unwrap(), status_str(def.status));
            assert!(row["kind"].as_str().map(|k| !k.is_empty()).unwrap_or(false));
            assert_eq!(row["note"].as_str().unwrap(), def.note);
            assert_eq!(
                row["defaultBaseUrl"].as_str().unwrap(),
                def.default_base_url
            );
            assert_eq!(row["defaultModel"].as_str().unwrap(), def.default_model);
            assert_eq!(row["defaultVoice"].as_str().unwrap(), def.default_voice);
        }
        // No secret material may leak into the payload.
        assert!(
            !raw.contains("\"api_key\""),
            "defsJson must not carry api_key"
        );
        assert!(
            !raw.contains("\"apiKey\""),
            "defsJson must not carry apiKey"
        );
    }

    #[test]
    fn kind_str_covers_every_catalog_variant() {
        for def in TTS_PROVIDER_DEFS {
            let tag = kind_str(def.kind);
            assert!(!tag.is_empty(), "kind tag must not be empty for {}", def.id);
        }
    }

    #[test]
    fn clamp_speed_bounds_and_nan() {
        assert_eq!(clamp_speed(1.0), 1.0);
        assert_eq!(clamp_speed(0.0), 0.25);
        assert_eq!(clamp_speed(100.0), 4.0);
        assert_eq!(clamp_speed(f64::NAN), 1.0);
        assert_eq!(clamp_speed(f64::INFINITY), 4.0);
    }

    #[test]
    fn speech_blob_roundtrip_and_defaults() {
        let blob = SpeechSettingsBlob::default();
        assert_eq!(blob.speed, 1.0);
        let raw = serde_json::to_string(&blob).expect("serialize");
        assert!(raw.contains("\"providerId\""));
        assert!(raw.contains("\"voice\""));
        assert!(raw.contains("\"speed\""));
        let parsed: SpeechSettingsBlob = serde_json::from_str(&raw).expect("roundtrip");
        assert_eq!(parsed, blob);
        // Missing fields fall back to defaults.
        let minimal: SpeechSettingsBlob = serde_json::from_str("{}").expect("minimal blob");
        assert_eq!(minimal, SpeechSettingsBlob::default());
    }

    #[test]
    fn sniff_extension_detects_wav_and_mp3() {
        assert_eq!(sniff_extension(b"RIFFxxxxWAVEdata"), "wav");
        assert_eq!(sniff_extension(b"ID3....."), "mp3");
        assert_eq!(sniff_extension(&[0xff, 0xfb, 0x00]), "mp3");
        assert_eq!(sniff_extension(b"fLaC...."), "flac");
        assert_eq!(sniff_extension(b"OggS...."), "ogg");
        assert_eq!(sniff_extension(b"unknown"), "bin");
    }
}
