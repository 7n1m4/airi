// SPDX-License-Identifier: GPL-3.0-or-later
//! Source 4 — NetworkManager state via its `PropertiesChanged` on the
//! system bus. `State` (u32): 70 = NM_STATE_CONNECTED_GLOBAL → online;
//! anything else is reported numerically (`network: state <n>`) — honest
//! about what we don't know, no symbolic guessing.

use dbus::{arg::PropMap, Message};

use super::Observed;
use crate::state::Source;

pub const MATCH_RULE: &str = "type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',sender='org.freedesktop.NetworkManager',arg0='org.freedesktop.NetworkManager'";

const NM_INTERFACE: &str = "org.freedesktop.NetworkManager";
const NM_STATE_CONNECTED_GLOBAL: u64 = 70;

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
    // Sender is sender-verified bus-side and re-checked here when present.
    if let Some(sender) = msg.sender() {
        if &*sender != "org.freedesktop.NetworkManager" {
            return None;
        }
    }
    let mut it = msg.iter_init();
    let arg0: String = it.read().ok()?;
    if arg0 != NM_INTERFACE {
        return None;
    }
    let props: PropMap = it.read().ok()?;
    let state = props.get("State").and_then(|v| v.0.as_u64())?;
    let text = if state == NM_STATE_CONNECTED_GLOBAL {
        "network: online".to_string()
    } else {
        format!("network: state {state}")
    };
    Some(Observed {
        source: Source::Network,
        text,
        lockdown: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use dbus::{arg::Variant, Message};
    use std::collections::HashMap;

    fn nm_state_changed(state: u32) -> Message {
        let mut props: PropMap = HashMap::new();
        props.insert(
            "State".to_string(),
            Variant(Box::new(state) as Box<dyn dbus::arg::RefArg>),
        );
        let mut msg = Message::new_signal(
            "/org/freedesktop/NetworkManager",
            "org.freedesktop.DBus.Properties",
            "PropertiesChanged",
        )
        .expect("signal");
        msg.append_all((NM_INTERFACE.to_string(), props, Vec::<String>::new()));
        msg
    }

    #[test]
    fn seventy_is_online() {
        let o = parse(&nm_state_changed(70)).expect("parse");
        assert_eq!(o.text, "network: online");
        assert_eq!(o.source, Source::Network);
    }

    #[test]
    fn unknown_states_are_reported_numerically() {
        for n in [20u32, 30, 50, 60, 100] {
            let o = parse(&nm_state_changed(n)).expect("parse");
            assert_eq!(o.text, format!("network: state {n}"));
        }
    }

    #[test]
    fn unrelated_property_change_is_ignored() {
        let mut props: PropMap = HashMap::new();
        props.insert(
            "Version".to_string(),
            Variant(Box::new("1.44".to_string()) as Box<dyn dbus::arg::RefArg>),
        );
        let mut msg = Message::new_signal(
            "/org/freedesktop/NetworkManager",
            "org.freedesktop.DBus.Properties",
            "PropertiesChanged",
        )
        .expect("signal");
        msg.append_all((NM_INTERFACE.to_string(), props, Vec::<String>::new()));
        assert!(parse(&msg).is_none());
    }
}
