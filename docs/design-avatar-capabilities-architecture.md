# Canonical Design: Unified Avatar Capabilities Architecture

**Status**: Proposed / Aligned (Oct 2026)
**Supersedes**: Scattered model mappings (`emotionMappings`, `motionMappings`, `favoriteExpressions`, `hiddenExpressions`, `hiddenMotions`) on `DisplayModelFile`
**Related Documents**:
- [`docs/design-model-customizer.md`](./design-model-customizer.md) (Widget contract & preview mechanics)
- [`docs/proposal-ninja-swap-interceptor.md`](./proposal-ninja-swap-interceptor.md) (Acting & Jev interceptor integration)
- [`docs/data-catalog.md`](./data-catalog.md) (Persistence inventory)

---

## 1. Executive Summary & Motivation

### The Problem: Fragmented Field Zoo & Semantic Overload
Historically, a `DisplayModelFile` attempted to model capability introspection, custom naming, visibility, and ACT emotion routing by maintaining up to 6 loosely coupled arrays and dictionaries:
1. `expressions: string[]` — Raw blendshape/parameter list.
2. `motions: string[]` — Raw motion/animation file list.
3. `emotionMappings: Record<string, string>` — **Overloaded core**: written as `rawKey -> displayLabel` by user pencil edits and curation, written as `rawKey -> actSlot` by ACT dialog, and written as `actSlot -> rawKey` (inverted) by onboarding starter commit.
4. `motionMappings: Record<string, string>` — `rawKey -> displayLabel` for animations.
5. `hiddenExpressions: string[]` & `hiddenMotions: string[]` — Negative visibility lists (denylist).
6. `favoriteExpressions: string[]` — Display-only star toggles with zero behavioral consequence.

This caused severe architectural degradation:
- **Synchronization Drift**: A blendshape deleted or renamed in a model file left orphaned entries across `emotionMappings`, `favoriteExpressions`, and `hiddenExpressions`.
- **Denylist Hazards for AI**: Denylists default to "allow all". A 300-morph rig with 10 hidden items leaks 290 obscure physics/debug bones into AI decision gates.
- **UI Confusion**: `ModelCustomizer` had an Eye icon (hide) and a Star icon (favorite) fighting each other with no clear source of truth.
- **Cache Pollution**: Stale, corrupted mapping shapes were serialized to IndexedDB with no way to verify correctness.

### The Solution: The Unified Capability Model
We kill **all 6 legacy mapping fields** and replace them with two strongly-typed capability catalogs directly on `DisplayModelFile`:
* `expressionCapabilities: ModelCapabilityItem[]`
* `motionCapabilities: ModelCapabilityItem[]`

Where each capability is a self-contained unit:
```typescript
export interface ModelCapabilityItem {
  rawKey: string // Physical rig identifier (e.g., "Fcl_ALL_Joy", "ParamMouthOpen", "Motions_A10_0")
  label: string // Clean human-readable display label (e.g., "Joy", "Wave Hello")
  usable: boolean // Is this enabled in the model's usable palette?
}
```

---

## 2. The 4-Stage Lifecycle Boundary

```
[3D Model Rig File (.vrm, .zip, .pmx)]
                │
                ▼
1. RAW          Introspected blendshapes/parameters (GLTF/ZIP walk)
                │
                ▼
2. NOISE-LESS   Deterministic noise gate (`filterCandidateExpressions`) runs during ingestion.
                Noise/physics/viseme morphs auto-flagged `usable: false`.
                Usable emote candidates auto-flagged `usable: true`.
                │
                ▼
3. USABLE       MODEL LEVEL: `model.expressionCapabilities` & `model.motionCapabilities`
                Curated palette of working expressions/motions for this avatar rig.
                Configured via `ModelCustomizer` (usable toggle + label pencil).
                │
                ▼
4. ALLOWABLE    CARD LEVEL: `card.extensions.airi.acting.cueAllowlist`
                Character-specific subset chosen from the avatar's usable set.
                Maps runtime ACT tokens to raw keys: `token -> { rawKey, label }`.
```

---

## 3. Data Schema Specifications

### 3.1 Model Level (`DisplayModelFile` & `DisplayModelURL`)
**Location**: `packages/stage-ui/src/stores/display-models.ts`

```typescript
export interface ModelCapabilityItem {
  rawKey: string
  label: string
  usable: boolean
}

export interface DisplayModelFile {
  id: string
  format: DisplayModelFormat
  type: 'file'
  file: File
  name: string
  previewImage?: string
  importedAt: number
  nsfw?: boolean
  groups?: string[]
  tags?: string[]

  // NEW CAPABILITY ARRAYS (Source of Truth)
  expressionCapabilities?: ModelCapabilityItem[]
  motionCapabilities?: ModelCapabilityItem[]

  // KILLED FIELDS (Completely removed):
  // expressions?: string[]
  // motions?: string[]
  // emotionMappings?: Record<string, string>
  // motionMappings?: Record<string, string>
  // favoriteExpressions?: string[]
  // hiddenExpressions?: string[]
  // hiddenMotions?: string[]

  outfits?: AiriOutfit[]
  _searchKey?: string
}
```

### 3.2 Character Card Level (`AiriCard.extensions.airi.acting`)
**Location**: `packages/ccc/src/define/card.ts` & `docs/data-catalog.md`

