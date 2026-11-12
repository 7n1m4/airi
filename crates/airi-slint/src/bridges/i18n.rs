// SPDX-License-Identifier: GPL-3.0-or-later
//! Internationalization bridge (`I18nState`).
//!
//! Backs the Slint `I18n` global: pages call `I18n.tr(locale, key)` and stay
//! locale-reactive because the binding reads `locale`. Locale persistence
//! reuses the Electron `settings/general` blob's `language` field.

use std::sync::Mutex;

/// Locale lookup state. `locale` is the active locale code; assigning it does
/// not persist — call [`I18nState::persist_locale`].
pub struct I18nState {
    /// Active locale code.
    pub locale: String,
}

impl Default for I18nState {
    fn default() -> Self {
        Self {
            locale: persisted_locale(),
        }
    }
}

static STATE: Mutex<I18nState> = Mutex::new(I18nState {
    locale: String::new(),
});

/// Supported UI locale codes, in cycle order; binds to `I18n.cycle-locales`.
pub const CYCLE_LOCALES: &[&str] = &["en", "es", "fr", "ja", "zh-Hans"];

/// Lock the process-wide i18n state.
pub fn with_state<R>(f: impl FnOnce(&mut I18nState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
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

impl I18nState {
    /// Locale-aware key lookup with the en-fallback semantics of `airi_i18n`.
    pub fn tr(&self, locale: &str, key: &str) -> String {
        airi_i18n::tr_locale(locale, key).to_string()
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
        general.language = self.locale.clone();
        if let Err(e) = store.save_section(&general) {
            eprintln!("[airi-slint] i18n: failed to persist locale: {e}");
        }
    }
}
