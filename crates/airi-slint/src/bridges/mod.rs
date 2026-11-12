// SPDX-License-Identifier: GPL-3.0-or-later
//! UI bridges exposed to Slint. Each bridge is a plain Rust module that
//! shuttles UI-facing calls into the service layer; no cxx-qt / QObject.

pub mod spine;