// SPDX-License-Identifier: GPL-3.0-or-later
//! Session-bus discovery of the AT-SPI accessibility bus.
//!
//! The real a11y tree traffic does not happen on the session bus. The session
//! bus carries `org.a11y.Bus` (the a11y bus launcher/broker); the actual
//! accessible objects and events live on a separate *accessibility bus* whose
//! address we fetch with `org.a11y.Bus.GetAddress()`. Whether applications
//! build their trees at all is signalled by `org.a11y.Status.IsEnabled`, a
//! *property* (read via `org.freedesktop.DBus.Properties.Get`), not a method.
//!
//! Honest failure contract: every step is fallible and all failures degrade to
//! `ProbeResult::available = false` with a human-readable reason. Nothing here
//! panics, nothing exits, nothing assumes a desktop environment.

use dbus::blocking::Connection;
use dbus::Message;

/// Object path and interface for the a11y bus launcher, per at-spi2.
pub const A11Y_BUS_OBJECT: &str = "/org/a11y/bus";
pub const A11Y_BUS_INTERFACE: &str = "org.a11y.Bus";
pub const A11Y_STATUS_INTERFACE: &str = "org.a11y.Status";
pub const PROPERTIES_INTERFACE: &str = "org.freedesktop.DBus.Properties";

#[derive(Debug, Clone, PartialEq, Eq)]
/// Outcome of the discovery probe. `available` is the single gate the daemon
/// uses to arm the `screen` source; everything else is reporting detail.
pub struct ProbeResult {
    /// The a11y bus address was fetched; a connection to it was not attempted.
    pub address: Option<String>,
    /// `org.a11y.Status.IsEnabled` raw value, when it could be read.
    pub enabled: Option<bool>,
    /// Why the a11y channel is unusable, when it is. `None` when usable.
    pub unavailable_reason: Option<String>,
}

impl ProbeResult {
    pub fn available(&self) -> bool {
        self.unavailable_reason.is_none()
    }

    /// One-line human summary for `--selftest` and logs. Never carries content.
    pub fn summary_line(&self) -> String {
        match &self.unavailable_reason {
            Some(reason) => format!("unavailable ({reason})"),
            None => {
                let enabled = match self.enabled {
                    Some(true) => "apps are asked to build trees",
                    Some(false) => "IsEnabled=false (apps may not build trees)",
                    None => "IsEnabled unread",
                };
                format!("available (a11y bus address fetched; {enabled})")
            }
        }
    }
}

/// Fetch the a11y bus address via `org.a11y.Bus.GetAddress` on the session bus.
/// Returns `Err(reason)` on any failure — a11y is simply not available on this
/// desktop (KDE Plasma and GNOME ship it; minimal WMs may not).
pub fn fetch_a11y_address(session: &Connection) -> Result<String, String> {
    let msg = Message::call_with_args(
        "org.a11y.Bus",
        A11Y_BUS_OBJECT,
        A11Y_BUS_INTERFACE,
        "GetAddress",
        (),
    );
    let reply = session
        .channel()
        .send_with_reply_and_block(msg, std::time::Duration::from_millis(1000))
        .map_err(|e| format!("org.a11y.Bus.GetAddress failed: {e}"))?;
    let mut it = reply.iter_init();
    match it.read::<String>() {
        Ok(addr) if !addr.is_empty() => Ok(addr),
        _ => Err("org.a11y.Bus.GetAddress returned no address string".to_string()),
    }
}

/// Read `org.a11y.Status.IsEnabled` (a property, not a method — read via
/// `org.freedesktop.DBus.Properties.Get`).
pub fn fetch_is_enabled(session: &Connection) -> Result<bool, String> {
    let msg = Message::call_with_args(
        "org.a11y.Bus",
        A11Y_BUS_OBJECT,
        PROPERTIES_INTERFACE,
        "Get",
        (A11Y_STATUS_INTERFACE.to_string(), "IsEnabled".to_string()),
    );
    let reply = session
        .channel()
        .send_with_reply_and_block(msg, std::time::Duration::from_millis(1000))
        .map_err(|e| format!("Properties.Get(IsEnabled) failed: {e}"))?;
    let mut it = reply.iter_init();
    use dbus::arg::Variant;
    match it.read::<Variant<bool>>() {
        Ok(Variant(v)) => Ok(v),
        _ => Err("Properties.Get(IsEnabled) did not return a variant<bool>".to_string()),
    }
}

/// Probe the session bus for the a11y channel. Never fails; the returned
/// `ProbeResult` records exactly what was and was not negotiated.
pub fn probe(session: &Connection) -> ProbeResult {
    let address = match fetch_a11y_address(session) {
        Ok(a) => Some(a),
        Err(e) => {
            return ProbeResult {
                address: None,
                enabled: None,
                unavailable_reason: Some(e),
            }
        }
    };
    let enabled = fetch_is_enabled(session).ok();
    ProbeResult {
        address,
        enabled,
        unavailable_reason: None,
    }
}
