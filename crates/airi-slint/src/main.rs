// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! airi-slint: Slint-based desktop shell for AIRI (Rust port of the former
//! Qt Quick shell).
//!
//! The spine render seam is the first slice: the shared `spine_rt` session
//! produces CPU-rasterized frames (`spine_render`) that the `SpineStage`
//! Slint component displays. The full shell (chat, settings, control strip)
//! is wired in later tracks.
//!
//! `--smoke` loads the bundled synthetic spine asset, ticks a few frames and
//! renders one frame; `--spine-model <path>` loads a bundle for interactive
//! use.

use airi_slint::bridges::spine::with_controller;
use airi_slint::spine_rt;

/// CLI flags for the spike.
#[derive(Debug, Default)]
struct Cli {
    /// Run the headless smoke check and exit.
    smoke: bool,
    /// Load this spine bundle before showing the stage.
    spine_model: Option<String>,
}

fn main() {
    let cli = parse_cli(std::env::args().skip(1));
    if cli.smoke {
        std::process::exit(i32::from(!spine_rt::spine_smoke_check()));
    }
    if let Some(path) = &cli.spine_model {
        let ok = with_controller(|c| c.load_model(path));
        eprintln!("[airi-slint] load_model({path}) -> {ok}");
    }

    // The Slint window + render timer wiring lands with the shell track; the
    // spine seam itself is proven by `cargo test -p airi-slint --lib
    // spine_render` (see spine_render.rs).
    eprintln!("[airi-slint] spine seam ready; window wiring pending shell track");
}

/// Parse the handful of CLI flags the spike understands.
fn parse_cli(args: impl Iterator<Item = String>) -> Cli {
    let mut cli = Cli::default();
    let mut iter = args.peekable();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--smoke" => cli.smoke = true,
            "--spine-model" => cli.spine_model = iter.next(),
            other => eprintln!("[airi-slint] unknown argument: {other}"),
        }
    }
    cli
}