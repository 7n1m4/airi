// SPDX-License-Identifier: GPL-3.0-or-later

//! Streaming stop-pattern matcher.
//!
//! llama.cpp marks most end-of-turn tokens (`<|eot_id|>`, `<|im_end|>`, ...)
//! as EOG, which the generation loop catches via `vocab.is_eog`. This
//! matcher is the rudimentary backstop: a plain-text pattern list applied to
//! the decoded text stream, for models whose turn terminators are not
//! (reliably) marked EOG, and for the generic fallback chat template's
//! `### User` turn marker.
//!
//! A stop pattern may straddle a token boundary, so matching works on a
//! bounded holdback string rather than per-token scans. The holdback never
//! exceeds the longest pattern length plus the largest piece.

/// Stop patterns recognized by the rudimentary backstop matcher.
///
/// - `<|eot_id|>`, `<|eom_id|>`: Llama-3 style turn end.
/// - `<|end|>`: Granite/others.
/// - `<|im_end|>`: ChatML turn end.
/// - `<|endoftext|>`: GPT-2 style document end.
/// - `<|endofturn|>`: Gemma turn end.
/// - `<|end_of_turn|>`: Gemma-3 spelling.
/// - `### User`: next-turn marker emitted by the fallback chat template.
pub const DEFAULT_STOP_PATTERNS: &[&str] = &[
    "<|eot_id|>",
    "<|eom_id|>",
    "<|end|>",
    "<|im_end|>",
    "<|endoftext|>",
    "<|endofturn|>",
    "<|end_of_turn|>",
    "### User",
];

/// Longest prefix of any pattern that `text` ends with (byte length).
fn longest_trailing_prefix(text: &str, patterns: &[String]) -> usize {
    let mut keep = 0;
    for pattern in patterns {
        // Only ASCII patterns are used; iterating char boundaries keeps the
        // cut point valid even for non-ASCII pattern content.
        for (idx, _) in pattern.char_indices() {
            if idx <= keep {
                continue;
            }
            if text.ends_with(&pattern[..idx]) {
                keep = idx;
            }
        }
        // Full pattern? (Shouldn't reach here — a full match is caught by
        // `feed` first — but treat it as keepable too.)
        if text.ends_with(pattern.as_str()) {
            keep = keep.max(pattern.len());
        }
    }
    keep
}

/// Streaming stop matcher over decoded text pieces.
pub(crate) struct StopMatcher {
    patterns: Vec<String>,
    holdback: String,
}

impl StopMatcher {
    /// Create a matcher for the given patterns.
    pub(crate) fn new(patterns: &[&str]) -> Self {
        Self {
            patterns: patterns.iter().map(|p| (*p).to_string()).collect(),
            holdback: String::new(),
        }
    }

    /// Match against [`DEFAULT_STOP_PATTERNS`].
    pub(crate) fn with_defaults() -> Self {
        Self::new(DEFAULT_STOP_PATTERNS)
    }

    /// Feed one decoded text piece. Returns the text that is safe to emit
    /// now, and whether a stop pattern was hit (the stream should end and
    /// the returned text excludes the pattern).
    pub(crate) fn feed(&mut self, piece: &str) -> (String, bool) {
        self.holdback.push_str(piece);

        // Full match anywhere in the holdback: emit up to the first one.
        let mut earliest: Option<usize> = None;
        for pattern in &self.patterns {
            if let Some(idx) = self.holdback.find(pattern.as_str()) {
                earliest = Some(earliest.map_or(idx, |e: usize| e.min(idx)));
            }
        }
        if let Some(idx) = earliest {
            let emit = self.holdback[..idx].to_string();
            self.holdback.clear();
            return (emit, true);
        }

        // No full match: emit everything except the longest suffix that
        // could still grow into a pattern.
        let keep = longest_trailing_prefix(&self.holdback, &self.patterns);
        let emit_len = self.holdback.len() - keep;
        let emit = self.holdback[..emit_len].to_string();
        self.holdback.drain(..emit_len);
        (emit, false)
    }

    /// Flush any remaining holdback at natural end-of-stream (no match hit).
    pub(crate) fn flush(&mut self) -> String {
        std::mem::take(&mut self.holdback)
    }
}

#[cfg(test)]
mod tests {
    use super::{StopMatcher, DEFAULT_STOP_PATTERNS};

    fn collect(matcher: &mut StopMatcher, pieces: &[&str]) -> (String, bool) {
        let mut out = String::new();
        for piece in pieces {
            let (emit, hit) = matcher.feed(piece);
            out.push_str(&emit);
            if hit {
                return (out, true);
            }
        }
        out.push_str(&matcher.flush());
        (out, false)
    }

    #[test]
    fn passthrough_without_match() {
        let mut m = StopMatcher::new(&["<|eot_id|>"]);
        let (text, hit) = collect(&mut m, &["hello, ", "world"]);
        assert_eq!(text, "hello, world");
        assert!(!hit);
    }

    #[test]
    fn match_within_single_piece() {
        let mut m = StopMatcher::new(&["<|eot_id|>"]);
        let (text, hit) = collect(&mut m, &["answer<|eot_id|>trailing"]);
        assert_eq!(text, "answer");
        assert!(hit);
    }

    #[test]
    fn match_split_across_pieces() {
        let mut m = StopMatcher::new(&["<|eot_id|>"]);
        let (text, hit) = collect(&mut m, &["answer<|eot", "_id|>more"]);
        assert_eq!(text, "answer");
        assert!(hit);
    }

    #[test]
    fn match_split_after_first_byte() {
        let mut m = StopMatcher::new(&["<|eot_id|>"]);
        let (text, hit) = collect(&mut m, &["ok<", "|e", "ot_i", "d|>"]);
        assert_eq!(text, "ok");
        assert!(hit);
    }

    #[test]
    fn partial_prefix_is_held_back_until_resolved() {
        let mut m = StopMatcher::new(&["### User"]);
        let (emit1, hit1) = m.feed("hello ###");
        assert!(!hit1);
        assert_eq!(emit1, "hello ");
        // The `###` prefix is held back; next piece disambiguates.
        let (emit2, hit2) = m.feed(" User");
        assert!(hit2);
        assert_eq!(emit2, "");
    }

    #[test]
    fn held_back_prefix_released_when_not_a_match() {
        let mut m = StopMatcher::new(&["### User"]);
        let (_, hit) = m.feed("###");
        assert!(!hit);
        let (emit, hit) = m.feed(" Bot");
        assert!(!hit);
        assert_eq!(emit, "### Bot");
    }

    #[test]
    fn earliest_of_multiple_patterns_wins() {
        let mut m = StopMatcher::new(&["### User", "<|eot_id|>"]);
        let (text, hit) = collect(&mut m, &["x<|eot_id|> then ### User"]);
        assert_eq!(text, "x");
        assert!(hit);
    }

    #[test]
    fn default_patterns_cover_documented_markers() {
        for expected in ["<|eot_id|>", "<|end|>", "<|im_end|>", "<|endoftext|>"] {
            assert!(
                DEFAULT_STOP_PATTERNS.contains(&expected),
                "missing {expected}"
            );
        }
    }

    #[test]
    fn non_ascii_piece_before_pattern_split() {
        let mut m = StopMatcher::new(&["<|eot_id|>"]);
        let (text, hit) = collect(&mut m, &["中<|eot", "_id|>"]);
        assert_eq!(text, "中");
        assert!(hit);
    }
}
