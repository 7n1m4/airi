// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::PathBuf;

use airi_daemon::core::CoreService;
use airi_slint::daemon_mode::{DaemonMode, SelectedMode, select_mode};
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
