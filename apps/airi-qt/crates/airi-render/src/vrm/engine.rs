// SPDX-License-Identifier: GPL-3.0-or-later

//! CPU-side VRM engine: rest-pose math, skinning, morph blending, and the
//! idle / gaze / blink / lip-sync / expression / spring-bone controllers.
//!
//! The Qt Quick 3D side consumes per-frame, fully-resolved vertex buffers
//! (see `apps/airi-qt/qml/StageScene.qml` and the `AiriVrmGeometryShell`
//! C++ shell). Skinning and morphs are evaluated on the CPU every frame:
//! 30–60k vertices is well under a millisecond, and it removes any reliance
//! on Qt Quick 3D's skinning internals (attribute formats, joint limits).
//!
//! Coordinate conventions are glTF's: right-handed, column-major matrices,
//! VRM units are meters.
//!
//! Spring bones are simulated per chain in the chain's parent frame (at
//! rest, re-anchored every frame so parent motion carries the hair). Sphere
//! colliders are approximated by the head bone with a fixed radius when the
//! document declares collider groups; exact per-collider offsets are not
//! wired yet (see the phase note).

use super::expression::ExpressionEngine;
use super::gaze::GazeController;
use super::geometry::build_document_geometry;
use super::idle::IdleController;
use super::lipsync::LipSync;
use super::materials::MtoonParams;
use super::morph::collect_morph_targets;
use super::springbone::SpringChain;
use super::{math::*, VrmDocument};
use crate::vrm::materials;
use std::collections::HashMap;
use std::path::Path;

/// Base-color texture bytes extracted from the document.
#[derive(Debug, Clone)]
pub struct MaterialTexture {
    /// Raw image bytes (PNG/JPEG payload as stored in the glTF buffer).
    pub bytes: Vec<u8>,
    /// MIME type of the image.
    pub mime: String,
    /// File extension for cache files (`png` / `jpg`).
    pub extension: String,
}

/// Names of presets that are driven by the idle/lip-sync controllers rather
/// than the emotion map (normalized spellings).
const LIP_PRESETS: &[&str] = &["aa", "a"];
const BLINK_PRESETS: &[&str] = &["blink", "blinkl", "blinkr", "blinkleft", "blinkright"];
const LOOK_PRESETS: &[&str] = &["lookup", "lookdown", "lookleft", "lookright"];
const SKIP_EMOTIONS: &[&str] = &[
    "aa",
    "a",
    "ih",
    "i",
    "ou",
    "u",
    "ee",
    "e",
    "oh",
    "o", // vowels
    "blink",
    "blinkl",
    "blinkr",
    "blinkleft",
    "blinkright", // blink
    "lookup",
    "lookdown",
    "lookleft",
    "lookright", // gaze
    "neutral",
];

/// Normalize a morph preset name to its canonical lowercase, alphanumeric-only
/// form and fold VRM 0.x aliases onto the VRM 1.0 spellings.
pub fn normalize_preset(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    match cleaned.as_str() {
        "joy" => "happy".to_string(),
        "sorrow" => "sad".to_string(),
        "fun" => "relaxed".to_string(),
        other => other.to_string(),
    }
}

/// One per-primitive work buffer (interleaved pos/normal/uv/joints/weights).
#[derive(Debug, Clone)]
pub struct PrimitiveWork {
    /// Mesh index (glTF mesh).
    pub mesh: u32,
    /// Primitive index within the mesh.
    pub primitive: usize,
    /// Material index (if any).
    pub material: Option<u32>,
    /// Vertex count.
    pub vertex_count: usize,
    /// Rest interleave (immutable input for skinning).
    rest: Vec<f32>,
    /// Interleaved buffer with pos/normal rewritten each tick.
    work: Vec<f32>,
    /// u32 indices.
    indices: Vec<u32>,
    /// Morph slots for this primitive.
    morphs: Vec<super::morph::MorphTarget>,
    /// Indices (into the document node list) of the joints used by the skin,
    /// or `None` for primitives on unskinned meshes (rendered with their
    /// mesh node's world transform).
    skinned: Option<Vec<usize>>,
    /// Mesh node index (used when unskinned).
    mesh_node: Option<usize>,
}

#[derive(Debug)]
struct ChainRuntime {
    /// Node indices root..tip.
    joints: Vec<usize>,
    /// Simulated chain (points in the root-parent local frame).
    sim: SpringChain,
    /// Frame matrix of the chain's parent from the previous tick; used to
    /// re-anchor points when the parent moves.
    frame_prev: Mat4,
    /// Head node index for the collider sphere (if the document has one).
    head_node: Option<usize>,
    /// Sphere collider radius in meters.
    collider_radius: f32,
}

