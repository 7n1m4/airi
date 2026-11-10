// SPDX-License-Identifier: GPL-3.0-or-later

//! Tokenizer wrapper for the Laya ModernBERT checkpoint.
//!
//! Loads a Hugging Face `tokenizer.json` produced for ModernBERT (BPE with
//! `[CLS]`/`[SEP]`/`[MASK]`/`[PAD]` special tokens; the Laya ONNX export ships
//! a BPE graph, not WordPiece) and exposes the encoding the ONNX graph
//! expects: `input_ids` and `attention_mask`. The `tokenizers` crate is
//! algorithm-agnostic, so this wrapper works unchanged for either family.

use std::path::Path;
use std::sync::Arc;

use tokenizers::{Tokenizer as HfTokenizer, TruncationDirection};

/// Maximum sequence length the encoder accepts, in tokens.
///
/// Mirrors `LAYA_MAX_SEQ_LEN` from the stage-ui port (`4096`). The exported
/// ModernBERT graph takes dynamic lengths; this is the cap we feed at
/// inference time so the attention buffer stays bounded.
pub const MAX_SEQ_LEN: usize = 4096;

/// Token ids produced by the tokenizer plus the attention mask.
///
/// `ids` and `mask` are parallel slices of length `len`. All values fit in
/// `u32` (token ids are `u32` in the HF `tokenizers` crate).
#[derive(Debug, Clone)]
pub struct Encoding {
    /// Token ids, including special tokens (CLS/SEP/PAD).
    pub ids: Vec<u32>,
    /// Attention mask: 1 for real tokens, 0 for padding.
    pub mask: Vec<u32>,
    /// Number of real (non-pad) tokens.
    pub len: usize,
}

/// Thin wrapper around the HF `tokenizers::Tokenizer`.
///
/// Cheap to clone; all clones share the same compiled tokenizer state.
#[derive(Clone)]
pub struct LayaTokenizer {
    inner: Arc<HfTokenizer>,
}

impl LayaTokenizer {
    /// Load a tokenizer from a `tokenizer.json` file on disk.
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self, crate::LayaError> {
        let path = path.as_ref();
        let hf =
            HfTokenizer::from_file(path).map_err(|source| crate::LayaError::TokenizerLoad {
                path: path.to_path_buf(),
                source,
            })?;
        Ok(Self {
            inner: Arc::new(hf),
        })
    }

    /// Encode a single piece of text into ids + attention mask, truncated to
    /// [`MAX_SEQ_LEN`]. `add_special_tokens` decides whether the tokenizer's
    /// built-in post-processor wraps the sequence with `cls`/`sep`; the Laya
    /// graph consumes raw ids (it aligns span markers to absolute positions),
    /// so callers building sequences pass `false`.
    pub fn encode(
        &self,
        text: &str,
        add_special_tokens: bool,
    ) -> Result<Encoding, crate::LayaError> {
        let mut enc = self
            .inner
            .encode(text, add_special_tokens)
            .map_err(|e| crate::LayaError::Tokenize(e.to_string()))?;

        // Truncate to MAX_SEQ_LEN if the tokenizer wasn't configured with
        // truncation already. `stride` must be strictly less than `max_len`.
        if enc.len() > MAX_SEQ_LEN {
            enc.truncate(MAX_SEQ_LEN, 0, TruncationDirection::Right);
        }
        let ids: Vec<u32> = enc.get_ids().to_vec();
        let mask: Vec<u32> = enc.get_attention_mask().to_vec();
        let len = ids.len();
        Ok(Encoding { ids, mask, len })
    }

    /// Number of entries in the vocabulary.
    pub fn vocab_size(&self) -> usize {
        self.inner.get_vocab_size(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_seq_len_is_sane() {
        const {
            assert!(MAX_SEQ_LEN > 0 && MAX_SEQ_LEN <= 8192);
        }
    }
}
