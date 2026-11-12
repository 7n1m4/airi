// SPDX-License-Identifier: GPL-3.0-or-later
//! MMD stage scene bridge (P10 M1 — static rest-pose render).
//!
//! `MmdController` — owns the rest-pose engine (`airi_mmd::RestPoseEngine`),
//! feeds the shared 64-byte interleaved vertex buffer to the stage geometry,
//! and exposes the same surface as the VRM `StageSceneController`
//! (`bridges/stage.rs`): `ready`, `status`, `model_id`, `model_version`,
//! `primitive_count`, `vertex_stride()`, `vertex_data(prim)`,
//! `index_data(prim)`, `primitive_material(prim)`, `material_base_color()`,
//! `material_shade_color()`, `material_texture_url()`, `has_material_texture()`,
//! `skin_and_morph(dt)`, `load_from_settings()`, `load_model(path)`,
//! `reload_from_settings()`, `unload()`.
//!
//! Semantics match the VRM bridge with two deliberate differences:
//!
//! - **No motion in M1.** The rest pose is uploaded verbatim on every
//!   `skin_and_morph` tick; the engine's tick is a pure frame counter. IK,
//!   skinning and morph evaluation are M2+.
//! - **Textures.** Texture bytes are resolved relative to the `.pmx` file's
//!   parent directory at load time (Windows separators normalized;
//!   case-insensitive fallback is NOT performed). `.zip` archives and the
//!   built-in MMD toon ramps are not supported. Cache copies into the shared
//!   `stage-cache` profile dir under an `mmd-` prefix.
//!
//! `settings/stage-model` is read by `load_from_settings()` exactly like the
//! VRM path reads it, but only `.pmx`/`.pmd` paths are acted on — anything
//! else leaves the stage empty with an explanatory status (the VRM and
//! Spine renderers keep their own paths; the stage window picks by
//! extension). `.pmd` files parse-fail with a dedicated status: the PMD
//! reader does not exist yet (P10 M2).
//!
//! Loading is non-fatal by design: a missing or broken model leaves an
//! empty stage with a status string, never a crash.
//!
//! The bridge surface is plain Rust: byte buffers are `Vec<u8>`, colors are
//! `[f32; 4]` RGBA tuples, strings are `String`; state lives behind a
//! process-wide `Mutex`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;

use airi_core::settings::StageModelSettings;

/// MMD scene state. Property fields match the former `#[qproperty(..)]`
/// names; non-property state (`engine`, `last_settings_id`) lives here too.
pub struct MmdState {
    pub ready: bool,
    pub status: String,
    pub model_id: String,
    pub primitive_count: i32,
    pub model_version: i32,
    pub engine: Option<airi_mmd::RestPoseEngine>,
    /// `model_id` from settings as of the last (re)load; used by the poll.
    pub last_settings_id: String,
}

impl Default for MmdState {
    fn default() -> Self {
        Self {
            ready: false,
            status: "No MMD model loaded".to_string(),
            model_id: String::new(),
            primitive_count: 0,
            model_version: 0,
            engine: None,
            last_settings_id: String::new(),
        }
    }
}

static STATE: Mutex<MmdState> = Mutex::new(MmdState {
    ready: false,
    status: String::new(),
    model_id: String::new(),
    primitive_count: 0,
    model_version: 0,
    engine: None,
    last_settings_id: String::new(),
});

/// Lock the process-wide MMD state for a UI-thread operation.
pub fn with_state<R>(f: impl FnOnce(&mut MmdState) -> R) -> R {
    match STATE.lock() {
        Ok(mut state) => f(&mut state),
        Err(e) => f(&mut e.into_inner()),
    }
}

static SMOKE_SKIN_TICKS: AtomicI32 = AtomicI32::new(0);

/// Number of `skin_and_morph` calls made in `--smoke` mode (smoke-tour proof).
pub fn smoke_skin_ticks() -> i32 {
    SMOKE_SKIN_TICKS.load(Ordering::SeqCst)
}

/// Read the configured `model_id` (empty string when unset/unparseable).
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

