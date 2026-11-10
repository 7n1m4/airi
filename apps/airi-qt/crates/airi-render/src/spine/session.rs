// SPDX-License-Identifier: GPL-3.0-or-later
//! Safe Rust wrapper over the C ABI shell (`cpp/spine_shell.{h,cpp}`).
//!
//! spine-cpp exports everything under one C++ namespace and carries no
//! per-version symbol namespacing, so exactly one vendored runtime line is
//! compiled into this crate (see `build.rs` and `vendor/spine-runtimes/VERSIONS.md`).
//! `SpineSession` hides the handle lifecycle and copies draw data out each
//! frame for the scene graph.

use std::ffi::{c_void, CStr, CString};
use std::os::raw::{c_char, c_float, c_int};
use std::ptr::NonNull;

/// Opaque spine-cpp session handle.
#[repr(C)]
pub struct airi_spine_session {
    _private: [u8; 0],
}

/// One textured vertex in skeleton world space (y-up).
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct DrawVertex {
    /// World-space x.
    pub x: f32,
    /// World-space y.
    pub y: f32,
    /// Atlas u coordinate.
    pub u: f32,
    /// Atlas v coordinate.
    pub v: f32,
}

/// Per-draw metadata; vertex/index ranges index into [`DrawData`].
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct DrawGroup {
    /// Index into `pages()` of the texture page this draw samples.
    pub page_index: i32,
    /// Blend mode: 0 normal, 1 additive, 2 multiply, 3 screen.
    pub blend_mode: i32,
    /// Final alpha (skeleton × slot × attachment).
    pub alpha: f32,
    /// Start offset into `vertices`.
    pub vertex_offset: u32,
    /// Number of vertices to draw.
    pub vertex_count: u32,
    /// Start offset into `indices`.
    pub index_offset: u32,
    /// Number of indices to draw.
    pub index_count: u32,
}

/// Geometry collected for one frame.
#[derive(Debug, Clone, Default)]
pub struct DrawData {
    /// Vertices in skeleton world space (y-up).
    pub vertices: Vec<DrawVertex>,
    /// Triangle indices into `vertices`.
    pub indices: Vec<u16>,
    /// Draw groups in slot draw order.
    pub draws: Vec<DrawGroup>,
}

/// Texture page info reported by the atlas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageInfo {
    /// Image path exactly as written in the atlas (usually a bare file name,
    /// resolved relative to the bundle root by the caller).
    pub image: String,
    /// Whether the page was packed with premultiplied alpha.
    pub pma: bool,
}

/// Skeleton bounds (skeleton units, y-up).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Bounds {
    /// Left edge of the skeleton's bounding box.
    pub x: f32,
    /// Bottom edge of the skeleton's bounding box.
    pub y: f32,
    /// Bounding box width.
    pub width: f32,
    /// Bounding box height.
    pub height: f32,
}

