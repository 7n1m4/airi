// SPDX-License-Identifier: GPL-3.0-or-later
//! Shared spine runtime state and the C ABI the C++ `SpineItem` uses from
//! the render thread.
//!
//! One process-wide session (the stage shows one model) guarded by a mutex.
//! The GUI thread drives it via the `SpineController` bridge; the render
//! thread reads it through these `extern "C"` functions inside
//! `updatePaintNode`.

use airi_render::bundle::ModelBundle;
use airi_render::spine::animation::EMOTION_TRACK;
use airi_render::spine::{detect_version_binary, detect_version_json, resolve_idle, SpineSession};

use std::ffi::{c_char, c_float, c_int};
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
    /// Last error message (for `last_error()`).
    pub last_error: Option<String>,
}

static STATE: Mutex<SpineState> = Mutex::new(SpineState {
    session: None,
    bundle_root: None,
    version: None,
    last_error: None,
});

/// Create (once per process) and load a bundle path (zip or directory
/// containing the synthetic loose layout: directory must hold skeleton.json
/// and synthetic.atlas). Returns 0 on success.
pub(crate) fn load_bundle_path(path: &str) -> anyhow::Result<()> {
    let mut state = STATE
        .lock()
        .map_err(|_| anyhow::anyhow!("spine state poisoned"))?;
    state.session = None;
    state.bundle_root = None;
    state.version = None;
    state.last_error = None;

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
pub(crate) fn play_idle(name: &str) -> anyhow::Result<String> {
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
pub(crate) fn play(track: usize, name: &str, loop_: bool) -> anyhow::Result<String> {
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
pub(crate) fn poke() -> anyhow::Result<Option<String>> {
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
pub(crate) fn set_skin(name: &str) -> anyhow::Result<bool> {
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
pub(crate) fn set_default_mix(seconds: f32) {
    if let Ok(state) = STATE.lock() {
        if let Some(session) = state.session.as_ref() {
            session.set_default_mix(seconds);
        }
    }
}

/// Advance the session (render-thread side).
pub(crate) fn advance(dt: f32) -> bool {
    if let Ok(state) = STATE.lock() {
        if let Some(session) = state.session.as_ref() {
            session.update(dt);
            return true;
        }
    }
    false
}

/// Whether a model is loaded.
pub(crate) fn loaded() -> bool {
    STATE.lock().map(|s| s.session.is_some()).unwrap_or(false)
}

fn with_session<R>(f: impl FnOnce(&SpineSession) -> R, default: R) -> R {
    if let Ok(state) = STATE.lock() {
        if let Some(session) = state.session.as_ref() {
            return f(session);
        }
    }
    default
}

/// Vertex layout for the raw frame buffer handed to C++.
#[repr(C)]
pub struct RtVertex {
    x: f32,
    y: f32,
    u: f32,
    v: f32,
}

/// Draw command for C++.
#[repr(C)]
pub struct RtDraw {
    page_index: i32,
    blend_mode: i32,
    alpha: f32,
    vertex_offset: u32,
    vertex_count: u32,
    index_offset: u32,
    index_count: u32,
}

static LAST_ERROR: Mutex<String> = Mutex::new(String::new());
static BUNDLE_ROOT_BUF: Mutex<[u8; 4096]> = Mutex::new([0; 4096]);
static PAGE_IMAGE_BUF: Mutex<[u8; 4096]> = Mutex::new([0; 4096]);

fn set_last_error(message: String) {
    if let Ok(mut slot) = LAST_ERROR.lock() {
        *slot = message;
    }
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_load(path: *const c_char) -> c_int {
    let Some(path) = (unsafe { path.as_ref() }) else {
        return 1;
    };
    let Ok(path) = unsafe { std::ffi::CStr::from_ptr(path) }
        .to_str()
        .map(str::to_string)
    else {
        return 1;
    };
    match load_bundle_path(&path) {
        Ok(()) => {
            set_last_error(String::new());
            0
        }
        Err(error) => {
            set_last_error(format!("{error:#}"));
            1
        }
    }
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_last_error() -> *const c_char {
    static EMPTY: &[u8] = b"\0";
    match LAST_ERROR.lock() {
        Ok(slot) if !slot.is_empty() => slot.as_ptr().cast::<c_char>(),
        _ => EMPTY.as_ptr().cast(),
    }
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_loaded() -> c_int {
    c_int::from(loaded())
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_bundle_root() -> *const c_char {
    let root = with_session_and_root();
    match root {
        Some(root) => {
            let bytes = root.as_os_str().to_string_lossy().into_owned();
            write_static_str(&BUNDLE_ROOT_BUF, bytes.as_bytes())
        }
        None => c"".as_ptr().cast(),
    }
}

/// Fixed-size staging buffer for C ABI strings handed to C++.
/// Contents are only valid until the next call that writes the buffer.
fn write_static_str(buf: &Mutex<[u8; 4096]>, bytes: &[u8]) -> *const c_char {
    let mut guard = buf.lock().expect("spine string buffer poisoned");
    let len = bytes.len().min(guard.len() - 1);
    guard[..len].copy_from_slice(&bytes[..len]);
    guard[len] = 0;
    guard.as_ptr().cast()
}

fn with_session_and_root() -> Option<std::path::PathBuf> {
    STATE.lock().ok().and_then(|s| s.bundle_root.clone())
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_advance(dt: c_float) {
    advance(dt);
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_bounds(
    x: *mut c_float,
    y: *mut c_float,
    width: *mut c_float,
    height: *mut c_float,
) {
    let b = with_session(|s| s.bounds(), Default::default());
    unsafe {
        if let Some(v) = x.as_mut() {
            *v = b.x;
        }
        if let Some(v) = y.as_mut() {
            *v = b.y;
        }
        if let Some(v) = width.as_mut() {
            *v = b.width;
        }
        if let Some(v) = height.as_mut() {
            *v = b.height;
        }
    }
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_page_count() -> usize {
    with_session(|s| s.pages().len(), 0)
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_page_image(index: usize) -> *const c_char {
    let image = with_session(|s| s.pages().get(index).map(|p| p.image.clone()), None);
    match image {
        Some(image) => write_static_str(&PAGE_IMAGE_BUF, image.as_bytes()),
        None => c"".as_ptr().cast(),
    }
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_page_pma(index: usize) -> c_int {
    c_int::from(with_session(
        |s| s.pages().get(index).map(|p| p.pma).unwrap_or(false),
        false,
    ))
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_collect_counts(
    out_vertices: *mut usize,
    out_indices: *mut usize,
    out_draws: *mut usize,
) {
    let data = with_session(
        |s| s.collect_draws(),
        airi_render::spine::DrawData::default(),
    );
    unsafe {
        if let Some(v) = out_vertices.as_mut() {
            *v = data.vertices.len();
        }
        if let Some(v) = out_indices.as_mut() {
            *v = data.indices.len();
        }
        if let Some(v) = out_draws.as_mut() {
            *v = data.draws.len();
        }
    }
}

#[allow(missing_docs)]
#[no_mangle]
/// # Safety
/// Entry point for the C ABI used by `SpineItem`; the C++ side calls this with pointers valid for the documented contract.
pub unsafe extern "C" fn airi_spine_rt_collect(
    out_vertices: *mut RtVertex,
    vertex_cap: usize,
    out_indices: *mut u16,
    index_cap: usize,
    out_draws: *mut RtDraw,
    draw_cap: usize,
) -> c_int {
    let data = with_session(
        |s| s.collect_draws(),
        airi_render::spine::DrawData::default(),
    );
    if data.vertices.len() > vertex_cap
        || data.indices.len() > index_cap
        || data.draws.len() > draw_cap
    {
        return 0;
    }
    unsafe {
        if !data.vertices.is_empty() {
            std::ptr::copy_nonoverlapping(
                data.vertices.as_ptr().cast::<RtVertex>(),
                out_vertices,
                data.vertices.len(),
            );
        }
        if !data.indices.is_empty() {
            std::ptr::copy_nonoverlapping(data.indices.as_ptr(), out_indices, data.indices.len());
        }
        if !data.draws.is_empty() {
            for (i, draw) in data.draws.iter().enumerate() {
                *out_draws.add(i) = RtDraw {
                    page_index: draw.page_index,
                    blend_mode: draw.blend_mode,
                    alpha: draw.alpha,
                    vertex_offset: draw.vertex_offset,
                    vertex_count: draw.vertex_count,
                    index_offset: draw.index_offset,
                    index_count: draw.index_count,
                };
            }
        }
    }
    1
}

/// Smoke-check: load the bundled synthetic spine asset, tick 90 frames,
/// log progress. Returns true on success. Always runs (even without Qt)
/// when `--smoke` is passed.
pub(crate) fn spine_smoke_check() -> bool {
    let asset = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../assets/test-models/synthetic/synthetic.zip"
    );
    eprintln!("[airi-qt] smoke: spine check loading {asset}");
    if let Err(error) = load_bundle_path(asset) {
        eprintln!("[airi-qt] smoke: spine check FAILED to load: {error:#}");
        return false;
    }
    match play_idle("idle") {
        Ok(name) => {
            eprintln!("[airi-qt] smoke: spine asset parsed ok, animation [{name}] at t=0.000s")
        }
        Err(error) => eprintln!("[airi-qt] smoke: spine idle fallback failed: {error:#}"),
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
        "[airi-qt] smoke: spine tick ok (90 frames, t={t:.3}s, vertices={}, draws={})",
        data.vertices.len(),
        data.draws.len()
    );
    !data.vertices.is_empty()
}