impl MmdState {
    fn apply_loaded(&mut self, model_id: &str) {
        let count = self
            .engine
            .as_ref()
            .map(|e| e.primitive_count() as i32)
            .unwrap_or(0);
        self.primitive_count = count;
        self.ready = true;
        self.model_id = model_id.to_string();
        self.status = "Model ready".to_string();
        self.model_version += 1;
    }

    fn apply_cleared(&mut self, status: &str, model_id: &str) {
        self.primitive_count = 0;
        self.ready = false;
        self.model_id = model_id.to_string();
        self.status = status.to_string();
        self.model_version += 1;
    }

    /// Load (or reload) the model identified by `id` (already trimmed).
    fn load_with_id(&mut self, id: String) {
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
                self.engine = Some(engine);
                self.last_settings_id = id_trimmed.clone();
                self.apply_loaded(&id_trimmed);
            }
            Err(err) => {
                eprintln!("[airi-slint] mmd: load failed ({id_trimmed}): {err}");
                self.engine = None;
                self.last_settings_id = id_trimmed.clone();
                self.apply_cleared(&err, &id_trimmed);
            }
        }
    }

    /// Load the model at `path`.
    pub fn load_model(&mut self, path: &str) {
        let id = path.trim().to_string();
        if id.is_empty() {
            self.unload();
            return;
        }
        self.load_with_id(id);
    }

    /// Load whatever `settings/stage-model` points at (MMD paths only).
    pub fn load_from_settings(&mut self) {
        let id = configured_model_id();
        self.load_with_id(id);
    }

    /// Reload only when the stored model id changed since the last load.
    pub fn reload_from_settings(&mut self) -> bool {
        let id = configured_model_id();
        if id == self.last_settings_id {
            return false;
        }
        self.load_with_id(id);
        true
    }

    /// Drop the current model.
    pub fn unload(&mut self) {
        self.engine = None;
        self.last_settings_id = String::new();
        self.apply_cleared("No MMD model loaded", "");
    }

    /// Advance the (M1: non-existent) animation clock.
    pub fn skin_and_morph(&mut self, dt_ms: f64) {
        if let Some(engine) = self.engine.as_mut() {
            engine.tick(dt_ms as f32);
        }
        if crate::bridges::smoke() {
            SMOKE_SKIN_TICKS.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Interleaved vertex buffer bytes (shared by every primitive).
    pub fn vertex_data(&self, index: i32) -> Vec<u8> {
        let _ = index; // one shared buffer; index kept for API parity
        self.engine.as_ref().map(|e| e.vertex_bytes().to_vec()).unwrap_or_default()
    }

    /// Index buffer bytes for primitive `index`.
    pub fn index_data(&self, index: i32) -> Vec<u8> {
        self.engine
            .as_ref()
            .and_then(|e| e.index_bytes(index.max(0) as usize))
            .map(<[u8]>::to_vec)
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
    pub fn material_base_color(&self, material: i32) -> [f32; 4] {
        mtoon_color(self.engine.as_ref(), material, |m| m.base_color)
    }

    /// Shade color for material `material`.
    pub fn material_shade_color(&self, material: i32) -> [f32; 4] {
        mtoon_color(self.engine.as_ref(), material, |m| m.shade_color)
    }

    /// File URL of the material's base-color texture (white fallback).
    pub fn material_texture_url(&self, material: i32) -> String {
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
) -> [f32; 4] {
    engine
        .and_then(|e| e.materials().get(material.max(0) as usize))
        .map(pick)
        .unwrap_or([1.0, 1.0, 1.0, 1.0])
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

fn url_for_path(path: &std::path::Path) -> String {
    let display = path.display().to_string().replace(' ', "%20");
    format!("file:///{display}")
}

fn white_texture_url() -> String {
    let Some(dir) = stage_cache_dir() else {
        return String::new();
    };
    let path = dir.join("white.png");
    if !path.exists() {
        let _ = std::fs::write(&path, WHITE_PNG);
    }
    url_for_path(&path)
}

fn cached_texture_url(tex: &airi_mmd::RestPoseTexture, material: i32) -> String {
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