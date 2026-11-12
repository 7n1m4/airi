// SPDX-License-Identifier: GPL-3.0-or-later
//! Wake/suspend facts for the morning briefing (pure logic, no bus).
//!
//! Semantics (deliberately simple and honest):
//!
//! * `last_suspend_ms` — last `PrepareForSleep(true)` we observed, epoch ms;
//!   `0` when never since start. Informational only.
//! * `last_wake_ms` — last `PrepareForSleep(false)` we observed, epoch ms;
//!   `0` when never since start.
//! * `units_failed_since_wake` — raw count of failed `JobRemoved` signals
//!   observed since the last wake. Consecutive duplicate *list* entries are
//!   skipped, but the counter always counts raw failures.
//! * `recent_failed_units` — the last 3 unit names that failed since the
//!   last wake, newest first. Consecutive duplicates are skipped (a unit
//!   that fails five times in a row occupies one slot); non-consecutive
//!   duplicates are kept. Cap 3.
//!
//! Reset rule: **wake resets.** `PrepareForSleep(false)` zeroes the counter
//! and clears the list. `PrepareForSleep(true)` does not reset anything —
//! "since the last wake" is the one honest window we can offer; the briefing
//! wants "what broke since you left", and sleep itself carries no failure
//! signal the user cares about. Failures while the machine is awake
//! accumulate across arbitrary uptime until the next wake.
//!
//! Ephemeral by design: all four facts live in memory only, restart-zeroed.
//! Nothing here is persisted, and that is the honest contract — after a
//! daemon restart we simply do not know, so we report 0/empty.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WakeFacts {
    pub last_suspend_ms: u64,
    pub last_wake_ms: u64,
    pub units_failed_since_wake: u64,
    pub recent_failed_units: Vec<String>,
}

impl Default for WakeFacts {
    fn default() -> Self {
        Self::new()
    }
}

impl WakeFacts {
    pub fn new() -> Self {
        WakeFacts {
            last_suspend_ms: 0,
            last_wake_ms: 0,
            units_failed_since_wake: 0,
            recent_failed_units: Vec::new(),
        }
    }

    /// `PrepareForSleep(true)` observed at `now_ms`. Records the suspend
    /// instant; does **not** reset the failure window (see module docs).
    pub fn on_suspend(&mut self, now_ms: u64) {
        self.last_suspend_ms = now_ms;
    }

    /// `PrepareForSleep(false)` observed at `now_ms`. Records the wake
    /// instant and resets the since-wake failure window.
    pub fn on_wake(&mut self, now_ms: u64) {
        self.last_wake_ms = now_ms;
        self.units_failed_since_wake = 0;
        self.recent_failed_units.clear();
    }

    /// Record one failed unit at wake+time. Always bumps the raw counter;
    /// the list is deduped consecutively and capped at 3 (newest first).
    pub fn on_unit_failure(&mut self, unit: String) {
        self.units_failed_since_wake += 1;
        if self.recent_failed_units.first() == Some(&unit) {
            return;
        }
        self.recent_failed_units.insert(0, unit);
        self.recent_failed_units.truncate(3);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_zeroed() {
        let f = WakeFacts::new();
        assert_eq!(f.last_suspend_ms, 0);
        assert_eq!(f.last_wake_ms, 0);
        assert_eq!(f.units_failed_since_wake, 0);
        assert!(f.recent_failed_units.is_empty());
    }

    #[test]
    fn synthesized_sleep_wake_sequence_resets_on_wake() {
        let mut f = WakeFacts::new();
        f.on_wake(1_000);
        f.on_unit_failure("alpha.service".to_string());
        f.on_unit_failure("beta.service".to_string());
        assert_eq!(f.units_failed_since_wake, 2);

        // Sleep is recorded but is not a reset point.
        f.on_suspend(5_000);
        assert_eq!(f.last_suspend_ms, 5_000);
        assert_eq!(f.units_failed_since_wake, 2);
        assert_eq!(f.recent_failed_units, vec!["beta.service", "alpha.service"]);

        // Wake resets the window and stats its own instant.
        f.on_wake(9_000);
        assert_eq!(f.last_wake_ms, 9_000);
        assert_eq!(f.units_failed_since_wake, 0);
        assert!(f.recent_failed_units.is_empty());

        // And the window accumulates afresh after the wake.
        f.on_unit_failure("gamma.service".to_string());
        assert_eq!(f.units_failed_since_wake, 1);
        assert_eq!(f.recent_failed_units, vec!["gamma.service"]);
    }

    #[test]
    fn counter_is_raw_even_when_list_dedups() {
        let mut f = WakeFacts::new();
        for _ in 0..5 {
            f.on_unit_failure("flaky.service".to_string());
        }
        assert_eq!(f.units_failed_since_wake, 5);
        assert_eq!(f.recent_failed_units, vec!["flaky.service"]);
    }

    #[test]
    fn list_is_newest_first_capped_at_three() {
        let mut f = WakeFacts::new();
        for name in ["a.service", "b.service", "c.service", "d.service"] {
            f.on_unit_failure(name.to_string());
        }
        assert_eq!(
            f.recent_failed_units,
            vec![
                "d.service".to_string(),
                "c.service".to_string(),
                "b.service".to_string()
            ]
        );
        assert_eq!(f.units_failed_since_wake, 4);
    }

    #[test]
    fn consecutive_duplicates_skipped_non_consecutive_kept() {
        let mut f = WakeFacts::new();
        for name in ["a.service", "a.service", "b.service", "a.service"] {
            f.on_unit_failure(name.to_string());
        }
        assert_eq!(
            f.recent_failed_units,
            vec![
                "a.service".to_string(),
                "b.service".to_string(),
                "a.service".to_string()
            ]
        );
        assert_eq!(f.units_failed_since_wake, 4);
    }
}
