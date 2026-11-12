// SPDX-License-Identifier: GPL-3.0-or-later
//! Crash log capture for Rust panics.
//!
//! [`install_panic_hook`] registers a process-wide panic hook that appends a
//! single JSON object (one line) to `<dir>/panic-<millis>-<pid>.log` before
//! chaining to the previously registered hook (so default stderr reporting is
//! preserved). The log directory defaults to the platform data dir
//! (`dirs::data_dir()/airi-qt/logs`).
//!
//! **Limitations (documented):**
//!
//! - Only Rust panics that *unwind* through the hook are captured. Aborts
//!   (`panic = "abort"`), stack overflows, and C++ `std::terminate` — e.g.
//!   exceptions raised inside Qt or cxx-qt C++ code — never reach the hook
//!   and are **not** logged here. Qt's own messages still flow to stderr via
//!   the app message handler installed in `airi_qt_bridge.cpp`.
//! - The hook performs best-effort I/O and must never panic while handling
//!   a panic; all failures are swallowed.
//!
//! On startup the hook also prunes the log directory to the newest
//! [`DEFAULT_KEEP`] `panic-*.log` files (by modification time, filename as
//! tie-break).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Default number of panic logs retained on disk.
pub const DEFAULT_KEEP: usize = 20;
/// Prefix of panic log files in the log directory.
const PANIC_LOG_PREFIX: &str = "panic-";
/// Extension of panic log files in the log directory.
const PANIC_LOG_EXT: &str = "log";

/// Configuration for [`install_panic_hook`].
#[derive(Debug, Clone)]
pub struct PanicLogConfig {
    /// Directory the panic logs are written to (created on demand).
    pub dir: PathBuf,
    /// Maximum number of `panic-*.log` files retained after pruning.
    pub keep: usize,
}

impl PanicLogConfig {
    /// Config writing into `dir`, keeping the default number of logs.
    #[must_use]
    pub fn with_dir(dir: impl Into<PathBuf>) -> Self {
        Self {
            dir: dir.into(),
            keep: DEFAULT_KEEP,
        }
    }

    /// Default log directory: `<dirs::data_dir()>/airi-qt/logs`, falling
    /// back to the temp dir when the platform data dir cannot be determined.
    #[must_use]
    pub fn default_dir() -> PathBuf {
        dirs::data_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("airi-qt")
            .join("logs")
    }
}

/// Install the panic hook and prune old panic logs first.
///
/// Safe to call once at process start (before any Qt calls). Calling it
/// again replaces the previously installed hook (the old hook is still
/// chained, so calling twice chains through the first custom hook once).
pub fn install_panic_hook(config: PanicLogConfig) {
    let _ = prune_panic_logs(&config.dir, config.keep);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = panic_message(info);
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()));
        let backtrace = backtrace_if_enabled();
        let _ = write_panic_log(
            &config.dir,
            &message,
            location.as_deref(),
            backtrace.as_deref(),
        );
        previous(info);
    }));
}

/// Render a panic hook info into a human-readable message body.
fn panic_message(info: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(s) = info.payload().downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "<non-string panic payload>".to_string()
    }
}

/// Capture a backtrace when `RUST_BACKTRACE` is truthy (`1`, `full`, `true`).
///
/// `std::backtrace::Backtrace::capture` already honors the variable; the
/// point of the explicit gate is to keep the log body small — when unset the
/// backtrace is recorded as absent rather than embedding the placeholder
/// note that `Backtrace::capture()` renders in its disabled state.
fn backtrace_if_enabled() -> Option<String> {
    match std::env::var("RUST_BACKTRACE") {
        Ok(v) if matches!(v.trim(), "1" | "full" | "true" | "yes") => {
            Some(format!("{}", std::backtrace::Backtrace::capture()))
        }
        _ => None,
    }
}

/// Write one panic log entry. Returns the path of the created file.
///
/// Split from the hook so unit tests can exercise serialization without
/// touching the process-global hook.
///
/// # Errors
///
/// Returns any I/O error encountered while creating the directory or the
/// log file. Callers in the panic path should ignore the result.
pub fn write_panic_log(
    dir: &Path,
    message: &str,
    location: Option<&str>,
    backtrace: Option<&str>,
) -> std::io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let millis = now.as_millis();
    let file_name = format!("{PANIC_LOG_PREFIX}{millis}-{}.log", std::process::id());
    // Defensive normalization; the format above cannot contain separators.
    let file_name: String = file_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect();
    let path = dir.join(file_name);

    let line = serde_json::json!({
        "ts": millis as u64,
        "pid": std::process::id(),
        "message": message,
        "location": location,
        "backtrace": backtrace,
    });
    let mut file = fs::File::create(&path)?;
    writeln!(file, "{line}")?;
    Ok(path)
}

