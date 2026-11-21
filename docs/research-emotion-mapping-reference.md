<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Research: Emotion / Expression Mapping Reference (bead `airi-wxp.4.8`)

**Status:** reference study · **Date:** 2026-11-21 · **Source HEAD:** `bad8fc69`
**Scope:** READ-ONLY survey of the TypeScript stack's emotion/expression machinery so the Godot 4 pet can re-derive the *knowledge* natively.
**Guidance honored:** "study the TS glue's emotion mappings as reference; don't port the glue." This document extracts semantics, vocabularies and payload shape. It does **not** propose transplanting TS parser/store/VM code into Godot.

The authoritative pivot contract is [`design-flutter-godot-pivot.md`](./design-flutter-godot-pivot.md): decision 4 already states that "the TypeScript avatar-driving glue (ACT token parsing, expression dispatch, Stage UI context bridge, BroadcastChannel expression relays) does not need porting — the daemon emits high-level events (lip-sync RMS, emotion tags, acting cues) that Godot maps into its animation state; this removes bridge boilerplate, not the event→animation mapping" (`docs/design-flutter-godot-pivot.md:67`); invariant 4 puts expression/pose mapping in Godot plugins and names `crates/anima-render/src/vrm/lipsync.rs` as the smoothing reference (`docs/design-flutter-godot-pivot.md:136-140`). Wave 0 already sketches `emotion.tag — { actor_id, tag, intensity, seq, ts_ms }` (`docs/design-flutter-godot-pivot.md:260-268`).

> **Concurrency note:** at the surveyed HEAD, `crates/anima-channel/src/wire.rs` is a **pre-existing dirty file** (Wave-0 event lane being added by another worker). I read it but did not modify it. The `EmotionTagData` shape quoted in §3.6 is the *in-progress* shape, not a stable contract.

---

## 0. Vocabulary sizes at a glance

| Vocabulary | Count | Source |
|---|---|---|
| Canonical emotion keys (prompt/stage-ui enum) | **10** | `packages/stage-ui/src/constants/emotions.ts:1-12` |
| Renderer-shared emotion keys (Live2D / MMD / Spine enums) | **9** (no `cool`) | `packages/stage-ui-live2d/src/constants/emotions.ts:1-11`, `packages/stage-ui-mmd/src/constants/emotions.ts:7-17` |
| Marker families in the LLM output grammar | **4** (`ACT`, `DELAY`, `ACTOR`, `STICKER`) | `packages/stage-ui/src/composables/queues.ts:133-168`, `packages/stage-ui/src/constants/prompts/character-defaults.ts:51-61` |
| Named elemental VFX cues | **4** (`fire`, `electric`, `magic`, `verdant`) | `packages/stage-ui/src/constants/prompts/character-defaults.ts:26-31` |
| ACT payload kinds emitted by the parser | **3** (`emotion`, `motion`, `vfx`) | `packages/stage-ui/src/constants/emotions.ts:53-58`, `packages/stage-ui/src/composables/queues.ts:69-75,113-121` |
| Live2D DSL command opcodes | **10** | `packages/live2d-runtime/src/dsl/types.ts:91-127` |
| VarFloat ops | **7 conditions + 4 mutations** | `packages/live2d-runtime/src/dsl/var-store.ts:14-18` |
| Beat-sync motion styles | **4** | `packages/stage-ui-live2d/src/composables/live2d/beat-sync.ts:53-69` |

---

## 1. Emotion / cue vocabulary

### 1.1 The canonical emotion keys and what each renderer does with them

The "canonical" list is the one taught to the LLM: **happy / sad / angry / surprised / think / awkward / question / curious / neutral / cool** (`packages/stage-ui/src/constants/prompts/character-defaults.ts:13-15`). The same 10 values are the `Emotion` enum (`packages/stage-ui/src/constants/emotions.ts:1-12`) and are injected into the system prompt with motion-name glosses (`packages/stage-ui/src/constants/prompts/system-v2.ts:3-15`). The three renderer packages share a 9-value enum without `cool` (`packages/stage-ui-live2d/src/constants/emotions.ts:1-11`, `packages/stage-ui-mmd/src/constants/emotions.ts:7-17`; Spine mirrors it per `packages/stage-ui-spine/src/constants/emotions.ts:56-66`).

Numeric weights below are the *full-weight targets* before the intensity multiplier; `blendDuration` is the cross-fade seconds.

