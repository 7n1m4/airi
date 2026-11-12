// SPDX-License-Identifier: GPL-3.0-or-later
//! CPU rasterizer for the spine stage.
//!
//! `spine_rt` owns the shared [`airi_render::spine::SpineSession`]; this module
//! reads the posed frame's draw data, fits the skeleton bounds into the target
//! viewport, and rasterizes the textured triangles into an RGBA buffer that
//! Slint displays via [`slint::Image::from_rgba8`].
//!
//! Slint 1.x stable does not expose a raw per-frame GL callback suitable for
//! spine-cpp vertex data, so this is a CPU rasterizer (textured triangles, alpha
//! blend, additive blend). Upgrade to a borrowed-GL-texture path when Slint
//! exposes a stable render-thread hook.

use airi_render::spine::{DrawData, DrawVertex, SpineSession};
use image::RgbaImage;

use crate::spine_rt;

/// Render one frame into an RGBA image of `width` x `height` pixels.
///
/// Returns `None` when no model is loaded or the bounds are degenerate.
pub fn render_frame(
    width: u32,
    height: u32,
    render_scale: f32,
    offset_x: f32,
    offset_y: f32,
) -> Option<RgbaImage> {
    if width == 0 || height == 0 {
        return None;
    }
    let root = spine_rt::bundle_root();
    spine_rt::with_session(
        |session| {
            let data = session.collect_draws();
            if data.draws.is_empty() || data.vertices.is_empty() {
                return None;
            }
            let bounds = session.bounds();
            let pages = load_pages(session, root.as_deref());
            Some(rasterize(
                &data, &bounds, &pages, width, height, render_scale, offset_x, offset_y,
            ))
        },
        None,
    )
}

/// One texture page decoded to RGBA, ready for sampling.
struct Page {
    pixels: RgbaImage,
    premultiplied: bool,
}

/// Load every texture page referenced by the atlas into RGBA.
fn load_pages(session: &SpineSession, root: Option<&std::path::Path>) -> Vec<Option<Page>> {
    let Some(root) = root else {
        return Vec::new();
    };
    session
        .pages()
        .iter()
        .map(|info| {
            let path = root.join(&info.image);
            match image::open(&path) {
                Ok(img) => {
                    let rgba = img.to_rgba8();
                    Some(Page {
                        pixels: rgba,
                        premultiplied: info.pma,
                    })
                }
                Err(error) => {
                    eprintln!("[airi-slint][spine] texture missing: {}: {error}", path.display());
                    None
                }
            }
        })
        .collect()
}

/// Fit + rasterize the collected draw data into an RGBA buffer.
fn rasterize(
    data: &DrawData,
    bounds: &airi_render::spine::Bounds,
    pages: &[Option<Page>],
    width: u32,
    height: u32,
    render_scale: f32,
    offset_x: f32,
    offset_y: f32,
) -> RgbaImage {
    let mut buffer = RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 0, 0]));

    let bw = bounds.width.max(0.1);
    let bh = bounds.height.max(0.1);
    let fit = (width as f32 / bw)
        .min(height as f32 / bh)
        * 0.9
        * render_scale;
    // Skeleton is y-up; the image is y-down.
    let cx = width as f32 * 0.5 + offset_x;
    let cy = height as f32 * 0.5 + offset_y;
    let ox = bounds.x + bw * 0.5;
    let oy = bounds.y + bh * 0.5;

    let transform = |v: &DrawVertex| -> (f32, f32) {
        let x = cx + (v.x - ox) * fit;
        let y = cy - (v.y - oy) * fit;
        (x, y)
    };

    for draw in &data.draws {
        let Some(Some(page)) = pages.get(draw.page_index.max(0) as usize) else {
            continue;
        };
        let idx_start = draw.index_offset as usize;
        let idx_end = idx_start + draw.index_count as usize;
        let vtx_start = draw.vertex_offset as usize;
        let alpha = draw.alpha.clamp(0.0, 1.0);

        for tri in data.indices[idx_start..idx_end].chunks_exact(3) {
            let p = [
                data.vertices[vtx_start + tri[0] as usize],
                data.vertices[vtx_start + tri[1] as usize],
                data.vertices[vtx_start + tri[2] as usize],
            ];
            let s = [transform(&p[0]), transform(&p[1]), transform(&p[2])];
            let uv = [(p[0].u, p[0].v), (p[1].u, p[1].v), (p[2].u, p[2].v)];
            raster_triangle(
                &mut buffer,
                &s,
                &uv,
                &page.pixels,
                draw.blend_mode,
                alpha,
                page.premultiplied,
            );
        }
    }

    buffer
}

