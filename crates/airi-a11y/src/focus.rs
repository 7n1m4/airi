// SPDX-License-Identifier: GPL-3.0-or-later
//! Focus-event plumbing: match rules, parsing, and the `lastFocus` cache.
//!
//! Match rules installed on the a11y bus (no `arg0` — we filter on the body,
//! which is where AT-SPI2 puts the detail):
//!
//!   type='signal',interface='org.a11y.atspi.Event.Object',member='StateChanged'
//!     — body arg0 == "focused"; arg1 (detail1, i) == 0 means the state was
//!     *removed* (focus left) and is ignored. Path = the accessible object
//!     the signal is emitted on.
//!   type='signal',interface='org.a11y.atspi.Event.Window',member='Activate'
//!     — arg2 is the window title (arg1 is the focused accessible path on
//!     some toolkits; we never trust arg1 over the message path, per the
//!     lane spec: the path comes from the message itself).
//!
//! Everything here treats the bus as untrusted: malformed or out-of-shape
//! messages parse to `None` and are dropped, never guessed at.

use dbus::Message;

pub const FOCUS_MATCH_OBJECT: &str =
    "type='signal',interface='org.a11y.atspi.Event.Object',member='StateChanged'";
pub const FOCUS_MATCH_WINDOW: &str =
    "type='signal',interface='org.a11y.atspi.Event.Window',member='Activate'";

pub const FOCUS_MATCH_RULES: &[&str] = &[FOCUS_MATCH_OBJECT, FOCUS_MATCH_WINDOW];

const OBJECT_IFACE: &str = "org.a11y.atspi.Event.Object";
const WINDOW_IFACE: &str = "org.a11y.atspi.Event.Window";

/// The `lastFocus {app, title, path}` cache the digest walks from.
/// `sender` is the unique connection name of the application that emitted the
/// signal — we need it as the destination for every subsequent D-Bus call.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FocusCache {
    pub app: Option<String>,
    pub title: Option<String>,
    pub path: Option<String>,
    pub sender: Option<String>,
}

impl FocusCache {
    pub fn best_title(&self) -> Option<&str> {
        self.title.as_deref().filter(|t| !t.is_empty())
    }

    pub fn has_focus(&self) -> bool {
        self.path.is_some() && self.sender.is_some()
    }
}

/// A parsed focus-related signal. `requires_resolution` is true when the app
/// name is not known synchronously (StateChanged carries no app/title, so the
/// app is resolved at digest time or by the caller via a parent walk).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusUpdate {
    pub path: String,
    pub sender: String,
    /// Window title, when the signal carried one (Activate arg2).
    pub title: Option<String>,
}

fn parse_state_changed(msg: &Message) -> Option<FocusUpdate> {
    if msg.interface().as_deref() != Some(OBJECT_IFACE) {
        return None;
    }
    if msg.member().as_deref() != Some("StateChanged") {
        return None;
    }
    let mut it = msg.iter_init();
    // arg0: detail string, e.g. "focused", "showing", "enabled"…
    let detail: String = it.read().ok()?;
    if !detail.eq_ignore_ascii_case("focused") {
        return None;
    }
    // arg1: detail1, i — 1 when the state was set, 0 when removed.
    // Lenient: if the payload is missing or unreadable we accept it as a
    // focus *gain* (AT-SPI2 senders disagree on omitting detail1), but an
    // explicit 0 means focus left and is dropped.
    if let Ok(detail1) = it.read::<i32>() {
        if detail1 == 0 {
            return None;
        }
    }
    let path = msg.path()?.to_string();
    let sender = msg.sender()?.to_string();
    Some(FocusUpdate {
        path,
        sender,
        title: None,
    })
}

fn parse_window_activate(msg: &Message) -> Option<FocusUpdate> {
    if msg.interface().as_deref() != Some(WINDOW_IFACE) {
        return None;
    }
    if msg.member().as_deref() != Some("Activate") {
        return None;
    }
    let path = msg.path()?.to_string();
    let sender = msg.sender()?.to_string();
    // Body is toolkit-dependent in the wild: (detail: s, arg1: <path-ish>,
    // arg2: title). We only harvest arg2; a title that fails to parse is
    // simply absent. arg1 is deliberately ignored — the message path is the
    // authoritative accessible path (see module docs).
    let mut it = msg.iter_init();
    // arg0: toolkit-specific detail string; skip whatever it is.
    if it.read::<String>().is_err() {
        let _ = it.next();
    }
    // arg1: object path ('o') or, on some toolkits, a plain string ('s').
    // A failed `Path` read does not consume the iterator, so a string arg1
    // is read as a string. Unknown shapes are skipped.
    if it.read::<dbus::strings::Path<'_>>().is_err() && it.read::<String>().is_err() {
        let _ = it.next();
    }
    let title: Option<String> = it.read().ok();
    let title = title.filter(|t| !t.trim().is_empty());
    Some(FocusUpdate {
        path,
        sender,
        title,
    })
}

