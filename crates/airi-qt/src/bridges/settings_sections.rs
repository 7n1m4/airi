// SPDX-License-Identifier: GPL-3.0-or-later
//! Settings sections bridge exposed to QML.
//!
//! One thin controller per typed section defined in
//! [`airi_core::settings`] (added by the P6 settings parity sweep):
//!
//! - [`SpineSettingsController`] — `settings/spine`
//! - [`MmdSettingsController`] — `settings/mmd`
//! - [`Live2dSettingsController`] — `settings/live2d`
//! - [`PositioningSettingsController`] — `settings/positioning` (map of
//!   model id → `{x, y, scale}`; exposed as JSON invokables)
//! - [`AudioDeviceSettingsController`] — `settings/audio-device`
//! - [`UserProfileSettingsController`] — `settings/user-profile`
//!
//! Each controller mirrors its section into `#[qproperty]`s for QML
//! binding, exposes `load()` / `reloadFromStore()` to re-read the
//! persisted blob, and a typed `save(...)` invokable that validates,
//! persists and updates the mirror. Persistence is synchronous SQLite —
//! no async, no blocking on the Qt thread beyond a small local write.
#![allow(clippy::too_many_arguments)]

use std::pin::Pin;

use cxx_qt_lib::QString;

use airi_core::settings::{
    AudioDeviceSettings, Live2dSettings, MmdSettings, PositionScale, PositioningSettings,
    SpineSettings, UserProfileSettings,
};

use crate::bridges::qstring_to_string;

