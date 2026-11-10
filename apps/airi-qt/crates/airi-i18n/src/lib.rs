// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! AIRI internationalization (i18n) module.
//!
//! Compile-time embedded locale data generated from `packages/i18n/src/locales/`.
//! Because the YAML tree is flattened by path, translation keys for the main
//! locale files keep their file-stem prefix (e.g. `base.base.edition.desktop`,
//! `settings.settings.title`, `stage.chat.message.character-name.airi`).
//! Nested namespaces (`tamagotchi.*`, `docs.*`) are nested under their parent
//! directory names.

include!(concat!(env!("OUT_DIR"), "/locale_data.rs"));

/// Supported locales.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Locale {
    /// English
    En,
    /// Spanish
    Es,
    /// French
    Fr,
    /// Indonesian
    Id,
    /// Japanese
    Ja,
    /// Korean
    Ko,
    /// Russian
    Ru,
    /// Vietnamese
    Vi,
    /// Simplified Chinese
    ZhHans,
    /// Traditional Chinese
    ZhHant,
}

impl Locale {
    /// Get the locale code string.
    pub fn code(&self) -> &'static str {
        match self {
            Locale::En => "en",
            Locale::Es => "es",
            Locale::Fr => "fr",
            Locale::Id => "id",
            Locale::Ja => "ja",
            Locale::Ko => "ko",
            Locale::Ru => "ru",
            Locale::Vi => "vi",
            Locale::ZhHans => "zh-Hans",
            Locale::ZhHant => "zh-Hant",
        }
    }

    /// Parse a locale code string.
    pub fn from_code(code: &str) -> Option<Self> {
        match code {
            "en" => Some(Locale::En),
            "es" => Some(Locale::Es),
            "fr" => Some(Locale::Fr),
            "id" => Some(Locale::Id),
            "ja" => Some(Locale::Ja),
            "ko" => Some(Locale::Ko),
            "ru" => Some(Locale::Ru),
            "vi" => Some(Locale::Vi),
            "zh-Hans" | "zh_Hans" | "zh-CN" => Some(Locale::ZhHans),
            "zh-Hant" | "zh_Hant" | "zh-TW" => Some(Locale::ZhHant),
            _ => None,
        }
    }

    /// All supported locale codes.
    pub fn all_codes() -> &'static [&'static str] {
        &[
            "en", "es", "fr", "id", "ja", "ko", "ru", "vi", "zh-Hans", "zh-Hant",
        ]
    }
}

/// Translate a key for a locale, falling back to English, then the key itself.
pub fn tr_locale<'a>(locale_code: &str, key: &'a str) -> &'a str {
    if let Some(map) = LOCALE_DATA.get(locale_code) {
        if let Some(value) = map.get(key) {
            return value;
        }
    }
    if locale_code != "en" {
        if let Some(map) = LOCALE_DATA.get("en") {
            if let Some(value) = map.get(key) {
                return value;
            }
        }
    }
    key
}

/// Translate a key using English locale (simple default).
pub fn tr(key: &str) -> &str {
    tr_locale("en", key)
}

/// Check if a key exists in a locale.
pub fn has_key(locale_code: &str, key: &str) -> bool {
    LOCALE_DATA
        .get(locale_code)
        .map(|m| m.contains_key(key))
        .unwrap_or(false)
}

/// All known keys from English reference data.
pub fn all_keys() -> &'static [&'static str] {
    ALL_KEYS
}

/// Number of locales embedded.
pub fn locale_count() -> usize {
    LOCALE_DATA.len()
}

/// Number of keys embedded for English reference.
pub fn key_count() -> usize {
    ALL_KEYS.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_codes_roundtrip() {
        assert_eq!(Locale::En.code(), "en");
        assert_eq!(Locale::ZhHans.code(), "zh-Hans");
        assert_eq!(Locale::ZhHant.code(), "zh-Hant");
        assert_eq!(Locale::from_code("ja"), Some(Locale::Ja));
        assert_eq!(Locale::from_code("zh-CN"), Some(Locale::ZhHans));
        assert_eq!(Locale::from_code("invalid"), None);
    }

    #[test]
    fn known_keys_resolve_in_en() {
        // Build the flattened dotted paths expected from the locale tree.
        for key in [
            // base.yaml is flattened under `base.` prefix
            "base.edition.desktop",
            "base.prompt.prefix",
            "base.prompt.suffix",
            // settings.yaml is flattened under `settings.` prefix
            "settings.settings.title",
            "settings.settings.description",
            // stage.yaml is flattened under `stage.` prefix
            "stage.chat.message.character-name.airi",
            "stage.chat.message.character-name.you",
            // nested namespace
            "stage.startup.ready",
        ] {
            let value = tr_locale("en", key);
            assert_ne!(value, key, "expected en key to resolve: {key}");
            assert!(!value.is_empty(), "expected non-empty value for {key}");
        }
    }

    #[test]
    fn fallback_to_en_and_key() {
        let missing = tr_locale("en", "this.key.should.not.exist.__test__");
        assert_eq!(missing, "this.key.should.not.exist.__test__");
        let en_val = tr_locale("en", "settings.settings.title");
        assert_ne!(en_val, "settings.settings.title");
        let ja_val = tr_locale("ja", "settings.settings.title");
        assert!(!ja_val.is_empty());
    }

    #[test]
    fn all_locales_present() {
        for code in Locale::all_codes() {
            assert!(LOCALE_DATA.contains_key(code), "missing locale {code}");
        }
    }
}
