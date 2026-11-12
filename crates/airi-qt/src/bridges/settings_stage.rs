// SPDX-License-Identifier: GPL-3.0-or-later
//! Stage settings bridge (`StageSettingsController`) exposed to QML.
//!
//! NOT to be confused with the stage *scene* controller owned by the stage
//! window lane — this bridge persists the stage-related settings sections
//! and serves the Stage settings page:
//!
//! - [`airi_core::settings::StageModelSettings`] (`settings/stage-model`) —
//!   `modelId` is either an absolute filesystem path to a `.vrm` or `""`
//!   (none). No catalog is maintained; consumers resolve the path.
//! - [`airi_core::settings::CaptionsSettings`] (`settings/captions`) —
//!   `fontSize`/`opacity` are percentages (`100` == 100%); QML divides by
//!   100 for the overlay. `docking` is `top` | `bottom` | `head` | `none`.
//! - [`airi_core::settings::StageWindowSettings`] (`settings/stage-window`) —
//!   `x`/`y` (nullable), `width`, `height`, `visible`.
//! - [`airi_core::settings::ControlStripSettings::enabled_buttons`]
//!   (`settings/control-strip`) — per-button enabled map, `stage`/`caption`
//!   ids only.
//!
//! VRM discovery scans `<profile>/models` then the platform data dir
//! (`<XDG_DATA_HOME|~/.local/share>/airi-qt/models`). Imports copy into
//! `<profile>/models`. The matching `--import-model <path>` CLI lives in
//! `main.rs` and shares [`import_model`].

use cxx_qt_lib::{QString, QStringList};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::pin::Pin;

use airi_core::settings::{
    CaptionsSettings, ControlStripSettings, StageModelSettings, StageWindowSettings,
};
use serde::Deserialize;

use crate::bridges::qstring_to_string;

/// Minimum stage window dimension enforced on save.
const BOUNDS_MIN_SIZE: f64 = 200.0;
/// Maximum stage window dimension enforced on save.
const BOUNDS_MAX_SIZE: f64 = 10_000.0;
/// Maximum absolute coordinate enforced on save.
const BOUNDS_MAX_COORD: f64 = 10_000.0;

/// cxx-qt bridge definitions for the stage settings bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
        include!("cxx-qt-lib/qstringlist.h");
        /// QStringList from cxx-qt-lib (deref-convertible to QList<QString>).
        type QStringList = cxx_qt_lib::QStringList;
    }

    extern "RustQt" {
        /// Stage settings mirror. `loadAll()` re-reads the persisted
        /// sections; the `save*` invokables write them back.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, model_id, cxx_name = "modelId")]
        #[qproperty(bool, captions_enabled, cxx_name = "captionsEnabled")]
        #[qproperty(f64, captions_font_size, cxx_name = "captionsFontSize")]
        #[qproperty(f64, captions_opacity, cxx_name = "captionsOpacity")]
        #[qproperty(QString, captions_docking, cxx_name = "captionsDocking")]
        #[qproperty(bool, stage_visible, cxx_name = "stageVisible")]
        type StageSettingsController = super::StageSettingsControllerRust;
    }

    extern "RustQt" {
        /// Re-read all stage-related sections into the mirror. Called by
        /// QML once after creation.
        #[qinvokable]
        #[cxx_name = "loadAll"]
        fn load_all(self: Pin<&mut StageSettingsController>);

        /// Persist `settings/stage-model.modelId`. Pass `""` to clear.
        /// Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "saveModel"]
        fn save_model(self: Pin<&mut StageSettingsController>, id: QString) -> bool;

        /// Persist the whole `settings/captions` section. `docking` must be
        /// one of `top` | `bottom` | `head` | `none`; `fontSize` is clamped
        /// to 10–400 and `opacity` to 0–100. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "saveCaptions"]
        fn save_captions(
            self: Pin<&mut StageSettingsController>,
            enabled: bool,
            font_size: f64,
            opacity: f64,
            docking: QString,
        ) -> bool;

        /// Serialize `settings/stage-window` as JSON:
        /// `{x,y,width,height,visible}` with `x`/`y` as `null` when unset.
        #[qinvokable]
        #[cxx_name = "loadBounds"]
        fn load_bounds(self: &StageSettingsController) -> QString;

        /// Validate and persist `settings/stage-window` from JSON of the
        /// same shape. `width`/`height` are clamped to ≥ 200 (and ≤ 10000);
        /// `x`/`y` are clamped to ±10000 (missing/`null` clears them).
        /// Returns `false` when the JSON is invalid.
        #[qinvokable]
        #[cxx_name = "saveBounds"]
        fn save_bounds(self: Pin<&mut StageSettingsController>, json: QString) -> bool;

        /// Clear `x`/`y` in `settings/stage-window` (keep size/visibility).
        /// Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "resetBounds"]
        fn reset_bounds(self: Pin<&mut StageSettingsController>) -> bool;

        /// Persist only the `visible` flag of `settings/stage-window`.
        /// The stage window calls this on show/hide (post-merge).
        #[qinvokable]
        #[cxx_name = "saveWindowVisible"]
        fn save_window_visible(self: Pin<&mut StageSettingsController>, visible: bool) -> bool;

        /// Filenames (not paths) of every `.vrm` in `<profile>/models` and
        /// the platform data dir. Profile wins on name collision.
        #[qinvokable]
        #[cxx_name = "listModels"]
        fn list_models(self: &StageSettingsController) -> QStringList;

        /// Resolve a filename from `listModels` to its absolute path
        /// (profile dir first). Returns `""` when not found.
        #[qinvokable]
        #[cxx_name = "resolveModelPath"]
        fn resolve_model_path(self: &StageSettingsController, filename: QString) -> QString;

        /// Copy `src_path` into `<profile>/models/<filename>` (deduping the
        /// name on collision). Returns the absolute destination path, or
        /// `""` on failure. The source must be a `.vrm` file.
        #[qinvokable]
        #[cxx_name = "importModel"]
        fn import_model(self: &StageSettingsController, src_path: QString) -> QString;

        /// Whether the `stage`/`caption` control-strip button is enabled
        /// (defaults to `true`, including for unknown ids).
        #[qinvokable]
        #[cxx_name = "stripButtonEnabled"]
        fn strip_button_enabled(self: &StageSettingsController, id: QString) -> bool;

        /// Persist the enabled state of the `stage`/`caption` control-strip
        /// button. Returns `false` for any other id.
        #[qinvokable]
        #[cxx_name = "saveStripButtonEnabled"]
        fn save_strip_button_enabled(
            self: &StageSettingsController,
            id: QString,
            enabled: bool,
        ) -> bool;
    }
}

