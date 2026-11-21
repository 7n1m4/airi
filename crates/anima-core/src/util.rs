// SPDX-License-Identifier: GPL-3.0-or-later
//! Small shared helpers used across native surfaces.

use std::path::PathBuf;

/// Truncate to at most `max` Unicode scalar values, appending `…` when cut.
/// Multi-byte scalars count once each.
pub fn truncate_chars(text: &str, max: usize) -> String {
    let mut chars = text.chars();
    let kept: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{kept}…")
    } else {
        kept
    }
}

/// Per-user data directory (`$XDG_DATA_HOME` or `~/.local/share` on unix,
/// nothing elsewhere). Callers append their own app namespace.
#[cfg(unix)]
pub fn platform_data_dir() -> Option<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            return Some(PathBuf::from(xdg));
        }
    }
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
}

/// Per-user data directory placeholder on non-unix platforms.
#[cfg(not(unix))]
pub fn platform_data_dir() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_chars_counts_scalars_and_marks_elision() {
        assert_eq!(truncate_chars("hello", 400), "hello");
        assert_eq!(truncate_chars("hello world", 5), "hello…");
        let cjk = "記憶".repeat(300);
        assert_eq!(truncate_chars(&cjk, 400).chars().count(), 401);
        assert_eq!(truncate_chars(&"a".repeat(400), 400), "a".repeat(400));
    }
}
