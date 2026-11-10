// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! AIRi Qt renderer crate.
//!
//! P0: seeded from `apps/stage-qt/src/vrm/**`.

pub mod bundle;
pub mod spine;
pub mod vrm;

pub use vrm::*;
