// SPDX-License-Identifier: GPL-3.0-or-later
//! One module per T0 source plus the registry (match-rule table).
//!
//! Every parser takes a raw `dbus::Message` and returns a metadata verb.
//! All bus input is untrusted: parsers re-verify interface/member/arg0 and
//! never index without checks. Unknown payloads yield `None` — the daemon
//! drops what it does not understand, it never guesses.

pub mod mpris;
pub mod network;
pub mod upower;

pub mod logind;
pub mod screensaver;

use dbus::Message;

use crate::state::Source;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bus {
    Session,
    System,
}

/// Where a match rule should be installed.
pub const MATCH_RULES: &[(Source, Bus, &str)] = &[
    // 1. MPRIS playback (session)
    (Source::Media, Bus::Session, mpris::MATCH_RULE),
    // 2. Screen-lock (session): freedesktop + GNOME; KDE opportunistic
    (Source::Lock, Bus::Session, screensaver::RULE_FREEDESKTOP),
    (Source::Lock, Bus::Session, screensaver::RULE_GNOME),
    (Source::Lock, Bus::Session, screensaver::RULE_KDE),
    // 3. logind prepare-for-sleep (system)
    (Source::Sleep, Bus::System, logind::MATCH_RULE),
    // 4. NetworkManager state (system)
    (Source::Network, Bus::System, network::MATCH_RULE),
    // 5. UPower on-battery (system)
    (Source::Power, Bus::System, upower::MATCH_RULE),
];

/// A parsed, metadata-only observation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Observed {
    pub source: Source,
    /// Metadata verb for ring/audit, e.g. `media: Playing`. Detail-free —
    /// raw property payloads beyond the verb never enter the event text.
    pub text: String,
    /// For lock/sleep sources: the lockdown state change this event carries.
    pub lockdown: Option<LockdownChange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockdownChange {
    Lock,
    Unlock,
    Sleep,
    Wake,
}

/// Dispatch a signal to the per-source parser. `None` = not ours / not of
/// interest / malformed — caller drops silently.
pub fn parse_signal(bus: Bus, msg: &Message) -> Option<Observed> {
    match bus {
        Bus::Session => {
            if let Some(o) = mpris::parse(msg) {
                return Some(o);
            }
            screensaver::parse(msg)
        }
        Bus::System => {
            if let Some(o) = logind::parse(msg) {
                return Some(o);
            }
            if let Some(o) = network::parse(msg) {
                return Some(o);
            }
            upower::parse(msg)
        }
    }
}
