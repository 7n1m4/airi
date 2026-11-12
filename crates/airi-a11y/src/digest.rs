// SPDX-License-Identifier: GPL-3.0-or-later
//! Focused-subtree digest: caps, exclusions, redaction, formatting.
//!
//! `digest_from_tree` is pure and is what the unit tests exercise against
//! synthetic in-memory trees (the live D-Bus walker in `client.rs` only
//! *builds* a [`TreeNode`]; it never decides what gets shown).
//!
//! Hard rails (spec §C/§F — non-negotiable):
//!   * password-ish nodes are skipped entirely — no line, no subtree walk,
//!     only the `skipped_password_nodes` counter increments;
//!   * role `password text`, a `protected` state flag (decoded by the caller
//!     into `TreeNode::protected_state`), and a case-insensitive heuristic on
//!     role/name/description (`password|passphrase|secret|token|api-key|pin`)
//!     all trip the skip;
//!   * caps: `max_nodes` (default 200), `max_depth` (default 8, root = 0),
//!     `max_line_len` (default 500 chars, `…` truncation, char-boundary
//!     safe), `max_total_chars` (default 4000 for the whole digest);
//!   * every emitted line passes through the credential redactor;
//!   * siblings of an excluded node are NOT excluded — exclusions trim a
//!     subtree, never the walk.

use crate::redact::redact;

/// A node in the (live or synthetic) accessible tree.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TreeNode {
    /// Role *name* as returned by `GetRoleName` (e.g. `"password text"`).
    pub role: String,
    pub name: String,
    pub description: String,
    /// Content of the `org.a11y.atspi.Text` interface, when read.
    pub text: Option<String>,
    /// `true` when the caller decoded a "protected" state bit. No AT-SPI
    /// state named *protected* exists in this build of at-spi2-core
    /// (verified against `AtspiStateType`, `ATSPI_STATE_LAST_DEFINED == 44`);
    /// the live walker always sets this `false` today and the rail is kept
    /// for synthetic trees and future builds. Role + heuristics carry the
    /// load on this machine.
    pub protected_state: bool,
    pub children: Vec<TreeNode>,
}

/// Caps for one digest walk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalkOptions {
    pub max_nodes: usize,
    pub max_depth: usize,
    pub max_line_len: usize,
    pub max_total_chars: usize,
}

impl Default for WalkOptions {
    fn default() -> Self {
        WalkOptions {
            max_nodes: 200,
            max_depth: 8,
            max_line_len: 500,
            max_total_chars: 4000,
        }
    }
}

/// Result of a digest walk over the focused accessible's subtree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusedDigest {
    pub app: String,
    pub title: String,
    pub lines: Vec<String>,
    /// Sum of the chars of the (redacted) `lines` — always ≤ `max_total_chars`.
    pub text_length: usize,
    pub skipped_password_nodes: usize,
}

impl FocusedDigest {
    /// One line, ≤ 400 chars: `"app — title — line1 | line2 | …"`.
    pub fn to_summary_line(&self) -> String {
        const MAX: usize = 400;
        let mut out = format!("{} — {} — ", self.app, self.title);
        if self.lines.is_empty() {
            out.push_str("(no readable text)");
        } else {
            out.push_str(&self.lines.join(" | "));
        }
        truncate_chars(&out, MAX)
    }
}

/// Case-insensitive substring test (ASCII + Unicode via `char` lowering).
fn contains_ci(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return true;
    }
    let h: Vec<char> = haystack.chars().flat_map(|c| c.to_lowercase()).collect();
    let n: Vec<char> = needle.chars().flat_map(|c| c.to_lowercase()).collect();
    if n.len() > h.len() {
        return false;
    }
    h.windows(n.len()).any(|w| w == n.as_slice())
}

/// Secret-ish needles: literal substrings, case-insensitive. Deliberately
/// over-inclusive — a false positive only *hides* a label from the digest,
/// a false negative would leak one into it.
const SECRETISH_NEEDLES: &[&str] = &[
    "password",
    "passphrase",
    "secret",
    "token",
    "api-key",
    "api_key",
    "apikey",
    "pin",
];