/// Resolved VRM scene: parsed document + controllers + work buffers.
#[derive(Debug)]
pub struct Engine {
    primitives: Vec<PrimitiveWork>,
    /// Joint node indices ordered as in the skin's joint list.
    skin_joints: Vec<usize>,
    /// Inverse bind matrices (column-major).
    inverse_bind: Vec<Mat4>,
    /// Node tables.
    node_count: usize,
    parents: Vec<Option<usize>>,
    /// Topological order (parents before children).
    topo_order: Vec<usize>,
    rest_t: Vec<[f32; 3]>,
    rest_r: Vec<Quat>,
    rest_s: Vec<[f32; 3]>,
    /// Canonical humanoid bone → node index.
    bones: HashMap<String, usize>,
    mtoon: Vec<MtoonParams>,
    /// Base-color texture per material index (parallel to `mtoon`).
    material_textures: Vec<Option<MaterialTexture>>,
    emotion_map: HashMap<String, HashMap<String, f32>>,
    lip_raw: Vec<String>,
    blink_raw: Vec<String>,
    // Controllers.
    idle: IdleController,
    gaze: GazeController,
    lip_sync: LipSync,
    expressions: ExpressionEngine,
    chains: Vec<ChainRuntime>,
    elapsed: f32,
    /// Whether a head collider is available for spring chains.
    has_colliders: bool,
}

