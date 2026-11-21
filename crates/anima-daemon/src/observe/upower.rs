// SPDX-License-Identifier: GPL-3.0-or-later
//! Source 5 — UPower `OnBattery` via `PropertiesChanged` on the system bus.
//! No lid handling: there is no portable lid signal, and we do not fake one.

use dbus::{arg::PropMap, Message};

use super::Observed;
use crate::state::Source;

pub const MATCH_RULE: &str = "type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',sender='org.freedesktop.UPower',arg0='org.freedesktop.UPower'";

const UPOWER_INTERFACE: &str = "org.freedesktop.UPower";

pub fn parse(msg: &Message) -> Option<Observed> {
    if msg.msg_type() != dbus::MessageType::Signal {
        return None;
    }
    if msg.interface().as_deref() != Some("org.freedesktop.DBus.Properties") {
        return None;
    }
    if msg.member().as_deref() != Some("PropertiesChanged") {
        return None;
    }
    if let Some(sender) = msg.sender() {
        if &*sender != "org.freedesktop.UPower" {
            return None;
        }
    }
    let mut it = msg.iter_init();
    let arg0: String = it.read().ok()?;
    if arg0 != UPOWER_INTERFACE {
        return None;
    }
    let props: PropMap = it.read().ok()?;
    let on_battery = props.get("OnBattery").and_then(|v| v.0.as_i64())?;
    Some(Observed {
        source: Source::Power,
        text: if on_battery != 0 {
            "power: on battery".to_string()
        } else {
            "power: on AC".to_string()
        },
        lockdown: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use dbus::{arg::Variant, Message};
    use std::collections::HashMap;

    fn on_battery_changed(on_battery: bool) -> Message {
        let mut props: PropMap = HashMap::new();
        props.insert(
            "OnBattery".to_string(),
            Variant(Box::new(on_battery) as Box<dyn dbus::arg::RefArg>),
        );
        let mut msg = Message::new_signal(
            "/org/freedesktop/UPower",
            "org.freedesktop.DBus.Properties",
            "PropertiesChanged",
        )
        .expect("signal");
        msg.append_all((UPOWER_INTERFACE.to_string(), props, Vec::<String>::new()));
        msg
    }

    #[test]
    fn parses_on_battery_and_on_ac() {
        let b = parse(&on_battery_changed(true)).expect("parse");
        assert_eq!(b.text, "power: on battery");
        let a = parse(&on_battery_changed(false)).expect("parse");
        assert_eq!(a.text, "power: on AC");
    }
}
