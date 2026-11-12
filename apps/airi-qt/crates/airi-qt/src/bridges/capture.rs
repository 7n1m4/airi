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
//! - The Wayland path: `captureViaPortal()` asks the XDG desktop portal for
//!   a full-screen screenshot (user-consent dialog, by design) and saves the
//!   result under the same captures directory with the same
//!   `capture-<digits>.png` convention. The call is always human-initiated
//!   and never happens in smoke mode.

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

// ── Portal (XDG desktop portal) screenshot path ───────────────────────
//
// The sanctioned way to grab the screen on Wayland: the
// `org.freedesktop.portal.Desktop` service, `org.freedesktop.portal.Screenshot`
// interface. Implemented by the desktop portal frontend, which routes to a
// backend (this machine: Hyprland, see `org.freedesktop.impl.portal.Screenshot`
// — the GTK backend does not implement it). The call opens a *user-consent
// dialog*, so it is always human-initiated from the page and never from
// smoke; the actual roundtrip runs on a worker thread (the dialog may sit
// open arbitrarily long) and results are merged into the shared state on the
// next `refresh()`.

/// Well-known session-bus name owned by the desktop portal frontend.
const PORTAL_DESTINATION: &str = "org.freedesktop.portal.Desktop";
/// Object path the desktop portal exports.
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
/// Sandbox-facing interface for the screenshot call.
const PORTAL_SCREENSHOT_IFACE: &str = "org.freedesktop.portal.Screenshot";
/// Shared request interface carrying the `Response` signal.
const PORTAL_REQUEST_IFACE: &str = "org.freedesktop.portal.Request";
/// Bounded timeout for D-Bus calls in the probe and the portal roundtrip.
const PORTAL_DBUS_TIMEOUT: Duration = Duration::from_millis(800);
/// How long the worker waits for the user's consent dialog before cancelling.
const PORTAL_RESPONSE_DEADLINE: Duration = Duration::from_secs(8);

use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Map a portal probe into `(available, one-liner)`. Pure — the probe's two
/// D-Bus calls feed in as `Result`s so the mapping is unit-testable without a
/// bus.
fn portal_probe_status(
    owner: Result<bool, String>,
    version: Result<u32, String>,
) -> (bool, String) {
    match owner {
        Err(e) => (false, format!("portal: unavailable ({e})")),
        Ok(false) => (false, "portal: unavailable (no name owner)".to_string()),
        Ok(true) => match version {
            Ok(v) => (true, format!("portal: available (Screenshot version {v})")),
            Err(e) => (
                false,
                format!("portal: unavailable (version lookup failed: {e})"),
            ),
        },
    }
}

/// Probe the portal: `NameHasOwner(org.freedesktop.portal.Desktop)` on the
/// session bus, then `Properties.Get(…, "version")` on
/// `org.freedesktop.portal.Screenshot`. Cheap and read-only; never calls
/// `Screenshot`. Opens its own connection (never the GUI thread's).
fn probe_portal() -> (bool, String) {
    use dbus::blocking::Connection;
    let conn = match Connection::new_session() {
        Ok(conn) => conn,
        Err(e) => {
            return portal_probe_status(Err(format!("session bus: {e}")), Err("skipped".into()))
        }
    };
    let bus = conn.with_proxy(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        PORTAL_DBUS_TIMEOUT,
    );
    let owner: Result<(bool,), dbus::Error> = bus.method_call(
        "org.freedesktop.DBus",
        "NameHasOwner",
        (PORTAL_DESTINATION,),
    );
    match owner {
        Ok((true,)) => {
            let proxy = conn.with_proxy(PORTAL_DESTINATION, PORTAL_PATH, PORTAL_DBUS_TIMEOUT);
            let version: Result<(dbus::arg::Variant<Box<dyn dbus::arg::RefArg>>,), dbus::Error> =
                proxy.method_call(
                    "org.freedesktop.DBus.Properties",
                    "Get",
                    (PORTAL_SCREENSHOT_IFACE, "version"),
                );
            let version = version.map_err(|e| e.to_string()).and_then(|(variant,)| {
                dbus::arg::cast::<u32>(&variant.0)
                    .copied()
                    .ok_or_else(|| "version property is not a u32".to_string())
            });
            portal_probe_status(Ok(true), version)
        }
        Ok((false,)) => portal_probe_status(Ok(false), Err("skipped".into())),
        Err(e) => portal_probe_status(Err(e.to_string()), Err("skipped".into())),
    }
}