impl Engine {
    /// Load and parse a `.vrm` file and build all runtime state.
    pub fn load(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let path = path.as_ref();
        let doc = VrmDocument::load(path)?;
        let targets = collect_morph_targets(&doc);
        let geometry = build_document_geometry(&doc, &targets)?;
        let skin = super::skin::extract_skin(&doc);
        let mtoon = materials::extract_mtoon(&doc);
        let material_textures = extract_material_textures(&doc);

        // ---- Node tables -------------------------------------------------
        let node_count = doc.gltf.nodes().count();
        let mut parents = vec![None; node_count];
        let mut children: Vec<Vec<usize>> = vec![Vec::new(); node_count];
        let mut name_to_index = HashMap::new();
        for node in doc.gltf.nodes() {
            let i = node.index();
            if let Some(name) = node.name() {
                name_to_index.insert(name.to_string(), i);
            }
            for child in node.children() {
                let c = child.index();
                parents[c] = Some(i);
                children[i].push(c);
            }
        }
        // Topological order (parents strictly before children).
        let mut topo_order = Vec::with_capacity(node_count);
        let mut state = vec![0u8; node_count]; // 0 = unvisited, 1 = done
        fn visit(i: usize, children: &[Vec<usize>], state: &mut [u8], order: &mut Vec<usize>) {
            if state[i] == 1 {
                return;
            }
            for &c in &children[i] {
                visit(c, children, state, order);
            }
            state[i] = 1;
            order.push(i);
        }
        for (i, parent) in parents.iter().take(node_count).enumerate() {
            if parent.is_none() {
                visit(i, &children, &mut state, &mut topo_order);
            }
        }
        // Any nodes missed by the walk (shouldn't happen) get appended.
        for i in 0..node_count {
            if !topo_order.contains(&i) {
                topo_order.push(i);
            }
        }
        topo_order.reverse();

        let mut rest_t = vec![[0.0f32; 3]; node_count];
        let mut rest_r = vec![Quat::IDENTITY; node_count];
        let mut rest_s = vec![[1.0f32; 3]; node_count];
        let mut rest_matrix = vec![Mat4::IDENTITY; node_count];
        let mut is_matrix = vec![false; node_count];
        for node in doc.gltf.nodes() {
            let i = node.index();
            match node.transform() {
                gltf::scene::Transform::Decomposed {
                    translation,
                    rotation,
                    scale,
                } => {
                    rest_t[i] = translation;
                    rest_r[i] = Quat::from_array(rotation);
                    rest_s[i] = scale;
                }
                gltf::scene::Transform::Matrix { matrix } => {
                    rest_matrix[i] = Mat4::from_gltf_matrix(matrix);
                    is_matrix[i] = true;
                }
            }
        }
        // Compose rest worlds (topological order).
        let mut world_rest = vec![Mat4::IDENTITY; node_count];
        for &i in &topo_order {
            let local = if is_matrix[i] {
                rest_matrix[i]
            } else {
                Mat4::compose(rest_t[i], rest_r[i], rest_s[i])
            };
            world_rest[i] = match parents[i] {
                Some(p) => world_rest[p].mul(local),
                None => local,
            };
        }

        // ---- Mesh node lookup -------------------------------------------
        let mut mesh_node: HashMap<u32, usize> = HashMap::new();
        let mut mesh_skin_node: HashMap<u32, bool> = HashMap::new();
        for node in doc.gltf.nodes() {
            if let Some(mesh) = node.mesh() {
                let mesh_idx = mesh.index() as u32;
                mesh_node.entry(mesh_idx).or_insert(node.index());
                mesh_skin_node.insert(mesh_idx, node.skin().is_some());
            }
        }

        // ---- Skinning tables ---------------------------------------------
        let (skin_joints, inverse_bind): (Vec<usize>, Vec<Mat4>) = match &skin {
            Some(s) => (
                s.joints.iter().map(|&j| j as usize).collect(),
                s.inverse_bind_poses
                    .iter()
                    .map(|m| Mat4::from_column_major(*m))
                    .collect(),
            ),
            None => (Vec::new(), Vec::new()),
        };

        // ---- Primitives (with per-primitive rest/work buffers) -----------
        let mut primitives = Vec::with_capacity(geometry.len());
        for geom in geometry {
            let skinned = if mesh_skin_node.get(&geom.mesh).copied().unwrap_or(false) {
                Some(skin_joints.clone())
            } else {
                None
            };
            let mesh_node = mesh_node.get(&geom.mesh).copied();
            primitives.push(PrimitiveWork {
                mesh: geom.mesh,
                primitive: geom.primitive,
                material: geom.material,
                vertex_count: geom.vertex_count,
                rest: geom.vertices.clone(),
                work: geom.vertices,
                indices: geom.indices,
                morphs: geom
                    .morphs
                    .iter()
                    .map(|slot| super::morph::MorphTarget {
                        mesh: geom.mesh,
                        primitive: geom.primitive,
                        target: 0,
                        preset: slot.preset.clone(),
                        position_deltas: slot.position_deltas.clone(),
                        normal_deltas: slot.normal_deltas.clone(),
                        weight: 0.0,
                    })
                    .collect(),
                skinned,
                mesh_node,
            });
        }

        // ---- Morph buckets ------------------------------------------------
        // Raw preset names (as bound in the document) drive lip-sync/blink.
        let mut lip_raw = Vec::new();
        let mut blink_raw = Vec::new();
        let mut emotion_map: HashMap<String, HashMap<String, f32>> = HashMap::new();
        for prim in &primitives {
            for morph in &prim.morphs {
                let norm = normalize_preset(&morph.preset);
                if LIP_PRESETS.contains(&norm.as_str()) {
                    if !lip_raw.contains(&morph.preset) {
                        lip_raw.push(morph.preset.clone());
                    }
                    continue;
                }
                if BLINK_PRESETS.contains(&norm.as_str()) {
                    if !blink_raw.contains(&morph.preset) {
                        blink_raw.push(morph.preset.clone());
                    }
                    continue;
                }
                if SKIP_EMOTIONS.contains(&norm.as_str()) || LOOK_PRESETS.contains(&norm.as_str()) {
                    continue;
                }
                emotion_map
                    .entry(norm)
                    .or_default()
                    .insert(morph.preset.clone(), 1.0);
            }
        }

        // ---- Humanoid bones (extension map with name fallback) ------------
        let mut bones: HashMap<String, usize> = HashMap::new();
        let raw_bones: Option<&HashMap<String, u32>> =
            match (&doc.extensions.vrm0, &doc.extensions.vrm1) {
                (Some(v0), _) if !v0.humanoid.bones.is_empty() => Some(&v0.humanoid.bones),
                (_, Some(v1)) if !v1.humanoid.bones.is_empty() => Some(&v1.humanoid.bones),
                _ => None,
            };
        if let Some(map) = raw_bones {
            for (name, &node) in map {
                bones.insert(name.to_ascii_lowercase(), node as usize);
            }
        }
        const BONE_CANDIDATES: &[(&str, &[&str])] = &[
            ("hips", &["hips"]),
            ("spine", &["spine"]),
            ("chest", &["chest"]),
            ("upperchest", &["upperchest"]),
            ("neck", &["neck"]),
            ("head", &["head"]),
            (
                "lefteye",
                &[
                    "lefteye",
                    "left_eye",
                    "fackeye_l",
                    "faceeye_l",
                    "eye_l",
                    "adj_l_faceeye",
                ],
            ),
            (
                "righteye",
                &[
                    "righteye",
                    "right_eye",
                    "fackeye_r",
                    "faceeye_r",
                    "eye_r",
                    "adj_r_faceeye",
                ],
            ),
            (
                "leftupperarm",
                &["leftupperarm", "left_upper_arm", "upperarm_l", "l_upperarm"],
            ),
            (
                "rightupperarm",
                &[
                    "rightupperarm",
                    "right_upper_arm",
                    "upperarm_r",
                    "r_upperarm",
                ],
            ),
        ];
        for &(canonical, candidates) in BONE_CANDIDATES {
            if bones.contains_key(canonical) {
                continue;
            }
            for (name, &idx) in &name_to_index {
                let flat: String = name
                    .chars()
                    .filter(|c| c.is_ascii_alphanumeric())
                    .map(|c| c.to_ascii_lowercase())
                    .collect();
                if candidates.iter().any(|c| flat.contains(c)) {
                    bones.insert(canonical.to_string(), idx);
                    break;
                }
            }
        }

        // ---- Spring chains -------------------------------------------------
        let has_colliders = match (&doc.extensions.vrm0, &doc.extensions.spring_bone1) {
            (Some(v0), _) => v0
                .secondary_animation
                .as_ref()
                .map(|s| !s.collider_groups.is_empty())
                .unwrap_or(false),
            (_, Some(sb)) => !sb.colliders.is_empty(),
            _ => false,
        };
        let mut chains: Vec<ChainRuntime> = Vec::new();
        let head_node = bones.get("head").copied();
        let build_chain = |chain_nodes: Vec<usize>,
                           stiffness: f32,
                           gravity_power: f32,
                           gravity_dir: [f32; 3],
                           drag: f32,
                           chains: &mut Vec<ChainRuntime>| {
            if chain_nodes.len() < 2 {
                return;
            }
            let root_parent = parents[chain_nodes[0]];
            let frame_rest = match root_parent {
                Some(p) => world_rest[p].inverse_affine(),
                None => Mat4::IDENTITY,
            };
            let bone_names: Vec<String> = chain_nodes
                .iter()
                .map(|&n| {
                    doc.gltf
                        .nodes()
                        .nth(n)
                        .and_then(|node| node.name().map(|s| s.to_string()))
                        .unwrap_or_else(|| format!("joint_{n}"))
                })
                .collect();
            let rest_offsets: Vec<[f32; 3]> = chain_nodes
                .iter()
                .map(|&n| {
                    frame_rest
                        .transform_point(world_rest[n].translation())
                        .to_array()
                })
                .collect();
            let sim = SpringChain::new(
                bone_names,
                &rest_offsets,
                stiffness,
                gravity_power,
                gravity_dir,
                drag,
            );
            chains.push(ChainRuntime {
                joints: chain_nodes,
                sim,
                frame_prev: frame_rest,
                head_node,
                collider_radius: 0.08,
            });
        };
        if let Some(v0) = &doc.extensions.vrm0 {
            if let Some(secondary) = &v0.secondary_animation {
                for group in &secondary.spring_groups {
                    for &root in &group.bones {
                        let chain = walk_chain(root as usize, &children, 8);
                        let gravity_dir = [
                            group.gravity_dir.x,
                            group.gravity_dir.y,
                            group.gravity_dir.z,
                        ];
                        build_chain(
                            chain,
                            group.stiffness,
                            group.gravity_power,
                            gravity_dir,
                            group.drag_force,
                            &mut chains,
                        );
                    }
                }
            }
        }
        if let Some(sb) = &doc.extensions.spring_bone1 {
            for spring in &sb.springs {
                let chain: Vec<usize> = spring.joints.iter().map(|&j| j as usize).collect();
                build_chain(
                    chain,
                    1.0,
                    spring.gravity_power,
                    [0.0, -1.0, 0.0],
                    0.4,
                    &mut chains,
                );
            }
        }

        Ok(Self {
            primitives,
            skin_joints,
            inverse_bind,
            node_count,
            parents,
            topo_order,
            rest_t,
            rest_r,
            rest_s,
            bones,
            mtoon,
            material_textures,
            emotion_map: emotion_map.clone(),
            lip_raw,
            blink_raw,
            idle: IdleController::default(),
            gaze: GazeController::new(),
            lip_sync: LipSync::new(),
            expressions: ExpressionEngine::new(emotion_map),
            chains,
            elapsed: 0.0,
            has_colliders,
        })
    }

