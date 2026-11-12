// SPDX-License-Identifier: GPL-3.0-or-later
//! Theme settings bridge (`ThemeState`).
//!
//! Reads and writes the `settings/theme` blob (`ThemeSettings`) plus the
//! additive `dark` flag. The UI seeds the Slint `Theme` global at startup and
//! calls the `apply_*` methods on user edits; each `apply_*` updates the
//! mirror and persists the section.

use std::sync::Mutex;

use airi_core::settings::ThemeSettings;

/// Theme settings mirror. Read at startup to seed the `Theme` global; mutate
/// via the `apply_*` methods (persist on change).
pub struct ThemeState {
    /// Accent hue in OKLCH degrees.
    pub hue: f64,
    /// Chroma multiplier applied to generated colors.
    pub chroma: f64,
    /// Dark mode flag.
    pub dark: bool,
}

static STATE: Mutex<ThemeState> = Mutex::new(ThemeState {
    hue: 0.0,
    chroma: 0.0,
    dark: false,
});

/// Lock the process-wide theme state.
pub fn with_state<R>(f: impl FnOnce(&mut ThemeState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

impl Default for ThemeState {
    fn default() -> Self {
        let section = crate::bridges::settings_store()
            .and_then(|store| store.load_section::<ThemeSettings>().ok())
            .unwrap_or_default();
        Self {
            hue: section.hue,
            chroma: section.chroma_multiplier,
            dark: section.dark,
        }
    }
}

impl ThemeState {
    /// Set the accent hue and persist the `settings/theme` section.
    pub fn apply_hue(&mut self, hue: f64) {
        self.hue = hue;
        save_theme_settings(|s| s.hue = hue);
    }

    /// Set the chroma multiplier and persist the `settings/theme` section.
    pub fn apply_chroma(&mut self, chroma: f64) {
        self.chroma = chroma;
        save_theme_settings(|s| s.chroma_multiplier = chroma);
    }

    /// Set dark mode and persist the `settings/theme` section.
    pub fn apply_dark(&mut self, dark: bool) {
        self.dark = dark;
        save_theme_settings(|s| s.dark = dark);
    }
}

/// Load the `settings/theme` section, mutate it, and save it back.
/// Skips the save (with a log) when the stored blob fails to parse so a
/// corrupt value is never silently overwritten.
fn save_theme_settings(f: impl FnOnce(&mut ThemeSettings)) {
    let Some(store) = crate::bridges::settings_store() else {
        return;
    };
    match store.load_section::<ThemeSettings>() {
        Ok(mut section) => {
            f(&mut section);
            if let Err(e) = store.save_section(&section) {
                eprintln!("[airi-slint] theme: failed to persist settings/theme: {e}");
            }
        }
        Err(e) => {
            eprintln!("[airi-slint] theme: failed to load settings/theme, not persisting: {e}");
        }
    }
}
