// SPDX-License-Identifier: GPL-3.0-or-later
//! MMD stage scene bridge (P10 M1 — static rest-pose render).
//!
//! `MmdController` — owns the rest-pose engine (`airi_mmd::RestPoseEngine`),
//! feeds the shared 64-byte interleaved vertex buffer to the
//! `AiriVrmGeometryShell` instances QML creates, and exposes the same
//! QML-facing surface as the VRM `StageSceneController`
//! (`bridges/stage.rs`): `ready`, `status`, `modelId`, `modelVersion`,
//! `primitiveCount`, `vertexStride()`, `vertexData(prim)`,
//! `indexData(prim)`, `primitiveMaterial(prim)`, `materialBaseColor()`,
//! `materialShadeColor()`, `materialTextureUrl()`, `hasMaterialTexture()`,
//! `skinAndMorph(dt)`, `loadFromSettings()`, `loadModel(path)`,
//! `reloadFromSettings()`, `unload()`.
//!
//! Semantics match the VRM bridge with two deliberate differences:
//!
//! - **No motion in M1.** The rest pose is uploaded verbatim on every
//!   `skinAndMorph` tick; the engine's tick is a pure frame counter. IK,
//!   skinning and morph evaluation are M2+.
//! - **Textures.** Texture bytes are resolved relative to the `.pmx` file's
//!   parent directory at load time (Windows separators normalized;
//!   case-insensitive fallback is NOT performed). `.zip` archives and the
//!   built-in MMD toon ramps are not supported. Cache copies into the shared
//!   `stage-cache` profile dir under an `mmd-` prefix.
//!
//! `settings/stage-model` is read by `loadFromSettings()` exactly like the
//! VRM path reads it, but only `.pmx`/`.pmd` paths are acted on — anything
//! else leaves the stage empty with an explanatory status (the VRM and
//! Spine renderers keep their own paths; `StageWindow.qml` picks by
//! extension). `.pmd` files parse-fail with a dedicated status: the PMD
//! reader does not exist yet (P10 M2).
//!
//! Loading is non-fatal by design: a missing or broken model leaves an
//! empty stage with a status string, never a crash.
//!
//! This bridge is registered centrally (build.rs + `bridges/mod.rs`); see
//! `docs/phase-notes/p10-lane-mmd-m1.md`.

use cxx_qt_lib::{QByteArray, QColor, QString};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicI32, Ordering};

use airi_core::settings::StageModelSettings;
use cxx_qt::CxxQtType;

/// cxx-qt bridge definitions for the MMD bridge.
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
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// MMD scene controller exposed to QML.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, ready)]
        #[qproperty(QString, status)]
        #[qproperty(QString, model_id, cxx_name = "modelId")]
        #[qproperty(i32, primitive_count, cxx_name = "primitiveCount")]
        #[qproperty(i32, model_version, cxx_name = "modelVersion")]
        type MmdController = super::MmdControllerRust;
    }

    extern "RustQt" {
        /// Load the model at `path` (absolute filesystem path to a `.pmx`
        /// file). Pass an empty string to unload. `.pmd` paths fail with a
        /// dedicated status; anything else is rejected by the parser.
        #[qinvokable]
        #[cxx_name = "loadModel"]
        fn load_model(self: Pin<&mut MmdController>, path: QString);

        /// Re-read `settings/stage-model` and load it when it points at a
        /// `.pmx`/`.pmd` path; anything else leaves the stage empty.
        #[qinvokable]
        #[cxx_name = "loadFromSettings"]
        fn load_from_settings(self: Pin<&mut MmdController>);

        /// Cheap poll for settings-page model switches; reloads only when
        /// the stored `modelId` changed since the last call.
        #[qinvokable]
        #[cxx_name = "reloadFromSettings"]
        fn reload_from_settings(self: Pin<&mut MmdController>) -> bool;

        /// Drop the current model (stage goes empty).
        #[qinvokable]
        fn unload(self: Pin<&mut MmdController>);

        /// Advance the (M1: non-existent) animation clock and re-upload the
        /// rest pose. Called by QML on a timer before frames render.
        #[qinvokable]
        #[cxx_name = "skinAndMorph"]
        fn skin_and_morph(self: Pin<&mut MmdController>, dt_ms: f64);

        /// Interleaved vertex buffer (pos/normal/uv/joints/weights, stride
        /// 64 bytes). The same buffer is shared by every primitive.
        #[qinvokable]
        #[cxx_name = "vertexData"]
        fn vertex_data(self: &MmdController, index: i32) -> QByteArray;

        /// u32 index buffer for primitive `index`.
        #[qinvokable]
        #[cxx_name = "indexData"]
        fn index_data(self: &MmdController, index: i32) -> QByteArray;

        /// Vertex stride in bytes (64).
        #[qinvokable]
        #[cxx_name = "vertexStride"]
        fn vertex_stride(self: &MmdController) -> i32;

        /// Material index for primitive `index`, or -1 (unassigned faces).
        #[qinvokable]
        #[cxx_name = "primitiveMaterial"]
        fn primitive_material(self: &MmdController, index: i32) -> i32;

        /// Base color uniform for material `material`.
        #[qinvokable]
        #[cxx_name = "materialBaseColor"]
        fn material_base_color(self: &MmdController, material: i32) -> QColor;

        /// Shade color uniform for material `material`.
        #[qinvokable]
        #[cxx_name = "materialShadeColor"]
        fn material_shade_color(self: &MmdController, material: i32) -> QColor;

        /// File URL of the material's base-color texture (a cached white
        /// 1x1 PNG when the material has none).
        #[qinvokable]
        #[cxx_name = "materialTextureUrl"]
        fn material_texture_url(self: &MmdController, material: i32) -> QString;

        /// Whether material `material` has a base-color texture.
        #[qinvokable]
        #[cxx_name = "hasMaterialTexture"]
        fn has_material_texture(self: &MmdController, material: i32) -> bool;
    }
}

