// SPDX-License-Identifier: GPL-3.0-or-later
//! Application shell state exposed to QML (`ShellApp`).

use cxx_qt_lib::QString;
use std::pin::Pin;

/// cxx-qt bridge definitions for the shell bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Application shell state exposed to QML.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, status)]
        #[qproperty(QString, title)]
        #[qproperty(QString, subtitle)]
        type ShellApp = super::ShellAppRust;
    }

    extern "RustQt" {
        /// Ready marker for the smoke test/start.
        #[qinvokable]
        fn ready(self: Pin<&mut ShellApp>);

        /// `true` when the process was launched with `--smoke`.
        #[qinvokable]
        #[cxx_name = "isSmoke"]
        fn is_smoke(self: &ShellApp) -> bool;
    }
}

/// Rust storage for `ShellApp`.
#[derive(Default)]
pub struct ShellAppRust {
    status: QString,
    title: QString,
    subtitle: QString,
}

impl qobject::ShellApp {
    /// Ready invokable for QML `Component.onCompleted`.
    pub fn ready(self: Pin<&mut Self>) {
        eprintln!("[airi-slint] QML bridge: ready() invoked");
        self.set_status(QString::from("AI companion desktop shell ready"));
    }

    /// Reports whether the process runs in `--smoke` mode.
    pub fn is_smoke(&self) -> bool {
        crate::bridges::smoke()
    }
}
