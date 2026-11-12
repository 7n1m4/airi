// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Typed settings sections with SQLite persistence.
//!
//! Each section is stored as a single JSON blob under the `airi-store`
//! settings table, keyed with the Electron app's `settings/<group>` namespace
//! (e.g. `settings/chat`, `settings/theme`, `settings/control-strip`). The
//! blob fields use the Electron/TS camelCase names so the shapes stay
//! recognizable to the original codebase.
//!
//! The Electron app persisted each setting under a flat key
//! (`settings/chat/send-mode`, ...); the desktop port stores one typed blob
//! per section instead. A 1:1 flat-key migration is intentionally out of
//! scope (desktop-only port). Unknown fields inside a blob are rejected at
//! the type boundary, and missing fields fall back to the defaults below.
//!
//! Saving emits [`crate::CoreEvent::SettingsChanged`] on the core broadcast
//! bus so Qt/UI layers can react without polling.

use airi_store::{Database, SettingsRepo};
use anyhow::Result;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::broadcast;

use crate::CoreEvent;

/// A typed settings section persisted as one JSON blob under a single key.
pub trait SettingsSection: Serialize + DeserializeOwned + Default + Send + Sync {
    /// Storage key (Electron `settings/<group>` namespace).
    const KEY: &'static str;
}

/// Typed settings store wrapping [`SettingsRepo`].
///
/// Cheap to clone (shares the database and the event bus).
#[derive(Clone)]
pub struct SettingsStore {
    repo: SettingsRepo,
    bus: broadcast::Sender<CoreEvent>,
}

impl SettingsStore {
    /// Create a settings store backed by `db`, broadcasting changes on `bus`.
    pub fn new(db: Database, bus: broadcast::Sender<CoreEvent>) -> Self {
        Self {
            repo: SettingsRepo::new(db),
            bus,
        }
    }

    /// Load a typed value by key; `Ok(None)` when unset.
    pub fn load_opt<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        self.repo.get(key)
    }

    /// Load a typed value by key, falling back to `T::default()` when unset.
    pub fn load<T: DeserializeOwned + Default>(&self, key: &str) -> Result<T> {
        Ok(self.repo.get(key)?.unwrap_or_default())
    }

    /// Save a typed value under `key` and emit [`CoreEvent::SettingsChanged`].
    pub fn save<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        self.repo.set(key, value)?;
        let _ = self.bus.send(CoreEvent::SettingsChanged {
            key: key.to_string(),
        });
        Ok(())
    }

    /// Load a typed section using its [`SettingsSection::KEY`].
    pub fn load_section<S: SettingsSection>(&self) -> Result<S> {
        self.load(S::KEY)
    }

    /// Save a typed section using its [`SettingsSection::KEY`].
    pub fn save_section<S: SettingsSection>(&self, value: &S) -> Result<()> {
        self.save(S::KEY, value)
    }

    /// Delete a setting by key. Returns `true` when a row was removed.
    pub fn delete(&self, key: &str) -> Result<bool> {
        self.repo.delete(key)
    }

    /// List all setting keys, optionally filtered by prefix.
    pub fn list_keys(&self, prefix: Option<&str>) -> Result<Vec<String>> {
        self.repo.list_keys(prefix)
    }
}

fn default_true() -> bool {
    true
}

// ============================================================================
// General
// ============================================================================

/// General app settings (`settings/general`).
///
/// Maps the flat Electron keys `settings/language`, `settings/disable-transitions`,
/// `settings/use-page-specific-transitions`, `settings/privacy/remote-sync-enabled`,
/// and `settings/websocket/secure-enabled` into one typed blob.
///
/// `autostart` (P8 lane 1) is an additive mirror of the OS-level autostart
/// state (XDG autostart `.desktop` on Linux, registry Run key on Windows,
/// LaunchAgent on macOS). The OS entry itself is managed by the Qt shell
/// (`DesktopController.setAutostart`); this field only persists the last
/// applied preference. It is deliberately not a new settings section.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    /// Interface language; empty string means "use system default".
    #[serde(default)]
    pub language: String,
    /// Disable all page transition animations.
    #[serde(default = "default_true")]
    pub disable_transitions: bool,
    /// Use page-specific transitions instead of global ones.
    #[serde(default = "default_true")]
    pub use_page_specific_transitions: bool,
    /// Allow privacy-sensitive diagnostics to be synced remotely.
    #[serde(default)]
    pub remote_sync_enabled: bool,
    /// Use `wss://` (instead of `ws://`) for the built-in websocket server.
    #[serde(default)]
    pub websocket_secure_enabled: bool,
    /// Whether the app launches at OS login. Mirrors the OS-level entry;
    /// applied through the Qt shell, not by the settings store.
    #[serde(default)]
    pub autostart: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            language: String::new(),
            disable_transitions: true,
            use_page_specific_transitions: true,
            remote_sync_enabled: false,
            websocket_secure_enabled: false,
            autostart: false,
        }
    }
}

impl SettingsSection for GeneralSettings {
    const KEY: &'static str = "settings/general";
}

// ============================================================================
// Chat
// ============================================================================

/// How the chat input sends messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChatSendMode {
    /// Plain `Enter` sends.
    #[default]
    Enter,
    /// `Ctrl+Enter` sends.
    CtrlEnter,
    /// Double-tap `Enter` sends.
    DoubleEnter,
}