// ---------------------------------------------------------------------------
// MmdController
// ---------------------------------------------------------------------------

/// Rust storage for `MmdController`. Property fields match the
/// `#[qproperty(.., NAME)]` names; non-property state lives here too.
#[allow(missing_docs)]
pub struct MmdControllerRust {
    ready: bool,
    status: QString,
    model_id: QString,
    primitive_count: i32,
    model_version: i32,
    engine: Option<airi_mmd::RestPoseEngine>,
    /// `modelId` from settings as of the last (re)load; used by the poll.
    last_settings_id: String,
}

impl Default for MmdControllerRust {
    fn default() -> Self {
        Self {
            ready: false,
            status: QString::from("No MMD model loaded"),
            model_id: QString::from(""),
            primitive_count: 0,
            model_version: 0,
            engine: None,
            last_settings_id: String::new(),
        }
    }
}

static SMOKE_SKIN_TICKS: AtomicI32 = AtomicI32::new(0);

/// Number of `skinAndMorph` calls made in `--smoke` mode (smoke-tour proof).
pub fn smoke_skin_ticks() -> i32 {
    SMOKE_SKIN_TICKS.load(Ordering::SeqCst)
}

/// Read the configured `modelId` (empty string when unset/unparseable).
fn configured_model_id() -> String {
    crate::bridges::settings_store()
        .and_then(|store| store.load_section::<StageModelSettings>().ok())
        .map(|s| s.model_id.trim().to_string())
        .unwrap_or_default()
}

/// Whether `id` names an MMD model file AirI can load (`.pmx`; `.pmd` is
/// reserved for the M2 PMD reader).
fn is_mmd_model_path(id: &str) -> bool {
    let lower = id.trim().to_ascii_lowercase();
    lower.ends_with(".pmx") || lower.ends_with(".pmd")
}

impl qobject::MmdController {
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

