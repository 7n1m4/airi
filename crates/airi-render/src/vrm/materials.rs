// SPDX-License-Identifier: GPL-3.0-or-later

//! MToon material parameter extraction.
//!
//! Reads VRM 0.x `materialProperties` (shader `VRM/MToon`) and VRM 1.0
//! `VRMC_materials_mtoon` into a uniform [`MtoonParams`] struct the Slint
//! material consumes.

use super::VrmDocument;

/// MToon parameters for one primitive/material.
#[derive(Debug, Clone)]
pub struct MtoonParams {
    /// Base color `[r, g, b, a]`.
    pub base_color: [f32; 4],
    /// Shade color `[r, g, b, a]`.
    pub shade_color: [f32; 4],
    /// Toon shading levels (0–1 entries, e.g. [0.0, 0.5, 1.0]).
    pub toon_shades: Vec<f32>,
    /// Shade multiplier texture URL (decided in scene layer).
    pub shade_multiply_texture: Option<String>,
    /// Main (base map) texture URL.
    pub main_texture: Option<String>,
    /// Emissive factor `[r, g, b]`.
    pub emissive: [f32; 3],
    /// Emissive map URL.
    pub emissive_texture: Option<String>,
    /// Rim lighting mix (0 = off).
    pub rim_mix: f32,
    /// Alpha cutoff (0 = opaque).
    pub alpha_cutoff: f32,
}

impl Default for MtoonParams {
    fn default() -> Self {
        Self {
            base_color: [1.0, 1.0, 1.0, 1.0],
            shade_color: [0.7, 0.7, 0.7, 1.0],
            toon_shades: vec![0.0, 0.5, 1.0],
            shade_multiply_texture: None,
            main_texture: None,
            emissive: [0.0, 0.0, 0.0],
            emissive_texture: None,
            rim_mix: 0.0,
            alpha_cutoff: 0.0,
        }
    }
}

/// Extract MToon params for every material in the document (index-aligned).
pub fn extract_mtoon(doc: &VrmDocument) -> Vec<MtoonParams> {
    doc.gltf
        .materials()
        .enumerate()
        .map(|(idx, _m)| extract_one(doc, idx))
        .collect()
}

/// Extract params for material `idx`.
fn extract_one(doc: &VrmDocument, idx: usize) -> MtoonParams {
    let mut p = MtoonParams::default();
    // glTF base color (pbrMetallicRoughness).
    if let Some(mat) = doc.gltf.materials().nth(idx) {
        let bc = mat.pbr_metallic_roughness().base_color_factor();
        p.base_color = [bc[0], bc[1], bc[2], bc[3]];
        if let Some(tex_info) = mat.pbr_metallic_roughness().base_color_texture() {
            p.main_texture = Some(format!("tex:{}", tex_info.texture().index()));
        }
        let emis = mat.emissive_factor();
        p.emissive = [emis[0], emis[1], emis[2]];
    }
    // VRM 0.x materialProperties.
    if let Some(v0) = &doc.extensions.vrm0 {
        if let Some(mp) = v0.material_properties.get(idx) {
            let vec_get = |k: &str| mp.vector_properties.get(k).cloned();
            if let Some(c) = vec_get("color") {
                if c.len() >= 4 {
                    p.base_color = [c[0], c[1], c[2], c[3]];
                }
            }
            if let Some(c) = vec_get("shadeColor") {
                if c.len() >= 3 {
                    p.shade_color = [c[0], c[1], c[2], 1.0];
                }
            }
            if let Some(c) = vec_get("rimColor") {
                if c.len() >= 3 {
                    p.emissive = [c[0], c[1], c[2]];
                }
            }
            if let Some(&f) = mp.float_properties.get("rimLightingMix") {
                p.rim_mix = f;
            }
            if let Some(&f) = mp.float_properties.get("cutoff") {
                p.alpha_cutoff = f;
            }
            if let Some(t) = mp.texture_properties.get("mainTex") {
                p.main_texture = Some(format!("tex:{t}"));
            }
            if let Some(t) = mp.texture_properties.get("shadeMultiplyTex") {
                p.shade_multiply_texture = Some(format!("tex:{t}"));
            }
        }
    }
    // VRM 1.0 VRMC_materials_mtoon.
    if let Some(Some(m)) = doc.extensions.mtoon1.get(idx) {
        if let Some(c) = &m.base_color {
            if c.len() >= 4 {
                p.base_color = [c[0], c[1], c[2], c[3]];
            }
        }
        if let Some(c) = &m.shade_color {
            if c.len() >= 3 {
                p.shade_color = [c[0], c[1], c[2], 1.0];
            }
        }
        if !m.toon_shades.is_empty() {
            p.toon_shades = m.toon_shades.clone();
        }
        if let Some(f) = m.rim_mix {
            p.rim_mix = f;
        }
        if let Some(f) = m.alpha_cutoff {
            p.alpha_cutoff = f;
        }
    }
    p
}
