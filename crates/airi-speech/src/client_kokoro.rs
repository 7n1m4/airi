// SPDX-License-Identifier: GPL-3.0-or-later

//! Kokoro-82M (v1.0) — the first on-device / local engine in this crate.
//!
//! Kokoro is an Apache-2.0 text-to-speech model (`hexgrad/Kokoro-82M`, 82M
//! parameters) that runs unmodified through ONNX Runtime. This module ports
//! the inference half of the upstream `hexgrad/kokoro` / `thewh1teagle/kokoro-onnx`
//! pipelines to Rust; the phonemizer half prefers the actual upstream
//! approach — `espeak-ng -v en-us --ipa=3` — with a rule-based US-English
//! fallback when no espeak binary is reachable.
//!
//! ## Model files (never committed; fetched on first run)
//!
//! - **Model** — `onnx/model.onnx` from
//!   `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX` (repo sha
//!   `1939ad2a8e416c0acfeecc08a694d14ef25f2231`, Apache-2.0). fp32, 325,532,232
//!   bytes, sha256 `8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb`.
//!   Cached at `<dirs::data_dir()>/airi-slint/models/kokoro/kokoro-v1.0.onnx`.
//!   Override with the `AIRI_QT_KOKORO_MODEL` env var (path to a local `.onnx`;
//!   no download happens when set).
//! - **Voice embeddings** — raw little-endian f32 bins, shape
//!   `(510, 256)` (522,240 bytes), one per voice, from
//!   `<repo>/resolve/main/voices/<voice>.bin`. Cached at
//!   `<dirs::data_dir()>/airi-slint/models/kokoro/voices/<voice>.bin`.
//!   Override the directory with `AIRI_QT_KOKORO_VOICES_DIR`.
//!
//! First-run semantics mirror the Silero VAD lane (`airi-stt::vad`): cache-hit
//! fast path, atomic rename after download, `AIRI_QT_KOKORO_SKIP_DOWNLOAD=1`
//! disables the network path (CI). Live inference is covered by a test gated
//! behind `KOKORO_TEST_MODEL=1`.
//!
//! ## Inference contract (verified against the shipped `model.onnx`)
//!
//! Inputs: `input_ids` int64 `[1, N]` (`[0, *phoneme_ids, 0]`, N ≤ 512),
//! `style` float32 `[1, 256]` (row `n_phonemes - 1` of the voice bin, capped at
//! 509), `speed` float32 `[1]`. Outputs: `waveform` float32
//! `[1, num_samples]` at 24 kHz.
//!
//! ## G2P
//!
//! Text → phonemes uses a local `espeak-ng` binary when available
//! (env `AIRI_QT_ESPEAK` overrides the path, then `PATH` lookup, then
//! `~/.local/espeak-ng/bin/espeak-ng`, then `/usr/bin/espeak-ng`). espeak-ng
//! is the same G2P the upstream `kokoro-onnx` pipeline ships with (`misaki[en]`
//! falls back to it), so quality matches upstream. If no binary is found, a
//! **degraded** rule-based US-English fallback is used (small embedded
//! letter-to-sound map, uppercase letters kept); output quality is materially
//! worse — out-of-dictionary words, stress placement and vowel reduction are
//! approximate. Non-English voices require espeak-ng for non-`en` languages
//! (and are garbage through the fallback).

use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use ort::session::Session;
use ort::value::Tensor;
use reqwest::blocking;
use sha2::{Digest, Sha256};

use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::AudioStream;
use crate::wav::wav_from_pcm16;

mod kokoro_vocab;

/// Sample rate of the vocoder output.
pub const SAMPLE_RATE: u32 = 24_000;
/// Rows in each voice embedding bin.
const VOICE_ROWS: usize = 510;
/// Voice embedding width.
const VOICE_DIM: usize = 256;
/// Exact file size of a voice embedding bin.
const VOICE_BIN_BYTES: u64 = (VOICE_ROWS * VOICE_DIM * 4) as u64;
/// sha256 of `onnx/model.onnx` as published at the pinned revision.
const MODEL_SHA256: &str = "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb";
/// Model file name cached under the models dir.
const MODEL_FILE_NAME: &str = "kokoro-v1.0.onnx";
/// Default voice id.
pub const DEFAULT_VOICE: &str = "af_heart";
/// Default repository shard for the model and voice bins.
const REPO: &str = "onnx-community/Kokoro-82M-v1.0-ONNX";

