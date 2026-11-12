// SPDX-License-Identifier: GPL-3.0-or-later
//! The `screen` source — AT-SPI2 eyes, strictly opt-in, metadata-only.
//!
//! Design notes (spec §C/§F, lane P2):
//!   * focus events produce at most one ring/audit line each, and only when
//!     the source is effectively armed (user-armed && !paused && !lockdown);
//!   * those lines carry APP NAME and WINDOW TITLE only — never content;
//!   * the digest is computed on demand (GetFocusDigest) and never cached to
//!     disk; exclusion and password rails are applied *before* anything is
//!     returned, so an excluded or protected app never leaks its digest;
//!   * excluded apps (built-in credential managers + user list) never enter
//!     the ring/audit from focus events either.
//!
//! `Exclusions` holds the user-configured app-name exclusions; matches are
//! case-insensitive substrings of the application's name. A small built-in
//! denylist of credential managers is always on (spec §C rail 4, "default on")
//! and is NOT persisted — it is code, not user data.

use std::fs;
use std::io;
use std::path::PathBuf;

use airi_a11y::{A11yClient, WalkOptions};
use serde_json::json;

use crate::audit::{now_ms, AuditLog};
use crate::ring::{Ring, RingEvent};
use crate::state::Source;

/// Built-in credential-manager denylist — always active, case-insensitive
/// substring match on the application name. Never persisted.
pub const BUILTIN_EXCLUSIONS: &[&str] = &["keepass", "1password", "bitwarden", "secret-service"];

const MAX_EXCLUSION_ENTRIES: usize = 256;
const MAX_EXCLUSION_LEN: usize = 128;

pub struct Exclusions {
    user: Vec<String>,
    path: Option<PathBuf>,
}

impl Exclusions {
    /// Load user exclusions from `path` (`<data_dir>/airi-slint/awareness-exclusions.json`).
    /// Missing file → empty list. Unreadable/invalid → empty list + `eprintln`
    /// note; the daemon keeps running (never fails hard on a config file).
    pub fn load(path: PathBuf) -> Self {
        let user = match fs::read_to_string(&path) {
            Ok(contents) => match parse_exclusions_json(&contents) {
                Ok(list) => list,
                Err(e) => {
                    eprintln!(
                        "airi-daemon: ignoring exclusion file {}: {e}",
                        path.display()
                    );
                    Vec::new()
                }
            },
            Err(e) if e.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(e) => {
                eprintln!(
                    "airi-daemon: cannot read exclusion file {}: {e}",
                    path.display()
                );
                Vec::new()
            }
        };
        Exclusions {
            user,
            path: Some(path),
        }
    }

    /// In-memory only (tests). Built-ins always apply.
    pub fn in_memory() -> Self {
        Exclusions {
            user: Vec::new(),
            path: None,
        }
    }

    /// Validate and store a user exclusion list, then persist it.
    pub fn set(&mut self, entries: Vec<String>) -> Result<(), String> {
        validate_exclusions(&entries)?;
        let previous = std::mem::replace(&mut self.user, entries);
        if let Some(path) = &self.path {
            if let Err(e) = persist(path, &self.user) {
                // Roll the in-memory list back so the file and memory never
                // disagree silently.
                self.user = previous;
                return Err(e);
            }
        }
        Ok(())
    }

    /// Case-insensitive substring match against the application's name,
    /// across user and built-in entries.
    pub fn is_excluded(&self, app: &str) -> bool {
        let app_l = app.to_lowercase();
        self.user
            .iter()
            .map(String::as_str)
            .chain(BUILTIN_EXCLUSIONS.iter().copied())
            .any(|e| {
                let needle = e.trim().to_lowercase();
                !needle.is_empty() && app_l.contains(&needle)
            })
    }

    pub fn user_len(&self) -> usize {
        self.user.len()
    }

    pub fn builtin_len(&self) -> usize {
        BUILTIN_EXCLUSIONS.len()
    }
}

