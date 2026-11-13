// SPDX-License-Identifier: GPL-3.0-or-later
//! Hearing (microphone) settings bridge (`HearingControllerState`).
//!
//! Backs the "Hearing" settings page. Persists **user intent only** under a
//! single blob key, `settings/hearing`, through the same `SettingsStore`
//! pattern as `settings_stage.rs` / `theme.rs` (synchronous SQLite; missing
//! or corrupt blobs fall back to defaults; a failed load is never silently
//! overwritten — persistence is skipped and reported instead).
//!
//! What is persisted (`settings/hearing`, camelCase fields):
//!
//! - `enabled` — whether the hearing module should be active. Default `false`
//!   (matches the Electron `settings/audio/input/enabled` default).
//! - `pttMode` — `true` = push-to-talk (hold-to-talk), `false` = automatic /
//!   VAD-segmented listening. Default `false` (matches the Electron
//!   `settings/hearing/detection-mode` default of `'vad'`).
//! - `hotkey` — the global push-to-talk hotkey, a free-form string kept
//!   verbatim. Default `"Scroll"`, the documented default of the Electron
//!   page (`MicToggleHotkey`: `Scroll` / `Caps` / `Num`). "Global hotkey
//!   registration" is NOT wired in this build — the string is stored for
//!   the future platform hotkey service and has no effect today. The
//!   `airi-stt` capture/VAD path (whisper) is likewise intent-only here:
//!   nothing pumps audio into the pipeline yet.
//! - `deviceName` — the selected input device, kept verbatim. Empty string
//!   means "system default / none selected". Default `""`.
//!
//! What is deliberately NOT here (see `docs/phase-notes/p11-lane-hearing.md`):
//!
//! - No microphone capture, no VAD loop, no level meter. `airi-stt` ships
//!   `capture.rs` / `mic.rs` / `vad.rs`, but nothing pumps audio into the
//!   chat pipeline yet.
//! - No device enumeration. `airi-stt` exposes **no public** device list;
//!   `capture::candidate_devices` is private, and `AudioCapture::start`
//!   *opens the microphone*, which a settings page must never do. The
//!   `devices_json` property is therefore always `"[]"` today and the page
//!   renders an honest empty state. When `airi-stt` grows a public
//!   `list_input_devices()`, only [`enumerate_devices_json`] changes.
//! - No global hotkey registration (needs a platform service).
//!
//! No secrets are involved: device names are local metadata. `devices_json`
//! is a JSON array of device name strings.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Storage key for the hearing settings blob.
const HEARING_KEY: &str = "settings/hearing";
/// Default push-to-talk hotkey; matches the Electron page's documented
/// default (`MicToggleHotkey = 'Scroll'`).
const DEFAULT_HOTKEY: &str = "Scroll";
/// Maximum accepted hotkey length (chars). Anything longer is rejected.
const HOTKEY_MAX_LEN: usize = 64;
/// Maximum accepted device name length (chars).
const DEVICE_NAME_MAX_LEN: usize = 256;

/// The `settings/hearing` blob. Field names serialize camelCase to stay
/// recognizable next to the Electron keys. Unknown fields are ignored on
/// load (serde default), missing fields fall back to the defaults below.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct HearingSettingsBlob {
    /// Whether the hearing module should be active.
    enabled: bool,
    /// `true` = push-to-talk, `false` = automatic / VAD-segmented.
    ptt_mode: bool,
    /// Free-form hotkey string; see [`DEFAULT_HOTKEY`].
    hotkey: String,
    /// Selected input device; `""` = system default / none.
    device_name: String,
}

impl Default for HearingSettingsBlob {
    fn default() -> Self {
        Self {
            enabled: false,
            ptt_mode: false,
            hotkey: DEFAULT_HOTKEY.to_string(),
            device_name: String::new(),
        }
    }
}

/// Hearing settings mirror. `refresh()` re-reads `settings/hearing`; the
/// `apply_*` methods update the mirror and persist immediately.
pub struct HearingControllerState {
    pub enabled: bool,
    pub ptt_mode: bool,
    pub hotkey: String,
    pub device_name: String,
    pub devices_json: String,
    pub status_line: String,
}

