// SPDX-License-Identifier: GPL-3.0-or-later
// C ABI shell over the vendored spine-cpp runtime.
//
// Ownership rules:
//   * `airi_spine_session *` is an opaque handle created by
//     `airi_spine_create` and destroyed by `airi_spine_destroy`.
//   * `const char *` results are owned by the session and stay valid until
//     the next library call that mutates the session (or until destroy).
//     Rust copies them immediately.
//   * `airi_spine_collect_draws` writes into caller-provided buffers sized
//     via `airi_spine_draw_counts`; no allocation happens inside the call
//     apart from temporary std::vectors on the C++ side.
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

struct airi_spine_session;

/** One textured vertex in skeleton world space (y-up). */
typedef struct {
    float x, y, u, v;
} airi_spine_vertex;

/**
 * One draw range. `page_index` indexes into `airi_spine_page_image`.
 * `blend_mode`: 0 = normal, 1 = additive, 2 = multiply, 3 = screen.
 * `alpha` is the slot color alpha already multiplied in.
 */
typedef struct {
    int32_t page_index;
    int32_t blend_mode;
    float alpha;
    uint32_t vertex_offset;
    uint32_t vertex_count;
    uint32_t index_offset;
    uint32_t index_count;
} airi_spine_draw;

/* Lifecycle ---------------------------------------------------------- */

/** Create an empty session. Never returns NULL. */
airi_spine_session *airi_spine_create(void);
/** Destroy a session (safe on NULL). */
void airi_spine_destroy(airi_spine_session *session);

/* Loading ------------------------------------------------------------ */

/**
 * Parse an in-memory atlas (text) and skeleton (JSON string or .skel
 * binary). `atlas_text` need not be NUL-terminated; `atlas_len` bytes are
 * read. `skel_is_binary` selects SkeletonBinary vs SkeletonJson.
 * On failure returns 0 and fills airi_spine_last_error.
 */
int32_t airi_spine_load(airi_spine_session *session,
                        const uint8_t *skel, size_t skel_len, int32_t skel_is_binary,
                        const char *atlas_text, size_t atlas_len);

/** Message for the last failed load ("" when none). */
const char *airi_spine_last_error(airi_spine_session *session);
/** Spine version string reported by the loaded skeleton data ("" if unknown). */
const char *airi_spine_version(airi_spine_session *session);
/** Skeleton bounds (data.x/y/width/height, y-up origin). */
void airi_spine_bounds(airi_spine_session *session, float *x, float *y, float *width, float *height);

/* Skins --------------------------------------------------------------- */

size_t airi_spine_skin_count(airi_spine_session *session);
const char *airi_spine_skin_name(airi_spine_session *session, size_t index);
/** Select a skin by name; returns 1 on success, 0 when missing. */
int32_t airi_spine_set_skin(airi_spine_session *session, const char *name);

/* Animations ---------------------------------------------------------- */

size_t airi_spine_animation_count(airi_spine_session *session);
/** Duration in seconds written to `duration_out` (may be NULL). */
const char *airi_spine_animation_name(airi_spine_session *session, size_t index, float *duration_out);
/** Apply an animation by exact name. Returns 1 on success, 0 when missing. */
int32_t airi_spine_set_animation(airi_spine_session *session, size_t track, const char *name, int32_t loop);
/** Queue an empty animation on a track (clears it) with a mix. */
void airi_spine_set_empty_animation(airi_spine_session *session, size_t track, float mix_duration);
/** Set the default mix for AnimationStateData (seconds). */
void airi_spine_set_default_mix(airi_spine_session *session, float seconds);

/* Per-frame ------------------------------------------------------------ */

/** Advance the animation state and apply it to the skeleton. */
void airi_spine_update(airi_spine_session *session, float delta_seconds);

/* Draw serialization ----------------------------------------------------- */

size_t airi_spine_page_count(airi_spine_session *session);
const char *airi_spine_page_image(airi_spine_session *session, size_t index);
/** 1 when the page atlas entry was packed with premultiplied alpha. */
int32_t airi_spine_page_pma(airi_spine_session *session, size_t index);

/** Fill counts; Rust sizes its buffers from these. */
void airi_spine_draw_counts(airi_spine_session *session,
                            size_t *out_vertices,
                            size_t *out_indices,
                            size_t *out_draws);

/**
 * Serialize the currently posed skeleton into triangles.
 * Buffers must hold at least the counts reported by airi_spine_draw_counts.
 * Returns 1 on success, 0 on size mismatch.
 */
int32_t airi_spine_collect_draws(airi_spine_session *session,
                                 airi_spine_vertex *out_vertices, size_t vertex_cap,
                                 uint16_t *out_indices, size_t index_cap,
                                 airi_spine_draw *out_draws, size_t draw_cap);

#ifdef __cplusplus
} /* extern "C" */
#endif
