// SPDX-License-Identifier: GPL-3.0-or-later
//! Stage scene bridge.
//!
//! `StageSceneController` — owns the resolved VRM engine
//! (`airi_render::vrm::engine`), feeds CPU-skinned vertex buffers to the
//! `AiriVrmGeometryShell` C++ instances created by QML, and exposes the
//! expression / lip-sync / gaze hooks. Loading is non-fatal by design: a
//! missing or broken model leaves an empty stage with a status string,
//! never a crash.
//!
//! Window bounds/visibility persistence is owned by the stage-settings
//! bridge (`StageSettingsController`, `settings/stage-window`); the stage
//! window consumes it directly — this bridge intentionally does not
//! duplicate it.
//!
//! The smoke tour relies on [`smoke_skin_ticks`] to prove the scene ticked.

use cxx_qt_lib::{QByteArray, QColor, QPointF, QString, QStringList};
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicI32, Ordering};

use airi_core::settings::StageModelSettings;
use cxx_qt::CxxQtType;

/// cxx-qt bridge definitions for the stage bridges.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qbytearray.h");
        /// QByteArray from cxx-qt-lib.
        type QByteArray = cxx_qt_lib::QByteArray;
    }

    unsafe extern "C++" {
        include!("cxx-qt-lib/qcolor.h");
        /// QColor from cxx-qt-lib.
        type QColor = cxx_qt_lib::QColor;
    }

    unsafe extern "C++" {
        include!("cxx-qt-lib/qpointf.h");
        /// QPointF from cxx-qt-lib.
        type QPointF = cxx_qt_lib::QPointF;
    }

    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    unsafe extern "C++" {
        include!("cxx-qt-lib/qstringlist.h");
        /// QStringList from cxx-qt-lib.
        type QStringList = cxx_qt_lib::QStringList;
    }

    extern "RustQt" {
        /// VRM scene controller exposed to QML.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, ready)]
        #[qproperty(QString, status)]
        #[qproperty(QString, model_id, cxx_name = "modelId")]
        #[qproperty(i32, primitive_count, cxx_name = "primitiveCount")]
        #[qproperty(i32, model_version, cxx_name = "modelVersion")]
        type StageSceneController = super::StageSceneControllerRust;
    }

    extern "RustQt" {
        /// Load the model at `path` (absolute filesystem path). Pass an
        /// empty string to unload.
        #[qinvokable]
        #[cxx_name = "loadModel"]
        fn load_model(self: Pin<&mut StageSceneController>, path: QString);

        /// Re-read `settings/stage-model` and load whatever it points at
        /// (empty = bundled default when available).
        #[qinvokable]
        #[cxx_name = "loadFromSettings"]
        fn load_from_settings(self: Pin<&mut StageSceneController>);

        /// Cheap poll for settings-page model switches; reloads only when
        /// the stored `modelId` changed since the last call.
        #[qinvokable]
        #[cxx_name = "reloadFromSettings"]
        fn reload_from_settings(self: Pin<&mut StageSceneController>) -> bool;

        /// Drop the current model (stage goes empty).
        #[qinvokable]
        fn unload(self: Pin<&mut StageSceneController>);

        /// Advance the animation/simulation and re-skin every primitive.
        /// Called by QML on a timer before frames render.
        #[qinvokable]
        #[cxx_name = "skinAndMorph"]
        fn skin_and_morph(self: Pin<&mut StageSceneController>, dt_ms: f64);

        /// Interleaved vertex buffer (pos/normal/uv/joints/weights,
        /// stride 64 bytes) with pos/normal rewritten by `skinAndMorph`.
        #[qinvokable]
        #[cxx_name = "vertexData"]
        fn vertex_data(self: &StageSceneController, index: i32) -> QByteArray;

        /// u32 index buffer for primitive `index`.
        #[qinvokable]
        #[cxx_name = "indexData"]
        fn index_data(self: &StageSceneController, index: i32) -> QByteArray;

        /// Vertex stride in bytes (64).
        #[qinvokable]
        #[cxx_name = "vertexStride"]
        fn vertex_stride(self: &StageSceneController) -> i32;

        /// Material index for primitive `index`, or -1.
        #[qinvokable]
        #[cxx_name = "primitiveMaterial"]
        fn primitive_material(self: &StageSceneController, index: i32) -> i32;

        /// Base color uniform for material `material`.
        #[qinvokable]
        #[cxx_name = "materialBaseColor"]
        fn material_base_color(self: &StageSceneController, material: i32) -> QColor;

        /// Shade color uniform for material `material`.
        #[qinvokable]
        #[cxx_name = "materialShadeColor"]
        fn material_shade_color(self: &StageSceneController, material: i32) -> QColor;

        /// File URL of the material's base-color texture (a cached white
        /// 1x1 PNG when the material has none).
        #[qinvokable]
        #[cxx_name = "materialTextureUrl"]
        fn material_texture_url(self: &StageSceneController, material: i32) -> QString;

        /// Whether material `material` has a base-color texture.
        #[qinvokable]
        #[cxx_name = "hasMaterialTexture"]
        fn has_material_texture(self: &StageSceneController, material: i32) -> bool;

        /// Set an expression weight (0..1). Known document emotions animate
        /// via the expression engine; anything else forces the raw preset.
        #[qinvokable]
        #[cxx_name = "setExpressionWeight"]
        fn set_expression_weight(self: Pin<&mut StageSceneController>, name: QString, weight: f64);

        /// Names of emotions derived from the loaded document (normalized).
        #[qinvokable]
        #[cxx_name = "availableExpressions"]
        fn available_expressions(self: &StageSceneController) -> QStringList;

        /// Feed the lip-sync amplitude (0..1). Wire the speech pipeline's
        /// rms into this; drives the `aa`-class morph preset.
        #[qinvokable]
        #[cxx_name = "setLipSync"]
        fn set_lip_sync(self: Pin<&mut StageSceneController>, amplitude: f64);

        /// Look at a screen position (pixels; normalized against the
        /// monitor size set via `setMonitorSize`).
        #[qinvokable]
        #[cxx_name = "lookAt"]
        fn look_at(self: Pin<&mut StageSceneController>, pos: QPointF);

        /// Reset gaze to the forward direction.
        #[qinvokable]
        #[cxx_name = "clearLookAt"]
        fn clear_look_at(self: Pin<&mut StageSceneController>);

        /// Set the monitor size used to normalize `lookAt` positions.
        #[qinvokable]
        #[cxx_name = "setMonitorSize"]
        fn set_monitor_size(self: Pin<&mut StageSceneController>, width: f64, height: f64);
    }
}

