// SPDX-License-Identifier: GPL-3.0-or-later
//! Screen capture bridge (`CaptureState`) exposed to Slint.
//!
//! First slice of "vision": grab the primary screen to a PNG under the
//! captures directory and list the saved captures back. The actual grab
//! happens in the C++ shim (`src/cpp/capture_item.cpp`) — `QScreen::grabWindow(0)`
//! needs a live `QGuiApplication`, which Qt hands to the GUI thread; the
//! bridge is only invoked from QML, so this stays on the GUI thread too.
//!
//! Captures directory: `<profile>/captures/` when `--profile` is set, else
//! `<platform-data>/airi-slint/captures/` (same convention as the MCP config).
//!
//! Boundary contracts (same as the cards/MCP bridges):
//! - `captures_json` is a JSON array of `{path, fileName, bytes, createdMs}`,
//!   newest first. `createdMs` is the file *mtime* in milliseconds since the
//!   epoch (creation time is not portable across filesystems).
//! - `clear_captures` is destructive and deliberately narrow: it deletes only
//!   regular files directly inside the captures directory whose name matches
//!   `capture-<digits>.png` (exactly what the shim writes), never follows
//!   symlinks, and never touches anything else.
//! - The Wayland path: `capture_via_portal()` asks the XDG desktop portal for
//!   a full-screen screenshot (user-consent dialog, by design) and saves the
//!   result under the same captures directory with the same
//!   `capture-<digits>.png` convention. The call is always human-initiated
//!   and never happens in smoke mode.
//!
//! A finished capture is a *path*: the RGBA buffer stays with the compositor
//! and is written to disk by the shim / portal; nothing image-shaped crosses
//! the bridge.

use serde_json::json;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::bridges;

