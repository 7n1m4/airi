# Proposal: Dual-Duty Ninja-Swap Interceptor (Speech Tags + ACT Cues)

> **Status**: Proposal — zero implementation (Oct 2026). No `NinjaSwap` hits repo-wide; `ControlStripHost.vue` / `speech.ts` have no Jev/`useSystemOneStore` wiring (ACT cues exist without Jev).
> **Promoted from**: [`docs/proposal-jev-integration.md`](./proposal-jev-integration.md) Domain F (Phase 6 — NEXT UP) and [`docs/design-jev-integrations.md`](./design-jev-integrations.md) §4 Domain F.
> **Related domain skill**: [`.agents/skills/airi-jev-decision-engine/SKILL.md`](../.agents/skills/airi-jev-decision-engine/SKILL.md)
> **Adjacent docs (do not duplicate, integrate with)**:
> - [`design-act-token-expression-system.md`](./design-act-token-expression-system.md) — ACT token formats + parser pipeline (actuation side).
> - [`design-acting-tab-and-chatterbox.md`](./design-acting-tab-and-chatterbox.md) — Acting tab authoring surface + Chatterbox capabilities (Tier 1 upstream).
> - [`proposal-conversational-pacing-thinking-fillers.md`](./proposal-conversational-pacing-thinking-fillers.md) — owns the speech lane; single-owner rule applies (see §5).
> - [`airi-acting-cue-act-tokens/SKILL.md`](../.agents/skills/airi-acting-cue-act-tokens/SKILL.md), [`airi-audio-pipeline/SKILL.md`](../.agents/skills/airi-audio-pipeline/SKILL.md), [`airi-speech-runtime/SKILL.md`](../.agents/skills/airi-speech-runtime/SKILL.md)

---

## 1. Problem: the voice-face emotional disconnect

Avatar interaction relies on two annotation systems that historically clash:

1. **Physical blendshapes & gestures**: inline `<|ACT:emotion="smug",motion="lean_forward"|>` cues driving Live2D, VRM, and Stage-Mate rigs.
2. **Audio speech tags**: prepended expressive tags (`[whisper]`, `[giggle]`, `*sigh*`) driving inflection-aware TTS backends (`airi-audio-server` / Chatterbox, Fish Audio, IndexTTS-2.0, Higgs, OmniVoice).

Forcing the primary conversational LLM (System 2) to generate both inline creates severe failure modes:

1. **Token cost, latency & cache invalidation**: 20–40 extra markup tokens per turn, degraded Time-to-First-Token (TTFT), broken KV-cache prefix stability.
2. **Model non-compliance**: smaller/local models (7B/8B) hallucinate invalid tag names or drop markers altogether.
3. **Concurrent-execution desync**: if TTS synthesis dispatches immediately while avatar cues resolve in parallel, TTS receives flat unannotated text — the 3D model smiles while the voice stays monotone.
4. **Hardware junk drawer & persona integrity**: VRM/Live2D rigs expose 40–100 raw blendshapes. Dumping the full catalog into a runtime classifier dilutes probabilities and breaks persona (a stoic character smiling at a joke because `happy` was in the candidate pool).
5. **Regex infeasibility**: card authors write natural-language acting guidelines, not per-token markup — naive regex matches zero tokens.

---

## 2. Architecture: two-tier persona compiler + stride interceptor

```text
┌────────────────────────────────────────────────────────────────────────┐
│  Tier 1: Authoring-Time Reverse Extractor ("The Persona Compiler")     │
│  Trigger: author edits Acting Tab prompts or imports/switches a card   │
│  Engine:  local Needle 2 (WASM), local tiny LLM, or Jev schema query   │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
                Compiled Character Whitelist Cache
                ┌────────────────────────────────────────────────────────┐
                │ whitelisted_emotions: ["deadpan", "glare", "smirk"]   │
                │ whitelisted_motions:  ["arms_crossed", "head_turn"]   │
                │ whitelisted_speech:   ["whisper", "sigh", "neutral"]   │
                └────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Tier 2: Real-Time Sentence Stride Interceptor (~110ms Ninja-Swap)     │
│  Trigger: live sentence stride emitted by primary chat LLM             │
│  Engine:  TypeSafe Jev / Laya Local (single merged request)            │
│                                                                        │
│  Jev options fed STRICTLY from compiled whitelist:                     │
│    - act_emotion: ["none", "deadpan", "glare", "smirk"]                │
│    - act_motion:  ["none", "idle", "arms_crossed", "head_turn"]        │
│    - speech_tag:  ["none", "whisper", "sigh"]                          │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
┌──────────────────────────────────────┐   ┌──────────────────────────────────────┐
│  Avatar Rig (Live2D / VRM / Mate)    │   │  Audio Engine (Chatterbox / Index)   │
│  Inject: <|ACT:emotion="smug"...|>   │   │  Inject: "[sigh] You actually..."    │
└──────────────────────────────────────┘   └──────────────────────────────────────┘
```

