// SPDX-License-Identifier: GPL-3.0-or-later
//! Single-instance guard backed by a named lock file.
//!
//! The lock lives at `<dir>/airi-slint.lock` and contains the owning process id.
//! [`acquire`] is intended to be called once at startup with the resolved
//! data directory; see `main.rs` for the directory policy (explicit
//! `--profile` → inside the profile, `--smoke` without `--profile` → inside
//! the throwaway temp profile, otherwise the platform data dir
//! `dirs::data_dir()/airi-slint`).
//!
//! Semantics (best effort, documented rather than enforced by the OS):
//!
//! - If the lock exists and its pid is alive, [`acquire`] returns
//!   [`SingleInstanceError::AlreadyRunning`]. The caller prints a message and
//!   exits 0. (Focusing the running instance is deliberately out of scope.)
//! - If the lock is missing, unreadable, or its pid is dead, the lock is
//!   (re)created with the current pid.
//! - If `/proc` is unavailable (non-Linux or a restricted container), the
//!   liveness probe fails safe: a pid that cannot be *proven* dead is
//!   treated as alive, so a second instance never starts. Remove a stale
//!   `airi-slint.lock` manually when the platform offers no process table.
//! - Unparseable or empty lock contents fail safe the same way
//!   ([`SingleInstanceError::AlreadyRunning`] with pid 0). The error message
//!   tells the user the lock path so it can be removed by hand.
//! - The pid-liveness check is inherently racy (pid reuse); it is a
//!   pragmatic guard, not a mutual-exclusion primitive.
//!
//! Pid 1 / zombie note: `/proc/<pid>` exists for zombies (they are not
//! reaped by us), which can keep a lock "held" by a zombie child until the
//! reaper collects it. This matches `kill(pid, 0)` semantics.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// File name of the lock inside the data directory.
pub const LOCK_FILE_NAME: &str = "airi-slint.lock";

/// RAII guard for the single-instance lock.
///
/// Removing the guard deletes the lock file (best effort). The file is not
/// kept open; if the process dies abruptly (panic abort, SIGKILL, power
/// loss) the stale lock is detected on the next launch via the pid probe.
#[derive(Debug)]
pub struct LockGuard {
    path: PathBuf,
}

impl LockGuard {
    /// Path of the lock file this guard owns.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Failure modes for [`acquire`].
#[derive(Debug, thiserror::Error)]
pub enum SingleInstanceError {
    /// Another instance appears to be running (or its lock cannot be
    /// disproven). `pid` is 0 when the lock contents are unreadable or not
    /// a pid; see module docs.
    #[error("another instance is already running (pid {pid}, lock {lock_path}); if this is wrong, remove the lock file")]
    AlreadyRunning {
        /// Pid recorded in the lock file (0 when unparseable).
        pid: u32,
        /// Path of the lock file.
        lock_path: PathBuf,
    },
    /// Filesystem error while creating the data dir or writing the lock.
    #[error("failed to acquire instance lock at {lock_path}: {source}")]
    Io {
        /// Path of the lock file.
        lock_path: PathBuf,
        /// Underlying I/O error.
        #[source]
        source: std::io::Error,
    },
}

/// Resolve the default lock directory (platform data dir).
///
/// `<dirs::data_dir()>/airi-slint`, falling back to the temp dir when the
/// platform data dir cannot be determined. Explicit `--profile` / `--smoke`
/// runs do not use this; see `main.rs`.
#[must_use]
pub fn default_lock_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("airi-slint")
}

/// Acquire the single-instance lock inside `dir` (created if missing).
///
/// On success the lock file is written with this process's pid and a guard
/// is returned; dropping the guard removes the file.
///
/// # Errors
///
/// - [`SingleInstanceError::AlreadyRunning`] when a live (or unprobeable)
///   pid already holds the lock.
/// - [`SingleInstanceError::Io`] on filesystem failures.
pub fn acquire(dir: &Path) -> Result<LockGuard, SingleInstanceError> {
    fs::create_dir_all(dir).map_err(|source| SingleInstanceError::Io {
        lock_path: dir.join(LOCK_FILE_NAME),
        source,
    })?;
    let lock_path = dir.join(LOCK_FILE_NAME);

    // Two creation attempts: one after removing a stale lock.
    for attempt in 0..2 {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                writeln!(file, "{}", std::process::id()).map_err(|source| {
                    SingleInstanceError::Io {
                        lock_path: lock_path.clone(),
                        source,
                    }
                })?;
                return Ok(LockGuard { path: lock_path });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                match probe_lock(&lock_path) {
                    Probe::HeldBy(pid) => {
                        return Err(SingleInstanceError::AlreadyRunning { pid, lock_path });
                    }
                    Probe::Stale => {
                        // Best effort: if removal fails the next open will
                        // simply see the stale lock again and report it.
                        let _ = fs::remove_file(&lock_path);
                        if attempt == 1 {
                            return Err(SingleInstanceError::Io {
                                lock_path,
                                source: std::io::Error::other("stale lock could not be cleared"),
                            });
                        }
                    }
                }
            }
            Err(source) => {
                return Err(SingleInstanceError::Io { lock_path, source });
            }
        }
    }
    unreachable!("acquire loop ends via return")
}