/// cxx-qt bridge definitions for the settings sections bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Spine settings mirror (`settings/spine`).
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(i32, max_fps, cxx_name = "maxFps")]
        #[qproperty(f64, render_scale, cxx_name = "renderScale")]
        #[qproperty(f64, mix_duration, cxx_name = "mixDuration")]
        #[qproperty(f64, animation_speed, cxx_name = "animationSpeed")]
        #[qproperty(bool, idle_animation_enabled, cxx_name = "idleAnimationEnabled")]
        #[qproperty(f64, scale_pos_x, cxx_name = "scalePosX")]
        #[qproperty(f64, scale_pos_y, cxx_name = "scalePosY")]
        #[qproperty(f64, scale_pos_scale, cxx_name = "scalePosScale")]
        type SpineSettingsController = super::SpineSettingsControllerRust;
    }

    extern "RustQt" {
        /// Re-read `settings/spine` into the mirror properties.
        #[qinvokable]
        #[cxx_name = "load"]
        fn load(self: Pin<&mut SpineSettingsController>);

        /// Persist `settings/spine`. `maxFps` is clamped to ≥ 0;
        /// `renderScale`/`animationSpeed` to a finite positive value;
        /// `mixDuration` to a finite value ≥ 0. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "save"]
        fn save(
            self: Pin<&mut SpineSettingsController>,
            max_fps: i32,
            render_scale: f64,
            mix_duration: f64,
            animation_speed: f64,
            idle_animation_enabled: bool,
            scale_pos_x: f64,
            scale_pos_y: f64,
            scale_pos_scale: f64,
        ) -> bool;

        /// Alias for `load()` — re-read the section from the store.
        #[qinvokable]
        #[cxx_name = "reloadFromStore"]
        fn reload_from_store(self: Pin<&mut SpineSettingsController>);
    }

    extern "RustQt" {
        /// MMD settings mirror (`settings/mmd`).
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, mmd_idle_animation_enabled, cxx_name = "mmdIdleAnimationEnabled")]
        #[qproperty(f64, mmd_render_scale, cxx_name = "mmdRenderScale")]
        type MmdSettingsController = super::MmdSettingsControllerRust;
    }

    extern "RustQt" {
        /// Re-read `settings/mmd` into the mirror properties.
        #[qinvokable]
        #[cxx_name = "load"]
        fn load(self: Pin<&mut MmdSettingsController>);

        /// Persist `settings/mmd`. `mmdRenderScale` is clamped to a finite
        /// positive value. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "save"]
        fn save(
            self: Pin<&mut MmdSettingsController>,
            mmd_idle_animation_enabled: bool,
            mmd_render_scale: f64,
        ) -> bool;

        /// Alias for `load()` — re-read the section from the store.
        #[qinvokable]
        #[cxx_name = "reloadFromStore"]
        fn reload_from_store(self: Pin<&mut MmdSettingsController>);
    }

    extern "RustQt" {
        /// Live2D settings mirror (`settings/live2d`).
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, live2d_disable_focus, cxx_name = "live2dDisableFocus")]
        #[qproperty(f64, live2d_follow_speed, cxx_name = "live2dFollowSpeed")]
        #[qproperty(
            bool,
            live2d_idle_animation_enabled,
            cxx_name = "live2dIdleAnimationEnabled"
        )]
        #[qproperty(bool, live2d_auto_blink_enabled, cxx_name = "live2dAutoBlinkEnabled")]
        #[qproperty(
            bool,
            live2d_force_auto_blink_enabled,
            cxx_name = "live2dForceAutoBlinkEnabled"
        )]
        #[qproperty(bool, live2d_shadow_enabled, cxx_name = "live2dShadowEnabled")]
        #[qproperty(i32, live2d_max_fps, cxx_name = "live2dMaxFps")]
        type Live2dSettingsController = super::Live2dSettingsControllerRust;
    }

    extern "RustQt" {
        /// Re-read `settings/live2d` into the mirror properties.
        #[qinvokable]
        #[cxx_name = "load"]
        fn load(self: Pin<&mut Live2dSettingsController>);

        /// Persist `settings/live2d`. `live2dFollowSpeed` is clamped to
        /// 0.0–1.0; `live2dMaxFps` to ≥ 0. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "save"]
        fn save(
            self: Pin<&mut Live2dSettingsController>,
            live2d_disable_focus: bool,
            live2d_follow_speed: f64,
            live2d_idle_animation_enabled: bool,
            live2d_auto_blink_enabled: bool,
            live2d_force_auto_blink_enabled: bool,
            live2d_shadow_enabled: bool,
            live2d_max_fps: i32,
        ) -> bool;

        /// Alias for `load()` — re-read the section from the store.
        #[qinvokable]
        #[cxx_name = "reloadFromStore"]
        fn reload_from_store(self: Pin<&mut Live2dSettingsController>);
    }

    extern "RustQt" {
        /// Positioning settings mirror (`settings/positioning`).
        ///
        /// The section is a map of model id → `{x, y, scale}`; it is not
        /// modelled as qproperties. Use `scaleFor`/`saveScale`/`resetAll`.
        /// `count` is the number of persisted placements.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(i32, count, cxx_name = "count")]
        type PositioningSettingsController = super::PositioningSettingsControllerRust;
    }

    extern "RustQt" {
        /// Re-read `settings/positioning` (updates `count`).
        #[qinvokable]
        #[cxx_name = "load"]
        fn load(self: Pin<&mut PositioningSettingsController>);

        /// Placement for `id` as a JSON string `{"x":..,"y":..,"scale":..}`.
        /// Returns the default `{"x":0,"y":0,"scale":1}` for unknown ids.
        #[qinvokable]
        #[cxx_name = "scaleFor"]
        fn scale_for(self: &PositioningSettingsController, id: QString) -> QString;

        /// Persist the placement for `id`. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "saveScale"]
        fn save_scale(
            self: Pin<&mut PositioningSettingsController>,
            id: QString,
            x: f64,
            y: f64,
            scale: f64,
        ) -> bool;

        /// Clear every persisted placement. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "resetAll"]
        fn reset_all(self: Pin<&mut PositioningSettingsController>) -> bool;

        /// Alias for `load()` — re-read the section from the store.
        #[qinvokable]
        #[cxx_name = "reloadFromStore"]
        fn reload_from_store(self: Pin<&mut PositioningSettingsController>);
    }

    extern "RustQt" {
        /// Audio device settings mirror (`settings/audio-device`).
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, selected_input_device, cxx_name = "selectedInputDevice")]
        #[qproperty(QString, selected_output_device, cxx_name = "selectedOutputDevice")]
        #[qproperty(bool, input_enabled, cxx_name = "inputEnabled")]
        type AudioDeviceSettingsController = super::AudioDeviceSettingsControllerRust;
    }

    extern "RustQt" {
        /// Re-read `settings/audio-device` into the mirror properties.
        #[qinvokable]
        #[cxx_name = "load"]
        fn load(self: Pin<&mut AudioDeviceSettingsController>);

        /// Persist `settings/audio-device`. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "save"]
        fn save(
            self: Pin<&mut AudioDeviceSettingsController>,
            selected_input_device: QString,
            selected_output_device: QString,
            input_enabled: bool,
        ) -> bool;

        /// Alias for `load()` — re-read the section from the store.
        #[qinvokable]
        #[cxx_name = "reloadFromStore"]
        fn reload_from_store(self: Pin<&mut AudioDeviceSettingsController>);
    }

    extern "RustQt" {
        /// User profile settings mirror (`settings/user-profile`).
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, name, cxx_name = "name")]
        #[qproperty(QString, description, cxx_name = "description")]
        #[qproperty(QString, prompt, cxx_name = "prompt")]
        #[qproperty(QString, voice_profile_id, cxx_name = "voiceProfileId")]
        type UserProfileSettingsController = super::UserProfileSettingsControllerRust;
    }

    extern "RustQt" {
        /// Re-read `settings/user-profile` into the mirror properties.
        #[qinvokable]
        #[cxx_name = "load"]
        fn load(self: Pin<&mut UserProfileSettingsController>);

        /// Persist `settings/user-profile`. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "save"]
        fn save(
            self: Pin<&mut UserProfileSettingsController>,
            name: QString,
            description: QString,
            prompt: QString,
            voice_profile_id: QString,
        ) -> bool;

        /// Alias for `load()` — re-read the section from the store.
        #[qinvokable]
        #[cxx_name = "reloadFromStore"]
        fn reload_from_store(self: Pin<&mut UserProfileSettingsController>);
    }
}