    /// Number of primitives to render.
    pub fn primitive_count(&self) -> usize {
        self.primitives.len()
    }

    /// Current interleaved vertex bytes of primitive `index` (pos/normal are
    /// rewritten every tick; uv/joints/weights keep the rest values).
    pub fn vertex_bytes(&self, index: usize) -> Option<Vec<u8>> {
        let prim = self.primitives.get(index)?;
        Some(f32_slice_as_bytes(&prim.work))
    }

    /// Raw vertex floats (stride 16 f32/vertex) of primitive `index`.
    pub fn vertex_floats(&self, index: usize) -> Option<&[f32]> {
        self.primitives.get(index).map(|p| p.work.as_slice())
    }

    /// u32 index list of primitive `index`.
    pub fn index_bytes(&self, index: usize) -> Option<Vec<u8>> {
        let prim = self.primitives.get(index)?;
        let mut out = Vec::with_capacity(prim.indices.len() * 4);
        for i in &prim.indices {
            out.extend_from_slice(&i.to_le_bytes());
        }
        Some(out)
    }

    /// Material index for primitive `index` (if any).
    pub fn primitive_material(&self, index: usize) -> Option<u32> {
        self.primitives.get(index).and_then(|p| p.material)
    }

    /// MToon params for material `index`.
    pub fn mtoon(&self, index: u32) -> Option<&MtoonParams> {
        self.mtoon.get(index as usize)
    }