enum Probe {
    /// The lock is held (fail safe, or the recorded pid is alive).
    HeldBy(u32),
    /// The recorded pid is provably dead (or `/proc/<pid>` vanished).
    Stale,
}

/// Probe an existing lock file without mutating it.
fn probe_lock(lock_path: &Path) -> Probe {
    let contents = match fs::read_to_string(lock_path) {
        Ok(c) => c,
        // Unreadable lock: cannot disprove → fail safe.
        Err(_) => return Probe::HeldBy(0),
    };
    let pid: u32 = match contents.trim().parse() {
        Ok(p) => p,
        // Unparseable lock: cannot disprove → fail safe.
        Err(_) => return Probe::HeldBy(0),
    };
    if pid_alive(pid) {
        Probe::HeldBy(pid)
    } else {
        Probe::Stale
    }
}

/// Liveness probe for `pid`.
///
/// Uses `/proc` (Linux). If `/proc` is not available the answer fails safe
/// to `true` (assume alive) — see module docs.
fn pid_alive(pid: u32) -> bool {
    const PROC_ROOT: &str = "/proc";
    if !Path::new(PROC_ROOT).is_dir() {
        // Fail safe: without a process table we cannot prove the holder
        // dead, so we must not start a second instance.
        return true;
    }
    Path::new(PROC_ROOT).join(pid.to_string()).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_fresh_dir_writes_current_pid() {
        let dir = tempfile::tempdir().unwrap();
        let guard = acquire(dir.path()).unwrap();
        assert!(guard.path().exists());
        let contents = fs::read_to_string(guard.path()).unwrap();
        assert_eq!(contents.trim(), std::process::id().to_string());
    }

    #[test]
    fn second_acquire_fails_while_guard_held() {
        let dir = tempfile::tempdir().unwrap();
        let guard = acquire(dir.path()).unwrap();
        let second = acquire(dir.path());
        match second {
            Err(SingleInstanceError::AlreadyRunning { pid, lock_path }) => {
                assert_eq!(pid, std::process::id());
                assert_eq!(lock_path, guard.path());
            }
            other => panic!("expected AlreadyRunning, got {other:?}"),
        }
    }

    #[test]
    fn stale_lock_with_dead_pid_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let lock = dir.path().join(LOCK_FILE_NAME);
        // A pid that (almost certainly) does not exist. Skip the probe on
        // platforms without /proc (there is nothing to verify dead).
        if !Path::new("/proc").is_dir() {
            return;
        }
        fs::write(&lock, "99999999\n").unwrap();
        let guard = acquire(dir.path()).unwrap();
        let contents = fs::read_to_string(guard.path()).unwrap();
        assert_eq!(contents.trim(), std::process::id().to_string());
    }

    #[test]
    fn unparseable_lock_fails_safe() {
        let dir = tempfile::tempdir().unwrap();
        let lock = dir.path().join(LOCK_FILE_NAME);
        fs::write(&lock, "not-a-pid").unwrap();
        match acquire(dir.path()) {
            Err(SingleInstanceError::AlreadyRunning { pid, .. }) => assert_eq!(pid, 0),
            other => panic!("expected AlreadyRunning, got {other:?}"),
        }
    }

    #[test]
    fn drop_releases_the_lock() {
        let dir = tempfile::tempdir().unwrap();
        let lock = dir.path().join(LOCK_FILE_NAME);
        {
            let _guard = acquire(dir.path()).unwrap();
            assert!(lock.exists());
        }
        assert!(!lock.exists(), "drop must remove the lock file");
        // Re-acquire succeeds after release.
        let guard = acquire(dir.path()).unwrap();
        assert!(guard.path().exists());
    }
}
