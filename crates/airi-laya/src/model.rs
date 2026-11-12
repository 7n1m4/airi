// SPDX-License-Identifier: GPL-3.0-or-later

//! `LayaModel`: in-process ModernBERT inference through `ort`.
//!
//! Loads an exported ModernBERT ONNX graph and a Hugging Face `tokenizer.json`,
//! then answers decision questions. The prompt format, tensor names, and
//! decoding temperatures follow the AIRI web worker
//! (`packages/stage-ui/src/workers/laya/worker.ts`) exactly, so the native
//! runtime is wire-compatible with the web path.
//!
//! # Model sources
//!
//! The weights live on Hugging Face and are downloaded on demand into
//! `dirs::data_dir()/airi-qt/models/laya/`. They are **never committed**.
//! Laya family (ModernBERT-large, 16 attention heads):
//!
//! - `bgoldfarb93/laya-int8` @ `e6c564dc…` — `laya.onnx` (int8, ~633 MB).
//! - `onnx-community/laya-ONNX` @ `42e2a6e3…` — `onnx/model_fp16.onnx` (fp16,
//!   ~847 MB, external-data, out of scope until external weights land).
//!
//! The graph's input signature (verified against the exported model) is:
//! `input_ids : i64[batch, seq]`, `attention_mask : i64[batch, seq]`,
//! `marker_pos : i64[batch, options]`, `marker_mask : bool[batch, options]`,
//! `qtype : i64[batch]`, with outputs `logits : f32[batch, options]` and
//! `act_probs : f32[batch, 2]`. As in the web worker, `act_probs` is
//! exported but unconsumed.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use ort::error::ErrorCode;
use ort::session::Session;
use ort::value::Tensor;
use reqwest::blocking;

use crate::error::LayaError;
use crate::question::{
    build_sequence, confidence_from_probs, round4, softmax, temperature_for, LayaAnswer,
    LayaQuestion, PAD_ID,
};
use crate::tokenizer::{LayaTokenizer, MAX_SEQ_LEN};

/// Default Hugging Face source for the int8 Laya weights.
pub const DEFAULT_REPO: &str = "bgoldfarb93/laya-int8";
/// Pinned revision of the int8 weights.
pub const DEFAULT_REVISION: &str = "e6c564dc6d3b2df54cc21ba963fc2f3e62303edf";
/// Default weights file name within the repo.
pub const DEFAULT_MODEL_FILE: &str = "laya.onnx";
/// Default tokenizer repo (identical tokenizer files to the checkpoint).
pub const DEFAULT_TOKENIZER_REPO: &str = "onnx-community/laya-ONNX";
/// Default tokenizer revision.
pub const DEFAULT_TOKENIZER_REVISION: &str = "42e2a6e3b3708c8ff5f61f4aa75c314b1449199b";

/// Configuration for [`LayaModel`].
#[derive(Debug, Clone)]
pub struct ModelConfig {
    /// Path to the ONNX model file. If missing and `auto_download` is set, the
    /// file is fetched from `model_repo`/`model_revision`/`model_file`.
    pub model_path: PathBuf,
    /// Path to the `tokenizer.json` file. If missing and `auto_download` is
    /// set, the tokenizer is fetched from `tokenizer_repo`/`tokenizer_revision`
    /// as `tokenizer.json`.
    pub tokenizer_path: PathBuf,
    /// Hugging Face repo hosting the weights.
    pub model_repo: String,
    /// Pinned commit of the weights repo.
    pub model_revision: String,
    /// Weights file inside the repo.
    pub model_file: String,
    /// Hugging Face repo hosting the tokenizer.
    pub tokenizer_repo: String,
    /// Pinned commit of the tokenizer repo.
    pub tokenizer_revision: String,
    /// Whether to auto-download missing files on construction.
    pub auto_download: bool,
    /// Minimum acceptable size (bytes) of the weights file; below this the
    /// download is treated as truncated.
    pub min_weights_bytes: Option<u64>,
    /// Directory for downloaded models (defaults to
    /// `dirs::data_dir()/airi-qt/models/laya/`).
    pub model_dir: Option<PathBuf>,
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            model_path: default_model_dir().join("laya.onnx"),
            tokenizer_path: default_model_dir().join("tokenizer.json"),
            model_repo: DEFAULT_REPO.to_string(),
            model_revision: DEFAULT_REVISION.to_string(),
            model_file: DEFAULT_MODEL_FILE.to_string(),
            tokenizer_repo: DEFAULT_TOKENIZER_REPO.to_string(),
            tokenizer_revision: DEFAULT_TOKENIZER_REVISION.to_string(),
            auto_download: true,
            min_weights_bytes: Some(600_000_000),
            model_dir: None,
        }
    }
}

