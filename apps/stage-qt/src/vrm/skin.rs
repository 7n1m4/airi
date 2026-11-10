// SPDX-License-Identifier: GPL-3.0-or-later

//! Skinning metadata (joint list + inverse bind matrices) + skeleton
//! descriptor consumed by QML's `Skin { joints, inverseBindPoses }`.

use super::VrmDocument;

/// Skin data for `Model.skin` in Qt Quick 3D.
#[derive(Debug, Clone)]
pub struct SkinData {
    /// Joint node indices (order matches `JOINTS_0`).
    pub joints: Vec<u32>,
    /// Column-major 4×4 inverse bind matrices per joint.
    pub inverse_bind_poses: Vec<[f32; 16]>,
    /// Joint node names (for the QML Node tree).
    pub joint_names: Vec<String>,
}

/// Extract skin 0 from the document (VRM ships a single skin in practice).
pub fn extract_skin(doc: &VrmDocument) -> Option<SkinData> {
    let skin = doc.gltf.skins().next()?;
    let joints: Vec<u32> = skin.joints().map(|j| j.index() as u32).collect();
    // Flatten [[f32; 4]; 4] (column-major) into [f32; 16] per joint.
    let reader = skin.reader(|_b| Some(doc.blob.as_slice()));
    let inverse_bind_poses: Vec<[f32; 16]> = match reader.read_inverse_bind_matrices() {
        Some(iter) => iter
            .map(|m| [
                m[0][0], m[0][1], m[0][2], m[0][3],
                m[1][0], m[1][1], m[1][2], m[1][3],
                m[2][0], m[2][1], m[2][2], m[2][3],
                m[3][0], m[3][1], m[3][2], m[3][3],
            ])
            .collect(),
        None => vec![identity16(); joints.len()],
    };
    let joint_names = joints
        .iter()
        .map(|&i| {
            doc.gltf
                .nodes()
                .nth(i as usize)
                .and_then(|n| n.name().map(|s| s.to_string()))
                .unwrap_or_else(|| format!("joint_{i}"))
        })
        .collect();
    Some(SkinData {
        joints,
        inverse_bind_poses,
        joint_names,
    })
}

fn identity16() -> [f32; 16] {
    [
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ]
}
