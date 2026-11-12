// SPDX-License-Identifier: GPL-3.0-or-later
//! Hand-rolled credential redactor. Applied to every digest line before it
//! leaves memory (and by the daemon before anything reaches its audit log).
//!
//! Deliberate copy of the pattern list in `airi-daemon::redact` (P2 lane note:
//! `airi-a11y` stays self-contained; the daemon does not re-export its
//! redactor). Keep the two in sync when adding patterns.
//!
//! Matching rules (spec §F rail 4, hand-rolled, no regex):
//!   * patterns are matched case-insensitively (ASCII);
//!   * a pattern must start at the beginning of the string or right after a
//!     non-alphanumeric byte — this keeps `disk-3` / `task-list` clean while
//!     still catching `sk-...` after a space, quote, slash, `=`, etc.;
//!   * from the end of the matched pattern, the token extends over the
//!     maximal run of credential-token bytes (alphanumerics and `-._~+/=`);
//!     anything else — whitespace, quotes, parens, commas, backslashes, eol —
//!     ends the token;
//!   * the pattern plus that token run is replaced with `***`.
//!     "match to end of token (whitespace/quote/eol)" from the spec falls out
//!     of this; the alphabet rule is a strict superset of those boundaries;
//!   * whatever the token was, it is replaced with `***`;
//!   * a clean string passes through byte-identical (we only ever rewrite
//!     matched spans; every other byte is copied verbatim).
//!
//! Notable consequence (documented honestly): `"api_key"` with no separating
//! value, or a token that ends at a boundary we don't recognize as part of
//! the alphabet, stops at the first whitespace/quote/backslash — matching the
//! spec's "match to end of token (whitespace/quote/eol)".

/// Patterns in longest-first order where one is a prefix of another
/// (`sk-ant-` before `sk-`). The left-boundary rule already handles overlap,
/// but longest-first keeps the intent obvious to a reader.
const PATTERNS: &[&str] = &[
    "sk-ant-",
    "github_pat_",
    "Bearer ",
    "Basic ",
    "token=",
    "api_key",
    "sk-",
    "ghp_",
    "gho_",
    "xoxb-",
    "xoxp-",
    "AIza",
    "ya29.",
    "gsk_",
];

fn is_boundary_before(bytes: &[u8], at: usize) -> bool {
    if at == 0 {
        return true;
    }
    let prev = bytes[at - 1];
    !prev.is_ascii_alphanumeric()
}

fn match_pattern_at(bytes: &[u8], at: usize) -> Option<usize> {
    for pat in PATTERNS {
        let plen = pat.len();
        if at + plen > bytes.len() {
            continue;
        }
        if !bytes[at..at + plen].eq_ignore_ascii_case(pat.as_bytes()) {
            continue;
        }
        if !is_boundary_before(bytes, at) {
            continue;
        }
        return Some(plen);
    }
    None
}

/// Index just past the end of the token that starts at `from`. The token
/// alphabet is alphanumerics plus `-._~+/=` (what real credential tokens use);
/// every other byte — whitespace, quotes, parens, commas, eol — ends the token.
fn token_end(bytes: &[u8], from: usize) -> usize {
    let mut i = from;
    while i < bytes.len() {
        let b = bytes[i];
        let token_byte = b.is_ascii_alphanumeric()
            || matches!(b, b'-' | b'.' | b'_' | b'~' | b'+' | b'/' | b'=');
        if !token_byte {
            break;
        }
        i += 1;
    }
    i
}