| Tag | Meaning | VRM morph targets (weight, blend s) | Live2D | MMD morph targets (weight, blend s) | Spine |
|---|---|---|---|---|---|
| `happy` | joy | `happy` 0.7 + `aa` 0.2, 0.4 (`packages/stage-ui-three/src/composables/vrm/expression.ts:46-52`) | `.exp3` via mapping → cluster `happy/smile/joy/laugh/glad/fun/喜/笑` (`packages/stage-ui-live2d/src/stores/live2d.ts:267-276`) | `smile` 0.8 + `vowelA` 0.2, 0.4 (`packages/stage-ui-mmd/src/constants/morphs.ts:86-89`) | `Happy` animation (`packages/stage-ui-spine/src/constants/emotions.ts:57`) |
| `sad` | sorrow | `sad` 0.7 + `oh` 0.15, 0.4 (`packages/stage-ui-three/src/composables/vrm/expression.ts:53-59`) | cluster `sad/cry/tear/sorrow/depressed/泣/悲` (`packages/stage-ui-live2d/src/stores/live2d.ts:270`) | `sad` 0.75 + `troubled` 0.3, 0.4 (`packages/stage-ui-mmd/src/constants/morphs.ts:90-93`) | `Sad` (`:58`) |
| `angry` | anger | `angry` 0.7 + `ee` 0.3, 0.3 (`packages/stage-ui-three/src/composables/vrm/expression.ts:60-66`) | cluster `angry/anger/mad/frown/disgust/upset/hate/怒` (`packages/stage-ui-live2d/src/stores/live2d.ts:269`) | `anger` 0.8, 0.3 (`packages/stage-ui-mmd/src/constants/morphs.ts:94-97`) | `Angry` (`:59`) |
| `surprised` | shock | `surprised` 0.8 + `oh` 0.4, 0.15 (`packages/stage-ui-three/src/composables/vrm/expression.ts:67-73`) | cluster `surprise/shock/gasp/驚` (`packages/stage-ui-live2d/src/stores/live2d.ts:271`) | `surprise` 0.8 + `vowelO` 0.4, 0.15 (`packages/stage-ui-mmd/src/constants/morphs.ts:98-101`) | `Surprise` (`:61`) |
| `think` | contemplation | `think` 0.7, 0.5 (`packages/stage-ui-three/src/composables/vrm/expression.ts:80-85`) | cluster `think/confused/what/困/思` (`packages/stage-ui-live2d/src/stores/live2d.ts:274`) | `troubled` 0.5 + `serious` 0.4, 0.5 (`packages/stage-ui-mmd/src/constants/morphs.ts:102-105`) | `Think` (`:60`) |
| `awkward` | embarrassment | no dedicated preset; falls through to raw-expression resolution (`packages/stage-ui-three/src/composables/vrm/expression.ts:45-92`, `:147-159`) | cluster `blush/shy/embarrass/red/照/恥` (`packages/stage-ui-live2d/src/stores/live2d.ts:272`) | `troubled` 0.6 + `smile` 0.2, 0.4 (`packages/stage-ui-mmd/src/constants/morphs.ts:106-109`) | `Awkward` (`:62`) |
| `question` | querying | no dedicated preset; raw resolution (`packages/stage-ui-three/src/composables/vrm/expression.ts:45-92`) | same `think` cluster (`packages/stage-ui-live2d/src/stores/live2d.ts:274`) | `troubled` 0.4 + `surprise` 0.2, 0.4 (`packages/stage-ui-mmd/src/constants/morphs.ts:110-113`) | `Question` (`:63`) |
| `curious` | inquisitive | no dedicated preset; raw resolution (`packages/stage-ui-three/src/composables/vrm/expression.ts:45-92`) | — (name match / mapping only, `packages/stage-ui-live2d/src/stores/live2d.ts:240-260`) | `surprise` 0.35 + `smile` 0.25, 0.4 (`packages/stage-ui-mmd/src/constants/morphs.ts:114-117`) | `Curious` (`:65`) |
| `neutral` | baseline / reset | `neutral` 1.0, 0.6 (`packages/stage-ui-three/src/composables/vrm/expression.ts:74-79`) | immediate flush of all active expressions (`packages/stage-ui-live2d/src/stores/live2d.ts:227-238`) | no influences, 0.6 (`packages/stage-ui-mmd/src/constants/morphs.ts:118-121`) | `Neutral` (`:64`) |
| `cool` | accessory pose ("Pixel glasses") | `Pixel glasses` 1.0, 0.3 (`packages/stage-ui-three/src/composables/vrm/expression.ts:86-91`) | not in renderer enum (`packages/stage-ui-live2d/src/constants/emotions.ts:1-11`) | not in renderer enum (`packages/stage-ui-mmd/src/constants/emotions.ts:7-17`) | not in renderer enum (`packages/stage-ui-spine/src/constants/emotions.ts:56-66`) |

**Motion names per emotion** (the fallback used when an ACT tag resolves to a *motion* rather than a facial expression): `happy→Happy`, `sad→Sad`, `angry→Angry`, `think→Think`, `surprised→Surprise`, `awkward→Awkward`, `question→Question`, `neutral→Idle`, `curious→Curious`, `cool→Cool` (`packages/stage-ui/src/constants/emotions.ts:16-38`). The system prompt lists these as "Emotion for feeling …" (`packages/stage-ui/src/constants/prompts/system-v2.ts:10-12`).

> **Stale table warning.** `EMOTION_VRMExpressionName_value` (`packages/stage-ui/src/constants/emotions.ts:40-51`; e.g. `awkward→neutral`, `question→think`, `curious→think`) and its Live2D twin (`packages/stage-ui-live2d/src/constants/emotions.ts:37-47`) are **declared but not consumed by the live render path** — only tests reference them (`packages/stage-ui/src/constants/emotions.test.ts:66-69`). The runtime truth is the `emotionStates` map + dynamic raw-expression registration (§2, R3). Do not re-derive Godot behaviour from these dead tables.

