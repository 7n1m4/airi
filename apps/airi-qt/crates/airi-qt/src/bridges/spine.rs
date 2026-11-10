// SPDX-License-Identifier: GPL-3.0-or-later
//! Spine stage bridge exposed to QML (`SpineController`).
//!
//! Thin bridge over [`crate::spine_rt`]: parsing, bundle extraction and the
//! spine-cpp session live in `airi-render`; the bridge only shuttles
//! QML-facing calls into it and caches the two display-rate properties the
//! scene-graph item reads every frame.

use cxx_qt_lib::QString;
use std::pin::Pin;

/// cxx-qt bridge definitions for the spine stage bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Spine stage controller exposed to QML.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, loaded)]
        #[qproperty(bool, playing)]
        #[qproperty(i32, max_fps, cxx_name = "maxFps")]
        #[qproperty(f64, render_scale, cxx_name = "renderScale")]
        #[qproperty(f64, mix_seconds, cxx_name = "mixSeconds")]
        #[qproperty(QString, model_path, cxx_name = "modelPath")]
        type SpineController = super::SpineControllerRust;
    }

    extern "RustQt" {
        /// Load a model bundle (`.zip`) or a loose directory with spine
        /// entries; returns true on success.
        #[qinvokable]
        #[cxx_name = "loadModel"]
        fn load_model(self: Pin<&mut SpineController>, path: &QString) -> bool;

        /// Resolve and play an animation on the idle track (track 0) when
        /// `loop_` is true (default), otherwise on the emotion track.
        #[qinvokable]
        fn play(self: Pin<&mut SpineController>, name: &QString, loop_: bool) -> bool;

        /// Trigger the first `hit_*` animation as a one-shot (track 1).
        /// Returns the resolved animation name, or an empty string.
        #[qinvokable]
        fn poke(self: &SpineController) -> QString;

        /// Select a skin by name; false when missing.
        #[qinvokable]
        #[cxx_name = "setSkin"]
        fn set_skin(self: &SpineController, name: &QString) -> bool;

    }
}

/// Rust storage for `SpineController`.
pub struct SpineControllerRust {
    loaded: bool,
    playing: bool,
    max_fps: i32,
    render_scale: f64,
    mix_seconds: f64,
    model_path: QString,
}

impl Default for SpineControllerRust {
    fn default() -> Self {
        Self {
            loaded: false,
            playing: false,
            max_fps: 0, // 0 = unthrottled, matches Vue default
            render_scale: 1.0,
            mix_seconds: 0.2, // Vue defaultMixDuration
            model_path: QString::from(""),
        }
    }
}

impl qobject::SpineController {
    /// Load a bundle and start the idle loop.
    pub fn load_model(mut self: Pin<&mut Self>, path: &QString) -> bool {
        let path_string = crate::bridges::qstring_to_string(path);
        match crate::spine_rt::load_bundle_path(&path_string) {
            Ok(()) => {
                crate::spine_rt::set_default_mix(0.2);
                match crate::spine_rt::play_idle("idle") {
                    Ok(resolved) => {
                        eprintln!("[airi-qt][spine] asset parsed ok ({path_string}), animation [{resolved}] at t=0.000s");
                    }
                    Err(error) => {
                        eprintln!("[airi-qt][spine] idle animation not available: {error:#}");
                    }
                }
                self.as_mut()
                    .set_model_path(QString::from(path_string.as_str()));
                self.as_mut().set_loaded(true);
                self.as_mut().set_playing(true);
                true
            }
            Err(error) => {
                eprintln!("[airi-qt][spine] failed to load {path_string}: {error:#}");
                self.as_mut().set_loaded(false);
                self.as_mut().set_playing(false);
                false
            }
        }
    }

    /// Play an animation by name with resolution fallbacks.
    pub fn play(mut self: Pin<&mut Self>, name: &QString, loop_: bool) -> bool {
        let track = if loop_ {
            airi_render::spine::animation::IDLE_TRACK
        } else {
            airi_render::spine::animation::EMOTION_TRACK
        };
        let name = crate::bridges::qstring_to_string(name);
        match crate::spine_rt::play(track, &name, loop_) {
            Ok(resolved) => {
                eprintln!("[airi-qt][spine] playing [{resolved}] on track {track} (loop={loop_})");
                if loop_ {
                    self.as_mut().set_playing(true);
                }
                true
            }
            Err(error) => {
                eprintln!("[airi-qt][spine] play failed: {error:#}");
                false
            }
        }
    }

    /// Poke the model: play the first `hit_*` animation one-shot.
    pub fn poke(&self) -> QString {
        match crate::spine_rt::poke() {
            Ok(Some(hit)) => {
                eprintln!("[airi-qt][spine] poke -> [{hit}]");
                QString::from(hit.as_str())
            }
            Ok(None) => {
                eprintln!("[airi-qt][spine] poke ignored: no hit_* animation on skeleton");
                QString::from("")
            }
            Err(error) => {
                eprintln!("[airi-qt][spine] poke failed: {error:#}");
                QString::from("")
            }
        }
    }

    /// Select a skin by name.
    pub fn set_skin(&self, name: &QString) -> bool {
        let name = crate::bridges::qstring_to_string(name);
        match crate::spine_rt::set_skin(&name) {
            Ok(ok) => ok,
            Err(error) => {
                eprintln!("[airi-qt][spine] set_skin failed: {error:#}");
                false
            }
        }
    }
}