/// Where downloaded models live by default.
fn default_model_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or(std::env::temp_dir())
        .join("airi-qt")
        .join("models")
        .join("laya")
}

/// The Laya ModernBERT decision model.
///
/// Holds a compiled ONNX Runtime `Session` and a tokenizer. `Session` is
/// `Send + Sync` but `run` takes `&mut self`, so inference is serialized
/// behind a `Mutex`. Cheap to clone; clones share the session.
#[derive(Clone)]
pub struct LayaModel {
    session: Arc<Mutex<Session>>,
    tokenizer: LayaTokenizer,
}

impl std::fmt::Debug for LayaModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LayaModel")
            .field("tokenizer", &"<LayaTokenizer>")
            .field("session", &"<ort Session>")
            .finish_non_exhaustive()
    }
}

impl LayaModel {
    /// Build a model from an explicit weights path.
    ///
    /// Loads `<model_path>` (ONNX) and its sibling `tokenizer.json`. Does not download.
    pub fn new(model_path: impl AsRef<Path>) -> Result<Self, LayaError> {
        let model_path = model_path.as_ref().to_path_buf();
        let tokenizer_path = model_path
            .parent()
            .map(|p| p.join("tokenizer.json"))
            .unwrap_or_else(|| model_path.clone());
        Self::with_config(ModelConfig {
            model_path,
            tokenizer_path,
            auto_download: false,
            ..Default::default()
        })
    }

    /// Build a model from a full config, auto-downloading when enabled.
    pub fn with_config(mut config: ModelConfig) -> Result<Self, LayaError> {
        let model_dir = config.model_dir.take().unwrap_or_else(default_model_dir);
        std::fs::create_dir_all(&model_dir).map_err(|e| LayaError::Io { source: e })?;

        let model_path = if config.auto_download && !config.model_path.exists() {
            Self::download_weights(&config, &model_dir)?
        } else {
            config.model_path.clone()
        };
        if !model_path.exists() {
            return Err(LayaError::NotFound { path: model_path });
        }

        let tokenizer_path = if config.auto_download && !config.tokenizer_path.exists() {
            Self::download_tokenizer(&config, &model_dir)?
        } else {
            config.tokenizer_path.clone()
        };
        if !tokenizer_path.exists() {
            return Err(LayaError::NotFound {
                path: tokenizer_path,
            });
        }

        let env = ort::init().build().map_err(|e| LayaError::ModelLoad {
            path: model_path.clone(),
            source: e,
        })?;

        let session = Session::builder(&env)
            .map_err(|e| LayaError::ModelLoad {
                path: model_path.clone(),
                source: e,
            })?
            .commit_from_file(&model_path)
            .map_err(|e| LayaError::ModelLoad {
                path: model_path.clone(),
                source: e,
            })?;

        Ok(Self {
            session: Arc::new(Mutex::new(session)),
            tokenizer: LayaTokenizer::from_file(&tokenizer_path)?,
        })
    }