/// How suggested/ghost prompts are accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChatSuggestMode {
    /// Accept suggestion with `Enter`.
    Enter,
    /// Accept suggestion with `Ctrl+Enter`.
    CtrlEnter,
    /// Accept suggestion with a double `Enter`.
    #[default]
    DoubleEnter,
    /// Never suggest.
    Disabled,
}

/// Chat settings (`settings/chat`).
///
/// Maps the Electron keys `settings/chat/send-mode`,
/// `settings/chat/suggest-mode`, `settings/chat/stream-idle-timeout-ms`,
/// `settings/chat/show-director-notes`, and
/// `settings/chat/combine-system-messages`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSettings {
    /// Send shortcut.
    #[serde(default)]
    pub send_mode: ChatSendMode,
    /// Suggestion-accept shortcut.
    #[serde(default)]
    pub suggest_mode: ChatSuggestMode,
    /// Abort a streaming response after this many milliseconds of silence.
    #[serde(default = "default_stream_idle_timeout_ms")]
    pub stream_idle_timeout_ms: u64,
    /// Show director notes in the chat view.
    #[serde(default = "default_true")]
    pub show_director_notes: bool,
    /// Combine consecutive system messages before sending to the model.
    #[serde(default)]
    pub combine_system_messages: bool,
}

fn default_stream_idle_timeout_ms() -> u64 {
    600_000
}

impl Default for ChatSettings {
    fn default() -> Self {
        Self {
            send_mode: ChatSendMode::Enter,
            suggest_mode: ChatSuggestMode::DoubleEnter,
            stream_idle_timeout_ms: default_stream_idle_timeout_ms(),
            show_director_notes: true,
            combine_system_messages: false,
        }
    }
}

impl SettingsSection for ChatSettings {
    const KEY: &'static str = "settings/chat";
}

// ============================================================================
// Theme
// ============================================================================

fn default_hue() -> f64 {
    220.44
}

fn default_chroma_multiplier() -> f64 {
    1.0
}

/// Theme color settings (`settings/theme`).
///
/// Maps the Electron keys `settings/theme/colors/hue`,
/// `settings/theme/colors/hue-dynamic`, and
/// `settings/theme/colors/chroma-multiplier`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSettings {
    /// Primary accent hue in OKLCH degrees.
    #[serde(default = "default_hue")]
    pub hue: f64,
    /// Derive the accent hue dynamically from the active background image.
    #[serde(default)]
    pub hue_dynamic: bool,
    /// Chroma multiplier applied to the generated OKLCH colors (0.0–2.0).
    #[serde(default = "default_chroma_multiplier")]
    pub chroma_multiplier: f64,
    /// Dark mode (P2 Wave A additive; Electron keeps dark-only defaults).
    #[serde(default = "default_true")]
    pub dark: bool,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            hue: default_hue(),
            hue_dynamic: false,
            chroma_multiplier: default_chroma_multiplier(),
            dark: default_true(),
        }
    }
}

impl SettingsSection for ThemeSettings {
    const KEY: &'static str = "settings/theme";
}

// ============================================================================
// Control strip
// ============================================================================

/// Orientation of the control strip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ControlStripOrientation {
    /// Horizontal strip.
    Horizontal,
    /// Vertical strip (default).
    #[default]
    Vertical,
}

/// Interaction mode of the stage when the control strip is in control.
///
/// Wire values match the Electron literals (`'positionMode'`, `'dragMode'`,
/// `'tactileMode'`, `'orbitMode'`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum ControlStripStageMode {
    /// Drag-positioning mode.
    #[serde(rename = "positionMode")]
    Position,
    /// Free-drag mode.
    #[serde(rename = "dragMode")]
    Drag,
    /// Tactile (default) mode.
    #[default]
    #[serde(rename = "tactileMode")]
    Tactile,
    /// Orbit-camera mode.
    #[serde(rename = "orbitMode")]
    Orbit,
}

/// Edge the strip docks to when collapsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ControlStripDockedEdge {
    /// Left edge.
    Left,
    /// Right edge (default).
    #[default]
    Right,
    /// Top edge.
    Top,
    /// Bottom edge.
    Bottom,
}

/// Free-floating strip position in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlStripPosition {
    /// Horizontal offset in pixels.
    pub x: f64,
    /// Vertical offset in pixels.
    pub y: f64,
}

impl Default for ControlStripPosition {
    fn default() -> Self {
        Self { x: 20.0, y: 150.0 }
    }
}

/// One button in the control strip catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlStripButton {
    /// Stable button id (e.g. `chat`, `actor-characters`).
    pub id: String,
    /// Whether the button is shown.
    pub enabled: bool,
    /// User-facing label.
    pub label: String,
    /// Icon class (Iconify).
    pub icon: String,
}

/// Catalog version written by the Electron app for `settings/control-strip/buttons`.
///
/// Bumping it wipes user customizations back to defaults in the Electron
/// build; keep it in sync when the default catalog changes.
pub const CONTROL_STRIP_BUTTONS_VERSION: &str = "v5";

fn default_button(id: &str, label: &str, icon: &str) -> ControlStripButton {
    ControlStripButton {
        id: id.to_string(),
        enabled: true,
        label: label.to_string(),
        icon: icon.to_string(),
    }
}

fn optional_button(id: &str, label: &str, icon: &str) -> ControlStripButton {
    ControlStripButton {
        enabled: false,
        ..default_button(id, label, icon)
    }
}

