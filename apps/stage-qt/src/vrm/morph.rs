// SPDX-License-Identifier: GPL-3.0-or-later

//! Morph-target computation on top of a parsed [`super::VrmDocument`].
//!
//! Produces the *expression-bound* morph set: only morph targets referenced by
//! blendshape/expression presets and lip-sync vowels are kept, so the Qt
//! Quick 3D geometry stays under morph-count limits. Each [`MorphTarget`]
//! exposes interpolated position/normal deltas used by the expression engine
//! and consumed by [`super::geometry`] when emitting `TargetAttribute` data.

use super::VrmDocument;

/// One expression-bound morph target for a mesh primitive.
#[derive(Debug, Clone)]
pub struct MorphTarget {
    /// Mesh index.
    pub mesh: u32,
    /// Primitive index within the mesh.
    pub primitive: usize,
    /// Target index within the primitive (glTF `weights` slot).
    pub target: usize,
    /// Expression/preset name bound to this target (`happy`, `aa`, …).
    pub preset: String,
    /// Position deltas (2–3 per vertex; stored pre-interpolation).
    pub position_deltas: Vec<[f32; 3]>,
    /// Normal deltas (same length as `position_deltas`).
    pub normal_deltas: Vec<[f32; 3]>,
    /// Current weight `[0,1]` (mutated by the expression engine).
    pub weight: f32,
}

/// Collect all expression-bound morph targets from the document.
///
/// Both VRM versions are handled:
/// - 0.x: `blendShapeMaster.blendShapeGroups[].binds{mesh,index,index0}`.
/// - 1.0: `expressions.preset/custom[].morphTargetBinds{node,index}` —
///   resolved from node → mesh via `doc.nodes`.
pub fn collect_morph_targets(doc: &VrmDocument) -> Vec<MorphTarget> {
    let mut out = Vec::new();

    // VRM 0.x blendshape binds.
    if let Some(v0) = &doc.extensions.vrm0 {
        for group in &v0.blend_shape_master.blend_shape_groups {
            for bind in &group.binds {
                if let Some(mt) = read_target(
                    doc,
                    bind.mesh,
                    bind.index as usize,
                    &group.name,
                ) {
                    out.push(mt);
                }
            }
        }
    }

    // VRM 1.0 expression morph binds (node → mesh).
    if let Some(v1) = &doc.extensions.vrm1 {
        for (preset_name, preset) in &v1.expressions.preset {
            for bind in &preset.morph_target_binds {
                if let Some(mesh_idx) = node_to_mesh(doc, bind.node) {
                    if let Some(mt) = read_target(doc, mesh_idx, bind.index as usize, preset_name) {
                        out.push(mt);
                    }
                }
            }
        }
        for custom in &v1.expressions.custom {
            for bind in &custom.morph_target_binds {
                if let Some(mesh_idx) = node_to_mesh(doc, bind.node) {
                    if let Some(mt) = read_target(doc, mesh_idx, bind.index as usize, &custom.name) {
                        out.push(mt);
                    }
                }
            }
        }
    }

    // De-duplicate by (mesh, target, preset): VRM1 can bind the same target
    // twice via preset+custom aliasing; keep first.
    let mut seen = std::collections::HashSet::new();
    out.retain(|m| seen.insert((m.mesh, m.primitive, m.target, m.preset.clone())));
    out
}

/// Names of lip-sync vowel presets carried by this document
/// (subset of `aa/ih/ou/ee/oh` actually bound).
pub fn lip_sync_presets(targets: &[MorphTarget]) -> Vec<&str> {
    let mut v: Vec<&str> = targets
        .iter()
        .map(|t| t.preset.as_str())
        .filter(|p| ["aa", "ih", "ou", "ee", "oh"].contains(p))
        .collect();
    v.sort_unstable();
    v.dedup();
    v
}

/// Resolve a node index to its mesh index (VRM 1.0 morph binds use nodes).
fn node_to_mesh(doc: &VrmDocument, node: u32) -> Option<u32> {
    doc.gltf
        .nodes()
        .nth(node as usize)?
        .mesh()
        .map(|m| m.index() as u32)
}

/// Read one primitive morph target (position + normal deltas) from the blob.
fn read_target(
    doc: &VrmDocument,
    mesh_idx: u32,
    target_idx: usize,
    preset: &str,
) -> Option<MorphTarget> {
    let mesh = doc.gltf.meshes().nth(mesh_idx as usize)?;
    let prim = mesh.primitives().next()?;
    // gltf 1.4: morph targets are read via the primitive Reader;
    // morph_targets() is the *name* iterator, read_morph_targets() the data.
    let reader = prim.reader(|_b| Some(doc.blob.as_slice()));
    let (pos_disp, norm_disp, _) = reader.read_morph_targets().nth(target_idx)?;
    let pos: Vec<[f32; 3]> = match pos_disp {
        Some(d) => d.collect(),
        None => return None,
    };
    let normal_deltas: Vec<[f32; 3]> = match norm_disp {
        Some(d) => d.collect(),
        None => vec![[0.0; 3]; pos.len()],
    };
    Some(MorphTarget {
        mesh: mesh_idx,
        primitive: 0,
        target: target_idx,
        preset: preset.to_string(),
        position_deltas: pos,
        normal_deltas,
        weight: 0.0,
    })
}

/// Decode a `VEC3` f32 accessor from the document blob.
#[allow(dead_code)]
fn read_vec3_accessor(
    doc: &VrmDocument,
    accessor: gltf::accessor::Accessor<'_>,
) -> anyhow::Result<Vec<[f32; 3]>> {
    let view = accessor.view().ok_or_else(|| anyhow::anyhow!("accessor has no view"))?;
    let data = &doc.blob[view.offset()..];
    let mut out = Vec::with_capacity(accessor.count());
    for chunk in data.chunks_exact(12) {
        out.push([
            f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]),
            f32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]),
            f32::from_le_bytes([chunk[8], chunk[9], chunk[10], chunk[11]]),
        ]);
    }
    out.truncate(accessor.count());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_doc_has_no_targets() {
        // gltf::Document default has no meshes/extensions.
        let doc = VrmDocument {
            gltf: gltf::Document::from_json_without_validation(gltf::json::Root::default()),
            blob: vec![],
            extensions: super::super::doc::VrmExtensions::default(),
        };
        assert!(collect_morph_targets(&doc).is_empty());
    }
}