/// Percent-decode one URI path segment. Invalid escapes are an error, never
/// a silent passthrough.
fn percent_decode_segment(segment: &str) -> Result<String, String> {
    fn hex_value(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hi = bytes.get(i + 1).and_then(|b| hex_value(*b));
                let lo = bytes.get(i + 2).and_then(|b| hex_value(*b));
                match (hi, lo) {
                    (Some(hi), Some(lo)) => {
                        decoded.push(hi << 4 | lo);
                        i += 3;
                    }
                    _ => {
                        return Err(format!(
                            "portal: invalid percent-escape at offset {i} in the uri"
                        ));
                    }
                }
            }
            b => {
                decoded.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(decoded)
        .map_err(|_| "portal: uri is not valid UTF-8 after decoding".to_string())
}

/// Convert a `file://` URI (the portal's `uri` result) into a local path.
/// Percent-decodes each path segment (a name with spaces/UTF-8 must survive),
/// accepts an empty or `localhost` authority, and rejects non-`file` schemes,
/// other authorities, trailing slashes (a directory, never a capture), the
/// root path, and invalid escapes/UTF-8. Unix-oriented by design — the app
/// targets Linux/BSD desktop portals; Windows drive letters are out of scope.
fn uri_to_path(uri: &str) -> Result<PathBuf, String> {
    let rest = uri
        .strip_prefix("file://")
        .ok_or_else(|| "portal: uri is not a file:// uri".to_string())?;
    let path_part = rest.strip_prefix("localhost").unwrap_or(rest);
    if !path_part.starts_with('/') {
        return Err("portal: file uri has a non-local authority or no absolute path".to_string());
    }
    if path_part == "/" {
        return Err("portal: uri points at the filesystem root".to_string());
    }
    if path_part.ends_with('/') {
        return Err("portal: uri points at a directory (trailing slash)".to_string());
    }
    let mut out = String::with_capacity(path_part.len());
    for (index, segment) in path_part.split('/').enumerate() {
        if index > 0 {
            out.push('/');
        }
        out.push_str(&percent_decode_segment(segment)?);
    }
    Ok(PathBuf::from(out))
}

/// `capture-<epoch_ms>.png` path inside `dir`; bumps the millisecond when the
/// name is taken instead of overwriting. Deterministic and collision-safe
/// against pre-existing captures.
fn unique_capture_path(dir: &std::path::Path, epoch_ms: u64) -> PathBuf {
    let mut ms = epoch_ms;
    loop {
        let candidate = dir.join(format!("capture-{ms}.png"));
        if !candidate.exists() {
            return candidate;
        }
        ms += 1;
    }
}

/// Move the portal's temp file into the captures directory. A plain rename
/// first; on any failure, fall back to copy + remove of the *portal's own
/// temp file we just copied* — portal temp files usually land on
/// `$XDG_RUNTIME_DIR` (tmpfs) while the data dir lives on disk, so rename
/// can legitimately fail across the boundary. Nothing else is ever removed.
fn move_file(src: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    match std::fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(rename_err) => {
            std::fs::copy(src, dest).map_err(|e| {
                format!(
                    "portal: could not copy {} to {}: {e} (rename failed: {rename_err})",
                    src.display(),
                    dest.display()
                )
            })?;
            std::fs::remove_file(src).map_err(|e| {
                format!(
                    "portal: copied to {} but could not remove the portal temp file {}: {e}",
                    dest.display(),
                    src.display()
                )
            })
        }
    }
}

/// Shared state between the Qt thread and the portal worker thread. The
/// worker records the outcome; the next `refresh()` drains it into the
/// qproperties.
struct PortalShared {
    /// `true` when the probe found the Screenshot portal on the session bus.
    available: bool,
    /// Human one-liner, raw English, always `portal: …`-prefixed.
    status: String,
    /// `true` while a portal capture is in flight (dialog open or roundtrip
    /// running).
    busy: bool,
    /// Outcome of the last finished capture, not yet consumed by `refresh()`.
    outcome: Option<Result<String, String>>,
}

impl PortalShared {
    fn new() -> Self {
        let (available, status) = probe_portal();
        Self {
            available,
            status,
            busy: false,
            outcome: None,
        }
    }
}