/// Default desktop (tamagotchi) control strip catalog, in display order.
pub fn default_control_strip_buttons() -> Vec<ControlStripButton> {
    vec![
        default_button("chat", "Chat Toggle", "i-solar:chat-line-linear"),
        default_button(
            "actor-characters",
            "Characters",
            "i-solar:users-group-rounded-outline",
        ),
        default_button("mic", "Microphone Toggle", "i-solar:muted-linear"),
        default_button(
            "stage",
            "Actor Stage",
            "i-solar:clapperboard-play-bold-duotone",
        ),
        default_button(
            "stage-atmosphere",
            "Stage & Chat Theme",
            "i-solar:magic-stick-3-linear",
        ),
        default_button("caption", "Captions", "i-ph:closed-captioning-duotone"),
        default_button("gemini-session", "Toggle Speech Session", "i-ph:sparkle"),
        default_button("settings", "Settings", "i-solar:settings-linear"),
        default_button("layout", "Customize Control Strip", "i-solar:widget-linear"),
        default_button(
            "viewport-auto-hide",
            "Auto Hide / Always Show",
            "i-ph:eye-slash",
        ),
        optional_button(
            "gemini-witness",
            "Witness Vision Mode",
            "i-solar:camera-linear",
        ),
        optional_button(
            "gemini-frequency",
            "Proactive Interval",
            "i-solar:clock-circle-linear",
        ),
        optional_button(
            "gemini-tts",
            "TTS Output Toggle",
            "i-solar:volume-loud-linear",
        ),
        optional_button("gemini-voice", "Voice Switch", "i-solar:user-speak-linear"),
        optional_button(
            "gemini-schedule",
            "Respect Schedule",
            "i-solar:calendar-linear",
        ),
        optional_button(
            "gemini-grounding",
            "Google Search Grounding",
            "i-solar:global-linear",
        ),
        optional_button("actor-selfies", "Selfies", "i-solar:camera-linear"),
        default_button("workspace", "Workspace", "i-solar:code-square-linear"),
        default_button(
            "actor-all-emotions",
            "All Emotions",
            "i-solar:emoji-funny-square-linear",
        ),
        default_button("actor-vfx", "VFX & Auras", "i-solar:fire-linear"),
        default_button(
            "actor-motion-playground",
            "Motion",
            "i-solar:walking-round-linear",
        ),
    ]
}

fn default_background_tint() -> String {
    "#171717".to_string()
}

fn default_buttons_version() -> String {
    CONTROL_STRIP_BUTTONS_VERSION.to_string()
}

fn default_buttons() -> Vec<ControlStripButton> {
    default_control_strip_buttons()
}

fn default_enabled_buttons() -> HashMap<String, bool> {
    HashMap::from([("stage".to_string(), true), ("caption".to_string(), true)])
}

/// Control strip settings (`settings/control-strip`).
///
/// Maps the Electron keys under `settings/control-strip/*` plus the related
/// flat keys `settings/stage-enabled`, `settings/chat-open`, and
/// `settings/caption-open`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlStripSettings {
    /// Strip orientation.
    #[serde(default)]
    pub orientation: ControlStripOrientation,
    /// Stage interaction mode.
    #[serde(default)]
    pub stage_mode: ControlStripStageMode,
    /// Whether the advanced positioning panel is open.
    #[serde(default)]
    pub advanced_positioning_open: bool,
    /// Whether the stage window is enabled (`settings/stage-enabled`).
    #[serde(default = "default_true")]
    pub stage_enabled: bool,
    /// Whether the chat panel is open (`settings/chat-open`).
    #[serde(default)]
    pub chat_open: bool,
    /// Whether the caption overlay is open (`settings/caption-open`).
    #[serde(default)]
    pub caption_open: bool,
    /// Background tint hex color.
    #[serde(default = "default_background_tint")]
    pub background_tint: String,
    /// Whether the strip is collapsed to its docked edge.
    #[serde(default)]
    pub collapsed: bool,
    /// Include the background in selfie captures.
    #[serde(default = "default_true")]
    pub selfie_include_bg: bool,
    /// Edge the strip docks to when collapsed.
    #[serde(default)]
    pub docked_edge: ControlStripDockedEdge,
    /// Free-floating position in pixels.
    #[serde(default)]
    pub position: ControlStripPosition,
    /// Strip button layout.
    #[serde(default = "default_buttons")]
    pub buttons: Vec<ControlStripButton>,
    /// Catalog version of [`Self::buttons`].
    #[serde(default = "default_buttons_version")]
    pub buttons_version: String,
    /// Per-button enabled overrides for the strip, keyed by button id.
    ///
    /// Only the ids this build surfaces (`stage`, `caption`) are tracked;
    /// unknown ids are ignored. Defaults to both enabled.
    #[serde(default = "default_enabled_buttons")]
    pub enabled_buttons: HashMap<String, bool>,
}

impl Default for ControlStripSettings {
    fn default() -> Self {
        Self {
            orientation: ControlStripOrientation::Vertical,
            stage_mode: ControlStripStageMode::Tactile,
            advanced_positioning_open: false,
            stage_enabled: true,
            chat_open: false,
            caption_open: false,
            background_tint: default_background_tint(),
            collapsed: false,
            selfie_include_bg: true,
            docked_edge: ControlStripDockedEdge::Right,
            position: ControlStripPosition::default(),
            buttons: default_control_strip_buttons(),
            buttons_version: default_buttons_version(),
            enabled_buttons: default_enabled_buttons(),
        }
    }
}

impl SettingsSection for ControlStripSettings {
    const KEY: &'static str = "settings/control-strip";
}

