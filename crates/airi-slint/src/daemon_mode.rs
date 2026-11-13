// SPDX-License-Identifier: GPL-3.0-or-later
//! Daemon-mode health probe and mode selection for `airi-slint`.
//!
//! Implements ADR decision 3 from `docs/design-daemon-core-rpc.md`: mode
//! selection is configuration (`auto`/`disabled`/`required`) plus a health
//! probe, never daemon voting. The selection is pure so it can be tested
//! without a real `GatewayClient`.

/// Configured daemon mode for a profile. One mode per profile at startup;
/// ownership must not flip mid-session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonMode {
    /// Probe the daemon; use daemon mode only when healthy, else local fallback.
    Auto,
    /// Local path only; never attempt daemon core RPC.
    Disabled,
    /// Probe the daemon; stay unavailable for core work if unhealthy.
    Required,
}

// Default is `Disabled`: the current local behavior until daemon mode exists.
impl Default for DaemonMode {
    fn default() -> Self {
        Self::Disabled
    }
}

/// Result of mode selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectedMode {
    /// Use the embedded local store/services.
    Local,
    /// Use the daemon as the single store writer.
    Daemon,
    /// Daemon required but unhealthy; no local writer may be opened.
    Unavailable,
}

/// Pure mode selection. `probe` is invoked only when the mode requires it
/// (`Auto` or `Required`); `Disabled` never probes.
pub fn select_mode(configured: DaemonMode, probe: impl Fn() -> bool) -> SelectedMode {
    match configured {
        DaemonMode::Disabled => SelectedMode::Local,
        DaemonMode::Auto => {
            if probe() {
                SelectedMode::Daemon
            } else {
                SelectedMode::Local
            }
        }
        DaemonMode::Required => {
            if probe() {
                SelectedMode::Daemon
            } else {
                SelectedMode::Unavailable
            }
        }
    }
}

/// Convenience entry point for startup: select using the default mode.
pub fn detect(probe: impl Fn() -> bool) -> SelectedMode {
    select_mode(DaemonMode::default(), probe)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn disabled_healthy_is_local_and_never_probes() {
        let called = Cell::new(false);
        let probe = || {
            called.set(true);
            true
        };
        assert_eq!(select_mode(DaemonMode::Disabled, probe), SelectedMode::Local);
        assert!(!called.get(), "Disabled must not probe");
    }

    #[test]
    fn disabled_unhealthy_is_local_and_never_probes() {
        let called = Cell::new(false);
        let probe = || {
            called.set(true);
            false
        };
        assert_eq!(select_mode(DaemonMode::Disabled, probe), SelectedMode::Local);
        assert!(!called.get(), "Disabled must not probe");
    }

    #[test]
    fn auto_healthy_is_daemon() {
        assert_eq!(
            select_mode(DaemonMode::Auto, || true),
            SelectedMode::Daemon
        );
    }

    #[test]
    fn auto_unhealthy_is_local() {
        assert_eq!(
            select_mode(DaemonMode::Auto, || false),
            SelectedMode::Local
        );
    }

    #[test]
    fn required_healthy_is_daemon() {
        assert_eq!(
            select_mode(DaemonMode::Required, || true),
            SelectedMode::Daemon
        );
    }

    #[test]
    fn required_unhealthy_is_unavailable() {
        assert_eq!(
            select_mode(DaemonMode::Required, || false),
            SelectedMode::Unavailable
        );
    }
}