    /// Load (or reload) the model identified by `id` (already trimmed).
    fn load_with_id(mut self: Pin<&mut Self>, id: String) {
        let id_trimmed = id.trim().to_string();
        let result: Result<airi_mmd::RestPoseEngine, String> = if !is_mmd_model_path(&id_trimmed) {
            Err(if id_trimmed.is_empty() {
                "No MMD model loaded".to_string()
            } else {
                format!("not an MMD model (.pmx/.pmd): {id_trimmed}")
            })
        } else if id_trimmed.to_ascii_lowercase().ends_with(".pmd") {
            Err("load failed: PMD is not supported yet (P10 M2)".to_string())
        } else {
            airi_mmd::RestPoseEngine::from_path(Path::new(&id_trimmed))
                .map_err(|e| format!("load failed: {id_trimmed}: {e}"))
        };
        match result {
            Ok(engine) => {
                eprintln!(
                    "[airi-slint] mmd: model loaded: {} (primitive_count={}, sdef_approximated={}, invalid_joints={}, face_mismatch={})",
                    id_trimmed,
                    engine.primitive_count(),
                    engine.sdef_approximated(),
                    engine.invalid_joint_count(),
                    engine.face_range_mismatch(),
                );
                self.as_mut().rust_mut().engine = Some(engine);
                self.as_mut().rust_mut().last_settings_id = id_trimmed.clone();
                self.as_mut().apply_loaded(&id_trimmed);
            }
            Err(err) => {
                eprintln!("[airi-slint] mmd: load failed ({id_trimmed}): {err}");
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

    /// Load whatever `settings/stage-model` points at (MMD paths only).
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
        self.as_mut().apply_cleared("No MMD model loaded", "");
    }

    /// Advance the (M1: non-existent) animation clock.
    pub fn skin_and_morph(mut self: Pin<&mut Self>, dt_ms: f64) {
        if let Some(engine) = self.as_mut().rust_mut().engine.as_mut() {
            engine.tick(dt_ms as f32);
        }
        if crate::bridges::smoke() {
            SMOKE_SKIN_TICKS.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Interleaved vertex buffer bytes (shared by every primitive).
    pub fn vertex_data(&self, index: i32) -> QByteArray {
        let _ = index; // one shared buffer; index kept for API parity
        self.engine
            .as_ref()
            .map(|e| QByteArray::from(e.vertex_bytes()))
            .unwrap_or_default()
    }

    /// Index buffer bytes for primitive `index`.
    pub fn index_data(&self, index: i32) -> QByteArray {
        self.engine
            .as_ref()
            .and_then(|e| e.index_bytes(index.max(0) as usize))
            .map(QByteArray::from)
            .unwrap_or_default()
    }

    /// Vertex stride in bytes.
    pub fn vertex_stride(&self) -> i32 {
        airi_mmd::VERTEX_STRIDE as i32
    }

    /// Material index for primitive `index`, or -1.
    pub fn primitive_material(&self, index: i32) -> i32 {
        self.engine
            .as_ref()
            .and_then(|e| e.primitive_material(index.max(0) as usize))
            .unwrap_or(-1)
    }

    /// Base color for material `material`.
    pub fn material_base_color(&self, material: i32) -> QColor {
        mtoon_color(self.engine.as_ref(), material, |m| m.base_color)
    }

    /// Shade color for material `material`.
    pub fn material_shade_color(&self, material: i32) -> QColor {
        mtoon_color(self.engine.as_ref(), material, |m| m.shade_color)
    }

    /// File URL of the material's base-color texture (white fallback).
    pub fn material_texture_url(&self, material: i32) -> QString {
        match self
            .engine
            .as_ref()
            .and_then(|e| e.materials().get(material.max(0) as usize))
            .and_then(|m| m.texture.as_ref())
        {
            Some(tex) => cached_texture_url(tex, material),
            None => white_texture_url(),
        }
    }

    /// Whether material `material` has a base-color texture.
    pub fn has_material_texture(&self, material: i32) -> bool {
        self.engine
            .as_ref()
            .and_then(|e| e.materials().get(material.max(0) as usize))
            .and_then(|m| m.texture.as_ref())
            .is_some()
    }
}

fn mtoon_color(
    engine: Option<&airi_mmd::RestPoseEngine>,
    material: i32,
    pick: impl Fn(&airi_mmd::RestPoseMaterial) -> [f32; 4],
) -> QColor {
    let rgba = engine
        .and_then(|e| e.materials().get(material.max(0) as usize))
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

fn cached_texture_url(tex: &airi_mmd::RestPoseTexture, material: i32) -> QString {
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
    let path = dir.join(format!("mmd-{material}-{sample:x}.{}", tex.extension));
    if !path.exists() {
        if let Err(e) = std::fs::write(&path, &tex.bytes) {
            eprintln!("[airi-slint] mmd: failed to cache texture for material {material}: {e}");
            return white_texture_url();
        }
    }
    url_for_path(&path)
}
