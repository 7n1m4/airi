// SPDX-License-Identifier: GPL-3.0-or-later

//! Errors for the Laya ModernBERT decision model.
//!
//! Every failure is surfaced as a typed [`LayaError`] so callers (and the
//! future `airi-llm` wiring) can distinguish transient download/transport
//! problems from permanent model/config problems without string matching.

use std::io;
use std::num::TryFromIntError;
use std::path::PathBuf;

use reqwest::StatusCode;
use thiserror::Error;

/// All errors produced by `airi-laya`.
#[derive(Debug, Error)]
pub enum LayaError {
    /// The model file or tokenizer could not be found on disk and auto-download
    /// is disabled (or the model path was given explicitly and doesn't exist).
    #[error("model not found at {path:?}; set LAYA_TEST_MODEL or place the ONNX weights and tokenizer.json there")]
    NotFound {
        /// Path that was looked for.
        path: PathBuf,
    },

    /// The ONNX graph failed to load.
    #[error("failed to load ONNX model at {path:?}: {source}")]
    ModelLoad {
        /// Path of the ONNX file that failed to load.
        path: PathBuf,
        /// Underlying `ort` error.
        #[source]
        source: ort::Error,
    },

    /// The tokenizer file failed to load.
    #[error("failed to load tokenizer at {path:?}: {source}")]
    TokenizerLoad {
        /// Path of the `tokenizer.json` that failed to load.
        path: PathBuf,
        /// Underlying Hugging Face `tokenizers` error.
        #[source]
        source: tokenizers::tokenizer::Error,
    },

    /// The tokenizer produced no usable encoding for the input.
    #[error("tokenizer produced no ids for input: {0}")]
    Tokenize(String),

    /// Inference failed.
    #[error("inference failed: {source}")]
    Inference {
        /// Underlying `ort` error.
        #[source]
        source: ort::Error,
    },

    /// The model's output tensor was not a 2-D f32 logits tensor, or its shape
    /// was unexpected.
    #[error("unexpected model output shape: {shape:?}")]
    OutputShape {
        /// Shape of the output tensor the model emitted.
        shape: Vec<i64>,
    },

    /// Input validation failed before inference (wrong question type, empty
    /// options, malformed JSON boundary).
    #[error("invalid input: {0}")]
    Input(String),

    /// Auto-download of the model weights or tokenizer failed.
    #[error("failed to download {what} from {url}: {source}")]
    Download {
        /// What was being downloaded (`weights`, `tokenizer`).
        what: String,
        /// URL the download was attempted from.
        url: String,
        /// Underlying `reqwest` error.
        #[source]
        source: reqwest::Error,
    },

    /// The downloaded file failed an integrity check.
    #[error("downloaded {what} failed integrity check: {reason}")]
    Integrity {
        /// What was being downloaded (`weights`, `tokenizer`).
        what: String,
        /// Why the integrity check failed.
        reason: String,
    },

    /// Filesystem / I/O failure outside of reqwest/ort.
    #[error("io error: {source}")]
    Io {
        /// Underlying I/O error.
        #[source]
        source: io::Error,
    },

    /// Numeric conversion failure (e.g. usize↔i64 tensor dims).
    #[error("numeric conversion error: {source}")]
    Numeric {
        /// Underlying numeric conversion error.
        #[source]
        source: TryFromIntError,
    },

    /// HTTP status error surfaced with its status code for retry decisions.
    #[error("HTTP {status} while downloading {what} from {url}")]
    HttpStatus {
        /// What was being downloaded (`weights`, `tokenizer`).
        what: String,
        /// URL the download was attempted from.
        url: String,
        /// HTTP status code returned by the server.
        status: StatusCode,
    },
}

impl LayaError {
    /// Whether this error is transient and a retry/download re-attempt is sensible.
    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            LayaError::Download { .. } | LayaError::HttpStatus { .. } | LayaError::Io { .. }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_is_not_transient() {
        let err = LayaError::NotFound {
            path: PathBuf::from("/nope.onnx"),
        };
        assert!(!err.is_transient());
    }

    #[test]
    fn input_message() {
        let err = LayaError::Input("bad criteria".into());
        assert_eq!(err.to_string(), "invalid input: bad criteria");
    }
}
