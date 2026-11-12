// SPDX-License-Identifier: GPL-3.0-or-later
//! Shared spine runtime state.
//!
//! One process-wide session (the stage shows one model) guarded by a mutex.
//! The GUI thread drives it through the `SpineController` bridge; the render
//! side (`spine_render`) reads the posed frame through `with_session`.

use airi_render::bundle::ModelBundle;
use airi_render::spine::animation::EMOTION_TRACK;
use airi_render::spine::{detect_version_binary, detect_version_json, resolve_idle, SpineSession};

use std::sync::Mutex;

/// Process-wide spine state.
#[derive(Default)]
pub(crate) struct SpineState {
    /// Loaded session, if any.
    pub session: Option<SpineSession>,
    /// Absolute path of the bundle root (for texture lookup).
    pub bundle_root: Option<std::path::PathBuf>,
    /// Skeleton version bucket reported at load, e.g. `4.2`.
    pub version: Option<String>,
}

static STATE: Mutex<SpineState> = Mutex::new(SpineState {
    session: None,
    bundle_root: None,
    version: None,
});

/// Create (once per process) and load a bundle path (zip or directory
/// containing the synthetic loose layout: directory must hold skeleton.json
/// and synthetic.atlas). Returns Ok on success.
pub fn load_bundle_path(path: &str) -> anyhow::Result<()> {
    let mut state = STATE
        .lock()
        .map_err(|_| anyhow::anyhow!("spine state poisoned"))?;
    state.session = None;
    state.bundle_root = None;
    state.version = None;

    let p = std::path::Path::new(path);
    let is_zip = p
        .extension()
        .map(|e| e.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
        || p.is_file();
    let bundle = if is_zip {
        ModelBundle::open(p)?
    } else {
        // Loose directory: synthesize the "no extraction" view by pointing at it.
        let entries = ["skeleton.json", "skeleton.skel", "synthetic.atlas"]
            .iter()
            .filter_map(|name| {
                let cand = p.join(name);
                cand.is_file().then(|| airi_render::bundle::BundleEntry {
                    zip_path: (*name).to_string(),
                    extracted_path: cand.clone(),
                    len: std::fs::metadata(&cand).map(|m| m.len()).unwrap_or(0),
                })
            })
            .collect::<Vec<_>>();
        if entries.is_empty() {
            anyhow::bail!("no spine entries in {}", p.display());
        }
        airi_render::bundle::ModelBundle {
            root: p.to_path_buf(),
            entries,
            hash: String::from("loose"),
            cache_hit: true,
        }
    };

    let layout = bundle
        .spine_layout()
        .ok_or_else(|| anyhow::anyhow!("no spine entries (atlas/skeleton) in {}", p.display()))?;
    let map = bundle.path_map();
    let skeleton_path = map
        .get(&layout.skeleton_zip_path)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("skeleton entry missing from extraction"))?;
    let atlas_path = map
        .get(&layout.atlas_zip_path)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("atlas entry missing from extraction"))?;

    let skeleton_bytes = std::fs::read(&skeleton_path)?;
    let atlas_text = std::fs::read_to_string(&atlas_path)?;
    let detected = if layout.skeleton_binary {
        detect_version_binary(&skeleton_bytes)
    } else {
        detect_version_json(&String::from_utf8_lossy(&skeleton_bytes))
    };

    let session = SpineSession::load(&skeleton_bytes, layout.skeleton_binary, &atlas_text)?;
    state.version = detected;
    state.bundle_root = Some(bundle.root.clone());
    state.session = Some(session);
    Ok(())
}

/// Set the idle animation (track 0), resolving fallbacks.
pub fn play_idle(name: &str) -> anyhow::Result<String> {
    let state = STATE
        .lock()
        .map_err(|_| anyhow::anyhow!("spine state poisoned"))?;
    let session = state
        .session
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no spine model loaded"))?;
    let names: Vec<String> = session.animations().into_iter().map(|(n, _)| n).collect();
    let resolved =
        resolve_idle(&names, name).ok_or_else(|| anyhow::anyhow!("no animations on skeleton"))?;
    session.set_animation(airi_render::spine::animation::IDLE_TRACK, &resolved, true);
    Ok(resolved)
}