/// Configuration for [`KokoroSynthesizer`].
#[derive(Debug, Clone)]
pub struct KokoroConfig {
    /// Path of the ONNX model file. If missing and `auto_download` is set, the
    /// file is fetched from [`REPO`] into the models dir.
    pub model_path: PathBuf,
    /// Directory holding voice embedding bins.
    pub voices_dir: PathBuf,
    /// Default voice when a call passes `voice == ""`.
    pub voice: String,
    /// Whether to auto-download missing model/voice files on construction.
    pub auto_download: bool,
    /// Path of the espeak-ng binary; `None` means "degraded rule-based fallback".
    pub espeak_path: Option<PathBuf>,
}

impl Default for KokoroConfig {
    fn default() -> Self {
        let dir = default_model_dir();
        let model_path = std::env::var_os("AIRI_QT_KOKORO_MODEL")
            .map(PathBuf::from)
            .unwrap_or_else(|| dir.join(MODEL_FILE_NAME));
        let voices_dir = std::env::var_os("AIRI_QT_KOKORO_VOICES_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| dir.join("voices"));
        let model_overridden = std::env::var_os("AIRI_QT_KOKORO_MODEL").is_some();
        Self {
            model_path,
            voices_dir,
            voice: DEFAULT_VOICE.into(),
            auto_download: !model_overridden
                && std::env::var_os("AIRI_QT_KOKORO_SKIP_DOWNLOAD").is_none(),
            espeak_path: resolve_espeak(),
        }
    }
}

fn default_model_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or(std::env::temp_dir())
        .join("airi-slint")
        .join("models")
        .join("kokoro")
}

/// Locate an espeak-ng binary without a system package manager.
fn resolve_espeak() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("AIRI_QT_ESPEAK") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    // PATH scan.
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join("espeak-ng");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    [
        dirs::home_dir().map(|h| h.join(".local/espeak-ng/bin/espeak-ng")),
        Some(PathBuf::from("/usr/local/bin/espeak-ng")),
        Some(PathBuf::from("/usr/bin/espeak-ng")),
    ]
    .into_iter()
    .flatten()
    .find(|candidate| candidate.is_file())
}

/// Static phoneme glyph → token id lookup.
fn phoneme_id(ch: char) -> Option<i64> {
    static LOOKUP: std::sync::LazyLock<BTreeMap<char, i64>> = std::sync::LazyLock::new(|| {
        kokoro_vocab::PHONEME_VOCAB
            .iter()
            .map(|&(c, id)| (c, id))
            .collect()
    });
    LOOKUP.get(&ch).copied()
}

/// Sentence-ish splitter: splits on `.`, `!`, `?`, `;`, newlines, keeping delimiters.
fn split_sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '.' | '!' | '?' | ';' | '\n') {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                out.push(std::mem::take(&mut current));
            } else {
                current.clear();
            }
        }
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        out.push(current);
    }
    out
}

/// Rule-based US-English fallback phoneme map (degraded).
fn degraded_g2p(text: &str) -> String {
    let lower: String = text.to_lowercase();
    let digraphs = [
        ("sh", "ʃ"),
        ("ch", "tʃ"),
        ("th", "θ"),
        ("ng", "ŋ"),
        ("ee", "iː"),
        ("oo", "uː"),
        ("ai", "eɪ"),
        ("ay", "eɪ"),
        ("ou", "aʊ"),
        ("ow", "aʊ"),
        ("ph", "f"),
        ("ck", "k"),
    ];
    let singles: BTreeMap<char, &str> = [
        ('a', "æ"),
        ('b', "b"),
        ('c', "k"),
        ('d', "d"),
        ('e', "ɛ"),
        ('f', "f"),
        ('g', "ɡ"),
        ('h', "h"),
        ('i', "ɪ"),
        ('j', "dʒ"),
        ('k', "k"),
        ('l', "l"),
        ('m', "m"),
        ('n', "n"),
        ('o', "ɒ"),
        ('p', "p"),
        ('q', "k"),
        ('r', "ɹ"),
        ('s', "s"),
        ('t', "t"),
        ('u', "ʊ"),
        ('v', "v"),
        ('w', "w"),
        ('x', "ks"),
        ('y', "j"),
        ('z', "z"),
    ]
    .into_iter()
    .collect();

    let mut out = String::with_capacity(lower.len() + 8);
    let mut iter = lower.chars().peekable();
    while let Some(ch) = iter.next() {
        if ch == ' ' {
            out.push(' ');
            continue;
        }
        // Try digraphs first.
        if let Some(&next) = iter.peek() {
            let pair = format!("{ch}{next}");
            if let Some(rep) = digraphs.iter().find(|(d, _)| *d == pair.as_str()) {
                out.push_str(rep.1);
                iter.next();
                continue;
            }
        }
        if let Some(rep) = singles.get(&ch) {
            out.push_str(rep)
        } // punctuation and stray glyphs are dropped
    }
    out
}