impl Default for HearingControllerState {
    fn default() -> Self {
        let (blob, status) = match load_blob() {
            BlobLoad::Loaded(blob) => (blob, base_status_line()),
            BlobLoad::Missing => (HearingSettingsBlob::default(), base_status_line()),
            BlobLoad::Corrupt(e) => (
                HearingSettingsBlob::default(),
                format!("{HEARING_KEY} unreadable, showing defaults (left untouched): {e}"),
            ),
        };
        Self {
            enabled: blob.enabled,
            ptt_mode: blob.ptt_mode,
            hotkey: blob.hotkey,
            device_name: blob.device_name,
            devices_json: enumerate_devices_json(),
            status_line: status,
        }
    }
}

static STATE: Mutex<HearingControllerState> = Mutex::new(HearingControllerState {
    enabled: false,
    ptt_mode: false,
    hotkey: String::new(),
    device_name: String::new(),
    devices_json: String::new(),
    status_line: String::new(),
});

/// Lock the process-wide hearing settings state.
pub fn with_state<R>(f: impl FnOnce(&mut HearingControllerState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

impl HearingControllerState {
    /// Persist `enabled` and mirror it. See module docs for caveats.
    pub fn apply_enabled(&mut self, enabled: bool) -> bool {
        self.enabled = enabled;
        self.persist_with_status()
    }

    /// Persist the listening mode and mirror it.
    pub fn apply_ptt_mode(&mut self, ptt_mode: bool) -> bool {
        self.ptt_mode = ptt_mode;
        self.persist_with_status()
    }

    /// Validate and persist the hotkey string.
    pub fn apply_hotkey(&mut self, hotkey: &str) -> bool {
        let trimmed = hotkey.trim().to_string();
        if let Err(reason) = validate_hotkey(&trimmed) {
            eprintln!("[airi-slint] hearing: rejected hotkey: {reason}");
            self.status_line = reason.to_string();
            return false;
        }
        self.hotkey = trimmed;
        self.persist_with_status()
    }

    /// Validate and persist the input device selection.
    pub fn apply_device(&mut self, name: &str) -> bool {
        let trimmed = name.trim();
        if let Err(reason) = validate_device_name(trimmed) {
            eprintln!("[airi-slint] hearing: rejected device name: {reason}");
            self.status_line = reason.to_string();
            return false;
        }
        self.device_name = trimmed.to_string();
        self.persist_with_status()
    }

    /// Re-read the blob into the mirror and recompute `devices_json`.
    /// A corrupt blob is left untouched (mirror keeps its current values).
    pub fn refresh(&mut self) {
        match load_blob() {
            BlobLoad::Loaded(blob) => {
                self.enabled = blob.enabled;
                self.ptt_mode = blob.ptt_mode;
                self.hotkey = blob.hotkey;
                self.device_name = blob.device_name;
                self.status_line = base_status_line();
            }
            BlobLoad::Missing => {
                let defaults = HearingSettingsBlob::default();
                self.enabled = defaults.enabled;
                self.ptt_mode = defaults.ptt_mode;
                self.hotkey = defaults.hotkey;
                self.device_name = defaults.device_name;
                self.status_line = base_status_line();
            }
            BlobLoad::Corrupt(e) => {
                eprintln!("[airi-slint] hearing: refusing to overwrite {HEARING_KEY}: {e}");
                self.status_line = format!("{HEARING_KEY} unreadable, showing current values: {e}");
            }
        }
        self.devices_json = enumerate_devices_json();
    }

    /// Persist the current mirror (idempotent) and update the status line.
    pub fn save(&mut self) -> bool {
        self.persist_with_status()
    }

    /// Check whether persisting is safe. A blob that exists but fails to
    /// parse is left untouched (mirror keeps its current values).
    fn persist_with_status(&mut self) -> bool {
        if let BlobLoad::Corrupt(e) = load_blob() {
            eprintln!("[airi-slint] hearing: refusing to overwrite {HEARING_KEY}: {e}");
            self.status_line = format!("save skipped: {HEARING_KEY} unreadable ({e})");
            return false;
        }
        let blob = self.snapshot();
        let result = save_blob(&blob);
        self.status_line = match &result {
            Ok(()) => format!("{} - saved", base_status_line()),
            Err(e) => {
                eprintln!("[airi-slint] hearing: failed to persist {HEARING_KEY}: {e}");
                format!("save failed: {e}")
            }
        };
        result.is_ok()
    }

    /// Copy the mirror into a blob value.
    fn snapshot(&self) -> HearingSettingsBlob {
        HearingSettingsBlob {
            enabled: self.enabled,
            ptt_mode: self.ptt_mode,
            hotkey: self.hotkey.clone(),
            device_name: self.device_name.clone(),
        }
    }
}

fn validate_hotkey(value: &str) -> Result<(), &'static str> {
    if value.is_empty() {
        return Err("hotkey must not be empty");
    }
    if value.chars().count() > HOTKEY_MAX_LEN {
        return Err("hotkey is too long (max 64 characters)");
    }
    if value.chars().any(char::is_control) {
        return Err("hotkey must not contain control characters");
    }
    Ok(())
}

fn validate_device_name(value: &str) -> Result<(), &'static str> {
    // "" is the explicit "system default / cleared" sentinel.
    if value.chars().count() > DEVICE_NAME_MAX_LEN {
        return Err("device name is too long (max 256 characters)");
    }
    if value.chars().any(char::is_control) {
        return Err("device name must not contain control characters");
    }
    Ok(())
}

