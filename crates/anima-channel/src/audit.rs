// SPDX-License-Identifier: GPL-3.0-or-later
//! Shared audit-log contract for the awareness daemon.
//!
//! The daemon appends; thin clients (the Slint shell today) tail-read and
//! archive the same file. This module is the single source of truth for the
//! file name, its data-dir-relative location, the tail reader, and the
//! archive naming — change it here, never in one consumer.

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

/// File name of the append-only audit JSONL.
pub const AUDIT_FILE_NAME: &str = "awareness-audit.jsonl";
/// App namespace directory under the platform data dir.
pub const AUDIT_APP_DIR_NAME: &str = "airi-slint";
/// Directory holding the audit file.
pub const AUDIT_DIR_NAME: &str = "audit";

/// `<data_dir>/airi-slint/audit/awareness-audit.jsonl`.
pub fn default_audit_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| {
        d.join(AUDIT_APP_DIR_NAME)
            .join(AUDIT_DIR_NAME)
            .join(AUDIT_FILE_NAME)
    })
}

/// Tail-parse the last `tail_bytes` of the JSONL file at `path`, returning
/// at most `cap` entries, newest last. Malformed lines are skipped and a
/// fragment cut mid-line by the seek is dropped; I/O failure is returned to
/// the caller (e.g. missing file), never panicked.
pub fn parse_jsonl_tail(
    path: &std::path::Path,
    cap: usize,
    tail_bytes: u64,
) -> std::io::Result<Vec<serde_json::Value>> {
    let mut file = fs::File::open(path)?;
    let len = file.seek(SeekFrom::End(0))?;
    file.seek(SeekFrom::Start(len.saturating_sub(tail_bytes)))?;
    let mut buf = String::new();
    file.read_to_string(&mut buf)?;
    // A fragment cut mid-line by the seek is not valid JSON.
    let start = len as usize - buf.len();
    let lines: Vec<&str> = if start == 0 {
        buf.lines().collect()
    } else {
        match buf.find('\n') {
            Some(i) => buf[i + 1..].lines().collect(),
            None => Vec::new(),
        }
    };
    let mut rows: Vec<serde_json::Value> = lines
        .into_iter()
        .rev()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                None
            } else {
                serde_json::from_str(trimmed).ok()
            }
        })
        .take(cap)
        .collect();
    rows.reverse();
    Ok(rows)
}

/// Archive the audit file to `<name>.cleared-<now_secs>[-<counter>]` in the
/// same directory. Atomic on the same filesystem; never truncates or deletes
/// history. A missing file is reported as `ErrorKind::NotFound`.
pub fn archive_audit_file(path: &std::path::Path, now_secs: u64) -> std::io::Result<PathBuf> {
    if !path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "audit file does not exist",
        ));
    }
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| AUDIT_FILE_NAME.to_string());
    let mut archive = path.with_file_name(format!("{file_name}.cleared-{now_secs}"));
    let mut counter = 1_u32;
    while archive.exists() {
        archive = path.with_file_name(format!("{file_name}.cleared-{now_secs}-{counter}"));
        counter += 1;
    }
    fs::rename(path, &archive)?;
    Ok(archive)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_reads_newest_last_and_caps() {
        let dir = std::env::temp_dir().join(format!("airi-audit-tail-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("audit.jsonl");
        let body: String = (0..100)
            .map(|i| format!("{{\"ts_ms\":{i},\"detail\":\"row {i}\"}}\n"))
            .collect();
        fs::write(&path, body).unwrap();
        let rows = parse_jsonl_tail(&path, 5, 4096).unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[4]["ts_ms"], 99);
        assert_eq!(rows[0]["ts_ms"], 95);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_skips_malformed_lines() {
        let dir = std::env::temp_dir().join(format!("airi-audit-tail-bad-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("audit.jsonl");
        fs::write(&path, "garbage\n{\"ts_ms\":1}\n\n{\"ts_ms\":2}\n").unwrap();
        let rows = parse_jsonl_tail(&path, 10, 4096).unwrap();
        assert_eq!(rows.len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn archive_never_overwrites_and_keeps_history() {
        let dir = std::env::temp_dir().join(format!("airi-audit-archive-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(AUDIT_FILE_NAME);
        fs::write(&path, "{\"ts_ms\":1}\n").unwrap();
        let first = archive_audit_file(&path, 1_700_000_000).unwrap();
        assert!(!path.exists());
        assert!(first.to_string_lossy().contains(".cleared-1700000000"));
        fs::write(&path, "{\"ts_ms\":2}\n").unwrap();
        // Same-second archive collides with the previous one; counter suffix.
        let second = archive_audit_file(&path, 1_700_000_000).unwrap();
        assert!(second.to_string_lossy().contains(".cleared-1700000000-1"));
        assert!(first.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn archive_missing_file_is_not_found() {
        let dir = std::env::temp_dir().join(format!("airi-audit-archive-none-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("nope.jsonl");
        let err = archive_audit_file(&path, 1).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
        let _ = fs::remove_dir_all(&dir);
    }
}