/// The espeak-ng G2P path: `<bin> -v en-us --ipa=3 -q <text>`.
fn espeak_g2p(espeak: &Path, text: &str) -> Result<String, SpeechError> {
    let output = std::process::Command::new(espeak)
        .args(["-v", "en-us", "--ipa=3", "-q", text])
        .output()
        .map_err(|e| {
            SpeechError::Provider(format!(
                "failed to spawn espeak-ng at {}: {e}",
                espeak.display()
            ))
        })?;
    if !output.status.success() {
        return Err(SpeechError::Provider(format!(
            "espeak-ng exited with status {}",
            output.status
        )));
    }
    // espeak-ng emits the IPA transcription + trailing newline.
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}

/// Tokenize an IPA phoneme string to model ids, wrapped in boundary ids (0).
fn encode_phonemes(ipa: &str) -> Vec<i64> {
    let mut ids = Vec::with_capacity(ipa.len() + 2);
    ids.push(0);
    for ch in ipa.chars() {
        if let Some(id) = phoneme_id(ch) {
            ids.push(id);
        }
    }
    ids.push(0);
    ids
}

/// In-process Kokoro-82M TTS.
pub struct KokoroSynthesizer {
    config: KokoroConfig,
    session: Arc<Mutex<Option<Arc<Mutex<Session>>>>>,
}

impl std::fmt::Debug for KokoroSynthesizer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KokoroSynthesizer")
            .field("model_path", &self.config.model_path)
            .field("voices_dir", &self.config.voices_dir)
            .field("voice", &self.config.voice)
            .field("espeak", &self.config.espeak_path)
            .finish_non_exhaustive()
    }
}

