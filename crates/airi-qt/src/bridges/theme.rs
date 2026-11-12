// SPDX-License-Identifier: GPL-3.0-or-later
//! Theme settings bridge (`ThemeBridge`) exposed to QML.
//!
//! Reads and writes the `settings/theme` blob (`ThemeSettings`) plus the
//! additive `dark` flag. QML pushes the initial values into the `Theme`
//! singleton at startup and calls the `apply*` invokables on user edits;
//! each `apply*` updates the bridge mirror and persists the section.

use std::pin::Pin;

use airi_core::settings::ThemeSettings;

/// cxx-qt bridge definitions for the theme bridge.
#[cxx_qt::bridge]
pub mod qobject {
    extern "RustQt" {
        /// Theme settings mirror. Read at startup to seed the QML `Theme`
        /// singleton; mutate via the `apply*` invokables (persist on change).
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(f64, hue)]
        #[qproperty(f64, chroma)]
        #[qproperty(bool, dark)]
        type ThemeBridge = super::ThemeBridgeRust;
    }

    extern "RustQt" {
        /// Set the accent hue (degrees, 0–360) and persist it.
        #[qinvokable]
        #[cxx_name = "applyHue"]
        fn apply_hue(self: Pin<&mut ThemeBridge>, hue: f64);

        /// Set the chroma multiplier (0.0–2.0) and persist it.
        #[qinvokable]
        #[cxx_name = "applyChroma"]
        fn apply_chroma(self: Pin<&mut ThemeBridge>, chroma: f64);

        /// Set dark mode and persist it.
        #[qinvokable]
        #[cxx_name = "applyDark"]
        fn apply_dark(self: Pin<&mut ThemeBridge>, dark: bool);
    }
}

/// Rust storage for `ThemeBridge`.
pub struct ThemeBridgeRust {
    hue: f64,
    chroma: f64,
    dark: bool,
}

impl Default for ThemeBridgeRust {
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

impl qobject::ThemeBridge {
    /// Set the accent hue and persist the `settings/theme` section.
    pub fn apply_hue(mut self: Pin<&mut Self>, hue: f64) {
        self.as_mut().set_hue(hue);
        save_theme_settings(|s| s.hue = hue);
    }

    /// Set the chroma multiplier and persist the `settings/theme` section.
    pub fn apply_chroma(mut self: Pin<&mut Self>, chroma: f64) {
        self.as_mut().set_chroma(chroma);
        save_theme_settings(|s| s.chroma_multiplier = chroma);
    }

    /// Set dark mode and persist the `settings/theme` section.
    pub fn apply_dark(mut self: Pin<&mut Self>, dark: bool) {
        self.as_mut().set_dark(dark);
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
                eprintln!("[airi-qt] theme: failed to persist settings/theme: {e}");
            }
        }
        Err(e) => {
            eprintln!("[airi-qt] theme: failed to load settings/theme, not persisting: {e}");
        }
    }
}
