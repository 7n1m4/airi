// SPDX-License-Identifier: GPL-3.0-or-later
//! Window/page visit tracking for the `--smoke` tour (`Windows`).
//!
//! The QML smoke tour calls [`qobject::Windows::visited`] for each window it
//! creates; visits are recorded in order so `main` can print the pages it
//! exercised before exiting.

use cxx_qt_lib::QString;
use std::sync::Mutex;

use crate::bridges::qstring_to_string;

/// cxx-qt bridge definitions for the windows bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Records page visits during the smoke tour. Stateless otherwise.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        type Windows = super::WindowsRust;
    }

    extern "RustQt" {
        /// Log and record that the smoke tour opened `page`.
        #[qinvokable]
        fn visited(self: &Windows, page: QString);
    }
}

/// Rust storage for `Windows`.
#[derive(Default)]
pub struct WindowsRust;

static VISITED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Visited pages in order, e.g. `["splash", "control-strip", "chat", ...]`.
pub fn smoke_visited() -> Vec<String> {
    VISITED.lock().map(|v| v.clone()).unwrap_or_default()
}

impl qobject::Windows {
    /// Log and record a smoke tour page visit. No-op outside `--smoke`.
    pub fn visited(&self, page: QString) {
        if !crate::bridges::smoke() {
            return;
        }
        let page = qstring_to_string(&page);
        eprintln!("[airi-slint] smoke: visited {page}");
        if let Ok(mut visited) = VISITED.lock() {
            visited.push(page);
        }
    }
}
