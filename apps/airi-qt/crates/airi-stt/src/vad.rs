// SPDX-License-Identifier: GPL-3.0-or-later
//! Silero VAD (v5) via ONNX Runtime, plus a pure hysteresis state machine.
//!
//! Two layers:
//!
//! - [`VadHysteresis`] — deterministic speech/silence segmentation logic driven
//!   by a probability sequence. Unit-tested with synthetic probabilities; no
//!   model or network needed.
//! - [`SileroVad`] — ONNX inference for the Silero VAD v5 model (512-sample
//!   frames at 16 kHz) feeding [`VadHysteresis`]. The model file is **never
//!   committed**; it is fetched on first run into the platform data dir (see
//!   [`ensure_model`]). Set `SILERO_SKIP_DOWNLOAD=1` to disable the download
//!   path (tests then exercise only the cache-hit path).
//!
//! Model inputs (silero_vad.onnx, v5), per the official ONNX wrapper
//! (`silero_vad/utils_vad.py`):
//!
//! - `input` — `[1, 576]` f32: 64 samples of left context (the tail of the
//!   previous frame) prepended to the 512-sample frame, mono 16 kHz, scaled to
//!   [-1, 1]. Feeding only 512 samples silently yields ~0 probabilities — the
//!   context is mandatory.
//! - `state` — `[2, 1, 128]` f32: recurrent state carried between frames.
//! - `sr` — scalar i64 (16000).
//!
//! Outputs: `output` `[1, 1]` f32 probability and `stateN` `[2, 1, 128]` f32.
//! The context resets along with the state (64 zeros).

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use sha2::Digest;
use thiserror::Error;
/// Serializes tests that mutate the `SILERO_SKIP_DOWNLOAD` env var.
///
/// Used only by tests; `pub(crate)` so `mic.rs`'s auto-mode test can lock it.
#[allow(dead_code)]
pub(crate) static SILERO_ENV_LOCK: Mutex<()> = Mutex::new(());

/// Official Silero VAD v5 ONNX model URL.
pub const SILERO_MODEL_URL: &str =
    "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx";
/// Path relative to the platform data dir where the model is cached.
pub const SILERO_MODEL_REL_PATH: &str = "airi-qt/models/silero_vad.onnx";
/// Samples per frame at 16 kHz (512 / 16000 = 32 ms).
pub const FRAME_SAMPLES: usize = 512;
/// Frame duration in milliseconds at 16 kHz.
pub const FRAME_MS: u64 = 32;

#[derive(Debug, Error)]
pub enum VadError {
    #[error("could not locate a platform data dir; pass an explicit path instead")]
    NoDataDir,
    #[error(
        "silero model download disabled by SILERO_SKIP_DOWNLOAD=1 and model is not cached at {0}"
    )]
    DownloadDisabled(PathBuf),
    #[error("failed to download silero model: {0}")]
    Download(#[from] reqwest::Error),
    #[error("failed to write silero model to {path}: {source}")]
    WriteModel {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("downloaded silero model is suspiciously small ({0} bytes); refusing to use it")]
    ModelTooSmall(u64),
    #[error("ONNX runtime error: {0}")]
    Ort(String),
    #[error("frame must contain exactly {expected} samples, got {got}")]
    BadFrameSize { expected: usize, got: usize },
}

// ---------------------------------------------------------------------------
// Hysteresis state machine (pure, deterministic)
// ---------------------------------------------------------------------------

/// Configurable thresholds for the hysteresis-based speech segmentation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VadConfig {
    /// Probability at/above which speech starts while in silence (default 0.35).
    pub speech_start: f32,
    /// Probability below which a frame counts as silence while speaking (default 0.15).
    pub speech_end: f32,
    /// Consecutive milliseconds of sub-`speech_end` audio before speech is
    /// considered ended (default 300 ms).
    pub min_silence_duration_ms: u64,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            speech_start: 0.35,
            speech_end: 0.15,
            min_silence_duration_ms: 300,
        }
    }
}