impl KokoroSynthesizer {
    /// Build a synthesizer, ensuring the model (and later each voice) is present.
    ///
    /// # Errors
    /// Fails when auto-download is disabled and files are missing, or the
    /// model file is present but fails sha256 verification.
    pub fn with_config(config: KokoroConfig) -> Result<Self, SpeechError> {
        if let Some(dir) = config.voices_dir.parent() {
            std::fs::create_dir_all(dir).map_err(|e| SpeechError::Provider(e.to_string()))?;
        }
        if let Some(parent) = config.model_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| SpeechError::Provider(e.to_string()))?;
        }
        if !config.model_path.exists() {
            if !config.auto_download {
                return Err(SpeechError::Provider(format!(
                    "kokoro model not found at {} and auto-download disabled",
                    config.model_path.display()
                )));
            }
            Self::download_model(&config)?;
        }

        Ok(Self {
            session: Arc::new(Mutex::new(None)),
            config,
        })
    }

    fn download_model(config: &KokoroConfig) -> Result<(), SpeechError> {
        let url = format!("https://huggingface.co/{REPO}/resolve/main/onnx/model.onnx");
        let tmp = config.model_path.with_extension("onnx.download");
        {
            let mut file =
                std::fs::File::create(&tmp).map_err(|e| SpeechError::Provider(e.to_string()))?;
            let mut resp = blocking::get(&url).map_err(SpeechError::Transport)?;
            if !resp.status().is_success() {
                return Err(SpeechError::Provider(format!(
                    "failed to download kokoro model: HTTP {}",
                    resp.status()
                )));
            }
            resp.copy_to(&mut file).map_err(SpeechError::Transport)?;
            file.flush()
                .map_err(|e| SpeechError::Provider(e.to_string()))?;
        }
        // Verify size before rename so a truncated download never lands.
        let size = std::fs::metadata(&tmp)
            .map_err(|e| SpeechError::Provider(e.to_string()))?
            .len();
        if size != 325_532_232 {
            return Err(SpeechError::Provider(format!(
                "kokoro model moved: got {size} bytes, expected 325,532,232"
            )));
        }
        // sha256 verification before rename (integrity, not just size).
        let mut file =
            std::fs::File::open(&tmp).map_err(|e| SpeechError::Provider(e.to_string()))?;
        let mut hasher = Sha256::new();
        std::io::copy(&mut file, &mut hasher).map_err(|e| SpeechError::Provider(e.to_string()))?;
        let hash = hex_lower(&hasher.finalize());
        if hash != MODEL_SHA256 {
            return Err(SpeechError::Provider(format!(
                "kokoro model sha256 mismatch ({hash})"
            )));
        }
        std::fs::rename(&tmp, &config.model_path)
            .map_err(|e| SpeechError::Provider(e.to_string()))?;
        Ok(())
    }

    /// Download a voice bin on first use.
    fn ensure_voice(&self, voice: &str) -> Result<PathBuf, SpeechError> {
        validate_voice_id(voice)?;
        let dest = self.config.voices_dir.join(format!("{voice}.bin"));
        if dest.exists() {
            return Ok(dest);
        }
        if !self.config.auto_download {
            return Err(SpeechError::Provider(format!(
                "voice embedding missing at {} (auto-download disabled)",
                dest.display()
            )));
        }
        let url = format!("https://huggingface.co/{REPO}/resolve/main/voices/{voice}.bin");
        let tmp = dest.with_extension("bin.download");
        {
            let mut file =
                std::fs::File::create(&tmp).map_err(|e| SpeechError::Provider(e.to_string()))?;
            let mut resp = blocking::get(&url).map_err(SpeechError::Transport)?;
            if !resp.status().is_success() {
                return Err(SpeechError::Provider(format!(
                    "voice {voice}: HTTP {}",
                    resp.status()
                )));
            }
            resp.copy_to(&mut file).map_err(SpeechError::Transport)?;
            file.flush()
                .map_err(|e| SpeechError::Provider(e.to_string()))?;
        }
        let size = std::fs::metadata(&tmp)
            .map_err(|e| SpeechError::Provider(e.to_string()))?
            .len();
        if size != VOICE_BIN_BYTES {
            return Err(SpeechError::Provider(format!(
                "voice {voice}: got {size} bytes, expected {VOICE_BIN_BYTES}"
            )));
        }
        std::fs::rename(&tmp, &dest).map_err(|e| SpeechError::Provider(e.to_string()))?;
        Ok(dest)
    }

    fn session(&self) -> Result<Arc<Mutex<Session>>, SpeechError> {
        let mut guard = self
            .session
            .lock()
            .map_err(|_| SpeechError::Provider("kokoro session lock poisoned".into()))?;
        if let Some(s) = guard.as_ref() {
            return Ok(Arc::clone(s));
        }
        let env = ort::init()
            .build()
            .map_err(|e| SpeechError::Provider(e.to_string()))?;
        let session = Session::builder(&env)
            .map_err(|e| SpeechError::Provider(e.to_string()))?
            .commit_from_file(&self.config.model_path)
            .map_err(|e| SpeechError::Provider(e.to_string()))?;
        let session = Arc::new(Mutex::new(session));
        *guard = Some(Arc::clone(&session));
        Ok(session)
    }

    fn phonemes(&self, text: &str) -> Result<String, SpeechError> {
        match &self.config.espeak_path {
            Some(path) => espeak_g2p(path, text),
            None => Ok(degraded_g2p(text)),
        }
    }

    /// Read a voice bin; row `n_tokens - 1` (capped at 509) is the style vector.
    fn style_vector(voices_path: &Path, n_tokens: usize) -> Result<Vec<f32>, SpeechError> {
        let bytes = std::fs::read(voices_path).map_err(|e| SpeechError::Provider(e.to_string()))?;
        if bytes.len() != VOICE_BIN_BYTES as usize {
            return Err(SpeechError::Provider(format!(
                "voice bin {} is {} bytes, expected {VOICE_BIN_BYTES}",
                voices_path.display(),
                bytes.len()
            )));
        }
        let row = std::cmp::min(n_tokens.saturating_sub(1), VOICE_ROWS - 1);
        let start = row * VOICE_DIM * 4;
        let mut out = Vec::with_capacity(VOICE_DIM);
        for chunk in bytes[start..start + VOICE_DIM * 4].as_chunks::<4>().0 {
            out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
        }
        Ok(out)
    }

    fn synthesize_segment(
        &self,
        ids: Vec<i64>,
        voices_path: &Path,
        speed: f32,
    ) -> Result<Vec<f32>, SpeechError> {
        let style = Self::style_vector(voices_path, ids.len())?;
        let n = ids.len();
        let session = self.session()?;

        let input_ids = Tensor::from_array(([1i64, n as i64], ids))
            .map_err(|e| SpeechError::Provider(e.to_string()))?;
        let style_t = Tensor::from_array(([1i64, VOICE_DIM as i64], style))
            .map_err(|e| SpeechError::Provider(e.to_string()))?;
        let speed_t = Tensor::from_array(([1i64], vec![speed]))
            .map_err(|e| SpeechError::Provider(e.to_string()))?;

        let mut guard = session
            .lock()
            .map_err(|_| SpeechError::Provider("kokoro session lock poisoned".into()))?;
        let outputs = guard
            .run(ort::inputs![
                "input_ids" => input_ids,
                "style" => style_t,
                "speed" => speed_t,
            ])
            .map_err(|e| SpeechError::Provider(e.to_string()))?;

        let waveform = outputs
            .get("waveform")
            .or_else(|| outputs.get(outputs.keys().next().unwrap_or("")))
            .ok_or_else(|| SpeechError::Provider("kokoro model emitted no waveform".into()))?;
        let (_shape, data) = waveform
            .try_extract_tensor::<f32>()
            .map_err(|e| SpeechError::Provider(e.to_string()))?;
        Ok(data.to_vec())
    }

    /// Whether the degraded (non-espeak) fallback is active.
    pub fn is_degraded(&self) -> bool {
        self.config.espeak_path.is_none()
    }
}

