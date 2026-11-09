// SPDX-License-Identifier: GPL-3.0-or-later

//! Geometry buffer emission for [`super::VrmDocument`].
//!
//! Emits per-primitive interleaved vertices (POSITION/NORMAL/TEXCOORD_0/
//! JOINTS_0/WEIGHTS_0 + u32 index) plus morph-target deltas as flat byte
//! vectors. The Rust-side [`PrimitiveGeometry`] decouples the `gltf` blob
//! layout from the Qt Quick 3D side: the C++/bridge layer consumes this
//! verbatim via `QQuick3DGeometry::setVertexData`/`setIndexData` +
//! `addTargetAttribute`/`setTargetData`.

use super::morph::MorphTarget;
use super::VrmDocument;
use gltf::accessor::DataType;

/// One mesh primitive's buffers, ready for QQuick3DGeometry.
#[derive(Debug, Clone)]
pub struct PrimitiveGeometry {
    /// Mesh index.
    pub mesh: u32,
    /// Primitive index within the mesh.
    pub primitive: usize,
    /// Material index (if any).
    pub material: Option<u32>,
    /// Vertex count.
    pub vertex_count: usize,
    /// Interleaved vertex floats:
    /// pos(3) + norm(3) + uv(2) + joints(4) + weights(4) = 16 floats/vertex.
    pub vertices: Vec<f32>,
    /// u32 index list.
    pub indices: Vec<u32>,
    /// Morph targets for this primitive (subset of `morph::MorphTarget`,
    /// resolved to interpolation slots `0..N`).
    pub morphs: Vec<MorphSlot>,
}

/// One Qt Quick 3D morph slot on a primitive.
#[derive(Debug, Clone)]
pub struct MorphSlot {
    /// Expression/preset name.
    pub preset: String,
    /// Position deltas, length = vertex count.
    pub position_deltas: Vec<[f32; 3]>,
    /// Normal deltas, length = vertex count.
    pub normal_deltas: Vec<[f32; 3]>,
}

/// Build all primitive geometries for the document.
///
/// `targets` is the expression-bound morph set ([`super::morph::collect_morph_targets`]);
/// each is attached to its (mesh, primitive) geometry as a morph slot.
pub fn build_document_geometry(
    doc: &VrmDocument,
    targets: &[MorphTarget],
) -> anyhow::Result<Vec<PrimitiveGeometry>> {
    let mut out = Vec::new();
    for mesh in doc.gltf.meshes() {
        for (pidx, prim) in mesh.primitives().enumerate() {
            let mut geom = build_primitive(doc, mesh.index() as u32, pidx, &prim)?;
            for t in targets.iter().filter(|t| t.mesh == geom.mesh && t.primitive == pidx) {
                geom.morphs.push(MorphSlot {
                    preset: t.preset.clone(),
                    position_deltas: t.position_deltas.clone(),
                    normal_deltas: t.normal_deltas.clone(),
                });
            }
            out.push(geom);
        }
    }
    Ok(out)
}

/// Build one primitive.
fn build_primitive(
    doc: &VrmDocument,
    mesh: u32,
    pidx: usize,
    prim: &gltf::Primitive<'_>,
) -> anyhow::Result<PrimitiveGeometry> {
    // gltf `Reader` needs a closure Buffer -> Option<&[u8]>; our blob is a
    // single concatenated buffer (see VrmDocument::load).
    let reader = prim.reader(|_b| Some(doc.blob.as_slice()));
    let positions: Vec<[f32; 3]> = match reader.read_positions() {
        Some(p) => p.collect::<Vec<[f32; 3]>>(),
        None => return Ok(empty_geom(doc, mesh, pidx, prim)),
    };
    let vertex_count = positions.len();
    let normals = match reader.read_normals() {
        Some(n) => n.collect::<Vec<[f32; 3]>>(),
        None => vec![[0.0, 0.0, 1.0]; vertex_count],
    };
    let uvs = match reader.read_tex_coords(0) {
        Some(uv) => uv.into_f32().collect::<Vec<[f32; 2]>>(),
        None => vec![[0.0, 0.0]; vertex_count],
    };
    let (joints, weights) = read_skin_channels(doc, prim, vertex_count);
    let indices = read_indices(doc, prim, vertex_count)?;

    let mut vertices = Vec::with_capacity(vertex_count * 16);
    for i in 0..vertex_count {
        let p = positions.get(i).copied().unwrap_or([0.0; 3]);
        let n = normals.get(i).copied().unwrap_or([0.0, 0.0, 1.0]);
        let u = uvs.get(i).copied().unwrap_or([0.0, 0.0]);
        let j = joints.get(i).copied().unwrap_or([0, 0, 0, 0]);
        let w = weights.get(i).copied().unwrap_or([1.0, 0.0, 0.0, 0.0]);
        vertices.extend_from_slice(&[p[0], p[1], p[2], n[0], n[1], n[2], u[0], u[1]]);
        // JOINTS_0 is expected as 4× u32 on the Qt side; store bit-patterns.
        vertices.extend_from_slice(&[
            j[0] as f32, j[1] as f32, j[2] as f32, j[3] as f32,
        ]);
        vertices.extend_from_slice(&w);
    }

    Ok(PrimitiveGeometry {
        mesh,
        primitive: pidx,
        material: prim.material().index().map(|i| i as u32),
        vertex_count,
        vertices,
        indices,
        morphs: vec![],
    })
}

