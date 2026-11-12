// SPDX-License-Identifier: GPL-3.0-or-later
//! UI bridges exposed to Slint. Each bridge is a plain Rust module that
//! shuttles UI-facing calls into the service layer; no cxx-qt / QObject.
//!
//! Shared process-lifetime state (the `--smoke` flag, the opened
//! `SettingsStore`, the provider repo, the database handle, the Tokio
//! runtime handle, and the profile dir) lives in statics here so each
//! Slint-created bridge instance sees the same data. Bridges must stay
//! thin: no Tokio, no heavy work on the UI thread — persistence calls are
//! small synchronous SQLite reads/writes.

use airi_core::settings::SettingsStore;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

pub mod acp;
pub mod capture;
pub mod cards;
pub mod chat;
pub mod daemon;
pub mod data;
pub mod desktop;
pub mod discord;
pub mod discord_gateway;
pub mod gateway_pump;
pub mod hearing;
pub mod i18n;
pub mod mcp;
pub mod memory;
pub mod mmd;
pub mod providers;
pub mod settings_chat;
pub mod settings_general;
pub mod settings_sections;
pub mod settings_stage;
pub mod shell;
pub mod speech;
pub mod spine;
pub mod stage;
pub mod sync;
pub mod theme;
pub mod update;
pub mod windows;

/// Set from `main` (via `--smoke`) before the Slint event loop starts.
static SMOKE: AtomicBool = AtomicBool::new(false);

/// Open store, set from `main` before the Slint event loop starts.
static SETTINGS: OnceLock<SettingsStore> = OnceLock::new();
/// Profile directory, set from `main` before the Slint event loop starts.
static PROFILE: OnceLock<PathBuf> = OnceLock::new();
/// Set from `main` (explicit `--profile`) before the Slint event loop starts.
static PROFILE_EXPLICIT: AtomicBool = AtomicBool::new(false);
/// Provider repository, set from `main` before the Slint event loop starts.
static PROVIDERS: OnceLock<airi_store::ProviderRepo> = OnceLock::new();
/// Database handle registered from `main` for the data-vault bridge.
static DATABASE: OnceLock<airi_store::Database> = OnceLock::new();
/// Tokio runtime handle, set from `main` so bridges can spawn async work
/// without owning a runtime.
static RUNTIME: OnceLock<tokio::runtime::Handle> = OnceLock::new();

/// Enable or disable smoke mode. Called once from `main` before the loop.
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

/// Register the provider repository used by the providers bridge.
/// Silently keeps the first registration when called twice.
pub fn set_provider_repo(repo: airi_store::ProviderRepo) {
    let _ = PROVIDERS.set(repo);
}

/// Borrow the registered provider repository, if any.
pub fn provider_repo() -> Option<&'static airi_store::ProviderRepo> {
    PROVIDERS.get()
}

/// Register the database handle used by the data-vault bridge.
/// Silently keeps the first registration when called twice.
pub fn set_database(db: airi_store::Database) {
    let _ = DATABASE.set(db);
}

/// Borrow the registered database handle, if any.
pub(crate) fn database() -> Option<&'static airi_store::Database> {
    DATABASE.get()
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
pub fn set_profile_dir(dir: PathBuf) {
    let _ = PROFILE.set(dir);
}

/// Borrow the profile directory, if any.
pub(crate) fn profile_dir() -> Option<&'static PathBuf> {
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