/// Events emitted by the VAD pipeline, one or more per pushed frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadEvent {
    /// Probability crossed `speech_start` while in silence.
    SpeechStart,
    /// Speech ended after `min_silence_duration_ms` of sub-`speech_end` audio.
    /// `segment_ms` excludes the trailing silence run.
    SpeechEnd { segment_ms: u64 },
    /// Emitted on every frame with the current speaking state.
    Speaking(bool),
}

/// Pure hysteresis speech/silence state machine.
///
/// Feed one probability per frame via [`VadHysteresis::update`]; each frame
/// yields zero or more [`VadEvent`]s. Deterministic and allocation-light —
/// this is the unit-tested core; [`SileroVad`] only produces probabilities.
#[derive(Debug, Clone)]
pub struct VadHysteresis {
    config: VadConfig,
    speaking: bool,
    /// Consecutive milliseconds of sub-`speech_end` audio while speaking.
    silence_run_ms: u64,
    /// Total milliseconds elapsed since speech started (including trailing silence).
    segment_ms: u64,
}

impl VadHysteresis {
    pub fn new(config: VadConfig) -> Self {
        Self {
            config,
            speaking: false,
            silence_run_ms: 0,
            segment_ms: 0,
        }
    }

    pub fn reset(&mut self) {
        self.speaking = false;
        self.silence_run_ms = 0;
        self.segment_ms = 0;
    }

    pub fn is_speaking(&self) -> bool {
        self.speaking
    }

    /// Feed one frame probability; `frame_ms` is the frame duration
    /// ([`FRAME_MS`] for 512 samples @ 16 kHz). Returns the events for this frame.
    pub fn update(&mut self, probability: f32, frame_ms: u64) -> Vec<VadEvent> {
        let mut events = Vec::with_capacity(2);

        if self.speaking {
            self.segment_ms += frame_ms;
            if probability < self.config.speech_end {
                self.silence_run_ms += frame_ms;
                if self.silence_run_ms >= self.config.min_silence_duration_ms {
                    self.speaking = false;
                    // Subtract the trailing silence run: report actual speech duration.
                    let segment_ms = self.segment_ms.saturating_sub(self.silence_run_ms);
                    self.silence_run_ms = 0;
                    self.segment_ms = 0;
                    events.push(VadEvent::SpeechEnd { segment_ms });
                    events.push(VadEvent::Speaking(false));
                    return events;
                }
                events.push(VadEvent::Speaking(true));
                return events;
            }
            self.silence_run_ms = 0;
            events.push(VadEvent::Speaking(true));
            return events;
        }

        if probability >= self.config.speech_start {
            self.speaking = true;
            self.silence_run_ms = 0;
            self.segment_ms = frame_ms;
            events.push(VadEvent::SpeechStart);
            events.push(VadEvent::Speaking(true));
            return events;
        }

        events.push(VadEvent::Speaking(false));
        events
    }
}

// ---------------------------------------------------------------------------
// Model download / cache
// ---------------------------------------------------------------------------

/// Path of the cached model inside the platform data dir
/// (`<data_dir>/airi-qt/models/silero_vad.onnx`).
pub fn model_path() -> Result<PathBuf, VadError> {
    Ok(dirs::data_dir()
        .ok_or(VadError::NoDataDir)?
        .join(SILERO_MODEL_REL_PATH))
}

/// Ensure the Silero VAD model exists at the default data-dir cache path,
/// downloading it from the official URL on first run. Never committed to the
/// repo. Returns the model path.
pub async fn ensure_model() -> Result<PathBuf, VadError> {
    let path = model_path()?;
    ensure_model_at(&path).await
}

