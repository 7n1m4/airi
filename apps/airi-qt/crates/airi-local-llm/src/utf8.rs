// SPDX-License-Identifier: GPL-3.0-or-later

//! Partial UTF-8 decoding across token boundaries.
//!
//! `token_to_piece` returns raw bytes that may split a multi-byte UTF-8
//! sequence anywhere (byte-level BPE makes this common for non-ASCII). A
//! naive `String::from_utf8_lossy` per token would corrupt split sequences,
//! so this accumulator holds incomplete tails until the next piece arrives.

/// Accumulates raw token bytes and yields only complete UTF-8 text.
#[derive(Debug, Default)]
pub(crate) struct PartialUtf8 {
    pending: Vec<u8>,
}

impl PartialUtf8 {
    /// Create an empty accumulator.
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Append raw bytes from one detokenized token; returns the bytes that
    /// form complete UTF-8 text (possibly empty).
    pub(crate) fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    out.push_str(s);
                    self.pending.clear();
                    break;
                }
                Err(err) => {
                    let valid_up_to = err.valid_up_to();
                    // SAFETY: `valid_up_to` is a checked boundary from the UTF-8 validator.
                    out.push_str(
                        std::str::from_utf8(&self.pending[..valid_up_to]).expect("valid prefix"),
                    );
                    match err.error_len() {
                        // Incomplete sequence at the tail: keep it for the next piece.
                        None => {
                            self.pending.drain(..valid_up_to);
                            break;
                        }
                        // Genuinely invalid bytes: replace and continue.
                        Some(invalid_len) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid_up_to + invalid_len);
                        }
                    }
                }
            }
        }
        out
    }

    /// Flush remaining pending bytes at end-of-stream, lossily.
    pub(crate) fn finish(&mut self) -> String {
        String::from_utf8_lossy(&self.pending).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::PartialUtf8;

    #[test]
    fn ascii_passthrough() {
        let mut acc = PartialUtf8::new();
        assert_eq!(acc.push(b"hello "), "hello ");
        assert_eq!(acc.push(b"world"), "world");
        assert_eq!(acc.finish(), "");
    }

    #[test]
    fn multibyte_split_across_pieces() {
        let mut acc = PartialUtf8::new();
        // U+1F980 CRAB is F0 9F A6 80; split after byte 2.
        assert_eq!(acc.push(&[0xF0, 0x9F]), "");
        let out = acc.push(&[0xA6, 0x80]);
        assert_eq!(out, "\u{1F980}");
        assert_eq!(acc.finish(), "");
    }

    #[test]
    fn three_byte_split_across_three_pieces() {
        let mut acc = PartialUtf8::new();
        // U+4E2D (中) is E4 B8 AD.
        assert_eq!(acc.push(&[0xE4]), "");
        assert_eq!(acc.push(&[0xB8]), "");
        assert_eq!(acc.push(&[0xAD]), "中");
    }

    #[test]
    fn finish_lossy_replaces_dangling_bytes() {
        let mut acc = PartialUtf8::new();
        assert_eq!(acc.push(&[0xF0, 0x9F]), "");
        assert_eq!(acc.finish(), "\u{FFFD}");
    }

    #[test]
    fn invalid_bytes_become_replacement_char() {
        let mut acc = PartialUtf8::new();
        let out = acc.push(&[0x61, 0xFF, 0x62]);
        assert_eq!(out, "a\u{FFFD}b");
    }
}
