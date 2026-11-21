// SPDX-License-Identifier: GPL-3.0-or-later
//! Desktop integration bridge (`DesktopState`): system tray, global hotkeys,
//! autostart and desktop notifications.
//!
//! # Threading / marshalling model
//!
//! Tray menu items fire on the D-Bus worker thread owned by `tray-item`
//! (ksni), and global hotkeys fire on the backend thread owned by
//! `global-hotkey` (X11 via `x11rb`). Only the UI thread may touch the state,
//! so worker threads never call into Slint or the state directly. Instead they
//! publish into the shared statics below; the UI side drains them from a
//! 33 ms `Timer` (the same pump pattern the providers bridge uses) and
//! dispatches the action codes to the window shell — the same handlers the
//! Control Strip uses:
//!
//! ```text
//! tray menu click ─▶ publish_desktop_action("toggle-chat")
//! hotkey pressed  ─▶ MIC_TOGGLE.store(true)
//! UI Timer (33 ms) ─▶ DesktopState::poll_desktop_action()
//!                  ─▶ DesktopState::consume_mic_toggle()
//! ```
//!
//! `toggle_chat()`/`toggle_stage()`/`reset_positions()`/`open_settings()`/
//! `open_about()`/`quit()` are the UI-facing shims that enqueue the same
//! action codes, so UI callers and tray callbacks take one identical path.
//! The actual window operations happen in the shell layer.
//!
//! # Degraded modes
//!
//! - `--smoke`: tray creation and hotkey registration are skipped entirely
//!   and [`DesktopState::notify`]/[`DesktopState::set_autostart`] refuse to
//!   act, so a smoke run never touches the session bus, the autostart
//!   directory or the tray.
//! - Linux sessions without a `org.kde.StatusNotifierWatcher` (or
//!   `org.freedesktop.StatusNotifierWatcher`) on the session bus get no tray
//!   icon; the app runs normally otherwise. Tray failure never aborts startup.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

/// Action code: toggle the Chat window.
pub const ACTION_TOGGLE_CHAT: &str = "toggle-chat";
/// Action code: toggle the Stage window.
pub const ACTION_TOGGLE_STAGE: &str = "toggle-stage";
/// Action code: toggle the awareness daemon (pause/resume all observers).
pub const ACTION_TOGGLE_AWARENESS: &str = "toggle-awareness";
/// Action code: reset all windows to their default on-screen positions.
pub const ACTION_RESET_POSITIONS: &str = "reset-positions";
/// Action code: open (or raise) the Settings window.
pub const ACTION_OPEN_SETTINGS: &str = "open-settings";
/// Action code: open (or raise) the About window.
pub const ACTION_OPEN_ABOUT: &str = "open-about";
/// Action code: quit the application.
pub const ACTION_QUIT: &str = "quit";

/// Pending desktop actions, pushed by worker threads, drained by the UI.
static DESKTOP_ACTIONS: Mutex<VecDeque<&'static str>> = Mutex::new(VecDeque::new());
/// Set by the mic-toggle hotkey handler; consumed by the UI via
/// `consumeMicToggle()`.
static MIC_TOGGLE: AtomicBool = AtomicBool::new(false);
/// Keeps the hotkey manager (and its backend thread) alive for the process.
static HOTKEY_MANAGER: OnceLock<global_hotkey::GlobalHotKeyManager> = OnceLock::new();
/// Keeps the tray icon alive for the process lifetime.
#[cfg(not(target_os = "windows"))]
static TRAY: OnceLock<tray_item::TrayItem> = OnceLock::new();

/// Push a desktop action onto the queue. Safe to call from any thread.
pub fn publish_desktop_action(code: &'static str) {
    if let Ok(mut actions) = DESKTOP_ACTIONS.lock() {
        actions.push_back(code);
    }
}

/// Pop the next pending desktop action code, or `""` when the queue is empty.
fn pop_desktop_action() -> &'static str {
    DESKTOP_ACTIONS
        .lock()
        .ok()
        .and_then(|mut actions| actions.pop_front())
        .unwrap_or("")
}

/// Flag the mic toggle as requested. Safe to call from any thread.
pub fn publish_mic_toggle() {
    MIC_TOGGLE.store(true, Ordering::SeqCst);
}

/// Desktop integration state (tray/hotkey/launch/notification pump).
///
/// Stateless from the UI's perspective — every value lives in a process-wide
/// static, so the methods only touch that statics and the OS-level helpers.
#[derive(Default)]
pub struct DesktopState;

static STATE: Mutex<DesktopState> = Mutex::new(DesktopState);

