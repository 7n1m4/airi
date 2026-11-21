// SPDX-License-Identifier: GPL-3.0-or-later
//! Source 7 — systemd1 `JobRemoved` on the **system** bus (read-only).
//!
//! `JobRemoved(id: u32, unit: s, jobType: s, result: s)` is emitted for
//! *every* job systemd runs — starts, stops, reloads, timeouts. Listening is
//! read-only; we never start/stop/reload/reset any unit (actuation is
//! T2/polkit territory, always interactive, never from this daemon).
//!
//! Filter semantics:
//! - `result == "done"` → success. Counted (per-unit debounce in the caller)
//!   but **never** written to ring or audit — noise would drown the signal.
//! - `result != "done"` → failure. Always lands in ring + audit as
//!   `unit: <unit> failed (<result>)`, even under debounce pressure.
//! - Malformed payload (wrong member/interface, missing/typed-wrong args,
//!   empty unit or result) → dropped silently. The daemon never guesses.
//!
//! Redaction is applied uniformly to the unit name and the result string
//! before they leave this module — unit names are public-ish API surface and
//! cannot contain secrets, but the redactor is cheap and always-on.

use dbus::Message;

use crate::redact::redact;

pub const MATCH_RULE: &str =
    "type='signal',interface='org.freedesktop.systemd1.Manager',member='JobRemoved'";

const SYSTEMD1_INTERFACE: &str = "org.freedesktop.systemd1.Manager";
const SYSTEMD1_MEMBER: &str = "JobRemoved";

/// A parsed, redacted `JobRemoved`. Outcome-bearing so the caller decides
/// ring/audit vs. count-only without re-parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnitJob {
    /// `result == "done"` — count, don't audit.
    Done { unit: String },
    /// `result != "done"` — always ring + audit.
    Failed { unit: String, result: String },
}

impl UnitJob {
    /// The redacted unit name (public API-ish; redactor applied uniformly).
    pub fn unit(&self) -> &str {
        match self {
            UnitJob::Done { unit } => unit,
            UnitJob::Failed { unit, .. } => unit,
        }
    }

    /// Ring/audit text for a failure, `None` for `done`.
    pub fn event_text(&self) -> Option<String> {
        match self {
            UnitJob::Done { .. } => None,
            UnitJob::Failed { unit, result } => Some(format!("unit: {unit} failed ({result})")),
        }
    }
}

/// Parse a `JobRemoved` signal. `None` = not ours / not of interest /
/// malformed — the caller drops silently. All bus input is untrusted.
pub fn parse(msg: &Message) -> Option<UnitJob> {
    if msg.msg_type() != dbus::MessageType::Signal {
        return None;
    }
    if msg.interface().as_deref() != Some(SYSTEMD1_INTERFACE) {
        return None;
    }
    if msg.member().as_deref() != Some(SYSTEMD1_MEMBER) {
        return None;
    }
    let mut it = msg.iter_init();
    let _id: u32 = it.read().ok()?;
    let unit: String = it.read().ok()?;
    let _job_type: String = it.read().ok()?;
    let result: String = it.read().ok()?;
    if unit.is_empty() || result.is_empty() {
        // An empty unit or result tells us nothing honest; drop it.
        return None;
    }
    let unit = redact(&unit);
    let result = redact(&result);
    if result == "done" {
        Some(UnitJob::Done { unit })
    } else {
        Some(UnitJob::Failed { unit, result })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job_removed(id: u32, unit: &str, job_type: &str, result: &str) -> Message {
        let mut msg = Message::new_signal(
            "/org/freedesktop/systemd1",
            SYSTEMD1_INTERFACE,
            SYSTEMD1_MEMBER,
        )
        .expect("signal");
        msg.append_all((
            id,
            unit.to_string(),
            job_type.to_string(),
            result.to_string(),
        ));
        msg
    }

    #[test]
    fn failure_parses_to_event_text() {
        let job = parse(&job_removed(42, "nginx.service", "start", "failed")).expect("parse");
        assert_eq!(
            job,
            UnitJob::Failed {
                unit: "nginx.service".to_string(),
                result: "failed".to_string(),
            }
        );
        assert_eq!(
            job.event_text().as_deref(),
            Some("unit: nginx.service failed (failed)")
        );
        assert_eq!(job.unit(), "nginx.service");
    }

    #[test]
    fn done_is_counted_but_never_an_event() {
        let job = parse(&job_removed(7, "backup.service", "start", "done")).expect("parse");
        assert_eq!(
            job,
            UnitJob::Done {
                unit: "backup.service".to_string(),
            }
        );
        assert_eq!(job.event_text(), None);
    }

    #[test]
    fn non_done_results_are_all_failures() {
        for result in ["failed", "timeout", "dependency", "canceled", "skipped"] {
            let job = parse(&job_removed(1, "u.service", "start", result)).expect("parse");
            assert!(matches!(job, UnitJob::Failed { .. }), "result {result}");
        }
    }

    #[test]
    fn malformed_drops_silently() {
        // Wrong interface.
        let mut wrong = Message::new_signal(
            "/org/freedesktop/systemd1",
            "org.example.Nope",
            "JobRemoved",
        )
        .expect("signal");
        wrong.append_all((
            1u32,
            "u.service".to_string(),
            "start".to_string(),
            "done".to_string(),
        ));
        assert!(parse(&wrong).is_none());
        // Wrong member.
        let mut wrong =
            Message::new_signal("/org/freedesktop/systemd1", SYSTEMD1_INTERFACE, "JobNew")
                .expect("signal");
        wrong.append_all((
            1u32,
            "u.service".to_string(),
            "start".to_string(),
            "done".to_string(),
        ));
        assert!(parse(&wrong).is_none());
        // Missing trailing arg.
        let mut short = Message::new_signal(
            "/org/freedesktop/systemd1",
            SYSTEMD1_INTERFACE,
            SYSTEMD1_MEMBER,
        )
        .expect("signal");
        short.append_all((1u32, "u.service".to_string()));
        assert!(parse(&short).is_none());
        // Empty unit / empty result.
        assert!(parse(&job_removed(1, "", "start", "done")).is_none());
        assert!(parse(&job_removed(1, "u.service", "start", "")).is_none());
        // Not a signal at all.
        let call = Message::method_call(
            &dbus::strings::BusName::new("org.example.Caller").unwrap(),
            &dbus::strings::Path::new("/org/freedesktop/systemd1").unwrap(),
            &dbus::strings::Interface::new(SYSTEMD1_INTERFACE).unwrap(),
            &dbus::strings::Member::new(SYSTEMD1_MEMBER).unwrap(),
        );
        assert!(parse(&call).is_none());
    }

    #[test]
    fn redactor_is_applied_uniformly() {
        let job =
            parse(&job_removed(1, "sk-ant-secret.service", "start", "failed")).expect("parse");
        assert_eq!(
            job.event_text().as_deref(),
            Some("unit: *** failed (failed)")
        );
    }
}
