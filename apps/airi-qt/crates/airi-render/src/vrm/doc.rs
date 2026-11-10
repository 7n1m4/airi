// SPDX-License-Identifier: GPL-3.0-or-later

//! VRM extension extraction (0.x `VRM` + 1.0 `VRMC_*`).
//!
//! The `gltf` crate exposes extension JSON as [`serde_json::Value`] via
//! `gltf::json::extensions`; we decode it with serde into the structs below.

use serde::Deserialize;

/// Union of VRM 0.x and 1.0 extension payloads.
#[derive(Debug, Default)]
pub struct VrmExtensions {
    /// VRM 0.x `extensions.VRM`.
    pub vrm0: Option<Vrm0>,
    /// VRM 1.0 `extensions.VRMC_vrm`.
    pub vrm1: Option<Vrm1>,
    /// VRM 1.0 `extensions.VRMC_springBone`.
    pub spring_bone1: Option<VrmSpringBone1>,
    /// VRM 1.0 `extensions.VRMC_materials_mtoon` (per-material, by index).
    pub mtoon1: Vec<Option<VrmMtoon1>>,
}

impl VrmExtensions {
    /// Pull extension JSON out of a parsed glTF document.
    pub fn extract(doc: &gltf::Document) -> Self {
        let _ = ();
        let vrm0: Option<Vrm0> = doc
            .extension_value("VRM")
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        let vrm1: Option<Vrm1> = doc
            .extension_value("VRMC_vrm")
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        let spring_bone1: Option<VrmSpringBone1> = doc
            .extension_value("VRMC_springBone")
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        let mtoon1 = doc
            .materials()
            .map(|m| {
                m.extension_value("VRMC_materials_mtoon")
                    .and_then(|v| serde_json::from_value::<VrmMtoon1>(v.clone()).ok())
            })
            .collect();
        Self {
            vrm0,
            vrm1,
            spring_bone1,
            mtoon1,
        }
    }
}

/// VRM 0.x root (`extensions.VRM`).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vrm0 {
    /// Humanoid bone map.
    #[serde(default)]
    pub humanoid: Humanoid,
    /// Blendshape (expression) master.
    #[serde(default)]
    pub blend_shape_master: BlendShapeMaster,
    /// Springbone secondary animation.
    #[serde(default)]
    pub secondary_animation: Option<SecondaryAnimation>,
    /// Per-material properties (index-aligned with glTF materials).
    #[serde(default)]
    pub material_properties: Vec<MaterialProperty>,
}

/// VRM 1.0 root (`extensions.VRMC_vrm`).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vrm1 {
    /// Humanoid bone map.
    #[serde(default)]
    pub humanoid: Humanoid,
    /// Expressions (preset + custom).
    #[serde(default)]
    pub expressions: Expressions1,
}

/// Humanoid block (both versions have `humanBones`).
#[derive(Debug, Default, Deserialize)]
pub struct Humanoid {
    /// Bone name → node index (`humanBones`).
    #[serde(rename = "humanBones", default, deserialize_with = "de_bone_map")]
    pub bones: std::collections::HashMap<String, u32>,
}

fn de_bone_map<'de, D>(d: D) -> Result<std::collections::HashMap<String, u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(d)?;
    let mut out = std::collections::HashMap::new();
    if let Some(map) = raw.as_object() {
        for (name, v) in map {
            if name == "armStretch" || name == "legStretch" || name == "feetSpacing" {
                continue;
            }
            if let Some(o) = v.as_object() {
                if let Some(node) = o.get("node").and_then(|n| n.as_u64()) {
                    // VRM 0.x ships `{"bone": name, "node": index}` entries
                    // (often keyed by array index); VRM 1.0 keys entries by
                    // bone name directly.
                    match o.get("bone").and_then(|b| b.as_str()) {
                        Some(bone) => {
                            out.insert(bone.to_string(), node as u32);
                        }
                        None => {
                            out.insert(name.clone(), node as u32);
                        }
                    }
                }
            }
        }
    } else if let Some(list) = raw.as_array() {
        // VRM 0.x: array of { "bone": name, "node": index }.
        for entry in list {
            if let Some(o) = entry.as_object() {
                let bone = o.get("bone").and_then(|b| b.as_str());
                let node = o.get("node").and_then(|n| n.as_u64());
                if let (Some(bone), Some(node)) = (bone, node) {
                    out.insert(bone.to_string(), node as u32);
                }
            }
        }
    }
    Ok(out)
}