/// Same as [`ensure_model`] but with an explicit destination path.
/// If `path` exists, the cache-hit path is taken and nothing is downloaded.
pub async fn ensure_model_at(path: &Path) -> Result<PathBuf, VadError> {
    if path.exists() {
        return Ok(path.to_path_buf());
    }
    if std::env::var_os("SILERO_SKIP_DOWNLOAD").is_some_and(|v| v == "1") {
        return Err(VadError::DownloadDisabled(path.to_path_buf()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|source| VadError::WriteModel {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    let tmp = path.with_extension(format!("onnx.tmp-{}", std::process::id()));
    let response = reqwest::Client::new()
        .get(SILERO_MODEL_URL)
        .send()
        .await?
        .error_for_status()?;

    let body = response.bytes().await?;
    if body.len() < 100_000 {
        return Err(VadError::ModelTooSmall(body.len() as u64));
    }
    let hash = sha2::Sha256::digest(&body);
    tracing::info!(
        bytes = body.len(),
        sha256 = %hex_lower(&hash),
        "downloaded silero_vad.onnx"
    );

    std::fs::write(&tmp, &body).map_err(|source| VadError::WriteModel {
        path: tmp.clone(),
        source,
    })?;
    std::fs::rename(&tmp, path).map_err(|source| VadError::WriteModel {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(path.to_path_buf())
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------
// ONNX inference
// ---------------------------------------------------------------------------

static ENV: OnceLock<ort::environment::Environment> = OnceLock::new();
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn environment() -> Result<ort::environment::Environment, VadError> {
    if let Some(env) = ENV.get() {
        return Ok(env.clone());
    }
    let _guard = ENV_LOCK.lock().expect("ort environment init lock poisoned");
    if let Some(env) = ENV.get() {
        return Ok(env.clone());
    }
    let env = ort::init()
        .build()
        .map_err(|e| VadError::Ort(e.to_string()))?;
    let _ = ENV.set(env);
    Ok(ENV.get().expect("environment was just set").clone())
}

const STATE_LEN: usize = 2 * 128;
const CONTEXT_LEN: usize = 64;

/// Silero VAD v5 session. Feed 512-sample 16 kHz mono frames via [`SileroVad::push`].
pub struct SileroVad {
    session: ort::session::Session,
    state: Vec<f32>,
    context: Vec<f32>,
    hysteresis: VadHysteresis,
}

impl SileroVad {
    /// Download (if needed) and load the model from the default cache path.
    pub async fn load_default() -> Result<Self, VadError> {
        Self::load_default_with_config(VadConfig::default()).await
    }

    /// Download (if needed) and load the model with explicit VAD thresholds.
    pub async fn load_default_with_config(config: VadConfig) -> Result<Self, VadError> {
        let path = ensure_model().await?;
        Self::load(&path, config)
    }

    /// Load a model from an explicit path.
    pub fn load(path: &Path, config: VadConfig) -> Result<Self, VadError> {
        let env = environment()?;
        let builder =
            ort::session::Session::builder(&env).map_err(|e| VadError::Ort(e.to_string()))?;
        let session = builder
            .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
            .map_err(|e| VadError::Ort(e.to_string()))?
            .with_intra_threads(1)
            .map_err(|e| VadError::Ort(e.to_string()))?
            .commit_from_file(path)
            .map_err(|e| VadError::Ort(e.to_string()))?;
        Ok(Self {
            session,
            state: vec![0.0; STATE_LEN],
            context: vec![0.0; CONTEXT_LEN],
            hysteresis: VadHysteresis::new(config),
        })
    }

    /// Reset recurrent model state and hysteresis (e.g. after a segment flush).
    pub fn reset(&mut self) {
        self.state.fill(0.0);
        self.context.fill(0.0);
        self.hysteresis.reset();
    }

    pub fn is_speaking(&self) -> bool {
        self.hysteresis.is_speaking()
    }

    /// (producer, version, custom keys) of the loaded model. Diagnostics.
    pub fn session_metadata(&self) -> (Option<String>, Option<i64>, Vec<(String, String)>) {
        let meta = match self.session.metadata() {
            Ok(m) => m,
            Err(e) => {
                return (
                    None,
                    None,
                    vec![("metadata_error".to_string(), e.to_string())],
                )
            }
        };
        let custom = meta
            .custom_keys()
            .map(|keys| {
                keys.into_iter()
                    .filter_map(|k| meta.custom(&k).map(|v| (k, v)))
                    .collect()
            })
            .unwrap_or_default();
        (meta.producer(), meta.version(), custom)
    }

    /// L2 norm of the recurrent state (diagnostics for the probe/test harness).
    pub fn state_norm(&self) -> f32 {
        self.state.iter().map(|v| v * v).sum::<f32>().sqrt()
    }

    /// Model input outlets (name + type/shape). Diagnostics.
    pub fn session_inputs(&self) -> &[ort::value::Outlet] {
        self.session.inputs()
    }

    /// Model output outlets (name + type/shape). Diagnostics.
    pub fn session_outputs(&self) -> &[ort::value::Outlet] {
        self.session.outputs()
    }

    /// Run one 512-sample frame through the model; returns the speech probability.
    /// Updates the internal recurrent state.
    pub fn probability(&mut self, frame: &[i16]) -> Result<f32, VadError> {
        if frame.len() != FRAME_SAMPLES {
            return Err(VadError::BadFrameSize {
                expected: FRAME_SAMPLES,
                got: frame.len(),
            });
        }
        // i16 → f32 [-1, 1]
        let samples: Vec<f32> = frame.iter().map(|&s| f32::from(s) / 32768.0).collect();

        // Prepend the 64-sample left context (official ONNX protocol).
        let mut with_context = Vec::with_capacity(CONTEXT_LEN + FRAME_SAMPLES);
        with_context.extend_from_slice(&self.context);
        with_context.extend_from_slice(&samples);
        let frame_end = with_context.len();
        let input = ort::value::Tensor::from_array(([1usize, frame_end], with_context.clone()))
            .map_err(|e| VadError::Ort(e.to_string()))?;
        let state = ort::value::Tensor::from_array(([2usize, 1, 128], self.state.clone()))
            .map_err(|e| VadError::Ort(e.to_string()))?;
        let sr = ort::value::Tensor::from_array((Vec::<i64>::new(), vec![16000i64]))
            .map_err(|e| VadError::Ort(e.to_string()))?;

        let outputs = self
            .session
            .run(ort::inputs!["input" => input, "state" => state, "sr" => sr])
            .map_err(|e| VadError::Ort(e.to_string()))?;

        let (_, prob) = outputs["output"]
            .try_extract_tensor::<f32>()
            .map_err(|e| VadError::Ort(e.to_string()))?;
        let probability = prob.first().copied().unwrap_or(0.0);

        let (_, new_state) = outputs["stateN"]
            .try_extract_tensor::<f32>()
            .map_err(|e| VadError::Ort(e.to_string()))?;
        self.state.copy_from_slice(new_state);
        // Roll the context: the last 64 samples of the contextualized input.
        self.context
            .copy_from_slice(&with_context[frame_end - CONTEXT_LEN..]);

        Ok(probability)
    }

    /// Push one 512-sample frame; returns the hysteresis events for the frame.
    pub fn push(&mut self, frame: &[i16]) -> Result<Vec<VadEvent>, VadError> {
        let probability = self.probability(frame)?;
        Ok(self.hysteresis.update(probability, FRAME_MS))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn silence_run(h: &mut VadHysteresis, n: usize) -> Vec<VadEvent> {
        let mut all = Vec::new();
        for _ in 0..n {
            all.extend(h.update(0.0, FRAME_MS));
        }
        all
    }

    #[test]
    fn starts_speaking_on_threshold_crossing() {
        let mut h = VadHysteresis::new(VadConfig::default());
        assert_eq!(h.update(0.1, FRAME_MS), vec![VadEvent::Speaking(false)]);
        let events = h.update(0.5, FRAME_MS);
        assert!(events.contains(&VadEvent::SpeechStart));
        assert!(events.contains(&VadEvent::Speaking(true)));
        assert!(h.is_speaking());
    }

    #[test]
    fn hysteresis_deadband_ignores_mid_range_in_silence() {
        let mut h = VadHysteresis::new(VadConfig::default());
        // 0.25 is above speech_end (0.15) but below speech_start (0.35): no start.
        let events = h.update(0.25, FRAME_MS);
        assert_eq!(events, vec![VadEvent::Speaking(false)]);
        assert!(!h.is_speaking());
    }

    #[test]
    fn speaking_survives_short_dips_below_speech_end() {
        let mut h = VadHysteresis::new(VadConfig::default());
        h.update(0.9, FRAME_MS);
        // 200 ms of silence (6 frames × 32 ms = 192 ms) < 300 ms min silence.
        for _ in 0..6 {
            let events = h.update(0.05, FRAME_MS);
            assert!(events.contains(&VadEvent::Speaking(true)));
            assert!(!events
                .iter()
                .any(|e| matches!(e, VadEvent::SpeechEnd { .. })));
        }
        // A loud frame resets the silence run.
        h.update(0.9, FRAME_MS);
        for _ in 0..6 {
            h.update(0.05, FRAME_MS);
        }
        let events = h.update(0.05, FRAME_MS); // 224 ms cumulative, still below 300
        assert!(!events
            .iter()
            .any(|e| matches!(e, VadEvent::SpeechEnd { .. })));
    }

    #[test]
    fn speech_ends_after_min_silence_and_reports_segment() {
        let cfg = VadConfig::default(); // 300 ms min silence
        let mut h = VadHysteresis::new(cfg);
        h.update(0.9, FRAME_MS); // segment_ms = 32
        h.update(0.9, FRAME_MS); // 64
        h.update(0.9, FRAME_MS); // 96
        h.update(0.9, FRAME_MS); // 128
                                 // Now 10 frames of silence: 320 ms >= 300 ms → SpeechEnd.
        let mut end = None;
        for _ in 0..10 {
            for e in h.update(0.05, FRAME_MS) {
                if let VadEvent::SpeechEnd { segment_ms } = e {
                    end = Some(segment_ms);
                }
            }
        }
        let segment_ms = end.expect("SpeechEnd must be emitted after 300 ms of silence");
        assert_eq!(segment_ms, 128); // 4 voiced frames; trailing silence excluded
        assert!(!h.is_speaking());
        // State machine returns to silence baseline.
        assert_eq!(h.update(0.0, FRAME_MS), vec![VadEvent::Speaking(false)]);
        // A new utterance can begin after reset.
        let events = h.update(0.9, FRAME_MS);
        assert!(events.contains(&VadEvent::SpeechStart));
    }

    #[test]
    fn segment_excludes_full_silence_run() {
        let cfg = VadConfig {
            min_silence_duration_ms: 64,
            ..VadConfig::default()
        };
        let mut h = VadHysteresis::new(cfg);
        h.update(0.9, FRAME_MS); // speech 1 frame → segment 32
        h.update(0.05, FRAME_MS); // silence run 32
        let events = h.update(0.05, FRAME_MS); // silence run 64 → SpeechEnd
        let end = events.iter().find_map(|e| match e {
            VadEvent::SpeechEnd { segment_ms } => Some(*segment_ms),
            _ => None,
        });
        assert_eq!(end, Some(32)); // 96 total - 64 trailing silence = 32 speech
        assert_eq!(h.update(0.0, FRAME_MS), vec![VadEvent::Speaking(false)]);
    }

    #[test]
    fn synthetic_sine_burst_probability_pattern() {
        // Simulate: 5 silence frames, 25 voiced frames, 12 silence frames.
        let mut h = VadHysteresis::new(VadConfig::default());
        let mut saw_start = false;
        let mut saw_end = false;
        for _ in 0..5 {
            h.update(0.02, FRAME_MS);
        }
        for _ in 0..25 {
            for e in h.update(0.92, FRAME_MS) {
                if matches!(e, VadEvent::SpeechStart) {
                    saw_start = true;
                }
            }
        }
        for _ in 0..12 {
            for e in h.update(0.03, FRAME_MS) {
                if let VadEvent::SpeechEnd { segment_ms } = e {
                    saw_end = true;
                    assert_eq!(segment_ms, 25 * FRAME_MS); // 800 ms of speech
                }
            }
        }
        assert!(saw_start && saw_end);
    }

    #[test]
    fn custom_thresholds_are_respected() {
        let cfg = VadConfig {
            speech_start: 0.8,
            speech_end: 0.5,
            min_silence_duration_ms: 32,
        };
        let mut h = VadHysteresis::new(cfg);
        assert!(h.update(0.5, FRAME_MS) == vec![VadEvent::Speaking(false)]); // below start 0.8
        h.update(0.85, FRAME_MS); // start
        let events = h.update(0.4, FRAME_MS); // below end 0.5, silence run 32 ≥ 32 → end
        assert!(events
            .iter()
            .any(|e| matches!(e, VadEvent::SpeechEnd { .. })));
    }

    #[test]
    fn silence_run_helper_behaves() {
        let mut h = VadHysteresis::new(VadConfig::default());
        let events = silence_run(&mut h, 3);
        assert_eq!(
            events,
            vec![
                VadEvent::Speaking(false),
                VadEvent::Speaking(false),
                VadEvent::Speaking(false),
            ]
        );
    }

    #[test]
    fn cache_hit_path_never_downloads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("silero_vad.onnx");
        std::fs::write(&path, b"not-a-real-model-but-cache-hit").unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let resolved = rt.block_on(ensure_model_at(&path)).unwrap();
        assert_eq!(resolved, path);
    }

    #[test]
    fn download_disabled_env_is_honored() {
        let _guard = crate::vad::SILERO_ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("definitely-missing.onnx");
        std::env::set_var("SILERO_SKIP_DOWNLOAD", "1");
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = rt.block_on(ensure_model_at(&path));
        std::env::remove_var("SILERO_SKIP_DOWNLOAD");
        assert!(matches!(result, Err(VadError::DownloadDisabled(_))));
    }

    /// Real-model test: requires the model (downloads once to the platform
    /// data dir, or set SILERO_SKIP_DOWNLOAD=1 to skip). Prints a message and
    /// skips rather than fails when the model cannot be obtained.
    #[test]
    fn real_model_detects_synthetic_speech() {
        // Ensure a concurrently-running env-var test cannot trick us into skipping silently.
        let _guard = SILERO_ENV_LOCK.lock().unwrap();
        std::env::remove_var("SILERO_SKIP_DOWNLOAD");
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        let loaded = rt.block_on(SileroVad::load_default());
        let mut vad = match loaded {
            Ok(v) => v,
            Err(e) => {
                eprintln!("skipping real-model VAD test: model unavailable: {e}");
                return;
            }
        };

        // Synthetic "voiced" signal: 140 Hz f0 + harmonics, 6 Hz AM envelope,
        // light deterministic noise. Far more speech-like than a bare sine,
        // which Silero (trained on speech) tends to score below threshold.
        let voiced_frame = |global_index: usize| -> Vec<i16> {
            (0..FRAME_SAMPLES)
                .map(|i| {
                    let t = (global_index + i) as f32 / 16000.0;
                    let f0 = 140.0f32;
                    let mut s = 0.0f32;
                    for (harmonic, amp) in [
                        (1.0f32, 1.0f32),
                        (2.0, 0.6),
                        (3.0, 0.4),
                        (4.0, 0.25),
                        (5.0, 0.15),
                    ] {
                        s += amp * (t * f0 * harmonic * std::f32::consts::TAU).sin();
                    }
                    let am = 0.5 + 0.5 * (t * 6.0 * std::f32::consts::TAU).sin(); // 6 Hz AM
                    let noise = ((global_index * 2654435761_usize + i * 40503) % 1024) as f32
                        / 1024.0
                        - 0.5;
                    ((s * 0.45 * am + noise * 0.02) * i16::MAX as f32)
                        .clamp(i16::MIN as f32, i16::MAX as f32) as i16
                })
                .collect()
        };

        let mut frames: Vec<Vec<i16>> = (0..50).map(|_| vec![0i16; FRAME_SAMPLES]).collect(); // 1.6 s silence
        let mut global = 50 * FRAME_SAMPLES;
        for _ in 0..50 {
            frames.push(voiced_frame(global));
            global += FRAME_SAMPLES;
        }
        for _ in 0..50 {
            frames.push(vec![0i16; FRAME_SAMPLES]); // trailing silence
        }

        let mut saw_speech = false;
        let mut saw_end = false;
        for frame in &frames {
            if let Ok(events) = vad.push(frame) {
                for e in events {
                    match e {
                        VadEvent::SpeechStart => saw_speech = true,
                        VadEvent::SpeechEnd { .. } => saw_end = true,
                        VadEvent::Speaking(_) => {}
                    }
                }
            }
        }
        assert!(
            saw_speech,
            "synthetic voiced burst should trigger SpeechStart"
        );
        assert!(saw_end, "trailing silence should trigger SpeechEnd");
    }
}