// ============================================================================
// Cards
// ============================================================================

/// Card library settings (`settings/cards`).
///
/// [`Self::active_card_id`] is the file stem of the card the next chat
/// adopts, or the empty string meaning "no card selected". The chat lane
/// consumes the same key.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardsSettings {
    /// File stem of the active card; `""` = none.
    #[serde(default)]
    pub active_card_id: String,
}

impl SettingsSection for CardsSettings {
    const KEY: &'static str = "settings/cards";
}

// ============================================================================
// Stage model
// ============================================================================

/// Stage model settings (`settings/stage-model`).
///
/// Lane ① (stage scene) consumes the same section. [`Self::model_id`] is
/// either an absolute filesystem path to a `.vrm` file, or the empty string
/// meaning "no model selected". No catalog is implied — consumers resolve
/// the path themselves.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageModelSettings {
    /// Absolute path to the selected `.vrm`, or empty for "none".
    #[serde(default)]
    pub model_id: String,
}

impl SettingsSection for StageModelSettings {
    const KEY: &'static str = "settings/stage-model";
}

// ============================================================================
// Captions
// ============================================================================

fn default_captions_font_size() -> f64 {
    100.0
}

fn default_captions_opacity() -> f64 {
    70.0
}

fn default_captions_docking() -> String {
    "none".to_string()
}

/// Captions overlay settings (`settings/captions`).
///
/// `font_size` and `opacity` are percentages (`100` == 100%); consumers
/// divide by 100 to feed the overlay. `docking` is `top` | `bottom` |
/// `head` (alias of `bottom`) | `none` (overlay hidden).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionsSettings {
    /// Whether the caption overlay is enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Font size percentage (50–200, 100 == base size).
    #[serde(default = "default_captions_font_size")]
    pub font_size: f64,
    /// Caption bar opacity percentage (0–100).
    #[serde(default = "default_captions_opacity")]
    pub opacity: f64,
    /// Docking edge: `top` | `bottom` | `head` | `none`.
    #[serde(default = "default_captions_docking")]
    pub docking: String,
}

impl Default for CaptionsSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            font_size: default_captions_font_size(),
            opacity: default_captions_opacity(),
            docking: default_captions_docking(),
        }
    }
}

impl SettingsSection for CaptionsSettings {
    const KEY: &'static str = "settings/captions";
}

// ============================================================================
// Stage window
// ============================================================================

fn default_stage_window_width() -> f64 {
    450.0
}

fn default_stage_window_height() -> f64 {
    600.0
}

/// Stage (pet) window geometry and visibility (`settings/stage-window`).
///
/// `x`/`y` are optional pixel offsets for the window's top-left corner;
/// `None` means "let the compositor place it" (first launch / after a
/// position reset). `visible` mirrors the stage window's last show/hide
/// state so the shell can restore it on startup.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageWindowSettings {
    /// Top-left x in pixels, or `null` when unset.
    #[serde(default)]
    pub x: Option<f64>,
    /// Top-left y in pixels, or `null` when unset.
    #[serde(default)]
    pub y: Option<f64>,
    /// Window width in pixels (minimum 200).
    #[serde(default = "default_stage_window_width")]
    pub width: f64,
    /// Window height in pixels (minimum 200).
    #[serde(default = "default_stage_window_height")]
    pub height: f64,
    /// Whether the stage window should be visible.
    #[serde(default = "default_true")]
    pub visible: bool,
}

impl Default for StageWindowSettings {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            width: default_stage_window_width(),
            height: default_stage_window_height(),
            visible: true,
        }
    }
}

impl SettingsSection for StageWindowSettings {
    const KEY: &'static str = "settings/stage-window";
}

// ============================================================================
// Model positioning
// ============================================================================

/// Model placement on the stage (`{x, y, scale}`).
///
/// Shared by [`PositioningSettings::models`] and [`SpineSettings::scale_pos`].
/// `x`/`y` are stage-space offsets; `scale` is a unitless multiplier.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionScale {
    /// Horizontal offset.
    #[serde(default)]
    pub x: f64,
    /// Vertical offset.
    #[serde(default)]
    pub y: f64,
    /// Scale multiplier (1.0 == 100%).
    #[serde(default = "default_one")]
    pub scale: f64,
}

impl Default for PositionScale {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale: 1.0,
        }
    }
}

fn default_one() -> f64 {
    1.0
}

/// Positioning settings (`settings/positioning`).
///
/// Maps the Electron key `settings/positioning/models` — a map of model id
/// (or `<id>:dating-sim`) to placement. Empty map by default; missing
/// entries read as `{x: 0, y: 0, scale: 1}`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositioningSettings {
    /// Map of model id to placement.
    #[serde(default)]
    pub models: HashMap<String, PositionScale>,
}

impl SettingsSection for PositioningSettings {
    const KEY: &'static str = "settings/positioning";
}

// ============================================================================
// Spine
// ============================================================================

