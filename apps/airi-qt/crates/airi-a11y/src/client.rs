// SPDX-License-Identifier: GPL-3.0-or-later
//! Live AT-SPI2 client: a11y bus connection, focus match rules, and the
//! on-demand focused-subtree walk.
//!
//! `dbus::blocking::Connection::new_address` is the only custom-address
//! constructor in dbus 0.9 — it connects *and* registers on the bus (Hello).
//! There is no `new_custom`; do not invent one.
//!
//! Everything returned by the bus is untrusted input. All reply parsing is
//! shape-checked and every failure degrades to `Err` with a short reason —
//! never to a guess, never to a panic.

use std::time::Duration;

use dbus::arg::Variant;
use dbus::blocking::Connection;
use dbus::Message;

use crate::digest::{digest_from_tree, FocusedDigest, TreeNode, WalkOptions};
use crate::focus::{parse_focus_signal, FocusUpdate, FOCUS_MATCH_RULES};

const CALL_TIMEOUT: Duration = Duration::from_millis(500);

const ACCESSIBLE_IFACE: &str = "org.a11y.atspi.Accessible";
const TEXT_IFACE: &str = "org.a11y.atspi.Text";
const PROPERTIES_IFACE: &str = "org.freedesktop.DBus.Properties";

/// A connected accessibility bus (a11y bus, NOT the session bus).
pub struct A11yClient {
    conn: Connection,
}

impl A11yClient {
    /// Connect to the a11y bus at `address` (from `org.a11y.Bus.GetAddress`).
    pub fn connect(address: &str) -> Result<Self, String> {
        let conn = Connection::new_address(address)
            .map_err(|e| format!("cannot connect to the a11y bus at {address}: {e}"))?;
        Ok(A11yClient { conn })
    }

    /// Install the focus match rules. Returns one result per rule; the caller
    /// decides whether partial coverage still counts as available.
    pub fn add_focus_match_rules(&self) -> Vec<(&'static str, Result<(), String>)> {
        FOCUS_MATCH_RULES
            .iter()
            .map(|rule| {
                (
                    *rule,
                    self.conn
                        .add_match_no_cb(rule)
                        .map_err(|e| format!("match rule rejected: {e}")),
                )
            })
            .collect()
    }

