// SPDX-License-Identifier: GPL-3.0-or-later
//! Application shell state exposed to Slint (`ShellState`).

use std::sync::Mutex;

/// Application shell state.
#[derive(Default)]
pub struct ShellState {
    /// Human-readable status line.
    pub status: String,
    /// Window title.
    pub title: String,
    /// Window subtitle.
    pub subtitle: String,
}

static STATE: Mutex<ShellState> = Mutex::new(ShellState {
    status: String::new(),
    title: String::new(),
    subtitle: String::new(),
});

/// Lock the process-wide shell state.
pub fn with_state<R>(f: impl FnOnce(&mut ShellState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

impl ShellState {
    /// Ready marker for the smoke test/start.
    pub fn ready(&mut self) {
        eprintln!("[airi-slint] shell bridge: ready() invoked");
        self.status = "AI companion desktop shell ready".to_string();
    }
}

/// Reports whether the process runs in `--smoke` mode.
pub fn is_smoke() -> bool {
    crate::bridges::smoke()
}
