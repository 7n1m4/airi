// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! `airi-laya`: in-process Laya decision-model runtime for the AIRI
//! System-1 gate.
//!
//! Runs an exported ModernBERT ONNX graph locally through [`ort`] (sharing the
//! runtime with the Silero lane) and a Hugging Face `tokenizers` BPE
//! tokenizer. No Python, no HTTP model server, no OpenRouter dependency for
//! the gate itself.
//!
//! The prompt assembly, span-marker alignment, tensor names, and decoding
//! temperatures are a port of the AIRI web worker
//! (`packages/stage-ui/src/workers/laya/worker.ts` + `prep.ts`),
//! so native answers match web answers bit-for-bit at the softmax layer.
//!
//! # Public API
//!
//! - [`LayaModel::new`] / [`LayaModel::with_config`] — load (or auto-download)
//!   the weights + tokenizer.
//! - [`LayaModel::decide`] / [`LayaModel::decide_batch`] — one or many
//!   decision questions against a shared state snapshot.
//! - [`LayaQuestion`] — the typed question model (`choice` / `score` / `noul`);
//!   [`LayaQuestion::from_json`] accepts AIRI's loose wire shape.
//! - [`LayaAnswer`] — answer with per-option probabilities and a
//!   normalized-entropy confidence.
//!
//! # Model provenance
//!
//! Weights live on Hugging Face and are downloaded on demand into
//! `dirs::data_dir()/airi-qt/models/laya/` (never committed):
//!
//! - `bgoldfarb93/laya-int8` @ `e6c564dc…` — `laya.onnx` (int8, ~633 MB).
//! - `onnx-community/laya-ONNX` @ `42e2a6e3…` — `tokenizer.json`, shared.
//!
//! # Testing
//!
//! Model-independent tests (sequence assembly, softmax, temperatures,
//! decoding) run unconditionally. Live inference against real weights is gated
//! behind the `LAYA_TEST_MODEL` environment variable and is **not** part of
//! the default test suite.
//!
//! # Integration
//!
//! `airi-llm` is intentionally **not** modified here. A future P9 lane can
//! wrap `LayaModel` behind the `airi_llm::ChatProvider` trait (the
//! `laya-local` / `typesafe-ai` stubs in `airi-llm` currently report
//! `UnsupportedProvider`); see `docs/phase-notes/p9-laya.md` for the wiring
//! sketch.

pub mod error;
pub mod model;
pub mod question;
pub mod tokenizer;

pub use error::LayaError;
pub use model::{LayaModel, ModelConfig, DEFAULT_MODEL_FILE, DEFAULT_REPO, DEFAULT_REVISION};
pub use question::{
    build_sequence, confidence_from_probs, py_json_dumps, serialize_state, softmax, temp_bucket,
    temperature_for, LayaAnswer, LayaQuestion, PreparedSequence, Qtype, TextEncoder, CLS_ID,
    HEAD_MAX_LEN, MASK_ID, OPTION_TOKEN_CAP, PAD_ID, SEP_ID,
};
pub use tokenizer::{Encoding, LayaTokenizer, MAX_SEQ_LEN};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn re_exports_resolve() {
        let _ = PAD_ID;
        let _ = CLS_ID;
        let _ = SEP_ID;
        let _ = MASK_ID;
        let err = LayaModel::new("/nonexistent.onnx").unwrap_err();
        assert!(matches!(
            err,
            LayaError::NotFound { .. }
                | LayaError::Io { .. }
                | LayaError::TokenizerLoad { .. }
                | LayaError::ModelLoad { .. }
        ));
    }
}