/// Spine settings (`settings/spine`).
///
/// Maps the Electron keys `settings/spine/max-fps`, `settings/spine/render-scale`,
/// `settings/spine/default-mix`, `settings/spine/idle-enabled`. `animation_speed`
/// and `scale_pos` are persisted here for the Qt port (the Electron app kept
/// `animationSpeed` in the runtime spine store and placement in the positioning
/// store; the Qt pages edit them alongside the other spine knobs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpineSettings {
    /// Maximum render frames per second; 0 means unlimited.
    #[serde(default)]
    pub max_fps: u32,
    /// Render scale multiplier (device-pixel-ratio style).
    #[serde(default = "default_one")]
    pub render_scale: f64,
    /// Default mix (crossfade) duration in seconds when switching animations.
    #[serde(default = "default_spine_mix_duration")]
    pub mix_duration: f64,
    /// Playback speed multiplier for animations.
    #[serde(default = "default_one")]
    pub animation_speed: f64,
    /// Whether the idle animation loop is enabled.
    #[serde(default = "default_true")]
    pub idle_animation_enabled: bool,
    /// Placement of the spine model on the stage.
    #[serde(default)]
    pub scale_pos: PositionScale,
}

impl Default for SpineSettings {
    fn default() -> Self {
        Self {
            max_fps: 0,
            render_scale: 1.0,
            mix_duration: default_spine_mix_duration(),
            animation_speed: 1.0,
            idle_animation_enabled: true,
            scale_pos: PositionScale::default(),
        }
    }
}

fn default_spine_mix_duration() -> f64 {
    0.2
}

impl SettingsSection for SpineSettings {
    const KEY: &'static str = "settings/spine";
}

// ============================================================================
// MMD
// ============================================================================

/// MMD settings (`settings/mmd`).
///
/// Maps the Electron keys `settings/mmd/idle-enabled` and `settings/mmd/render-scale`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MmdSettings {
    /// Whether the idle animation loop is enabled.
    #[serde(default = "default_true")]
    pub mmd_idle_animation_enabled: bool,
    /// Render scale multiplier.
    #[serde(default = "default_one")]
    pub mmd_render_scale: f64,
}

impl Default for MmdSettings {
    fn default() -> Self {
        Self {
            mmd_idle_animation_enabled: true,
            mmd_render_scale: 1.0,
        }
    }
}

impl SettingsSection for MmdSettings {
    const KEY: &'static str = "settings/mmd";
}

// ============================================================================
// Live2D
// ============================================================================

/// Live2D settings (`settings/live2d`).
///
/// Maps the Electron keys `settings/live2d/disable-focus`,
/// `settings/live2d/follow-speed`, `settings/live2d/idle-animation-enabled`,
/// `settings/live2d/auto-blink-enabled`, `settings/live2d/force-auto-blink-enabled`,
/// `settings/live2d/shadow-enabled`, and `settings/live2d/max-fps`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Live2dSettings {
    /// Disable the focus (eye/head tracking) behavior.
    #[serde(default)]
    pub live2d_disable_focus: bool,
    /// Follow speed for eye/head tracking (0.0–1.0).
    #[serde(default = "default_live2d_follow_speed")]
    pub live2d_follow_speed: f64,
    /// Whether the idle animation loop is enabled.
    #[serde(default = "default_true")]
    pub live2d_idle_animation_enabled: bool,
    /// Whether auto-blink is enabled.
    #[serde(default = "default_true")]
    pub live2d_auto_blink_enabled: bool,
    /// Force auto-blink even when the model ships its own blink motion.
    #[serde(default)]
    pub live2d_force_auto_blink_enabled: bool,
    /// Whether the drop shadow is rendered.
    #[serde(default = "default_true")]
    pub live2d_shadow_enabled: bool,
    /// Maximum render frames per second; 0 means unlimited.
    #[serde(default)]
    pub live2d_max_fps: u32,
}

impl Default for Live2dSettings {
    fn default() -> Self {
        Self {
            live2d_disable_focus: false,
            live2d_follow_speed: default_live2d_follow_speed(),
            live2d_idle_animation_enabled: true,
            live2d_auto_blink_enabled: true,
            live2d_force_auto_blink_enabled: false,
            live2d_shadow_enabled: true,
            live2d_max_fps: 0,
        }
    }
}

fn default_live2d_follow_speed() -> f64 {
    0.5
}

impl SettingsSection for Live2dSettings {
    const KEY: &'static str = "settings/live2d";
}

// ============================================================================
// Audio device
// ============================================================================

/// Audio device settings (`settings/audio-device`).
///
/// Maps the Electron keys `settings/audio/input`, `settings/audio/input/enabled`,
/// and `settings/audio/output`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceSettings {
    /// `deviceId` of the selected audio input; empty means none/system default.
    #[serde(default)]
    pub selected_input_device: String,
    /// `deviceId` of the selected audio output; empty means none/system default.
    #[serde(default)]
    pub selected_output_device: String,
    /// Whether the microphone input stream is enabled.
    #[serde(default)]
    pub input_enabled: bool,
}

impl SettingsSection for AudioDeviceSettings {
    const KEY: &'static str = "settings/audio-device";
}

// ============================================================================
// User profile
// ============================================================================

fn default_user_profile_name() -> String {
    "Richy".to_string()
}

fn default_user_profile_description() -> String {
    "A hands-on, down-to-earth creator who loves building things from scratch. Prefers honest, direct conversation and cozy downtime after a long day of work.".to_string()
}

/// User profile settings (`settings/user-profile`).
///
/// Maps the Electron keys `settings/user-profile/name`,
/// `settings/user-profile/description`, `settings/user-profile/prompt`,
/// and `settings/user-profile/voice-profile-id`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileSettings {
    /// Display name shown to the character.
    #[serde(default = "default_user_profile_name")]
    pub name: String,
    /// Free-text description of the user fed into the prompt.
    #[serde(default = "default_user_profile_description")]
    pub description: String,
    /// Extra system-prompt text appended for the user.
    #[serde(default)]
    pub prompt: String,
    /// Id of the selected voice profile; empty means none.
    #[serde(default)]
    pub voice_profile_id: String,
}