/// Process-lifetime shared state, same idiom as the Discord gateway bridge.
static PORTAL_STATE: OnceLock<Arc<Mutex<PortalShared>>> = OnceLock::new();

fn portal_shared() -> &'static Arc<Mutex<PortalShared>> {
    PORTAL_STATE.get_or_init(|| Arc::new(Mutex::new(PortalShared::new())))
}

/// Lock the shared state, poison-tolerant (a panicking worker must not wedge
/// the UI).
fn lock_portal() -> std::sync::MutexGuard<'static, PortalShared> {
    portal_shared().lock().unwrap_or_else(|e| e.into_inner())
}

/// Gate a new portal capture. Sets `busy` and the pending status on success;
/// on refusal the status line says why (the caller maps that to `false`).
fn try_begin_capture(shared: &mut PortalShared) -> Result<(), String> {
    if !shared.available {
        shared.status = "portal: unavailable — cannot capture".to_string();
        return Err(shared.status.clone());
    }
    if shared.busy {
        shared.status = "portal: a capture is already in flight".to_string();
        return Err(shared.status.clone());
    }
    shared.busy = true;
    shared.status = "portal: waiting for consent…".to_string();
    Ok(())
}

/// Worker-side epilogue: busy is cleared no matter what, the outcome is
/// recorded, and the status line reflects it honestly. Split out for unit
/// tests.
fn finish_portal_capture(shared: &mut PortalShared, result: Result<String, String>) {
    shared.busy = false;
    shared.status = match &result {
        Ok(name) => format!("portal: saved {name}"),
        Err(reason) => format!("portal: {reason}"),
    };
    shared.outcome = Some(result);
}

/// Consume a pending outcome, if any. The worker owns `busy`; the drain only
/// clears the outcome slot.
fn drain_portal_outcome(shared: &mut PortalShared) -> Option<Result<String, String>> {
    shared.outcome.take()
}

