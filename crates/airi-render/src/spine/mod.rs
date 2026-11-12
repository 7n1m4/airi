// SPDX-License-Identifier: GPL-3.0-or-later
//! Spine runtime binding and parsers.
//!
//! * [`atlas`] — pure-Rust texture atlas parser.
//! * [`skeleton`] — minimal typed view over `.json` skeletons.
//! * [`version`] — runtime bucket detection (`4.0` / `4.1` / `4.2`).
//! * [`animation`] — track conventions and name resolution (Vue semantics).
//! * [`session`] — safe wrapper over the vendored spine-cpp via the C ABI
//!   shell in `cpp/spine_shell.{h,cpp}`.

pub mod animation;
pub mod atlas;
pub mod session;
pub mod skeleton;
pub mod version;

pub use animation::{resolve_animation, resolve_idle, EMOTION_TRACK, IDLE_TRACK};
pub use atlas::{parse_atlas, Atlas, AtlasPage, AtlasRegion};
pub use session::{Bounds, DrawData, DrawGroup, DrawVertex, PageInfo, SpineSession};
pub use skeleton::{animation_name_durations, parse_skeleton_json, SkeletonSummary};
pub use version::{detect_version_binary, detect_version_json};