/// Set an animation on a track; returns resolved name on success.
pub fn play(track: usize, name: &str, loop_: bool) -> anyhow::Result<String> {
    let state = STATE
        .lock()
        .map_err(|_| anyhow::anyhow!("spine state poisoned"))?;
    let session = state
        .session
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no spine model loaded"))?;
    let names: Vec<String> = session.animations().into_iter().map(|(n, _)| n).collect();
    let resolved =
        airi_render::spine::resolve_animation(&names, name).unwrap_or_else(|| name.to_string());
    if !session.set_animation(track, &resolved, loop_) {
        anyhow::bail!("animation `{resolved}` missing on skeleton");
    }
    Ok(resolved)
}

/// Trigger the first `hit_*` animation as a one-shot on the emotion track.
pub fn poke() -> anyhow::Result<Option<String>> {
    let state = STATE
        .lock()
        .map_err(|_| anyhow::anyhow!("spine state poisoned"))?;
    let session = state
        .session
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no spine model loaded"))?;
    let names: Vec<String> = session.animations().into_iter().map(|(n, _)| n).collect();
    let Some(hit) = airi_render::spine::animation::find_hit_animation(&names) else {
        return Ok(None);
    };
    session.set_animation(EMOTION_TRACK, &hit, false);
    Ok(Some(hit))
}

/// Apply an explicit skin; false when missing.
pub fn set_skin(name: &str) -> anyhow::Result<bool> {
    let state = STATE
        .lock()
        .map_err(|_| anyhow::anyhow!("spine state poisoned"))?;
    let session = state
        .session
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no spine model loaded"))?;
    Ok(session.set_skin(name))
}

/// Set the default animation-state mix (seconds).
pub fn set_default_mix(seconds: f32) {
    if let Ok(state) = STATE.lock() {
        if let Some(session) = state.session.as_ref() {
            session.set_default_mix(seconds);
        }
    }
}

/// Advance the session (render-thread side).
pub fn advance(dt: f32) -> bool {
    if let Ok(state) = STATE.lock() {
        if let Some(session) = state.session.as_ref() {
            session.update(dt);
            return true;
        }
    }
    false
}

/// Whether a model is loaded.
pub fn loaded() -> bool {
    STATE.lock().map(|s| s.session.is_some()).unwrap_or(false)
}

/// Run `f` against the loaded session, or return `default` when none / poisoned.
pub(crate) fn with_session<R>(f: impl FnOnce(&SpineSession) -> R, default: R) -> R {
    if let Ok(state) = STATE.lock() {
        if let Some(session) = state.session.as_ref() {
            return f(session);
        }
    }
    default
}

/// Bundle root path (for texture lookup), if a session is loaded.
pub fn bundle_root() -> Option<std::path::PathBuf> {
    STATE.lock().ok().and_then(|s| s.bundle_root.clone())
}

/// Smoke-check: load the bundled synthetic spine asset, tick 90 frames,
/// log progress. Returns true on success. Always runs (even without a UI)
/// when `--smoke` is passed.
pub fn spine_smoke_check() -> bool {
    let asset = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/test-models/synthetic/synthetic.zip"
    );
    eprintln!("[airi-slint] smoke: spine check loading {asset}");
    if let Err(error) = load_bundle_path(asset) {
        eprintln!("[airi-slint] smoke: spine check FAILED to load: {error:#}");
        return false;
    }
    match play_idle("idle") {
        Ok(name) => {
            eprintln!("[airi-slint] smoke: spine asset parsed ok, animation [{name}] at t=0.000s")
        }
        Err(error) => eprintln!("[airi-slint] smoke: spine idle fallback failed: {error:#}"),
    }
    let mut t = 0.0f32;
    for _ in 0..90 {
        advance(1.0 / 60.0);
        t += 1.0 / 60.0;
    }
    let data = with_session(
        |s| s.collect_draws(),
        airi_render::spine::DrawData::default(),
    );
    eprintln!(
        "[airi-slint] smoke: spine tick ok (90 frames, t={t:.3}s, vertices={}, draws={})",
        data.vertices.len(),
        data.draws.len()
    );
    !data.vertices.is_empty()
}