// SPDX-License-Identifier: GPL-3.0-or-later
//! Update checker bridge (`UpdateController`) exposed to QML.
//!
//! P8 stage gate: **check + notify only**. `checkUpdate` performs the
//! HTTP request synchronously on the calling thread (with the timeout baked
//! into [`airi_core::update::check_for_update`], currently 8 s) and returns a
//! compact wire string — there is no download/self-replacement path. The
//! About window invokes it on demand (never on open).

use cxx_qt_lib::QString;
use std::pin::Pin;

/// cxx-qt bridge definitions for the update bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Update checker exposed to QML. QML creates it once and calls
        /// [`check_update`] on demand.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, current_version, cxx_name = "currentVersion")]
        #[qproperty(QString, last_result, cxx_name = "lastResult")]
        type UpdateController = super::UpdateControllerRust;
    }

    extern "RustQt" {
        /// Check GitHub for a newer release (blocking HTTP call, ~8 s cap).
        ///
        /// Returns one of:
        /// - `"update-available: <version> <url>"`
        /// - `"up-to-date"`
        /// - `"error: <message>"`
        ///
        /// Also stores the string in `lastResult`.
        #[qinvokable]
        #[cxx_name = "checkUpdate"]
        fn check_update(self: Pin<&mut UpdateController>) -> QString;
    }
}

/// Rust storage for `UpdateController`.
pub struct UpdateControllerRust {
    current_version: QString,
    last_result: QString,
}

impl Default for UpdateControllerRust {
    fn default() -> Self {
        Self {
            current_version: QString::from(env!("CARGO_PKG_VERSION")),
            last_result: QString::default(),
        }
    }
}

impl qobject::UpdateController {
    /// Blocking check for a newer release. See the bridge docs for the
    /// wire format.
    pub fn check_update(mut self: Pin<&mut Self>) -> QString {
        let result = match crate::bridges::runtime_handle() {
            Some(handle) => {
                // The Qt thread is not a tokio worker, so `block_on` on the
                // shared multi-thread runtime handle is valid here.
                let status = handle.block_on(airi_core::update::check_for_update(env!(
                    "CARGO_PKG_VERSION"
                )));
                match status {
                    Ok(airi_core::update::UpdateStatus::UpToDate) => "up-to-date".to_string(),
                    Ok(airi_core::update::UpdateStatus::UpdateAvailable { version, url }) => {
                        format!("update-available: {version} {url}")
                    }
                    Err(e) => format!("error: {e}"),
                }
            }
            // No runtime (unit tests): report instead of panicking.
            None => "error: tokio runtime unavailable".to_string(),
        };
        eprintln!("[airi-qt] update check: {result}");
        let qresult = QString::from(result.as_str());
        self.as_mut().set_last_result(qresult.clone());
        qresult
    }
}