// ---------------------------------------------------------------------------
// StageSceneController
// ---------------------------------------------------------------------------

/// Rust storage for `StageSceneController`. Property fields match the
/// `#[qproperty(.., NAME)]` names; non-property state lives here too.
#[allow(missing_docs)]
pub struct StageSceneControllerRust {
    ready: bool,
    status: QString,
    model_id: QString,
    primitive_count: i32,
    model_version: i32,
    engine: Option<airi_render::vrm::engine::Engine>,
    monitor_width: f64,
    monitor_height: f64,
    /// `modelId` from settings as of the last (re)load; used by the poll.
    last_settings_id: String,
}

impl Default for StageSceneControllerRust {
    fn default() -> Self {
        Self {
            ready: false,
            status: QString::from("No model loaded"),
            model_id: QString::from(""),
            primitive_count: 0,
            model_version: 0,
            engine: None,
            monitor_width: 1920.0,
            monitor_height: 1080.0,
            last_settings_id: String::new(),
        }
    }
}

static SMOKE_SKIN_TICKS: AtomicI32 = AtomicI32::new(0);

/// Number of `skinAndMorph` calls made in `--smoke` mode (smoke-tour proof).
pub fn smoke_skin_ticks() -> i32 {
    SMOKE_SKIN_TICKS.load(Ordering::SeqCst)
}