### 1.2 ACT marker families and syntax

Two official payload formats coexist deliberately; the marker parser only splits `<| … |>` spans and does not interpret payload syntax (`.agents/skills/airi-acting-cue-act-tokens/SKILL.md:13-20`).

| Marker family | Shape / example | Meaning | Source |
|---|---|---|---|
| ACT short | `<\|ACT:emotion="happy",intensity="0.8",duration="3"\|>` | facial expression with strength and hold | `packages/stage-ui/src/constants/prompts/character-defaults.ts:4-8`, `docs/design-act-token-expression-system.md:9-15` |
| ACT short (motion) | `<\|ACT:motion="wave",duration="4"\|>` | body motion cue | `packages/stage-ui/src/constants/prompts/character-defaults.ts:6` |
| ACT short (combined) | `<\|ACT:emotion="happy",motion="wave",duration="3"\|>` | expression + motion in one cue | `packages/stage-ui/src/constants/prompts/character-defaults.ts:7` |
| ACT short (reset) | `<\|ACT:emotion="neutral"\|>` or `duration="0"` | immediate return to baseline | `packages/stage-ui/src/constants/prompts/character-defaults.ts:8,18`, `docs/design-act-token-expression-system.md:13` |
| ACT JSON chaining | `<\|ACT:{"emotion":{"name":"heart","intensity":1,"duration":3},"motion":"action cue"}\|>` | structured multi-field cue | `packages/stage-ui/src/constants/prompts/character-defaults.ts:10-11`, `docs/design-act-token-expression-system.md:17-23` |
| VFX sub-cue | `<\|ACT:vfx="fire",duration="4"\|>` (also `electric`, `magic`, `verdant`) | elemental aura at emotional peaks (VRM/MMD) | `packages/stage-ui/src/constants/prompts/character-defaults.ts:26-31`, `packages/stage-ui/src/components/scenes/ControlStripHost.vue:255-257` |
| `DELAY` | `<\|DELAY:2\|>` | timed pause before continuing | `packages/stage-ui/src/constants/prompts/character-defaults.ts:17-21`, `packages/stage-ui/src/composables/queues.ts:137-143` |
| `ACTOR` | `<\|ACTOR:{actorId}\|>` | multi-actor routing at playback time | `.agents/skills/airi-acting-cue-act-tokens/SKILL.md:22-25`, `packages/stage-ui/src/composables/queues.ts:155-160` |
| `STICKER` | `<\|STICKER id\|>` | inline reaction sticker (chat-side, not an avatar morph) | `packages/stage-ui/src/constants/prompts/character-defaults.ts:51-61`, `packages/stage-ui/src/composables/queues.ts:173-181` |
| Speech tags (sibling system) | `[whisper]`, `*sigh*`, mood-tag TTS, Dynamic Caption FX | TTS delivery shaping — **not** ACT markers | `packages/stage-ui/src/constants/prompts/character-defaults.ts:34-49`, `.agents/skills/airi-acting-cue-act-tokens/SKILL.md:5,90` |

Parser leniency that mattered *to the TS reference implementation* (and must be remembered only as evidence of real-world card prompts, not ported): legacy bare-`>` close for `<|ACT`/`<|DELAY`/`<|LLM_` only, curly-close normalization, escaped delimiters — `.agents/skills/airi-acting-cue-act-tokens/SKILL.md:27-37`. The dual storage keys `content` (stripped for display) vs `rawContent` (full, replayed into inference) are documented at `.agents/skills/airi-acting-cue-act-tokens/SKILL.md:51-60`; replaying stripped `content` is the #1 cause of the model "forgetting" to emit cues.

### 1.3 Model-specific (non-canonical) vocabularies

Names outside the canonical enum **pass through as raw strings** (`packages/stage-ui/src/composables/queues.ts:12-20`; `docs/design-act-token-expression-system.md:66-69`). This is how model-specific expressions work. Examples from the Satoimo VRM: 94 expressions total — presets `Neutral`, `A/I/U/E/O`, `Blink`, `Blink_L/R`, `Angry`, `Fun`, `Joy`, `Sorrow`, `Surprised`; customs `heart`, `star_eyes`, `x_eyes`, `small_x_eyes`, `shocked_eyes`, `arrow_eyes`, `crying`, `heartbroken`, `scared`, `exclamation`, `speechless`, `sweating`, `anger`, `sleepy`, `question`, `gloomy`, `music`, `cat_mouth`; accessory toggles `glasses`, `pixel_glasses`, `pixel_glasses_up/down`, `uniform`, `nightgown` (`docs/design-act-token-expression-system.md:96-107`).

Backend naming conventions extracted from source:

- **VRM**: raw blendshape keys; `normalizeVrmKey` strips prefixes `Face.M_F00_000_00_Fcl_`, `Fcl_`, `vrc.v_`, `ARKit_BS.` and title-cases (`.agents/skills/airi-model-customizer/SKILL.md:102`).
- **Live2D**: Cubism `.exp3` filenames / parameter IDs / motion group IDs; `<|ACT:emotion="… "|>` uses the *display name* after user rename (`.agents/skills/airi-model-customizer/SKILL.md:103,112-113`).
- **MMD**: logical slots `vowelA/I/U/E/O`, `blink`, `blinkLeft/Right`, `smile`, `anger`, `sad`, `surprise`, `troubled`, `serious`; each resolves to an ordered list of candidate Japanese-then-English morph names (e.g. `vowelA: ['あ','a','A']`, `smile: ['笑い','にこり','わらい','smile','Smile']`) with first-existing-wins (`packages/stage-ui-mmd/src/constants/morphs.ts:14-58`).
- **Spine**: `Variant [Skin]` composite expression keys; motions are skeleton animations (`.agents/skills/airi-model-customizer/SKILL.md:105`).

### 1.4 Non-ACT cue vocabularies that also move the avatar

**Live2D DSL command opcodes** (`packages/live2d-runtime/src/dsl/types.ts:91-127`, parsed in `packages/live2d-runtime/src/dsl/command-parser.ts:46-115`):

| Opcode | Effect relevant to Godot |
|---|---|
| `start_mtn Group[#lane][:item]` | play a body/face motion on a named lane; also dispatches a DSL group if one of that name exists (`packages/live2d-runtime/src/dsl/interpreter.ts:275-282`) |
| `clear_exp` | clear persistent expressions back to base face (`packages/live2d-runtime/src/dsl/interpreter.ts:283-285`) |
| `change_cos <file\|index>` | hot-swap costume/model; **heap and intimacy must survive** (`packages/live2d-runtime/src/dsl/interpreter.ts:286-291`, `packages/live2d-runtime/src/ports.ts:38-49`) |
| `motions enable/disable <group>` | gate a motion pool (`packages/live2d-runtime/src/dsl/interpreter.ts:292-295`) |
| `mouse_tracking`, `eye_blink` | gaze/blink toggles (`packages/live2d-runtime/src/dsl/interpreter.ts:296-301`) |
| `stop_sound`, `replace_tex`, `hit_areas`, `noop` | audio/texture/hit-area control (`packages/live2d-runtime/src/dsl/interpreter.ts:302-313`) |

Note: the `airi-live2d-dsl-interpreter` skill also mentions `set_param` (`.agents/skills/airi-live2d-dsl-interpreter/SKILL.md:15`), but the source command enum has no such opcode (`packages/live2d-runtime/src/dsl/types.ts:91-127`; grep found no `set_param` in `packages/live2d-runtime/src`). Source wins — do not design for it.

**VarFloats heap**: guards `equal / not_equal / greater / greater_equal / less / lower / lower_equal`, mutations `assign / add / subtract / init` (`packages/live2d-runtime/src/dsl/var-store.ts:14-18`); `assign rand(min,max)` is an inclusive-integer roll (`:58-63`); entry application is atomic — all guards pass before any mutation (`:135-154`). This is literally the dating-sim intimacy/affinity state (`docs/design-live2d-dsl-interpreter-spec.md:30-86,203-220`).

**Beat-sync styles** (head motion on musical beats, not emotion): `punchy-v`, `balanced-v`, `swing-lr`, `sway-sine`, with BPM-driven auto-shift (`packages/stage-ui-live2d/src/composables/live2d/beat-sync.ts:53-69,187-208`); the cross-window trigger is `BroadcastChannel('airi::beat-sync')` (`packages/stage-shared/src/beat-sync/eventa.ts:21-31`) carrying `AnalyserBeatEvent` (`packages/stage-shared/src/beat-sync/types.ts:1-10`).

**Mood/intensity models**: the avatar-facing "emotion tag + intensity" shape also appears in the performance blackboard as `{ tag: null, intensity: 0 }` (`packages/stage-ui-three-performance-runtime/src/blackboard.ts:27-46`). A separate affective model (`valence`/`arousal`, −1..1) exists in `echo-chips` (`packages/stage-ui/src/stores/echo-chips.ts:40-41,372-373`) and `nan0-runtime` (`packages/nan0-runtime/src/types.ts:151-152`); it is *not* currently consumed by the avatar expression path. Treat valence/arousal as an optional future input, not part of the Wave-0 mapping.

---

## 2. Mapping semantics — backend-agnostic rules

These are the rules a Godot implementation can re-derive. They are stated as behaviour, not TS code.

**R1 — Parse to a typed cue, not to a raw string.** An ACT payload yields zero or more `{ name, intensity, duration?, kind }` records where `kind ∈ {emotion, motion, vfx}` (`packages/stage-ui/src/constants/emotions.ts:53-58`; `packages/stage-ui/src/composables/queues.ts:39-78`). Intensity defaults to 1 and is clamped to `[0,1]`; duration defaults to "unset" and must be non-negative (`packages/stage-ui/src/composables/queues.ts:22-37`). A single combined tag expands to multiple records (`packages/stage-ui/src/composables/queues.ts:44-75`).

**R2 — Normalize names before lookup.** If the lowercase name is a canonical key, use the canonical key; otherwise preserve the original casing because it may be a VRMA filename (`packages/stage-ui/src/composables/queues.ts:12-20`). Canonical names are intentionally a *closed* set for teaching but an *open* set for resolution.