/// Lock the process-wide desktop state.
pub fn with_state<R>(f: impl FnOnce(&mut DesktopState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

/// Initialize the desktop integration (tray + global hotkeys). Called once
/// from `main` before the event loop spins. Skipped under `--smoke`.
pub fn init() {
    if crate::bridges::smoke() {
        eprintln!("[airi-slint] smoke: tray and global hotkeys skipped");
        return;
    }
    init_tray();
    init_hotkeys();
}

/// `true` when a StatusNotifierWatcher is registered on the session bus.
/// Cheap synchronous D-Bus call; returns `false` on any failure so callers
/// can degrade gracefully.
fn status_notifier_watcher_available() -> bool {
    use dbus::blocking::Connection;
    use std::time::Duration;
    let Ok(conn) = Connection::new_session() else {
        eprintln!("[airi-slint] tray: cannot connect to the session bus; no tray icon");
        return false;
    };
    let proxy = conn.with_proxy(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        Duration::from_millis(800),
    );
    for name in [
        "org.kde.StatusNotifierWatcher",
        "org.freedesktop.StatusNotifierWatcher",
    ] {
        let owned: Result<(bool,), _> =
            proxy.method_call("org.freedesktop.DBus", "NameHasOwner", (name,));
        if matches!(owned, Ok((true,))) {
            return true;
        }
    }
    eprintln!(
        "[airi-slint] tray: no org.kde.StatusNotifierWatcher / org.freedesktop.StatusNotifierWatcher on the session bus; no tray icon"
    );
    false
}

/// Embedded tray icon (copy of `apps/stage-tamagotchi/resources/icon.png`).
const TRAY_ICON_PNG: &[u8] = include_bytes!("../../../../assets/icon.png");

/// Decode the embedded PNG into a 32x32 ARGB32 (network byte order) pixmap.
#[cfg(not(target_os = "windows"))]
fn tray_icon_source() -> tray_item::IconSource {
    let decoded = image::load_from_memory_with_format(TRAY_ICON_PNG, image::ImageFormat::Png);
    match decoded {
        Ok(img) => {
            let rgba = img
                .resize_exact(32, 32, image::imageops::FilterType::Lanczos3)
                .to_rgba8();
            let mut data = Vec::with_capacity(32 * 32 * 4);
            for px in rgba.pixels() {
                // ksni wants ARGB32 in network byte order: A, R, G, B per pixel.
                data.extend_from_slice(&[px[3], px[0], px[1], px[2]]);
            }
            tray_item::IconSource::Data {
                width: 32,
                height: 32,
                data,
            }
        }
        Err(e) => {
            eprintln!("[airi-slint] tray: embedded icon decode failed ({e}); using theme icon");
            tray_item::IconSource::Resource("airi-slint")
        }
    }
}

/// Add a separator where the platform tray backend supports it
/// (no-op on macOS, which lacks `add_separator`).
#[cfg(not(target_os = "macos"))]
fn add_separator(tray: &mut tray_item::TrayItem) {
    let _ = tray.inner_mut().add_separator();
}

/// No-op on macOS (tray-item's macOS backend has no separator support).
#[cfg(target_os = "macos")]
fn add_separator(_tray: &mut tray_item::TrayItem) {}

fn init_tray() {
    if !status_notifier_watcher_available() {
        return;
    }
    #[cfg(not(target_os = "windows"))]
    let icon = tray_icon_source();
    #[cfg(target_os = "windows")]
    let icon = tray_item::IconSource::Resource("airi-slint");

    // ksni spawns its own D-Bus thread; menu callbacks fire there and only
    // publish action codes (see module docs). Menu labels and order mirror
    // the Electron tray (apps/stage-tamagotchi/src/main/tray/index.ts),
    // minus the Control Strip / Companion Wizard / AnimaDex Wizard /
    // Developer Tools entries, which have no Slint counterpart yet.
    let mut tray = match tray_item::TrayItem::new("Project AIRI", icon) {
        Ok(tray) => tray,
        Err(e) => {
            eprintln!(
                "[airi-slint] tray: failed to create tray icon: {e}; continuing without tray"
            );
            return;
        }
    };
    let result = (|| -> Result<(), tray_item::TIError> {
        tray.add_menu_item("Toggle Chat", || publish_desktop_action(ACTION_TOGGLE_CHAT))?;
        tray.add_menu_item("Toggle Stage", || {
            publish_desktop_action(ACTION_TOGGLE_STAGE)
        })?;
        tray.add_menu_item("Awareness: Toggle", || {
            publish_desktop_action(ACTION_TOGGLE_AWARENESS)
        })?;
        tray.add_menu_item("Reset Positions", || {
            publish_desktop_action(ACTION_RESET_POSITIONS)
        })?;
        add_separator(&mut tray);
        tray.add_menu_item("Settings", || publish_desktop_action(ACTION_OPEN_SETTINGS))?;
        tray.add_menu_item("About", || publish_desktop_action(ACTION_OPEN_ABOUT))?;
        add_separator(&mut tray);
        tray.add_menu_item("Quit", || publish_desktop_action(ACTION_QUIT))?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            eprintln!("[airi-slint] tray: icon registered (Toggle Chat | Toggle Stage | Awareness: Toggle | Reset Positions | Settings | About | Quit)");
            #[cfg(not(target_os = "windows"))]
            let _ = TRAY.set(tray);
            #[cfg(target_os = "windows")]
            std::mem::forget(tray); // Windows impl is not Sync; keep alive for the process.
        }
        Err(e) => {
            eprintln!("[airi-slint] tray: failed to build menu: {e}; continuing without tray");
        }
    }
}

/// The Electron default mic-toggle hotkey (`configs/global.ts`:
/// `microphoneToggleHotkey`, default `'Scroll'` → `globalShortcut`
/// `ScrollLock`). Lock-key polling variants are Windows/macOS-only work and
/// are intentionally not ported here.
fn init_hotkeys() {
    use global_hotkey::hotkey::{Code, HotKey};
    use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};

    // On Wayland, global grabs only reach XWayland clients (same limitation
    // as Electron's globalShortcut on Linux); on a pure Wayland session this
    // registration is best-effort and may never deliver events.
    let manager = match GlobalHotKeyManager::new() {
        Ok(manager) => manager,
        Err(e) => {
            eprintln!("[airi-slint] hotkey: failed to initialize global hotkey manager: {e}; mic toggle hotkey disabled");
            return;
        }
    };
    let mic_toggle = HotKey::new(None, Code::ScrollLock);
    let mic_id = mic_toggle.id();
    if let Err(e) = manager.register(mic_toggle) {
        eprintln!("[airi-slint] hotkey: failed to register ScrollLock (mic toggle): {e}");
    } else {
        eprintln!("[airi-slint] hotkey: mic toggle registered as ScrollLock (best effort on Wayland: grabs apply to XWayland only)");
    }
    std::thread::spawn(move || {
        let receiver = GlobalHotKeyEvent::receiver().clone();
        for event in receiver.iter() {
            if event.id() == mic_id && matches!(event.state(), HotKeyState::Pressed) {
                eprintln!("[airi-slint] hotkey: mic toggle pressed");
                publish_mic_toggle();
            }
        }
    });
    let _ = HOTKEY_MANAGER.set(manager);
}

/// Build the autostart handle for the current platform. `app_path` is the
/// running executable; `app_name` is `airi-slint` (the XDG autostart entry is
/// `airi-slint.desktop` in `~/.config/autostart`).
#[cfg(target_os = "linux")]
fn auto_launch() -> Option<auto_launch::AutoLaunch> {
    let exe = std::env::current_exe().ok()?;
    // auto-launch requires an absolute path; current_exe is absolute.
    Some(auto_launch::AutoLaunch::new(
        "airi-slint",
        exe.to_string_lossy().as_ref(),
        auto_launch::LinuxLaunchMode::XdgAutostart,
        &[] as &[&str],
    ))
}

/// Build the autostart handle for macOS (LaunchAgent in `~/Library/LaunchAgents`).
#[cfg(target_os = "macos")]
fn auto_launch() -> Option<auto_launch::AutoLaunch> {
    let exe = std::env::current_exe().ok()?;
    Some(auto_launch::AutoLaunch::new(
        "airi-slint",
        exe.to_string_lossy().as_ref(),
        auto_launch::MacOSLaunchMode::LaunchAgent,
        &[] as &[&str],
        &[] as &[&str],
        "",
    ))
}

/// Build the autostart handle for Windows (registry Run key, current user).
#[cfg(target_os = "windows")]
fn auto_launch() -> Option<auto_launch::AutoLaunch> {
    let exe = std::env::current_exe().ok()?;
    Some(auto_launch::AutoLaunch::new(
        "airi-slint",
        exe.to_string_lossy().as_ref(),
        auto_launch::WindowsEnableMode::CurrentUser,
        &[] as &[&str],
    ))
}

/// Show a desktop notification; returns `false` in smoke mode (never fires),
/// when no notification daemon is reachable, or on any other failure.
fn show_notification(title: &str, body: &str) -> bool {
    if crate::bridges::smoke() {
        eprintln!("[airi-slint] smoke: notification suppressed ({title:?})");
        return false;
    }
    match notify_rust::Notification::new()
        .appname("AIRI")
        .summary(title)
        .body(body)
        .show()
    {
        Ok(_) => true,
        Err(e) => {
            eprintln!("[airi-slint] notify: failed to show notification: {e}");
            false
        }
    }
}

impl DesktopState {
    /// Enqueue "toggle-chat".
    pub fn toggle_chat(&self) {
        publish_desktop_action(ACTION_TOGGLE_CHAT);
    }

    /// Enqueue "toggle-stage".
    pub fn toggle_stage(&self) {
        publish_desktop_action(ACTION_TOGGLE_STAGE);
    }

    /// Enqueue "reset-positions".
    pub fn reset_positions(&self) {
        publish_desktop_action(ACTION_RESET_POSITIONS);
    }

    /// Enqueue "open-settings".
    pub fn open_settings(&self) {
        publish_desktop_action(ACTION_OPEN_SETTINGS);
    }

    /// Enqueue "open-about".
    pub fn open_about(&self) {
        publish_desktop_action(ACTION_OPEN_ABOUT);
    }

    /// Enqueue "quit".
    pub fn quit(&self) {
        publish_desktop_action(ACTION_QUIT);
    }

    /// Pop the next pending action code (`""` when none).
    pub fn poll_desktop_action(&self) -> String {
        pop_desktop_action().to_string()
    }

    /// Read-and-clear the mic-toggle flag.
    pub fn consume_mic_toggle(&self) -> bool {
        MIC_TOGGLE.swap(false, Ordering::SeqCst)
    }

    /// Enable/disable launching at OS login.
    pub fn set_autostart(&self, enabled: bool) -> bool {
        if crate::bridges::smoke() {
            eprintln!("[airi-slint] smoke: autostart change suppressed (enabled={enabled})");
            return false;
        }
        let Some(launcher) = auto_launch() else {
            eprintln!("[airi-slint] autostart: cannot resolve the current executable");
            return false;
        };
        let result = if enabled {
            launcher.enable()
        } else {
            launcher.disable()
        };
        match result {
            Ok(()) => {
                eprintln!("[airi-slint] autostart: enabled={enabled} (airi-slint)");
                true
            }
            Err(e) => {
                eprintln!("[airi-slint] autostart: failed to set enabled={enabled}: {e}");
                false
            }
        }
    }

    /// Whether the OS-level login entry currently exists.
    pub fn autostart_enabled(&self) -> bool {
        auto_launch()
            .and_then(|launcher| launcher.is_enabled().ok())
            .unwrap_or(false)
    }

    /// Show a desktop notification.
    pub fn notify(&self, title: &str, body: &str) -> bool {
        show_notification(title, body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_queue_roundtrip_is_fifo_and_drains_to_empty() {
        // Drain first so other tests/threads in this process cannot
        // interfere, then publish in order and verify FIFO delivery.
        while !pop_desktop_action().is_empty() {}
        publish_desktop_action(ACTION_TOGGLE_CHAT);
        publish_desktop_action(ACTION_QUIT);
        let state = DesktopState;
        assert_eq!(state.poll_desktop_action(), ACTION_TOGGLE_CHAT);
        assert_eq!(state.poll_desktop_action(), ACTION_QUIT);
        assert_eq!(state.poll_desktop_action(), "");
    }

    #[test]
    fn mic_toggle_flag_sets_and_clears() {
        MIC_TOGGLE.store(false, Ordering::SeqCst);
        let state = DesktopState;
        assert!(!state.consume_mic_toggle());
        publish_mic_toggle();
        assert!(state.consume_mic_toggle());
        assert!(!state.consume_mic_toggle());
    }

    #[test]
    fn state_methods_enqueue_their_action_codes() {
        while !pop_desktop_action().is_empty() {}
        let state = DesktopState;
        state.toggle_stage();
        state.reset_positions();
        state.open_settings();
        state.open_about();
        assert_eq!(pop_desktop_action(), ACTION_TOGGLE_STAGE);
        assert_eq!(pop_desktop_action(), ACTION_RESET_POSITIONS);
        assert_eq!(pop_desktop_action(), ACTION_OPEN_SETTINGS);
        assert_eq!(pop_desktop_action(), ACTION_OPEN_ABOUT);
        assert_eq!(pop_desktop_action(), "");
    }

    #[test]
    fn desktop_state_is_a_zero_sized_stateless_handle() {
        // All desktop state lives in module statics; the handle is a ZST the
        // UI locks through `with_state`. The `--smoke` refusals themselves are
        // a single `crate::bridges::smoke()` branch in `set_autostart` /
        // `notify` — not exercised here because that flag is process-wide and
        // flipping it would race the other tests in this binary.
        let state = DesktopState;
        let _ = state.autostart_enabled();
        assert_eq!(std::mem::size_of_val(&state), 0);
    }
}
