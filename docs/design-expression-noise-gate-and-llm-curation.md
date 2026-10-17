# Design & Architecture: Model Expression Noise Gate & LLM Curation Pipeline

This document defines the architecture, taxonomy, and implementation for the **Model Expression Noise Gate & LLM Curation Pipeline** in AIRI.

---

## 1. Problem Context & Motivation

When users import 3D and 2D avatar models (VRM, PMX/MMD, Live2D, Spine) into AIRI, the avatar files typically contain dozens to hundreds of low-level blendshapes and morph targets. In an empirical audit across **907 avatar models** (33,151 total blendshape instances):

1. **High Ratio of Procedural Rig Noise (~68%)**:
   - Over **68%** of raw blendshapes are internal motion-tracking channels: Apple ARKit 52 FACS tracking keys (`eyeBlinkLeft`, `jawOpen`, `mouthSmileRight`), speech visemes (`a`, `i`, `u`, `e`, `o`), directional gaze/eye-look morphs (`LookUp`, `カメラ目線`, `瞳上`), eyelid/eyelash adjustments, teeth/jaw mechanisms, and generic numeric indices (`take01`, `blendshapeclip#40`).
   - Exposing these raw procedural tracking channels in `ModelCustomizer.vue` overwhelms users with UI clutter and wastes LLM context window tokens.

2. **Foreign Language & Technical Naming**:
   - The remaining ~26% of high-value expressive morphs are predominantly named in Japanese (Kanji, Hiragana, Katakana, e.g. `ジト目`, `ドヤ`, `照れ`, `うるうる`, `赤面`), Chinese (Simplified/Traditional, e.g. `星星眼`, `猫猫嘴`, `氣憤`, `嫌棄`), or cryptic DCC tool abbreviations (e.g. `Mouth_23_0(TalkA_A_S)[M_Face]`, `fcl_eye_joy`).
   - Users and LLM acting agents generating `<|ACT:emotion="..."|>` tags cannot intuitively determine what emotions a model supports without manual inspection and translation.

---

## 2. Architectural Solution: Two-Tiered Pipeline

Instead of hardcoding models into fixed, proprietary emotional buckets, AIRI employs an open, two-tiered pipeline:

```text
                      Raw Model Avatar (VRM / PMX / Live2D / Spine)
                         (50 - 150+ Raw Blendshapes / Morphs)
                                     │
                                     ▼
      ┌─────────────────────────────────────────────────────────────┐
      │  TIER 1: Static Deterministic Noise Gate (<5ms, 0 LLM Cost)  │
      ├─────────────────────────────────────────────────────────────┤
      │  • ARKit 52 FACS Filter (Mouth/Eye/Jaw tracking)            │
      │  • Viseme & Phoneme Filter (Speech lip-sync channels)       │
      │  • Procedural Rig Morphs (Gaze, Blinks, Highlights, Teeth)   │
      │  • Base / Neutral Poses & Numeric Index Noise               │
      │  • Wardrobe / Prop Mesh Toggles (Auto-routed to Outfits)    │
      └──────────────────────────────┬──────────────────────────────┘
                                     │
                 Candidate Emotes + Unclassified Remainder
                     (~15 - 50 Candidates per Model)
                                     │
                                     ▼
      ┌─────────────────────────────────────────────────────────────┐
      │  TIER 2: Sparkle AI 3-Step Curation Wizard (Modal)          │
      │           ("✨ Auto-Curate (AI)" 3-Step Modal)              │
      ├─────────────────────────────────────────────────────────────┤
      │  Step 1: Scope & Persona Context (Respects User 👁️ Hides)   │
      │  Step 2: Pass A — LLM Translation, Token Slug & Rejection   │
      │          + Interactive Review Table & Live 1-Click Preview  │
      │  Step 3: Pass B — Dedicated Acting Directive Prompt Engine  │
      │          (Sparkle AI Synthesis for all Curated Tokens)      │
      └──────────────────────────────┬──────────────────────────────┘
                                     │
                                     ▼
      ┌─────────────────────────────────────────────────────────────┐
      │  EXISTING PIPELINE: End-to-End Execution (Already Wired!)   │
      ├─────────────────────────────────────────────────────────────┤
      │  • DisplayModelFile.emotionMappings saved in IndexedDB      │
      │  • AiriExtension.acting.modelExpressionPrompt populated     │
      │  • LLM emits <|ACT:emotion="smug"|> in natural conversation │
      │  • Marker Parser ➔ ControlStripHost ➔ vrmStore / live2dStore│
      └─────────────────────────────────────────────────────────────┘
```

---

## 3. Tier 1: Static Deterministic Noise Gate

The Tier 1 classifier (`packages/stage-ui/src/libs/character/expression-noise-gate.ts`) runs synchronously on the client side at zero inference cost. It categorizes raw morphs into seven deterministic bins:

