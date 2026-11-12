// SPDX-License-Identifier: GPL-3.0-or-later
//! Window/page visit tracking for the `--smoke` tour.
//!
//! The smoke tour calls [`WindowsState::visited`] for each window it opens;
//! visits are recorded in order so `main` can print the pages it exercised
//! before exiting. The window registry itself is Rust-side: the UI asks this
//! module to open/close pages instead of instantiating QML windows.

use std::sync::Mutex;

/// Which window/page the shell currently shows, plus its on-screen geometry.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Open-window registry. Stateless besides the recorded visits.
#[derive(Default)]
pub struct WindowsState {
    /// Page shown by each open window, in open order.
    pub open: Vec<String>,
    /// Geometry per open page, keyed by the same string as `open`.
    pub geometry: Vec<(String, WindowGeometry)>,
}

static STATE: Mutex<WindowsState> = Mutex::new(WindowsState {
    open: Vec::new(),
    geometry: Vec::new(),
});

/// Lock the process-wide windows state.
pub fn with_state<R>(f: impl FnOnce(&mut WindowsState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

static VISITED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Visited pages in order, e.g. `["splash", "control-strip", "chat", ...]`.
pub fn smoke_visited() -> Vec<String> {
    VISITED.lock().map(|v| v.clone()).unwrap_or_default()
}

impl WindowsState {
    /// Log and record a smoke tour page visit. No-op outside `--smoke`.
    pub fn visited(&self, page: &str) {
        if !crate::bridges::smoke() {
            return;
        }
        eprintln!("[airi-slint] smoke: visited {page}");
        if let Ok(mut visited) = VISITED.lock() {
            visited.push(page.to_string());
        }
    }

    /// Register `page` as open with `geometry`; no-op when already open.
    pub fn open_window(&mut self, page: &str, geometry: WindowGeometry) {
        if self.open.iter().any(|open| open == page) {
            return;
        }
        self.open.push(page.to_string());
        self.geometry.push((page.to_string(), geometry));
    }

    /// Forget `page`; returns whether it was open.
    pub fn close_window(&mut self, page: &str) -> bool {
        let was_open = self.open.iter().position(|open| open == page);
        if was_open.is_some() {
            self.open.retain(|open| open != page);
            self.geometry.retain(|(name, _)| name != page);
        }
        was_open.is_some()
    }

    /// Whether `page` is currently open.
    pub fn is_open(&self, page: &str) -> bool {
        self.open.iter().any(|open| open == page)
    }
}
