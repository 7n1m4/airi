# Proposal: Dynamic Item & Scene Manifestation via ComfyUI TRELLIS & Fire3D Pipelines

> **Status**: Proposed RFC
> **Document**: `docs/proposal-trellis-dynamic-item-manifestation.md`
> **Target Audience**: Core Developers, 3D Graphics Engineers, ComfyUI Integrators
> **Key References**: `apps/stage-tamagotchi/src/main/services/airi/widgets/providers/comfyui.ts`, `packages/stage-ui/`

This document outlines the architectural design for allowing AI characters to dynamically generate, query, and equip physical 3D items on their bodies (via ComfyUI **TRELLIS**), as well as decompose entire real-world or generated images into interactive, simulation-ready 3D scenes with separate editable meshes (via **Fire3D**).

---

## 🧭 1. Vision & Goals

Currently, characters can change their baseline model settings, workflows, and textures. This proposal extends their physical agency across two complementary tiers:

*   **Tier 1: Item-Level Manifestation (TRELLIS)**: Generates isolated 3D items in real-time from natural language prompts (e.g., a "pink wizard hat", a "glowing gold bracelet", or a "steampunk raygun") and mounts them dynamically to avatar skeletal bone sockets.
*   **Tier 2: Environment-Level Scene Decomposition (Fire3D)**: Extends manifestation beyond single items. Given photos, video clips, or ComfyUI generated art of a room, Fire3D reconstructs a **complete simulation-ready 3D scene with up to 16 separate, editable objects in under 1 minute** on a single GPU. Every object receives its own independent mesh and material information, allowing avatars to physically collide with, pick up, or sit on stage props.
*   **Decoupled State Persistence**: Both items and decomposed scene objects are saved in IndexedDB/localforage and can be listed, equipped, positioned, or unequipped dynamically by both the user and the character.

---

## 🛠️ 2. The LLM Interface (Tool Calling)

The character's consciousness orchestrator is equipped with tools to interact with both personal accessories and stage environments:

### A. `create_stage_item` (Item Level — TRELLIS)
Instructs the backend to generate a new item and attach it to a specific avatar socket.
*   **Arguments**:
    ```json
    {
      "attachTo": "wrist" | "head" | "waist" | "ankle",
      "prompt": "description of the 3D item to generate"
    }
    ```

### B. `decompose_stage_scene` (Environment Level — Fire3D)
Takes a source image (camera capture, wallpaper, or generated background) and reconstructs interactive 3D stage props.
*   **Arguments**:
    ```json
    {
      "imageSource": "active_background" | "webcam_snapshot" | "custom_url",
      "targetObjects": ["chair", "desk", "coffee_cup", "lamp"],
      "enablePhysicsColliders": true
    }
    ```

### C. `list_stage_items`
Queries all historically generated items and decomposed scene meshes in the inventory.
*   **Returns**:
    ```json
    {
      "equippedItems": [
        { "name": "pink_hat", "socket": "head" }
      ],
      "sceneObjects": [
        { "id": "obj_table_01", "name": "wooden_table", "interactive": true },
        { "id": "obj_chair_02", "name": "office_chair", "interactive": true }
      ]
    }
    ```

### D. `equip_stage_item`
Equips a previously generated item from the inventory.
*   **Arguments**:
    ```json
    {
      "name": "pink_hat"
    }
    ```

---

## ⚙️ 3. Backend Pipeline & ComfyUI / Fire3D Integration

```
[ LLM Tool Invocation ]
        │
        ├──► create_stage_item (TRELLIS Workflow) ──► Single .glb ──► Bone Socket Mounting
        │
        └──► decompose_stage_scene (Fire3D Pipeline) ──► Multi-Mesh .glb Bundle (<1 min)
                                                              │
                                                              ▼
                                                   [ IndexedDB Asset Store ]
                                                              │
                                                              ▼
                                                   [ Stage Three.js Scene ]
                                                   (Physics Colliders & Scene Props)
```

1. **TRELLIS Single-Object Capture**:
   * Uses ComfyUI TRELLIS nodes for fast Image-to-3D / Text-to-3D GLB export.
   * Runs normalization to center geometry bounding box at `(0, 0, 0)` and scales to unit size (e.g. `0.2m`).
2. **Fire3D Scene Decomposition Engine**:
   * Takes input video/images, segmenting up to 16 objects in parallel on one GPU.
   * Outputs individual mesh components with material and bounding-box coordinates in shared 3D world space.
   * Ingested into Three.js stage with automatic collision planes, enabling characters to sit on chairs or place cups on tables.

---

## 🎨 4. Stage Mounting & Skeletal Binding

Once a GLB file is compiled, the renderer (Three.js/Three-VRM) dynamically injects the mesh into the scene:

| Socket ID | VRM (3D) | MMD (PMX) | Spine (2D) |
|---|---|---|---|
| **head** | `vrm.humanoid.getNormalizedBoneNode('head')` | Head Bone | Head Slot / Attachment |
| **wrist** | `vrm.humanoid.getNormalizedBoneNode('leftWrist')` | Wrist/Hand Bone | Hand Slot |
| **waist** | `vrm.humanoid.getNormalizedBoneNode('hips')` | Hips/Waist Bone | Hip Slot |
| **ankle** | `vrm.humanoid.getNormalizedBoneNode('leftAnkle')` | Ankle Bone | Foot Slot |

---

## 📅 5. Roadmap & Implementation Checklist

- [ ] **TRELLIS ComfyUI Workflow**: Author reference template for single-item GLB generation.
- [ ] **Fire3D Scene Decomposition Bridge**: Connect Fire3D multi-mesh export pipeline to ComfyUI / local worker.
- [ ] **Socket & Mesh Ingestion**: Implement Three.js skeletal bone mounting and scale normalizer.
- [ ] **Stage Physics & Object Collision**: Add Three.js bounding-box colliders for decomposed furniture and props.
- [ ] **Scene Object Inventory UI**: Add interactive stage props panel in Stage Customizer.
