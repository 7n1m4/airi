// SPDX-License-Identifier: GPL-3.0-or-later
//! Internationalization bridge (`I18nBridge`) exposed to QML.
//!
//! The QML-side `I18n` singleton wraps this bridge so pages can write
//! `I18n.tr('shell.chat.title')` and keep bindings locale-reactive (the
//! singleton reads its `locale` property inside `tr`, so QML re-evaluates
//! bindings when the language changes). Locale persistence reuses the
//! Electron `settings/general` blob's `language` field.

use cxx_qt_lib::QString;

use crate::bridges::qstring_to_string;

/// cxx-qt bridge definitions for the i18n bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Locale lookup bridge. `locale` is the active locale code; QML may
        /// assign it (no implicit persistence — call `persistLocale`).
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, locale)]
        type I18nBridge = super::I18nBridgeRust;
    }

    extern "RustQt" {
        /// Translate `key` for `locale`; falls back to English, then the key.
        #[qinvokable]
        fn tr(self: &I18nBridge, locale: QString, key: QString) -> QString;

        /// Persist the current `locale` into `settings/general` (language).
        #[qinvokable]
        #[cxx_name = "persistLocale"]
        fn persist_locale(self: &I18nBridge);
    }
}

/// Rust storage for `I18nBridge`.
pub struct I18nBridgeRust {
    locale: QString,
}

/// Load the persisted locale code from `settings/general`, or `"en"`.
fn persisted_locale() -> String {
    crate::bridges::settings_store()
        .and_then(|store| {
            store
                .load_section::<airi_core::settings::GeneralSettings>()
                .ok()
        })
        .map(|general| general.language)
        .filter(|code| !code.is_empty() && airi_i18n::Locale::from_code(code).is_some())
        .unwrap_or_else(|| "en".to_string())
}

impl Default for I18nBridgeRust {
    fn default() -> Self {
        Self {
            locale: QString::from(persisted_locale()),
        }
    }
}

impl qobject::I18nBridge {
    /// Locale-aware key lookup with the en-fallback semantics of `airi_i18n`.
    pub fn tr(&self, locale: QString, key: QString) -> QString {
        let code = qstring_to_string(&locale);
        let key = qstring_to_string(&key);
        QString::from(airi_i18n::tr_locale(&code, &key))
    }

    /// Write the current `locale` into `settings/general`'s `language` field.
    pub fn persist_locale(&self) {
        let Some(store) = crate::bridges::settings_store() else {
            return;
        };
        let Ok(mut general) = store.load_section::<airi_core::settings::GeneralSettings>() else {
            eprintln!("[airi-slint] i18n: failed to load settings/general for locale persist");
            return;
        };
        general.language = qstring_to_string(&self.locale);
        if let Err(e) = store.save_section(&general) {
            eprintln!("[airi-slint] i18n: failed to persist locale: {e}");
        }
    }
}
