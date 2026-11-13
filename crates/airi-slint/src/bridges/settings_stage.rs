// SPDX-License-Identifier: GPL-3.0-or-later
//! Stage settings bridge (`StageSettingsState`).
//!
//! NOT to be confused with the stage *scene* controller owned by the stage
//! window lane — this bridge persists the stage-related settings sections
//! and serves the Stage settings page:
//!
//! - [`airi_core::settings::StageModelSettings`] (`settings/stage-model`) —
//!   `modelId` is either an absolute filesystem path to a `.vrm` or `""`
//!   (none). No catalog is maintained; consumers resolve the path.
//! - [`airi_core::settings::CaptionsSettings`] (`settings/captions`) —
//!   `fontSize`/`opacity` are percentages (`100` == 100%); the view divides by
//!   100 for the overlay. `docking` is `top` | `bottom` | `head` | `none`.
//! - [`airi_core::settings::StageWindowSettings`] (`settings/stage-window`) —
//!   `x`/`y` (nullable), `width`, `height`, `visible`.
//! - [`airi_core::settings::ControlStripSettings::enabled_buttons`]
//!   (`settings/control-strip`) — per-button enabled map, `stage`/`caption`
//!   ids only.
//!
//! VRM discovery scans `<profile>/models` then the platform data dir
//! (`<XDG_DATA_HOME|~/.local/share>/airi-slint/models`). Imports copy into
//! `<profile>/models`. The matching `--import-model <path>` CLI lives in
//! `main.rs` and shares [`import_model`].

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use airi_core::settings::{
    CaptionsSettings, ControlStripSettings, StageModelSettings, StageWindowSettings,
};
use serde::Deserialize;
use airi_core::util::platform_data_dir;

/// Minimum stage window dimension enforced on save.
const BOUNDS_MIN_SIZE: f64 = 200.0;
/// Maximum stage window dimension enforced on save.
const BOUNDS_MAX_SIZE: f64 = 10_000.0;
/// Maximum absolute coordinate enforced on save.
const BOUNDS_MAX_COORD: f64 = 10_000.0;

/// Stage settings mirror. `load_all()` re-reads the persisted sections; the
/// `save*` methods write them back.
pub struct StageSettingsState {
    pub model_id: String,
    pub captions_enabled: bool,
    pub captions_font_size: f64,
    pub captions_opacity: f64,
    pub captions_docking: String,
    pub stage_visible: bool,
}

impl Default for StageSettingsState {
    fn default() -> Self {
        let model = load_section::<StageModelSettings>();
        let captions = load_section::<CaptionsSettings>();
        let window = load_section::<StageWindowSettings>();
        Self {
            model_id: model.model_id,
            captions_enabled: captions.enabled,
            captions_font_size: captions.font_size,
            captions_opacity: captions.opacity,
            captions_docking: captions.docking,
            stage_visible: window.visible,
        }
    }
}

static STATE: Mutex<StageSettingsState> = Mutex::new(StageSettingsState {
    model_id: String::new(),
    captions_enabled: false,
    captions_font_size: 0.0,
    captions_opacity: 0.0,
    captions_docking: String::new(),
    stage_visible: false,
});

