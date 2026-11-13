// SPDX-License-Identifier: GPL-3.0-or-later
//! Chat settings bridge (`ChatSettingsState`).
//!
//! Mirrors [`airi_core::settings::ChatSettings`] (`settings/chat`).
//! `sendMode` / `suggestMode` are kebab-case wire strings:
//! `enter` | `ctrl-enter` | `double-enter` (suggest adds `disabled`).

use std::sync::Mutex;

use airi_core::settings::{ChatSendMode, ChatSettings, ChatSuggestMode};

fn send_mode_wire(mode: ChatSendMode) -> &'static str {
    match mode {
        ChatSendMode::Enter => "enter",
        ChatSendMode::CtrlEnter => "ctrl-enter",
        ChatSendMode::DoubleEnter => "double-enter",
    }
}

fn suggest_mode_wire(mode: ChatSuggestMode) -> &'static str {
    match mode {
        ChatSuggestMode::Enter => "enter",
        ChatSuggestMode::CtrlEnter => "ctrl-enter",
        ChatSuggestMode::DoubleEnter => "double-enter",
        ChatSuggestMode::Disabled => "disabled",
    }
}

fn parse_send_mode(raw: &str) -> Option<ChatSendMode> {
    match raw.trim() {
        "enter" => Some(ChatSendMode::Enter),
        "ctrl-enter" => Some(ChatSendMode::CtrlEnter),
        "double-enter" => Some(ChatSendMode::DoubleEnter),
        _ => None,
    }
}

fn parse_suggest_mode(raw: &str) -> Option<ChatSuggestMode> {
    match raw.trim() {
        "enter" => Some(ChatSuggestMode::Enter),
        "ctrl-enter" => Some(ChatSuggestMode::CtrlEnter),
        "double-enter" => Some(ChatSuggestMode::DoubleEnter),
        "disabled" => Some(ChatSuggestMode::Disabled),
        _ => None,
    }
}

/// Chat settings mirror (`settings/chat`).
pub struct ChatSettingsState {
    pub send_mode: String,
    pub suggest_mode: String,
    pub stream_idle_timeout_ms: f64,
    pub show_director_notes: bool,
    pub combine_system_messages: bool,
}

impl Default for ChatSettingsState {
    fn default() -> Self {
        let s = load_section::<ChatSettings>();
        Self {
            send_mode: send_mode_wire(s.send_mode).to_string(),
            suggest_mode: suggest_mode_wire(s.suggest_mode).to_string(),
            stream_idle_timeout_ms: s.stream_idle_timeout_ms as f64,
            show_director_notes: s.show_director_notes,
            combine_system_messages: s.combine_system_messages,
        }
    }
}

static STATE: Mutex<ChatSettingsState> = Mutex::new(ChatSettingsState {
    send_mode: String::new(),
    suggest_mode: String::new(),
    stream_idle_timeout_ms: 0.0,
    show_director_notes: false,
    combine_system_messages: false,
});

/// Lock the process-wide chat settings state.
pub fn with_state<R>(f: impl FnOnce(&mut ChatSettingsState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

impl ChatSettingsState {
    /// Re-read `settings/chat` into the mirror properties.
    pub fn load(&mut self) {
        let s = load_section::<ChatSettings>();
        self.send_mode = send_mode_wire(s.send_mode).to_string();
        self.suggest_mode = suggest_mode_wire(s.suggest_mode).to_string();
        self.stream_idle_timeout_ms = s.stream_idle_timeout_ms as f64;
        self.show_director_notes = s.show_director_notes;
        self.combine_system_messages = s.combine_system_messages;
    }

    /// Persist `settings/chat`. `sendMode`/`suggestMode` must be valid
    /// wire strings; unknown values are rejected (`false`).
    /// `streamIdleTimeoutMs` is clamped to ≥ 0. Returns `true` on success.
    #[allow(clippy::too_many_arguments)]
    pub fn save(
        &mut self,
        send_mode: &str,
        suggest_mode: &str,
        stream_idle_timeout_ms: f64,
        show_director_notes: bool,
        combine_system_messages: bool,
    ) -> bool {
        let send_mode_raw = send_mode;
        let suggest_mode_raw = suggest_mode;
        let Some(send_mode_v) = parse_send_mode(send_mode_raw) else {
            eprintln!("[airi-slint] chat settings: refusing unknown sendMode {send_mode_raw:?}");
            return false;
        };
        let Some(suggest_mode_v) = parse_suggest_mode(suggest_mode_raw) else {
            eprintln!(
                "[airi-slint] chat settings: refusing unknown suggestMode {suggest_mode_raw:?}"
            );
            return false;
        };
        let timeout_ms = if stream_idle_timeout_ms.is_finite() && stream_idle_timeout_ms >= 0.0 {
            stream_idle_timeout_ms.round() as u64
        } else {
            600_000
        };
        let section = ChatSettings {
            send_mode: send_mode_v,
            suggest_mode: suggest_mode_v,
            stream_idle_timeout_ms: timeout_ms,
            show_director_notes,
            combine_system_messages,
        };
        match save_section(&section) {
            Ok(()) => {
                self.send_mode = send_mode_wire(section.send_mode).to_string();
                self.suggest_mode = suggest_mode_wire(section.suggest_mode).to_string();
                self.stream_idle_timeout_ms = section.stream_idle_timeout_ms as f64;
                self.show_director_notes = section.show_director_notes;
                self.combine_system_messages = section.combine_system_messages;
                true
            }
            Err(e) => {
                eprintln!("[airi-slint] chat settings: failed to persist settings/chat: {e}");
                false
            }
        }
    }

    /// Alias for `load()` — re-read the section from the store.
    pub fn reload_from_store(&mut self) {
        self.load();
    }
}

use crate::bridges::{load_section, save_section};