/// Validate the raw user list (already typed as strings by the caller).
fn validate_exclusions(entries: &[String]) -> Result<(), String> {
    if entries.len() > MAX_EXCLUSION_ENTRIES {
        return Err(format!(
            "too many exclusions ({} > {MAX_EXCLUSION_ENTRIES})",
            entries.len()
        ));
    }
    for e in entries {
        if e.trim().is_empty() {
            return Err("empty exclusion entry".to_string());
        }
        if e.chars().count() > MAX_EXCLUSION_LEN {
            return Err(format!(
                "exclusion entry longer than {MAX_EXCLUSION_LEN} chars"
            ));
        }
    }
    Ok(())
}

/// Parse the on-disk exclusion file (or the SetExcludedApps argument):
/// a JSON array of strings.
pub fn parse_exclusions_json(contents: &str) -> Result<Vec<String>, String> {
    let value: serde_json::Value =
        serde_json::from_str(contents).map_err(|e| format!("not valid JSON: {e}"))?;
    let array = value
        .as_array()
        .ok_or_else(|| "expected a JSON array of app-name strings".to_string())?;
    let mut out = Vec::with_capacity(array.len());
    for item in array {
        let s = item
            .as_str()
            .ok_or_else(|| "exclusion entries must be strings".to_string())?;
        out.push(s.to_string());
    }
    validate_exclusions(&out)?;
    Ok(out)
}

fn persist(path: &std::path::Path, entries: &[String]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("cannot serialize exclusions: {e}"))?;
    fs::write(&tmp, body).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("cannot rename {}: {e}", tmp.display()))
}

/// `<data_dir>/airi-slint/awareness-exclusions.json`
pub fn exclusions_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("airi-slint").join("awareness-exclusions.json"))
}

/// What a focus event resolved to (metadata only).
pub struct FocusMeta {
    pub line: String,
}

/// Resolve a focus event to a redacted, metadata-only line, applying every
/// rail: caller must gate on `effective_armed(Source::Screen)` first.
/// Returns `None` — and rings/audits nothing — when the app cannot be
/// resolved (fail closed; the daemon eprintlns a note) or when the focused
/// application is excluded.
pub fn resolve_focus_event(
    client: &A11yClient,
    update: &airi_a11y::FocusUpdate,
    cache: &mut airi_a11y::FocusCache,
    exclusions: &Exclusions,
) -> Option<FocusMeta> {
    airi_a11y::apply_focus_update(cache, update);
    let app = match client.resolve_app_name(&update.sender, &update.path) {
        Ok(app) => app,
        Err(e) => {
            eprintln!(
                "airi-daemon: screen focus from {} unresolved ({e}); not ringing",
                update.sender
            );
            cache.app = None;
            return None;
        }
    };
    cache.app = Some(app.clone());
    if exclusions.is_excluded(&app) {
        return None; // never ring/audit an excluded app — spec
    }
    let title = cache
        .best_title()
        .map(str::to_string)
        .or_else(|| client.resolve_title(&update.sender, &update.path))
        .unwrap_or_else(|| "untitled".to_string());
    // Keep the cache's title in sync so a later digest prefers it.
    if cache.title.is_none() {
        cache.title = Some(title.clone());
    }
    let line = format!("screen: focused {app} — {title}");
    Some(FocusMeta {
        line: airi_a11y::redact::redact(&line),
    })
}

/// Ring + audit the resolved focus event (metadata only).
pub fn record_focus_event(meta: &FocusMeta, ring: &mut Ring, audit: &AuditLog) {
    ring.push(RingEvent {
        ts_ms: now_ms(),
        source: Source::Screen.name().to_string(),
        event: meta.line.clone(),
    });
    audit.append(Source::Screen.name(), &meta.line, &meta.line);
}