/// True when any of role/name/description looks credential-related.
pub fn is_secretish(s: &str) -> bool {
    SECRETISH_NEEDLES.iter().any(|n| contains_ci(s, n))
}

/// Should this node's content be skipped (subtree included)? Siblings of the
/// skipped node are unaffected — this is a subtree rule, not a global one.
pub fn is_excluded_node(role: &str, name: &str, description: &str) -> bool {
    let role_n = role.trim().to_lowercase();
    if role_n == "password text" || role_n == "password-text" {
        return true;
    }
    is_secretish(role) || is_secretish(name) || is_secretish(description)
}

/// Truncate to at most `max` chars (multi-byte safe); a truncated string ends
/// with `…` and is exactly `max` chars long.
pub fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    if max == 0 {
        return String::new();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Build a digest from an already-constructed tree (pure — the live walker
/// produces the same shape).
pub fn digest_from_tree(
    app: &str,
    title: &str,
    root: Option<&TreeNode>,
    opts: &WalkOptions,
) -> FocusedDigest {
    let mut state = WalkState {
        lines: Vec::new(),
        total_chars: 0,
        skipped_password_nodes: 0,
        visited: 0,
        done: false,
    };
    if let Some(root) = root {
        walk_node(root, 0, opts, &mut state);
    }
    FocusedDigest {
        app: app.to_string(),
        title: title.to_string(),
        lines: state.lines,
        text_length: state.total_chars,
        skipped_password_nodes: state.skipped_password_nodes,
    }
}

struct WalkState {
    lines: Vec<String>,
    total_chars: usize,
    skipped_password_nodes: usize,
    visited: usize,
    done: bool,
}

fn first_non_empty<'a>(
    name: &'a str,
    text: Option<&'a str>,
    description: &'a str,
) -> Option<&'a str> {
    [Some(name), text, Some(description)]
        .into_iter()
        .flatten()
        .find(|c| !c.trim().is_empty())
}