/// `<profile>/captures/` or `<platform-data>/airi-slint/captures/`.
fn captures_dir() -> Option<PathBuf> {
    bridges::profile_dir()
        .map(|p| p.join("captures"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint").join("captures")))
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

/// List the capture entries directly inside `dir`, newest first. A missing
/// directory is an empty list (nothing has been captured yet); an unreadable
/// entry or a non-UTF-8 file name is skipped, never fatal.
fn list_capture_entries(dir: &std::path::Path) -> Vec<serde_json::Value> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut items: Vec<(u64, serde_json::Value)> = entries
        .flatten()
        .filter_map(|entry| capture_entry(dir, &entry))
        .collect();
    items.sort_by(|a, b| {
        b.0.cmp(&a.0).then_with(|| {
            // Stable, deterministic order for identical mtimes.
            a.1["fileName"].as_str().cmp(&b.1["fileName"].as_str())
        })
    });
    items.into_iter().map(|(_, value)| value).collect()
}

/// One capture entry for the JSON list, or `None` when the entry must be
/// skipped (unreadable metadata, not a regular file, a file name that is not
/// valid UTF-8, or not a capture name).
fn capture_entry(
    dir: &std::path::Path,
    entry: &std::fs::DirEntry,
) -> Option<(u64, serde_json::Value)> {
    // `to_str` on a `read_dir` name is the only place a hostile entry name
    // could turn this scan into a panic — skip instead.
    let name = entry.file_name().into_string().ok()?;
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

/// Delete every `capture-<digits>.png` regular file directly inside `dir`,
/// returning the count and the first failure (a missing directory is neither:
/// nothing to delete). Files that do not match the pattern — and anything not a
/// direct regular child — are left untouched.
fn clear_capture_files(dir: &std::path::Path) -> (i32, Option<String>) {
    let mut deleted: i32 = 0;
    let mut failure: Option<String> = None;
    match std::fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                // NOTICE: `to_string_lossy` would fabricate a name for a
                // non-UTF-8 entry and let it match the pattern; such an entry is
                // not one of ours, so skip it like the listing does.
                let name = match entry.file_name().into_string() {
                    Ok(name) => name,
                    Err(_) => continue,
                };
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
    (deleted, failure)
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
/// Is `msg` the `org.freedesktop.portal.Request::Response` signal for *our*
/// request — same object path the `Screenshot` call returned? The rule already
/// pins the type, interface and member; everything else on this private
/// connection (method returns, unrelated signals) is dropped.
fn is_portal_response(
    msg: &dbus::Message,
    rule: &dbus::message::MatchRule<'_>,
    response_path: &dbus::strings::Path<'_>,
) -> bool {
    rule.matches(msg) && msg.path().as_deref() == Some(&**response_path)
}

/// One wait-loop iteration for the portal `Response`: block up to the `tick`
/// read, then pop every message the queue holds and push each one through
/// `deliver`, stopping at the first one it claims. Returns `true` when `deliver`
/// claimed a message. `pop` is the channel's `pop_message` at the call site.
///
/// NOTICE: `dbus::blocking::Connection::process` reads with
/// `dbus_connection_read_write` (fill the incoming queue, never dispatch) and
/// pops at most one message, so the `org.freedesktop.portal.Request::Response`
/// signal could sit in the queue until the deadline and every consent-accepted
/// capture timed out. `tick` only moves bytes off the socket; this pops and
/// routes every queued message itself, which is what the blocking API omits.
fn portal_response_tick(
    tick: impl FnOnce() -> Result<(), dbus::Error>,
    mut pop: impl FnMut() -> Option<dbus::Message>,
    mut deliver: impl FnMut(&dbus::Message) -> bool,
) -> Result<bool, String> {
    tick().map_err(|e| format!("portal bus error: {e}"))?;
    while let Some(msg) = pop() {
        if deliver(&msg) {
            return Ok(true);
        }
    }
    Ok(false)
}

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

/// Shared state between the UI thread and the portal worker thread. The
/// worker records the outcome; the next `refresh()` drains it into the
/// state fields.
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
///    docs recommend. The subscription itself has no path filter — this
///    connection is private to this capture — but the wait loop below only
///    claims the signal whose path is the one `Screenshot` returned.
/// 3. `Screenshot(parent_window: "", options: a{sv} {handle_token})`.
///    Empty `parent_window` is valid; the reply carries the request path `o`.
/// 4. Wait for `org.freedesktop.portal.Request::Response(response: u,
///    results: a{sv})` on *our* request path for up to 8 s, draining the
///    incoming queue by hand (`portal_response_tick`); timeout → best-effort
///    `Close` on the request path and an honest error.
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

    // Subscribe before the call so the Response can never slip past us. The
    // callback never fires on its own: `portal_response_tick` pops the queued
    // signal and routes it by hand, since the blocking `Connection` exposes no
    // dispatching read.
    let slot: Arc<Mutex<Option<(u32, PropMap)>>> = Arc::new(Mutex::new(None));
    let response_rule = MatchRule::new_signal(PORTAL_REQUEST_IFACE, "Response");
    let subscribe = conn.add_match_no_cb(&response_rule.match_str());
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
        // Odd but legitimate (old portals); the wait below claims the signal
        // for whatever path `Screenshot` actually returned.
        eprintln!(
            "[airi-slint][capture] portal returned handle {handle_path} (expected {expected_path})"
        );
    }

    // NOTICE: the blocking `Connection` has no dispatching read, so the wait
    // below reads bytes and routes each queued message by hand.
    let channel = conn.channel();
    let response_path = dbus::strings::Path::new(handle_path.as_str())
        .map_err(|e| format!("portal returned an invalid request path: {e}"))?;
    let slot_deliver = Arc::clone(&slot);
    let deliver = move |msg: &dbus::Message| {
        if !is_portal_response(msg, &response_rule, &response_path) {
            return false;
        }
        let mut args = msg.iter_init();
        if let (Ok(response), Ok(results)) = (args.read::<u32>(), args.read::<PropMap>()) {
            let mut guard = slot_deliver.lock().unwrap_or_else(|e| e.into_inner());
            if guard.is_none() {
                *guard = Some((response, results));
            }
            return true;
        }
        false
    };

    let deadline = std::time::Instant::now() + PORTAL_RESPONSE_DEADLINE;
    loop {
        if slot.lock().unwrap_or_else(|e| e.into_inner()).is_some() {
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
        // Queue bytes off the socket; the tick never outlives the deadline.
        if portal_response_tick(
            || {
                let left = deadline.saturating_duration_since(std::time::Instant::now());
                channel
                    .read_write(Some(left.min(Duration::from_millis(100))))
                    .map_err(|_| dbus::Error::new_failed("disconnected from D-Bus"))
            },
            || channel.pop_message(),
            |msg| deliver(msg),
        )? {
            break;
        }
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
    if let Err(e) = std::fs::read_dir(&dir) {
        return Err(format!("failed to read {}: {e}", dir.display()));
    }
    Ok(list_capture_entries(&dir))
}

// ---------------------------------------------------------------------------
// Capture state
// ---------------------------------------------------------------------------

/// Screen-capture view-model state (one process-wide instance).
pub struct CaptureState {
    /// JSON array of `{path, fileName, bytes, createdMs}`, newest first.
    pub captures_json: String,
    /// Last error line, `""` when clean.
    pub last_error: String,
    /// `true` while a capture is running.
    pub working: bool,
    /// `true` when the Screenshot portal answered the probe.
    pub portal_available: bool,
    /// Portal status one-liner (raw English).
    pub portal_status: String,
    /// `true` while a portal capture is in flight.
    pub portal_busy: bool,
}

impl Default for CaptureState {
    fn default() -> Self {
        // Probe at construction so the fields are honest before the page's
        // first refresh. The probe is read-only (NameHasOwner +
        // Properties.Get) and never calls `Screenshot`.
        let shared = lock_portal();
        Self {
            captures_json: "[]".to_string(),
            last_error: String::new(),
            working: false,
            portal_available: shared.available,
            portal_status: shared.status.clone(),
            portal_busy: shared.busy,
        }
    }
}

impl CaptureState {
    fn set_error(&mut self, message: String) {
        self.last_error = message;
    }

    fn clear_error(&mut self) {
        self.last_error = String::new();
    }

    fn refresh_impl(&mut self) {
        let (captures, error) = match scan_captures() {
            Ok(items) => (items, None),
            Err(e) => (Vec::new(), Some(e)),
        };
        // Merge any finished portal capture and re-probe the portal so the
        // fields stay honest on every refresh. captures_json keeps its
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
        self.captures_json =
            serde_json::to_string(&captures).unwrap_or_else(|_| "[]".to_string());
        if let Some(e) = error {
            self.set_error(e);
        } else if let Some(e) = portal_error {
            self.set_error(e);
        }
        self.sync_portal_properties(portal_available, portal_status, portal_busy);
    }

    /// Copy the portal fields into the state (the notify hop is the UI
    /// layer's; the former `portalChanged` signal).
    fn sync_portal_properties(&mut self, available: bool, status: String, busy: bool) {
        self.portal_available = available;
        self.portal_status = status;
        self.portal_busy = busy;
    }

    /// Grab the primary screen and save it under the captures directory.
    pub fn capture_now(&mut self) -> String {
        self.clear_error();
        if bridges::smoke() {
            // Same idiom as the desktop bridge's notification suppression:
            // never touch the real screen from a headless smoke run.
            self.set_error("screen capture is suppressed in smoke mode".to_string());
            return String::new();
        }
        let Some(dir) = captures_dir() else {
            self.set_error("could not resolve a captures directory".to_string());
            return String::new();
        };
        self.working = true;
        let dir_string = dir.to_string_lossy().into_owned();
        let result = airi_capture_primary_screen(&dir_string);
        self.working = false;
        if result.is_empty() {
            // The shim prints the specific reason to stderr; the bridge only
            // knows the grab failed. On Wayland that is expected — the
            // compositor denies QScreen::grabWindow.
            self.set_error(
                "screen capture failed — see the log for the reason (Wayland compositors may deny the grab)"
                    .to_string(),
            );
            return String::new();
        }
        self.clear_error();
        self.refresh_impl();
        result
    }

    /// Ask the XDG desktop portal for a full-screen screenshot (see the
    /// invokable docs). Returns `true` when the worker thread was spawned —
    /// the capture is async and the page is expected to poll
    /// `refresh_captures()` on a short timer until `portal_busy` clears.
    pub fn capture_via_portal(&mut self) -> bool {
        self.clear_error();
        if bridges::smoke() {
            // Same rail as the X11 path: never touch the real screen (and
            // never open a consent dialog) from a headless smoke run.
            self.set_error("portal screenshot is suppressed in smoke mode".to_string());
            {
                let mut shared = lock_portal();
                shared.status = "portal: suppressed in smoke mode".to_string();
            }
            self.sync_portal_properties_from_shared();
            return false;
        }
        let Some(dir) = captures_dir() else {
            self.set_error("could not resolve a captures directory".to_string());
            return false;
        };
        {
            let mut shared = lock_portal();
            if try_begin_capture(&mut shared).is_err() {
                let (available, status, busy) =
                    (shared.available, shared.status.clone(), shared.busy);
                drop(shared);
                // "statusLine says why" — the reason stays in portal_status;
                // last_error is reserved for real failures.
                self.sync_portal_properties(available, status, busy);
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
                // `refresh_captures()` call (the page polls on a timer).
                self.sync_portal_properties_from_shared();
                true
            }
            Err(e) => {
                let mut guard = lock_portal();
                finish_portal_capture(
                    &mut guard,
                    Err(format!("failed to spawn portal thread: {e}")),
                );
                drop(guard);
                self.sync_portal_properties_from_shared();
                false
            }
        }
    }

    /// Re-sync the portal fields from the shared state (used after
    /// status-only writes that did not go through a full refresh).
    fn sync_portal_properties_from_shared(&mut self) {
        let (available, status, busy) = {
            let shared = lock_portal();
            (shared.available, shared.status.clone(), shared.busy)
        };
        self.sync_portal_properties(available, status, busy);
    }

    /// Re-scan the captures directory.
    pub fn refresh_captures(&mut self) {
        self.clear_error();
        self.refresh_impl();
    }

    /// Delete every `capture-<digits>.png` regular file directly inside the
    /// captures directory. Returns the number of files deleted. Files that do
    /// not match the pattern — and anything not a direct regular child —
    /// are left untouched.
    pub fn clear_captures(&mut self) -> i32 {
        self.clear_error();
        let Some(dir) = captures_dir() else {
            self.set_error("could not resolve a captures directory".to_string());
            return 0;
        };
        let (deleted, failure) = clear_capture_files(&dir);
        self.refresh_impl();
        if let Some(failure) = failure {
            self.set_error(failure);
        }
        deleted
    }
}

/// Grab the primary screen and save it under `out_dir` as
/// `capture-<millis>.png`; returns the absolute path of the new PNG, or an
/// empty string on failure (reason on stderr).
///
/// `shortcut:` the X11 grab still lives in the Qt C++ shim
/// (`src/cpp/capture_item.cpp`), which cxx-qt linked into the old shell. The
/// Slint build has no shim, so this reports the failure honestly until the
/// capture lands in Rust (slint's `slint::platform` / `xcap`); the portal
/// path above is the working Wayland route.
fn airi_capture_primary_screen(_out_dir: &str) -> String {
    String::new()
}

/// Process-wide state guarded by a mutex (a poisoned lock is recovered so a
/// panicking worker must not wedge the UI).
static STATE: std::sync::Mutex<Option<CaptureState>> = std::sync::Mutex::new(None);

/// Lock the process-wide capture state for a UI-thread operation, creating it
/// on first use.
pub fn with_state<R>(f: impl FnOnce(&mut CaptureState) -> R) -> R {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let state = guard.get_or_insert_with(CaptureState::default);
    f(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use dbus::arg::{PropMap, RefArg, Variant};
    use std::collections::HashMap;

    /// A `read_dir` name that is not valid UTF-8 must be skipped, not panic:
    /// the shim only ever writes ASCII `capture-<digits>.png`, so any such
    /// entry is a foreign file (or a hostile one) and the scan moves on.
    #[test]
    fn capture_listing_skips_non_utf8_entry_names() {
        use std::ffi::OsStr;
        #[cfg(unix)]
        use std::os::unix::ffi::OsStrExt;

        let unique = format!(
            "airi-slint-capture-nonutf8-{}-{}",
            std::process::id(),
            system_time_millis(SystemTime::now())
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let first = dir.join("capture-1700000000001.png");
        let second = dir.join("capture-1700000000002.png");
        std::fs::write(&first, b"a").unwrap();
        std::fs::write(&second, b"bb").unwrap();
        // Force distinct mtimes: `createdMs` is millisecond-truncated, so two
        // back-to-back writes can tie and fall back to the name tiebreak,
        // which sorts ascending — the opposite of the newest-first order.
        set_mtime_ms(&first, 1_700_000_000_000);
        set_mtime_ms(&second, 1_700_000_000_001);
        #[cfg(unix)]
        {
            let bad = dir.join(OsStr::from_bytes(b"capture-\xFF\xFE.png"));
            std::fs::write(&bad, b"hostile").unwrap();
            assert!(bad.file_name().unwrap().to_str().is_none());
        }

        let listed = list_capture_entries(&dir);
        let names: Vec<&str> = listed
            .iter()
            .map(|item| item["fileName"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            ["capture-1700000000002.png", "capture-1700000000001.png"]
        );
        // The foreign entry survives the listing untouched: the scan only reads.
        let survivors: Vec<PathBuf> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .collect();
        assert_eq!(survivors.len(), 3);

        // clear_captures deletes exactly the two captures and leaves the rest.
        let (deleted, failure) = clear_capture_files(&dir);
        assert_eq!(deleted, 2);
        assert_eq!(failure, None);
        let survivors: Vec<PathBuf> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .collect();
        assert_eq!(survivors.len(), 1);
        #[cfg(unix)]
        assert_eq!(
            survivors[0].file_name().unwrap(),
            OsStr::from_bytes(b"capture-\xFF\xFE.png")
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Set `path`'s mtime to `ms` since the epoch. `File::set_modified` needs
    /// only std, unlike the `filetime` crate the workspace does not depend on.
    fn set_mtime_ms(path: &std::path::Path, ms: u64) {
        let file = std::fs::File::options().write(true).open(path).unwrap();
        file.set_modified(UNIX_EPOCH + Duration::from_millis(ms))
            .unwrap();
    }

    /// A `Response` signal on the handle path the portal handed back, wrapped in
    /// the `u32` + `a{sv}` body the roundtrip reads.
    fn portal_response_signal(path: &str) -> dbus::Message {
        let mut results: PropMap = HashMap::new();
        results.insert(
            "uri".to_string(),
            Variant(Box::new("file:///tmp/capture-1.png".to_string()) as Box<dyn RefArg>),
        );
        dbus::Message::new_signal(path, PORTAL_REQUEST_IFACE, "Response")
            .unwrap()
            .append2(0u32, results)
    }

    /// The exact `MatchRule` and path the roundtrip claims against.
    fn response_match() -> (
        dbus::message::MatchRule<'static>,
        dbus::strings::Path<'static>,
    ) {
        (
            dbus::message::MatchRule::new_signal(PORTAL_REQUEST_IFACE, "Response"),
            dbus::strings::Path::new("/org/freedesktop/portal/desktop/request/1_2/airi").unwrap(),
        )
    }

    #[test]
    fn response_predicate_accepts_only_our_response() {
        use dbus::arg::prop_cast;

        let (rule, path) = response_match();
        let ours = portal_response_signal(&path);
        assert!(is_portal_response(&ours, &rule, &path));
        // The body is the documented (response, results) pair.
        let mut args = ours.iter_init();
        let (response, results) = (args.read::<u32>().unwrap(), args.read::<PropMap>().unwrap());
        assert_eq!(response, 0);
        assert_eq!(
            prop_cast::<String>(&results, "uri").map(String::as_str),
            Some("file:///tmp/capture-1.png")
        );

        // A different request path on the same interface is not ours.
        let other_path = dbus::strings::Path::new(
            "/org/freedesktop/portal/desktop/request/9_9/some_other_token",
        )
        .unwrap();
        assert!(!is_portal_response(
            &portal_response_signal(&other_path),
            &rule,
            &path
        ));
        // The portal's method returns and unrelated signals are dropped too.
        let method_return = dbus::Message::new_method_call(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "NameHasOwner",
        )
        .unwrap();
        assert!(!is_portal_response(&method_return, &rule, &path));
        let name_acquired = dbus::Message::new_signal(
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "NameAcquired",
        )
        .unwrap();
        assert!(!is_portal_response(&name_acquired, &rule, &path));
    }

    #[test]
    fn response_tick_drains_queue_until_a_message_is_claimed() {
        use std::collections::VecDeque;

        let (rule, path) = response_match();
        // A FIFO queue models the connection's incoming queue: the foreign
        // signal is delivered first, then ours.
        let mut queue: VecDeque<_> = [
            portal_response_signal("/org/freedesktop/portal/desktop/request/x/y"),
            portal_response_signal(&path),
        ]
        .into();
        let mut delivered = Vec::new();

        let claimed = portal_response_tick(
            || Ok(()),
            || queue.pop_front(),
            |msg| {
                delivered.push(msg.path().unwrap().to_string());
                is_portal_response(msg, &rule, &path)
            },
        )
        .unwrap();

        assert!(claimed);
        // Draining stops at the claimed message: anything behind it stays queued.
        let foreign = "/org/freedesktop/portal/desktop/request/x/y".to_string();
        assert_eq!(delivered, [foreign, path.to_string()]);
        assert!(queue.is_empty());
    }

    #[test]
    fn response_tick_keeps_waiting_when_queue_holds_no_response() {
        use std::collections::VecDeque;

        let mut queue: VecDeque<_> = [portal_response_signal(
            "/org/freedesktop/portal/desktop/request/x/y",
        )]
        .into();
        let mut pops = 0;

        let claimed = portal_response_tick(
            || {
                pops += 1;
                Ok(())
            },
            || {
                queue.pop_front()
            },
            |_| false,
        )
        .unwrap();

        assert!(!claimed);
        assert_eq!(pops, 2); // one per queued message, plus the empty pop
    }

    #[test]
    fn response_tick_surfaces_bus_read_failure() {
        let error = portal_response_tick(
            || Err(dbus::Error::new_failed("disconnected from D-Bus")),
            || None,
            |_| true,
        );
        assert_eq!(
            error.unwrap_err(),
            "portal bus error: disconnected from D-Bus"
        );
    }

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
            "airi-slint-capture-test-{}-{}",
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
            "airi-slint-capture-test-{}-{}",
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
    /// `cargo test -p airi-slint live_portal_probe -- --ignored --nocapture`.
    /// Never calls `Screenshot`; read-only probe only.
    #[test]
    #[ignore]
    fn live_portal_probe_prints_result() {
        let (available, status) = probe_portal();
        eprintln!("portal probe: available={available} status={status}");
    }
}