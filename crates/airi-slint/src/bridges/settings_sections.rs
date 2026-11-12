// SPDX-License-Identifier: GPL-3.0-or-later
//! Settings sections bridge exposed to Slint.
//!
//! One thin state type per typed section defined in
//! [`airi_core::settings`] (added by the P6 settings parity sweep):
//!
//! - [`SpineSettingsState`] — `settings/spine`
//! - [`MmdSettingsState`] — `settings/mmd`
//! - [`Live2dSettingsState`] — `settings/live2d`
//! - [`PositioningSettingsState`] — `settings/positioning` (map of
//!   model id → `{x, y, scale}`; exposed as JSON methods)
//! - [`AudioDeviceSettingsState`] — `settings/audio-device`
//! - [`UserProfileSettingsState`] — `settings/user-profile`
//!
//! Each state mirrors its section into plain fields for UI binding,
//! exposes `load()` / `reload_from_store()` to re-read the persisted blob,
//! and a typed `save(...)` method that validates, persists and updates the
//! mirror. Persistence is synchronous SQLite — no async, no blocking on the
//! UI thread beyond a small local write.
#![allow(clippy::too_many_arguments)]

use std::sync::Mutex;

use airi_core::settings::{
    AudioDeviceSettings, Live2dSettings, MmdSettings, PositionScale, PositioningSettings,
    SpineSettings, UserProfileSettings,
};

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