/// The D-Bus roundtrip for one screenshot. Runs on the worker thread only.
///
/// Sequence (contract: `org.freedesktop.portal.Screenshot`, verified against
/// the installed interface XMLs in /usr/share/dbus-1/interfaces):
///
/// 1. New blocking session-bus connection (never the GUI thread's).
/// 2. `handle_token` option (a valid object-path element) is passed so the
///    request path is predictable; we subscribe to `Response` *before* the
///    call, which is the race avoidance the `org.freedesktop.portal.Request`
///    docs recommend. Subscription has no path filter: this connection is
///    private to this capture, so any `Response` signal on it is ours.
/// 3. `Screenshot(parent_window: "", options: a{sv} {handle_token})`.
///    Empty `parent_window` is valid; the reply carries the request path `o`.
/// 4. Wait for `org.freedesktop.portal.Request::Response(response: u,
///    results: a{sv})` for up to 8 s; timeout → best-effort `Close` on the
///    request path and an honest error.
/// 5. `response == 0` → take `uri` (`s`), convert to a path, move the file
///    into the captures directory as `capture-<epoch_ms>.png` (bumping the
///    ms on collision). `response == 1` → cancelled; `>= 2` → failed.
fn portal_screenshot_run(dir: &std::path::Path) -> Result<String, String> {
    use dbus::arg::{prop_cast, PropMap, RefArg, Variant};
    use dbus::blocking::Connection;
    use dbus::message::MatchRule;
    use std::collections::HashMap;

    let conn = Connection::new_session().map_err(|e| format!("session bus: {e}"))?;

    // Unique, non-guessable-enough token for the request path.
    let token = format!(
        "airi_capture_{}_{}",
        std::process::id(),
        system_time_millis(SystemTime::now())
    );
    let sender = conn
        .unique_name()
        .into_static()
        .to_string()
        .trim_start_matches(':')
        .replace('.', "_");
    let expected_path = format!("/org/freedesktop/portal/desktop/request/{sender}/{token}");

    // Subscribe before the call so the Response can never slip past us.
    let slot: Arc<Mutex<Option<(u32, PropMap)>>> = Arc::new(Mutex::new(None));
    let slot_cb = Arc::clone(&slot);
    let subscribe = conn.add_match(
        MatchRule::new_signal(PORTAL_REQUEST_IFACE, "Response"),
        move |(response, results): (u32, PropMap), _c: &Connection, _m: &dbus::Message| {
            let mut guard = slot_cb.lock().unwrap_or_else(|e| e.into_inner());
            if guard.is_none() {
                *guard = Some((response, results));
            }
            false // one-shot: auto-remove this subscription
        },
    );
    // If we cannot even subscribe, there is no point calling the portal.
    if let Err(e) = subscribe {
        return Err(format!("portal: could not subscribe to Response: {e}"));
    }

    let proxy = conn.with_proxy(PORTAL_DESTINATION, PORTAL_PATH, PORTAL_DBUS_TIMEOUT);
    let mut options: HashMap<String, Variant<Box<dyn RefArg>>> = HashMap::new();
    options.insert(
        "handle_token".to_string(),
        Variant(Box::new(token) as Box<dyn RefArg>),
    );
    let (handle,): (dbus::Path,) = proxy
        .method_call(PORTAL_SCREENSHOT_IFACE, "Screenshot", ("", options))
        .map_err(|e| format!("portal Screenshot call failed: {e}"))?;
    let handle_path = handle.to_string();
    if handle_path != expected_path {
        // Odd but legitimate (old portals); our subscription has no path
        // filter, so the Response still reaches us either way.
        eprintln!(
            "[airi-qt][capture] portal returned handle {handle_path} (expected {expected_path})"
        );
    }

    let deadline = std::time::Instant::now() + PORTAL_RESPONSE_DEADLINE;
    loop {
        let got = {
            let guard = slot.lock().unwrap_or_else(|e| e.into_inner());
            guard.is_some()
        };
        if got {
            break;
        }
        if std::time::Instant::now() >= deadline {
            // Timeout: ask the portal to abort the request. Best effort.
            let close_proxy = conn.with_proxy(
                PORTAL_DESTINATION,
                handle_path.as_str(),
                PORTAL_DBUS_TIMEOUT,
            );
            let _: Result<(), dbus::Error> =
                close_proxy.method_call(PORTAL_REQUEST_IFACE, "Close", ());
            return Err(
                "no response after 8 s — cancelled (the dialog may still be open; close it)"
                    .to_string(),
            );
        }
        conn.process(Duration::from_millis(100))
            .map_err(|e| format!("portal bus error: {e}"))?;
    }

    let (response, results) = slot
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .expect("checked above");
    match response {
        0 => {}
        1 => return Err("screenshot cancelled in the portal dialog".to_string()),
        n => return Err(format!("portal reported failure (response {n})")),
    }
    let uri = prop_cast::<String>(&results, "uri")
        .cloned()
        .ok_or_else(|| "portal response did not include a uri".to_string())?;
    let src = uri_to_path(&uri)?;
    // The portal's temp file may land on another filesystem than the data
    // dir (tmpfs vs disk); move_file handles rename-or-copy.
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let ms = system_time_millis(SystemTime::now());
    let dest = unique_capture_path(dir, ms);
    let name = dest
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_owned)
        .ok_or_else(|| "portal: generated an invalid capture file name".to_string())?;
    move_file(&src, &dest)?;
    Ok(name)
}

/// Worker entry point. Every exit path records the outcome and clears `busy`.
fn portal_worker(shared: Arc<Mutex<PortalShared>>, dir: PathBuf) {
    let result =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| portal_screenshot_run(&dir)))
            .unwrap_or_else(|_| Err("internal error (portal worker panicked)".to_string()));
    let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
    finish_portal_capture(&mut guard, result);
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
        #[qproperty(bool, portal_available, cxx_name = "portalAvailable")]
        #[qproperty(QString, portal_status, cxx_name = "portalStatus")]
        #[qproperty(bool, portal_busy, cxx_name = "portalBusy")]
        type CaptureController = super::CaptureControllerRust;
    }

    extern "RustQt" {
        /// Emitted after the capture list changes.
        #[qsignal]
        #[cxx_name = "capturesChanged"]
        fn captures_changed(self: Pin<&mut CaptureController>);

        /// Emitted after a portal probe or a portal capture outcome changes.
        #[qsignal]
        #[cxx_name = "portalChanged"]
        fn portal_changed(self: Pin<&mut CaptureController>);

        /// Grab the primary screen and save it under the captures
        /// directory. Returns the absolute path of the new PNG, or an
        /// empty string on failure (see `lastError`).
        #[qinvokable]
        #[cxx_name = "captureNow"]
        fn capture_now(self: Pin<&mut CaptureController>) -> QString;

        /// Ask the XDG desktop portal for a full-screen screenshot (a system
        /// consent dialog opens each time, by design) and save it under the
        /// captures directory as `capture-<millis>.png`. Returns `true` when
        /// the worker thread was spawned — the capture itself is async; poll
        /// `capturesJson`/`portalStatus` on the next `refreshCaptures()`.
        /// Returns `false` (and says why in `portalStatus`) when the portal
        /// is unavailable, a capture is already in flight, or smoke mode is
        /// active. Never called automatically — the page button is the only
        /// trigger.
        #[qinvokable]
        #[cxx_name = "captureViaPortal"]
        fn capture_via_portal(self: Pin<&mut CaptureController>) -> bool;

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
    portal_available: bool,
    portal_status: QString,
    portal_busy: bool,
}

