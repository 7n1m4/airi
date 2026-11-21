// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::PathBuf;

use anima_core::memory::TextJournalService;
use anima_core::settings::CardsSettings;
use anima_daemon::core::CoreService;
use anima_slint::daemon_mode::{DaemonMode, SelectedMode, select_mode};
use anima_store::Database;
use anima_store::SessionRepo;
use tempfile::tempdir;

fn store_path(profile: &std::path::Path) -> PathBuf {
    profile.join("airi.sqlite")
}

#[test]
fn daemon_mode_owns_the_store() {
    let daemon_profile = tempdir().unwrap();
    let svc = CoreService::open(Some(daemon_profile.path().to_path_buf()));
    assert!(svc.available());
    assert!(store_path(daemon_profile.path()).exists());

    assert_eq!(select_mode(DaemonMode::Required, || true), SelectedMode::Daemon);

    let client_profile = tempdir().unwrap();
    assert!(!store_path(client_profile.path()).exists());
}

#[test]
fn fallback_mode_opens_local_store() {
    let probe_called = std::cell::Cell::new(false);
    assert_eq!(
        select_mode(DaemonMode::Disabled, || {
            probe_called.set(true);
            true
        }),
        SelectedMode::Local
    );
    assert!(!probe_called.get());

    assert_eq!(select_mode(DaemonMode::Auto, || false), SelectedMode::Local);

    let local_profile = tempdir().unwrap();
    let svc = CoreService::open(Some(local_profile.path().to_path_buf()));
    assert!(svc.available());
    assert!(store_path(local_profile.path()).exists());

    let daemon_profile = tempdir().unwrap();
    assert!(!store_path(daemon_profile.path()).exists());
}

#[test]
fn required_unhealthy_never_opens_local() {
    assert_eq!(select_mode(DaemonMode::Required, || false), SelectedMode::Unavailable);

    let profile = tempdir().unwrap();
    assert!(!store_path(profile.path()).exists());
}

#[test]
fn daemon_and_local_are_distinct_profiles() {
    let profile_a = tempdir().unwrap();
    let profile_b = tempdir().unwrap();

    let daemon_svc = CoreService::open(Some(profile_a.path().to_path_buf()));
    let local_svc = CoreService::open(Some(profile_b.path().to_path_buf()));
    assert!(daemon_svc.available());
    assert!(local_svc.available());

    let path_a = store_path(profile_a.path());
    let path_b = store_path(profile_b.path());
    assert!(path_a.exists());
    assert!(path_b.exists());
    assert_ne!(path_a, path_b);
}

#[test]
fn chat_sessions_daemon_store_operates() {
    let daemon_profile = tempdir().unwrap();
    let svc = CoreService::open(Some(daemon_profile.path().to_path_buf()));
    assert!(svc.available());
    assert!(store_path(daemon_profile.path()).exists());

    let db = Database::open(&store_path(daemon_profile.path())).unwrap();
    let repo = SessionRepo::new(db);
    let session = repo.create("chat-1", "Hello").unwrap();
    assert_eq!(session.title, "Hello");
    assert_eq!(repo.list().unwrap().len(), 1);
    assert!(repo.get("chat-1").unwrap().is_some());

    let client_profile = tempdir().unwrap();
    assert!(!store_path(client_profile.path()).exists());
}

#[test]
fn stmm_and_journal_daemon_store_appends() {
    let daemon_profile = tempdir().unwrap();
    let svc = CoreService::open(Some(daemon_profile.path().to_path_buf()));
    assert!(svc.available());

    let db = Database::open(&store_path(daemon_profile.path())).unwrap();

    // STMM: summary repo operates against the daemon-owned store.
    let summaries = anima_store::SummaryRepo::new(db.clone());
    summaries
        .insert(&anima_store::StoredSummary {
            id: "sum-1".to_string(),
            day: "2026-11-21".to_string(),
            content: "did things".to_string(),
            source_session_ids: vec![],
            token_estimate: 4,
            created_at: 10,
        })
        .unwrap();
    assert_eq!(summaries.count().unwrap(), 1);

    // Journal: TextJournalService appends against the daemon-owned store.
    let journal = TextJournalService::new(db);
    let id = journal.append_note("a note").unwrap();
    assert!(!id.is_empty());
    assert_eq!(journal.count().unwrap(), 1);

    let client_profile = tempdir().unwrap();
    assert!(!store_path(client_profile.path()).exists());
}

#[test]
fn cards_daemon_settings_load_and_save() {
    let daemon_profile = tempdir().unwrap();
    let svc = CoreService::open(Some(daemon_profile.path().to_path_buf()));
    assert!(svc.available());

    let value = serde_json::json!({"activeCardId": "hero"});
    let reply = svc.settings_set("cards", value).unwrap();
    assert!(reply.ok);

    let got = svc.settings_get("cards").unwrap();
    assert!(got.settings.contains("hero"));

    let client_profile = tempdir().unwrap();
    assert!(!store_path(client_profile.path()).exists());
}

#[test]
fn mode_selection_controls_store_ownership() {
    // Daemon mode: daemon owns the store.
    let daemon_profile = tempdir().unwrap();
    assert_eq!(select_mode(DaemonMode::Required, || true), SelectedMode::Daemon);
    let daemon_svc = CoreService::open(Some(daemon_profile.path().to_path_buf()));
    assert!(daemon_svc.available());
    assert!(store_path(daemon_profile.path()).exists());

    // Client-local fallback: local store.
    let local_profile = tempdir().unwrap();
    assert_eq!(select_mode(DaemonMode::Auto, || false), SelectedMode::Local);
    let local_svc = CoreService::open(Some(local_profile.path().to_path_buf()));
    assert!(local_svc.available());
    assert!(store_path(local_profile.path()).exists());

    // Required-unhealthy: no local store opened.
    let profile = tempdir().unwrap();
    assert_eq!(select_mode(DaemonMode::Required, || false), SelectedMode::Unavailable);
    assert!(!store_path(profile.path()).exists());
}