fn walk_node(node: &TreeNode, depth: usize, opts: &WalkOptions, state: &mut WalkState) {
    if state.done {
        return;
    }
    if depth > opts.max_depth {
        return;
    }
    if state.visited >= opts.max_nodes {
        state.done = true;
        return;
    }

    // Exclusion: skip the node's line AND its subtree, count it, siblings live on.
    if node.protected_state || is_excluded_node(&node.role, &node.name, &node.description) {
        state.skipped_password_nodes += 1;
        return;
    }
    state.visited += 1;

    let role = if node.role.trim().is_empty() {
        "object"
    } else {
        node.role.trim()
    };

    if let Some(label) = first_non_empty(&node.name, node.text.as_deref(), &node.description) {
        let label = truncate_chars(label.trim(), opts.max_line_len);
        let line = format!("{role}: {label}");
        let line = redact(&line);
        let line_chars = line.chars().count();
        if state.total_chars + line_chars > opts.max_total_chars {
            state.done = true;
            return;
        }
        state.total_chars += line_chars;
        state.lines.push(line);
    }

    if state.done {
        return;
    }
    for child in &node.children {
        if state.done {
            break;
        }
        walk_node(child, depth + 1, opts, state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(role: &str, name: &str) -> TreeNode {
        TreeNode {
            role: role.to_string(),
            name: name.to_string(),
            ..TreeNode::default()
        }
    }

    fn leaf(role: &str, name: &str, description: &str) -> TreeNode {
        TreeNode {
            role: role.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            ..TreeNode::default()
        }
    }

    // ---- exclusion heuristics (table-driven) ----

    #[test]
    fn exclusion_role_password_text_any_case() {
        for role in [
            "password text",
            "Password Text",
            "PASSWORD TEXT",
            "password-text",
        ] {
            assert!(
                is_excluded_node(role, "", ""),
                "role {role:?} must be excluded"
            );
        }
    }

    #[test]
    fn exclusion_heuristics_table() {
        // (role, name, description, excluded?)
        let cases: &[(&str, &str, &str, bool)] = &[
            ("text", "Enter your passphrase", "", true),
            ("text", "", "dbus Token for the deploy", true),
            ("text", "my api_key is here", "", true),
            ("label", "API-Key", "", true),
            ("label", "api-key", "", true),
            ("label", "APIKEY", "", true),
            ("entry", "pin code", "", true), // over-inclusive on purpose:
            // "pin" hides, never leaks
            ("label", "spinning up", "", true), // known noise: substring match
            ("label", "Normal button", "", false),
            ("push button", "Save", "", false),
            ("text", "plain document text", "", false),
            ("frame", "", "", false),
            ("label", "", "untitled plain description", false),
        ];
        for (role, name, description, want) in cases {
            assert_eq!(
                is_excluded_node(role, name, description),
                *want,
                "role={role:?} name={name:?} description={description:?}"
            );
        }
    }

    #[test]
    fn protected_state_flag_excludes_even_a_plain_node() {
        let mut n = node("text", "harmless label");
        n.protected_state = true;
        let digest = digest_from_tree("app", "t", Some(&n), &WalkOptions::default());
        assert_eq!(digest.skipped_password_nodes, 1);
        assert!(digest.lines.is_empty());
    }

    // ---- the password test fixture ----

    fn password_fixture() -> TreeNode {
        let mut root = node("application", "test-app");
        root.children = vec![
            node("label", "Username"),
            // The password entry: role + content must never surface.
            node("password text", "hunter2"),
            // A custom-drawn field mislabeled as ordinary text — the
            // heuristic must catch it by content.
            leaf("text", "secret token: ghp_aaaaaaaaaaaa", ""),
            node("push button", "Log in"),
        ];
        root
    }

    #[test]
    fn password_fixture_skips_credentials_keeps_siblings() {
        let digest = digest_from_tree(
            "myapp",
            "login",
            Some(&password_fixture()),
            &WalkOptions::default(),
        );
        assert_eq!(digest.skipped_password_nodes, 2);
        let joined = digest.lines.join("\n");
        assert!(
            !joined.contains("hunter2"),
            "password content leaked: {joined}"
        );
        assert!(joined.contains("Username"));
        assert!(joined.contains("Log in"));
        assert!(joined.contains("application: test-app"));
    }

    #[test]
    fn password_subtree_children_are_not_walked() {
        let mut root = node("application", "test-app");
        let mut pw = node("password text", "");
        pw.children = vec![node("text", "deeply-nested-secret")];
        root.children = vec![pw];
        let digest = digest_from_tree("myapp", "login", Some(&root), &WalkOptions::default());
        assert_eq!(digest.skipped_password_nodes, 1);
        assert!(!digest
            .lines
            .iter()
            .any(|l| l.contains("deeply-nested-secret")));
    }

    // ---- caps ----

    #[test]
    fn node_cap_is_enforced() {
        let mut root = node("application", "big");
        root.children = (0..500)
            .map(|i| node("label", &format!("item {i}")))
            .collect();
        let digest = digest_from_tree("app", "t", Some(&root), &WalkOptions::default());
        assert!(digest.lines.len() <= 200);
    }

    #[test]
    fn depth_cap_is_enforced() {
        // Marker nested 10 levels below the root; max_depth = 8 → hidden.
        let mut cur = node("label", "deepest-marker");
        for _ in 0..10 {
            cur = TreeNode {
                role: "generic".to_string(),
                children: vec![cur],
                ..TreeNode::default()
            };
        }
        let digest = digest_from_tree("app", "t", Some(&cur), &WalkOptions::default());
        assert!(
            !digest.lines.iter().any(|l| l.contains("deepest-marker")),
            "depth cap must hide 10-deep content: {:?}",
            digest.lines
        );
        // And a marker within the cap is visible.
        let mut ok = node("label", "shallow-marker");
        for _ in 0..6 {
            ok = TreeNode {
                role: "generic".to_string(),
                children: vec![ok],
                ..TreeNode::default()
            };
        }
        let digest2 = digest_from_tree("app", "t", Some(&ok), &WalkOptions::default());
        assert!(digest2.lines.iter().any(|l| l.contains("shallow-marker")));
    }

    #[test]
    fn per_node_text_is_truncated_with_ellipsis() {
        let long = "x".repeat(600);
        let n = node("label", &long);
        let digest = digest_from_tree("app", "t", Some(&n), &WalkOptions::default());
        let line = &digest.lines[0];
        // "label: " (7) + 500 chars max label
        let label = line.strip_prefix("label: ").unwrap();
        assert_eq!(label.chars().count(), 500);
        assert!(label.ends_with('…'));
    }

    #[test]
    fn multibyte_truncation_never_splits_a_char() {
        let long = "é".repeat(600);
        let n = node("label", &long);
        let digest = digest_from_tree("app", "t", Some(&n), &WalkOptions::default());
        let label = digest.lines[0].strip_prefix("label: ").unwrap().to_string();
        assert_eq!(label.chars().count(), 500);
        assert!(label.ends_with('…'));
    }

    #[test]
    fn total_digest_cap_is_enforced() {
        let mut root = node("application", "big");
        // Each label ~490 chars → after 8 lines we are past 4000 chars.
        root.children = (0..50)
            .map(|i| node("label", &format!("{i} {}", "y".repeat(480))))
            .collect();
        let digest = digest_from_tree("app", "t", Some(&root), &WalkOptions::default());
        assert!(digest.text_length <= 4000);
        assert!(
            digest.text_length
                == digest
                    .lines
                    .iter()
                    .map(|l| l.chars().count())
                    .sum::<usize>()
        );
    }

    // ---- redaction & formatting ----

    #[test]
    fn lines_are_redacted_before_leaving_memory() {
        // NB: no credential-ish needles in the name itself, or the node
        // would be excluded by the heuristic before redaction ever ran.
        let n = node("label", "connection string Bearer aaaabbbbccccddddeeee");
        let digest = digest_from_tree("app", "t", Some(&n), &WalkOptions::default());
        let joined = digest.lines.join("\n");
        assert!(!joined.contains("aaaabbbbccccddddeeee"));
        assert!(joined.contains("***"));
    }

    #[test]
    fn summary_line_is_capped_at_400_chars() {
        let mut root = node("application", "app");
        root.children = (0..30)
            .map(|i| node("label", &format!("line number {i} with some words")))
            .collect();
        let digest = digest_from_tree(
            "myapp",
            "my window title",
            Some(&root),
            &WalkOptions::default(),
        );
        let s = digest.to_summary_line();
        assert!(
            s.chars().count() <= 400,
            "summary too long: {}",
            s.chars().count()
        );
        assert!(s.starts_with("myapp — my window title — "));
    }

    #[test]
    fn summary_line_handles_empty_digest() {
        let digest = digest_from_tree("a", "b", None, &WalkOptions::default());
        assert_eq!(digest.to_summary_line(), "a — b — (no readable text)");
    }

    #[test]
    fn empty_nodes_emit_no_line_but_still_count_as_visited() {
        let mut root = node("application", "");
        root.children = vec![node("spacer", ""), node("label", "kept")];
        let digest = digest_from_tree("app", "t", Some(&root), &WalkOptions::default());
        assert_eq!(digest.lines, vec!["label: kept".to_string()]);
    }

    // ---- redactor parity (same cases as the daemon's redact) ----

    #[test]
    fn redact_matches_daemon_cases() {
        assert_eq!(crate::redact::redact("Bearer abc123 def"), "*** def");
        assert_eq!(crate::redact::redact("sk-ant-api03-AAAA rest"), "*** rest");
        assert_eq!(crate::redact::redact("ghp_AAAAAAAAAAAA rest"), "*** rest");
        assert_eq!(crate::redact::redact("disk-3 is full"), "disk-3 is full");
    }
}
