// SPDX-License-Identifier: GPL-3.0-or-later
//! Screen capture bridge (`CaptureController`) exposed to QML.
//!
//! First slice of "vision": grab the primary screen to a PNG under the
//! captures directory and list the saved captures back. The actual grab
//! happens in the C++ shim (`src/cpp/capture_item.cpp`) through cxx-qt —
//! `QScreen::grabWindow(0)` needs a live `QGuiApplication`, which Qt hands
//! to the GUI thread; the bridge is only invoked from QML, so this stays
//! on the GUI thread too.
//!
//! Captures directory: `<profile>/captures/` when `--profile` is set, else
//! `<platform-data>/airi-qt/captures/` (same convention as the MCP config).
//!
//! Boundary contracts (same as the cards/MCP bridges):
//! - `capturesJson` is a JSON array of `{path, fileName, bytes, createdMs}`,
//!   newest first. `createdMs` is the file *mtime* in milliseconds since the
//!   epoch (creation time is not portable across filesystems).
//! - `clearCaptures` is destructive and deliberately narrow: it deletes only
//!   regular files directly inside the captures directory whose name matches
//!   `capture-<digits>.png` (exactly what the shim writes), never follows
//!   symlinks, and never touches anything else.

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use serde_json::json;
use std::path::PathBuf;
use std::pin::Pin;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::bridges;
use crate::bridges::qstring_to_string;

/// `<profile>/captures/` or `<platform-data>/airi-qt/captures/`.
fn captures_dir() -> Option<PathBuf> {
    bridges::profile_dir()
        .map(|p| p.join("captures"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-qt").join("captures")))
}

/// Strict match for the shim's output name: `capture-<digits>.png`.
fn is_capture_file(name: &str) -> bool {
    let Some(stem) = name
        .strip_prefix("capture-")
        .and_then(|rest| rest.strip_suffix(".png"))
    else {
        return false;
    };
    !stem.is_empty() && stem.bytes().all(|b| b.is_ascii_digit())
}

/// Milliseconds since the epoch for `time`, saturating at 0 on pre-1970 times.
fn system_time_millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// One capture entry for the JSON list, or `None` when the entry must be
/// skipped (unreadable metadata, not a regular file, not a capture name).
fn capture_entry(
    dir: &std::path::Path,
    entry: &std::fs::DirEntry,
) -> Option<(u64, serde_json::Value)> {
    let name = entry.file_name().to_str()?.to_string();
    if !is_capture_file(&name) {
        return None;
    }
    let metadata = std::fs::symlink_metadata(entry.path()).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return None;
    }
    let created_ms = metadata
        .modified()
        .ok()
        .map(system_time_millis)
        .unwrap_or(0);
    let path = dir.join(&name);
    Some((
        created_ms,
        json!({
            "path": path.to_string_lossy(),
            "fileName": name,
            "bytes": metadata.len(),
            "createdMs": created_ms,
        }),
    ))
}

/// Scan the captures directory; newest first. A missing directory is an
/// empty list, not an error (nothing has been captured yet).
fn scan_captures() -> Result<Vec<serde_json::Value>, String> {
    let Some(dir) = captures_dir() else {
        return Err("could not resolve a captures directory".into());
    };
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("failed to read {}: {e}", dir.display()))?;
    let mut items: Vec<(u64, serde_json::Value)> = entries
        .flatten()
        .filter_map(|entry| capture_entry(&dir, &entry))
        .collect();
    items.sort_by(|a, b| {
        b.0.cmp(&a.0).then_with(|| {
            // Stable, deterministic order for identical mtimes.
            a.1["fileName"].as_str().cmp(&b.1["fileName"].as_str())
        })
    });
    Ok(items.into_iter().map(|(_, value)| value).collect())
}

/// cxx-qt bridge definitions for the capture bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    unsafe extern "C++" {
        include!("airi-qt/src/cpp/capture_item.h");
        /// Grab the primary screen and save it under `out_dir` as
        /// `capture-<millis>.png`; returns the absolute path of the new
        /// PNG, or an empty string on failure (reason on stderr).
        fn airi_capture_primary_screen(out_dir: &QString) -> QString;
    }

    extern "RustQt" {
        /// Screen capture view-model. Create one per page.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, captures_json, cxx_name = "capturesJson")]
        #[qproperty(QString, last_error, cxx_name = "lastError")]
        #[qproperty(bool, working)]
        type CaptureController = super::CaptureControllerRust;
    }

    extern "RustQt" {
        /// Emitted after the capture list changes.
        #[qsignal]
        #[cxx_name = "capturesChanged"]
        fn captures_changed(self: Pin<&mut CaptureController>);

        /// Grab the primary screen and save it under the captures
        /// directory. Returns the absolute path of the new PNG, or an
        /// empty string on failure (see `lastError`).
        #[qinvokable]
        #[cxx_name = "captureNow"]
        fn capture_now(self: Pin<&mut CaptureController>) -> QString;

        /// Re-scan the captures directory; updates `capturesJson`.
        #[qinvokable]
        #[cxx_name = "refreshCaptures"]
        fn refresh_captures(self: Pin<&mut CaptureController>);

        /// Delete every `capture-<digits>.png` regular file directly inside
        /// the captures directory (never follows symlinks, never touches
        /// anything else). Returns the number of files deleted.
        #[qinvokable]
        #[cxx_name = "clearCaptures"]
        fn clear_captures(self: Pin<&mut CaptureController>) -> i32;
    }
}