| Category | Typical Keys / Patterns | Pipeline Action |
|---|---|---|
| **ARKit 52 Primitives** | `eyeBlinkLeft`, `jawOpen`, `mouthSmileRight`, `browDownLeft` | Hidden from expression list; reserved for live mocap/tracking. |
| **Visemes & Phonemes** | `a`, `i`, `u`, `e`, `o`, `あ`, `い`, `う`, `え`, `お`, `sil`, `ff`, `th` | Hidden from expression list; reserved for TTS audio lip-sync. |
| **Procedural Rig Channels** | `LookUp`, `カメラ目線`, `瞳上`, `まばたき`, `ウィンク`, `ハイライト消し`, `teeth_short` | Hidden from expression list; driven by procedural look-at & blink loops. |
| **Neutral / Index Noise** | `neutral`, `default`, `基本セット`, `take01`, `blendshapeclip#40` | Hidden from expression list. |
| **Wardrobe / Props** | `glasses`, `jacket`, `dress`, `costume`, `twintail`, `メガネ`, `制服`, `帽子` | Routed to Modular Outfits / Mesh Toggle manager. |
| **High-Signal Emotes** | `joy`, `angry`, `ドヤ`, `ジト目`, `照れ`, `星星眼`, `猫猫嘴`, `>_<` | **Passed to Tier 2 Candidate List**. |
| **Unclassified Leakage** | Edge cases and unrecognized morph strings | **Passed to Tier 2 Candidate List** (safeguard against false negatives). |

### Empirical Verification Baseline
Benchmarked against all **907 VRM & PMX models** in the asset library, the Tier 1 classifier achieves:
- **99.5% accuracy** (32,984 of 33,151 blendshape instances classified deterministically).
- **68.3% noise reduction**, filtering ~22,650 low-level tracking targets without dropping genuine expressive morphs.

---

## 4. Tier 2: Sparkle AI 3-Step Curation Wizard

Leveraging AIRI's established **Sparkle AI** pattern (consistent with `FieldAiGeneratorModal.vue` and the Rehearsal Room), the curation workflow operates as an intuitive 3-step guided modal triggered via the `"✨ Auto-Curate (AI)"` action banner in `<ModelCustomizer />`.

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │ ✨ Auto-Curate Model Expressions & Acting Directives                   │
 ├────────────────────────────────────────────────────────────────────────┤
 │  [ 1. Scope & Persona ] ──▶ [ 2. Review & Preview ] ──▶ [ 3. Apply & Save ] │
 └────────────────────────────────────────────────────────────────────────┘
