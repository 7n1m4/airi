// SPDX-License-Identifier: GPL-3.0-or-later
//! Source 2 — screen-lock via DE screensaver `ActiveChanged(b)`.
//!
//! Both the freedesktop rule (KDE) and the GNOME rule are installed when the
//! session bus allows them; the KDE path (`org.kde.ScreenSaver`) is tried
//! opportunistically and reported by `--selftest`. If none of the three is
//! present on the bus, the source simply never fires — best-effort, no crash
//! (spec: "if a bus has neither, best-effort note in status, no crash").

use dbus::Message;

use super::{LockdownChange, Observed};
use crate::state::Source;

pub const RULE_FREEDESKTOP: &str =
    "type='signal',interface='org.freedesktop.ScreenSaver',member='ActiveChanged'";
pub const RULE_GNOME: &str =
    "type='signal',interface='org.gnome.ScreenSaver',member='ActiveChanged'";
pub const RULE_KDE: &str = "type='signal',interface='org.kde.ScreenSaver',member='ActiveChanged'";

const KNOWN_INTERFACES: [&str; 3] = [
    "org.freedesktop.ScreenSaver",
    "org.gnome.ScreenSaver",
    "org.kde.ScreenSaver",
];

pub fn parse(msg: &Message) -> Option<Observed> {
    if msg.msg_type() != dbus::MessageType::Signal {
        return None;
    }
    let iface = msg.interface()?;
    if !KNOWN_INTERFACES.iter().any(|k| *k == &*iface) {
        return None;
    }
    if msg.member().as_deref() != Some("ActiveChanged") {
        return None;
    }
    let mut it = msg.iter_init();
    let active: bool = it.read().ok()?;
    Some(Observed {
        source: Source::Lock,
        text: if active {
            "lock: locked".to_string()
        } else {
            "lock: unlocked".to_string()
        },
        lockdown: Some(if active {
            LockdownChange::Lock
        } else {
            LockdownChange::Unlock
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use dbus::Message;

    fn active_changed(iface: &str, active: bool) -> Message {
        let mut msg = Message::new_signal("/org/freedesktop/ScreenSaver", iface, "ActiveChanged")
            .expect("signal");
        msg.append_all((active,));
        msg
    }

    #[test]
    fn parses_lock_and_unlock_on_all_known_buses() {
        for iface in KNOWN_INTERFACES {
            let locked = parse(&active_changed(iface, true)).expect("lock");
            assert_eq!(locked.text, "lock: locked");
            assert_eq!(locked.lockdown, Some(LockdownChange::Lock));
            let unlocked = parse(&active_changed(iface, false)).expect("unlock");
            assert_eq!(unlocked.text, "lock: unlocked");
            assert_eq!(unlocked.lockdown, Some(LockdownChange::Unlock));
        }
    }

    #[test]
    fn rejects_unknown_interface() {
        assert!(parse(&active_changed("com.example.ScreenSaver", true)).is_none());
    }
}