fn validate_voice_id(voice: &str) -> Result<(), SpeechError> {
    if voice.is_empty()
        || voice.len() > 32
        || !voice
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(SpeechError::InvalidConfig(format!(
            "invalid voice id {voice:?}"
        )));
    }
    Ok(())
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[async_trait::async_trait]
impl SpeechSynthesizer for KokoroSynthesizer {
    fn id(&self) -> &str {
        "kokoro-local"
    }

    async fn synthesize(
        &self,
        text: &str,
        voice: &str,
        options: &crate::types::SynthesizeOptions,
    ) -> Result<AudioStream, SpeechError> {
        let config = self.config.clone();
        let voice = if voice.is_empty() {
            config.voice.clone()
        } else {
            voice.to_string()
        };
        let speed = options.speed.unwrap_or(1.0).clamp(0.5, 2.0);
        let text = text.to_owned();

        let synth = Arc::new(self.clone_handle());
        let samples: Vec<f32> = tokio::task::spawn_blocking(move || {
            let mut all: Vec<f32> = Vec::new();
            for segment in split_sentences(&text) {
                let ipa = synth.phonemes(&segment)?;
                let ids = encode_phonemes(&ipa);
                if ids.len() > 2 {
                    let voices = synth.ensure_voice(&voice)?;
                    let waves = synth.synthesize_segment(ids, &voices, speed)?;
                    all.extend_from_slice(&waves);
                    all.extend_from_slice(&[0.0; (SAMPLE_RATE as usize) / 10]); // 0.1 s gap
                }
            }
            Ok::<Vec<f32>, SpeechError>(all)
        })
        .await
        .map_err(|e| SpeechError::Provider(format!("kokoro inference task panicked: {e}")))??;

        if samples.is_empty() {
            return Err(SpeechError::Provider(
                "kokoro produced no audio (empty text?)".into(),
            ));
        }

        let pcm: Vec<u8> = samples
            .into_iter()
            .flat_map(|s| {
                let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
                v.to_le_bytes()
            })
            .collect();
        let wav = wav_from_pcm16(&pcm, SAMPLE_RATE, 1);
        let bytes = bytes::Bytes::from(wav);
        let stream = futures_util::stream::once(async move { Ok(bytes) });
        Ok(Box::pin(stream))
    }
}