**R3 — Resolve in strict precedence: explicit mapping → exact name → case-insensitive name → fuzzy cluster → no-op.**
- Live2D: filename/suffix direct match → `emotionMappings` (fileName→emotion key) → case-insensitive `availableExpressions.name` → keyword clusters → `false` (no-op) (`packages/stage-ui-live2d/src/stores/live2d.ts:240-294`).
- VRM: direct expression name → case-insensitive `expressionMap` scan → dynamic auto-registration of a one-expression preset at blend 0.3 → warning + no-op (`packages/stage-ui-three/src/composables/vrm/expression.ts:109-159`).
- Fallback chain at the dispatch layer: expression → emotion→motion-name map → model `motionCapabilities` ground-truth lookup → no-op (`packages/stage-ui/src/components/scenes/ControlStripHost.vue:286-353`).

**R4 — Separate `kind` before touching morphs.** Unmatched motion cues must **never** be fed to the facial-expression system: the host explicitly skips hallucinated motions like "wiggle ears" rather than treating them as morphs, to avoid renderer warnings and premature clearing of expression reset timers (`packages/stage-ui/src/components/scenes/ControlStripHost.vue:268-276`). VFX keys (`fire/electric/magic/verdant`) route to a VFX trigger, not an expression (`packages/stage-ui/src/components/scenes/ControlStripHost.vue:255-257`).

**R5 — Intensity multiplies a curated full-weight target.** Primary expressions are deliberately 0.7–0.8, not 1.0, to avoid an over-expressive look (`packages/stage-ui-three/src/composables/vrm/expression.ts:41-45`; `packages/stage-ui-mmd/src/constants/morphs.ts:78-84`). Applied weight = `target × clamp(intensity,0,1)` (`packages/stage-ui-three/src/composables/vrm/expression.ts:171,189`; `packages/stage-ui-mmd/src/composables/mmd/expression.ts:66,75-78`).

**R6 — Cross-fade with a fixed-duration ease, not a snap.** `easeInOutCubic` over `blendDuration` (per-emotion, 0.15–0.6 s) from captured current weights to targets (`packages/stage-ui-three/src/composables/vrm/expression.ts:29-35,248-278`; `packages/stage-ui-mmd/src/composables/mmd/expression.ts:9-19,90-106`).

**R7 — Additive safety: only fade what you manage.** On emotion change, zero out only the expressions managed by the *previous* emotion; leave blink, lip-sync and custom overlays untouched (`packages/stage-ui-three/src/composables/vrm/expression.ts:19-25,173-199`; `.agents/skills/airi-character-rendering/SKILL.md:139`). MMD achieves the same by zeroing a fixed `EXPRESSION_SLOTS` set before applying the new influences (`packages/stage-ui-mmd/src/composables/mmd/expression.ts:21-22,68-78`).

**R8 — No-op repeat frames.** Same emotion at same intensity while not transitioning is ignored, avoiding transition restarts (`packages/stage-ui-three/src/composables/vrm/expression.ts:143-145`).

**R9 — Duration means "return to neutral after N seconds".** Both VRM (`setEmotionWithResetAfter`, timeout calls `setEmotion('neutral')`) and MMD (`setEmotion(Emotion.Neutral)`) implement this (`packages/stage-ui-three/src/composables/vrm/expression.ts:202-211`; `packages/stage-ui-mmd/src/composables/mmd/expression.ts:81-88`). Live2D resets per-expression by restoring captured original parameter values and clearing its timer (`packages/stage-ui-live2d/src/stores/live2d.ts:321-352`); default hold is 2 s (`:351`). `neutral` or `duration=0` means flush immediately (`packages/stage-ui-live2d/src/stores/live2d.ts:227-238`; `docs/design-act-token-expression-system.md:13`).

**R10 — Live tracking bypasses the internal blend.** `updateIntensity` synchronizes start and target to the incoming value and stops the transition, so an externally smoothed intensity is followed 1:1 (`packages/stage-ui-three/src/composables/vrm/expression.ts:213-246`). Godot should expose an equivalent "direct set" path for high-rate emotion updates.

**R11 — Blend modes matter for Live2D expressions.** `Add: base + raw*intensity`, `Multiply: base * (raw*intensity)`, `Overwrite: raw*intensity` (`packages/stage-ui-live2d/src/utils/blend-math.ts:10-23`). This is applied per parameter of the `.exp3` (`packages/stage-ui-live2d/src/stores/live2d.ts:321-335`).

**R12 — Cue execution is ordered and single-shot.** The special-token queue processes delay → emotion/motion → actor → sticker in that order (`packages/stage-ui/src/composables/queues.ts:133-168`), and the host guards against executing the same streamed message twice (`:551-557`). For Godot the equivalent invariant is: **one event → one animation transition**, with no second "full message" replay path.

**R13 — Lip-sync is an independent additive channel.** Emotion presets include small vowel accents (`aa`, `oh`, `ee`), but lip-sync owns the vowel slots and overrides them as soon as speech starts (`packages/stage-ui-mmd/src/composables/mmd/expression.ts:30-35`; `docs/design-act-token-expression-system.md:50-58`). Do not let an emotion reset zero the mouth morph loop (`.agents/skills/airi-character-rendering/SKILL.md:139`).