impl Default for UserProfileSettings {
    fn default() -> Self {
        Self {
            name: default_user_profile_name(),
            description: default_user_profile_description(),
            prompt: String::new(),
            voice_profile_id: String::new(),
        }
    }
}

impl SettingsSection for UserProfileSettings {
    const KEY: &'static str = "settings/user-profile";
}

// ============================================================================
// Local LLM (llama.cpp)
// ============================================================================

fn default_local_llm_context_size() -> u32 {
    2048
}

fn default_local_llm_temperature() -> f64 {
    0.8
}

fn default_local_llm_max_tokens() -> u32 {
    512
}

/// Native in-process llama.cpp provider settings (`settings/local-llm`).
///
/// Consumed by `airi-core`'s provider resolution (`provider_id ==
/// "llama-cpp-local"`) to build a `llama.cpp` GGUF chat backend instead of
/// the OpenAI-compatible fallback in the static registry. `model_path` is
/// an absolute path to a `.gguf` file; the `AIRI_QT_LLAMA_MODEL`
/// environment variable, when set, overrides it. `gpu_layers` is llama.cpp's
/// `n_gpu_layers` (0 = all CPU, negative = offload all layers).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmSettings {
    /// Absolute path to the GGUF model file. Empty means "not configured".
    #[serde(default)]
    pub model_path: String,
    /// KV context window in tokens.
    #[serde(default = "default_local_llm_context_size")]
    pub context_size: u32,
    /// Sampling temperature.
    #[serde(default = "default_local_llm_temperature")]
    pub temperature: f64,
    /// Maximum tokens to generate per completion.
    #[serde(default = "default_local_llm_max_tokens")]
    pub max_tokens: u32,
    /// Layers to offload to the GPU (llama.cpp `n_gpu_layers`).
    #[serde(default)]
    pub gpu_layers: i32,
}

impl Default for LocalLlmSettings {
    fn default() -> Self {
        Self {
            model_path: String::new(),
            context_size: default_local_llm_context_size(),
            temperature: default_local_llm_temperature(),
            max_tokens: default_local_llm_max_tokens(),
            gpu_layers: 0,
        }
    }
}

impl SettingsSection for LocalLlmSettings {
    const KEY: &'static str = "settings/local-llm";
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn open_db(dir: &tempfile::TempDir) -> Database {
        Database::open(&dir.path().join("settings.sqlite")).unwrap()
    }

    fn store_and_rx(db: Database) -> (SettingsStore, broadcast::Receiver<CoreEvent>) {
        let (tx, rx) = broadcast::channel(16);
        (SettingsStore::new(db, tx), rx)
    }

    #[test]
    fn section_defaults_round_trip() {
        let dir = tempdir().unwrap();
        let db = open_db(&dir);
        let (store, _rx) = store_and_rx(db);

        let chat = store.load_section::<ChatSettings>().unwrap();
        assert_eq!(chat, ChatSettings::default());
        assert_eq!(chat.send_mode, ChatSendMode::Enter);
        assert_eq!(chat.suggest_mode, ChatSuggestMode::DoubleEnter);
        assert_eq!(chat.stream_idle_timeout_ms, 600_000);

        let theme = store.load_section::<ThemeSettings>().unwrap();
        assert_eq!(theme.hue, 220.44);
        assert_eq!(theme.chroma_multiplier, 1.0);
        assert!(!theme.hue_dynamic);
    }

    #[test]
    fn save_section_persists_and_broadcasts() {
        let dir = tempdir().unwrap();
        let db = open_db(&dir);
        let (store, mut rx) = store_and_rx(db);

        let chat = ChatSettings {
            send_mode: ChatSendMode::CtrlEnter,
            combine_system_messages: true,
            ..ChatSettings::default()
        };
        store.save_section(&chat).unwrap();

        // Broadcast fires with the section key.
        match rx.try_recv() {
            Ok(CoreEvent::SettingsChanged { key }) => assert_eq!(key, "settings/chat"),
            other => panic!("expected SettingsChanged for settings/chat, got {other:?}"),
        }
        // And the value survives a reload.
        let reloaded = store.load_section::<ChatSettings>().unwrap();
        assert_eq!(reloaded.send_mode, ChatSendMode::CtrlEnter);
        assert!(reloaded.combine_system_messages);
    }

    #[test]
    fn partial_json_falls_back_to_defaults() {
        let dir = tempdir().unwrap();
        let db = open_db(&dir);
        let (store, _rx) = store_and_rx(db);

        store
            .save(
                "settings/chat",
                &serde_json::json!({ "sendMode": "ctrl-enter" }),
            )
            .unwrap();
        let chat = store.load_section::<ChatSettings>().unwrap();
        assert_eq!(chat.send_mode, ChatSendMode::CtrlEnter);
        // Untouched fields get defaults.
        assert_eq!(chat.stream_idle_timeout_ms, 600_000);
        assert!(chat.show_director_notes);
    }

    #[test]
    fn list_keys_and_delete() {
        let dir = tempdir().unwrap();
        let db = open_db(&dir);
        let (store, _rx) = store_and_rx(db);

        store.save_section(&GeneralSettings::default()).unwrap();
        store.save_section(&ChatSettings::default()).unwrap();
        let keys = store.list_keys(Some("settings/")).unwrap();
        assert_eq!(
            keys,
            vec!["settings/chat".to_string(), "settings/general".to_string()]
        );

        assert!(store.delete("settings/general").unwrap());
        assert!(!store.delete("settings/general").unwrap());
    }