/// VRM 0.x blendshape master.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlendShapeMaster {
    /// Blendshape groups (expressions).
    #[serde(default)]
    pub blend_shape_groups: Vec<BlendShapeGroup>,
}

/// One expression group (VRM 0.x).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlendShapeGroup {
    /// Group name (`happy`, `aa`, …).
    #[serde(default)]
    pub name: String,
    /// Whether the group is a preset (`isPreset`).
    #[serde(default)]
    pub is_preset: bool,
    /// Morph binds.
    #[serde(default)]
    pub binds: Vec<BlendShapeBind>,
}

/// One morph bind (VRM 0.x): mesh + vertex positions/normals index.
#[derive(Debug, Deserialize)]
pub struct BlendShapeBind {
    /// Mesh index.
    pub mesh: u32,
    /// Vertex morph index into `mesh.extras.targetNames`.
    #[serde(default)]
    pub index: i32,
    /// Second index (`index0`, normal morphs).
    #[serde(default)]
    pub index0: i32,
}

/// VRM 1.0 expressions block.
#[derive(Debug, Default, Deserialize)]
pub struct Expressions1 {
    /// Preset expressions, keyed by preset name.
    #[serde(default)]
    pub preset: std::collections::HashMap<String, ExprPreset1>,
    /// Custom expressions.
    #[serde(default)]
    pub custom: Vec<ExprCustom1>,
}

/// One VRM 1.0 preset expression.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExprPreset1 {
    /// Morph-target binds (mesh index + target index).
    #[serde(default)]
    pub morph_target_binds: Vec<MorphBind1>,
    /// Texture binds (ignored in v1).
    #[serde(default)]
    pub texture_binds: Vec<serde_json::Value>,
    /// Whether this preset overrides the look (`isBinary`).
    #[serde(default)]
    pub is_binary: bool,
}

/// One VRM 1.0 custom expression.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExprCustom1 {
    /// Custom name.
    #[serde(default)]
    pub name: String,
    /// Morph binds.
    #[serde(default)]
    pub morph_target_binds: Vec<MorphBind1>,
}

/// VRM 1.0 morph bind: node + target index.
#[derive(Debug, Deserialize)]
pub struct MorphBind1 {
    /// Node index (v1 binds to a Node, resolved via its mesh).
    pub node: u32,
    /// Morph-target index on that mesh.
    pub index: u32,
}

/// VRM 0.x secondary animation (springbones).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondaryAnimation {
    /// Spring groups (hair/skirt chains). In VRM 0.x the JSON key is
    /// `boneGroups`; the field is named `spring_groups` for clarity.
    #[serde(default, rename = "boneGroups")]
    pub spring_groups: Vec<SpringGroup0>,
    /// Collider groups.
    #[serde(default)]
    pub collider_groups: Vec<ColliderGroup0>,
}

/// VRM 0.x spring group.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpringGroup0 {
    /// Display name.
    #[serde(default)]
    pub name: String,
    /// Comment.
    #[serde(default)]
    pub comment: String,
    /// Sphere collider groups referenced by this chain.
    #[serde(default)]
    pub collider_groups: Vec<u32>,
    /// Chain node indices.
    #[serde(default)]
    pub bones: Vec<u32>,
    /// Spring stiffness (`spring.stiffness`).
    #[serde(default)]
    pub stiffness: f32,
    /// Gravity power.
    #[serde(default)]
    pub gravity_power: f32,
    /// Gravity direction vector.
    #[serde(default)]
    pub gravity_dir: GravityDir,
    /// Drag force.
    #[serde(default)]
    pub drag_force: f32,
    /// Hit radius.
    #[serde(default)]
    pub hit_radius: f32,
}

/// VRM 0.x gravity direction: `{ "x", "y", "z" }`.
#[derive(Debug, Default, Deserialize)]
pub struct GravityDir {
    /// X.
    #[serde(default)]
    pub x: f32,
    /// Y.
    #[serde(default)]
    pub y: f32,
    /// Z.
    #[serde(default)]
    pub z: f32,
}