    /// Answer a single question.
    pub fn decide(&self, question: &LayaQuestion, state: &str) -> Result<LayaAnswer, LayaError> {
        let mut answers = self.decide_batch(std::slice::from_ref(question), state)?;
        answers
            .pop()
            .ok_or_else(|| LayaError::OutputShape { shape: vec![0, 0] })
    }

    /// Answer several questions in one batched pass.
    ///
    /// Unlike the WebGPU worker no sub-batching is applied; attention-memory
    /// pressure is the caller's concern.
    pub fn decide_batch(
        &self,
        questions: &[LayaQuestion],
        state: &str,
    ) -> Result<Vec<LayaAnswer>, LayaError> {
        if questions.is_empty() {
            return Err(LayaError::Input("at least one question is required".into()));
        }
        let prepared: Vec<_> = questions
            .iter()
            .map(|q| build_sequence(q, state, &self.tokenizer, MAX_SEQ_LEN))
            .collect::<Result<_, _>>()?;

        let batch = prepared.len();
        let seq_len = prepared.iter().map(|p| p.ids.len()).max().unwrap_or(1);
        let max_markers = prepared.iter().map(|p| p.markers.len()).max().unwrap_or(0);
        // Graph's act-head does an unconditional topk(2, options), so a
        // batch whose widest question has one option must still feed a
        // 2-wide marker axis.
        let options = std::cmp::max(2, max_markers);

        let mut input_ids = vec![PAD_ID; batch * seq_len];
        let mut attention_mask = vec![0i64; batch * seq_len];
        let mut marker_pos = vec![0i64; batch * options];
        let mut marker_mask = vec![false; batch * options];
        let mut qtype = vec![0i64; batch];

        for (i, prep) in prepared.iter().enumerate() {
            for (j, &id) in prep.ids.iter().enumerate() {
                input_ids[i * seq_len + j] = id;
                attention_mask[i * seq_len + j] = 1;
            }
            for (j, &m) in prep.markers.iter().enumerate() {
                marker_pos[i * options + j] = m;
                marker_mask[i * options + j] = true;
            }
            qtype[i] = prep.qtype;
        }

        let ids_shape = [batch as i64, seq_len as i64];
        let options_shape = [batch as i64, options as i64];

        let input_ids_t = Tensor::from_array((ids_shape, input_ids))
            .map_err(|e| LayaError::Inference { source: e })?;
        let attention_mask_t = Tensor::from_array((ids_shape, attention_mask))
            .map_err(|e| LayaError::Inference { source: e })?;
        let marker_pos_t = Tensor::from_array((options_shape, marker_pos))
            .map_err(|e| LayaError::Inference { source: e })?;
        let marker_mask_t = Tensor::from_array((options_shape, marker_mask))
            .map_err(|e| LayaError::Inference { source: e })?;
        let qtype_t = Tensor::from_array(([batch as i64], qtype))
            .map_err(|e| LayaError::Inference { source: e })?;

        let mut session = self.session.lock().map_err(|_| LayaError::Inference {
            source: ort::Error::new_with_code(ErrorCode::InvalidArgument, "session lock poisoned"),
        })?;

        let outputs = session
            .run(ort::inputs![
                "input_ids" => input_ids_t,
                "attention_mask" => attention_mask_t,
                "marker_pos" => marker_pos_t,
                "marker_mask" => marker_mask_t,
                "qtype" => qtype_t,
            ])
            .map_err(|e| LayaError::Inference { source: e })?;

        let logits = match outputs.get("logits") {
            Some(t) => t,
            None if outputs.len() > 0 => &outputs[0],
            None => return Err(LayaError::OutputShape { shape: vec![] }),
        };

        let (shape, flat) = logits
            .try_extract_tensor::<f32>()
            .map_err(|e| LayaError::Inference { source: e })?;
        let shape: Vec<i64> = shape.iter().copied().collect();
        let flat = flat.to_vec();

        decode_answers(&flat, &shape, questions)
    }