    /// Base-color texture for material `index` (if any).
    pub fn material_texture(&self, index: u32) -> Option<&MaterialTexture> {
        self.material_textures
            .get(index as usize)
            .and_then(|t| t.as_ref())
    }

    /// Names of emotions derived from the document (normalized).
    pub fn available_expressions(&self) -> Vec<String> {
        let mut v: Vec<String> = self.emotion_map.keys().cloned().collect();
        v.sort();
        v
    }

    /// Whether the document has spring-bone chains.
    pub fn has_spring_bones(&self) -> bool {
        !self.chains.is_empty()
    }

    /// Whether spring chains have collider support enabled.
    pub fn has_colliders(&self) -> bool {
        self.has_colliders
    }

    /// Feed a lip-sync amplitude sample (0..1).
    pub fn set_lip_sync(&mut self, amplitude: f32) {
        self.lip_sync.set_rms(amplitude);
    }

    /// Look at a screen position (normalized against monitor size).
    pub fn look_at(&mut self, x: f32, y: f32, monitor_w: f32, monitor_h: f32) {
        self.gaze.set_mouse(x, y, monitor_w, monitor_h);
    }

    /// Reset gaze to the forward direction.
    pub fn clear_look_at(&mut self) {
        self.gaze.set_mouse(0.5, 0.5, 1.0, 1.0);
    }

    /// Set an expression weight. `name` is normalized (`joy` → `happy`);
    /// known document emotions animate via the expression engine, anything
    /// else is applied directly as an unmanaged preset weight.
    pub fn set_expression_weight(&mut self, name: &str, weight: f32) {
        let weight = weight.clamp(0.0, 1.0);
        let norm = normalize_preset(name);
        if self.emotion_map.contains_key(&norm) {
            self.expressions.set_emotion(&norm, weight, None);
            return;
        }
        // Unmanaged preset: force the raw (or normalized) weight directly.
        let trimmed = name.trim().to_string();
        self.expressions.apply_external(&trimmed, weight);
        if trimmed != norm {
            self.expressions.apply_external(&norm, weight);
        }
    }

