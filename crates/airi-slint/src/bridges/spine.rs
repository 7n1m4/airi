// SPDX-License-Identifier: GPL-3.0-or-later
//! Spine stage controller exposed to Slint (`SpineController` in
//! `ui/SpineStage.slint`).
//!
//! Thin bridge over [`crate::spine_rt`]: parsing, bundle extraction and the
//! spine-cpp session live in `airi-render`; the bridge only shuttles
//! UI-facing calls into it and caches the display-rate properties the stage
//! reads every frame. (Port of the former cxx-qt `SpineController`.)

use std::sync::Mutex;

use crate::spine_rt;

/// Shared controller state; mirrors the UI-facing `SpineController`.
#[derive(Debug, Default)]
pub struct SpineControllerState {
    /// True after a successful `load_model`.
    pub loaded: bool,
    /// True while the idle track is looping.
    pub playing: bool,
    /// 0 = unthrottled; otherwise frames per second cap.
    pub max_fps: i32,
    /// User-facing render resolution multiplier (1.0 = native).
    pub render_scale: f32,
    /// Animation-state default mix (seconds).
    pub mix_seconds: f32,
    /// Path of the loaded model bundle.
    pub model_path: String,
}

/// Process-wide controller guarded by a mutex.
static CONTROLLER: Mutex<SpineControllerState> = Mutex::new(SpineControllerState {
    loaded: false,
    playing: false,
    max_fps: 0,
    render_scale: 1.0,
    mix_seconds: 0.2,
    model_path: String::new(),
});

impl SpineControllerState {
    /// Load a model bundle (`.zip`) or a loose directory with spine entries;
    /// starts the idle loop. Returns true on success.
    pub fn load_model(&mut self, path: &str) -> bool {
        match spine_rt::load_bundle_path(path) {
            Ok(()) => {
                spine_rt::set_default_mix(self.mix_seconds);
                match spine_rt::play_idle("idle") {
                    Ok(resolved) => eprintln!(
                        "[airi-slint][spine] asset parsed ok ({path}), animation [{resolved}] at t=0.000s"
                    ),
                    Err(error) => eprintln!(
                        "[airi-slint][spine] idle animation not available: {error:#}"
                    ),
                }
                self.model_path = path.to_string();
                self.loaded = true;
                self.playing = true;
                true
            }
            Err(error) => {
                eprintln!("[airi-slint][spine] failed to load {path}: {error:#}");
                self.loaded = false;
                self.playing = false;
                false
            }
        }
    }

    /// Play an animation by name with resolution fallbacks.
    pub fn play(&mut self, name: &str, loop_: bool) -> bool {
        let track = if loop_ {
            airi_render::spine::animation::IDLE_TRACK
        } else {
            airi_render::spine::animation::EMOTION_TRACK
        };
        match spine_rt::play(track, name, loop_) {
            Ok(resolved) => {
                eprintln!(
                    "[airi-slint][spine] playing [{resolved}] on track {track} (loop={loop_})"
                );
                if loop_ {
                    self.playing = true;
                }
                true
            }
            Err(error) => {
                eprintln!("[airi-slint][spine] play failed: {error:#}");
                false
            }
        }
    }

    /// Poke the model: play the first `hit_*` animation one-shot. Returns the
    /// resolved animation name, or an empty string.
    pub fn poke(&mut self) -> String {
        match spine_rt::poke() {
            Ok(Some(hit)) => {
                eprintln!("[airi-slint][spine] poke -> [{hit}]");
                hit
            }
            Ok(None) => {
                eprintln!("[airi-slint][spine] poke ignored: no hit_* animation on skeleton");
                String::new()
            }
            Err(error) => {
                eprintln!("[airi-slint][spine] poke failed: {error:#}");
                String::new()
            }
        }
    }

    /// Select a skin by name; false when missing.
    pub fn set_skin(&mut self, name: &str) -> bool {
        match spine_rt::set_skin(name) {
            Ok(ok) => ok,
            Err(error) => {
                eprintln!("[airi-slint][spine] set_skin failed: {error:#}");
                false
            }
        }
    }
}

/// Lock the process-wide controller for a UI-thread operation.
pub fn with_controller<R>(f: impl FnOnce(&mut SpineControllerState) -> R) -> R {
    let mut guard = CONTROLLER.lock().expect("spine controller poisoned");
    f(&mut guard)
}