fn load_section<S: airi_core::settings::SettingsSection>() -> S {
    crate::bridges::settings_store()
        .and_then(|store| store.load_section::<S>().ok())
        .unwrap_or_default()
}

fn save_section<S: airi_core::settings::SettingsSection>(value: &S) -> anyhow::Result<()> {
    let Some(store) = crate::bridges::settings_store() else {
        anyhow::bail!("settings store not registered");
    };
    store.save_section(value)
}

fn clamp_finite_positive(value: f64, fallback: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        fallback
    }
}

fn clamp_finite_non_negative(value: f64, fallback: f64) -> f64 {
    if value.is_finite() && value >= 0.0 {
        value
    } else {
        fallback
    }
}

fn fps_to_u32(value: i32) -> u32 {
    u32::try_from(value.max(0)).unwrap_or(0)
}

// ============================================================================
// Spine
// ============================================================================

/// Rust storage for `SpineSettingsController`.
pub struct SpineSettingsControllerRust {
    max_fps: i32,
    render_scale: f64,
    mix_duration: f64,
    animation_speed: f64,
    idle_animation_enabled: bool,
    scale_pos_x: f64,
    scale_pos_y: f64,
    scale_pos_scale: f64,
}

impl Default for SpineSettingsControllerRust {
    fn default() -> Self {
        let s = load_section::<SpineSettings>();
        Self {
            max_fps: s.max_fps as i32,
            render_scale: s.render_scale,
            mix_duration: s.mix_duration,
            animation_speed: s.animation_speed,
            idle_animation_enabled: s.idle_animation_enabled,
            scale_pos_x: s.scale_pos.x,
            scale_pos_y: s.scale_pos.y,
            scale_pos_scale: s.scale_pos.scale,
        }
    }
}

impl qobject::SpineSettingsController {
    /// Re-read `settings/spine` into the mirror properties.
    pub fn load(mut self: Pin<&mut Self>) {
        let s = load_section::<SpineSettings>();
        self.as_mut().set_max_fps(s.max_fps as i32);
        self.as_mut().set_render_scale(s.render_scale);
        self.as_mut().set_mix_duration(s.mix_duration);
        self.as_mut().set_animation_speed(s.animation_speed);
        self.as_mut()
            .set_idle_animation_enabled(s.idle_animation_enabled);
        self.as_mut().set_scale_pos_x(s.scale_pos.x);
        self.as_mut().set_scale_pos_y(s.scale_pos.y);
        self.as_mut().set_scale_pos_scale(s.scale_pos.scale);
    }