/// Rasterize one textured triangle with barycentric coverage.
fn raster_triangle(
    buffer: &mut RgbaImage,
    screen: &[(f32, f32); 3],
    uv: &[(f32, f32); 3],
    tex: &RgbaImage,
    blend_mode: i32,
    alpha: f32,
    premultiplied: bool,
) {
    let (w, h) = (buffer.width(), buffer.height());
    let min_x = screen[0].0.min(screen[1].0).min(screen[2].0).floor().max(0.0) as u32;
    let min_y = screen[0].1.min(screen[1].1).min(screen[2].1).floor().max(0.0) as u32;
    let max_x = screen[0].0.max(screen[1].0).max(screen[2].0).ceil().min(w as f32 - 1.0) as u32;
    let max_y = screen[0].1.max(screen[1].1).max(screen[2].1).ceil().min(h as f32 - 1.0) as u32;
    if min_x > max_x || min_y > max_y {
        return;
    }

    let area = edge(screen[0], screen[1], screen[2]);
    if area.abs() < 1e-6 {
        return;
    }
    let inv_area = 1.0 / area;

    for py in min_y..=max_y {
        for px in min_x..=max_x {
            let p = (px as f32 + 0.5, py as f32 + 0.5);
            let w0 = edge(screen[1], screen[2], p) * inv_area;
            let w1 = edge(screen[2], screen[0], p) * inv_area;
            let w2 = edge(screen[0], screen[1], p) * inv_area;
            if w0 < 0.0 || w1 < 0.0 || w2 < 0.0 {
                continue;
            }
            let u = w0 * uv[0].0 + w1 * uv[1].0 + w2 * uv[2].0;
            let v = w0 * uv[0].1 + w1 * uv[1].1 + w2 * uv[2].1;
            let texel = sample_bilinear(tex, u, v);
            blend_pixel(buffer, px, py, texel, blend_mode, alpha, premultiplied);
        }
    }
}

/// Signed edge function (twice the signed area of a b c).
fn edge(a: (f32, f32), b: (f32, f32), c: (f32, f32)) -> f32 {
    (c.0 - a.0) * (b.1 - a.1) - (b.0 - a.0) * (c.1 - a.1)
}

/// Bilinear texture sample; out-of-range UV clamps to the edge texel.
fn sample_bilinear(tex: &RgbaImage, u: f32, v: f32) -> image::Rgba<u8> {
    let (w, h) = (tex.width() as f32, tex.height() as f32);
    if w <= 0.0 || h <= 0.0 {
        return image::Rgba([0, 0, 0, 0]);
    }
    let x = (u * (w - 1.0)).clamp(0.0, w - 1.0);
    let y = (v * (h - 1.0)).clamp(0.0, h - 1.0);
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(tex.width() - 1);
    let y1 = (y0 + 1).min(tex.height() - 1);
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;

    let c00 = tex.get_pixel(x0, y0).0;
    let c10 = tex.get_pixel(x1, y0).0;
    let c01 = tex.get_pixel(x0, y1).0;
    let c11 = tex.get_pixel(x1, y1).0;

    let mut out = [0u8; 4];
    for c in 0..4 {
        let top = c00[c] as f32 * (1.0 - fx) + c10[c] as f32 * fx;
        let bot = c01[c] as f32 * (1.0 - fx) + c11[c] as f32 * fx;
        out[c] = (top * (1.0 - fy) + bot * fy).round().clamp(0.0, 255.0) as u8;
    }
    image::Rgba(out)
}