fn empty_geom(
    doc: &VrmDocument,
    mesh: u32,
    pidx: usize,
    prim: &gltf::Primitive<'_>,
) -> PrimitiveGeometry {
    let _ = doc;
    PrimitiveGeometry {
        mesh,
        primitive: pidx,
        material: prim.material().index().map(|i| i as u32),
        vertex_count: 0,
        vertices: vec![],
        indices: vec![],
        morphs: vec![],
    }
}

/// Read JOINTS_0/WEIGHTS_0 (defaults: joint 0, weight 1).
fn read_skin_channels(
    doc: &VrmDocument,
    prim: &gltf::Primitive<'_>,
    count: usize,
) -> (Vec<[u32; 4]>, Vec<[f32; 4]>) {
    let joints = prim
        .get(&gltf::mesh::Semantic::Joints(0))
        .and_then(|acc| read_joints(doc, acc, count))
        .unwrap_or_else(|| vec![[0, 0, 0, 0]; count]);
    let weights = prim
        .get(&gltf::mesh::Semantic::Weights(0))
        .and_then(|acc| read_weights(doc, acc, count))
        .unwrap_or_else(|| vec![[1.0, 0.0, 0.0, 0.0]; count]);
    (joints, weights)
}

/// Read a JOINTS accessor (u8/u16/u32 per component).
fn read_joints(
    doc: &VrmDocument,
    acc: gltf::Accessor<'_>,
    count: usize,
) -> Option<Vec<[u32; 4]>> {
    let view = acc.view()?;
    let data = &doc.blob[view.offset()..];
    let mut out = Vec::with_capacity(count);
    let comp_size: usize = match acc.data_type() {
        DataType::U8 => 1,
        DataType::U16 => 2,
        DataType::U32 => 4,
        _ => return None,
    };
    let stride = 4 * comp_size;
    for chunk in data.chunks_exact(stride) {
        let mut j = [0u32; 4];
        for (i, c) in chunk.chunks_exact(comp_size).enumerate() {
            j[i] = match comp_size {
                1 => c[0] as u32,
                2 => u16::from_le_bytes([c[0], c[1]]) as u32,
                _ => u32::from_le_bytes([c[0], c[1], c[2], c[3]]),
            };
        }
        out.push(j);
    }
    out.truncate(count);
    Some(out)
}

/// Read a WEIGHTS accessor (u8/u16/f32 per component, normalized to f32).
fn read_weights(
    doc: &VrmDocument,
    acc: gltf::Accessor<'_>,
    count: usize,
) -> Option<Vec<[f32; 4]>> {
    let view = acc.view()?;
    let data = &doc.blob[view.offset()..];
    let mut out = Vec::with_capacity(count);
    let comp_size: usize = match acc.data_type() {
        DataType::U8 => 1,
        DataType::U16 => 2,
        DataType::F32 => 4,
        _ => return None,
    };
    let stride = 4 * comp_size;
    for chunk in data.chunks_exact(stride) {
        let mut w = [0f32; 4];
        for (i, c) in chunk.chunks_exact(comp_size).enumerate() {
            w[i] = match comp_size {
                1 => c[0] as f32 / 255.0,
                2 => u16::from_le_bytes([c[0], c[1]]) as f32 / 65535.0,
                _ => f32::from_le_bytes([c[0], c[1], c[2], c[3]]),
            };
        }
        out.push(w);
    }
    out.truncate(count);
    Some(out)
}

/// Read triangle indices (u8/u16/u32).
fn read_indices(
    doc: &VrmDocument,
    prim: &gltf::Primitive<'_>,
    vertex_count: usize,
) -> anyhow::Result<Vec<u32>> {
    let Some(acc) = prim.indices() else {
        return Ok((0..vertex_count as u32).collect());
    };
    let Some(view) = acc.view() else {
        return Ok((0..vertex_count as u32).collect());
    };
    let data = &doc.blob[view.offset()..];
    let mut out = Vec::with_capacity(acc.count());
    match acc.data_type() {
        DataType::U8 => {
            for i in 0..acc.count() {
                let Some((c, _)) = data[i..].split_first() else { break };
                out.push(*c as u32);
            }
        }
        DataType::U16 => {
            for chunk in data.chunks_exact(2) {
                out.push(u16::from_le_bytes([chunk[0], chunk[1]]) as u32);
            }
        }
        DataType::U32 => {
            for chunk in data.chunks_exact(4) {
                out.push(u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
            }
        }
        _ => anyhow::bail!("unsupported index type"),
    }
    out.truncate(acc.count());
    Ok(out)
}