    #[test]
    fn control_strip_defaults_and_wire_format() {
        let dir = tempdir().unwrap();
        let db = open_db(&dir);
        let (store, _rx) = store_and_rx(db);

        let strip = store.load_section::<ControlStripSettings>().unwrap();
        assert_eq!(strip.orientation, ControlStripOrientation::Vertical);
        assert_eq!(strip.stage_mode, ControlStripStageMode::Tactile);
        assert_eq!(strip.docked_edge, ControlStripDockedEdge::Right);
        assert_eq!(strip.position, ControlStripPosition { x: 20.0, y: 150.0 });
        assert_eq!(strip.buttons_version, "v5");
        assert!(!strip.buttons.is_empty());

        // Wire format uses the Electron literals.
        let json = serde_json::to_value(&strip).unwrap();
        assert_eq!(json["stageMode"], "tactileMode");
        assert_eq!(json["orientation"], "vertical");
        assert_eq!(json["dockedEdge"], "right");

        // Round-trip through the store.
        store.save_section(&strip).unwrap();
        let reloaded = store.load_section::<ControlStripSettings>().unwrap();
        assert_eq!(reloaded, strip);
    }

    #[test]
    fn general_and_theme_wire_format() {
        let general = serde_json::to_value(GeneralSettings::default()).unwrap();
        assert_eq!(general["disableTransitions"], true);
        assert_eq!(general["websocketSecureEnabled"], false);

        let theme_json = r#"{"hue": 100.0, "hueDynamic": true}"#;
        let theme: ThemeSettings = serde_json::from_str(theme_json).unwrap();
        assert_eq!(theme.hue, 100.0);
        assert!(theme.hue_dynamic);
        assert_eq!(theme.chroma_multiplier, 1.0);
    }
    #[test]
    fn stage_sections_wire_format() {
        let model = StageModelSettings::default();
        assert_eq!(model.model_id, "");
        let json = serde_json::to_value(&model).unwrap();
        assert_eq!(json["modelId"], "");

        let captions = CaptionsSettings::default();
        assert!(captions.enabled);
        assert_eq!(captions.font_size, 100.0);
        assert_eq!(captions.opacity, 70.0);
        assert_eq!(captions.docking, "none");
        let json = serde_json::to_value(&captions).unwrap();
        assert_eq!(json["fontSize"], 100.0);
        assert_eq!(json["docking"], "none");

        let window = StageWindowSettings::default();
        assert_eq!(window.x, None);
        assert_eq!(window.y, None);
        assert_eq!(window.width, 450.0);
        assert_eq!(window.height, 600.0);
        assert!(window.visible);
        let json = serde_json::to_value(&window).unwrap();
        assert_eq!(json["x"], serde_json::Value::Null);
        assert_eq!(json["width"], 450.0);

        // Control strip enabled-buttons map round-trips and defaults on.
        let strip = ControlStripSettings::default();
        assert_eq!(strip.enabled_buttons.get("stage"), Some(&true));
        assert_eq!(strip.enabled_buttons.get("caption"), Some(&true));
        let json = serde_json::to_value(&strip).unwrap();
        assert_eq!(json["enabledButtons"]["stage"], true);
    }

    #[test]
    fn stage_sections_round_trip_and_keys() {
        let dir = tempdir().unwrap();
        let db = open_db(&dir);
        let (store, _rx) = store_and_rx(db);

        assert_eq!(StageModelSettings::KEY, "settings/stage-model");
        assert_eq!(CaptionsSettings::KEY, "settings/captions");
        assert_eq!(StageWindowSettings::KEY, "settings/stage-window");

        store
            .save_section(&CaptionsSettings {
                enabled: false,
                font_size: 150.0,
                opacity: 40.0,
                docking: "bottom".to_string(),
            })
            .unwrap();
        let captions = store.load_section::<CaptionsSettings>().unwrap();
        assert!(!captions.enabled);
        assert_eq!(captions.docking, "bottom");

        store
            .save_section(&StageWindowSettings {
                x: Some(120.0),
                y: Some(-40.0),
                width: 800.0,
                height: 700.0,
                visible: false,
            })
            .unwrap();
        let window = store.load_section::<StageWindowSettings>().unwrap();
        assert_eq!(window.x, Some(120.0));
        assert_eq!(window.y, Some(-40.0));
        assert!(!window.visible);
    }