### 2.1 Tier 1: authoring-time persona compiler (reverse extractor)

#### Tier 1 surfaces inventory (5 entry points, one compiler)

| # | Surface | Entry | Code anchor | State today |
|---|---|---|---|---|
| 1 | Manual entry (character config) | Acting tab text fields | `CardCreationTabActing.vue` (`actingModelExpression` / `actingSpeechExpression`) | Free-text only; needs the "fancy parse" background compile on edit |
| 2 | Sparkle per-field generator (first-gen) | Sparkle glyph per field | `FieldAiGeneratorModal.vue` via `CardEditorForm.openSparkleGenerator` | Field-scoped LLM fill; acting-field sparkles should redirect to the unified curation route (§2.1.1) |
| 3 | AI curated wizard | Settings > Models > Curate AI | `ModelCustomizer.vue` embeds `ExpressionCurationModal.vue` | 3-step modal (Scope → Review → Apply); has the three UX defects listed in §2.1.2 |
| 4 | Onboarding emotions phase | Onboarding wizard | `step-emotions.vue` embeds `ExpressionCurationModal.vue` + auto-calibrate sparkle | Same modal, same defects, embedded context |
| 5 | Rehearsal Room | Playground button (to be added) | `chat_rehearsal.vue` (presets fire ACT cues today; no curation entry) | No curation entry yet; should deep-link to the unified route |

`use-expression-curation.ts` (`curateExpressions` / `generateActingPrompt` / `previewOnStage` / `applyCuration`) is the shared logic behind surfaces 3–4 today.

#### 2.1.1 Grand unification plan (agreed direction): decompose, don't port

The 4–5 Tier 1 surfaces are distinctively different processes — porting the 3-step curator wizard into a full page (or nesting it inside the onboarding wizard) preserves the wrong shape. Instead, the **single-pass `step-emotions.vue` cockpit is the baseline**: model left, canonical premaps right, lightweight calibrate + nuanced LLM pass + tactile soundboard, all in one pass. The work is decomposition:

**Extract** `step-emotions.vue` (1022 lines) into a reusable studio component (proposed: `components/scenarios/acting/EmotionCalibrationStudio.vue`, new folder — none exists today):

| Block | Moves into studio (parameterized) | Stays with caller |
|---|---|---|
| §§1–3 model/vessel resolution, stage mount, capability scan (`rawExpressions` / `candidateExpressions` via noise-gate) | Yes — model-Id source + preview assets as props | Onboarding wrapper passes draft vessel; route wrapper passes route param + card store |
| §4 canonical 6-slot mappings + soundboard + `triggerPreview` | Yes — pure, moves verbatim | — |
| §5 auto-calibration (presets → regex → fallback) + default directives | Yes — pure logic | Mount-time auto-calibrate *policy* stays with caller (onboarding auto-runs; route runs on demand) |
| §6 directives hub + Enhance with AI (`generateActingPrompt`) | Yes — prompt context (name/personality/description) as props | — |
| Cockpit template (avatar viewport + mapping card + directives hub) | Yes — navigation chrome via slots | Onboarding header/i18n + Back/Continue; route settings chrome |
| §8 draft sync (`useOnboardingV3Draft`) | No | Onboarding wrapper only; route wrapper binds `displayModels` + card store instead |

