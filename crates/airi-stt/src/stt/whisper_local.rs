// SPDX-License-Identifier: GPL-3.0-or-later

//! On-device Whisper transcription via `whisper-rs` (whisper.cpp bindings).
//!
//! - [`WhisperLocalClient`] implements the whole-blob [`SttClient`] trait
//!   (`id() = "whisper-local"`); audio is fed to the model as f32 samples
//!   converted from s16 PCM at 16 kHz.
//! - The model file (`.bin` / ggml format) is **never committed**. On first
//!   use, [`ensure_model`] downloads the default model — `ggml-base.en.bin`
//!   (~148 MB, English-only) — from the ggerganov/whisper.cpp Hugging Face
//!   repo into the platform data dir (`<data_dir>/airi-slint/models/`).
//!   `base.en` is the chosen default because it is the smallest model with
//!   usable English accuracy (~3× real-time on a modern laptop CPU, ~200 MB
//!   RAM); `small`/`medium` are better but 3–10× heavier. Override with the
//!   `AIRI_QT_WHISPER_MODEL` env var (path to any ggml `.bin`/`.gguf` model)
//!   or pass an explicit `model_path`.
//! - Set `AIRI_QT_WHISPER_SKIP_DOWNLOAD=1` to disable the download path
//!   (tests then exercise only the cache-hit path). Live tests are gated on
//!   `WHISPER_TEST_MODEL=<path-to-model>` and skip when unset.
//!
//! Limitations (honest):
//!
//! - `base.en` is **English-only** and not quantized above the ggml default
//!   (q8-ish f16 weights as shipped). Non-English audio needs a multilingual
//!   model via `AIRI_QT_WHISPER_MODEL`.
//! - whisper.cpp pads audio to its internal 30 s window with ~500 ms of
//!   leading/trailing context; very short clips may pick up hallucinated
//!   tokens ("Thank you." etc.). Whole-blob use only — no streaming.
//! - Inference is CPU-bound and blocking; it runs on the blocking thread
//!   pool, but it competes with capture for cores.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use sha2::Digest;
use thiserror::Error;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use super::{SttClient, SttError, SttRequest};

/// Default model: ggml-base.en.bin (~148 MB, English-only). See module docs
/// for why this size class was picked.
pub const WHISPER_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
/// Path relative to the platform data dir where the model is cached.
pub const WHISPER_MODEL_REL_PATH: &str = "airi-slint/models/ggml-base.en.bin";
/// Env var overriding the model path (any ggml `.bin` / `.gguf`).
pub const WHISPER_MODEL_ENV: &str = "AIRI_QT_WHISPER_MODEL";
/// Env var disabling the download path entirely.
pub const WHISPER_SKIP_DOWNLOAD_ENV: &str = "AIRI_QT_WHISPER_SKIP_DOWNLOAD";
/// Env var gating the live transcription test.
pub const WHISPER_TEST_MODEL_ENV: &str = "WHISPER_TEST_MODEL";
/// Below this size the downloaded file is treated as an error page / truncation.
const MIN_MODEL_BYTES: u64 = 100_000_000;

