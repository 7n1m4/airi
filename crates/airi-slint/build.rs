// SPDX-License-Identifier: GPL-3.0-or-later
//! Build script for airi-slint: compiles the Slint UI sources.
//!
//! `bootstrap.slint` is the single entry: its `MainWindow` is the Slint root,
//! and it imports the shell windows and (transitively) the components. Slint
//! only generates Rust types for components reachable from the entry, so the
//! entry must import the whole tree — `main.slint` is the re-export hub that
//! pulls in the globals and the 15 components.

fn main() {
    println!("cargo:rerun-if-changed=src/ui");
    slint_build::compile("src/ui/bootstrap.slint").expect("compile bootstrap.slint");
}