/// GetFocusDigest — compute once, return JSON, never persist.
pub fn digest_json(
    client: Option<&A11yClient>,
    cache: &airi_a11y::FocusCache,
    exclusions: &Exclusions,
) -> String {
    let client =
        match client {
            Some(c) => c,
            None => return json!({
                "ok": false,
                "error": "screen awareness unavailable on this desktop (a11y bus not reachable)",
            })
            .to_string(),
        };
    if !cache.has_focus() {
        return json!({
            "ok": false,
            "error": "no focused accessible tracked yet (focus a window first)",
        })
        .to_string();
    }
    let sender = match &cache.sender {
        Some(s) => s.clone(),
        None => return json!({ "ok": false, "error": "no focused sender cached" }).to_string(),
    };
    let path = match &cache.path {
        Some(p) => p.clone(),
        None => return json!({ "ok": false, "error": "no focused path cached" }).to_string(),
    };
    match client.capture_digest(&sender, &path, cache.best_title(), &WalkOptions::default()) {
        Ok(digest) => {
            if exclusions.is_excluded(&digest.app) {
                // Never return an excluded app's digest — not even a
                // truncated one — spec: excluded apps never produce digests.
                json!({ "ok": false, "error": "excluded" }).to_string()
            } else {
                json!({
                    "ok": true,
                    "app": digest.app,
                    "title": digest.title,
                    "lines": digest.lines,
                    "text_length": digest.text_length,
                    "skipped_password_nodes": digest.skipped_password_nodes,
                })
                .to_string()
            }
        }
        Err(e) => json!({ "ok": false, "error": e }).to_string(),
    }
}

/// SetExcludedApps — validate, store in memory, persist (if a path is known).
pub fn set_excluded_apps_json(argument: &str, exclusions: &mut Exclusions) -> String {
    match parse_exclusions_json(argument) {
        Ok(entries) => match exclusions.set(entries) {
            Ok(()) => json!({ "ok": true }).to_string(),
            Err(e) => json!({ "ok": false, "error": e }).to_string(),
        },
        Err(e) => json!({ "ok": false, "error": e }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_denylist_is_case_insensitive_and_always_on() {
        let ex = Exclusions::in_memory();
        for app in [
            "KeePassXC",
            "KEEPASS",
            "1Password 8",
            "Bitwarden",
            "secret-service-tui",
        ] {
            assert!(ex.is_excluded(app), "{app} must be excluded by built-ins");
        }
        assert!(!ex.is_excluded("Firefox"));
    }

    #[test]
    fn user_entry_matching_is_substring_of_app_name() {
        let mut ex = Exclusions::in_memory();
        ex.set(vec![
            "private browsing".to_string(),
            "Aurora Notes".to_string(),
        ])
        .unwrap();
        assert!(ex.is_excluded("firefox (Private Browsing mode)"));
        assert!(ex.is_excluded("AURORA NOTES"));
        assert!(!ex.is_excluded("aurora-mail")); // substring is case-insensitive but literal
    }

    #[test]
    fn set_validates_and_rolls_back_on_validation_failure() {
        let mut ex = Exclusions::in_memory();
        // Non-string / non-array shapes are rejected at parse time.
        assert!(parse_exclusions_json(r#"{"a": 1}"#).is_err());
        assert!(parse_exclusions_json(r#"[1, 2]"#).is_err());
        assert!(parse_exclusions_json(r#"[""]"#).is_err());
        assert!(parse_exclusions_json(&format!("[\"{}\"]", "x".repeat(200))).is_err());
        // Oversized list is rejected.
        let big: Vec<String> = (0..300).map(|i| format!("app-{i}")).collect();
        assert!(ex.set(big).is_err());
        // Prior state survives the failed set.
        ex.set(vec!["keep".to_string()]).unwrap();
        assert!(ex.set(vec!["".to_string()]).is_err());
        assert!(ex.is_excluded("keep"));
    }

    #[test]
    fn exclusions_persist_and_reload_roundtrip() {
        let dir =
            std::env::temp_dir().join(format!("airi-daemon-excl-test-{}", std::process::id()));
        let path = dir.join("awareness-exclusions.json");
        let mut ex = Exclusions::load(path.clone());
        ex.set(vec!["my bank".to_string()]).unwrap();
        let reloaded = Exclusions::load(path.clone());
        assert!(reloaded.is_excluded("My Bank Dashboard"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_excluded_apps_json_shape() {
        let mut ex = Exclusions::in_memory();
        let ok: serde_json::Value =
            serde_json::from_str(&set_excluded_apps_json(r#"["bank"]"#, &mut ex)).unwrap();
        assert_eq!(ok["ok"], true);
        let bad: serde_json::Value =
            serde_json::from_str(&set_excluded_apps_json(r#"not json"#, &mut ex)).unwrap();
        assert_eq!(bad["ok"], false);
        assert!(bad["error"].as_str().unwrap().contains("JSON"));
    }
}