#[derive(Debug, Error)]
pub enum WhisperModelError {
    #[error("could not locate a platform data dir; pass an explicit path instead")]
    NoDataDir,
    #[error(
        "whisper model download disabled by AIRI_QT_WHISPER_SKIP_DOWNLOAD=1 and model is not cached at {0}"
    )]
    DownloadDisabled(PathBuf),
    #[error("failed to download whisper model: {0}")]
    Download(#[from] reqwest::Error),
    #[error("failed to create whisper model file {path}: {source}")]
    CreateModel {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to write whisper model chunk to {path}: {source}")]
    WriteModel {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("downloaded whisper model is suspiciously small ({0} bytes); refusing to use it")]
    ModelTooSmall(u64),
    #[error("whisper model load failed: {0}")]
    Load(String),
}

// ---------------------------------------------------------------------------
// Model download / cache
// ---------------------------------------------------------------------------

/// Path of the cached default model inside the platform data dir
/// (`<data_dir>/airi-slint/models/ggml-base.en.bin`).
pub fn model_path() -> Result<PathBuf, WhisperModelError> {
    Ok(dirs::data_dir()
        .ok_or(WhisperModelError::NoDataDir)?
        .join(WHISPER_MODEL_REL_PATH))
}

/// Resolve the effective model path: explicit argument wins, then the
/// `AIRI_QT_WHISPER_MODEL` env override, then the platform-data-dir cache.
/// The override is used verbatim (no download); the cached path may be
/// downloaded on first use by [`ensure_model`].
pub fn resolve_model_path(explicit: Option<&Path>) -> Result<PathBuf, WhisperModelError> {
    if let Some(path) = explicit {
        return Ok(path.to_path_buf());
    }
    if let Some(env) = std::env::var_os(WHISPER_MODEL_ENV) {
        let path = PathBuf::from(env);
        if !path.as_os_str().is_empty() {
            return Ok(path);
        }
    }
    model_path()
}

/// Ensure the default model exists at the default data-dir cache path,
/// downloading it on first run. Never committed to the repo. Returns the
/// model path. A cache hit is the fast path and needs no network.
pub async fn ensure_model() -> Result<PathBuf, WhisperModelError> {
    let path = model_path()?;
    ensure_model_at(&path).await
}

/// Same as [`ensure_model`] but with an explicit destination path. If `path`
/// exists the cache-hit path is taken and nothing is downloaded.
pub async fn ensure_model_at(path: &Path) -> Result<PathBuf, WhisperModelError> {
    if path.exists() {
        return Ok(path.to_path_buf());
    }
    if std::env::var_os(WHISPER_SKIP_DOWNLOAD_ENV).is_some_and(|v| v == "1") {
        return Err(WhisperModelError::DownloadDisabled(path.to_path_buf()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|source| WhisperModelError::CreateModel {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    use futures_util::StreamExt;

    let response = reqwest::Client::new()
        .get(WHISPER_MODEL_URL)
        .send()
        .await?
        .error_for_status()?;

    // Stream to a temp sibling so a crash never leaves a truncated model at
    // the cache path; hash while streaming (no second pass over 148 MB).
    let tmp = path.with_extension(format!("bin.tmp-{}", std::process::id()));
    let mut file =
        std::fs::File::create(&tmp).map_err(|source| WhisperModelError::CreateModel {
            path: tmp.clone(),
            source,
        })?;
    let mut hasher = sha2::Sha256::new();
    let mut total: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        total += chunk.len() as u64;
        hasher.update(&chunk);
        std::io::Write::write_all(&mut file, &chunk).map_err(|source| {
            WhisperModelError::WriteModel {
                path: tmp.clone(),
                source,
            }
        })?;
    }
    drop(file);
    if total < MIN_MODEL_BYTES {
        let _ = std::fs::remove_file(&tmp);
        return Err(WhisperModelError::ModelTooSmall(total));
    }
    tracing::info!(
        bytes = total,
        sha256 = %hex_lower(&hasher.finalize()),
        "downloaded ggml-base.en.bin"
    );

    std::fs::rename(&tmp, path).map_err(|source| WhisperModelError::WriteModel {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(path.to_path_buf())
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------
// Parameter builder (pure, unit-tested)
// ---------------------------------------------------------------------------

/// Inputs to the whisper.cpp `FullParams` for one transcription. Kept as a
/// plain struct so the policy is unit-testable without a model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WhisperRunConfig {
    /// BCP-47-ish short language code (`"en"`, `"zh"`, …). `None` → auto-detect.
    pub language: Option<String>,
    /// Translate to English instead of transcribing.
    pub translate: bool,
    /// Encoder/decoder worker threads.
    pub n_threads: i32,
    /// Give whisper.cpp no previous-segment context (each blob transcribed cold).
    pub no_context: bool,
    /// Suppress blank/silence hallucination tokens.
    pub suppress_blank: bool,
}

impl Default for WhisperRunConfig {
    fn default() -> Self {
        Self {
            language: None,
            translate: false,
            n_threads: default_n_threads(),
            no_context: true,
            suppress_blank: true,
        }
    }
}

fn default_n_threads() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get().clamp(1, 8) as i32)
        .unwrap_or(4)
}

impl WhisperRunConfig {
    /// Build the `whisper-rs` params. `language` lives as long as `self`.
    #[must_use]
    pub fn to_params(&self) -> FullParams<'_, '_> {
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(self.n_threads);
        params.set_language(self.language.as_deref());
        params.set_translate(self.translate);
        params.set_no_context(self.no_context);
        params.set_suppress_blank(self.suppress_blank);
        params.set_no_timestamps(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_token_timestamps(false);
        params.set_debug_mode(false);
        params
    }
}

/// Precondition checks for one request. Pure; unit-tested.
///
/// # Errors
/// Returns [`SttError::Config`] when the PCM blob is empty or not 16 kHz
/// mono s16 (whisper.cpp only accepts 16 kHz f32 after conversion).
pub fn check_request(req: &SttRequest) -> Result<(), SttError> {
    if req.pcm_s16le.is_empty() {
        return Err(SttError::Config(
            "cannot transcribe an empty PCM blob".into(),
        ));
    }
    if req.sample_rate != 16_000 {
        return Err(SttError::Config(format!(
            "whisper-local requires 16 kHz mono PCM, got {} Hz",
            req.sample_rate
        )));
    }
    Ok(())
}

/// Convert s16 PCM to the f32 [-1, 1] samples whisper.cpp wants.
#[must_use]
pub fn s16_to_f32(samples: &[i16]) -> Vec<f32> {
    samples.iter().map(|&s| f32::from(s) / 32768.0).collect()
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// On-device whole-blob transcription via whisper.cpp. The model is loaded
/// lazily on first [`SttClient::transcribe_pcm`] call and cached for the
/// lifetime of the client.
pub struct WhisperLocalClient {
    /// Explicit model path; `None` → `AIRI_QT_WHISPER_MODEL` → data-dir cache.
    model_path: Option<PathBuf>,
    language: Option<String>,
    translate: bool,
    ctx: Mutex<Option<Arc<WhisperContext>>>,
}

impl std::fmt::Debug for WhisperLocalClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WhisperLocalClient")
            .field("model_path", &self.model_path)
            .field("language", &self.language)
            .field("translate", &self.translate)
            .field("model_loaded", &self.ctx.lock().is_ok_and(|g| g.is_some()))
            .finish_non_exhaustive()
    }
}

impl WhisperLocalClient {
    /// `model_path` — explicit ggml model file. `None` → `AIRI_QT_WHISPER_MODEL`
    /// env override → platform data-dir cache (auto-downloaded on first use).
    #[must_use]
    pub fn new(model_path: Option<PathBuf>) -> Self {
        Self {
            model_path,
            language: None,
            translate: false,
            ctx: Mutex::new(None),
        }
    }

    /// Construct from the `AIRI_QT_WHISPER_MODEL` env override alone.
    #[must_use]
    pub fn from_env() -> Self {
        Self::new(None)
    }

    /// Pin a BCP-47 short language code (e.g. `"en"`, `"zh"`). `None` (default)
    /// auto-detects; the default `base.en` model is English-only anyway.
    #[must_use]
    pub fn with_language(mut self, language: impl Into<String>) -> Self {
        self.language = Some(language.into());
        self
    }

    /// Translate to English instead of transcribing (multilingual models only).
    #[must_use]
    pub fn with_translate(mut self, translate: bool) -> Self {
        self.translate = translate;
        self
    }

    fn run_config(&self, req_language: Option<&str>) -> WhisperRunConfig {
        WhisperRunConfig {
            language: req_language
                .map(str::to_string)
                .or_else(|| self.language.clone()),
            translate: self.translate,
            ..WhisperRunConfig::default()
        }
    }

    /// Load (or return the cached) whisper context for `path`.
    fn load_context(&self, path: &Path) -> Result<Arc<WhisperContext>, SttError> {
        let mut guard = self
            .ctx
            .lock()
            .map_err(|_| SttError::Config("whisper context mutex poisoned".into()))?;
        if let Some(ctx) = guard.as_ref() {
            return Ok(Arc::clone(ctx));
        }
        let ctx = WhisperContext::new_with_params(path, WhisperContextParameters::default())
            .map_err(|err| {
                SttError::Config(format!("failed to load whisper model {path:?}: {err}"))
            })?;
        let ctx = Arc::new(ctx);
        *guard = Some(Arc::clone(&ctx));
        Ok(ctx)
    }
}

#[async_trait]
impl SttClient for WhisperLocalClient {
    fn id(&self) -> &str {
        "whisper-local"
    }

    async fn transcribe_pcm(&self, req: SttRequest) -> Result<String, SttError> {
        check_request(&req)?;

        // Resolve + ensure the model before entering the blocking section.
        let requested = req.model.as_deref().map(PathBuf::from);
        let explicit = requested.or_else(|| self.model_path.clone());
        let path = match resolve_model_path(explicit.as_deref()) {
            Ok(path) => path,
            Err(err) => return Err(SttError::Config(err.to_string())),
        };
        let path = if path.exists() {
            path
        } else if explicit.is_some() {
            return Err(SttError::Config(format!(
                "whisper model not found at {path:?} (env override or explicit path is used verbatim; nothing is downloaded)"
            )));
        } else {
            ensure_model()
                .await
                .map_err(|err| SttError::Config(err.to_string()))?
        };

        let config = self.run_config(req.language.as_deref());
        let samples = s16_to_f32(&req.pcm_s16le);
        let ctx = self.load_context(&path)?;

        // whisper.cpp is CPU-bound and synchronous; keep it off the async workers.
        tokio::task::spawn_blocking(move || {
            let mut state = ctx
                .create_state()
                .map_err(|err| SttError::Protocol(format!("whisper create_state failed: {err}")))?;
            let params = config.to_params();
            state
                .full(params, &samples)
                .map_err(|err| SttError::Protocol(format!("whisper inference failed: {err}")))?;
            let n = state.full_n_segments();
            let mut text = String::new();
            for i in 0..n {
                if let Some(segment) = state.get_segment(i) {
                    let piece = segment.to_str_lossy().map_err(|err| {
                        SttError::Protocol(format!("whisper segment decode: {err}"))
                    })?;
                    text.push_str(piece.as_ref());
                }
            }
            Ok(text.trim().to_string())
        })
        .await
        .map_err(|err| SttError::Protocol(format!("whisper worker panicked: {err}")))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serializes tests that set/remove `AIRI_QT_WHISPER_SKIP_DOWNLOAD` (held across an await).
    static ASYNC_ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[test]
    fn id_is_whisper_local() {
        assert_eq!(WhisperLocalClient::new(None).id(), "whisper-local");
    }

    #[test]
    fn empty_pcm_is_rejected() {
        let req = SttRequest::from_pcm(Vec::new());
        assert!(matches!(check_request(&req), Err(SttError::Config(_))));
    }

    #[test]
    fn non_16khz_is_rejected() {
        let req = SttRequest {
            pcm_s16le: vec![0; 8000],
            sample_rate: 8_000,
            language: None,
            model: None,
            prompt: None,
        };
        let err = check_request(&req).unwrap_err();
        assert!(
            matches!(err, SttError::Config(msg) if msg.contains("16000") || msg.contains("16 kHz"))
        );
    }

    #[test]
    fn valid_request_passes_precondition() {
        let req = SttRequest::from_pcm(vec![0; 16000]);
        assert!(check_request(&req).is_ok());
    }

    #[test]
    fn s16_to_f32_scales_to_unit_range() {
        let out = s16_to_f32(&[0, i16::MAX, i16::MIN]);
        assert_eq!(out[0], 0.0);
        assert!((out[1] - 32767.0 / 32768.0).abs() < f32::EPSILON);
        assert!((out[2] + 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn run_config_defaults_auto_detect_and_greedy() {
        let cfg = WhisperRunConfig::default();
        assert_eq!(cfg.language, None);
        assert!(!cfg.translate);
        assert!(cfg.no_context);
        assert!(cfg.suppress_blank);
        assert!(cfg.n_threads >= 1 && cfg.n_threads <= 8);
    }

    #[test]
    fn run_config_request_language_wins_over_client_default() {
        let client = WhisperLocalClient::new(None).with_language("zh");
        let cfg = client.run_config(Some("en"));
        assert_eq!(cfg.language.as_deref(), Some("en"));
        let cfg = client.run_config(None);
        assert_eq!(cfg.language.as_deref(), Some("zh"));
    }

    #[test]
    fn params_builder_does_not_panic() {
        let cfg = WhisperRunConfig {
            language: Some("en".into()),
            translate: true,
            ..WhisperRunConfig::default()
        };
        let _ = cfg.to_params();
    }

    #[test]
    fn resolve_model_path_prefers_explicit() {
        let explicit = PathBuf::from("/tmp/somewhere/model.bin");
        let resolved = resolve_model_path(Some(&explicit)).unwrap();
        assert_eq!(resolved, explicit);
    }

    #[test]
    fn resolve_model_path_env_override() {
        std::env::set_var(WHISPER_MODEL_ENV, "/tmp/env-model.bin");
        let resolved = resolve_model_path(None).unwrap();
        std::env::remove_var(WHISPER_MODEL_ENV);
        assert_eq!(resolved, PathBuf::from("/tmp/env-model.bin"));
    }

    #[tokio::test]
    async fn ensure_model_at_uses_cache_hit() {
        let dir = std::env::temp_dir().join(format!("airi-whisper-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cached.bin");
        std::fs::write(&path, b"fake-model").unwrap();
        let resolved = ensure_model_at(&path).await.unwrap();
        assert_eq!(resolved, path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn ensure_model_at_respects_skip_download() {
        let _guard = ASYNC_ENV_LOCK.lock().await;
        let dir =
            std::env::temp_dir().join(format!("airi-whisper-test-skip-{}", std::process::id()));
        let path = dir.join("missing.bin");
        std::env::set_var(WHISPER_SKIP_DOWNLOAD_ENV, "1");
        let result = ensure_model_at(&path).await;
        std::env::remove_var(WHISPER_SKIP_DOWNLOAD_ENV);
        assert!(matches!(
            result,
            Err(WhisperModelError::DownloadDisabled(_))
        ));
    }

    #[tokio::test]
    async fn transcribe_empty_blob_errors_before_model_load() {
        let client = WhisperLocalClient::new(Some(PathBuf::from("/definitely/missing/model.bin")));
        let req = SttRequest::from_pcm(Vec::new());
        let err = client.transcribe_pcm(req).await.unwrap_err();
        assert!(matches!(err, SttError::Config(_)));
    }

    #[tokio::test]
    async fn transcribe_errors_on_missing_explicit_model() {
        let client = WhisperLocalClient::new(Some(PathBuf::from("/definitely/missing/model.bin")));
        let req = SttRequest::from_pcm(vec![0; 1600]);
        let err = client.transcribe_pcm(req).await.unwrap_err();
        assert!(matches!(err, SttError::Config(msg) if msg.contains("not found")));
    }

    /// Minimal RIFF/WAVE walker for 16-bit mono PCM: returns (samples, sample_rate).
    /// Test-only; not a general WAV decoder.
    fn parse_wav_s16le(bytes: &[u8]) -> (Vec<i16>, u32) {
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        let mut offset = 12;
        let mut fmt: Option<(u16, u16, u32)> = None; // (format, channels, rate)
        let mut data: Option<&[u8]> = None;
        while offset + 8 <= bytes.len() {
            let id = &bytes[offset..offset + 4];
            let size =
                u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
            let body_start = offset + 8;
            let body_end = (body_start + size).min(bytes.len());
            match id {
                b"fmt " => {
                    let format =
                        u16::from_le_bytes(bytes[body_start..body_start + 2].try_into().unwrap());
                    let channels = u16::from_le_bytes(
                        bytes[body_start + 2..body_start + 4].try_into().unwrap(),
                    );
                    let rate = u32::from_le_bytes(
                        bytes[body_start + 4..body_start + 8].try_into().unwrap(),
                    );
                    fmt = Some((format, channels, rate));
                }
                b"data" => data = Some(&bytes[body_start..body_end]),
                _ => {}
            }
            offset = body_end + (size % 2); // chunks are word-aligned
        }
        let (format, channels, rate) = fmt.expect("missing fmt chunk");
        assert_eq!(format, 1, "expected PCM");
        assert_eq!(channels, 1, "expected mono");
        let data = data.expect("missing data chunk");
        let samples = data
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| i16::from_le_bytes([c[0], c[1]]))
            .collect();
        (samples, rate)
    }

    /// Live transcription against a real model. Skipped unless
    /// `WHISPER_TEST_MODEL=<path-to-ggml-model>` is set. Optionally transcribes
    /// `WHISPER_TEST_AUDIO=<path-to-16kHz-mono-s16-wav>` and asserts non-empty text;
    /// otherwise feeds a 1 s tone and only asserts the pipeline runs.
    #[tokio::test]
    async fn live_transcription_roundtrip() {
        let Ok(model) = std::env::var(WHISPER_TEST_MODEL_ENV) else {
            eprintln!("skipping live whisper test: {WHISPER_TEST_MODEL_ENV} not set");
            return;
        };
        let model_path = PathBuf::from(model);
        assert!(
            model_path.exists(),
            "{WHISPER_TEST_MODEL_ENV} points at missing file {model_path:?}"
        );
        let client = WhisperLocalClient::new(Some(model_path));
        if let Ok(audio) = std::env::var("WHISPER_TEST_AUDIO") {
            let bytes = std::fs::read(&audio).expect("read WHISPER_TEST_AUDIO");
            let (samples, rate) = parse_wav_s16le(&bytes);
            assert_eq!(rate, 16_000, "WHISPER_TEST_AUDIO must be 16 kHz");
            let req = SttRequest {
                pcm_s16le: samples,
                sample_rate: rate,
                language: Some("en".into()),
                model: None,
                prompt: None,
            };
            let text = client
                .transcribe_pcm(req)
                .await
                .expect("transcription failed");
            eprintln!("live transcription output: {text:?}");
            assert!(
                !text.is_empty(),
                "expected non-empty transcript for {audio}"
            );
            return;
        }
        // 1 s of 440 Hz tone is not speech; we only assert the pipeline runs
        // end-to-end and yields a (possibly empty) string without error.
        let req = SttRequest {
            pcm_s16le: (0..16_000)
                .map(|i| {
                    ((i as f32 * 440.0 * std::f32::consts::TAU / 16_000.0).sin() * 8000.0) as i16
                })
                .collect(),
            sample_rate: 16_000,
            language: Some("en".into()),
            model: None,
            prompt: None,
        };
        let text = client
            .transcribe_pcm(req)
            .await
            .expect("transcription failed");
        eprintln!("live transcription output: {text:?}");
    }
}