```

### Step 1: Smart Scope & Persona Context
- **Scope Selection**:
  1. **Active Visible (Recommended)**: Evaluates the currently visible working set, respecting active noise filtering and user manual hides (via the 👁️ eye toggle in `ModelCustomizer.vue`).
  2. **All Unhidden**: Evaluates all unhidden morphs including procedural tracking noise.
  3. **Full Raw Model**: Full raw blendshape dump from the avatar file.
- **Preservation Principle**: Any morphs previously renamed by the user (`displayName !== key`) are flagged and prioritized so the LLM respects and preserves the user's custom naming intent.
- **Character Persona Injection**: Injects the active companion's Name, Personality, Description, and Scenario to provide emotional and tonal context for curation.

### Step 2: Pass A — LLM Translation, Token Slugging & Live Stage Preview
- **LLM Pass A (`curateExpressions`)**: Invokes structured JSON output via `llmStore.generateObject`.
- **Rejection Gate ("The Out")**: The LLM prompt explicitly instructs the model to inspect candidate keys and **reject non-emotional tracking/rig shapes** (`0.up`, `1.down`, `10.中`, `mouth_open`, bone tweaks) with `shouldSkip: true` and a brief `skipReason`.
- **Translation & ACT Token Synthesis**: For valid morphs, the LLM:
  1. Translates foreign/technical keys into concise English display labels (`ジト目` ➔ `Half-closed Scorn`).
  2. Generates slug-cased ACT token identifiers (`smug_scorn`) for `<|ACT:emotion="..."|>`.
  3. Assigns emotional categories (`happy`, `angry`, `sad`, `surprised`, `smug`, `blush`, `special`, `relaxed`, `other`).
- **Interactive Review Table**:
  - Displays Raw Morph, Display Label (editable), ACT Action Token (editable), Category badge, Live 1-Click Preview button (👁️), and Status toggle (`Active` / `Skipped`).
  - **Live Stage Preview**: Clicking the eye icon immediately dispatches a live preview to the active stage (`modelStore.triggerEmotion` for VRM, `live2dStore.triggerEmotion` for Live2D, `mmdStore.previewExpression` for MMD, and `spineStore.selectVariantAndSkin` for Spine).

### Step 3: Pass B — Dedicated Acting Directive Prompt Engine & Persistence
- **Dedicated 2nd LLM Pass (`generateActingPrompt`)**: When transitioning from Step 2 to Step 3, a dedicated LLM generation pass runs using the **finalized user-reviewed list of all active curated tokens** (e.g., all 42 active tokens).
- **Sparkle AI Prompt Alignment**: Reuses the canonical `FieldAiGeneratorModal.vue` actor manager template:
  - Enforces official Short Format syntax: `<|ACT:emotion="expression_name"|>`.
  - Categorizes all available emotion tokens and teaches default character tone vs rare/peak moments tailored to their specific persona.
  - Generates in-character dialogue examples demonstrating natural token placement.
  - Includes a **"Regenerate Directives"** action to re-prompt or refine.
- **Persistence & Auto-Clean**:
  - **Model Mappings (`displayModelsStore`)**: Saves curated `emotionMappings` and auto-hides skipped/noise morphs in `hiddenExpressions`.
  - **Card Acting Directives (`airiCardStore`)**: Writes the generated acting instructions directly into `activeCard.extensions.airi.acting.modelExpressionPrompt`.

---

## 5. End-to-End Execution Architecture (Already Built)

Because AIRI's downstream ACT token execution chain is already fully implemented, completing Tier 1 and Tier 2 immediately activates end-to-end model acting:

1. **System Prompt Injection**: `airi-card.ts` injects `acting.modelExpressionPrompt` into the system prompt.
2. **Chat Stream Emission**: The LLM emits `<|ACT:emotion="smug_scorn"|>` at emotional peaks.
3. **Marker Parser**: `useLlmmarkerParser` detects special tokens mid-stream and strips them from the audio TTS speech category.
4. **ControlStrip Host Dispatch**: `ControlStripHost.vue` special-token queue triggers `vrmStore.triggerEmotion("smug_scorn")` / `live2dStore.triggerEmotion("smug_scorn")`.
5. **Renderer Resolution**: The renderer looks up `"smug_scorn"` in `DisplayModelFile.emotionMappings`, resolving to the raw blendshape (`ジト目`) and transitioning the avatar's face on stage.

---

## 6. Multi-Format Scope & Roadmap

### Primary Focus (Implemented & Active): VRM & PMX / MMD
- **VRM 0.x / 1.0**: BlendShapeGroups and Expressions extracted via glTF header parsing.
- **PMX / MMD**: Morph targets (vertex morphs, material morphs, bone morphs) parsed via MMD loader.

### Future Expansion: Live2D & Spine
The exact same two-tiered architecture translates cleanly to 2D formats:
- **Live2D Cubism**:
  - *Tier 1 Noise Gate*: Filters out tracking parameter channels (`ParamEyeLOpen`, `ParamEyeROpen`, `ParamMouthForm`, `ParamAngleX/Y/Z`, `ParamBodyAngleX/Y/Z`).
  - *Candidate Source*: Extracts named `.exp3.json` expression files and motion cue targets (`start_mtn`, `change_cos`).
  - *Tier 2 Curation*: Maps Japanese expression names (e.g. `f01_smile.exp3.json`, `怒り.exp3.json`) to standard ACT tokens and English labels.
- **Spine 2D**:
  - *Tier 1 Noise Gate*: Filters standard IK bone channels, idle breath slots, and root transform tracks.
  - *Candidate Source*: Extracts named animation clips (e.g. `emote_blush`, `reaction_shock`) and skin attachments.
  - *Tier 2 Curation*: Maps animation track names to standard ACT action cues.

---

## 7. Implementation Index

| Component | Target File | Purpose |
|---|---|---|
| **Tier 1 Classifier** | `packages/stage-ui/src/libs/character/expression-noise-gate.ts` | Static regex/set classification for ARKit, visemes, rig morphs, emotes. |
| **Unit Test Suite** | `packages/stage-ui/src/libs/character/expression-noise-gate.test.ts` | 16-test suite validating 99.5% accuracy baseline against benchmark dataset. |
| **Model Customizer UI** | `packages/stage-ui/src/components/scenarios/settings/model-settings/ModelCustomizer.vue` | 2-row Auto-Curate banner, noise filter toggle, dynamic count badges. |
| **AI Composable** | `packages/stage-ui/src/composables/use-expression-curation.ts` | Pass A (morph curation & rejection gate) + Pass B (Sparkle AI prompt synthesis). |
| **3-Step Wizard Modal** | `packages/stage-ui/src/components/scenarios/dialogs/ExpressionCurationModal.vue` | Scope selector, interactive review with live stage preview, directive editor. |
| **Downstream Execution** | `packages/stage-ui/src/stores/display-models.ts`<br>`packages/stage-ui/src/stores/modules/airi-card.ts` | Persists `emotionMappings`, `hiddenExpressions`, and `acting.modelExpressionPrompt`. |
