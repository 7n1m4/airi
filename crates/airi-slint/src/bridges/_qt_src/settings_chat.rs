// SPDX-License-Identifier: GPL-3.0-or-later
//! Chat settings bridge (`ChatSettingsController`) exposed to QML.
//!
//! Mirrors [`airi_core::settings::ChatSettings`] (`settings/chat`).
//! `sendMode` / `suggestMode` are kebab-case wire strings:
//! `enter` | `ctrl-enter` | `double-enter` (suggest adds `disabled`).

use std::pin::Pin;

use cxx_qt_lib::QString;

use airi_core::settings::{ChatSendMode, ChatSettings, ChatSuggestMode};

use crate::bridges::qstring_to_string;

/// cxx-qt bridge definitions for the chat settings bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Chat settings mirror.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, send_mode, cxx_name = "sendMode")]
        #[qproperty(QString, suggest_mode, cxx_name = "suggestMode")]
        #[qproperty(f64, stream_idle_timeout_ms, cxx_name = "streamIdleTimeoutMs")]
        #[qproperty(bool, show_director_notes, cxx_name = "showDirectorNotes")]
        #[qproperty(bool, combine_system_messages, cxx_name = "combineSystemMessages")]
        type ChatSettingsController = super::ChatSettingsControllerRust;
    }

    extern "RustQt" {
        /// Re-read `settings/chat` into the mirror properties.
        #[qinvokable]
        #[cxx_name = "load"]
        fn load(self: Pin<&mut ChatSettingsController>);

        /// Persist `settings/chat`. `sendMode`/`suggestMode` must be valid
        /// wire strings; unknown values are rejected (`false`).
        /// `streamIdleTimeoutMs` is clamped to ≥ 0. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "save"]
        fn save(
            self: Pin<&mut ChatSettingsController>,
            send_mode: QString,
            suggest_mode: QString,
            stream_idle_timeout_ms: f64,
            show_director_notes: bool,
            combine_system_messages: bool,
        ) -> bool;

        /// Alias for `load()` — re-read the section from the store.
        #[qinvokable]
        #[cxx_name = "reloadFromStore"]
        fn reload_from_store(self: Pin<&mut ChatSettingsController>);
    }
}

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

/// Rust storage for `ChatSettingsController`.
pub struct ChatSettingsControllerRust {
    send_mode: QString,
    suggest_mode: QString,
    stream_idle_timeout_ms: f64,
    show_director_notes: bool,
    combine_system_messages: bool,
}

impl Default for ChatSettingsControllerRust {
    fn default() -> Self {
        let s = load_section::<ChatSettings>();
        Self {
            send_mode: QString::from(send_mode_wire(s.send_mode)),
            suggest_mode: QString::from(suggest_mode_wire(s.suggest_mode)),
            stream_idle_timeout_ms: s.stream_idle_timeout_ms as f64,
            show_director_notes: s.show_director_notes,
            combine_system_messages: s.combine_system_messages,
        }
    }
}

impl qobject::ChatSettingsController {
    /// Re-read `settings/chat` into the mirror properties.
    pub fn load(mut self: Pin<&mut Self>) {
        let s = load_section::<ChatSettings>();
        self.as_mut()
            .set_send_mode(QString::from(send_mode_wire(s.send_mode)));
        self.as_mut()
            .set_suggest_mode(QString::from(suggest_mode_wire(s.suggest_mode)));
        self.as_mut()
            .set_stream_idle_timeout_ms(s.stream_idle_timeout_ms as f64);
        self.as_mut().set_show_director_notes(s.show_director_notes);
        self.as_mut()
            .set_combine_system_messages(s.combine_system_messages);
    }

    /// Persist `settings/chat`.
    pub fn save(
        mut self: Pin<&mut Self>,
        send_mode: QString,
        suggest_mode: QString,
        stream_idle_timeout_ms: f64,
        show_director_notes: bool,
        combine_system_messages: bool,
    ) -> bool {
        let send_mode_raw = qstring_to_string(&send_mode);
        let suggest_mode_raw = qstring_to_string(&suggest_mode);
        let Some(send_mode_v) = parse_send_mode(&send_mode_raw) else {
            eprintln!("[airi-slint] chat settings: refusing unknown sendMode {send_mode_raw:?}");
            return false;
        };
        let Some(suggest_mode_v) = parse_suggest_mode(&suggest_mode_raw) else {
            eprintln!("[airi-slint] chat settings: refusing unknown suggestMode {suggest_mode_raw:?}");
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
                self.as_mut()
                    .set_send_mode(QString::from(send_mode_wire(section.send_mode)));
                self.as_mut()
                    .set_suggest_mode(QString::from(suggest_mode_wire(section.suggest_mode)));
                self.as_mut()
                    .set_stream_idle_timeout_ms(section.stream_idle_timeout_ms as f64);
                self.as_mut()
                    .set_show_director_notes(section.show_director_notes);
                self.as_mut()
                    .set_combine_system_messages(section.combine_system_messages);
                true
            }
            Err(e) => {
                eprintln!("[airi-slint] chat settings: failed to persist settings/chat: {e}");
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(self: Pin<&mut Self>) {
        self.load();
    }
}

fn load_section<S: airi_core::settings::SettingsSection>() -> S {
    crate::bridges::settings_store()
        .and_then(|store| store.load_section::<S>().ok())
        .unwrap_or_default()
}

fn save_section<S: airi_core::settings::SettingsSection>(value: &S) -> anyhow::Result<()> {
    let Some(store) = crate::bridges::settings_store() else {
        anyhow::bail!("settings store not registered");
    };
    store.save_section(value)
}