**R14 — Studio expression setters are persistent, not one-frame.** Expression variants set by the Director/Studio are concept-level setters that must survive turn transitions and save/reload; they are not necessarily cosmetic flashes (`.agents/skills/airi-acting-cue-act-tokens/SKILL.md:100-114`; `.agents/skills/airi-director-orchestration/SKILL.md:23-35`). Godot needs a "persistent base expression" layer distinct from transient ACT cues.

---

## 3. Backend-specific notes and the renderer-neutral daemon payload

### 3.1 Live2D (GDCubism in Godot)

Native concepts to reproduce: `.exp3` expression files with per-parameter `Id`/`Value`/`Blend`; parameter IDs such as `ParamMouthOpenY`, `ParamEyeLOpen` etc. mirrored in the store's `defaultModelParameters` (`packages/stage-ui-live2d/src/stores/live2d.ts:36-59`) and set via `coreModel.setParameterValueById` (`:106-115`). Blend semantics per R11. Motion groups carry `#lane` (audio/BGM/ENV channels 0/1/2) and `:item` selectors (`packages/live2d-runtime/src/dsl/command-parser.ts:4-14`; `packages/live2d-runtime/src/ports.ts:22-28`). Costume swap must preserve heap/affinity state (opcode table §1.4). Cubism blend shape IDs are model-authored, so Godot must discover them at load and build the `emotion key → local expression/motion` mapping from the card's metadata, not from a hard-coded table.

### 3.2 VRM (3D)

Native concepts: `expressionManager.expressionMap` keys (preset or custom blendshapes) and weighting via `setValue(name, weight)` (`packages/stage-ui-three/src/composables/vrm/expression.ts:95-99,276`; `packages/stage-ui-three/src/components/Model/VRMModel.vue:1050-1056`). Morph names are arbitrary per model; resolve with direct then case-insensitive match (R3). The curated VRM presets are the `emotionStates` table in §1.1. Accessory morphs (`Pixel glasses`, `glasses`) are binary-ish toggles at 0/1 (`docs/design-act-token-expression-system.md:106-107`).

### 3.3 MMD (3D)

Emotion morph slots and their Japanese-first candidate-name lists are in `packages/stage-ui-mmd/src/constants/morphs.ts:37-58`; standard bone names for gaze (`両目`, `左目`, `右目`, `頭`, `首`) at `:124-136`. Cross-fade engine mirrors VRM (`packages/stage-ui-mmd/src/composables/mmd/expression.ts:24-35`). Vowel slots are lip-sync-owned (`packages/stage-ui-mmd/src/constants/morphs.ts:60-62`).

### 3.4 Spine (2D, for completeness)

Emotion → canonical animation name via `EMOTION_SpineAnimationName_value`, falling back to the raw emotion name and then to whatever animation exists on the loaded skeleton (`packages/stage-ui-spine/src/constants/emotions.ts:50-66`; `packages/stage-ui-spine/src/components/scenes/spine/Model.vue:936-942`). Godot already has its own `AnimationPlayer`; no DSL or animation-manager port is needed.

### 3.5 Lip-sync: two reference algorithms, pick explicitly

1. **Minimal RMS → `aa` morph** (the documented Godot 3D reference): clamp RMS to `[0,1]`; attack snaps weight straight up to RMS; decay subtracts `dt / 0.120` (≈120 ms linear fall) floored at RMS; clamp again (`crates/anima-render/src/vrm/lipsync.rs:3-44`). Cheap, deterministic, testable (`:46-69`).
2. **Full viseme path** used by the Vue reference: wLipSync produces `A/E/I/O/U/S`; map to AEIOU (`S→I`), scale by amplitude `min(vol*0.9,1)**0.7`, blend only winner + runner (runner capped at half), apply exponential attack 50 / release 30 smoothing, cap 0.7, silence thresholds 0.04/0.05 and 160 ms idle (`packages/stage-ui-three/src/composables/vrm/lip-sync.ts:17-44,62-123`); VRM blendshape names `aa/ee/ih/oh/ou` (`:21-27`). `VRMModel.vue` also has a simpler `aa = mouthOpen*0.75` fallback (`packages/stage-ui-three/src/components/Model/VRMModel.vue:766`).

**Recommendation:** keep Wave 0/2 RMS events for the daemon, and reproduce algorithm (1) in Godot for the minimum viable pet. Treat (2) as an optional upgrade that needs *viseme* events (`lip_sync.viseme`) later, not as part of the current payload. Do not promise 30–60 Hz — the in-tree tap is ~15–40 Hz and the design doc explicitly refuses the unverified number (`docs/design-flutter-godot-pivot.md:233`).

### 3.6 Recommended `emotion.tag` payload (renderer-neutral)

The concurrent in-progress Wave-0 struct is `EmotionTagData { actor_id: String, tag: String, intensity: f32, seq: u64, ts_ms: u64 }` (`crates/anima-channel/src/wire.rs:310-325`), carried in a `GatewayEvent { topic, data, id? }` envelope (`:438-460`). Keep those five fields — they satisfy the design-doc sketch (`docs/design-flutter-godot-pivot.md:263`) and the core of R1–R10 (name, intensity, actor, ordering); the two missing pieces for full parity are `duration` and `kind`.