/// Lock the process-wide stage settings state.
pub fn with_state<R>(f: impl FnOnce(&mut StageSettingsState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

impl StageSettingsState {
    /// Re-read every stage-related section into the mirror properties.
    pub fn load_all(&mut self) {
        let model = load_section::<StageModelSettings>();
        let captions = load_section::<CaptionsSettings>();
        let window = load_section::<StageWindowSettings>();
        self.model_id = model.model_id;
        self.captions_enabled = captions.enabled;
        self.captions_font_size = captions.font_size;
        self.captions_opacity = captions.opacity;
        self.captions_docking = captions.docking;
        self.stage_visible = window.visible;
    }

    /// Persist the stage model selection (`""` clears it).
    pub fn save_model(&mut self, id: &str) -> bool {
        let trimmed = id.trim().to_string();
        match save_section(&StageModelSettings {
            model_id: trimmed.clone(),
        }) {
            Ok(()) => {
                self.model_id = trimmed;
                true
            }
            Err(e) => {
                eprintln!("[airi-slint] stage: failed to persist settings/stage-model: {e}");
                false
            }
        }
    }

    /// Persist the captions section; rejects unknown docking values.
    pub fn save_captions(
        &mut self,
        enabled: bool,
        font_size: f64,
        opacity: f64,
        docking: &str,
    ) -> bool {
        let docking = docking.trim().to_ascii_lowercase();
        if !matches!(docking.as_str(), "top" | "bottom" | "head" | "none") {
            eprintln!(
                "[airi-slint] stage: refusing to persist unknown captions docking {docking:?}"
            );
            return false;
        }
        let font_size = clamp_finite(font_size, 10.0, 400.0, 100.0);
        let opacity = clamp_finite(opacity, 0.0, 100.0, 70.0);
        match save_section(&CaptionsSettings {
            enabled,
            font_size,
            opacity,
            docking: docking.clone(),
        }) {
            Ok(()) => {
                self.captions_enabled = enabled;
                self.captions_font_size = font_size;
                self.captions_opacity = opacity;
                self.captions_docking = docking;
                true
            }
            Err(e) => {
                eprintln!("[airi-slint] stage: failed to persist settings/captions: {e}");
                false
            }
        }
    }

    /// Serialize the stage window bounds as a JSON object.
    pub fn load_bounds(&self) -> String {
        let window = load_section::<StageWindowSettings>();
        let json = serde_json::json!({
            "x": window.x,
            "y": window.y,
            "width": window.width,
            "height": window.height,
            "visible": window.visible,
        });
        json.to_string()
    }

    /// Validate and persist stage window bounds from JSON.
    pub fn save_bounds(&mut self, json: &str) -> bool {
        let parsed: BoundsInput = match serde_json::from_str(json) {
            Ok(parsed) => parsed,
            Err(e) => {
                eprintln!("[airi-slint] stage: saveBounds rejected ({e})");
                return false;
            }
        };
        let bounds = StageWindowSettings {
            x: parsed.x.map(sanitize_coord),
            y: parsed.y.map(sanitize_coord),
            width: clamp_finite(parsed.width, BOUNDS_MIN_SIZE, BOUNDS_MAX_SIZE, 450.0),
            height: clamp_finite(parsed.height, BOUNDS_MIN_SIZE, BOUNDS_MAX_SIZE, 600.0),
            visible: parsed.visible,
        };
        match save_section(&bounds) {
            Ok(()) => {
                self.stage_visible = bounds.visible;
                true
            }
            Err(e) => {
                eprintln!("[airi-slint] stage: failed to persist settings/stage-window: {e}");
                false
            }
        }
    }

    /// Clear `x`/`y` so the compositor re-places the stage window.
    pub fn reset_bounds(&mut self) -> bool {
        let mut window = load_section::<StageWindowSettings>();
        window.x = None;
        window.y = None;
        match save_section(&window) {
            Ok(()) => true,
            Err(e) => {
                eprintln!(
                    "[airi-slint] stage: failed to reset settings/stage-window position: {e}"
                );
                false
            }
        }
    }

    /// Persist only the visibility flag of the stage window section.
    pub fn save_window_visible(&mut self, visible: bool) -> bool {
        let mut window = load_section::<StageWindowSettings>();
        window.visible = visible;
        match save_section(&window) {
            Ok(()) => {
                self.stage_visible = visible;
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-slint] stage: failed to persist settings/stage-window visibility: {e}"
                );
                false
            }
        }
    }

    /// List discoverable `.vrm` filenames (profile first, deduplicated).
    pub fn list_models(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut names: Vec<String> = Vec::new();
        for dir in models_dirs() {
            for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                let path = entry.path();
                if !is_vrm_file(&path) {
                    continue;
                }
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    let name = name.to_string();
                    if seen.insert(name.to_ascii_lowercase()) {
                        names.push(name);
                    }
                }
            }
        }
        names
    }

    /// Resolve a model filename to its absolute path (profile dir first).
    pub fn resolve_model_path(&self, filename: &str) -> String {
        match find_model(filename) {
            Some(path) => path.to_string_lossy().into_owned(),
            None => String::new(),
        }
    }

    /// Copy a `.vrm` into `<profile>/models`, returning the absolute path.
    pub fn import_model(&self, src_path: &str) -> String {
        let src = PathBuf::from(src_path.trim());
        let dest_dir = crate::bridges::profile_dir()
            .map(|p| p.join("models"))
            .unwrap_or_else(|| PathBuf::from("models"));
        match import_model(&src, &dest_dir) {
            Ok(dest) => dest.to_string_lossy().into_owned(),
            Err(e) => {
                eprintln!("[airi-slint] stage: import-model: {e}");
                String::new()
            }
        }
    }

    /// Read the per-button strip enabled flag (defaults to `true`).
    pub fn strip_button_enabled(&self, id: &str) -> bool {
        let settings = load_section::<ControlStripSettings>();
        settings
            .enabled_buttons
            .get(id.trim())
            .copied()
            .unwrap_or(true)
    }

    /// Persist the per-button strip enabled flag (`stage`/`caption` only).
    pub fn save_strip_button_enabled(&self, id: &str, enabled: bool) -> bool {
        let id = id.trim();
        if !matches!(id, "stage" | "caption") {
            eprintln!("[airi-slint] stage: refusing to persist unknown strip button id {id:?}");
            return false;
        }
        let mut settings = load_section::<ControlStripSettings>();
        settings.enabled_buttons.insert(id.to_string(), enabled);
        match save_section(&settings) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("[airi-slint] stage: failed to persist settings/control-strip: {e}");
                false
            }
        }
    }
}