/// Blend one texel into the destination with the given blend mode.
fn blend_pixel(
    buffer: &mut RgbaImage,
    x: u32,
    y: u32,
    texel: image::Rgba<u8>,
    blend_mode: i32,
    alpha: f32,
    premultiplied: bool,
) {
    let (w, h) = (buffer.width(), buffer.height());
    if x >= w || y >= h {
        return;
    }
    let mut src = texel.0;
    if !premultiplied {
        // Un-premultiply for correct blending against the straight-alpha dest.
        let a = src[3] as f32 / 255.0;
        src[0] = (src[0] as f32 * a) as u8;
        src[1] = (src[1] as f32 * a) as u8;
        src[2] = (src[2] as f32 * a) as u8;
    }
    let sa = (src[3] as f32 / 255.0) * alpha;
    let dst = *buffer.get_pixel(x, y);

    let (out_rgb, out_a) = match blend_mode {
        1 => {
            // Additive.
            let rgb = [
                (dst[0] as f32 + src[0] as f32 * sa).min(255.0),
                (dst[1] as f32 + src[1] as f32 * sa).min(255.0),
                (dst[2] as f32 + src[2] as f32 * sa).min(255.0),
            ];
            (rgb, dst[3].max(src[3]))
        }
        _ => {
            // Normal source-over (premultiplied).
            let da = dst[3] as f32 / 255.0;
            let out_a_f = sa + da * (1.0 - sa);
            let rgb = if out_a_f > 0.0 {
                [
                    (src[0] as f32 * sa + dst[0] as f32 * da * (1.0 - sa)) / out_a_f,
                    (src[1] as f32 * sa + dst[1] as f32 * da * (1.0 - sa)) / out_a_f,
                    (src[2] as f32 * sa + dst[2] as f32 * da * (1.0 - sa)) / out_a_f,
                ]
            } else {
                [0.0, 0.0, 0.0]
            };
            (rgb, (out_a_f * 255.0) as u8)
        }
    };
    buffer.put_pixel(
        x,
        y,
        image::Rgba([
            out_rgb[0].round().clamp(0.0, 255.0) as u8,
            out_rgb[1].round().clamp(0.0, 255.0) as u8,
            out_rgb[2].round().clamp(0.0, 255.0) as u8,
            out_a,
        ]),
    );
}

/// Build a Slint image from an RGBA buffer (UI-thread only).
pub fn to_slint_image(rgba: &RgbaImage) -> slint::Image {
    let buffer = slint::SharedPixelBuffer::<slint::Rgba8Pixel>::clone_from_slice(
        rgba.as_raw(),
        rgba.width(),
        rgba.height(),
    );
    slint::Image::from_rgba8(buffer)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_synthetic_frame_with_opaque_pixels() {
        let manifest = env!("CARGO_MANIFEST_DIR");
        let zip = format!("{manifest}/test-models/synthetic/synthetic.zip");
        spine_rt::load_bundle_path(&zip).expect("load synthetic bundle");
        spine_rt::set_default_mix(0.2);
        let _ = spine_rt::play_idle("idle");
        // Tick a few frames so the pose is non-rest.
        for _ in 0..10 {
            spine_rt::advance(1.0 / 60.0);
        }
        let frame = render_frame(256, 256, 1.0, 0.0, 0.0).expect("render frame");
        assert_eq!(frame.width(), 256);
        assert_eq!(frame.height(), 256);

        let opaque = frame
            .pixels()
            .filter(|p| p.0[3] > 0)
            .count();
        assert!(
            opaque > 0,
            "expected non-zero opaque pixels, got {opaque} (frame likely blank)"
        );

        let out = std::path::Path::new(&env!("CARGO_MANIFEST_DIR"))
            .join("../../target/spine_test.png");
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).expect("create target dir");
        }
        frame.save(&out).expect("save png");
        eprintln!(
            "[airi-slint] spine_test.png written to {} ({opaque} opaque pixels)",
            out.display()
        );
    }
}