**Retire the modal, keep its power feature.** `ExpressionCurationModal.vue`'s 3-step flow goes away as a wizard, but it does one thing the studio doesn't: full-catalog curation (scope select over 335 morphs, per-morph rename/skip). That survives as an **Advanced drawer/section on the studio page** (the current "Details >" affordance), not a separate flow. Entry buttons (ModelCustomizer "Curate AI", acting-tab sparkle, Rehearsal Room button) navigate to the route; onboarding embeds the component.

**Whitelist wiring in the unified shape**: `compiledWhitelists.whitelistedEmotions` derives deterministically from the 6 canonical mappings; motions + extra emotion tokens append when Advanced curation runs; speech-tag allowlist via the step-3 LLM sidecar (§2.1.3).

#### 2.1.2 Known UX defects in the current modal (`ExpressionCurationModal.vue`)

1. **Footer ignores dark theme** (`ExpressionCurationModal.vue:524`): pairs `bg-neutral-50/80` with `dark:bg-neutral-850`. `neutral-850` is a non-standard shade (used 71× repo-wide, so presumably a custom Uno token in some app configs) — if the rendering surface's Uno build lacks the token, the dark class never generates and the light background wins. Fix: `dark:bg-neutral-900`, or prove `850` resolves in every consuming app's Uno config.
2. **Step 2 cannot vet options**: 6-column table crammed into `max-w-2xl`, raw keys truncated to 120px, and the eye-icon preview fires on the stage *behind* the modal overlay (`bg-black/60` + blur) — the user literally cannot see what they are validating. Resolved by the full-page master-detail layout (§2.1.1).
3. **Whitelist not compiled at synthesis**: step 3 already holds `activeItems` (label / actToken / category / shouldSkip) when `generateActingPrompt` runs — the whitelist is one derivation away and currently discarded. See §2.1.3.

#### 2.1.3 Compiling `compiledWhitelists` at the step-3 synthesis pass

- **Emotions/motions: deterministic, no LLM needed.** `activeItems` already carries `actToken` + `category` + `shouldSkip` — the whitelist emotion/motion sets are a pure function of the non-skipped items. Zero extra cost, zero variance.
- **Speech tags: LLM-assisted.** Curation output contains no speech tags; the allowlist needs persona judgment (stoic → no `giggle`) intersected with provider capabilities (`expressionTags` plumbing already exists — see §4). Options: extend the step-3 prompt to return directives + a JSON sidecar, or a second small structured call reusing the same context.
- **Scope note**: this solves the wizard path (surfaces 3–4) only. Manual acting-tab input (surface 1) still needs the debounced background "fancy parse" compile on edit — that is the Q3 shootout item.

- **When it runs**: asynchronously (debounced ~500ms) when the user edits `acting.modelExpressionPrompt` or `acting.speechExpressionPrompt` in `CardCreationTabActing.vue`, or upon card import/switch.
- **Inputs intersected**:
  1. **Avatar hardware catalog**: expressions/motions actually wired in the Model Customizer (`character.expressions`, `character.motions`).
  2. **Speech engine capabilities**: programmatic `expressionTags` — already plumbed today via `useActingCapabilities.ts` → `speechCapabilities.expressionTags`, provider registry `supportsExpressionTags`/`expressionTags` (`packages/stage-ui/src/stores/providers/registry/speech.ts`), and the `airi-audio-server.vue` capabilities page.
  3. **Author's natural-language prompts**: freeform expressive demeanor + constraints.
- **Extraction task**: *"Given this character's acting guidelines, the model's mapped capabilities, and available TTS speech tags, extract the exact subset of emotion keys, motion keys, and speech tags this character is authorized to use."*
- **Output (PROPOSED, does not exist yet — zero `compiledWhitelists` hits repo-wide)**: tight validated whitelist saved into card reactive extension state (`extensions.airi.acting.compiledWhitelists`):
  ```json
  {
    "whitelistedEmotions": ["none", "deadpan", "glare", "smirk", "neutral"],
    "whitelistedMotions": ["none", "idle_subtle", "arms_crossed", "head_turn_away"],
    "whitelistedSpeechTags": ["none", "whisper", "sigh", "curious"]
  }
  ```
- **Cost**: runs offline once at authoring/import time (~300–800ms), zero real-time streaming impact.