    /// Download the weights file into the model dir.
    fn download_weights(config: &ModelConfig, model_dir: &Path) -> Result<PathBuf, LayaError> {
        let url = format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            config.model_repo, config.model_revision, config.model_file
        );
        let dest = model_dir.join(&config.model_file);
        Self::download_file(&url, &dest, config.min_weights_bytes, "weights")
    }

    /// Download the tokenizer into the model dir.
    fn download_tokenizer(config: &ModelConfig, model_dir: &Path) -> Result<PathBuf, LayaError> {
        let url = format!(
            "https://huggingface.co/{}/resolve/{}/tokenizer.json",
            config.tokenizer_repo, config.tokenizer_revision
        );
        let dest = model_dir.join("tokenizer.json");
        Self::download_file(&url, &dest, None, "tokenizer")
    }

    /// Stream-download a file, optionally enforcing a minimum size.
    fn download_file(
        url: &str,
        dest: &Path,
        min_size: Option<u64>,
        what: &str,
    ) -> Result<PathBuf, LayaError> {
        let mut file = std::fs::File::create(dest).map_err(|e| LayaError::Io { source: e })?;
        let mut resp = blocking::get(url).map_err(|e| LayaError::Download {
            what: what.into(),
            url: url.into(),
            source: e,
        })?;
        if !resp.status().is_success() {
            return Err(LayaError::HttpStatus {
                what: what.into(),
                url: url.into(),
                status: resp.status(),
            });
        }
        resp.copy_to(&mut file).map_err(|e| LayaError::Download {
            what: what.into(),
            url: url.into(),
            source: e,
        })?;

        let actual = std::fs::metadata(dest)
            .map_err(|e| LayaError::Io { source: e })?
            .len();
        if let Some(min) = min_size {
            if actual < min {
                return Err(LayaError::Integrity {
                    what: what.into(),
                    reason: format!("{actual} bytes < {min} minimum"),
                });
            }
        }
        Ok(dest.to_path_buf())
    }
}