/// Rust storage for `StageSettingsController`.
pub struct StageSettingsControllerRust {
    model_id: QString,
    captions_enabled: bool,
    captions_font_size: f64,
    captions_opacity: f64,
    captions_docking: QString,
    stage_visible: bool,
}

impl Default for StageSettingsControllerRust {
    fn default() -> Self {
        let model = load_section::<StageModelSettings>();
        let captions = load_section::<CaptionsSettings>();
        let window = load_section::<StageWindowSettings>();
        Self {
            model_id: QString::from(model.model_id.as_str()),
            captions_enabled: captions.enabled,
            captions_font_size: captions.font_size,
            captions_opacity: captions.opacity,
            captions_docking: QString::from(captions.docking.as_str()),
            stage_visible: window.visible,
        }
    }
}

impl qobject::StageSettingsController {
    /// Re-read every stage-related section into the mirror properties.
    pub fn load_all(mut self: Pin<&mut Self>) {
        let model = load_section::<StageModelSettings>();
        let captions = load_section::<CaptionsSettings>();
        let window = load_section::<StageWindowSettings>();
        self.as_mut()
            .set_model_id(QString::from(model.model_id.as_str()));
        self.as_mut().set_captions_enabled(captions.enabled);
        self.as_mut().set_captions_font_size(captions.font_size);
        self.as_mut().set_captions_opacity(captions.opacity);
        self.as_mut()
            .set_captions_docking(QString::from(captions.docking.as_str()));
        self.as_mut().set_stage_visible(window.visible);
    }

    /// Persist the stage model selection (`""` clears it).
    pub fn save_model(mut self: Pin<&mut Self>, id: QString) -> bool {
        let id = qstring_to_string(&id);
        let trimmed = id.trim().to_string();
        match save_section(&StageModelSettings {
            model_id: trimmed.clone(),
        }) {
            Ok(()) => {
                self.as_mut().set_model_id(QString::from(trimmed.as_str()));
                true
            }
            Err(e) => {
                eprintln!("[airi-qt] stage: failed to persist settings/stage-model: {e}");
                false
            }
        }
    }

