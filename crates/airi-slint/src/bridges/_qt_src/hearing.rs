// SPDX-License-Identifier: GPL-3.0-or-later
//! Hearing (microphone) settings bridge (`HearingController`) exposed to QML.
//!
//! Backs the "Hearing" page (`qml/pages/settings/modules/hearing/
//! HearingSettingsPage.qml`). Persists **user intent only** under a single
//! blob key, `settings/hearing`, through the same `SettingsStore` pattern as
//! `settings_stage.rs` / `theme.rs` (synchronous SQLite; missing or corrupt
//! blobs fall back to defaults; a failed load is never silently overwritten —
//! persistence is skipped and reported instead).
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
//!   registration" is NOT wired in this Qt build — the string is stored for
//!   the future platform hotkey service and has no effect today.
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
//!   `devicesJson` qproperty is therefore always `"[]"` today and the page
//!   renders an honest empty state. When `airi-stt` grows a public
//!   `list_input_devices()`, only [`enumerate_devices_json`] changes.
//! - No global hotkey registration (needs a platform service).
//!
//! No secrets are involved: device names are local metadata. `devicesJson`
//! is a JSON array of device name strings.

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

use crate::bridges::qstring_to_string;

/// Storage key for the hearing settings blob.
const HEARING_KEY: &str = "settings/hearing";
/// Default push-to-talk hotkey; matches the Electron page's documented
/// default (`MicToggleHotkey = 'Scroll'`).
const DEFAULT_HOTKEY: &str = "Scroll";
/// Maximum accepted hotkey length (chars). Anything longer is rejected.
const HOTKEY_MAX_LEN: usize = 64;
/// Maximum accepted device name length (chars).
const DEVICE_NAME_MAX_LEN: usize = 256;

/// cxx-qt bridge definitions for the hearing settings bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Hearing settings mirror. `refresh()` re-reads `settings/hearing`;
        /// the `set*` invokables update the mirror and persist immediately.
        // qproperties paired with qinvokable writers are READ + NOTIFY only —
        // cxx-qt would otherwise auto-generate `void set<Property>()` setter
        // slots that collide (C++ cannot overload on return type) with the
        // spec'd `setEnabled`/`setPttMode`/`setHotkey`/`setDevice` qinvokables.
        // The `<prop>_changed` notify signals are generated (NOTIFY is Auto)
        // and emitted manually after each mirror mutation; `stateChanged`
        // fires as well. (Same pattern as bridges/memory.rs.)
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, enabled, READ, NOTIFY)]
        #[qproperty(bool, ptt_mode, cxx_name = "pttMode", READ, NOTIFY)]
        #[qproperty(QString, hotkey, READ, NOTIFY)]
        #[qproperty(QString, device_name, cxx_name = "deviceName", READ, NOTIFY)]
        #[qproperty(QString, devices_json, cxx_name = "devicesJson")]
        #[qproperty(QString, status_line, cxx_name = "statusLine")]
        type HearingController = super::HearingControllerRust;
    }

    extern "RustQt" {
        /// Emitted after any state change is copied into the qproperties
        /// (from `setEnabled`/`setPttMode`/`setHotkey`/`setDevice`/
        /// `refresh`/`save`).
        #[qsignal]
        #[cxx_name = "stateChanged"]
        fn state_changed(self: Pin<&mut HearingController>);

        /// Persist `enabled` (`settings/hearing.enabled`). Returns `true` on
        /// success. The flag only records intent; no capture is started.
        #[qinvokable]
        #[cxx_name = "setEnabled"]
        fn apply_enabled(self: Pin<&mut HearingController>, enabled: bool) -> bool;

        /// Persist the listening mode (`settings/hearing.pttMode`). `true` =
        /// push-to-talk, `false` = automatic (VAD-style) listening.
        /// Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "setPttMode"]
        fn apply_ptt_mode(self: Pin<&mut HearingController>, ptt_mode: bool) -> bool;

        /// Persist the push-to-talk hotkey string (`settings/hearing.hotkey`).
        /// The value is trimmed; empty strings, strings longer than 64 chars
        /// and strings containing control characters are rejected (the mirror
        /// is left unchanged and `false` is returned). Not registered with
        /// the OS — see module docs.
        #[qinvokable]
        #[cxx_name = "setHotkey"]
        fn apply_hotkey(self: Pin<&mut HearingController>, hotkey: QString) -> bool;

        /// Persist the input device name (`settings/hearing.deviceName`).
        /// `""` clears the selection (system default). Non-empty values are
        /// trimmed and kept verbatim; values longer than 256 chars or
        /// containing control characters are rejected. Returns `true` on
        /// success.
        #[qinvokable]
        #[cxx_name = "setDevice"]
        fn apply_device(self: Pin<&mut HearingController>, name: QString) -> bool;

        /// Re-read `settings/hearing` into the mirror and recompute
        /// `devicesJson`. Called by QML once after creation.
        #[qinvokable]
        fn refresh(self: Pin<&mut HearingController>);

        /// Persist the current mirror into `settings/hearing`. Idempotent —
        /// the `set*` invokables already persist, so this exists for
        /// callers that want an explicit save point. Returns `true` on
        /// success.
        #[qinvokable]
        fn save(self: Pin<&mut HearingController>) -> bool;
    }
}

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

/// Rust storage for `HearingController`.
pub struct HearingControllerRust {
    enabled: bool,
    ptt_mode: bool,
    hotkey: QString,
    device_name: QString,
    devices_json: QString,
    status_line: QString,
}

impl Default for HearingControllerRust {
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
            hotkey: QString::from(blob.hotkey.as_str()),
            device_name: QString::from(blob.device_name.as_str()),
            devices_json: QString::from(enumerate_devices_json().as_str()),
            status_line: QString::from(status.as_str()),
        }
    }
}

