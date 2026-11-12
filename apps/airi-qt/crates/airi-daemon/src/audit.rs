// SPDX-License-Identifier: GPL-3.0-or-later
//! Append-only audit JSONL at `<data_dir>/airi-qt/audit/awareness-audit.jsonl`.
//!
//! - every arm/disarm/observed event is one line;
//! - `detail` is redacted (see [`crate::redact`]) before it is written;
//! - on startup the file is pruned to a 7-day retention window;
//! - lines that cannot be aged (malformed JSON, no numeric `ts_ms`, or a
//!   timestamp in the future) survive prune untouched — never silently lost;
//! - the only file write outside append is the prune rewrite, done via
//!   write-tmp-then-rename inside the same audit directory.

use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::redact::redact;

pub const RETENTION_MS: u64 = 7 * 24 * 3600 * 1000; // hardcoded 7 days (spec)
pub const AUDIT_FILE_NAME: &str = "awareness-audit.jsonl";

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn default_audit_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("airi-qt").join("audit").join(AUDIT_FILE_NAME))
}

/// Pure prune: returns (kept_contents, dropped_count). The rewrite decision
/// lives in [`AuditLog::prune_on_start`] so tests exercise everything.
pub fn prune_contents(contents: &str, now_ms: u64) -> (String, u64) {
    let mut kept = String::with_capacity(contents.len());
    let mut dropped = 0u64;
    for line in contents.lines() {
        if line.trim().is_empty() {
            // Blank lines are not audit records; treat as malformed and keep
            // them verbatim rather than silently editing the user's log.
            kept.push_str(line);
            kept.push('\n');
            continue;
        }
        let aged_out = match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => match v.get("ts_ms").and_then(|t| t.as_u64()) {
                Some(ts) => now_ms > ts.saturating_add(RETENTION_MS),
                // Valid JSON but no usable timestamp: cannot age it, keep it.
                None => false,
            },
            // Malformed: survives prune untouched (spec §F rail 3, honest).
            Err(_) => false,
        };
        if aged_out {
            dropped += 1;
        } else {
            kept.push_str(line);
            kept.push('\n');
        }
    }
    (kept, dropped)
}

pub struct AuditLog {
    path: PathBuf,
    enabled: bool,
}

impl AuditLog {
    /// Open (creating the audit directory). Never fails hard; on any error
    /// the log is disabled and the daemon keeps running with `eprintln` notes.
    pub fn open(path: PathBuf) -> Self {
        match path.parent().map(fs::create_dir_all) {
            Some(Ok(())) => AuditLog {
                path,
                enabled: true,
            },
            other => {
                eprintln!(
                    "airi-daemon: audit disabled: cannot create audit dir for {path:?}: {other:?}"
                );
                AuditLog {
                    path,
                    enabled: false,
                }
            }
        }
    }