| Field | Type | Why | TS analogue |
|---|---|---|---|
| `actor_id` | string | multi-actor routing without Godot parsing `ACTOR` tokens | `packages/stage-ui/src/components/scenes/ControlStripHost.vue:424-433` |
| `tag` | string | canonical key **or** raw model-specific name; Godot resolves per R3 | `EmotionPayload.name` (`packages/stage-ui/src/constants/emotions.ts:53-58`) |
| `intensity` | f32 `[0,1]` | curated-target multiplier (R5) | `EmotionPayload.intensity` |
| `duration_ms` (optional) | u32 | hold-then-neutral (R9); `0`/absent = transient, never auto-reset | `EmotionPayload.duration` (seconds in TS — normalize to ms at the wire) |
| `kind` (optional enum) | `emotion \| motion \| vfx` | prevents the "motion cue treated as facial morph" bug (R4) | `EmotionPayload.kind` |
| `seq`, `ts_ms` | u64 | ordering and staleness checks for additive channels (R13) | Wave-0 bus fields (`crates/anima-channel/src/wire.rs:319-324`) |

**Deliberately NOT in the payload:** morph/parameter names, `.exp3` filenames, blend modes, ARKit/VRM/MMD identifiers, DSL commands, `NextMtn` chains. Those are renderer facts; Godot derives them from the card's model metadata (§3.1–3.3). This keeps the daemon renderer-neutral per invariant 4 (`docs/design-flutter-godot-pivot.md:136-140`). If the daemon ever wants to express "hold this exact morph", that is a separate additive topic with an explicit `renderer_target` field, not a change to `emotion.tag`.

Cross-window note: the TS relays (`BroadcastChannel('airi-stores-live2d')` in `packages/stage-ui-three/src/stores/model-store.ts:103`, `BroadcastChannel('airi-stores-stage-ui-live2d')` in `packages/stage-ui-live2d/src/stores/live2d.ts:62`, and `airi::beat-sync` in `packages/stage-shared/src/beat-sync/eventa.ts:24`) are **intra-client** plumbing. The pivot explicitly classes them as "not IPC" and replaces cross-client sync with daemon events (`docs/design-flutter-godot-pivot.md:180`). Godot subscribes to the gateway once; it must not join those channels.

---

## 4. "Do NOT port" list

These stay in the reference UI and must be **reimplemented natively in Godot**, not transplanted:

1. **Marker parsing and leniency whitelist** — `llm-marker-parser.ts` delimiter grammar, legacy bare-`>`, curly-close and escape tolerance (`.agents/skills/airi-acting-cue-act-tokens/SKILL.md:27-37`, sources at `:126`). The daemon parses cues for all clients; Godot consumes `emotion.tag`.
2. **`stripMarkers` / `rawContent` vs `content` dual-key** and replay discipline (`.agents/skills/airi-acting-cue-act-tokens/SKILL.md:51-60`; `response-categoriser.ts` at `:127`). Chat persistence is daemon-owned; Godot has no transcript store.
3. **Categorization + streaming hooks + special-token queues** (`response-categoriser.ts`, `useSpecialTokenQueue`, `createQueue`, `onTokenSpecial`; `.agents/skills/airi-acting-cue-act-tokens/SKILL.md:62-71`, `packages/stage-ui/src/composables/queues.ts:133-171`, `packages/stage-ui/src/components/scenes/ControlStripHost.vue:417-440,1784-1789`), including the double-execution guard flags (`:551-557`). One daemon event = one Godot transition.
4. **Host dispatch and renderer stores** — `ControlStripHost.vue` emotion handler (`:247-415`), `useModelStore` / `useLive2d` Pinia stores, their `BroadcastChannel` relays and localStorage keys (`packages/stage-ui-three/src/stores/model-store.ts:103,317-324`; `packages/stage-ui-live2d/src/stores/live2d.ts:62,87-93`). Godot owns its animation state directly.
5. **ModelCustomizer.vue** and all settings/Rehearsal authoring UI (`.agents/skills/airi-model-customizer/SKILL.md:24-32,42-53`). The *mapping knowledge* (which key maps to which ACT slot) must be re-derived as Godot model-profile data; the editor does not move.
6. **The Live2D scripting VM** — `packages/live2d-runtime/src/dsl/{types,interpreter,command-parser,var-store,selector,template}.ts` and the PIXI adapter in `packages/stage-ui-live2d/src/runtime/live2d-runtime-adapter.ts`. If a specific card's manifest genuinely needs creator-scripted interactions, reimplement the *behaviour* (§1.4) in GDScript behind the plugin boundary — do not embed the TS VM. Prefer daemon events for ordinary acting.
7. **VarFloats / intimacy / NextMtn / Choices state machine** (`docs/design-live2d-dsl-interpreter-spec.md:30-86,203-230`; `packages/live2d-runtime/src/dsl/interpreter.ts:206-264`). Relationship state belongs to the daemon if it is needed at all.
8. **Easing/transition engine code** — `useVRMEmote`/`useMMDEmote` composables (`packages/stage-ui-three/src/composables/vrm/expression.ts:1-304`; `packages/stage-ui-mmd/src/composables/mmd/expression.ts:1-120`). Re-derive R5–R10 in Godot's `Tween`/`AnimationTree`; do not copy the composables.
9. **Beat-sync BroadcastChannel + BPM controller** (`packages/stage-shared/src/beat-sync/eventa.ts:21-31`; `packages/stage-ui-live2d/src/composables/live2d/beat-sync.ts:71-361`). If musical head-bobbing is wanted, add a daemon beat event later.
10. **Prompt-template TS files** — `character-defaults.ts`, `system-v2.ts`, i18n ACT strings. Their *vocabulary content* (10 keys, 4 VFX, syntax) is knowledge to re-express in daemon prompt assembly; the files stay in the UI reference.
11. **Spine/MMD/Live2D/VRM renderer adapters** (`VRMModel.vue`, `Model.vue`, `MMD.vue`, `Spine.vue`, Slint `spine_render.rs`/`spine_rt.rs`). Godot plugins own rendering (`.agents/skills/airi-character-rendering/SKILL.md:41-47`; `docs/design-flutter-godot-pivot.md:167,186-187`).