### 2.2 Tier 2: real-time sentence-stride interceptor (~110ms ninja-swap)

- **When it runs**: during live chat generation (integration point TBD — see §5 Q1).
- **Stride buffer**: slices text into sentence strides as tokens stream from the LLM (*"Wait, did you really think I wouldn't notice you sneaking in here?"*).
- **Single-pass merged request**: one dispatch to Jev/Laya evaluating all questions over a single shared forward pass (~110ms, $42/Btok or free local Laya) instead of split requests (220ms+ and voice-face desync risk):
  ```json
  {
    "state": {
      "sentence": "Wait, did you really think I wouldn't notice you sneaking in here?",
      "character_persona": "Tsundere persona: defensive when caught off-guard, crosses arms, hides relief behind mild indignation."
    },
    "questions": {
      "speech_tag": {
        "type": "choice",
        "instructions": "Select the voice speech tag from the character's allowed tags that best matches this line.",
        "options": ["none", "whisper", "sigh", "curious"]
      },
      "act_emotion": {
        "type": "choice",
        "instructions": "What facial expression from the character's allowed emotions should the avatar adopt?",
        "options": ["none", "deadpan", "glare", "smirk", "neutral"]
      },
      "act_motion": {
        "type": "choice",
        "instructions": "What physical gesture from the character's allowed motions should accompany this spoken line?",
        "options": ["none", "idle_subtle", "arms_crossed", "head_turn_away"]
      },
      "intensity": {
        "type": "score",
        "instructions": "Score emotional intensity (0.0 = subtle, 1.0 = exaggerated).",
        "min": 0.0,
        "max": 1.0
      }
    }
  }
  ```
- **Why one merged request guarantees coherence**: voice inflection and facial blendshape derive from the same unified latent appraisal — no "laughing voice with angry face" dissonance.
- **Ninja-swap execution** (example return: `speech_tag: "sigh"`, `act_emotion: "smirk"`, `act_motion: "arms_crossed"`, `intensity: 0.8`):
  1. Inject `<|ACT:{"emotion":{"name":"smug","intensity":0.8},"motion":"arms_crossed"}|>` into the special-token queue (rig + subtitle indicators).
  2. Prepend `[sigh] ` to the sentence chunk before TTS synthesis.
  3. Audio + blendshapes fire in emotional harmony; the 110ms buffer absorbs into natural turn-pacing silence. Zero prompt pollution on the primary LLM; full prefix-cache alignment.

---

## 3. Contracts to preserve

1. **Whitelist-strict options**: Tier 2 `choice` option lists MUST be built exclusively from the Tier 1 compiled whitelist (+ `none`). Never the raw hardware catalog.
2. **Universal consumer gate**: check `systemOneStore.configured` before every stride evaluation; when unconfigured/offline, pass sentences through unannotated (no throw, no stall).
3. **Distractor attractor baselines**: include explicit `none` in every option list to absorb neutral lines and suppress false-positive spillover.
4. **Decoupled actuation**: Jev decides; existing queues execute. The interceptor never synthesizes audio or drives rigs directly.
5. **Single merged request per stride**: batch `speech_tag` + `act_emotion` + `act_motion` (+ `intensity`) into one `execute()` call.

---

## 4. Integration anchors (verify signatures before implementing)

| Concern | Anchor | Notes |
|---|---|---|
| Authoring UI | `packages/stage-pages/src/pages/settings/airi-card/components/tabs/CardCreationTabActing.vue` | Tier 1 trigger; prompt fields live here |
| Capability discovery | `packages/stage-pages/src/pages/settings/airi-card/composables/useActingCapabilities.ts`, `packages/stage-ui/src/stores/providers/registry/speech.ts`, `packages/stage-pages/src/pages/settings/providers/speech/airi-audio-server.vue` | `expressionTags` plumbing already exists — reuse, don't rebuild |
| Decision engine | `packages/stage-ui/src/stores/modules/system-one.ts` (`execute()`) | Tier 2 merged request entrypoint |
| Runtime interception | `ControlStripHost.vue` / `speech.ts` vs `packages/pipelines-audio/src/speech-pipeline.ts` | Placement TBD — see §5 Q1 |
| Marker actuation | ACT parser (`queues.ts` / `processMarkers()` per `design-act-token-expression-system.md`) | Injection target for `<\|ACT…\|>` output |
| Whitelist storage | `extensions.airi.acting.compiledWhitelists` (PROPOSED) | New schema; update [`docs/data-catalog.md`](./data-catalog.md) when added |

