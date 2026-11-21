// SPDX-License-Identifier: GPL-3.0-or-later
//! airi-slint library: Slint-based desktop shell for AIRI. Holds the spine
//! render seam; the wider shell (chat, settings, control strip) is wired in
//! later tracks.

pub mod bridges;
pub mod daemon_mode;
pub mod spine_render;
pub mod spine_rt;

slint::include_modules!();