Explicit non-goal restated: upstream Godot sidecar import is a separate open question (`docs/design-flutter-godot-pivot.md:67,213`); this study does not authorize it.

---

## 5. Open questions for bead `airi-wxp.4.8`

1. **Payload additions:** will the in-progress `EmotionTagData` gain `duration_ms` and `kind` (§3.6)? Without `kind`, Godot cannot implement R4 (motion vs morph) from the event alone and would need model metadata to disambiguate hallucinated cues. Without `duration`, R9 hold-and-reset must be guessed per tag (TS default 2 s, `packages/stage-ui-live2d/src/stores/live2d.ts:351`, is a UI convention, not a spec).
2. **Unit of duration:** TS uses seconds (`EmotionPayload.duration`, `packages/stage-ui/src/constants/prompts/character-defaults.ts:18`). Wire should normalize once. Which unit and which default sentinel ("absent" vs `0` = immediate neutral)?
3. **Canonical tag set:** do we freeze the 10-key vocabulary (`packages/stage-ui/src/constants/emotions.ts:1-12`) in the wire schema as an enum, or keep `tag: string` open for model-specific names (`packages/stage-ui/src/composables/queues.ts:12-20`)? Recommendation: keep the string open, publish the canonical list as documentation + a prompt seed.
4. **Who owns the `tag → model expression` mapping in Godot?** Per-card metadata (model capabilities) vs a Godot-side profile mirroring `emotionMappings` (`packages/stage-ui-three/src/stores/model-store.ts:321-322`, `packages/stage-ui-live2d/src/stores/live2d.ts:87`). Decide the storage location and the discovery/fallback order (R3) before Wave 4.
5. **RMS vs viseme:** ship only `lip_sync.rms` + R1's `aa` smoothing (`crates/anima-render/src/vrm/lipsync.rs:3-44`), or add a `lip_sync.viseme` topic for the AEIOU path (`packages/stage-ui-three/src/composables/vrm/lip-sync.ts:17-35`)? This determines whether Godot needs wLipSync-equivalent analysis or just a scalar.
6. **Persistent expression layer (R14):** what event distinguishes a transient ACT cue from a Director/Studio persistent expression setter (`.agents/skills/airi-acting-cue-act-tokens/SKILL.md:100-114`)? A `persistent: bool` or a separate topic?
7. **Actor identity:** does `actor_id` on `emotion.tag` follow the *parse-time* or *playback-time* actor? The TS host deliberately separates them to avoid the stage settling on a queued actor before its audio (`packages/stage-ui/src/components/scenes/ControlStripHost.vue:424-433`; `.agents/skills/airi-acting-cue-act-tokens/SKILL.md:112`). Recommend playback-time.
8. **Backpressure for emotion events:** Wave 0 treats only RMS/token as realtime and queues control topics (`crates/anima-channel/src/wire.rs:262-271`). Confirm whether emotion tags are "control" (queued, ordered) — R7/R9 assume ordered delivery with no drops.
9. **DSL/costume scope:** is `change_cos` needed in Wave 4? If per-card plugin selection already handles costume/model switching (design doc decision A), the DSL opcode and its heap-preservation semantics (§1.4) may be out of scope entirely.
10. **Satoimo-style custom expressions:** do we carry a curated fallback registry of well-known custom names (`heart`, `star_eyes`, …; `docs/design-act-token-expression-system.md:96-107`) into Godot, or rely purely on per-model capability discovery?

---

## 6. Verification notes

- All paths/lines above were opened and re-read against HEAD `bad8fc69` during this survey. No citation failed to resolve.
- `git status --short` at survey start showed one **pre-existing**, unrelated modification: `M crates/anima-channel/src/wire.rs` (the concurrent Wave-0 work). This subagent did not touch it.
- No build/typecheck was run: this is a documentation-only, read-only source study. No files other than `docs/research-emotion-mapping-reference.md` were written.