/// Bundled preset → repo-relative path of the VRM asset.
fn preset_relative_path(id: &str) -> Option<&'static str> {
    match id {
        "preset-vrm-1" => {
            Some("packages/stage-ui/src/assets/vrm/models/AvatarSample-A/AvatarSample_A.vrm")
        }
        "preset-vrm-2" => {
            Some("packages/stage-ui/src/assets/vrm/models/AvatarSample-B/AvatarSample_B.vrm")
        }
        _ => None,
    }
}

/// Search for a repo-relative asset path across the usual roots.
fn find_bundled(rel: &str) -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("AIRI_QT_VRM_DIR") {
        let candidate = PathBuf::from(&dir).join(rel);
        if candidate.is_file() {
            return Some(candidate);
        }
        // Also try just the file name under the dir.
        if let Some(name) = PathBuf::from(rel).file_name() {
            let candidate = PathBuf::from(&dir).join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for ancestor in manifest.ancestors() {
        let candidate = ancestor.join(rel);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for ancestor in cwd.ancestors() {
            let candidate = ancestor.join(rel);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for ancestor in dir.ancestors() {
                let candidate = ancestor.join(rel);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// Resolve a preset id or filesystem path to an existing `.vrm` file.
fn resolve_model_path(model_id: &str) -> Option<PathBuf> {
    let id = model_id.trim();
    if id.is_empty() {
        // Bundled default: prefer preset-vrm-1, fall back to preset-vrm-2.
        return preset_relative_path("preset-vrm-1")
            .and_then(find_bundled)
            .or_else(|| preset_relative_path("preset-vrm-2").and_then(find_bundled));
    }
    let direct = PathBuf::from(id);
    if direct.is_file() {
        return Some(direct);
    }
    preset_relative_path(id).and_then(find_bundled)
}

/// Read the configured `modelId` (empty string when unset/unparseable).
fn configured_model_id() -> String {
    crate::bridges::settings_store()
        .and_then(|store| store.load_section::<StageModelSettings>().ok())
        .map(|s| s.model_id.trim().to_string())
        .unwrap_or_default()
}

impl qobject::StageSceneController {
    fn apply_loaded(mut self: Pin<&mut Self>, model_id: &str) {
        let count = self
            .as_ref()
            .engine
            .as_ref()
            .map(|e| e.primitive_count() as i32)
            .unwrap_or(0);
        let version = self.as_ref().model_version + 1;
        self.as_mut().set_primitive_count(count);
        self.as_mut().set_ready(true);
        self.as_mut().set_model_id(QString::from(model_id));
        self.as_mut().set_status(QString::from("Model ready"));
        self.as_mut().set_model_version(version);
    }

    fn apply_cleared(mut self: Pin<&mut Self>, status: &str, model_id: &str) {
        let version = self.as_ref().model_version + 1;
        self.as_mut().set_primitive_count(0);
        self.as_mut().set_ready(false);
        self.as_mut().set_model_id(QString::from(model_id));
        self.as_mut().set_status(QString::from(status));
        self.as_mut().set_model_version(version);
    }

    /// Load (or reload) the model identified by `id`.
    fn load_with_id(mut self: Pin<&mut Self>, id: String) {
        let id_trimmed = id.trim().to_string();
        let result: Result<(PathBuf, airi_render::vrm::engine::Engine), String> =
            match resolve_model_path(&id_trimmed) {
                Some(path) => {
                    let path_display = path.display().to_string();
                    airi_render::vrm::engine::Engine::load(&path)
                        .map(|engine| (path, engine))
                        .map_err(|e| format!("failed to load {path_display}: {e}"))
                }
                None => Err(if id_trimmed.is_empty() {
                    "no model selected and no bundled default found".to_string()
                } else {
                    format!("model not found: {id_trimmed}")
                }),
            };
        match result {
            Ok((path, engine)) => {
                let display_id = if id_trimmed.is_empty() {
                    path.display().to_string()
                } else {
                    id_trimmed.clone()
                };
                eprintln!(
                    "[airi-qt] stage: model loaded: {} (primitive_count={})",
                    path.display(),
                    engine.primitive_count()
                );
                self.as_mut().rust_mut().engine = Some(engine);
                self.as_mut().rust_mut().last_settings_id = id_trimmed.clone();
                self.as_mut().apply_loaded(&display_id);
            }
            Err(err) => {
                eprintln!("[airi-qt] stage: load failed ({id_trimmed}): {err}");
                self.as_mut().rust_mut().engine = None;
                self.as_mut().rust_mut().last_settings_id = id_trimmed.clone();
                self.as_mut().apply_cleared(&err, &id_trimmed);
            }
        }
    }

    /// Load the model at `path`.
    pub fn load_model(self: Pin<&mut Self>, path: QString) {
        let id = crate::bridges::qstring_to_string(&path);
        let id = id.trim().to_string();
        if id.is_empty() {
            self.unload();
            return;
        }
        self.load_with_id(id);
    }

    /// Load whatever `settings/stage-model` points at.
    pub fn load_from_settings(self: Pin<&mut Self>) {
        let id = configured_model_id();
        self.load_with_id(id);
    }

    /// Reload only when the stored model id changed since the last load.
    pub fn reload_from_settings(mut self: Pin<&mut Self>) -> bool {
        let id = configured_model_id();
        if id == self.as_ref().last_settings_id {
            return false;
        }
        self.as_mut().load_with_id(id);
        true
    }

    /// Drop the current model.
    pub fn unload(mut self: Pin<&mut Self>) {
        self.as_mut().rust_mut().engine = None;
        self.as_mut().rust_mut().last_settings_id = String::new();
        self.as_mut().apply_cleared("No model loaded", "");
    }

    /// Advance the simulation and re-skin all primitives.
    pub fn skin_and_morph(mut self: Pin<&mut Self>, dt_ms: f64) {
        if let Some(engine) = self.as_mut().rust_mut().engine.as_mut() {
            engine.tick(dt_ms as f32);
        }
        if crate::bridges::smoke() {
            SMOKE_SKIN_TICKS.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Vertex buffer bytes for primitive `index`.
    pub fn vertex_data(&self, index: i32) -> QByteArray {
        self.engine
            .as_ref()
            .and_then(|e| e.vertex_bytes(index.max(0) as usize))
            .map(|v| QByteArray::from(v.as_slice()))
            .unwrap_or_default()
    }

    /// Index buffer bytes for primitive `index`.
    pub fn index_data(&self, index: i32) -> QByteArray {
        self.engine
            .as_ref()
            .and_then(|e| e.index_bytes(index.max(0) as usize))
            .map(|v| QByteArray::from(v.as_slice()))
            .unwrap_or_default()
    }

    /// Vertex stride in bytes.
    pub fn vertex_stride(&self) -> i32 {
        64
    }

    /// Material index for primitive `index`, or -1.
    pub fn primitive_material(&self, index: i32) -> i32 {
        self.engine
            .as_ref()
            .and_then(|e| e.primitive_material(index.max(0) as usize))
            .map(|m| m as i32)
            .unwrap_or(-1)
    }

    /// Base color for material `material`.
    pub fn material_base_color(&self, material: i32) -> QColor {
        mtoon_color(self.engine.as_ref(), material, |p| p.base_color)
    }

    /// Shade color for material `material`.
    pub fn material_shade_color(&self, material: i32) -> QColor {
        mtoon_color(self.engine.as_ref(), material, |p| p.shade_color)
    }

    /// File URL of the material's base-color texture (white fallback).
    pub fn material_texture_url(&self, material: i32) -> QString {
        match self
            .engine
            .as_ref()
            .and_then(|e| e.material_texture(material.max(0) as u32))
        {
            Some(tex) => cached_texture_url(tex, material),
            None => white_texture_url(),
        }
    }

    /// Whether material `material` has a base-color texture.
    pub fn has_material_texture(&self, material: i32) -> bool {
        self.engine
            .as_ref()
            .and_then(|e| e.material_texture(material.max(0) as u32))
            .is_some()
    }

    /// Set an expression weight.
    pub fn set_expression_weight(mut self: Pin<&mut Self>, name: QString, weight: f64) {
        let name = crate::bridges::qstring_to_string(&name);
        if let Some(engine) = self.as_mut().rust_mut().engine.as_mut() {
            engine.set_expression_weight(&name, weight as f32);
        }
    }

    /// Names of emotions derived from the loaded document.
    pub fn available_expressions(&self) -> QStringList {
        match &self.engine {
            Some(engine) => engine
                .available_expressions()
                .into_iter()
                .map(|s| QString::from(s.as_str()))
                .collect(),
            None => QStringList::default(),
        }
    }

    /// Feed the lip-sync amplitude.
    pub fn set_lip_sync(mut self: Pin<&mut Self>, amplitude: f64) {
        if let Some(engine) = self.as_mut().rust_mut().engine.as_mut() {
            engine.set_lip_sync(amplitude as f32);
        }
    }

    /// Point the gaze at a screen position (pixels).
    pub fn look_at(mut self: Pin<&mut Self>, pos: QPointF) {
        let (w, h) = (
            self.as_ref().monitor_width as f32,
            self.as_ref().monitor_height as f32,
        );
        if let Some(engine) = self.as_mut().rust_mut().engine.as_mut() {
            engine.look_at(pos.x() as f32, pos.y() as f32, w, h);
        }
    }

    /// Reset gaze to forward.
    pub fn clear_look_at(mut self: Pin<&mut Self>) {
        if let Some(engine) = self.as_mut().rust_mut().engine.as_mut() {
            engine.clear_look_at();
        }
    }

    /// Set the monitor size used to normalize `lookAt` positions.
    pub fn set_monitor_size(mut self: Pin<&mut Self>, width: f64, height: f64) {
        self.as_mut().rust_mut().monitor_width = width.max(1.0);
        self.as_mut().rust_mut().monitor_height = height.max(1.0);
    }
}

fn mtoon_color(
    engine: Option<&airi_render::vrm::engine::Engine>,
    material: i32,
    pick: impl Fn(&airi_render::vrm::materials::MtoonParams) -> [f32; 4],
) -> QColor {
    let rgba = engine
        .and_then(|e| e.mtoon(material.max(0) as u32))
        .map(pick)
        .unwrap_or([1.0, 1.0, 1.0, 1.0]);
    QColor::from_rgba_f(rgba[0], rgba[1], rgba[2], rgba[3])
}

// ---------------------------------------------------------------------------
// Texture cache (profile-scoped)
// ---------------------------------------------------------------------------

fn stage_cache_dir() -> Option<PathBuf> {
    let base = crate::bridges::profile_dir()
        .cloned()
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("stage-cache");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// 1x1 white PNG (58 bytes), used as the fallback sampler binding.
const WHITE_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0xa9, 0xe9, 0x41, 0x6b, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

fn url_for_path(path: &std::path::Path) -> QString {
    let display = path.display().to_string().replace(' ', "%20");
    QString::from(format!("file:///{display}").as_str())
}

fn white_texture_url() -> QString {
    let Some(dir) = stage_cache_dir() else {
        return QString::from("");
    };
    let path = dir.join("white.png");
    if !path.exists() {
        let _ = std::fs::write(&path, WHITE_PNG);
    }
    url_for_path(&path)
}

fn cached_texture_url(tex: &airi_render::vrm::engine::MaterialTexture, material: i32) -> QString {
    let Some(dir) = stage_cache_dir() else {
        return white_texture_url();
    };
    // Cheap content fingerprint: length + a sample of the bytes.
    let mut sample: u64 = tex.bytes.len() as u64;
    for (i, chunk) in tex.bytes.chunks(4096).enumerate().take(16) {
        sample = sample.wrapping_mul(1_099_511_628_211).wrapping_add(
            chunk
                .iter()
                .map(|&b| b as u64)
                .sum::<u64>()
                .wrapping_add(i as u64),
        );
    }
    let path = dir.join(format!("tex-{material}-{sample:x}.{}", tex.extension));
    if !path.exists() {
        if let Err(e) = std::fs::write(&path, &tex.bytes) {
            eprintln!("[airi-qt] stage: failed to cache texture for material {material}: {e}");
            return white_texture_url();
        }
    }
    url_for_path(&path)
}