    #[test]
    fn p6_sections_defaults_and_keys() {
        assert_eq!(SpineSettings::KEY, "settings/spine");
        assert_eq!(MmdSettings::KEY, "settings/mmd");
        assert_eq!(Live2dSettings::KEY, "settings/live2d");
        assert_eq!(PositioningSettings::KEY, "settings/positioning");
        assert_eq!(AudioDeviceSettings::KEY, "settings/audio-device");
        assert_eq!(UserProfileSettings::KEY, "settings/user-profile");
        assert_eq!(LocalLlmSettings::KEY, "settings/local-llm");
        let local_llm = LocalLlmSettings::default();
        assert_eq!(local_llm.context_size, 2048);
        assert_eq!(local_llm.temperature, 0.8);
        assert_eq!(local_llm.max_tokens, 512);
        assert_eq!(local_llm.gpu_layers, 0);
        assert_eq!(local_llm.model_path, "");

        let spine = SpineSettings::default();
        assert_eq!(spine.max_fps, 0);
        assert_eq!(spine.render_scale, 1.0);
        assert_eq!(spine.mix_duration, 0.2);
        assert_eq!(spine.animation_speed, 1.0);
        assert!(spine.idle_animation_enabled);
        assert_eq!(
            spine.scale_pos,
            PositionScale {
                x: 0.0,
                y: 0.0,
                scale: 1.0
            }
        );

        let mmd = MmdSettings::default();
        assert!(mmd.mmd_idle_animation_enabled);
        assert_eq!(mmd.mmd_render_scale, 1.0);

        let live2d = Live2dSettings::default();
        assert!(!live2d.live2d_disable_focus);
        assert_eq!(live2d.live2d_follow_speed, 0.5);
        assert!(live2d.live2d_idle_animation_enabled);
        assert!(live2d.live2d_auto_blink_enabled);
        assert!(!live2d.live2d_force_auto_blink_enabled);
        assert!(live2d.live2d_shadow_enabled);
        assert_eq!(live2d.live2d_max_fps, 0);

        let positioning = PositioningSettings::default();
        assert!(positioning.models.is_empty());

        let audio = AudioDeviceSettings::default();
        assert_eq!(audio.selected_input_device, "");
        assert_eq!(audio.selected_output_device, "");
        assert!(!audio.input_enabled);

        let profile = UserProfileSettings::default();
        assert_eq!(profile.name, "Richy");
        assert!(profile.description.contains("hands-on"));
        assert_eq!(profile.prompt, "");
        assert_eq!(profile.voice_profile_id, "");
    }

    #[test]
    fn p6_sections_round_trip() {
        let dir = tempdir().unwrap();
        let db = open_db(&dir);
        let (store, _rx) = store_and_rx(db);

        let spine = SpineSettings {
            max_fps: 60,
            render_scale: 2.0,
            mix_duration: 0.35,
            animation_speed: 1.5,
            idle_animation_enabled: false,
            scale_pos: PositionScale {
                x: 10.0,
                y: -20.0,
                scale: 1.25,
            },
        };
        store.save_section(&spine).unwrap();
        assert_eq!(store.load_section::<SpineSettings>().unwrap(), spine);

        let mmd = MmdSettings {
            mmd_idle_animation_enabled: false,
            mmd_render_scale: 2.0,
        };
        store.save_section(&mmd).unwrap();
        assert_eq!(store.load_section::<MmdSettings>().unwrap(), mmd);

        let live2d = Live2dSettings {
            live2d_disable_focus: true,
            live2d_follow_speed: 0.9,
            live2d_idle_animation_enabled: false,
            live2d_auto_blink_enabled: false,
            live2d_force_auto_blink_enabled: true,
            live2d_shadow_enabled: false,
            live2d_max_fps: 30,
        };
        store.save_section(&live2d).unwrap();
        assert_eq!(store.load_section::<Live2dSettings>().unwrap(), live2d);

        let positioning = PositioningSettings {
            models: HashMap::from([
                (
                    "model-a".to_string(),
                    PositionScale {
                        x: 1.0,
                        y: 2.0,
                        scale: 1.5,
                    },
                ),
                (
                    "model-b:dating-sim".to_string(),
                    PositionScale {
                        x: -5.0,
                        y: 7.0,
                        scale: 0.75,
                    },
                ),
            ]),
        };
        store.save_section(&positioning).unwrap();
        assert_eq!(
            store.load_section::<PositioningSettings>().unwrap(),
            positioning
        );

        let audio = AudioDeviceSettings {
            selected_input_device: "mic-1".to_string(),
            selected_output_device: "speaker-1".to_string(),
            input_enabled: true,
        };
        store.save_section(&audio).unwrap();
        assert_eq!(store.load_section::<AudioDeviceSettings>().unwrap(), audio);

        let profile = UserProfileSettings {
            name: "Ada".to_string(),
            description: "test description".to_string(),
            prompt: "be terse".to_string(),
            voice_profile_id: "voice-42".to_string(),
        };
        store.save_section(&profile).unwrap();
        assert_eq!(
            store.load_section::<UserProfileSettings>().unwrap(),
            profile
        );
    }

    #[test]
    fn p6_sections_partial_json_falls_back_to_defaults() {
        let dir = tempdir().unwrap();
        let db = open_db(&dir);
        let (store, _rx) = store_and_rx(db);

        store
            .save("settings/spine", &serde_json::json!({ "maxFps": 30 }))
            .unwrap();
        let spine = store.load_section::<SpineSettings>().unwrap();
        assert_eq!(spine.max_fps, 30);
        assert_eq!(spine.render_scale, 1.0);
        assert_eq!(spine.mix_duration, 0.2);
        assert!(spine.idle_animation_enabled);

        store
            .save(
                "settings/user-profile",
                &serde_json::json!({ "name": "Grace" }),
            )
            .unwrap();
        let profile = store.load_section::<UserProfileSettings>().unwrap();
        assert_eq!(profile.name, "Grace");
        assert!(profile.description.contains("hands-on"));

        store
            .save(
                "settings/positioning",
                &serde_json::json!({ "models": { "m": { "x": 3.0 } } }),
            )
            .unwrap();
        let positioning = store.load_section::<PositioningSettings>().unwrap();
        assert_eq!(
            positioning.models["m"],
            PositionScale {
                x: 3.0,
                y: 0.0,
                scale: 1.0
            }
        );
    }
}