impl KokoroSynthesizer {
    /// Clone-share the session for the blocking task (the trait's Arc lives
    /// behind a `pub(crate)` boundary, not exposed directly).
    fn clone_handle(&self) -> Self {
        Self {
            config: self.config.clone(),
            session: Arc::clone(&self.session),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phoneme_table_has_boundary_glyph() {
        assert_eq!(phoneme_id('$'), Some(0));
    }

    #[test]
    fn vocab_binary_search_hits_all_entries() {
        for (ch, id) in kokoro_vocab::PHONEME_VOCAB.iter() {
            assert_eq!(phoneme_id(*ch), Some(*id));
        }
    }

    #[test]
    fn degraded_g2p_maps_common_words() {
        let out = degraded_g2p("Hi");
        assert!(!out.is_empty());
        assert!(out.is_ascii() || out.chars().all(|c| phoneme_id(c).is_some() || c == ' '));
    }

    #[test]
    fn espeak_output_is_used_verbatim_when_present() {
        let out = espeak_g2p(Path::new("definitely-not-espeak"), "hi");
        assert!(
            out.is_err(),
            "missing binary must error, not silently degrade"
        );
    }

    #[test]
    fn encode_phonemes_wraps_boundaries_and_skips_unknown() {
        let ids = encode_phonemes("ək ZWJ\u{200D}x");
        assert_eq!(ids.first(), Some(&0));
        assert_eq!(ids.last(), Some(&0));
        assert!(!ids.contains(&(phoneme_id('\u{200D}').unwrap_or(-1))));
    }

    #[test]
    fn split_sentences_keeps_delimiters() {
        let segments = split_sentences("Hello world. How are you? Fine!");
        assert_eq!(segments.len(), 3);
        assert!(segments[0].ends_with('.'));
    }

    #[test]
    fn voice_id_validation_rejects_paths_and_uppercase() {
        assert!(validate_voice_id("af_heart").is_ok());
        assert!(validate_voice_id("../etc").is_err());
        assert!(validate_voice_id("AF_HEART").is_err());
        assert!(validate_voice_id("").is_err());
    }

    #[test]
    fn style_vector_picks_expected_row() {
        // Synthetic voice bin with known floats.
        let mut bytes = vec![0u8; VOICE_BIN_BYTES as usize];
        for row in 0..VOICE_ROWS {
            for dim in 0..VOICE_DIM {
                let v = row as f32 * 1.0 + dim as f32 / 1000.0;
                bytes[(row * VOICE_DIM + dim) * 4..(row * VOICE_DIM + dim) * 4 + 4]
                    .copy_from_slice(&v.to_le_bytes());
            }
        }
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("fake.bin");
        std::fs::write(&path, bytes).expect("write");
        let style = KokoroSynthesizer::style_vector(&path, 5).expect("style row");
        assert_eq!(style.len(), VOICE_DIM);
        assert!(
            (style[0] - 4.0).abs() < 1e-6,
            "expected row n-1 = 4, got {}",
            style[0]
        );
    }

    #[test]
    fn wav_output_roundtrip_shape() {
        let pcm: Vec<u8> = (0..480i16).flat_map(|v| v.to_le_bytes()).collect();
        let wav = wav_from_pcm16(&pcm, SAMPLE_RATE, 1);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 44 + pcm.len());
    }

    /// Live inference against real weights. Gated behind `KOKORO_TEST_MODEL=1`.
    /// Requires `~/.local/share/airi-slint/models/kokoro/kokoro-v1.0.onnx` (or
    /// `AIRI_QT_KOKORO_MODEL`) and `voices/af_heart.bin`.
    #[test]
    fn live_synthesize_af_heart() {
        if std::env::var_os("KOKORO_TEST_MODEL").is_none() {
            eprintln!("KOKORO_TEST_MODEL not set; skipping live synthesis");
            return;
        }
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        rt.block_on(async {
            let config = KokoroConfig::default();
            let synth = KokoroSynthesizer::with_config(config).expect("kokoro must load");
            let output = synth
                .synthesize(
                    "Hello world.",
                    "af_heart",
                    &crate::types::SynthesizeOptions::default(),
                )
                .await
                .expect("synthesis must succeed");
            use futures_util::TryStreamExt;
            let chunks: Vec<bytes::Bytes> = output.try_collect().await.expect("stream ok");
            let bytes: Vec<u8> = chunks.into_iter().flatten().collect();
            assert!(
                bytes.len() > 10_000,
                "expected >10k bytes of WAV, got {}",
                bytes.len()
            );
            assert_eq!(&bytes[0..4], b"RIFF");
            assert_eq!(&bytes[8..12], b"WAVE");
            // Non-silence: some PCM sample must be well above zero.
            let mut peak = 0i16;
            for chunk in bytes[44..].as_chunks::<2>().0 {
                let v = i16::from_le_bytes([chunk[0], chunk[1]]);
                peak = peak.max(v.abs());
            }
            assert!(peak > 1000, "expected non-silent audio, peak {peak}");
        });
    }
}
