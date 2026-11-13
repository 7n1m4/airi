// SPDX-License-Identifier: GPL-3.0-or-later
//! Source 3 — logind `PrepareForSleep(b)` on the system bus.
//! true → suspend request (drives lockdown); false → wake.
//! Read-only; no action is ever taken — actuation is T2/polkit territory.

use dbus::Message;

use super::{LockdownChange, Observed};
use crate::state::Source;

pub const MATCH_RULE: &str =
    "type='signal',interface='org.freedesktop.login1.Manager',member='PrepareForSleep',sender='org.freedesktop.login1'";

pub fn parse(msg: &Message) -> Option<Observed> {
    if msg.msg_type() != dbus::MessageType::Signal {
        return None;
    }
    if msg.interface().as_deref() != Some("org.freedesktop.login1.Manager") {
        return None;
    }
    if msg.member().as_deref() != Some("PrepareForSleep") {
        return None;
    }
    let mut it = msg.iter_init();
    let suspending: bool = it.read().ok()?;
    Some(Observed {
        source: Source::Sleep,
        text: if suspending {
            "sleep: suspending".to_string()
        } else {
            "power: wake".to_string()
        },
        lockdown: Some(if suspending {
            LockdownChange::Sleep
        } else {
            LockdownChange::Wake
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use dbus::Message;

    fn prepare_for_sleep(active: bool) -> Message {
        let mut msg = Message::new_signal(
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
            "PrepareForSleep",
        )
        .expect("signal");
        msg.append_all((active,));
        msg
    }

    #[test]
    fn parses_suspend_and_wake() {
        let s = parse(&prepare_for_sleep(true)).expect("suspend");
        assert_eq!(s.text, "sleep: suspending");
        assert_eq!(s.lockdown, Some(LockdownChange::Sleep));
        let w = parse(&prepare_for_sleep(false)).expect("wake");
        assert_eq!(w.text, "power: wake");
        assert_eq!(w.lockdown, Some(LockdownChange::Wake));
    }
}