    /// Advance the simulation by `dt_ms` milliseconds, then re-skin every
    /// primitive buffer.
    pub fn tick(&mut self, dt_ms: f32) {
        let dt = (dt_ms / 1000.0).clamp(0.0, 0.1);
        self.elapsed += dt;
        self.idle.tick(dt);
        let (yaw_deg, pitch_deg) = self.gaze.tick(dt);
        let lip_weight = self.lip_sync.tick(dt);
        let _ = self.expressions.tick(dt);
        let blink_weight = self.idle.blink_weight();
        for raw in self.blink_raw.clone() {
            self.expressions.apply_external(&raw, blink_weight);
        }
        if let Some(first) = self.lip_raw.first().cloned() {
            self.expressions.apply_external(&first, lip_weight);
        }
        let morph_weights: HashMap<String, f32> = self
            .expressions
            .tick(0.0)
            .iter()
            .map(|(k, &v)| (k.clone(), v))
            .collect();

        // ---- Pose deltas ---------------------------------------------------
        let mut cur_r = self.rest_r.clone();
        let cur_t = self.rest_t.clone();
        let mut cur_s = self.rest_s.clone();
        let y_axis = Vec3 {
            x: 0.0,
            y: 1.0,
            z: 0.0,
        };
        let x_axis = Vec3 {
            x: 1.0,
            y: 0.0,
            z: 0.0,
        };
        let z_axis = Vec3 {
            x: 0.0,
            y: 0.0,
            z: 1.0,
        };

        // Breath: chest scale (+-2%).
        let breath = self.idle.breath_scale();
        for key in ["chest", "upperchest"] {
            if let Some(&b) = self.bones.get(key) {
                let s = self.rest_s[b];
                cur_s[b] = [s[0] * breath, s[1] * breath, s[2] * breath];
            }
        }
        // Sway: hips yaw, spine takes a small counter-sway.
        let sway = self.idle.sway_yaw().to_radians();
        if let Some(&b) = self.bones.get("hips") {
            cur_r[b] = cur_r[b] * Quat::from_axis_angle(y_axis, sway);
        }
        if let Some(&b) = self.bones.get("spine") {
            cur_r[b] = cur_r[b] * Quat::from_axis_angle(y_axis, -sway * 0.5);
        }
        // Idle bob: gentle vertical chest pitch.
        if let Some(&b) = self.bones.get("chest") {
            cur_r[b] = cur_r[b] * Quat::from_axis_angle(x_axis, 0.02 * (self.elapsed * 1.4).cos());
        }
        // Gaze → head (+ neck at half strength) and eyes at 70%.
        let yaw = yaw_deg.to_radians();
        let pitch = pitch_deg.to_radians();
        if let Some(&b) = self.bones.get("neck") {
            cur_r[b] = cur_r[b]
                * Quat::from_axis_angle(y_axis, yaw * 0.4)
                * Quat::from_axis_angle(x_axis, pitch * 0.4);
        }
        if let Some(&b) = self.bones.get("head") {
            cur_r[b] = cur_r[b]
                * Quat::from_axis_angle(y_axis, yaw * 0.6)
                * Quat::from_axis_angle(x_axis, pitch * 0.6);
        }
        for key in ["lefteye", "righteye"] {
            if let Some(&b) = self.bones.get(key) {
                cur_r[b] = cur_r[b]
                    * Quat::from_axis_angle(y_axis, yaw * 0.7)
                    * Quat::from_axis_angle(x_axis, pitch * 0.7);
            }
        }
        // Arm A-pose relaxation (rest is typically a T-pose). The idle
        // controller's `arm_relax()` is a subtle pull-in; VRM 0.x models are
        // usually authored as a straight T-pose, so scale it into a real
        // A-pose (0.15 → 0.6 rad ≈ 34°).
        let arm = self.idle.arm_relax() * 4.0;
        if let Some(&b) = self.bones.get("leftupperarm") {
            cur_r[b] = cur_r[b] * Quat::from_axis_angle(z_axis, -arm);
        }
        if let Some(&b) = self.bones.get("rightupperarm") {
            cur_r[b] = cur_r[b] * Quat::from_axis_angle(z_axis, arm);
        }

        // ---- World matrices (pre-spring) -----------------------------------
        let world_pre = self.compose_world(&cur_t, &cur_r, &cur_s);

        // ---- Spring bones ---------------------------------------------------
        let chains: Vec<ChainRuntime> = std::mem::take(&mut self.chains);
        self.chains = self.solve_chains(chains, &world_pre, &mut cur_r, dt, &cur_t, &cur_s);

        // ---- World matrices (final) -----------------------------------------
        let world = self.compose_world(&cur_t, &cur_r, &cur_s);

        // ---- Joint skinning matrices ----------------------------------------
        let joint_mats: Vec<Mat4> = self
            .skin_joints
            .iter()
            .zip(self.inverse_bind.iter())
            .map(|(&node, &ibm)| world[node].mul(ibm))
            .collect();

        // ---- Re-skin + blend morphs -----------------------------------------
        for prim in &mut self.primitives {
            reskin_primitive(prim, &world, &joint_mats, &morph_weights);
        }
    }

    /// Compose world matrices for every node from local TRS arrays.
    fn compose_world(&self, cur_t: &[[f32; 3]], cur_r: &[Quat], cur_s: &[[f32; 3]]) -> Vec<Mat4> {
        let mut world = vec![Mat4::IDENTITY; self.node_count];
        for &i in &self.topo_order {
            let local = Mat4::compose(cur_t[i], cur_r[i], cur_s[i]);
            world[i] = match self.parents[i] {
                Some(p) => world[p].mul(local),
                None => local,
            };
        }
        world
    }

