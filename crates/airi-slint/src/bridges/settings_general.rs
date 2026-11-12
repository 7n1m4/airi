// SPDX-License-Identifier: GPL-3.0-or-later
//! General settings bridge (`GeneralSettingsState`).
//!
//! Mirrors [`airi_core::settings::GeneralSettings`] (`settings/general`):
//! `language` (empty = system default), `disableTransitions`,
//! `usePageSpecificTransitions`, `remoteSyncEnabled`,
//! `websocketSecureEnabled`, `autostart` (OS login entry mirror; the OS-level
//! entry itself is managed by `DesktopController.setAutostart`).

use std::sync::Mutex;

use airi_core::settings::GeneralSettings;

/// General settings mirror (`settings/general`).
pub struct GeneralSettingsState {
    pub language: String,
    pub disable_transitions: bool,
    pub use_page_specific_transitions: bool,
    pub remote_sync_enabled: bool,
    pub websocket_secure_enabled: bool,
    pub autostart: bool,
}

impl Default for GeneralSettingsState {
    fn default() -> Self {
        let s = load_section::<GeneralSettings>();
        Self {
            language: s.language,
            disable_transitions: s.disable_transitions,
            use_page_specific_transitions: s.use_page_specific_transitions,
            remote_sync_enabled: s.remote_sync_enabled,
            websocket_secure_enabled: s.websocket_secure_enabled,
            autostart: s.autostart,
        }
    }
}

static STATE: Mutex<GeneralSettingsState> = Mutex::new(GeneralSettingsState {
    language: String::new(),
    disable_transitions: false,
    use_page_specific_transitions: false,
    remote_sync_enabled: false,
    websocket_secure_enabled: false,
    autostart: false,
});

/// Lock the process-wide general settings state.
pub fn with_state<R>(f: impl FnOnce(&mut GeneralSettingsState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

impl GeneralSettingsState {
    /// Re-read `settings/general` into the mirror properties.
    pub fn load(&mut self) {
        let s = load_section::<GeneralSettings>();
        self.language = s.language;
        self.disable_transitions = s.disable_transitions;
        self.use_page_specific_transitions = s.use_page_specific_transitions;
        self.remote_sync_enabled = s.remote_sync_enabled;
        self.websocket_secure_enabled = s.websocket_secure_enabled;
        self.autostart = s.autostart;
    }

    /// Persist `settings/general`. Returns `true` on success.
    pub fn save(
        &mut self,
        language: &str,
        disable_transitions: bool,
        use_page_specific_transitions: bool,
        remote_sync_enabled: bool,
        websocket_secure_enabled: bool,
        autostart: bool,
    ) -> bool {
        let section = GeneralSettings {
            language: language.trim().to_string(),
            disable_transitions,
            use_page_specific_transitions,
            remote_sync_enabled,
            websocket_secure_enabled,
            autostart,
        };
        match save_section(&section) {
            Ok(()) => {
                self.language = section.language;
                self.disable_transitions = section.disable_transitions;
                self.use_page_specific_transitions = section.use_page_specific_transitions;
                self.remote_sync_enabled = section.remote_sync_enabled;
                self.websocket_secure_enabled = section.websocket_secure_enabled;
                self.autostart = section.autostart;
                true
            }
            Err(e) => {
                eprintln!("[airi-slint] general settings: failed to persist settings/general: {e}");
                false
            }
        }
    }

    /// Alias for `load()` — re-read the section from the store.
    pub fn reload_from_store(&mut self) {
        self.load();
    }
}

fn load_section<S: airi_core::settings::SettingsSection>() -> S {
    crate::bridges::settings_store()
        .and_then(|store| store.load_section::<S>().ok())
        .unwrap_or_default()
}

fn save_section<S: airi_core::settings::SettingsSection>(value: &S) -> anyhow::Result<()> {
    let Some(store) = crate::bridges::settings_store() else {
        anyhow::bail!("settings store not registered");
    };
    store.save_section(value)
}

#[cfg(test)]
mod tests {
    //! Round-trip test against a temp SQLite store (never the real profile).
    use super::*;
    use airi_store::Database;

    fn store(path: &str) -> airi_core::settings::SettingsStore {
        let db = Database::open(std::path::Path::new(path)).expect("open temp db");
        airi_core::settings::SettingsStore::new(db, tokio::sync::broadcast::channel(16).0)
    }

    #[test]
    fn save_then_load_round_trips() {
        crate::bridges::set_settings_store(store(
            "/tmp/airi-slint-settings-general-roundtrip.sqlite",
        ));
        let mut state = GeneralSettingsState::default();
        assert!(state.save(" ja ", false, true, true, true, true));
        assert_eq!(state.language, "ja");
        let reloaded = load_section::<GeneralSettings>();
        assert_eq!(reloaded.language, "ja");
        assert!(!reloaded.disable_transitions);
        assert!(reloaded.use_page_specific_transitions);
        assert!(reloaded.autostart);
    }
}