    /// Append one redacted line. Redaction happens here, unconditionally,
    /// before the bytes hit disk — callers cannot bypass it.
    pub fn append(&self, source: &str, event: &str, detail: &str) {
        if !self.enabled {
            return;
        }
        let line = serde_json::json!({
            "ts_ms": now_ms(),
            "source": source,
            "event": event,
            "detail": redact(detail),
        });
        let mut f = match fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            Ok(f) => f,
            Err(e) => {
                eprintln!("airi-daemon: audit append failed for {:?}: {e}", self.path);
                return;
            }
        };
        let bytes = format!("{line}\n");
        if let Err(e) = f.write_all(bytes.as_bytes()) {
            eprintln!("airi-daemon: audit append failed for {:?}: {e}", self.path);
        }
    }

    /// Prune the log to the retention window. Returns the number of lines
    /// dropped. `now_ms` is injectable so tests can time-travel.
    pub fn prune_on_start(&self, now_ms: u64) -> u64 {
        if !self.enabled {
            return 0;
        }
        let contents = match fs::read_to_string(&self.path) {
            Ok(c) => c,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return 0, // first run
            Err(e) => {
                eprintln!(
                    "airi-daemon: audit prune skipped: cannot read {:?}: {e}",
                    self.path
                );
                return 0;
            }
        };
        let (kept, dropped) = prune_contents(&contents, now_ms);
        if dropped == 0 {
            return 0;
        }
        // Rewrite via tmp + rename inside the audit dir (same filesystem).
        let tmp = self.path.with_extension("jsonl.prune-tmp");
        let write_result = fs::write(&tmp, kept).and_then(|()| fs::rename(&tmp, &self.path));
        match write_result {
            Ok(()) => dropped,
            Err(e) => {
                eprintln!(
                    "airi-daemon: audit prune rewrite failed for {:?}: {e}",
                    self.path
                );
                let _ = fs::remove_file(&tmp);
                0
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY_MS: u64 = 24 * 3600 * 1000;

    #[test]
    fn prune_drops_eight_day_old_keeps_six_day_old() {
        let now = 1_800_000_000_000u64;
        let eight_days = now - 8 * DAY_MS;
        let six_days = now - 6 * DAY_MS;
        let contents = format!(
            "{{\"ts_ms\":{eight_days},\"source\":\"media\",\"event\":\"media: Playing\",\"detail\":\"\"}}\n\
             {{\"ts_ms\":{six_days},\"source\":\"power\",\"event\":\"power: on AC\",\"detail\":\"\"}}\n"
        );
        let (kept, dropped) = prune_contents(&contents, now);
        assert_eq!(dropped, 1);
        assert!(!kept.contains("media: Playing"));
        assert!(kept.contains("power: on AC"));
    }

    #[test]
    fn malformed_line_survives_prune_untouched() {
        let now = 1_800_000_000_000u64;
        let eight_days = now - 8 * DAY_MS;
        let malformed = "{not json at all,,,";
        let contents = format!(
            "{malformed}\n{{\"ts_ms\":{eight_days},\"source\":\"media\",\"event\":\"media: Stopped\",\"detail\":\"\"}}\n"
        );
        let (kept, dropped) = prune_contents(&contents, now);
        assert_eq!(dropped, 1);
        assert!(kept.contains(malformed));
    }

    #[test]
    fn line_without_ts_and_future_ts_survive() {
        let now = 1_800_000_000_000u64;
        let future = now + 10 * DAY_MS;
        let contents = format!(
            "{{\"source\":\"media\",\"event\":\"no ts\"}}\n\
             {{\"ts_ms\":{future},\"source\":\"media\",\"event\":\"future\",\"detail\":\"\"}}\n"
        );
        let (kept, dropped) = prune_contents(&contents, now);
        assert_eq!(dropped, 0);
        assert!(kept.contains("no ts"));
        assert!(kept.contains("future"));
    }

    #[test]
    fn exactly_seven_days_old_is_kept() {
        let now = 1_800_000_000_000u64;
        let boundary = now - RETENTION_MS;
        let contents =
            format!("{{\"ts_ms\":{boundary},\"source\":\"network\",\"event\":\"network: online\",\"detail\":\"\"}}\n");
        let (_kept, dropped) = prune_contents(&contents, now);
        assert_eq!(dropped, 0);
    }

    #[test]
    fn append_redacts_before_write() {
        let dir =
            std::env::temp_dir().join(format!("airi-daemon-audit-test-{}", std::process::id()));
        let path = dir.join("awareness-audit.jsonl");
        let log = AuditLog::open(path.clone());
        log.append(
            "media",
            "media: Playing",
            "resumed with Bearer supersecretvalue123",
        );
        let contents = fs::read_to_string(&path).expect("audit file written");
        assert!(
            !contents.contains("supersecretvalue123"),
            "secret leaked into audit log"
        );
        assert!(contents.contains("resumed with ***"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_on_start_roundtrip_drops_old_lines() {
        let dir =
            std::env::temp_dir().join(format!("airi-daemon-prune-test-{}", std::process::id()));
        let path = dir.join("awareness-audit.jsonl");
        fs::create_dir_all(&dir).expect("mkdirs");
        let now = 1_800_000_000_000u64;
        let eight_days = now - 8 * DAY_MS;
        fs::write(
            &path,
            format!("{{\"ts_ms\":{eight_days},\"source\":\"media\",\"event\":\"old\",\"detail\":\"\"}}\n{{\"ts_ms\":{now},\"source\":\"media\",\"event\":\"fresh\",\"detail\":\"\"}}\n"),
        )
        .expect("seed");
        let log = AuditLog::open(path.clone());
        let dropped = log.prune_on_start(now);
        assert_eq!(dropped, 1);
        let kept = fs::read_to_string(&path).expect("read back");
        assert!(!kept.contains("\"old\""));
        assert!(kept.contains("\"fresh\""));
        // Second prune is a no-op.
        assert_eq!(log.prune_on_start(now), 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