/// VRM 0.x collider group.
#[derive(Debug, Default, Deserialize)]
pub struct ColliderGroup0 {
    /// Display name.
    #[serde(default)]
    pub name: String,
    /// Colliders.
    #[serde(default)]
    pub colliders: Vec<Collider0>,
    /// Bone node the collider offsets are relative to.
    #[serde(default)]
    pub node: Option<u32>,
}

/// VRM 0.x collider (sphere or inside-sphere via offset sign).
#[derive(Debug, Default, Deserialize)]
pub struct Collider0 {
    /// Origin offset from parent bone.
    #[serde(default)]
    pub offset: OffVec,
    /// Radius.
    #[serde(default)]
    pub radius: f32,
}

/// VRM 0.x offset vector `{ x, y, z }`.
#[derive(Debug, Default, Deserialize)]
pub struct OffVec {
    /// X.
    #[serde(default)]
    pub x: f32,
    /// Y.
    #[serde(default)]
    pub y: f32,
    /// Z.
    #[serde(default)]
    pub z: f32,
}

/// VRM 0.x material properties block (index-aligned).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialProperty {
    /// Shader name (`VRM/MToon`, …).
    #[serde(default)]
    pub shader: String,
    /// `floatProperties`, incl. `toonMap` index keys etc.
    #[serde(default)]
    pub float_properties: std::collections::HashMap<String, f32>,
    /// `vectorProperties`, incl. `color`, `shadeColor`, `rimColor`…
    #[serde(default)]
    pub vector_properties: std::collections::HashMap<String, Vec<f32>>,
    /// `textureProperties`, incl. `mainTex`, `shadeMultiplyTex`, `toonMap`…
    #[serde(default)]
    pub texture_properties: std::collections::HashMap<String, u32>,
}

/// VRM 1.0 springbones (`VRMC_springBone`).
#[derive(Debug, Default, Deserialize)]
pub struct VrmSpringBone1 {
    /// Spring joints (flattened global list).
    #[serde(default)]
    pub springs: Vec<Spring1>,
    /// Colliders.
    #[serde(default)]
    pub colliders: Vec<Collider1>,
}

/// VRM 1.0 spring joint.
#[derive(Debug, Default, Deserialize)]
pub struct Spring1 {
    /// Explicit joint list (subset of `joints`).
    #[serde(default)]
    pub joints: Vec<u32>,
    /// Center node.
    #[serde(default)]
    pub center: Option<u32>,
    /// Gravity power (spring property).
    #[serde(default)]
    pub gravity_power: f32,
}

/// VRM 1.0 collider.
#[derive(Debug, Default, Deserialize)]
pub struct Collider1 {
    /// Shaped collider.
    #[serde(default)]
    pub shape: Option<SpringCollider1>,
}

/// VRM 1.0 collider shape.
#[derive(Debug, Default, Deserialize)]
pub struct SpringCollider1 {
    /// Sphere with offset/radius (or plane; only sphere handled v1).
    #[serde(default)]
    pub sphere: Option<SphereCollider>,
}

/// VRM 1.0 sphere collider.
#[derive(Debug, Default, Deserialize)]
pub struct SphereCollider {
    /// Offset from parent.
    #[serde(default)]
    pub offset: OffVec,
    /// Radius.
    #[serde(default)]
    pub radius: f32,
}

/// VRM 1.0 `VRMC_materials_mtoon`.
#[derive(Debug, Default, Deserialize)]
pub struct VrmMtoon1 {
    /// Base color factor `[r,g,b,a]`.
    #[serde(default, rename = "baseColorFactor")]
    pub base_color: Option<Vec<f32>>,
    /// Shade color factor.
    #[serde(default, rename = "shadeColorFactor")]
    pub shade_color: Option<Vec<f32>>,
    /// Toon shades.
    #[serde(default, rename = "toonShades")]
    pub toon_shades: Vec<f32>,
    /// Rim lighting.
    #[serde(default, rename = "rimLightingMix")]
    pub rim_mix: Option<f32>,
    /// Alpha cutout (`alphaCutoff`).
    #[serde(default, rename = "alphaCutoff")]
    pub alpha_cutoff: Option<f32>,
}