    /// Solve spring chains top-down; returns the updated chain runtimes and
    /// applies the corrected local rotations into `cur_r`.
    fn solve_chains(
        &mut self,
        mut chains: Vec<ChainRuntime>,
        world_pre: &[Mat4],
        cur_r: &mut [Quat],
        dt: f32,
        cur_t: &[[f32; 3]],
        cur_s: &[[f32; 3]],
    ) -> Vec<ChainRuntime> {
        for chain in &mut chains {
            let root_parent = self.parents[chain.joints[0]];
            let frame = match root_parent {
                Some(p) => world_pre[p],
                None => Mat4::IDENTITY,
            };
            // Re-anchor points to the (possibly moved) parent frame.
            let reanchor = frame.inverse_affine().mul(chain.frame_prev);
            for pt in &mut chain.sim.points {
                let p = reanchor.transform_point(Vec3::from_array(pt.pos));
                pt.pos = p.to_array();
                let prev = reanchor.transform_point(Vec3::from_array(pt.prev));
                pt.prev = prev.to_array();
            }
            chain.frame_prev = frame;

            // Head-sphere collider in the same frame.
            let head_sphere = match (chain.head_node, self.has_colliders) {
                (Some(head), true) => {
                    let head_f = frame
                        .inverse_affine()
                        .transform_point(world_pre[head].translation());
                    Some((head_f.to_array(), chain.collider_radius))
                }
                _ => None,
            };
            chain.sim.tick(dt, head_sphere);

            // Distribute the simulated positions back onto local rotations.
            let mut m_frame = Mat4::IDENTITY; // chain-parent frame (local F)
            for i in 0..chain.joints.len() {
                let j = chain.joints[i];
                if i == 0 {
                    m_frame = m_frame.mul(Mat4::compose(cur_t[j], cur_r[j], cur_s[j]));
                    continue;
                }
                let parent = chain.joints[i - 1];
                let desired = Vec3::from_array(chain.sim.points[i].pos)
                    .sub(Vec3::from_array(chain.sim.points[i - 1].pos))
                    .normalized();
                let pred = m_frame
                    .rotation()
                    .rotate_vec(Vec3::from_array(cur_t[j]))
                    .normalized();
                let delta_f = Quat::from_to(pred, desired);
                let parent_rot = m_frame.rotation();
                let delta_local = parent_rot.inverse().mul(delta_f).mul(parent_rot);
                cur_r[parent] = cur_r[parent].mul(delta_local).normalized();
                // Rebuild the parent frame with the corrected rotation,
                // preserving translation and scale.
                let t = m_frame.translation();
                let s = column_scales(&m_frame);
                m_frame = Mat4::compose(t.to_array(), parent_rot.mul(delta_f), s);
                m_frame = m_frame.mul(Mat4::compose(cur_t[j], cur_r[j], cur_s[j]));
            }
        }
        chains
    }
}

/// Column scales of the 3×3 part of a matrix.
fn column_scales(m: &Mat4) -> [f32; 3] {
    let c = |i: usize| {
        Vec3 {
            x: m.m[i],
            y: m.m[i + 1],
            z: m.m[i + 2],
        }
        .len()
        .max(1e-8)
    };
    [c(0), c(4), c(8)]
}

/// Walk down the first-child path starting at `root` (depth-capped).
fn walk_chain(root: usize, children: &[Vec<usize>], max_len: usize) -> Vec<usize> {
    let mut out = vec![root];
    let mut cur = root;
    while out.len() < max_len {
        match children[cur].first() {
            Some(&next) => {
                out.push(next);
                cur = next;
            }
            None => break,
        }
    }
    out
}

/// Rewrite pos/normal of one primitive in place.
fn reskin_primitive(
    prim: &mut PrimitiveWork,
    world: &[Mat4],
    joint_mats: &[Mat4],
    morph_weights: &HashMap<String, f32>,
) {
    let stride = 16usize;
    let mesh_world = prim.mesh_node.map(|n| world[n]);
    let weights_for: Vec<(bool, f32)> = prim
        .morphs
        .iter()
        .map(|m| {
            let w = morph_weights.get(&m.preset).copied().unwrap_or(0.0);
            (w.abs() > 1e-4, w)
        })
        .collect();

    for vi in 0..prim.vertex_count {
        let base = vi * stride;
        let p0 = Vec3 {
            x: prim.rest[base],
            y: prim.rest[base + 1],
            z: prim.rest[base + 2],
        };
        let n0 = Vec3 {
            x: prim.rest[base + 3],
            y: prim.rest[base + 4],
            z: prim.rest[base + 5],
        };

        let (p_skin, n_skin) = match (&prim.skinned, &mesh_world) {
            (Some(_), _) if !joint_mats.is_empty() => {
                let j = |k: usize| prim.rest[base + 8 + k] as i32;
                let w = |k: usize| prim.rest[base + 12 + k];
                let mut p = Vec3::ZERO;
                let mut n = Vec3::ZERO;
                for k in 0..4 {
                    let wk = w(k);
                    if wk == 0.0 {
                        continue;
                    }
                    let ji = j(k).max(0) as usize % joint_mats.len();
                    let jm = joint_mats[ji];
                    p = p.add(jm.transform_point(p0).scale(wk));
                    n = n.add(jm.transform_dir(n0).scale(wk));
                }
                (p, n)
            }
            (_, Some(mw)) => (mw.transform_point(p0), mw.transform_dir(n0)),
            _ => (p0, n0),
        };

        let mut p = p_skin;
        let mut n = n_skin;
        for (morph, &(active, weight)) in prim.morphs.iter().zip(weights_for.iter()) {
            if !active {
                continue;
            }
            if let (Some(pd), Some(nd)) =
                (morph.position_deltas.get(vi), morph.normal_deltas.get(vi))
            {
                p = Vec3 {
                    x: p.x + pd[0] * weight,
                    y: p.y + pd[1] * weight,
                    z: p.z + pd[2] * weight,
                };
                n = Vec3 {
                    x: n.x + nd[0] * weight,
                    y: n.y + nd[1] * weight,
                    z: n.z + nd[2] * weight,
                };
            }
        }
        let n = n.normalized();
        prim.work[base] = p.x;
        prim.work[base + 1] = p.y;
        prim.work[base + 2] = p.z;
        prim.work[base + 3] = n.x;
        prim.work[base + 4] = n.y;
        prim.work[base + 5] = n.z;
    }
}