Rename `compiledWhitelist` to `cueAllowlist` (or `autoCues`):
```typescript
export interface CharacterCueAllowlist {
  version: 1
  emotions?: Record<string, { rawKey: string, label: string }>
  motions?: Record<string, { rawKey: string, label: string }>
}

export interface ActingConfig {
  modelExpressionPrompt: string
  speechExpressionPrompt: string
  speechMannerismPrompt: string
  idleAnimations?: string[]
  cueAllowlist?: CharacterCueAllowlist
  autoCuesEnabled?: boolean
  autoCueExpressions?: boolean
  autoCueMotions?: boolean
}
```

---

## 4. Ingestion & Invalidation Strategy

### 4.1 Strict Invalidation (No Backward Compatibility Shims)
Per the repository's core guidelines (*"Do not add backward-compatibility guards or shims unless the task explicitly requires extended support"*), we do not attempt to patch corrupt legacy IndexedDB caches.

1. **Detection**: `getOrLoadModelCapabilities(id)` checks for `model.expressionCapabilities`.
2. **Auto Re-Ingest**: If `expressionCapabilities` is undefined, the loader fetches the stored `File`/`Blob`, extracts raw morphs from scratch, runs the noise filter, and immediately saves the clean `ModelCapabilityItem[]` back to IndexedDB.
3. **Pristine State**: Every model in IndexedDB is automatically converted to the new schema cleanly on next load without brittle migration translation layers.

### 4.2 Automated Noise Gating on Ingestion
When a file is first parsed in `getOrLoadModelCapabilities`:
```typescript
const gateResult = filterCandidateExpressions(rawKeys)

const expressionCapabilities: ModelCapabilityItem[] = rawKeys.map((rawKey) => {
  const isCandidate = gateResult.candidates.includes(rawKey)
  const resolvedLabel = resolveDefaultLabel(rawKey) // Live2D translator, lexicon, or clean base
  return {
    rawKey,
    label: resolvedLabel,
    usable: isCandidate, // Candidates start true, noise/bones start false
  }
})
```

---

## 5. UI Impact & Simplification

### 5.1 `ModelCustomizer.vue`
The UI simplifies drastically:
1. **Remove Dual Star & Eye Icons**:
   - Delete `favoriteExpressions` star toggle.
   - Delete `hiddenExpressions` eye toggle.
2. **Single Usable Toggle Switch**:
   - Each row has an enable/disable switch bound directly to `item.usable`.
3. **Filter Header**:
   - Tab 1: **Usable** (`items.filter(i => i.usable)`) — Default view.
   - Tab 2: **All** (`items`) — Shows everything, with visual badge on enabled items.
4. **Pencil Label Editor**:
   - Directly updates `item.label`.

### 5.2 Card Editor Acting Tab (`CardCreationTabActing.vue`)
1. **Collapsible Reference Sections**:
   - Grouped tabs below prompt: **Expressions | Motions | VFX**.
   - Default view shows the avatar's `usable` items only.
2. **Auto-Cues Section**:
   - Master switch: Enable Auto-Cues (default OFF until curated).
   - Source badges: Showing that decisions read Personality, Description, and Acting Directives.
   - Granular toggles: `autoCueExpressions` (Yes/No), `autoCueMotions` (Yes/No).

---

## 6. Monorepo Consumer Audit & Touchlist

### 1. Core Stores & Libs
- `packages/stage-ui/src/stores/display-models.ts`:
  - Update `DisplayModelFile` and `DisplayModelURL` interfaces.
  - Update `updateDisplayModelMappings` -> `updateDisplayModelCapabilities`.
  - Update `getOrLoadModelCapabilities` to produce `ModelCapabilityItem[]`.
- `packages/stage-ui/src/stores/sync-engine.ts`:
  - Update sync merge rules to merge `expressionCapabilities` and `motionCapabilities` by `rawKey`.
  - Delete legacy merge steps for `emotionMappings`, `motionMappings`, `favoriteExpressions`, `hiddenExpressions`, `hiddenMotions`.

### 2. UI Components
- `packages/stage-ui/src/components/scenarios/settings/model-settings/ModelCustomizer.vue`:
  - Refactor `rawExpressions` and `rawMotions` computed properties to directly use `expressionCapabilities` and `motionCapabilities`.
  - Delete star, eye, and ACT mapping modal handlers.
- `packages/stage-ui/src/components/scenarios/acting/EmotionCalibrationStudio.vue`:
  - Update candidate intake to read from `expressionCapabilities.filter(e => e.usable)`.
  - Output to card `cueAllowlist`.
- `packages/stage-pages/src/pages/settings/airi-card/components/CardEditorForm.vue`:
  - Point capability lists to `expressionCapabilities`.

### 3. Avatar Renderers & Controllers
- `packages/stage-ui-three/src/components/Model/VRMModel.vue`:
  - Remove `watch(modelStore.emotionMappings)`.
  - ACT routing is resolved by token lookup against `cueAllowlist`, dispatching raw expression keys directly.
- `packages/stage-ui-live2d/src/stores/live2d.ts`:
  - Remove local storage `emotionMappings`.
- `packages/stage-ui/src/components/scenes/ControlStripHost.vue`:
  - Update motion label lookups to read `motionCapabilities`.