/// Honest base status line: intent persists, capture does not run.
/// The sample rate is spelled out as a literal on purpose and must stay
/// 16000 (airi-stt's `DEFAULT_SAMPLE_RATE`): linking `airi-stt` from this
/// bridge would pull whisper-rs/ggml symbols into the airi-slint link, which
/// collides with llama-cpp-sys-2's vendored ggml (verified: duplicate-symbol
/// link failure for both the test and the app binary). Until airi-stt grows
/// a `CaptureConfig` usage-free seam, the number is kept in sync manually.
const CAPTURE_TARGET_RATE_HZ: u32 = 16_000;

fn base_status_line() -> String {
    format!(
        "persists locally; capture not wired in this build (target: {CAPTURE_TARGET_RATE_HZ} Hz mono)"
    )
}

/// Input devices visible to this build, as a JSON array of names.
///
/// **Today this is always `"[]"`.** `airi-stt` ships device enumeration only
/// as a private helper inside `capture.rs` (`candidate_devices`); there is no
/// public `list_input_devices()`, and the only public path that touches
/// devices, `AudioCapture::start`, *opens the microphone* — unacceptable for
/// a settings page refresh. Wiring a real enumeration means adding a public
/// read-only enumerator to `airi-stt` first; this function is the single
/// place that changes then.
fn enumerate_devices_json() -> String {
    "[]".to_string()
}

/// Outcome of reading `settings/hearing`. `Corrupt` carries the error text
/// for the status line; `Loaded`/`Missing` map to normal operation.
enum BlobLoad {
    /// A blob was read and parsed successfully.
    Loaded(HearingSettingsBlob),
    /// No row exists (fresh install or settings store not registered —
    /// persistence is attempted anyway and will fail with a message).
    Missing,
    /// A row exists but could not be read/parsed; never overwrite it.
    Corrupt(String),
}

fn load_blob() -> BlobLoad {
    let Some(store) = crate::bridges::settings_store() else {
        return BlobLoad::Missing;
    };
    match store.load_opt::<HearingSettingsBlob>(HEARING_KEY) {
        Ok(Some(blob)) => BlobLoad::Loaded(blob),
        Ok(None) => BlobLoad::Missing,
        Err(e) => BlobLoad::Corrupt(e.to_string()),
    }
}

fn save_blob(blob: &HearingSettingsBlob) -> anyhow::Result<()> {
    let Some(store) = crate::bridges::settings_store() else {
        anyhow::bail!("settings store not registered");
    };
    store.save(HEARING_KEY, blob)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_hotkey_and_device_name() {
        assert!(validate_hotkey("Scroll").is_ok());
        assert_eq!(validate_hotkey(""), Err("hotkey must not be empty"));
        assert!(validate_hotkey(&"x".repeat(HOTKEY_MAX_LEN + 1)).is_err());
        assert!(validate_hotkey("a\u{7f}b").is_err());

        // "" is the explicit "system default / cleared" sentinel.
        assert!(validate_device_name("").is_ok());
        assert!(validate_device_name(&"d".repeat(DEVICE_NAME_MAX_LEN + 1)).is_err());
        assert!(validate_device_name("mic\u{1}").is_err());
    }

    /// Without a registered store persistence reports failure instead of
    /// pretending the intent was saved.
    #[test]
    fn save_without_store_reports_failure() {
        let mut state = HearingControllerState::default();
        assert!(!state.save());
        assert_eq!(
            state.status_line,
            "save failed: settings store not registered"
        );
    }
}