    /// Remove the focus match rules (probe cleanup for `--selftest`).
    /// Best-effort: returns the first error, or `Ok(())`.
    pub fn remove_focus_match_rules(&self) -> Result<(), String> {
        let mut first_err: Option<String> = None;
        for rule in FOCUS_MATCH_RULES {
            if let Err(e) = self.conn.remove_match_no_cb(rule) {
                first_err.get_or_insert(format!("remove {rule}: {e}"));
            }
        }
        match first_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    /// Zero-wait poll for a focus event. `Ok(None)` = nothing pending.
    /// `Err` = the a11y bus is sick — caller should disarm the source.
    pub fn poll_focus(&self) -> Result<Option<FocusUpdate>, String> {
        match self
            .conn
            .channel()
            .blocking_pop_message(Duration::from_millis(0))
        {
            Ok(Some(msg)) => Ok(parse_focus_signal(&msg)),
            Ok(None) => Ok(None),
            Err(e) => Err(format!("a11y bus read error: {e}")),
        }
    }

    /// Resolve the accessible that owns `path` to its application root
    /// (`GetApplication`), returning (app_bus_name, app_root_path).
    fn get_application(&self, dest: &str, path: &str) -> Result<(String, String), String> {
        let reply = self.call(dest, path, ACCESSIBLE_IFACE, "GetApplication", ())?;
        let mut it = reply.iter_init();
        let app: (String, dbus::strings::Path<'_>) = it
            .read()
            .map_err(|_| "GetApplication did not return (so)".to_string())?;
        Ok((app.0, app.1.to_string()))
    }

    /// Resolve `(bus_name, path)` of the parent accessible via the `Parent`
    /// property. `Err` when the accessible has no parent (it is the root).
    fn get_parent(&self, dest: &str, path: &str) -> Result<(String, String), String> {
        let reply = self.call(
            dest,
            path,
            PROPERTIES_IFACE,
            "Get",
            (ACCESSIBLE_IFACE.to_string(), "Parent".to_string()),
        )?;
        let mut it = reply.iter_init();
        let parent: Variant<(String, dbus::strings::Path<'_>)> = it
            .read()
            .map_err(|_| "Parent property missing".to_string())?;
        Ok((parent.0 .0, parent.0 .1.to_string()))
    }

    fn get_role_name(&self, dest: &str, path: &str) -> Result<String, String> {
        let reply = self.call(dest, path, ACCESSIBLE_IFACE, "GetRoleName", ())?;
        let mut it = reply.iter_init();
        it.read::<String>()
            .map_err(|_| "GetRoleName did not return s".to_string())
    }

    fn get_property_string(
        &self,
        dest: &str,
        path: &str,
        property: &str,
    ) -> Result<String, String> {
        let reply = self.call(
            dest,
            path,
            PROPERTIES_IFACE,
            "Get",
            (ACCESSIBLE_IFACE.to_string(), property.to_string()),
        )?;
        let mut it = reply.iter_init();
        let v: Variant<String> = it
            .read()
            .map_err(|_| format!("property {property} missing or not s"))?;
        Ok(v.0)
    }

    fn get_interfaces(&self, dest: &str, path: &str) -> Result<Vec<String>, String> {
        let reply = self.call(dest, path, ACCESSIBLE_IFACE, "GetInterfaces", ())?;
        let mut it = reply.iter_init();
        it.read::<Vec<String>>()
            .map_err(|_| "GetInterfaces did not return as".to_string())
    }

    fn get_text(&self, dest: &str, path: &str) -> Result<String, String> {
        // Text.GetText(s) — offset 0, max -1 == whole string.
        let reply = self.call(dest, path, TEXT_IFACE, "GetText", (0i32, -1i32))?;
        let mut it = reply.iter_init();
        it.read::<String>()
            .map_err(|_| "Text.GetText did not return s".to_string())
    }

    fn get_children(&self, dest: &str, path: &str) -> Result<Vec<(String, String)>, String> {
        let reply = self.call(dest, path, ACCESSIBLE_IFACE, "GetChildren", ())?;
        let mut it = reply.iter_init();
        let kids: Vec<(String, dbus::strings::Path<'_>)> = it
            .read()
            .map_err(|_| "GetChildren did not return a(so)".to_string())?;
        Ok(kids.into_iter().map(|(d, p)| (d, p.to_string())).collect())
    }

    /// One D-Bus round trip with shape-checked reply. The reply message type
    /// is checked (an `Error` reply becomes `Err`).
    fn call(
        &self,
        dest: &str,
        path: &str,
        interface: &str,
        member: &str,
        args: impl dbus::arg::AppendAll,
    ) -> Result<Message, String> {
        let msg = Message::call_with_args(dest, path, interface, member, args);
        let reply = self
            .conn
            .channel()
            .send_with_reply_and_block(msg, CALL_TIMEOUT)
            .map_err(|e| format!("{interface}.{member} call failed: {e}"))?;
        if reply.msg_type() == dbus::MessageType::Error {
            let mut it = reply.iter_init();
            let detail: String = it.read().unwrap_or_else(|_| "no detail".to_string());
            return Err(format!("{interface}.{member} returned error: {detail}"));
        }
        Ok(reply)
    }

    /// Application name via a bounded Parent walk, stopping at the node with
    /// role `application` — never crossing into the a11y registry's desktop
    /// frame (the registry sits *above* application roots on this bus).
    fn app_name_via_parent_walk(&self, dest: &str, path: &str) -> Result<String, String> {
        let mut cur = (dest.to_string(), path.to_string());
        for _ in 0..16 {
            match self.get_role_name(&cur.0, &cur.1) {
                Ok(role) if role.to_lowercase().trim().starts_with("application") => {
                    return self
                        .get_property_string(&cur.0, &cur.1, "Name")
                        .ok()
                        .filter(|n| !n.trim().is_empty())
                        .or_else(|| Some(cur.0.clone()))
                        .ok_or_else(|| "application accessible has no name".to_string());
                }
                _ => match self.get_parent(&cur.0, &cur.1) {
                    Ok(parent) => cur = parent,
                    Err(e) => return Err(format!("no application ancestor found: {e}")),
                },
            }
        }
        Err("application ancestor chain exceeded 16 levels".to_string())
    }

    /// Best-effort application name for `dest` at `path`. An application root
    /// resolves to itself first (never to the registry above it); otherwise
    /// `GetApplication` — verified to reference an application-role node, or
    /// distrusted in favor of the parent walk (the registry's desktop frame
    /// is a common wrong answer on this bus).
    pub fn resolve_app_name(&self, dest: &str, path: &str) -> Result<String, String> {
        if let Ok(role) = self.get_role_name(dest, path) {
            if role.to_lowercase().trim().starts_with("application") {
                if let Ok(name) = self.get_property_string(dest, path, "Name") {
                    if !name.trim().is_empty() {
                        return Ok(name);
                    }
                }
                return Ok(dest.to_string());
            }
        }
        match self.get_application(dest, path) {
            Ok((app_dest, app_path)) => {
                // Trust but verify: the reference must name an application root.
                let is_application = self
                    .get_role_name(&app_dest, &app_path)
                    .map(|r| r.to_lowercase().trim().starts_with("application"))
                    .unwrap_or(false);
                if !is_application {
                    return self.app_name_via_parent_walk(dest, path);
                }
                if let Ok(name) = self.get_property_string(&app_dest, &app_path, "Name") {
                    if !name.trim().is_empty() {
                        return Ok(name);
                    }
                }
                Ok(app_dest) // nameless application: bus name still identifies the app
            }
            Err(_) => self.app_name_via_parent_walk(dest, path),
        }
    }

    /// Window-ish title for `dest` at `path`: nearest ancestor (or self) with
    /// an exact role of window/frame/dialog/alert carrying a non-empty Name;
    /// the walk stops at the application root (never crossing into the
    /// registry's desktop frame). Falls back to the node's own Name.
    pub fn resolve_title(&self, dest: &str, path: &str) -> Option<String> {
        const WINDOWISH: [&str; 4] = ["window", "frame", "dialog", "alert"];
        let mut cur = (dest.to_string(), path.to_string());
        let mut own_name: Option<String> = None;
        for _ in 0..16 {
            let role = self
                .get_role_name(&cur.0, &cur.1)
                .map(|r| r.trim().to_lowercase())
                .unwrap_or_default();
            let name = self
                .get_property_string(&cur.0, &cur.1, "Name")
                .ok()
                .filter(|n| !n.trim().is_empty());
            if own_name.is_none() {
                own_name = name.clone();
            }
            if WINDOWISH.contains(&role.as_str()) {
                if let Some(n) = name {
                    return Some(n);
                }
            }
            if role.starts_with("application") {
                // Application roots have the registry's desktop frame as their
                // parent — the title of "main" there is not this app's window.
                break;
            }
            match self.get_parent(&cur.0, &cur.1) {
                Ok(parent) => cur = parent,
                Err(_) => break,
            }
        }
        own_name
    }

    /// Build the live subtree for `dest` at `path` with the node budget already
    /// spent down through the recursion. Excluded subtrees are not descended
    /// into (saves D-Bus round trips inside password managers).
    fn build_tree(
        &self,
        dest: &str,
        path: &str,
        depth: usize,
        opts: &WalkOptions,
        budget: &mut usize,
    ) -> Option<TreeNode> {
        if depth > opts.max_depth || *budget == 0 {
            return None;
        }
        *budget -= 1;
        let role = self
            .get_role_name(dest, path)
            .unwrap_or_else(|_| "unknown".to_string());
        let name = self
            .get_property_string(dest, path, "Name")
            .unwrap_or_default();
        let description = self
            .get_property_string(dest, path, "Description")
            .unwrap_or_default();

        // Exclusion decision — stop here, do not recurse into the subtree.
        if crate::digest::is_excluded_node(&role, &name, &description) {
            return Some(TreeNode {
                role,
                name,
                description,
                text: None,
                protected_state: false,
                children: Vec::new(),
            });
        }

        // Text content is best-effort: only when the node advertises the
        // interface; a failure means "no text", never a guessed string.
        let text = match self.get_interfaces(dest, path) {
            Ok(ifaces) if ifaces.iter().any(|i| i == TEXT_IFACE) => {
                self.get_text(dest, path).ok().filter(|t| !t.is_empty())
            }
            _ => None,
        };

        let mut children = Vec::new();
        if depth < opts.max_depth {
            if let Ok(kids) = self.get_children(dest, path) {
                for (cdest, cpath) in kids {
                    if *budget == 0 {
                        break;
                    }
                    if let Some(child) = self.build_tree(&cdest, &cpath, depth + 1, opts, budget) {
                        children.push(child);
                    }
                }
            }
        }
        Some(TreeNode {
            role,
            name,
            description,
            text,
            protected_state: false,
            children,
        })
    }

    /// On-demand digest of the focused accessible's subtree. `cached_title`
    /// is the title from a cached Activate event, used when it matches the
    /// focused path; otherwise the title is resolved by a bounded ancestor
    /// walk. App name is always resolved fresh (focus events carry no app).
    pub fn capture_digest(
        &self,
        dest: &str,
        path: &str,
        cached_title: Option<&str>,
        opts: &WalkOptions,
    ) -> Result<FocusedDigest, String> {
        let app = self.resolve_app_name(dest, path)?;
        let title = cached_title
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string)
            .or_else(|| self.resolve_title(dest, path))
            .unwrap_or_else(|| "untitled".to_string());
        let mut budget = opts.max_nodes;
        let tree = self.build_tree(dest, path, 0, opts, &mut budget);
        Ok(digest_from_tree(&app, &title, tree.as_ref(), opts))
    }
}