---

## 5. Refinement checklist (open questions before implementation)

- [ ] **Q1 — Stride-buffer placement**: `ControlStripHost.vue` vs `speech-pipeline.ts`? Constraint from the pacing doc: one queue/owner, no second audio driver in `speech.ts` (which remains the selected-provider/settings authority). Where does the stride buffer tap the token stream without violating the single-owner rule?
- [ ] **Q2 — Whitelist schema & ownership**: confirm `extensions.airi.acting.compiledWhitelists` shape, defaults for cards without a compiled whitelist (passthrough unannotated vs Tier-1-on-first-use?), and migration for existing cards. Register the key in `docs/data-catalog.md`.
- [ ] **Q3 — Tier 1 engine choice**: Needle 2 WASM vs local tiny LLM vs Jev schema query? Needs a shootout like the Nan0 43-case cleanroom (accuracy on natural-language acting guidelines → exact key subsets, with persona-violation counterexamples).
- [ ] **Q4 — Latency budget**: is 110ms/stride absorbable in all surfaces (chat, DatingSim, Stage-Mate bridge)? Define per-surface degradation (skip annotation vs block) on Jev timeout.
- [ ] **Q5 — Tag validity per provider**: which TTS providers honor `[tag]` prefixes vs strip/butcher them? `moss-audio-utils` sanitizes `[whisper]` → `whisper` (no brackets) — per-provider prefix/strip matrix needed so the interceptor prepends only what the active provider supports.
- [ ] **Q6 — Intensity mapping**: how does the `intensity` score map onto ACT `intensity`/`duration` fields and provider-specific expressiveness knobs?
- [ ] **Q7 — Test harness**: stride fixtures (sentence + persona + whitelist → expected tag+ACT pairs), persona-violation counterexamples (stoic character must never receive `happy`), voice-face coherence assertions. Mirror `system-one.test.ts` mock-Decisions-API pattern.
- [ ] **Q8 — Observability**: per-stride latency logging, tag/EMOTION distribution counters, debug surface (Controls / Rehearsal Room?) for whitelist inspection and stride replay.
- [ ] **Q9 — Tier 1 unification build**: extract route-capable curation component (§2.1.1); fix footer `dark:bg-neutral-850` (§2.1.2 defect 1); master-detail vetting layout with visible avatar preview (§2.1.2 defect 2); deterministic whitelist compile + speech-tag sidecar at step 3 (§2.1.3); wire all 5 entry points; confirm route path against settings topology.

---

## 6. Verification (when implementation lands)

```bash
# Store-level (existing suite must stay green)
pnpm -F @proj-airi/stage-ui test packages/stage-ui/src/stores/modules/system-one.test.ts
# Typecheck affected surfaces
pnpm -F @proj-airi/stage-ui typecheck
pnpm -F @proj-airi/stage-pages typecheck
```

Text-only doc change: no validation run required for this scaffold.

---

## 7. Cross-reference index

| Subsystem | Code anchors | Authoritative docs |
|---|---|---|
| System-1 engine | `stage-ui/stores/modules/system-one.ts` | [`proposal-jev-integration.md`](./proposal-jev-integration.md) |
| ACT tokens | marker parser / `processMarkers()` | [`design-act-token-expression-system.md`](./design-act-token-expression-system.md) |
| Acting authoring | `CardCreationTabActing.vue`, `useActingCapabilities.ts` | [`design-acting-tab-and-chatterbox.md`](./design-acting-tab-and-chatterbox.md) |
| Speech lane | `speech-pipeline.ts`, `ControlStripHost.vue`, `speech.ts` | [`proposal-conversational-pacing-thinking-fillers.md`](./proposal-conversational-pacing-thinking-fillers.md) |
| Capability registry | `stores/providers/registry/speech.ts` | provider settings pages |
