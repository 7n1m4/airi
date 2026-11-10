// SPDX-License-Identifier: GPL-3.0-or-later
//! General settings bridge (`GeneralSettingsController`) exposed to QML.
//!
//! Mirrors [`airi_core::settings::GeneralSettings`] (`settings/general`):
//! `language` (empty = system default), `disableTransitions`,
//! `usePageSpecificTransitions`, `remoteSyncEnabled`,
//! `websocketSecureEnabled`, `autostart` (OS login entry mirror; the OS-level
//! entry itself is managed by `DesktopController.setAutostart`).

use std::pin::Pin;

use cxx_qt_lib::QString;

use airi_core::settings::GeneralSettings;

use crate::bridges::qstring_to_string;

/// cxx-qt bridge definitions for the general settings bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// General settings mirror.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, language, cxx_name = "language")]
        #[qproperty(bool, disable_transitions, cxx_name = "disableTransitions")]
        #[qproperty(
            bool,
            use_page_specific_transitions,
            cxx_name = "usePageSpecificTransitions"
        )]
        #[qproperty(bool, remote_sync_enabled, cxx_name = "remoteSyncEnabled")]
        #[qproperty(bool, websocket_secure_enabled, cxx_name = "websocketSecureEnabled")]
        #[qproperty(bool, autostart, cxx_name = "autostart")]
        type GeneralSettingsController = super::GeneralSettingsControllerRust;
    }

    extern "RustQt" {
        /// Re-read `settings/general` into the mirror properties.
        #[qinvokable]
        #[cxx_name = "load"]
        fn load(self: Pin<&mut GeneralSettingsController>);

        /// Persist `settings/general`. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "save"]
        fn save(
            self: Pin<&mut GeneralSettingsController>,
            language: QString,
            disable_transitions: bool,
            use_page_specific_transitions: bool,
            remote_sync_enabled: bool,
            websocket_secure_enabled: bool,
            autostart: bool,
        ) -> bool;

        /// Alias for `load()` — re-read the section from the store.
        #[qinvokable]
        #[cxx_name = "reloadFromStore"]
        fn reload_from_store(self: Pin<&mut GeneralSettingsController>);
    }
}

/// Rust storage for `GeneralSettingsController`.
pub struct GeneralSettingsControllerRust {
    language: QString,
    disable_transitions: bool,
    use_page_specific_transitions: bool,
    remote_sync_enabled: bool,
    websocket_secure_enabled: bool,
    autostart: bool,
}

impl Default for GeneralSettingsControllerRust {
    fn default() -> Self {
        let s = load_section::<GeneralSettings>();
        Self {
            language: QString::from(s.language.as_str()),
            disable_transitions: s.disable_transitions,
            use_page_specific_transitions: s.use_page_specific_transitions,
            remote_sync_enabled: s.remote_sync_enabled,
            websocket_secure_enabled: s.websocket_secure_enabled,
            autostart: s.autostart,
        }
    }
}

impl qobject::GeneralSettingsController {
    /// Re-read `settings/general` into the mirror properties.
    pub fn load(mut self: Pin<&mut Self>) {
        let s = load_section::<GeneralSettings>();
        self.as_mut()
            .set_language(QString::from(s.language.as_str()));
        self.as_mut().set_disable_transitions(s.disable_transitions);
        self.as_mut()
            .set_use_page_specific_transitions(s.use_page_specific_transitions);
        self.as_mut().set_remote_sync_enabled(s.remote_sync_enabled);
        self.as_mut()
            .set_websocket_secure_enabled(s.websocket_secure_enabled);
        self.as_mut().set_autostart(s.autostart);
    }

    /// Persist `settings/general`.
    pub fn save(
        mut self: Pin<&mut Self>,
        language: QString,
        disable_transitions: bool,
        use_page_specific_transitions: bool,
        remote_sync_enabled: bool,
        websocket_secure_enabled: bool,
        autostart: bool,
    ) -> bool {
        let section = GeneralSettings {
            language: qstring_to_string(&language).trim().to_string(),
            disable_transitions,
            use_page_specific_transitions,
            remote_sync_enabled,
            websocket_secure_enabled,
            autostart,
        };
        match save_section(&section) {
            Ok(()) => {
                self.as_mut()
                    .set_language(QString::from(section.language.as_str()));
                self.as_mut()
                    .set_disable_transitions(section.disable_transitions);
                self.as_mut()
                    .set_use_page_specific_transitions(section.use_page_specific_transitions);
                self.as_mut()
                    .set_remote_sync_enabled(section.remote_sync_enabled);
                self.as_mut()
                    .set_websocket_secure_enabled(section.websocket_secure_enabled);
                self.as_mut().set_autostart(section.autostart);
                true
            }
            Err(e) => {
                eprintln!("[airi-qt] general settings: failed to persist settings/general: {e}");
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(self: Pin<&mut Self>) {
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