extern "C" {
    fn airi_spine_create() -> *mut c_void;
    fn airi_spine_destroy(session: *mut airi_spine_session);
    fn airi_spine_load(
        session: *mut airi_spine_session,
        skel: *const u8,
        skel_len: usize,
        skel_is_binary: c_int,
        atlas_text: *const c_char,
        atlas_len: usize,
    ) -> c_int;
    fn airi_spine_last_error(session: *mut airi_spine_session) -> *const c_char;
    fn airi_spine_version(session: *mut airi_spine_session) -> *const c_char;
    fn airi_spine_bounds(
        session: *mut airi_spine_session,
        x: *mut c_float,
        y: *mut c_float,
        width: *mut c_float,
        height: *mut c_float,
    );
    fn airi_spine_skin_count(session: *mut airi_spine_session) -> usize;
    fn airi_spine_skin_name(session: *mut airi_spine_session, index: usize) -> *const c_char;
    fn airi_spine_set_skin(session: *mut airi_spine_session, name: *const c_char) -> c_int;
    fn airi_spine_animation_count(session: *mut airi_spine_session) -> usize;
    fn airi_spine_animation_name(
        session: *mut airi_spine_session,
        index: usize,
        duration_out: *mut c_float,
    ) -> *const c_char;
    fn airi_spine_set_animation(
        session: *mut airi_spine_session,
        track: usize,
        name: *const c_char,
        loop_: c_int,
    ) -> c_int;
    fn airi_spine_set_empty_animation(
        session: *mut airi_spine_session,
        track: usize,
        mix_duration: c_float,
    );
    fn airi_spine_set_default_mix(session: *mut airi_spine_session, seconds: c_float);
    fn airi_spine_update(session: *mut airi_spine_session, delta_seconds: c_float);
    fn airi_spine_page_count(session: *mut airi_spine_session) -> usize;
    fn airi_spine_page_image(session: *mut airi_spine_session, index: usize) -> *const c_char;
    fn airi_spine_page_pma(session: *mut airi_spine_session, index: usize) -> c_int;
    fn airi_spine_draw_counts(
        session: *mut airi_spine_session,
        out_vertices: *mut usize,
        out_indices: *mut usize,
        out_draws: *mut usize,
    );
    fn airi_spine_collect_draws(
        session: *mut airi_spine_session,
        out_vertices: *mut DrawVertex,
        vertex_cap: usize,
        out_indices: *mut u16,
        index_cap: usize,
        out_draws: *mut DrawGroup,
        draw_cap: usize,
    ) -> c_int;
}

fn cstring(value: &str) -> CString {
    // Strip NULs defensively; spine Strings won't contain any.
    CString::new(value.replace('\0', "")).expect("cstring")
}

fn cstr_to_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    // Safety: the shell guarantees NUL-terminated, session-owned pointers.
    unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
}

/// A loaded spine skeleton with its animation state.
pub struct SpineSession {
    handle: NonNull<airi_spine_session>,
}

// The shell keeps all state behind the opaque handle and never shares it
// across threads implicitly; moving a session between threads is fine as
// long as it is not used concurrently, which the Rust type enforces.
unsafe impl Send for SpineSession {}

impl SpineSession {
    /// Load a skeleton from in-memory bytes plus the atlas text.
    pub fn load(
        skeleton_bytes: &[u8],
        skeleton_is_binary: bool,
        atlas_text: &str,
    ) -> anyhow::Result<Self> {
        let handle = unsafe { airi_spine_create() };
        let session = SpineSession {
            handle: NonNull::new(handle.cast()).expect("airi_spine_create returned null"),
        };
        let ok = unsafe {
            airi_spine_load(
                session.handle.as_ptr(),
                skeleton_bytes.as_ptr(),
                skeleton_bytes.len(),
                c_int::from(skeleton_is_binary),
                atlas_text.as_ptr().cast(),
                atlas_text.len(),
            )
        };
        if ok == 0 {
            let error = session.last_error();
            anyhow::bail!("spine load failed: {error}");
        }
        Ok(session)
    }

    fn last_error(&self) -> String {
        cstr_to_string(unsafe { airi_spine_last_error(self.handle.as_ptr()) })
    }

    /// Spine editor version bucket reported by the loaded skeleton (e.g. `"4.2.18"`); empty when unknown.
    pub fn version(&self) -> String {
        cstr_to_string(unsafe { airi_spine_version(self.handle.as_ptr()) })
    }

    /// Bounds reported by the skeleton data.
    pub fn bounds(&self) -> Bounds {
        let mut b = Bounds::default();
        unsafe {
            airi_spine_bounds(
                self.handle.as_ptr(),
                &mut b.x,
                &mut b.y,
                &mut b.width,
                &mut b.height,
            );
        }
        b
    }

