// SPDX-License-Identifier: GPL-3.0-or-later
//! Stage scene bridge (VRM).
//!
//! `StageState` — owns the resolved VRM engine
//! (`airi_render::vrm::engine`), feeds CPU-skinned vertex buffers to the
//! stage geometry, and exposes the expression / lip-sync / gaze hooks.
//! Loading is non-fatal by design: a missing or broken model leaves an
//! empty stage with a status string, never a crash.
//!
//! Window bounds/visibility persistence is owned by the stage-settings
//! bridge (`StageSettingsState`, `settings/stage-window`); the stage
//! window consumes it directly — this bridge intentionally does not
//! duplicate it.
//!
//! The smoke tour relies on [`smoke_skin_ticks`] to prove the scene ticked.
//!
//! Port of the former cxx-qt `StageSceneController`: byte arrays become
//! `Vec<u8>`, colors become an `[f32; 4]` RGBA tuple, string types become
//! `String`/`Vec<String>` and the point type becomes two `f64` pixel
//! coordinates; the bridge lives behind a process-wide `Mutex`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;

use airi_core::settings::StageModelSettings;

/// VRM scene state. The former property fields are plain Rust fields;
/// non-property state (`engine`, the monitor size and `last_settings_id`)
/// lives here too.
pub struct StageState {
    pub ready: bool,
    pub status: String,
    pub model_id: String,
    pub primitive_count: i32,
    pub model_version: i32,
    pub engine: Option<airi_render::vrm::engine::Engine>,
    /// Monitor width in pixels, used to normalize `look_at` positions.
    pub monitor_width: f64,
    /// Monitor height in pixels, used to normalize `look_at` positions.
    pub monitor_height: f64,
    /// `model_id` from settings as of the last (re)load; used by the poll.
    pub last_settings_id: String,
}

impl Default for StageState {
    fn default() -> Self {
        Self {
            ready: false,
            status: "No model loaded".to_string(),
            model_id: String::new(),
            primitive_count: 0,
            model_version: 0,
            engine: None,
            monitor_width: 1920.0,
            monitor_height: 1080.0,
            last_settings_id: String::new(),
        }
    }
}

static STATE: Mutex<StageState> = Mutex::new(StageState {
    ready: false,
    status: String::new(),
    model_id: String::new(),
    primitive_count: 0,
    model_version: 0,
    engine: None,
    monitor_width: 1920.0,
    monitor_height: 1080.0,
    last_settings_id: String::new(),
});

/// Lock the process-wide stage state for a UI-thread operation.
pub fn with_state<R>(f: impl FnOnce(&mut StageState) -> R) -> R {
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

impl StageState {
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
                    "[airi-slint] stage: model loaded: {} (primitive_count={})",
                    path.display(),
                    engine.primitive_count()
                );
                self.engine = Some(engine);
                self.last_settings_id = id_trimmed.clone();
                self.apply_loaded(&display_id);
            }
            Err(err) => {
                eprintln!("[airi-slint] stage: load failed ({id_trimmed}): {err}");
                self.engine = None;
                self.last_settings_id = id_trimmed.clone();
                self.apply_cleared(&err, &id_trimmed);
            }
        }
    }

    /// Load the model at `path` (empty string unloads).
    pub fn load_model(&mut self, path: &str) {
        let id = path.trim().to_string();
        if id.is_empty() {
            self.unload();
            return;
        }
        self.load_with_id(id);
    }

    /// Load whatever `settings/stage-model` points at.
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
        self.apply_cleared("No model loaded", "");
    }

    /// Advance the simulation and re-skin all primitives.
    pub fn skin_and_morph(&mut self, dt_ms: f64) {
        if let Some(engine) = self.engine.as_mut() {
            engine.tick(dt_ms as f32);
        }
        if crate::bridges::smoke() {
            SMOKE_SKIN_TICKS.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Vertex buffer bytes for primitive `index`.
    pub fn vertex_data(&self, index: i32) -> Vec<u8> {
        self.engine
            .as_ref()
            .and_then(|e| e.vertex_bytes(index.max(0) as usize))
            .unwrap_or_default()
    }

    /// Index buffer bytes for primitive `index`.
    pub fn index_data(&self, index: i32) -> Vec<u8> {
        self.engine
            .as_ref()
            .and_then(|e| e.index_bytes(index.max(0) as usize))
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
    pub fn material_base_color(&self, material: i32) -> [f32; 4] {
        mtoon_color(self.engine.as_ref(), material, |p| p.base_color)
    }

    /// Shade color for material `material`.
    pub fn material_shade_color(&self, material: i32) -> [f32; 4] {
        mtoon_color(self.engine.as_ref(), material, |p| p.shade_color)
    }

    /// File URL of the material's base-color texture (white fallback).
    pub fn material_texture_url(&self, material: i32) -> String {
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
    pub fn set_expression_weight(&mut self, name: &str, weight: f64) {
        if let Some(engine) = self.engine.as_mut() {
            engine.set_expression_weight(name, weight as f32);
        }
    }

    /// Names of emotions derived from the loaded document.
    pub fn available_expressions(&self) -> Vec<String> {
        match &self.engine {
            Some(engine) => engine.available_expressions(),
            None => Vec::new(),
        }
    }

    /// Feed the lip-sync amplitude.
    pub fn set_lip_sync(&mut self, amplitude: f64) {
        if let Some(engine) = self.engine.as_mut() {
            engine.set_lip_sync(amplitude as f32);
        }
    }

    /// Point the gaze at a screen position (pixels), normalized against the
    /// monitor size set by [`StageState::set_monitor_size`].
    pub fn look_at(&mut self, x: f64, y: f64) {
        let (w, h) = (self.monitor_width as f32, self.monitor_height as f32);
        if let Some(engine) = self.engine.as_mut() {
            engine.look_at(x as f32, y as f32, w, h);
        }
    }

    /// Reset gaze to forward.
    pub fn clear_look_at(&mut self) {
        if let Some(engine) = self.engine.as_mut() {
            engine.clear_look_at();
        }
    }

    /// Set the monitor size used to normalize [`StageState::look_at`]
    /// positions.
    pub fn set_monitor_size(&mut self, width: f64, height: f64) {
        self.monitor_width = width.max(1.0);
        self.monitor_height = height.max(1.0);
    }
}

fn mtoon_color(
    engine: Option<&airi_render::vrm::engine::Engine>,
    material: i32,
    pick: impl Fn(&airi_render::vrm::materials::MtoonParams) -> [f32; 4],
) -> [f32; 4] {
    engine
        .and_then(|e| e.mtoon(material.max(0) as u32))
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

fn url_for_path(path: &Path) -> String {
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

fn cached_texture_url(tex: &airi_render::vrm::engine::MaterialTexture, material: i32) -> String {
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
            eprintln!("[airi-slint] stage: failed to cache texture for material {material}: {e}");
            return white_texture_url();
        }
    }
    url_for_path(&path)
}