impl Default for CaptureControllerRust {
    fn default() -> Self {
        // Probe at construction so the qproperties are honest before the
        // page's first refresh. The probe is read-only (NameHasOwner +
        // Properties.Get) and never calls `Screenshot`.
        let shared = lock_portal();
        Self {
            captures_json: QString::from("[]"),
            last_error: QString::from(""),
            working: false,
            portal_available: shared.available,
            portal_status: QString::from(shared.status.as_str()),
            portal_busy: shared.busy,
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
        // Merge any finished portal capture and re-probe the portal so the
        // qproperties stay honest on every refresh. capturesJson keeps its
        // shape — a portal-saved file appears in the scan like any other.
        let (portal_available, portal_status, portal_busy, portal_error) = {
            let mut shared = lock_portal();
            let outcome = drain_portal_outcome(&mut shared);
            let (available, probe_status) = probe_portal();
            shared.available = available;
            shared.status = match &outcome {
                Some(Ok(name)) => format!("portal: saved {name}"),
                Some(Err(reason)) => format!("portal: {reason}"),
                // Keep the pending line while a capture is in flight — the
                // probe result must not overwrite "waiting for consent…".
                None if shared.busy => shared.status.clone(),
                None => probe_status,
            };
            let portal_error = match &outcome {
                Some(Err(reason)) => Some(reason.clone()),
                _ => None,
            };
            (
                shared.available,
                shared.status.clone(),
                shared.busy,
                portal_error,
            )
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
        } else if let Some(e) = portal_error {
            self.as_mut().set_error(e);
        }
        qobject::CaptureController::captures_changed(self.as_mut());
        self.as_mut()
            .sync_portal_properties(portal_available, portal_status, portal_busy);
    }

    /// Copy the portal qproperties into the QObject and emit `portalChanged`.
    fn sync_portal_properties(
        mut self: std::pin::Pin<&mut Self>,
        available: bool,
        status: String,
        busy: bool,
    ) {
        let status_q = QString::from(status.as_str());
        {
            let mut rust_mut = self.as_mut().rust_mut();
            rust_mut.portal_available = available;
            rust_mut.portal_status = status_q.clone();
            rust_mut.portal_busy = busy;
        }
        self.as_mut().set_portal_available(available);
        self.as_mut().set_portal_status(status_q);
        self.as_mut().set_portal_busy(busy);
        qobject::CaptureController::portal_changed(self.as_mut());
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

    /// Ask the XDG desktop portal for a full-screen screenshot (see the
    /// qinvokable docs). Returns `true` when the worker thread was spawned —
    /// the capture is async and the page is expected to poll
    /// `refreshCaptures()` on a short timer until `portalBusy` clears.
    pub fn capture_via_portal(mut self: Pin<&mut Self>) -> bool {
        self.as_mut().clear_error();
        if bridges::smoke() {
            // Same rail as the X11 path: never touch the real screen (and
            // never open a consent dialog) from a headless smoke run.
            self.as_mut()
                .set_error("portal screenshot is suppressed in smoke mode".into());
            {
                let mut shared = lock_portal();
                shared.status = "portal: suppressed in smoke mode".into();
            }
            self.as_mut().sync_portal_properties_from_shared();
            return false;
        }
        let Some(dir) = captures_dir() else {
            self.as_mut()
                .set_error("could not resolve a captures directory".into());
            return false;
        };
        {
            let mut shared = lock_portal();
            if try_begin_capture(&mut shared).is_err() {
                let (available, status, busy) =
                    (shared.available, shared.status.clone(), shared.busy);
                drop(shared);
                // "statusLine says why" — the reason stays in portalStatus;
                // lastError is reserved for real failures.
                self.as_mut()
                    .sync_portal_properties(available, status, busy);
                return false;
            }
        }
        let shared = Arc::clone(portal_shared());
        let spawn = std::thread::Builder::new()
            .name("portal-screenshot".to_string())
            .spawn(move || portal_worker(shared, dir));
        match spawn {
            Ok(_handle) => {
                // Fire and forget: the outcome is merged on the next
                // `refreshCaptures()` call (the page polls on a timer).
                self.as_mut().sync_portal_properties_from_shared();
                true
            }
            Err(e) => {
                let mut guard = lock_portal();
                finish_portal_capture(
                    &mut guard,
                    Err(format!("failed to spawn portal thread: {e}")),
                );
                drop(guard);
                self.as_mut().sync_portal_properties_from_shared();
                false
            }
        }
    }

    /// Re-sync the portal qproperties from the shared state (used after
    /// status-only writes that did not go through a full refresh).
    fn sync_portal_properties_from_shared(mut self: Pin<&mut Self>) {
        let (available, status, busy) = {
            let shared = lock_portal();
            (shared.available, shared.status.clone(), shared.busy)
        };
        self.as_mut()
            .sync_portal_properties(available, status, busy);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_to_path_converts_plain_file_uri() {
        assert_eq!(
            uri_to_path("file:///home/vi/capture-1.png").unwrap(),
            PathBuf::from("/home/vi/capture-1.png")
        );
    }

    #[test]
    fn uri_to_path_percent_decodes_escapes() {
        assert_eq!(
            uri_to_path("file:///home/vi/my%20capture.png").unwrap(),
            PathBuf::from("/home/vi/my capture.png")
        );
        // U+00F6 (ö) in UTF-8 is 0xC3 0xB6.
        assert_eq!(
            uri_to_path("file:///home/vi/%C3%B6.png").unwrap(),
            PathBuf::from("/home/vi/ö.png")
        );
        // Mixed escapes and literal text.
        assert_eq!(
            uri_to_path("file:///tmp/%73creen%20shot%20(2).png").unwrap(),
            PathBuf::from("/tmp/screen shot (2).png")
        );
    }

    #[test]
    fn uri_to_path_accepts_localhost_authority() {
        assert_eq!(
            uri_to_path("file://localhost/home/vi/a%20b.png").unwrap(),
            PathBuf::from("/home/vi/a b.png")
        );
    }

    #[test]
    fn uri_to_path_rejects_non_file_schemes() {
        assert!(uri_to_path("https://example.com/x.png").is_err());
        assert!(uri_to_path("http:///x.png").is_err());
        assert!(uri_to_path("ftp:///x.png").is_err());
        assert!(uri_to_path("x.png").is_err());
    }

    #[test]
    fn uri_to_path_rejects_bad_authority_and_relative() {
        assert!(uri_to_path("file://example.com/x.png").is_err());
        assert!(uri_to_path("file:relative/x.png").is_err());
        assert!(uri_to_path("file://").is_err());
    }

    #[test]
    fn uri_to_path_rejects_trailing_slash_and_root() {
        assert!(uri_to_path("file:///tmp/dir/").is_err());
        assert!(uri_to_path("file:///").is_err());
    }

    #[test]
    fn uri_to_path_rejects_invalid_percent_escapes() {
        assert!(uri_to_path("file:///tmp/100%.png").is_err());
        assert!(uri_to_path("file:///tmp/%zz.png").is_err());
        assert!(uri_to_path("file:///tmp/%1.png").is_err());
        // %FF%FE is not valid UTF-8.
        assert!(uri_to_path("file:///tmp/%FF%FE.png").is_err());
    }

    #[test]
    fn unique_capture_path_bumps_ms_on_collision() {
        let unique = format!(
            "airi-qt-capture-test-{}-{}",
            std::process::id(),
            system_time_millis(SystemTime::now())
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).unwrap();
        let base_ms = 1_700_000_000_000u64;
        std::fs::write(dir.join(format!("capture-{base_ms}.png")), b"x").unwrap();
        std::fs::write(dir.join(format!("capture-{}.png", base_ms + 1)), b"x").unwrap();
        let picked = unique_capture_path(&dir, base_ms);
        assert_eq!(picked, dir.join(format!("capture-{}.png", base_ms + 2)));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unique_capture_path_uses_requested_ms_when_free() {
        let unique = format!(
            "airi-qt-capture-test-{}-{}",
            std::process::id(),
            system_time_millis(SystemTime::now()) + 1
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).unwrap();
        let picked = unique_capture_path(&dir, 1_700_000_000_123);
        assert_eq!(picked, dir.join("capture-1700000000123.png"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn probe_status_maps_bus_error() {
        let (available, status) = portal_probe_status(
            Err("session bus: not reachable".to_string()),
            Err("skipped".to_string()),
        );
        assert!(!available);
        assert_eq!(status, "portal: unavailable (session bus: not reachable)");
    }

    #[test]
    fn probe_status_maps_no_name_owner() {
        let (available, status) = portal_probe_status(Ok(false), Err("skipped".to_string()));
        assert!(!available);
        assert_eq!(status, "portal: unavailable (no name owner)");
    }

    #[test]
    fn probe_status_maps_available_with_version() {
        let (available, status) = portal_probe_status(Ok(true), Ok(2));
        assert!(available);
        assert_eq!(status, "portal: available (Screenshot version 2)");
    }

    #[test]
    fn probe_status_maps_version_lookup_failure() {
        let (available, status) = portal_probe_status(Ok(true), Err("get failed".to_string()));
        assert!(!available);
        assert_eq!(
            status,
            "portal: unavailable (version lookup failed: get failed)"
        );
    }

    #[test]
    fn try_begin_capture_refuses_when_unavailable() {
        let mut shared = PortalShared {
            available: false,
            status: String::new(),
            busy: false,
            outcome: None,
        };
        assert!(try_begin_capture(&mut shared).is_err());
        assert!(!shared.busy);
        assert_eq!(shared.status, "portal: unavailable — cannot capture");
    }

    #[test]
    fn try_begin_capture_refuses_when_busy() {
        let mut shared = PortalShared {
            available: true,
            status: String::new(),
            busy: true,
            outcome: None,
        };
        assert!(try_begin_capture(&mut shared).is_err());
        assert!(shared.busy);
        assert_eq!(shared.status, "portal: a capture is already in flight");
    }

    #[test]
    fn begin_then_finish_transitions_flags() {
        let mut shared = PortalShared {
            available: true,
            status: String::new(),
            busy: false,
            outcome: None,
        };
        assert!(try_begin_capture(&mut shared).is_ok());
        assert!(shared.busy);
        assert_eq!(shared.status, "portal: waiting for consent…");
        // Fake worker result injected.
        finish_portal_capture(&mut shared, Ok("capture-1700000000123.png".to_string()));
        assert!(!shared.busy);
        assert_eq!(shared.status, "portal: saved capture-1700000000123.png");
        let drained = drain_portal_outcome(&mut shared);
        assert!(matches!(drained, Some(Ok(ref name)) if name == "capture-1700000000123.png"));
        assert!(shared.outcome.is_none());
        // A second drain yields nothing.
        assert!(drain_portal_outcome(&mut shared).is_none());
    }

    #[test]
    fn finish_with_error_records_reason() {
        let mut shared = PortalShared {
            available: true,
            status: String::new(),
            busy: true,
            outcome: None,
        };
        finish_portal_capture(
            &mut shared,
            Err("screenshot cancelled in the portal dialog".to_string()),
        );
        assert!(!shared.busy);
        assert_eq!(
            shared.status,
            "portal: screenshot cancelled in the portal dialog"
        );
        assert!(matches!(drain_portal_outcome(&mut shared), Some(Err(_))));
    }

    /// Live probe of the portal on this machine. Ignored by default — the
    /// smoke suite and `cargo test` must never call dbus. Run once, by hand:
    /// `cargo test -p airi-qt live_portal_probe -- --ignored --nocapture`.
    /// Never calls `Screenshot`; read-only probe only.
    #[test]
    #[ignore]
    fn live_portal_probe_prints_result() {
        let (available, status) = probe_portal();
        eprintln!("portal probe: available={available} status={status}");
    }
}