/// Prune `dir` to the newest `keep` panic logs. Returns the number removed.
///
/// Ordering is by mtime, with the file name as a deterministic tie-break.
/// Non-panic files and unreadable entries are left untouched. A missing
/// directory is not an error (returns `Ok(0)`).
///
/// # Errors
///
/// Returns the first I/O error encountered while reading the directory or
/// removing a file. Individual unlink failures are skipped.
pub fn prune_panic_logs(dir: &Path, keep: usize) -> std::io::Result<usize> {
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e),
    };
    let mut entries: Vec<(PathBuf, SystemTime)> = Vec::new();
    for entry in read_dir.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with(PANIC_LOG_PREFIX) || !name.ends_with(PANIC_LOG_EXT) {
            continue;
        }
        let mtime = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(UNIX_EPOCH);
        entries.push((entry.path(), mtime));
    }
    // Newest first.
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
    let mut removed = 0;
    for (path, _) in entries.into_iter().skip(keep) {
        if fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_panic_log_emits_json_line_with_message() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_panic_log(
            dir.path(),
            "synthetic crash marker",
            Some("src/x.rs:10:5"),
            None,
        )
        .unwrap();
        let body = fs::read_to_string(&path).unwrap();
        assert!(body.ends_with('\n'));
        let line: serde_json::Value = serde_json::from_str(body.trim_end()).unwrap();
        assert_eq!(line["message"], "synthetic crash marker");
        assert_eq!(line["location"], "src/x.rs:10:5");
        assert!(line["ts"].as_u64().is_some());
        assert_eq!(line["pid"], std::process::id());
        assert!(line["backtrace"].is_null());
        let name = path.file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with(PANIC_LOG_PREFIX));
        assert!(name.ends_with(".log"));
    }

    #[test]
    fn write_panic_log_records_backtrace_when_provided() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_panic_log(dir.path(), "with bt", None, Some("frame0\nframe1")).unwrap();
        let line: serde_json::Value =
            serde_json::from_str(fs::read_to_string(&path).unwrap().trim_end()).unwrap();
        assert_eq!(line["backtrace"], "frame0\nframe1");
    }

    #[test]
    fn prune_keeps_newest_twenty() {
        let dir = tempfile::tempdir().unwrap();
        // 25 fake logs, increasing mtimes by 1s each.
        let base = UNIX_EPOCH;
        let mut paths = Vec::new();
        for i in 0..25 {
            let p = dir.path().join(format!("panic-{:06}-1.log", i));
            fs::write(&p, b"{}\n").unwrap();
            let file = fs::File::options().write(true).open(&p).unwrap();
            file.set_modified(base + std::time::Duration::from_secs(i))
                .unwrap();
            paths.push(p);
        }
        // Unrelated files must survive.
        fs::write(dir.path().join("keep-me.log"), b"x").unwrap();
        fs::write(dir.path().join("panic-notlogs.txt"), b"x").unwrap();

        let removed = prune_panic_logs(dir.path(), DEFAULT_KEEP).unwrap();
        assert_eq!(removed, 5);
        let remaining: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.starts_with(PANIC_LOG_PREFIX) && n.ends_with(".log"))
                    .unwrap_or(false)
            })
            .collect();
        assert_eq!(remaining.len(), DEFAULT_KEEP);
        // The 5 oldest (0..5) are gone; the newest (5..25) survive.
        for old in &paths[..5] {
            assert!(!old.exists());
        }
        for new in &paths[5..] {
            assert!(new.exists());
        }
        assert!(dir.path().join("keep-me.log").exists());
        assert!(dir.path().join("panic-notlogs.txt").exists());
    }

    #[test]
    fn prune_missing_dir_is_ok() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        assert_eq!(prune_panic_logs(&missing, DEFAULT_KEEP).unwrap(), 0);
    }

    #[test]
    fn installed_hook_writes_log_on_unwind() {
        let dir = tempfile::tempdir().unwrap();
        install_panic_hook(PanicLogConfig::with_dir(dir.path().to_path_buf()));
        let _ = std::panic::catch_unwind(|| panic!("synthetic crash marker 1234"));
        // The hook wrote and flushed before returning to catch_unwind.
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.starts_with(PANIC_LOG_PREFIX))
                    .unwrap_or(false)
            })
            .collect();
        assert_eq!(entries.len(), 1, "expected exactly one panic log");
        let body = fs::read_to_string(entries[0].path()).unwrap();
        assert!(body.contains("synthetic crash marker 1234"));
        assert!(body.contains("\"message\""));
        assert!(body.contains("\"ts\""));
        // With RUST_BACKTRACE unset the field must be null.
        if std::env::var("RUST_BACKTRACE").is_err() {
            assert!(body.contains("\"backtrace\":null"));
        }
    }
}