impl qobject::HearingController {
    /// Persist `enabled` and mirror it. See module docs for caveats.
    pub fn apply_enabled(mut self: Pin<&mut Self>, enabled: bool) -> bool {
        self.as_mut().rust_mut().enabled = enabled;
        self.as_mut().enabled_changed();
        self.persist_with_status()
    }

    /// Persist the listening mode and mirror it.
    pub fn apply_ptt_mode(mut self: Pin<&mut Self>, ptt_mode: bool) -> bool {
        self.as_mut().rust_mut().ptt_mode = ptt_mode;
        self.as_mut().ptt_mode_changed();
        self.persist_with_status()
    }

    /// Validate and persist the hotkey string.
    pub fn apply_hotkey(mut self: Pin<&mut Self>, hotkey: QString) -> bool {
        let trimmed = qstring_to_string(&hotkey).trim().to_string();
        if let Err(reason) = validate_hotkey(&trimmed) {
            eprintln!("[airi-slint] hearing: rejected hotkey: {reason}");
            self.as_mut().set_status_line(QString::from(reason));
            qobject::HearingController::state_changed(self.as_mut());
            return false;
        }
        self.as_mut().rust_mut().hotkey = QString::from(trimmed.as_str());
        self.as_mut().hotkey_changed();
        self.persist_with_status()
    }

    /// Validate and persist the input device selection.
    pub fn apply_device(mut self: Pin<&mut Self>, name: QString) -> bool {
        let trimmed = qstring_to_string(&name).trim().to_string();
        if let Err(reason) = validate_device_name(&trimmed) {
            eprintln!("[airi-slint] hearing: rejected device name: {reason}");
            self.as_mut().set_status_line(QString::from(reason));
            qobject::HearingController::state_changed(self.as_mut());
            return false;
        }
        self.as_mut().rust_mut().device_name = QString::from(trimmed.as_str());
        self.as_mut().device_name_changed();
        self.persist_with_status()
    }

    /// Re-read the blob into the mirror and recompute `devicesJson`.
    /// A corrupt blob is left untouched (mirror keeps its current values).
    pub fn refresh(mut self: Pin<&mut Self>) {
        match load_blob() {
            BlobLoad::Loaded(blob) => {
                {
                    let mut inner = self.as_mut().rust_mut();
                    inner.enabled = blob.enabled;
                    inner.ptt_mode = blob.ptt_mode;
                    inner.hotkey = QString::from(blob.hotkey.as_str());
                    inner.device_name = QString::from(blob.device_name.as_str());
                }
                self.as_mut().enabled_changed();
                self.as_mut().ptt_mode_changed();
                self.as_mut().hotkey_changed();
                self.as_mut().device_name_changed();
                self.as_mut()
                    .set_status_line(QString::from(base_status_line().as_str()));
            }
            BlobLoad::Missing => {
                {
                    let mut inner = self.as_mut().rust_mut();
                    let defaults = HearingSettingsBlob::default();
                    inner.enabled = defaults.enabled;
                    inner.ptt_mode = defaults.ptt_mode;
                    inner.hotkey = QString::from(defaults.hotkey.as_str());
                    inner.device_name = QString::from(defaults.device_name.as_str());
                }
                self.as_mut().enabled_changed();
                self.as_mut().ptt_mode_changed();
                self.as_mut().hotkey_changed();
                self.as_mut().device_name_changed();
                self.as_mut()
                    .set_status_line(QString::from(base_status_line().as_str()));
            }
            BlobLoad::Corrupt(e) => {
                eprintln!("[airi-slint] hearing: refusing to overwrite {HEARING_KEY}: {e}");
                self.as_mut().set_status_line(QString::from(
                    format!("{HEARING_KEY} unreadable, showing current values: {e}").as_str(),
                ));
            }
        }
        self.as_mut()
            .set_devices_json(QString::from(enumerate_devices_json().as_str()));
        qobject::HearingController::state_changed(self.as_mut());
    }

    /// Persist the current mirror (idempotent) and update the status line.
    pub fn save(self: Pin<&mut Self>) -> bool {
        self.persist_with_status()
    }

    /// Check whether persisting is safe. A blob that exists but fails to
    /// parse is left untouched (mirror keeps its current values).
    fn persist_with_status(mut self: Pin<&mut Self>) -> bool {
        if let BlobLoad::Corrupt(e) = load_blob() {
            eprintln!("[airi-slint] hearing: refusing to overwrite {HEARING_KEY}: {e}");
            let status = format!("save skipped: {HEARING_KEY} unreadable ({e})");
            self.as_mut()
                .set_status_line(QString::from(status.as_str()));
            qobject::HearingController::state_changed(self.as_mut());
            return false;
        }
        let blob = self.snapshot();
        let result = save_blob(&blob);
        let status = match &result {
            Ok(()) => format!("{} - saved", base_status_line()),
            Err(e) => {
                eprintln!("[airi-slint] hearing: failed to persist {HEARING_KEY}: {e}");
                format!("save failed: {e}")
            }
        };
        let ok = result.is_ok();
        self.as_mut()
            .set_status_line(QString::from(status.as_str()));
        qobject::HearingController::state_changed(self.as_mut());
        ok
    }

    /// Copy the mirror into a blob value.
    fn snapshot(&self) -> HearingSettingsBlob {
        let inner = self.rust();
        HearingSettingsBlob {
            enabled: inner.enabled,
            ptt_mode: inner.ptt_mode,
            hotkey: qstring_to_string(&inner.hotkey),
            device_name: qstring_to_string(&inner.device_name),
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
