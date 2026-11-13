// SPDX-License-Identifier: GPL-3.0-or-later
//! The pause / arm / lockdown state machine (pure logic, no bus).
//!
//! Model: three independent switches, evaluated in one place.
//!
//! * per-source `armed` flags — flipped by `SetSource`, never touched by
//!   pause/lockdown;
//! * `user_paused` — the kill switch (`Pause(true)`);
//! * `lockdown_reasons` — the set of active lockdown reasons (screen locked,
//!   machine asleep). Lockdown is in effect while **any** reason is present;
//!   `lockdown_end(reason)` removes only that reason.
//!
//! Effective armed (`effective_armed`) = `armed[source] && !user_paused && no lockdown reasons active`.
//!
//! Precedence rule (spec §F rail 2 + lockdown coverage, exact):
//! lockdown clearing (unlock / wake) re-arms the T0 sources automatically
//! **only when the user has not explicitly paused**. If `user_paused`, the
//! sensors stay disarmed — the user's kill switch always wins over the
//! automatic re-arm. Per-source `armed=false` survives both transitions.

#[cfg(test)]
pub const SOURCE_NAMES: [&str; 7] = [
    "sleep", "lock", "media", "network", "power", "screen", "units",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Source {
    Sleep,
    Lock,
    Media,
    Network,
    Power,
    Screen,
    Units,
}

impl Source {
    pub const ALL: [Source; 7] = [
        Source::Sleep,
        Source::Lock,
        Source::Media,
        Source::Network,
        Source::Power,
        Source::Screen,
        Source::Units,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Source::Sleep => "sleep",
            Source::Lock => "lock",
            Source::Media => "media",
            Source::Network => "network",
            Source::Power => "power",
            Source::Screen => "screen",
            Source::Units => "units",
        }
    }

    pub fn from_name(name: &str) -> Option<Source> {
        match name {
            "sleep" => Some(Source::Sleep),
            "lock" => Some(Source::Lock),
            "media" => Some(Source::Media),
            "network" => Some(Source::Network),
            "power" => Some(Source::Power),
            "screen" => Some(Source::Screen),
            "units" => Some(Source::Units),
            _ => None,
        }
    }

    fn index(self) -> usize {
        match self {
            Source::Sleep => 0,
            Source::Lock => 1,
            Source::Media => 2,
            Source::Network => 3,
            Source::Power => 4,
            Source::Screen => 5,
            Source::Units => 6,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockdownReason {
    Locked,
    Sleep,
}

#[derive(Debug)]
pub struct Awareness {
    armed: [bool; 7],
    user_paused: bool,
    /// Active lockdown reasons (locked / asleep). Lockdown is effective
    /// while the set is non-empty; at most one entry per reason.
    lockdown_reasons: Vec<LockdownReason>,
}

impl Default for Awareness {
    fn default() -> Self {
        Self::new()
    }
}

impl Awareness {
    pub fn new() -> Self {
        Awareness {
            armed: [true; 7],
            user_paused: false,
            lockdown_reasons: Vec::new(),
        }
    }

    pub fn effective_armed(&self, source: Source) -> bool {
        self.armed[source.index()] && !self.user_paused && self.lockdown_reasons.is_empty()
    }

    /// Pause(true) kill switch / Pause(false) resume. Returns true if the
    /// flag actually changed.
    pub fn pause(&mut self, paused: bool) -> bool {
        let changed = self.user_paused != paused;
        self.user_paused = paused;
        changed
    }

    pub fn user_paused(&self) -> bool {
        self.user_paused
    }

    /// Flip one source. Returns Err(unknown source) for anything outside the
    /// seven; Ok(true) if the flag changed, Ok(false) if it was already set.
    pub fn set_source(&mut self, source: Source, enabled: bool) -> bool {
        let idx = source.index();
        let changed = self.armed[idx] != enabled;
        self.armed[idx] = enabled;
        changed
    }

    /// Begin lockdown for `reason`. Returns true if this call started
    /// lockdown (i.e. no reason was active before). Re-beginning a reason
    /// that is already active does not restart it.
    pub fn lockdown_begin(&mut self, reason: LockdownReason) -> bool {
        let was_empty = self.lockdown_reasons.is_empty();
        if !self.lockdown_reasons.contains(&reason) {
            self.lockdown_reasons.push(reason);
        }
        was_empty
    }

    /// Clear the lockdown for `reason` (unlock / wake). Removes only that
    /// reason; others survive (sleep(false) must not clear Locked). Returns
    /// true if this call ended lockdown (the last active reason was
    /// removed). Does **not** clear a user pause — the user's kill switch
    /// wins (see module docs).
    pub fn lockdown_end(&mut self, reason: LockdownReason) -> bool {
        let before = self.lockdown_reasons.len();
        self.lockdown_reasons.retain(|&r| r != reason);
        before > 0 && self.lockdown_reasons.is_empty()
    }

    #[cfg(test)]
    pub fn lockdown_active(&self) -> bool {
        !self.lockdown_reasons.is_empty()
    }

    /// `paused` in GetStatus: true when awareness is effectively off,
    /// i.e. user kill switch **or** lockdown.
    pub fn paused(&self) -> bool {
        self.user_paused || !self.lockdown_reasons.is_empty()
    }

    /// `paused_by` in GetStatus: `"user"` | `"lockdown"` | `""`.
    /// User wins the label when both are set — same precedence as the re-arm.
    pub fn paused_by(&self) -> &'static str {
        if self.user_paused {
            "user"
        } else if !self.lockdown_reasons.is_empty() {
            "lockdown"
        } else {
            ""
        }
    }

    /// Sources map for GetStatus, keyed by the T0+a11y source names.
    /// Reflects the per-source `armed` flag (what the user toggled), not the
    /// effective state — the effective state is carried by `paused`.
    pub fn sources_json(&self) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        for s in Source::ALL {
            map.insert(
                s.name().to_string(),
                serde_json::Value::Bool(self.armed[s.index()]),
            );
        }
        serde_json::Value::Object(map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_state_is_all_armed_not_paused() {
        let a = Awareness::new();
        assert!(!a.paused());
        assert_eq!(a.paused_by(), "");
        for s in Source::ALL {
            assert!(a.effective_armed(s));
        }
    }

    #[test]
    fn set_source_toggles_and_unknown_names_are_rejected() {
        let mut a = Awareness::new();
        assert!(Source::from_name("media").is_some());
        assert!(Source::from_name("brightness").is_none());
        assert!(a.set_source(Source::Media, false));
        assert!(!a.effective_armed(Source::Media));
        assert!(a.effective_armed(Source::Network));
        // Idempotent: second identical set reports no change.
        assert!(!a.set_source(Source::Media, false));
        assert!(a.set_source(Source::Media, true));
        assert!(a.effective_armed(Source::Media));
    }

    #[test]
    fn pause_disarms_everything_and_resume_restores() {
        let mut a = Awareness::new();
        a.set_source(Source::Media, false);
        assert!(a.pause(true));
        for s in Source::ALL {
            assert!(
                !a.effective_armed(s),
                "{} should be disarmed by pause",
                s.name()
            );
        }
        assert!(a.paused());
        assert_eq!(a.paused_by(), "user");
        assert!(a.pause(false));
        assert!(a.effective_armed(Source::Network));
        // The per-source user choice survives the pause cycle.
        assert!(!a.effective_armed(Source::Media));
        assert!(!a.paused());
    }

    #[test]
    fn unlock_rearm_respects_explicit_user_pause() {
        let mut a = Awareness::new();
        // Lock begins (no user pause): disarmed.
        assert!(a.lockdown_begin(LockdownReason::Locked));
        assert!(!a.effective_armed(Source::Sleep));
        assert!(a.paused());
        assert_eq!(a.paused_by(), "lockdown");
        // Unlock clears lockdown: automatic re-arm, because user never paused.
        assert!(a.lockdown_end(LockdownReason::Locked));
        assert!(a.effective_armed(Source::Sleep));
        assert!(!a.paused());

        // Now the user pauses explicitly, then a lock/unlock cycle happens.
        a.pause(true);
        a.lockdown_begin(LockdownReason::Locked);
        a.lockdown_end(LockdownReason::Locked);
        assert!(
            !a.effective_armed(Source::Sleep),
            "user pause must win over unlock re-arm"
        );
        assert!(a.paused());
        assert_eq!(a.paused_by(), "user");
        // Pause(false) after unlock does resume (user changed their mind).
        a.pause(false);
        assert!(a.effective_armed(Source::Sleep));
    }

    #[test]
    fn sleep_lockdown_same_precedence_rules() {
        let mut a = Awareness::new();
        a.lockdown_begin(LockdownReason::Sleep);
        assert_eq!(a.paused_by(), "lockdown");
        assert!(!a.lockdown_begin(LockdownReason::Locked)); // re-begin does not restart it
        assert!(a.lockdown_active());
        // Ending the sleep reason alone leaves the lock reason active.
        assert!(!a.lockdown_end(LockdownReason::Sleep));
        assert!(a.lockdown_active());
        assert!(a.lockdown_end(LockdownReason::Locked));
        assert!(!a.lockdown_active());
        assert!(!a.lockdown_end(LockdownReason::Locked)); // second clear reports no lockdown
    }

    #[test]
    fn sleep_then_lock_then_wake_keeps_lockdown_active() {
        let mut a = Awareness::new();
        assert!(a.lockdown_begin(LockdownReason::Sleep));
        assert!(!a.lockdown_begin(LockdownReason::Locked)); // already in lockdown
        // Wake (sleep false) must not clear the lock reason.
        assert!(!a.lockdown_end(LockdownReason::Sleep));
        assert!(a.lockdown_active());
        assert!(!a.effective_armed(Source::Media));
        assert!(a.paused());
        // Unlock then fully clears it.
        assert!(a.lockdown_end(LockdownReason::Locked));
        assert!(!a.lockdown_active());
        assert!(a.effective_armed(Source::Media));
    }

    #[test]
    fn per_source_disarm_survives_lockdown_cycle() {
        let mut a = Awareness::new();
        a.set_source(Source::Power, false);
        a.lockdown_begin(LockdownReason::Locked);
        a.lockdown_end(LockdownReason::Locked);
        assert!(!a.effective_armed(Source::Power));
        assert!(a.effective_armed(Source::Media));
    }

    #[test]
    fn units_source_toggles_and_survives_lockdown_and_pause_cycles() {
        let mut a = Awareness::new();
        assert!(Source::from_name("units").is_some());
        assert!(Source::from_name("unitss").is_none());
        assert!(a.effective_armed(Source::Units));
        // Toggle off: disarm is honest, others untouched.
        assert!(a.set_source(Source::Units, false));
        assert!(!a.effective_armed(Source::Units));
        assert!(a.effective_armed(Source::Power));
        assert!(!a.set_source(Source::Units, false));
        // Re-arm, then lockdown (sleep) disarms, wake re-arms.
        assert!(a.set_source(Source::Units, true));
        a.lockdown_begin(LockdownReason::Sleep);
        assert!(!a.effective_armed(Source::Units));
        assert!(a.lockdown_end(LockdownReason::Sleep));
        assert!(a.effective_armed(Source::Units));
        // Pause (kill switch) disarms; unlock/wake must not override it.
        a.pause(true);
        assert!(!a.effective_armed(Source::Units));
        a.lockdown_begin(LockdownReason::Locked);
        a.lockdown_end(LockdownReason::Locked);
        assert!(!a.effective_armed(Source::Units));
        a.pause(false);
        assert!(a.effective_armed(Source::Units));
    }

    #[test]
    fn sources_json_shape() {
        let a = Awareness::new();
        let v = a.sources_json();
        for name in SOURCE_NAMES {
            assert_eq!(v[name], serde_json::json!(true), "missing key {name}");
        }
    }
}