    /// Persist the captions section; rejects unknown docking values.
    pub fn save_captions(
        mut self: Pin<&mut Self>,
        enabled: bool,
        font_size: f64,
        opacity: f64,
        docking: QString,
    ) -> bool {
        let docking = qstring_to_string(&docking);
        let docking = docking.trim().to_ascii_lowercase();
        if !matches!(docking.as_str(), "top" | "bottom" | "head" | "none") {
            eprintln!("[airi-qt] stage: refusing to persist unknown captions docking {docking:?}");
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
                self.as_mut().set_captions_enabled(enabled);
                self.as_mut().set_captions_font_size(font_size);
                self.as_mut().set_captions_opacity(opacity);
                self.as_mut()
                    .set_captions_docking(QString::from(docking.as_str()));
                true
            }
            Err(e) => {
                eprintln!("[airi-qt] stage: failed to persist settings/captions: {e}");
                false
            }
        }
    }

    /// Serialize the stage window bounds as a JSON object.
    pub fn load_bounds(&self) -> QString {
        let window = load_section::<StageWindowSettings>();
        let json = serde_json::json!({
            "x": window.x,
            "y": window.y,
            "width": window.width,
            "height": window.height,
            "visible": window.visible,
        });
        QString::from(json.to_string().as_str())
    }

    /// Validate and persist stage window bounds from JSON.
    pub fn save_bounds(mut self: Pin<&mut Self>, json: QString) -> bool {
        let raw = qstring_to_string(&json);
        let parsed: BoundsInput = match serde_json::from_str(&raw) {
            Ok(parsed) => parsed,
            Err(e) => {
                eprintln!("[airi-qt] stage: saveBounds rejected ({e})");
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
                self.as_mut().set_stage_visible(bounds.visible);
                true
            }
            Err(e) => {
                eprintln!("[airi-qt] stage: failed to persist settings/stage-window: {e}");
                false
            }
        }
    }

    /// Clear `x`/`y` so the compositor re-places the stage window.
    pub fn reset_bounds(self: Pin<&mut Self>) -> bool {
        let mut window = load_section::<StageWindowSettings>();
        window.x = None;
        window.y = None;
        match save_section(&window) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("[airi-qt] stage: failed to reset settings/stage-window position: {e}");
                false
            }
        }
    }

    /// Persist only the visibility flag of the stage window section.
    pub fn save_window_visible(mut self: Pin<&mut Self>, visible: bool) -> bool {
        let mut window = load_section::<StageWindowSettings>();
        window.visible = visible;
        match save_section(&window) {
            Ok(()) => {
                self.as_mut().set_stage_visible(visible);
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-qt] stage: failed to persist settings/stage-window visibility: {e}"
                );
                false
            }
        }
    }

    /// List discoverable `.vrm` filenames (profile first, deduplicated).
    pub fn list_models(&self) -> QStringList {
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
        names.iter().map(|n| QString::from(n.as_str())).collect()
    }

    /// Resolve a model filename to its absolute path (profile dir first).
    pub fn resolve_model_path(&self, filename: QString) -> QString {
        let name = qstring_to_string(&filename);
        match find_model(&name) {
            Some(path) => QString::from(path.to_string_lossy().as_ref()),
            None => QString::from(""),
        }
    }

    /// Copy a `.vrm` into `<profile>/models`, returning the absolute path.
    pub fn import_model(&self, src_path: QString) -> QString {
        let src = qstring_to_string(&src_path);
        let src = PathBuf::from(src.trim());
        let dest_dir = crate::bridges::profile_dir()
            .map(|p| p.join("models"))
            .unwrap_or_else(|| PathBuf::from("models"));
        match import_model(&src, &dest_dir) {
            Ok(dest) => QString::from(dest.to_string_lossy().as_ref()),
            Err(e) => {
                eprintln!("[airi-qt] stage: import-model: {e}");
                QString::from("")
            }
        }
    }

    /// Read the per-button strip enabled flag (defaults to `true`).
    pub fn strip_button_enabled(&self, id: QString) -> bool {
        let id = qstring_to_string(&id);
        let settings = load_section::<ControlStripSettings>();
        settings
            .enabled_buttons
            .get(id.trim())
            .copied()
            .unwrap_or(true)
    }

    /// Persist the per-button strip enabled flag (`stage`/`caption` only).
    pub fn save_strip_button_enabled(&self, id: QString, enabled: bool) -> bool {
        let id = qstring_to_string(&id);
        let id = id.trim();
        if !matches!(id, "stage" | "caption") {
            eprintln!("[airi-qt] stage: refusing to persist unknown strip button id {id:?}");
            return false;
        }
        let mut settings = load_section::<ControlStripSettings>();
        settings.enabled_buttons.insert(id.to_string(), enabled);
        match save_section(&settings) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("[airi-qt] stage: failed to persist settings/control-strip: {e}");
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
        dirs.push(base.join("airi-qt").join("models"));
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

#[cfg(unix)]
fn platform_data_dir() -> Option<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            return Some(PathBuf::from(xdg));
        }
    }
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
}

#[cfg(not(unix))]
fn platform_data_dir() -> Option<PathBuf> {
    None
}

/// Directory `--import-model` writes to when no explicit `--profile` is set.
/// The platform data dir so a model imported without `--profile` is found by
/// the default launch's model scan as well.
pub(crate) fn default_models_dir() -> Option<PathBuf> {
    platform_data_dir().map(|base| base.join("airi-qt").join("models"))
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