    /// Persist `settings/spine` with clamping.
    #[allow(clippy::too_many_arguments)]
    pub fn save(
        mut self: Pin<&mut Self>,
        max_fps: i32,
        render_scale: f64,
        mix_duration: f64,
        animation_speed: f64,
        idle_animation_enabled: bool,
        scale_pos_x: f64,
        scale_pos_y: f64,
        scale_pos_scale: f64,
    ) -> bool {
        let section = SpineSettings {
            max_fps: fps_to_u32(max_fps),
            render_scale: clamp_finite_positive(render_scale, 1.0),
            mix_duration: clamp_finite_non_negative(mix_duration, 0.2),
            animation_speed: clamp_finite_positive(animation_speed, 1.0),
            idle_animation_enabled,
            scale_pos: PositionScale {
                x: if scale_pos_x.is_finite() {
                    scale_pos_x
                } else {
                    0.0
                },
                y: if scale_pos_y.is_finite() {
                    scale_pos_y
                } else {
                    0.0
                },
                scale: clamp_finite_positive(scale_pos_scale, 1.0),
            },
        };
        match save_section(&section) {
            Ok(()) => {
                self.as_mut().set_max_fps(section.max_fps as i32);
                self.as_mut().set_render_scale(section.render_scale);
                self.as_mut().set_mix_duration(section.mix_duration);
                self.as_mut().set_animation_speed(section.animation_speed);
                self.as_mut()
                    .set_idle_animation_enabled(section.idle_animation_enabled);
                self.as_mut().set_scale_pos_x(section.scale_pos.x);
                self.as_mut().set_scale_pos_y(section.scale_pos.y);
                self.as_mut().set_scale_pos_scale(section.scale_pos.scale);
                true
            }
            Err(e) => {
                eprintln!("[airi-qt] spine settings: failed to persist settings/spine: {e}");
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(self: Pin<&mut Self>) {
        self.load();
    }
}

// ============================================================================
// MMD
// ============================================================================

/// Rust storage for `MmdSettingsController`.
pub struct MmdSettingsControllerRust {
    mmd_idle_animation_enabled: bool,
    mmd_render_scale: f64,
}

impl Default for MmdSettingsControllerRust {
    fn default() -> Self {
        let s = load_section::<MmdSettings>();
        Self {
            mmd_idle_animation_enabled: s.mmd_idle_animation_enabled,
            mmd_render_scale: s.mmd_render_scale,
        }
    }
}

impl qobject::MmdSettingsController {
    /// Re-read `settings/mmd` into the mirror properties.
    pub fn load(mut self: Pin<&mut Self>) {
        let s = load_section::<MmdSettings>();
        self.as_mut()
            .set_mmd_idle_animation_enabled(s.mmd_idle_animation_enabled);
        self.as_mut().set_mmd_render_scale(s.mmd_render_scale);
    }

    /// Persist `settings/mmd` with clamping.
    pub fn save(
        mut self: Pin<&mut Self>,
        mmd_idle_animation_enabled: bool,
        mmd_render_scale: f64,
    ) -> bool {
        let section = MmdSettings {
            mmd_idle_animation_enabled,
            mmd_render_scale: clamp_finite_positive(mmd_render_scale, 1.0),
        };
        match save_section(&section) {
            Ok(()) => {
                self.as_mut()
                    .set_mmd_idle_animation_enabled(section.mmd_idle_animation_enabled);
                self.as_mut().set_mmd_render_scale(section.mmd_render_scale);
                true
            }
            Err(e) => {
                eprintln!("[airi-qt] mmd settings: failed to persist settings/mmd: {e}");
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(self: Pin<&mut Self>) {
        self.load();
    }
}

// ============================================================================
// Live2D
// ============================================================================

/// Rust storage for `Live2dSettingsController`.
pub struct Live2dSettingsControllerRust {
    live2d_disable_focus: bool,
    live2d_follow_speed: f64,
    live2d_idle_animation_enabled: bool,
    live2d_auto_blink_enabled: bool,
    live2d_force_auto_blink_enabled: bool,
    live2d_shadow_enabled: bool,
    live2d_max_fps: i32,
}

impl Default for Live2dSettingsControllerRust {
    fn default() -> Self {
        let s = load_section::<Live2dSettings>();
        Self {
            live2d_disable_focus: s.live2d_disable_focus,
            live2d_follow_speed: s.live2d_follow_speed,
            live2d_idle_animation_enabled: s.live2d_idle_animation_enabled,
            live2d_auto_blink_enabled: s.live2d_auto_blink_enabled,
            live2d_force_auto_blink_enabled: s.live2d_force_auto_blink_enabled,
            live2d_shadow_enabled: s.live2d_shadow_enabled,
            live2d_max_fps: s.live2d_max_fps as i32,
        }
    }
}

impl qobject::Live2dSettingsController {
    /// Re-read `settings/live2d` into the mirror properties.
    pub fn load(mut self: Pin<&mut Self>) {
        let s = load_section::<Live2dSettings>();
        self.as_mut()
            .set_live2d_disable_focus(s.live2d_disable_focus);
        self.as_mut().set_live2d_follow_speed(s.live2d_follow_speed);
        self.as_mut()
            .set_live2d_idle_animation_enabled(s.live2d_idle_animation_enabled);
        self.as_mut()
            .set_live2d_auto_blink_enabled(s.live2d_auto_blink_enabled);
        self.as_mut()
            .set_live2d_force_auto_blink_enabled(s.live2d_force_auto_blink_enabled);
        self.as_mut()
            .set_live2d_shadow_enabled(s.live2d_shadow_enabled);
        self.as_mut().set_live2d_max_fps(s.live2d_max_fps as i32);
    }

    /// Persist `settings/live2d` with clamping.
    #[allow(clippy::too_many_arguments)]
    pub fn save(
        mut self: Pin<&mut Self>,
        live2d_disable_focus: bool,
        live2d_follow_speed: f64,
        live2d_idle_animation_enabled: bool,
        live2d_auto_blink_enabled: bool,
        live2d_force_auto_blink_enabled: bool,
        live2d_shadow_enabled: bool,
        live2d_max_fps: i32,
    ) -> bool {
        let follow_speed = if live2d_follow_speed.is_finite() {
            live2d_follow_speed.clamp(0.0, 1.0)
        } else {
            0.5
        };
        let section = Live2dSettings {
            live2d_disable_focus,
            live2d_follow_speed: follow_speed,
            live2d_idle_animation_enabled,
            live2d_auto_blink_enabled,
            live2d_force_auto_blink_enabled,
            live2d_shadow_enabled,
            live2d_max_fps: fps_to_u32(live2d_max_fps),
        };
        match save_section(&section) {
            Ok(()) => {
                self.as_mut()
                    .set_live2d_disable_focus(section.live2d_disable_focus);
                self.as_mut()
                    .set_live2d_follow_speed(section.live2d_follow_speed);
                self.as_mut()
                    .set_live2d_idle_animation_enabled(section.live2d_idle_animation_enabled);
                self.as_mut()
                    .set_live2d_auto_blink_enabled(section.live2d_auto_blink_enabled);
                self.as_mut()
                    .set_live2d_force_auto_blink_enabled(section.live2d_force_auto_blink_enabled);
                self.as_mut()
                    .set_live2d_shadow_enabled(section.live2d_shadow_enabled);
                self.as_mut()
                    .set_live2d_max_fps(section.live2d_max_fps as i32);
                true
            }
            Err(e) => {
                eprintln!("[airi-qt] live2d settings: failed to persist settings/live2d: {e}");
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(self: Pin<&mut Self>) {
        self.load();
    }
}

// ============================================================================
// Positioning
// ============================================================================

/// Rust storage for `PositioningSettingsController`.
pub struct PositioningSettingsControllerRust {
    count: i32,
}

impl Default for PositioningSettingsControllerRust {
    fn default() -> Self {
        let s = load_section::<PositioningSettings>();
        Self {
            count: s.models.len() as i32,
        }
    }
}

impl qobject::PositioningSettingsController {
    /// Re-read `settings/positioning` (updates `count`).
    pub fn load(mut self: Pin<&mut Self>) {
        let s = load_section::<PositioningSettings>();
        self.as_mut().set_count(s.models.len() as i32);
    }

    /// Placement for `id` as a JSON string; default for unknown ids.
    pub fn scale_for(&self, id: QString) -> QString {
        let id = qstring_to_string(&id);
        let s = load_section::<PositioningSettings>();
        let placement = s.models.get(id.trim()).copied().unwrap_or_default();
        QString::from(
            serde_json::json!({ "x": placement.x, "y": placement.y, "scale": placement.scale })
                .to_string()
                .as_str(),
        )
    }

    /// Persist the placement for `id`.
    pub fn save_scale(mut self: Pin<&mut Self>, id: QString, x: f64, y: f64, scale: f64) -> bool {
        let id = qstring_to_string(&id);
        let id = id.trim().to_string();
        if id.is_empty() {
            eprintln!("[airi-qt] positioning settings: refusing to persist empty model id");
            return false;
        }
        let mut s = load_section::<PositioningSettings>();
        s.models.insert(
            id,
            PositionScale {
                x: if x.is_finite() { x } else { 0.0 },
                y: if y.is_finite() { y } else { 0.0 },
                scale: clamp_finite_positive(scale, 1.0),
            },
        );
        match save_section(&s) {
            Ok(()) => {
                self.as_mut().set_count(s.models.len() as i32);
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-qt] positioning settings: failed to persist settings/positioning: {e}"
                );
                false
            }
        }
    }

    /// Clear every persisted placement.
    pub fn reset_all(mut self: Pin<&mut Self>) -> bool {
        let s = PositioningSettings::default();
        match save_section(&s) {
            Ok(()) => {
                self.as_mut().set_count(0);
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-qt] positioning settings: failed to reset settings/positioning: {e}"
                );
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(self: Pin<&mut Self>) {
        self.load();
    }
}

// ============================================================================
// Audio device
// ============================================================================

/// Rust storage for `AudioDeviceSettingsController`.
pub struct AudioDeviceSettingsControllerRust {
    selected_input_device: QString,
    selected_output_device: QString,
    input_enabled: bool,
}

impl Default for AudioDeviceSettingsControllerRust {
    fn default() -> Self {
        let s = load_section::<AudioDeviceSettings>();
        Self {
            selected_input_device: QString::from(s.selected_input_device.as_str()),
            selected_output_device: QString::from(s.selected_output_device.as_str()),
            input_enabled: s.input_enabled,
        }
    }
}

impl qobject::AudioDeviceSettingsController {
    /// Re-read `settings/audio-device` into the mirror properties.
    pub fn load(mut self: Pin<&mut Self>) {
        let s = load_section::<AudioDeviceSettings>();
        self.as_mut()
            .set_selected_input_device(QString::from(s.selected_input_device.as_str()));
        self.as_mut()
            .set_selected_output_device(QString::from(s.selected_output_device.as_str()));
        self.as_mut().set_input_enabled(s.input_enabled);
    }

    /// Persist `settings/audio-device`.
    pub fn save(
        mut self: Pin<&mut Self>,
        selected_input_device: QString,
        selected_output_device: QString,
        input_enabled: bool,
    ) -> bool {
        let section = AudioDeviceSettings {
            selected_input_device: qstring_to_string(&selected_input_device),
            selected_output_device: qstring_to_string(&selected_output_device),
            input_enabled,
        };
        match save_section(&section) {
            Ok(()) => {
                self.as_mut().set_selected_input_device(QString::from(
                    section.selected_input_device.as_str(),
                ));
                self.as_mut().set_selected_output_device(QString::from(
                    section.selected_output_device.as_str(),
                ));
                self.as_mut().set_input_enabled(section.input_enabled);
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-qt] audio device settings: failed to persist settings/audio-device: {e}"
                );
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(self: Pin<&mut Self>) {
        self.load();
    }
}

// ============================================================================
// User profile
// ============================================================================

/// Rust storage for `UserProfileSettingsController`.
pub struct UserProfileSettingsControllerRust {
    name: QString,
    description: QString,
    prompt: QString,
    voice_profile_id: QString,
}

impl Default for UserProfileSettingsControllerRust {
    fn default() -> Self {
        let s = load_section::<UserProfileSettings>();
        Self {
            name: QString::from(s.name.as_str()),
            description: QString::from(s.description.as_str()),
            prompt: QString::from(s.prompt.as_str()),
            voice_profile_id: QString::from(s.voice_profile_id.as_str()),
        }
    }
}

impl qobject::UserProfileSettingsController {
    /// Re-read `settings/user-profile` into the mirror properties.
    pub fn load(mut self: Pin<&mut Self>) {
        let s = load_section::<UserProfileSettings>();
        self.as_mut().set_name(QString::from(s.name.as_str()));
        self.as_mut()
            .set_description(QString::from(s.description.as_str()));
        self.as_mut().set_prompt(QString::from(s.prompt.as_str()));
        self.as_mut()
            .set_voice_profile_id(QString::from(s.voice_profile_id.as_str()));
    }

    /// Persist `settings/user-profile`.
    pub fn save(
        mut self: Pin<&mut Self>,
        name: QString,
        description: QString,
        prompt: QString,
        voice_profile_id: QString,
    ) -> bool {
        let section = UserProfileSettings {
            name: qstring_to_string(&name),
            description: qstring_to_string(&description),
            prompt: qstring_to_string(&prompt),
            voice_profile_id: qstring_to_string(&voice_profile_id),
        };
        match save_section(&section) {
            Ok(()) => {
                self.as_mut().set_name(QString::from(section.name.as_str()));
                self.as_mut()
                    .set_description(QString::from(section.description.as_str()));
                self.as_mut()
                    .set_prompt(QString::from(section.prompt.as_str()));
                self.as_mut()
                    .set_voice_profile_id(QString::from(section.voice_profile_id.as_str()));
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-qt] user profile settings: failed to persist settings/user-profile: {e}"
                );
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(self: Pin<&mut Self>) {
        self.load();
    }
}
