// SPDX-License-Identifier: GPL-3.0-or-later
//! Update checker bridge (`UpdateState`).
//!
//! P8 stage gate: **check + notify only**. [`UpdateState::check_update`]
//! performs the HTTP request synchronously on the calling thread (with the
//! timeout baked into [`airi_core::update::check_for_update`], currently 8 s)
//! and returns a compact wire string — there is no download/self-replacement
//! path. The About window invokes it on demand (never on open).

use std::sync::Mutex;

/// Update checker state.
pub struct UpdateState {
    /// Version of the running build.
    pub current_version: String,
    /// Wire string of the most recent check.
    pub last_result: String,
    /// `true` when the last check found a newer release.
    pub available: bool,
    /// Latest release version reported by the check, if any.
    pub version: Option<String>,
    /// Download page for the latest release, if any.
    pub url: Option<String>,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self {
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            last_result: String::default(),
            available: false,
            version: None,
            url: None,
        }
    }
}

static STATE: Mutex<UpdateState> = Mutex::new(UpdateState {
    current_version: String::new(),
    last_result: String::new(),
    available: false,
    version: None,
    url: None,
});

/// Lock the process-wide update state.
pub fn with_state<R>(f: impl FnOnce(&mut UpdateState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

impl UpdateState {
    /// Blocking check for a newer release. See the module docs for the wire
    /// format.
    pub fn check_update(&mut self) -> String {
        let result = match crate::bridges::runtime_handle() {
            Some(handle) => {
                // The Slint UI thread is not a tokio worker, so `block_on` on
                // the shared multi-thread runtime handle is valid here.
                let status = handle.block_on(airi_core::update::check_for_update(env!(
                    "CARGO_PKG_VERSION"
                )));
                match status {
                    Ok(airi_core::update::UpdateStatus::UpToDate) => "up-to-date".to_string(),
                    Ok(airi_core::update::UpdateStatus::UpdateAvailable { version, url }) => {
                        self.available = true;
                        self.version = Some(version.clone());
                        self.url = Some(url.clone());
                        format!("update-available: {version} {url}")
                    }
                    Err(e) => format!("error: {e}"),
                }
            }
            // No runtime (unit tests): report instead of panicking.
            None => "error: tokio runtime unavailable".to_string(),
        };
        eprintln!("[airi-slint] update check: {result}");
        self.last_result = result.clone();
        result
    }
}