pub fn redact(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if let Some(plen) = match_pattern_at(bytes, i) {
            out.extend_from_slice(b"***");
            i = token_end(bytes, i + plen);
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    // Only matched ASCII spans were replaced with ASCII `***`, so the result
    // is always valid UTF-8. Fall back to the (already validated) input if
    // that invariant is ever broken — never panic on bus paths.
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn each_pattern_is_redacted_to_end_of_token() {
        let cases = [
            ("Bearer abc123 def", "*** def"),
            ("Basic dXNlcjpwYXNz end", "*** end"),
            ("token=abc123 rest", "*** rest"),
            ("api_key=abc123 rest", "*** rest"),
            ("api_key rest", "*** rest"),
            ("sk-ant-api03-AAAA rest", "*** rest"),
            ("sk-AAAABBBB rest", "*** rest"),
            ("ghp_AAAAAAAAAAAA rest", "*** rest"),
            ("gho_AAAAAAAAAAAA rest", "*** rest"),
            ("github_pat_AAAAAAAA rest", "*** rest"),
            ("xoxb-AAAA-BBBB rest", "*** rest"),
            ("xoxp-AAAA-BBBB rest", "*** rest"),
            ("AIzaSyAAAA rest", "*** rest"),
            ("ya29.a0AfH6AAA rest", "*** rest"),
            ("gsk_AAAAAAAAAAAA rest", "*** rest"),
        ];
        for (input, want) in cases {
            assert_eq!(redact(input), want, "input: {input}");
        }
    }

    #[test]
    fn token_ends_at_whitespace_quote_and_eol() {
        assert_eq!(redact("sk-abc\nnext line"), "***\nnext line");
        assert_eq!(redact("sk-abc\"quoted"), "***\"quoted");
        assert_eq!(redact("sk-abc'quoted"), "***'quoted");
        assert_eq!(redact("sk-abc"), "***");
        assert_eq!(redact("sk-abc\tTabbed"), "***\tTabbed");
    }

    #[test]
    fn clean_string_is_byte_identical() {
        let clean = "media: Playing — track title (100%) [café] ✔ 1234";
        assert_eq!(redact(clean), clean);
        assert_eq!(redact(""), "");
        assert_eq!(redact("network: state 70"), "network: state 70");
        // Looks secret-ish but the "token" is not a recognized pattern.
        assert_eq!(redact("secret-ish-value"), "secret-ish-value");
        // `disk-` contains `sk-` but is preceded by an alphanumeric.
        assert_eq!(redact("disk-3 is full"), "disk-3 is full");
        assert_eq!(redact("task-list"), "task-list");
    }

    #[test]
    fn left_boundary_allows_prefix_after_non_alnum() {
        assert_eq!(redact("key=sk-abc123 tail"), "key=*** tail");
        assert_eq!(redact("(sk-abc123)"), "(***)");
        assert_eq!(redact("/sk-abc123"), "/***");
        assert_eq!(redact("\"sk-abc123\""), "\"***\"");
    }

    #[test]
    fn case_insensitive_match_preserves_surrounding_bytes() {
        assert_eq!(redact("BEARER abc def"), "*** def");
        assert_eq!(redact("Token=abc def"), "*** def");
        assert_eq!(redact("API_KEY=abc def"), "*** def");
    }

    #[test]
    fn mixed_string_redacts_every_secret_and_keeps_the_rest() {
        let input = "user said Bearer aaa then sk-ant-bbb123, finally ghp_ccc end";
        assert_eq!(redact(input), "user said *** then ***, finally *** end");
    }

    #[test]
    fn adjacent_secrets_are_each_redacted() {
        assert_eq!(redact("sk-aaa sk-bbb"), "*** ***");
    }

    #[test]
    fn pattern_at_very_start_and_very_end() {
        assert_eq!(redact("sk-abc"), "***");
        assert_eq!(redact("sk-abc "), "*** ");
        assert_eq!(redact("pre sk-abc"), "pre ***");
    }

    #[test]
    fn token_with_backslash_boundary() {
        assert_eq!(redact("sk-abc\\nhidden"), "***\\nhidden");
    }

    #[test]
    fn garbage_bytes_do_not_panic() {
        // Invalid-looking but valid UTF-8; must not panic.
        assert_eq!(redact("\u{0}\u{1f}\u{7f}sk-abc"), "\u{0}\u{1f}\u{7f}***");
    }
}
