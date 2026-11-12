// SPDX-License-Identifier: GPL-3.0-or-later
//! Source 1 — MPRIS playback state via `org.mpris.MediaPlayer2.Player`
//! property changes. Metadata verb only (`media: Playing|Paused|Stopped`);
//! track/artist/title are deliberately never read (spec §B2: PlaybackStatus
//! is T0, metadata would be T1).
//!
//! Sender cannot be filtered portably in the match rule (per-player unique
//! buses), so arg0 carries the filter and the parser re-verifies it.

use dbus::{arg::PropMap, Message};

use super::Observed;
use crate::state::Source;

pub const MATCH_RULE: &str = "type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',arg0='org.mpris.MediaPlayer2.Player'";

pub const PLAYER_INTERFACE: &str = "org.mpris.MediaPlayer2.Player";

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
    let mut it = msg.iter_init();
    let iface: String = it.read().ok()?;
    if iface != PLAYER_INTERFACE {
        return None;
    }
    let props: PropMap = it.read().ok()?;
    let status = props
        .get("PlaybackStatus")
        .and_then(|v| v.0.as_str().map(|s| s.to_string()))?;
    let text = match status.as_str() {
        "Playing" | "Paused" | "Stopped" => format!("media: {status}"),
        // Honest fallback for non-standard values: keep it, truncated, no secrets.
        other => format!("media: {}", truncate32(other)),
    };
    Some(Observed {
        source: Source::Media,
        text,
        lockdown: None,
    })
}

fn truncate32(s: &str) -> String {
    let mut out: String = s.chars().take(32).collect();
    if s.chars().count() > 32 {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use dbus::{arg::Variant, strings::Path, Message};
    use std::collections::HashMap;

    fn properties_changed(arg0: &str, status: &str) -> Message {
        let mut props: PropMap = HashMap::new();
        props.insert(
            "PlaybackStatus".to_string(),
            Variant(Box::new(status.to_string()) as Box<dyn dbus::arg::RefArg>),
        );
        let invalidated: Vec<String> = Vec::new();
        let mut msg = Message::new_signal(
            "/org/mpris/MediaPlayer2/player",
            "org.freedesktop.DBus.Properties",
            "PropertiesChanged",
        )
        .expect("signal");
        msg.append_all((arg0.to_string(), props, invalidated));
        msg
    }

    #[test]
    fn parses_playing_paused_stopped() {
        for status in ["Playing", "Paused", "Stopped"] {
            let msg = properties_changed(PLAYER_INTERFACE, status);
            let o = parse(&msg).expect("should parse");
            assert_eq!(o.text, format!("media: {status}"));
            assert_eq!(o.source, Source::Media);
        }
    }

    #[test]
    fn rejects_wrong_interface_arg0() {
        let msg = properties_changed("org.mpris.MediaPlayer2.PlayerX", "Playing");
        assert!(parse(&msg).is_none());
    }

    #[test]
    fn ignores_non_playback_property_changes() {
        let mut props: PropMap = HashMap::new();
        props.insert(
            "Volume".to_string(),
            Variant(Box::new(0.5f64) as Box<dyn dbus::arg::RefArg>),
        );
        let mut msg = Message::new_signal(
            "/org/mpris/MediaPlayer2/player",
            "org.freedesktop.DBus.Properties",
            "PropertiesChanged",
        )
        .expect("signal");
        msg.append_all((PLAYER_INTERFACE.to_string(), props, Vec::<String>::new()));
        assert!(parse(&msg).is_none());
    }

    #[test]
    fn path_is_irrelevant_and_nonstandard_status_kept_truncated() {
        let msg = properties_changed(
            PLAYER_INTERFACE,
            "Buffering-with-a-very-long-tail-that-gets-truncated-here",
        );
        let o = parse(&msg).expect("should parse");
        assert!(o.text.starts_with("media: Buffering"));
        assert_eq!(o.text.chars().count(), "media: ".chars().count() + 33);
        let _ = Path::new("/org/mpris/MediaPlayer2/player").unwrap();
    }
}