/// Rust storage for `CaptureController`.
pub struct CaptureControllerRust {
    captures_json: QString,
    last_error: QString,
    working: bool,
}

impl Default for CaptureControllerRust {
    fn default() -> Self {
        Self {
            captures_json: QString::from("[]"),
            last_error: QString::from(""),
            working: false,
        }
    }
}

impl qobject::CaptureController {
    fn set_error(mut self: std::pin::Pin<&mut Self>, message: String) {
        let s = QString::from(message.as_str());
        self.as_mut().rust_mut().last_error = s.clone();
        self.as_mut().set_last_error(s);
    }

    fn clear_error(mut self: std::pin::Pin<&mut Self>) {
        let s = QString::from("");
        self.as_mut().rust_mut().last_error = s.clone();
        self.as_mut().set_last_error(s);
    }

    fn refresh_impl(mut self: std::pin::Pin<&mut Self>) {
        let (captures, error) = match scan_captures() {
            Ok(items) => (items, None),
            Err(e) => (Vec::new(), Some(e)),
        };
        let s = QString::from(
            serde_json::to_string(&captures)
                .unwrap_or_else(|_| "[]".into())
                .as_str(),
        );
        {
            let mut rust_mut = self.as_mut().rust_mut();
            rust_mut.captures_json = s.clone();
        }
        self.as_mut().set_captures_json(s);
        if let Some(e) = error {
            self.as_mut().set_error(e);
        }
        qobject::CaptureController::captures_changed(self.as_mut());
    }

    /// Grab the primary screen and save it under the captures directory.
    pub fn capture_now(mut self: Pin<&mut Self>) -> QString {
        self.as_mut().clear_error();
        if bridges::smoke() {
            // Same idiom as the desktop bridge's notification suppression:
            // never touch the real screen from a headless smoke run.
            self.as_mut()
                .set_error("screen capture is suppressed in smoke mode".into());
            return QString::from("");
        }
        let Some(dir) = captures_dir() else {
            self.as_mut()
                .set_error("could not resolve a captures directory".into());
            return QString::from("");
        };
        self.as_mut().set_working(true);
        let dir_string = dir.to_string_lossy().into_owned();
        let result = qobject::airi_capture_primary_screen(&QString::from(dir_string.as_str()));
        self.as_mut().set_working(false);
        let result_string = qstring_to_string(&result);
        if result_string.is_empty() {
            // The shim prints the specific reason to stderr; the bridge only
            // knows the grab failed. On Wayland that is expected — the
            // compositor denies QScreen::grabWindow.
            self.as_mut().set_error(
                "screen capture failed — see the log for the reason (Wayland compositors may deny the grab)"
                    .into(),
            );
            return QString::from("");
        }
        self.as_mut().clear_error();
        self.as_mut().refresh_impl();
        result
    }

    /// Re-scan the captures directory.
    pub fn refresh_captures(mut self: Pin<&mut Self>) {
        self.as_mut().clear_error();
        self.refresh_impl();
    }

    /// Delete every `capture-<digits>.png` regular file directly inside the
    /// captures directory. Returns the number of files deleted. Files that
    /// do not match the pattern — and anything not a direct regular child —
    /// are left untouched.
    pub fn clear_captures(mut self: Pin<&mut Self>) -> i32 {
        self.as_mut().clear_error();
        let Some(dir) = captures_dir() else {
            self.as_mut()
                .set_error("could not resolve a captures directory".into());
            return 0;
        };
        let mut deleted: i32 = 0;
        let mut failure: Option<String> = None;
        match std::fs::read_dir(&dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if !is_capture_file(&name) {
                        continue;
                    }
                    let metadata = match std::fs::symlink_metadata(entry.path()) {
                        Ok(metadata) => metadata,
                        Err(e) => {
                            failure = Some(format!("failed to stat {name}: {e}"));
                            continue;
                        }
                    };
                    // Regular files only — symlinks are never followed or removed.
                    if !metadata.is_file() {
                        continue;
                    }
                    match std::fs::remove_file(entry.path()) {
                        Ok(()) => deleted += 1,
                        Err(e) => failure = Some(format!("failed to delete {name}: {e}")),
                    }
                }
            }
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    failure = Some(format!("failed to read {}: {e}", dir.display()));
                }
            }
        }
        self.as_mut().refresh_impl();
        if let Some(failure) = failure {
            self.as_mut().set_error(failure);
        }
        deleted
    }
}