    /// All skins on the skeleton, in file order.
    pub fn skins(&self) -> Vec<String> {
        let count = unsafe { airi_spine_skin_count(self.handle.as_ptr()) };
        (0..count)
            .map(|i| cstr_to_string(unsafe { airi_spine_skin_name(self.handle.as_ptr(), i) }))
            .collect()
    }

    /// Select a skin by name; false when missing.
    pub fn set_skin(&self, name: &str) -> bool {
        let cname = cstring(name);
        unsafe { airi_spine_set_skin(self.handle.as_ptr(), cname.as_ptr()) == 1 }
    }

    /// All animations on the skeleton with durations in seconds.
    pub fn animations(&self) -> Vec<(String, f32)> {
        let count = unsafe { airi_spine_animation_count(self.handle.as_ptr()) };
        (0..count)
            .map(|i| {
                let mut duration: f32 = 0.0;
                let name = cstr_to_string(unsafe {
                    airi_spine_animation_name(self.handle.as_ptr(), i, &mut duration)
                });
                (name, duration)
            })
            .collect()
    }

    /// Set an animation on a track. Returns false when the animation is
    /// missing (nothing is changed then).
    pub fn set_animation(&self, track: usize, name: &str, loop_: bool) -> bool {
        let cname = cstring(name);
        unsafe {
            airi_spine_set_animation(
                self.handle.as_ptr(),
                track,
                cname.as_ptr(),
                c_int::from(loop_),
            ) == 1
        }
    }

    /// Queue an empty animation (clear) on a track with the given mix.
    pub fn set_empty_animation(&self, track: usize, mix_duration: f32) {
        unsafe { airi_spine_set_empty_animation(self.handle.as_ptr(), track, mix_duration) }
    }

    /// Set the default mix (`AnimationStateData::defaultMix`), used when no
    /// explicit per-entry mix is provided.
    pub fn set_default_mix(&self, seconds: f32) {
        unsafe { airi_spine_set_default_mix(self.handle.as_ptr(), seconds) }
    }

    /// Advance the animation state and recompute the world transform.
    pub fn update(&self, delta_seconds: f32) {
        unsafe { airi_spine_update(self.handle.as_ptr(), delta_seconds) }
    }

    /// Texture pages, in atlas order.
    pub fn pages(&self) -> Vec<PageInfo> {
        let count = unsafe { airi_spine_page_count(self.handle.as_ptr()) };
        (0..count)
            .map(|i| PageInfo {
                image: cstr_to_string(unsafe { airi_spine_page_image(self.handle.as_ptr(), i) }),
                pma: unsafe { airi_spine_page_pma(self.handle.as_ptr(), i) == 1 },
            })
            .collect()
    }

    /// Collect the posed skeleton's draw data for one frame.
    pub fn collect_draws(&self) -> DrawData {
        let (mut vertex_count, mut index_count, mut draw_count) = (0usize, 0usize, 0usize);
        unsafe {
            airi_spine_draw_counts(
                self.handle.as_ptr(),
                &mut vertex_count,
                &mut index_count,
                &mut draw_count,
            );
        }
        let mut data = DrawData {
            vertices: vec![DrawVertex::default(); vertex_count],
            indices: vec![0; index_count],
            draws: vec![DrawGroup::default(); draw_count],
        };
        let ok = unsafe {
            airi_spine_collect_draws(
                self.handle.as_ptr(),
                data.vertices.as_mut_ptr(),
                data.vertices.len(),
                data.indices.as_mut_ptr(),
                data.indices.len(),
                data.draws.as_mut_ptr(),
                data.draws.len(),
            )
        };
        if ok == 0 {
            // Size race between the two calls — should not happen on one
            // thread, but degrade to empty geometry instead of corrupt memory.
            data.vertices.clear();
            data.indices.clear();
            data.draws.clear();
        }
        data
    }
}

impl Drop for SpineSession {
    fn drop(&mut self) {
        unsafe { airi_spine_destroy(self.handle.as_ptr()) }
    }
}