/// Wire format for `saveBounds` input. Missing `x`/`y`/`visible` fall back to
/// `null`/`true`; `width`/`height` are required.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoundsInput {
    /// Top-left x; `null`/missing clears it.
    x: Option<f64>,
    /// Top-left y; `null`/missing clears it.
    y: Option<f64>,
    /// Window width in pixels.
    width: f64,
    /// Window height in pixels.
    height: f64,
    /// Visibility; missing keeps `true`.
    #[serde(default = "default_visible")]
    visible: bool,
}

fn default_visible() -> bool {
    true
}

fn clamp_finite(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

fn sanitize_coord(value: f64) -> f64 {
    clamp_finite(value, -BOUNDS_MAX_COORD, BOUNDS_MAX_COORD, 0.0)
}

fn is_vrm_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("vrm"))
}

/// Directories scanned for `.vrm` models, in precedence order.
fn models_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(local) = crate::bridges::profile_dir() {
        dirs.push(local.join("models"));
    }
    if let Some(base) = platform_data_dir() {
        dirs.push(base.join("airi-slint").join("models"));
    }
    dirs
}

fn find_model(name: &str) -> Option<PathBuf> {
    // Only plain filenames are resolvable; reject any path components.
    let name = name.trim();
    if name.is_empty()
        || name != Path::new(name).file_name()?.to_str()?
        || !name.to_ascii_lowercase().ends_with(".vrm")
    {
        return None;
    }
    for dir in models_dirs() {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Copy `src` into `dest_dir` as `<filename>` (deduped with a `-<nanos>`
/// suffix on collision). Used by the bridge and `--import-model`.
pub(crate) fn import_model(src: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    if !is_vrm_file(src) {
        return Err(format!("{} is not a .vrm file", src.display()));
    }
    if !src.is_file() {
        return Err(format!("{} is not a readable file", src.display()));
    }
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("failed to create {}: {e}", dest_dir.display()))?;
    let file_name = src
        .file_name()
        .ok_or_else(|| format!("{} has no filename", src.display()))?
        .to_string_lossy()
        .into_owned();
    let dest = unique_dest(dest_dir, &file_name);
    std::fs::copy(src, &dest).map_err(|e| {
        format!(
            "failed to copy {} to {}: {e}",
            src.display(),
            dest.display()
        )
    })?;
    Ok(dest)
}

fn unique_dest(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    match file_name.rfind('.') {
        Some(dot) => dir.join(format!(
            "{}-{nanos:x}{}",
            &file_name[..dot],
            &file_name[dot..]
        )),
        None => dir.join(format!("{file_name}-{nanos:x}")),
    }
}

use crate::bridges::{load_section, save_section};
