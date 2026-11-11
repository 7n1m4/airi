// SPDX-License-Identifier: GPL-3.0-or-later
//! cxx-qt bridge objects exposed to QML.
//!
//! Shared process-lifetime state (the `--smoke` flag and the opened
//! `SettingsStore`) lives in statics here so each QML-created bridge instance
//! sees the same data. Bridges must stay thin: no Tokio, no heavy work on the
//! Qt thread — persistence calls are small synchronous SQLite reads/writes.

pub mod acp;
pub mod capture;
pub mod cards;
pub mod chat;
pub mod data;
pub mod desktop;
pub mod discord;
pub mod i18n;
pub mod mcp;
pub mod providers;
pub mod settings_chat;
pub mod settings_general;
pub mod settings_sections;
pub mod settings_stage;
pub mod shell;
pub mod spine;
pub mod stage;
pub mod sync;
pub mod theme;
pub mod update;
pub mod windows;

use airi_core::settings::SettingsStore;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

/// Set from `main` (via `--smoke`) before the QML engine loads.
static SMOKE: AtomicBool = AtomicBool::new(false);

/// Open store, set from `main` before the QML engine loads.
static SETTINGS: OnceLock<SettingsStore> = OnceLock::new();
/// Profile directory, set from `main` before the QML engine loads.
static PROFILE: OnceLock<std::path::PathBuf> = OnceLock::new();
/// Set from `main` (explicit `--profile`) before the QML engine loads.
static PROFILE_EXPLICIT: AtomicBool = AtomicBool::new(false);

/// Enable or disable smoke mode. Called once from `main` before engine load.
pub fn set_smoke(enabled: bool) {
    SMOKE.store(enabled, Ordering::SeqCst);
}

/// Whether the process was launched with `--smoke`.
pub fn smoke() -> bool {
    SMOKE.load(Ordering::SeqCst)
}

/// Register the settings store used by bridges for persistence.
/// Silently keeps the first registration when called twice.
pub fn set_settings_store(store: SettingsStore) {
    let _ = SETTINGS.set(store);
}

/// Borrow the registered settings store, if any.
pub fn settings_store() -> Option<&'static SettingsStore> {
    SETTINGS.get()
}

/// Open provider repository, set from `main` before the QML engine loads.
static PROVIDERS: OnceLock<airi_store::ProviderRepo> = OnceLock::new();

/// Database handle registered from `main` for the data-vault bridge.
static DATABASE: OnceLock<airi_store::Database> = OnceLock::new();

/// Register the database handle used by the data-vault bridge.
/// Silently keeps the first registration when called twice.
pub fn set_database(db: airi_store::Database) {
    let _ = DATABASE.set(db);
}

/// Borrow the registered database handle, if any.
pub(crate) fn database() -> Option<&'static airi_store::Database> {
    DATABASE.get()
}

/// Tokio runtime handle, set from `main` before the QML engine loads so
/// bridges can spawn async work without owning a runtime.
static RUNTIME: OnceLock<tokio::runtime::Handle> = OnceLock::new();

/// Register the provider repository used by the providers bridge.
/// Silently keeps the first registration when called twice.
pub fn set_provider_repo(repo: airi_store::ProviderRepo) {
    let _ = PROVIDERS.set(repo);
}

/// Borrow the registered provider repository, if any.
pub fn provider_repo() -> Option<&'static airi_store::ProviderRepo> {
    PROVIDERS.get()
}

/// Register the process-wide Tokio runtime handle.
/// Silently keeps the first registration when called twice.
pub fn set_runtime_handle(handle: tokio::runtime::Handle) {
    let _ = RUNTIME.set(handle);
}

/// Borrow the process-wide Tokio runtime handle, if any.
pub fn runtime_handle() -> Option<&'static tokio::runtime::Handle> {
    RUNTIME.get()
}
/// Register the profile directory used by the chat bridge (cards dir).
/// Silently keeps the first registration when called twice.
pub fn set_profile_dir(dir: std::path::PathBuf) {
    let _ = PROFILE.set(dir);
}

/// Borrow the profile directory, if any.
pub(crate) fn profile_dir() -> Option<&'static std::path::PathBuf> {
    PROFILE.get()
}
/// Whether `--profile` was passed explicitly.
pub fn profile_explicit() -> bool {
    PROFILE_EXPLICIT.load(Ordering::SeqCst)
}

/// Register whether `--profile` was passed explicitly. Called once from
/// `main` before bridges resolve import destinations.
pub fn set_profile_explicit(explicit: bool) {
    PROFILE_EXPLICIT.store(explicit, Ordering::SeqCst);
}

/// Convert a `QString` (UTF-16) into an owned Rust `String` (lossy).
pub(crate) fn qstring_to_string(value: &cxx_qt_lib::QString) -> String {
    let bytes = value.to_utf8();
    String::from_utf8_lossy(bytes.as_ref()).into_owned()
}