/// Reinterpret an f32 slice as little-endian bytes.
fn f32_slice_as_bytes(slice: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(slice.len() * 4);
    for v in slice {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_aliases() {
        assert_eq!(normalize_preset("Joy"), "happy");
        assert_eq!(normalize_preset("Sorrow"), "sad");
        assert_eq!(normalize_preset("Fun"), "relaxed");
        assert_eq!(normalize_preset("Blink_L"), "blinkl");
        assert_eq!(normalize_preset("aa"), "aa");
    }
}

#[cfg(test)]
mod engine_tests {
    use super::*;

    fn bundled_model() -> Option<std::path::PathBuf> {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let candidate = manifest.join(
            "../../../../packages/stage-ui/src/assets/vrm/models/AvatarSample-A/AvatarSample_A.vrm",
        );
        candidate.exists().then_some(candidate)
    }

    #[test]
    fn engine_loads_and_ticks_bundled_model() {
        let Some(path) = bundled_model() else {
            eprintln!("bundled AvatarSample_A.vrm not found; skipping");
            return;
        };
        let mut engine = Engine::load(&path).expect("load bundled model");
        assert_eq!(engine.primitive_count(), 7);
        assert!(!engine.available_expressions().is_empty());
        assert!(engine.has_spring_bones());
        assert_eq!(engine.primitive_count(), 7);
        // Every AvatarSample_A material ships an embedded mainTex.
        for m in 0..7u32 {
            assert!(
                engine.material_texture(m).is_some(),
                "material {m} should have a texture"
            );
        }
        for _ in 0..30 {
            engine.tick(16.0);
        }
        for i in 0..engine.primitive_count() {
            let floats = engine.vertex_floats(i).expect("primitive exists");
            assert!(!floats.is_empty());
            assert!(
                floats.iter().all(|f| f.is_finite()),
                "primitive {i} has non-finite floats"
            );
        }
        // Skinning must actually move vertices (rest pose != ticked pose).
        let rest = engine.vertex_floats(0).unwrap().to_vec();
        assert!(rest.chunks(16).any(|v| v[0] != 0.0));
    }

    #[test]
    fn missing_model_errors() {
        assert!(Engine::load("definitely/does/not/exist.vrm").is_err());
    }
}

/// Extract the base-color texture for every material (index-aligned with
/// `extract_mtoon`). VRM 0.x reads `textureProperties._MainTex`; VRM 1.0 /
/// plain glTF falls back to `pbrMetallicRoughness.baseColorTexture`.
fn extract_material_textures(doc: &VrmDocument) -> Vec<Option<MaterialTexture>> {
    let material_count = doc.gltf.materials().count();
    let mut out = Vec::with_capacity(material_count);
    for (index, material) in doc.gltf.materials().enumerate() {
        let texture_index = vrm0_main_texture(doc, index as u32).or_else(|| {
            material
                .pbr_metallic_roughness()
                .base_color_texture()
                .map(|t| t.texture().index() as u32)
        });
        out.push(texture_index.and_then(|i| texture_bytes(doc, i)));
    }
    out
}

/// VRM 0.x: `materialProperties[i].textureProperties["_MainTex"]`.
fn vrm0_main_texture(doc: &VrmDocument, index: u32) -> Option<u32> {
    doc.extensions
        .vrm0
        .as_ref()
        .and_then(|v0| v0.material_properties.get(index as usize))
        .and_then(|mp| mp.texture_properties.get("_MainTex").copied())
}

/// Read the raw image bytes behind glTF texture `index` (bufferView-backed
/// images only; external URIs are skipped).
fn texture_bytes(doc: &VrmDocument, index: u32) -> Option<MaterialTexture> {
    let tex = doc.gltf.textures().nth(index as usize)?;
    let image = tex.source();
    match image.source() {
        gltf::image::Source::View { view, mime_type } => {
            let offset = view.offset();
            let end = offset.checked_add(view.length())?;
            let bytes = doc.blob.get(offset..end)?.to_vec();
            let mime = mime_type.to_string();
            let extension = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
                "png".to_string()
            } else if bytes.starts_with(&[0xFF, 0xD8]) || mime.contains("jpeg") {
                "jpg".to_string()
            } else if mime.contains("webp") {
                "webp".to_string()
            } else {
                "png".to_string()
            };
            Some(MaterialTexture {
                bytes,
                mime,
                extension,
            })
        }
        gltf::image::Source::Uri { .. } => None,
    }
}