/// Parse an A11y-bus signal into a focus update, or `None` if the message is
/// not an (accepted) focus event: not ours, wrong member, focus *lost*, or
/// malformed. Bus input is untrusted; this never panics.
pub fn parse_focus_signal(msg: &Message) -> Option<FocusUpdate> {
    if msg.msg_type() != dbus::MessageType::Signal {
        return None;
    }
    parse_state_changed(msg).or_else(|| parse_window_activate(msg))
}

/// Apply a parsed event to the cache. The app name is *not* known from the
/// event itself — it is resolved lazily (parent walk / `GetApplication`) by
/// the digest path, or by the caller, because event bodies carry no app.
pub fn apply_focus_update(cache: &mut FocusCache, update: &FocusUpdate) {
    cache.path = Some(update.path.clone());
    cache.sender = Some(update.sender.clone());
    if let Some(title) = &update.title {
        cache.title = Some(title.clone());
    }
    // App name is resolved per digest/event; drop any stale name when the
    // focused object changes so we never attribute one app's tree to another.
    cache.app = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signal(iface: &str, member: &str, path: &str, sender: &str) -> Message {
        let mut msg = Message::new_signal(path, iface, member).expect("signal");
        msg.set_sender(Some(
            dbus::strings::BusName::new(sender).expect("test sender"),
        ));
        msg
    }

    const TEST_SENDER: &str = "org.example.App";

    #[test]
    fn state_changed_focused_parses() {
        let mut msg = signal(OBJECT_IFACE, "StateChanged", "/a/b/1", TEST_SENDER);
        msg.append_all(("focused".to_string(), 1i32, dbus::arg::Variant(true)));
        let u = parse_focus_signal(&msg).expect("focus gained");
        assert_eq!(u.path, "/a/b/1");
        assert_eq!(u.sender, TEST_SENDER);
        assert_eq!(u.title, None);
    }

    #[test]
    fn state_changed_focus_lost_is_dropped() {
        let mut msg = signal(OBJECT_IFACE, "StateChanged", "/a/b/1", TEST_SENDER);
        msg.append_all(("focused".to_string(), 0i32, dbus::arg::Variant(false)));
        assert!(parse_focus_signal(&msg).is_none());
    }

    #[test]
    fn state_changed_other_state_is_dropped() {
        let mut msg = signal(OBJECT_IFACE, "StateChanged", "/a/b/1", TEST_SENDER);
        msg.append_all(("showing".to_string(), 1i32, dbus::arg::Variant(true)));
        assert!(parse_focus_signal(&msg).is_none());
    }

    #[test]
    fn window_activate_title_parses_and_object_path_wins() {
        let mut msg = signal(WINDOW_IFACE, "Activate", "/a/w/2", TEST_SENDER);
        msg.append_all((
            "detail".to_string(),
            dbus::strings::Path::new("/some/other/path").unwrap(),
            "My Window".to_string(),
        ));
        let u = parse_focus_signal(&msg).expect("activate");
        assert_eq!(u.path, "/a/w/2", "message path wins over arg1");
        assert_eq!(u.title.as_deref(), Some("My Window"));
    }

    #[test]
    fn window_activate_string_arg1_shape_parses() {
        // Some toolkits send a plain string for the accessible path.
        let mut msg = signal(WINDOW_IFACE, "Activate", "/a/w/3", TEST_SENDER);
        msg.append_all((
            "detail".to_string(),
            "/some/other/path".to_string(),
            "Other Window".to_string(),
        ));
        let u = parse_focus_signal(&msg).expect("activate");
        assert_eq!(u.title.as_deref(), Some("Other Window"));
    }

    #[test]
    fn window_activate_missing_title_still_tracks_focus() {
        let mut msg = signal(WINDOW_IFACE, "Activate", "/a/w/4", TEST_SENDER);
        msg.append_all(("detail".to_string(),));
        let u = parse_focus_signal(&msg).expect("activate");
        assert_eq!(u.path, "/a/w/4");
        assert_eq!(u.title, None);
    }

    #[test]
    fn non_signal_and_unknown_message_are_dropped() {
        let msg = Message::method_call(
            &dbus::strings::BusName::new(TEST_SENDER).unwrap(),
            &dbus::strings::Path::new("/x").unwrap(),
            &dbus::strings::Interface::new(OBJECT_IFACE).unwrap(),
            &dbus::strings::Member::new("StateChanged").unwrap(),
        );
        assert!(parse_focus_signal(&msg).is_none());
    }

    #[test]
    fn cache_replaces_path_and_clears_stale_app() {
        let mut cache = FocusCache {
            app: Some("stale-app".to_string()),
            title: Some("old".to_string()),
            path: Some("/old".to_string()),
            sender: Some(":1.1".to_string()),
        };
        apply_focus_update(
            &mut cache,
            &FocusUpdate {
                path: "/new".to_string(),
                sender: ":1.99".to_string(),
                title: Some("fresh".to_string()),
            },
        );
        assert_eq!(cache.path.as_deref(), Some("/new"));
        assert_eq!(cache.sender.as_deref(), Some(":1.99"));
        assert_eq!(cache.title.as_deref(), Some("fresh"));
        assert_eq!(cache.app, None, "app must be re-resolved on focus change");
    }
}
