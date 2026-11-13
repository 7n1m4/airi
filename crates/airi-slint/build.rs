// SPDX-License-Identifier: GPL-3.0-or-later
//! Build script for airi-slint: compiles the Slint UI sources.
//!
//! `main.slint` is the single entry: it is the re-export hub that pulls in
//! `MainWindow` (from `bootstrap.slint`), the globals, the 16 components and
//! all 5 shell windows. `slint-build` emits exactly one generated file per
//! crate (`OUT_DIR/<entry-stem>.rs`, consumed by `slint::include_modules!`),
//! so a second entry could not be included — the hub has to name everything.

fn main() {
    println!("cargo:rerun-if-changed=src/ui");
    slint_build::compile("src/ui/main.slint").expect("compile main.slint");
}
