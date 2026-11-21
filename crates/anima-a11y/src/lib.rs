// SPDX-License-Identifier: GPL-3.0-or-later
//! airi-a11y — AT-SPI2 (a11y bus) awareness for AIRI.
//!
//! Two layers, strictly on demand:
//!   1. discovery + focus tracking on the *accessibility bus* (not the session
//!      bus) — `org.a11y.Bus.GetAddress` / `org.a11y.Status.IsEnabled` on the
//!      session bus, then a separate connection to the a11y bus with focus
//!      match rules;
//!   2. a capped, redacted focused-subtree digest — computed only when the
//!      daemon asks (`capture_digest`), never pushed anywhere, never persisted
//!      by this crate.
//!
//! No password content crosses this boundary: role `password text`, a
//! `protected` state flag, or a case-insensitive credential-ish heuristic on
//! role/name/description all skip the node's line *and* its subtree. Caps:
//! 200 nodes, depth 8, 500 chars per node, 4000 chars per digest.
//!
//! Unit tests in this crate never touch a live bus; they exercise synthetic
//! in-memory trees (`digest`) and synthetic D-Bus messages (`focus`).

pub mod client;
pub mod digest;
pub mod discover;
pub mod focus;
pub mod redact;

pub use client::A11yClient;
pub use digest::{
    digest_from_tree, is_excluded_node, is_secretish, truncate_chars, FocusedDigest, TreeNode,
    WalkOptions,
};
pub use discover::{fetch_a11y_address, fetch_is_enabled, probe, ProbeResult};
pub use focus::{
    apply_focus_update, parse_focus_signal, FocusCache, FocusUpdate, FOCUS_MATCH_RULES,
};