/// Decode the `logits [batch, options]` tensor into per-question answers.
fn decode_answers(
    flat: &[f32],
    shape: &[i64],
    questions: &[LayaQuestion],
) -> Result<Vec<LayaAnswer>, LayaError> {
    if shape.len() != 2 {
        return Err(LayaError::OutputShape {
            shape: shape.to_vec(),
        });
    }
    let batch = shape[0] as usize;
    let width = shape[1] as usize;
    if batch != questions.len() || flat.len() < batch * width {
        return Err(LayaError::OutputShape {
            shape: shape.to_vec(),
        });
    }
    // The graph's padded option axis must cover every question's option count.
    for question in questions {
        if question.rendered_options().len() > width {
            return Err(LayaError::OutputShape {
                shape: shape.to_vec(),
            });
        }
    }

    let mut out = Vec::with_capacity(batch);
    for (row, question) in questions.iter().enumerate() {
        let k = question.rendered_options().len();
        let row_slice = &flat[row * width..row * width + k];
        let temperature = temperature_for(question.qtype(), k);
        let scaled: Vec<f32> = row_slice.iter().map(|&v| v / temperature).collect();
        let probs = softmax(&scaled);
        let confidence = round4(confidence_from_probs(&probs));

        let answer = match question {
            LayaQuestion::Choice { criteria, .. } => {
                let ids: Vec<String> = criteria.iter().map(|(id, _)| id.clone()).collect();
                let best = probs
                    .iter()
                    .enumerate()
                    .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|(idx, _)| idx)
                    .unwrap_or(0);
                let probabilities = ids
                    .iter()
                    .zip(probs.iter())
                    .map(|(id, p)| (id.clone(), round4(*p)))
                    .collect();
                LayaAnswer::Choice {
                    choice: ids[best].clone(),
                    probabilities,
                    confidence,
                }
            }
            LayaQuestion::Score { .. } => {
                let score = round4(
                    probs
                        .iter()
                        .enumerate()
                        .map(|(idx, p)| idx as f32 * p)
                        .sum::<f32>(),
                );
                let probabilities = probs
                    .iter()
                    .enumerate()
                    .map(|(idx, p)| (idx.to_string(), round4(*p)))
                    .collect();
                LayaAnswer::Score {
                    score,
                    probabilities,
                    confidence,
                }
            }
            LayaQuestion::Noul { .. } => {
                let noul = round4(probs.get(1).copied().unwrap_or(0.0));
                let probabilities = [
                    (
                        "true".to_string(),
                        round4(probs.first().copied().unwrap_or(0.0)),
                    ),
                    ("false".to_string(), noul),
                ]
                .into_iter()
                .collect();
                LayaAnswer::Noul {
                    noul,
                    probabilities,
                    confidence,
                }
            }
        };
        out.push(answer);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::question::Qtype;

    #[test]
    fn decode_choice_picks_argmax_with_temperature_one() {
        // k = 2, "choice:2" temperature is 1.9064 (non-1) — use qtype noul
        // instead for identity-ish math, or just check shape + validity.
        let question = LayaQuestion::Choice {
            instructions: "pick one".into(),
            criteria: vec![("a".into(), None), ("b".into(), None)],
        };
        let answers =
            decode_answers(&[0.0, 5.0], &[1, 2], std::slice::from_ref(&question)).expect("decode");
        let LayaAnswer::Choice {
            choice,
            probabilities,
            confidence,
        } = &answers[0]
        else {
            panic!("expected choice answer")
        };
        assert_eq!(choice, "b");
        assert_eq!(probabilities.len(), 2);
        let sum: f32 = probabilities.values().sum();
        assert!(
            (sum - 1.0).abs() < 1e-3,
            "rounded probs should still sum to ~1, got {sum}"
        );
        assert!(*confidence > 0.0 && *confidence <= 1.0);
    }

    #[test]
    fn decode_noul_reports_false_probability() {
        let question = LayaQuestion::Noul {
            instructions: "the sky is blue".into(),
        };
        // "noul:2" temperature is ~1.98, so probs are near-uniform but the
        // larger logit must still win.
        let answers =
            decode_answers(&[10.0, 0.0], &[1, 2], std::slice::from_ref(&question)).expect("decode");
        let LayaAnswer::Noul {
            noul,
            probabilities,
            ..
        } = &answers[0]
        else {
            panic!("expected noul answer")
        };
        assert!(
            *noul < 0.5,
            "p[1] should be < 0.5 for logits [10, 0], got {noul}"
        );
        assert_eq!(probabilities.len(), 2);
    }

    #[test]
    fn decode_score_expectation_scales_with_mass() {
        let question = LayaQuestion::Score {
            instructions: "rate".into(),
            levels: vec!["low".into(), "mid".into(), "high".into()],
        };
        // "score:3-5" temperature 1.25 — the high level must dominate.
        let answers = decode_answers(&[0.0, 0.0, 8.0], &[1, 3], std::slice::from_ref(&question))
            .expect("decode");
        let LayaAnswer::Score {
            score,
            probabilities,
            ..
        } = &answers[0]
        else {
            panic!("expected score answer")
        };
        assert!(
            *score > 1.9,
            "expectation should lean to index 2, got {score}"
        );
        assert_eq!(probabilities.len(), 3);
    }

    #[test]
    fn decode_rejects_wrong_batch() {
        let question = LayaQuestion::Noul {
            instructions: "x".into(),
        };
        assert!(decode_answers(&[1.0], &[1, 1], std::slice::from_ref(&question)).is_err());
        assert!(decode_answers(&[1.0], &[2, 1], std::slice::from_ref(&question)).is_err());
    }

    #[test]
    fn temperature_table_handles_missing_score_bucket() {
        assert!((temperature_for(Qtype::Score, 7) - 1.0).abs() < 1e-7);
        assert!((temperature_for(Qtype::Score, 3) - 1.251_43).abs() < 1e-6);
    }

    #[test]
    fn new_rejects_missing_weights_without_download() {
        let err = LayaModel::new("/nonexistent/laya.onnx").unwrap_err();
        assert!(matches!(
            err,
            LayaError::NotFound { .. }
                | LayaError::TokenizerLoad { .. }
                | LayaError::ModelLoad { .. }
        ));
    }

    #[test]
    fn default_config_points_at_int8_revision() {
        let cfg = ModelConfig::default();
        assert_eq!(cfg.model_repo, DEFAULT_REPO);
        assert_eq!(cfg.model_revision, DEFAULT_REVISION);
        assert_eq!(cfg.tokenizer_repo, DEFAULT_TOKENIZER_REPO);
        assert!(cfg.auto_download);
    }

    /// Live inference against real weights. Gated behind `LAYA_TEST_MODEL`
    /// (a path to the int8 ONNX weights with a sibling `tokenizer.json`) so the
    /// default test suite stays hermetic and offline. Run manually with
    /// `LAYA_TEST_MODEL=/path/to/laya.onnx cargo test -p airi-laya live_decide`.
    #[test]
    fn live_decide() {
        let Some(model_path) = std::env::var_os("LAYA_TEST_MODEL") else {
            eprintln!("LAYA_TEST_MODEL not set; skipping live inference");
            return;
        };
        let model = LayaModel::new(model_path).expect("model + tokenizer must load");
        const STATE: &str = "The user said 'tell me a joke'.";

        let choice = LayaQuestion::Choice {
            instructions: "Should the assistant reply with a joke?".into(),
            criteria: vec![
                ("yes".into(), Some("tell the joke".into())),
                ("no".into(), Some("stay serious".into())),
            ],
        };
        let answer = model
            .decide(&choice, STATE)
            .expect("choice decision must succeed");
        if std::env::var_os("LAYA_DEBUG").is_some() {
            eprintln!("choice answer: {answer:?}");
        }
        match &answer {
            LayaAnswer::Choice {
                choice,
                probabilities,
                confidence,
            } => {
                assert!([&"yes".to_string(), &"no".to_string()].contains(&choice));
                let sum: f32 = probabilities.values().sum();
                assert!(
                    (sum - 1.0).abs() < 1e-3,
                    "probabilities should sum to ~1, got {sum}"
                );
                assert!(confidence.is_finite() && (0.0..=1.0).contains(confidence));
            }
            other => panic!("expected choice answer, got {other:?}"),
        }

        let score = LayaQuestion::Score {
            instructions: "How willing is the user to hear the joke?".into(),
            levels: vec!["hostile".into(), "neutral".into(), "eager".into()],
        };
        let answer = model
            .decide(&score, STATE)
            .expect("score decision must succeed");
        if std::env::var_os("LAYA_DEBUG").is_some() {
            eprintln!("score answer: {answer:?}");
        }
        match &answer {
            LayaAnswer::Score {
                score,
                probabilities,
                confidence,
            } => {
                assert!(score.is_finite() && (0.0..=2.0).contains(score));
                let sum: f32 = probabilities.values().sum();
                assert!((sum - 1.0).abs() < 1e-3);
                assert!(confidence.is_finite() && (0.0..=1.0).contains(confidence));
            }
            other => panic!("expected score answer, got {other:?}"),
        }

        let noul = LayaQuestion::Noul {
            instructions: "The user wants to hear a joke.".into(),
        };
        let answer = model
            .decide(&noul, STATE)
            .expect("noul decision must succeed");
        if std::env::var_os("LAYA_DEBUG").is_some() {
            eprintln!("noul answer: {answer:?}");
        }
        match &answer {
            LayaAnswer::Noul {
                noul,
                probabilities,
                ..
            } => {
                assert!(*noul >= 0.0 && *noul <= 1.0);
                assert_eq!(probabilities.len(), 2);
            }
            other => panic!("expected noul answer, got {other:?}"),
        }
    }
}