fn lock_state<T>(state: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match state.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

// ============================================================================
// Spine
// ============================================================================

/// Spine settings mirror (`settings/spine`).
pub struct SpineSettingsState {
    pub max_fps: i32,
    pub render_scale: f64,
    pub mix_duration: f64,
    pub animation_speed: f64,
    pub idle_animation_enabled: bool,
    pub scale_pos_x: f64,
    pub scale_pos_y: f64,
    pub scale_pos_scale: f64,
}

impl Default for SpineSettingsState {
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

static SPINE_STATE: Mutex<SpineSettingsState> = Mutex::new(SpineSettingsState {
    max_fps: 0,
    render_scale: 0.0,
    mix_duration: 0.0,
    animation_speed: 0.0,
    idle_animation_enabled: false,
    scale_pos_x: 0.0,
    scale_pos_y: 0.0,
    scale_pos_scale: 0.0,
});

/// Lock the process-wide `settings/spine` state.
pub fn with_spine_state<R>(f: impl FnOnce(&mut SpineSettingsState) -> R) -> R {
    f(&mut lock_state(&SPINE_STATE))
}

impl SpineSettingsState {
    /// Re-read `settings/spine` into the mirror properties.
    pub fn load(&mut self) {
        let s = load_section::<SpineSettings>();
        self.max_fps = s.max_fps as i32;
        self.render_scale = s.render_scale;
        self.mix_duration = s.mix_duration;
        self.animation_speed = s.animation_speed;
        self.idle_animation_enabled = s.idle_animation_enabled;
        self.scale_pos_x = s.scale_pos.x;
        self.scale_pos_y = s.scale_pos.y;
        self.scale_pos_scale = s.scale_pos.scale;
    }

    /// Persist `settings/spine` with clamping.
    #[allow(clippy::too_many_arguments)]
    pub fn save(
        &mut self,
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
                self.max_fps = section.max_fps as i32;
                self.render_scale = section.render_scale;
                self.mix_duration = section.mix_duration;
                self.animation_speed = section.animation_speed;
                self.idle_animation_enabled = section.idle_animation_enabled;
                self.scale_pos_x = section.scale_pos.x;
                self.scale_pos_y = section.scale_pos.y;
                self.scale_pos_scale = section.scale_pos.scale;
                true
            }
            Err(e) => {
                eprintln!("[airi-slint] spine settings: failed to persist settings/spine: {e}");
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(&mut self) {
        self.load();
    }
}

// ============================================================================
// MMD
// ============================================================================

/// MMD settings mirror (`settings/mmd`).
pub struct MmdSettingsState {
    pub mmd_idle_animation_enabled: bool,
    pub mmd_render_scale: f64,
}

impl Default for MmdSettingsState {
    fn default() -> Self {
        let s = load_section::<MmdSettings>();
        Self {
            mmd_idle_animation_enabled: s.mmd_idle_animation_enabled,
            mmd_render_scale: s.mmd_render_scale,
        }
    }
}

static MMD_STATE: Mutex<MmdSettingsState> = Mutex::new(MmdSettingsState {
    mmd_idle_animation_enabled: false,
    mmd_render_scale: 0.0,
});

/// Lock the process-wide `settings/mmd` state.
pub fn with_mmd_state<R>(f: impl FnOnce(&mut MmdSettingsState) -> R) -> R {
    f(&mut lock_state(&MMD_STATE))
}

impl MmdSettingsState {
    /// Re-read `settings/mmd` into the mirror properties.
    pub fn load(&mut self) {
        let s = load_section::<MmdSettings>();
        self.mmd_idle_animation_enabled = s.mmd_idle_animation_enabled;
        self.mmd_render_scale = s.mmd_render_scale;
    }

    /// Persist `settings/mmd` with clamping.
    pub fn save(&mut self, mmd_idle_animation_enabled: bool, mmd_render_scale: f64) -> bool {
        let section = MmdSettings {
            mmd_idle_animation_enabled,
            mmd_render_scale: clamp_finite_positive(mmd_render_scale, 1.0),
        };
        match save_section(&section) {
            Ok(()) => {
                self.mmd_idle_animation_enabled = section.mmd_idle_animation_enabled;
                self.mmd_render_scale = section.mmd_render_scale;
                true
            }
            Err(e) => {
                eprintln!("[airi-slint] mmd settings: failed to persist settings/mmd: {e}");
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(&mut self) {
        self.load();
    }
}

// ============================================================================
// Live2D
// ============================================================================

/// Live2D settings mirror (`settings/live2d`).
pub struct Live2dSettingsState {
    pub live2d_disable_focus: bool,
    pub live2d_follow_speed: f64,
    pub live2d_idle_animation_enabled: bool,
    pub live2d_auto_blink_enabled: bool,
    pub live2d_force_auto_blink_enabled: bool,
    pub live2d_shadow_enabled: bool,
    pub live2d_max_fps: i32,
}

impl Default for Live2dSettingsState {
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

static LIVE2D_STATE: Mutex<Live2dSettingsState> = Mutex::new(Live2dSettingsState {
    live2d_disable_focus: false,
    live2d_follow_speed: 0.0,
    live2d_idle_animation_enabled: false,
    live2d_auto_blink_enabled: false,
    live2d_force_auto_blink_enabled: false,
    live2d_shadow_enabled: false,
    live2d_max_fps: 0,
});

/// Lock the process-wide `settings/live2d` state.
pub fn with_live2d_state<R>(f: impl FnOnce(&mut Live2dSettingsState) -> R) -> R {
    f(&mut lock_state(&LIVE2D_STATE))
}

impl Live2dSettingsState {
    /// Re-read `settings/live2d` into the mirror properties.
    pub fn load(&mut self) {
        let s = load_section::<Live2dSettings>();
        self.live2d_disable_focus = s.live2d_disable_focus;
        self.live2d_follow_speed = s.live2d_follow_speed;
        self.live2d_idle_animation_enabled = s.live2d_idle_animation_enabled;
        self.live2d_auto_blink_enabled = s.live2d_auto_blink_enabled;
        self.live2d_force_auto_blink_enabled = s.live2d_force_auto_blink_enabled;
        self.live2d_shadow_enabled = s.live2d_shadow_enabled;
        self.live2d_max_fps = s.live2d_max_fps as i32;
    }

    /// Persist `settings/live2d` with clamping.
    #[allow(clippy::too_many_arguments)]
    pub fn save(
        &mut self,
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
                self.live2d_disable_focus = section.live2d_disable_focus;
                self.live2d_follow_speed = section.live2d_follow_speed;
                self.live2d_idle_animation_enabled = section.live2d_idle_animation_enabled;
                self.live2d_auto_blink_enabled = section.live2d_auto_blink_enabled;
                self.live2d_force_auto_blink_enabled = section.live2d_force_auto_blink_enabled;
                self.live2d_shadow_enabled = section.live2d_shadow_enabled;
                self.live2d_max_fps = section.live2d_max_fps as i32;
                true
            }
            Err(e) => {
                eprintln!("[airi-slint] live2d settings: failed to persist settings/live2d: {e}");
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(&mut self) {
        self.load();
    }
}

// ============================================================================
// Positioning
// ============================================================================

/// Positioning settings mirror (`settings/positioning`).
///
/// The section is a map of model id → `{x, y, scale}`; it is not
/// modelled as fields. Use `scale_for`/`save_scale`/`reset_all`.
/// `count` is the number of persisted placements.
pub struct PositioningSettingsState {
    pub count: i32,
}

impl Default for PositioningSettingsState {
    fn default() -> Self {
        let s = load_section::<PositioningSettings>();
        Self {
            count: s.models.len() as i32,
        }
    }
}

static POSITIONING_STATE: Mutex<PositioningSettingsState> =
    Mutex::new(PositioningSettingsState { count: 0 });

/// Lock the process-wide `settings/positioning` state.
pub fn with_positioning_state<R>(f: impl FnOnce(&mut PositioningSettingsState) -> R) -> R {
    f(&mut lock_state(&POSITIONING_STATE))
}

impl PositioningSettingsState {
    /// Re-read `settings/positioning` (updates `count`).
    pub fn load(&mut self) {
        let s = load_section::<PositioningSettings>();
        self.count = s.models.len() as i32;
    }

    /// Placement for `id` as a JSON string; default for unknown ids.
    pub fn scale_for(&self, id: &str) -> String {
        let s = load_section::<PositioningSettings>();
        let placement = s.models.get(id.trim()).copied().unwrap_or_default();
        serde_json::json!({ "x": placement.x, "y": placement.y, "scale": placement.scale })
            .to_string()
    }

    /// Persist the placement for `id`.
    pub fn save_scale(&mut self, id: &str, x: f64, y: f64, scale: f64) -> bool {
        let id = id.trim().to_string();
        if id.is_empty() {
            eprintln!("[airi-slint] positioning settings: refusing to persist empty model id");
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
                self.count = s.models.len() as i32;
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-slint] positioning settings: failed to persist settings/positioning: {e}"
                );
                false
            }
        }
    }

    /// Clear every persisted placement.
    pub fn reset_all(&mut self) -> bool {
        let s = PositioningSettings::default();
        match save_section(&s) {
            Ok(()) => {
                self.count = 0;
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-slint] positioning settings: failed to reset settings/positioning: {e}"
                );
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(&mut self) {
        self.load();
    }
}

// ============================================================================
// Audio device
// ============================================================================

/// Audio device settings mirror (`settings/audio-device`).
pub struct AudioDeviceSettingsState {
    pub selected_input_device: String,
    pub selected_output_device: String,
    pub input_enabled: bool,
}

impl Default for AudioDeviceSettingsState {
    fn default() -> Self {
        let s = load_section::<AudioDeviceSettings>();
        Self {
            selected_input_device: s.selected_input_device,
            selected_output_device: s.selected_output_device,
            input_enabled: s.input_enabled,
        }
    }
}

static AUDIO_DEVICE_STATE: Mutex<AudioDeviceSettingsState> = Mutex::new(AudioDeviceSettingsState {
    selected_input_device: String::new(),
    selected_output_device: String::new(),
    input_enabled: false,
});

/// Lock the process-wide `settings/audio-device` state.
pub fn with_audio_device_state<R>(f: impl FnOnce(&mut AudioDeviceSettingsState) -> R) -> R {
    f(&mut lock_state(&AUDIO_DEVICE_STATE))
}

impl AudioDeviceSettingsState {
    /// Re-read `settings/audio-device` into the mirror properties.
    pub fn load(&mut self) {
        let s = load_section::<AudioDeviceSettings>();
        self.selected_input_device = s.selected_input_device;
        self.selected_output_device = s.selected_output_device;
        self.input_enabled = s.input_enabled;
    }

    /// Persist `settings/audio-device`.
    pub fn save(
        &mut self,
        selected_input_device: &str,
        selected_output_device: &str,
        input_enabled: bool,
    ) -> bool {
        let section = AudioDeviceSettings {
            selected_input_device: selected_input_device.to_string(),
            selected_output_device: selected_output_device.to_string(),
            input_enabled,
        };
        match save_section(&section) {
            Ok(()) => {
                self.selected_input_device = section.selected_input_device;
                self.selected_output_device = section.selected_output_device;
                self.input_enabled = section.input_enabled;
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-slint] audio device settings: failed to persist settings/audio-device: {e}"
                );
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(&mut self) {
        self.load();
    }
}

// ============================================================================
// User profile
// ============================================================================

/// User profile settings mirror (`settings/user-profile`).
pub struct UserProfileSettingsState {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub voice_profile_id: String,
}

impl Default for UserProfileSettingsState {
    fn default() -> Self {
        let s = load_section::<UserProfileSettings>();
        Self {
            name: s.name,
            description: s.description,
            prompt: s.prompt,
            voice_profile_id: s.voice_profile_id,
        }
    }
}

static USER_PROFILE_STATE: Mutex<UserProfileSettingsState> = Mutex::new(UserProfileSettingsState {
    name: String::new(),
    description: String::new(),
    prompt: String::new(),
    voice_profile_id: String::new(),
});

/// Lock the process-wide `settings/user-profile` state.
pub fn with_user_profile_state<R>(f: impl FnOnce(&mut UserProfileSettingsState) -> R) -> R {
    f(&mut lock_state(&USER_PROFILE_STATE))
}

impl UserProfileSettingsState {
    /// Re-read `settings/user-profile` into the mirror properties.
    pub fn load(&mut self) {
        let s = load_section::<UserProfileSettings>();
        self.name = s.name;
        self.description = s.description;
        self.prompt = s.prompt;
        self.voice_profile_id = s.voice_profile_id;
    }

    /// Persist `settings/user-profile`.
    pub fn save(
        &mut self,
        name: &str,
        description: &str,
        prompt: &str,
        voice_profile_id: &str,
    ) -> bool {
        let section = UserProfileSettings {
            name: name.to_string(),
            description: description.to_string(),
            prompt: prompt.to_string(),
            voice_profile_id: voice_profile_id.to_string(),
        };
        match save_section(&section) {
            Ok(()) => {
                self.name = section.name;
                self.description = section.description;
                self.prompt = section.prompt;
                self.voice_profile_id = section.voice_profile_id;
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-slint] user profile settings: failed to persist settings/user-profile: {e}"
                );
                false
            }
        }
    }

    /// Alias for `load()`.
    pub fn reload_from_store(&mut self) {
        self.load();
    }
}
