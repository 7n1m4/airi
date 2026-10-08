# Unified Sticker Architecture: Card Directives, Prefix-Cache Alignment & Modality Routing

> **Living Technical Specification & Architecture Refinement**:
> * **Tracking Issue / Base Reference**: Ported from upstream PR [#2714](https://github.com/moeru-ai/airi/pull/2714) (`moeru-ai/airi` / commit `7187df8caf`), heavily revised to eliminate upstream prefix-cache destruction and unhooked mockups.
> * **Target Workspace**: `dasilva333/airi`
> * **Governing Skills**: [`airi-acting-cue-act-tokens`](../.agents/skills/airi-acting-cue-act-tokens/SKILL.md), [`airi-prefix-cache-alignment`](../.agents/skills/airi-prefix-cache-alignment/SKILL.md), [`airi-card-schema`](../.agents/skills/airi-card-schema/SKILL.md), [`airi-desktop-chatbox`](../.agents/skills/airi-desktop-chatbox/SKILL.md)
> * **Related Catalogs**: [`docs/data-catalog.md`](./data-catalog.md)

---

## 1. Executive Summary & Problem Statement

Upstream PR [#2714](https://github.com/moeru-ai/airi/pull/2714) contributed a device-local emotion sticker library and in-chat rendering (`assistant-item.vue`). However, its prompt integration suffers from a critical anti-pattern:

### The Upstream Anti-Pattern: Deterministic Prompt Invalidation
Upstream implemented reaction frequency as a **runtime per-turn dice roll**:
```typescript
// Upstream anti-pattern in chat-orchestrator-runtime.ts:
const stickers = options.stickers // randomized per turn based on frequency %
const stickerPrompt = stickers?.length ? generateCatalogPrompt(stickers) : ''
systemMessage.content.push({ type: 'text', text: stickerPrompt })
```
Whenever the frequency dice roll toggles between eligible and ineligible across conversational turns (e.g., at 50% frequency), the system prompt bytes mutate dynamically. Under modern providers (DeepSeek, Anthropic, Gemini, OpenRouter), **mutating the root system prompt completely invalidates the KV prefix cache**, forcing the user to pay 100% full input token costs on every turn.

Furthermore, upstream made stickers global to the client settings rather than scoped to character identity. In AIRI, character personas own their expressive vocabulary.

### The Unified Solution
1. **Persona Ownership via `AiriExtension.acting.stickerDirectives`**:
   Stickers are treated identically to **ACT Directives** (`modelExpressionPrompt`), **Vocal Directives** (`speechExpressionPrompt`), and **Speech Mannerisms** (`speechMannerismPrompt`). They are authored per character card in the **Acting Tab** and compiled into the **frozen, static system prompt prefix** once.
2. **Semantic Restraint vs. Random Toggles**:
   Frequency and emotional appropriateness are taught to the model semantically via prompt directives (e.g., *"Use reaction stickers sparingly when playful or lighthearted emotional punctuation naturally fits the dialogue; avoid them during serious, reflective, or technical topics"*), rather than mutating the system prompt per turn.
3. **Multi-Modal Token Routing (`<|STICKER ...|>`)**:
   - **Phase 1 (Inline Reaction Slices)**: Canonical `<|STICKER id|>` streams into chat bubbles as a rich visual reaction badge.
   - **Phase 2 (Screen Slapper Routing)**: Expressive arguments allow directing stickers to the desktop stage window or both:
     - `<|STICKER id|>`: Implicit inline chat slice.
     - `<|STICKER id type="slapper" pos="topLeft"|>`: Explicit desktop screen slapper.
     - `<|STICKER id type="both" pos="bottomRight"|>`: Dual manifest (inline chat badge + desktop viewport slap).

---


## 2. Data Contracts & Schema Architecture

### 2.1 Extension Schema: `AiriExtension.acting` & `AiriExtension.stickers`
In `packages/stage-ui/src/types/card.schema.ts` and `docs/data-catalog.md`:

```typescript
export interface CardCustomSticker {
  id: string
  label: string
  description: string
  emotions: string[]
  createdAt: number
  /**
   * Optional base64 data URL populated during card export for full offline portability.
   */
  dataUrl?: string
}

export interface ActingConfig {
  modelExpressionPrompt: string
  speechExpressionPrompt: string
  speechMannerismPrompt: string
  /**
   * Character-scoped sticker prompt directives and allowed catalog.
   * Injected into the frozen system prompt prefix alongside modelExpressionPrompt.
   */
  stickerDirectivesPrompt?: string
  /**
   * Enabled sticker IDs from the registered library for this character.
   */
  activeStickerIds?: string[]
  /**
   * Toggle: Allow character to spawn stickers as desktop stage widgets/slappers.
   */
  stickerWidgetsEnabled?: boolean
  idleAnimations?: string[]
  pacing?: AiriPacing
  cueAllowlist?: CharacterCueAllowlist
  autoCuesEnabled?: boolean
  autoCueExpressions?: boolean
  autoCueMotions?: boolean
}
```

On `AiriCardExtension` (`card.extensions.airi`):
```typescript
export interface AiriCardExtension {
  // ...
  acting?: ActingConfig
  /**
   * Character-owned custom sticker manifest dictionary keyed by token slug id.
   */
  stickers?: Record<string, CardCustomSticker>
}
```

### 2.2 Persistence Layer Architecture: The "Lazy B" Strategy

To balance lightweight card sizes, fast runtime performance, and card portability:

1. **Runtime Execution (Local-First IndexedDB Blobs)**:
   - When a user uploads a sticker PNG/WebP, the binary `File`/`Blob` is stored directly in `localforage` under key `sticker-data-${id}`.
   - Bypasses Vue reactive proxies and `JSON.stringify` to guarantee binary safety (per `airi-binary-safety`).
   - `getStickerUrl(id)` in `useStickersStore` resolves URLs:
     1. Static built-ins (`packages/stage-ui/src/assets/stickers/`).
     2. `localforage.getItem<Blob>('sticker-data-${id}')` -> `URL.createObjectURL(blob)` (cached in-memory).
2. **Card Manifest Record**:
   - The card stores metadata (ID slug, display label, prompt description, emotions) in `card.extensions.airi.stickers[id]`.
   - The card does **not** store bloated base64 strings during regular local editing, keeping memory and database queries fast.
3. **Card Export / Import Portability**:
   - **Export (`use-card-export.ts`)**: Reads blobs for all `card.extensions.airi.stickers` from `localforage`, converts them to base64 Data URLs on the exported payload, ensuring exported cards carry all custom reaction stickers.
   - **Import (`CardImportWizard.vue` / import handler)**: Decodes any embedded sticker `dataUrl`s and writes them into `localforage.setItem('sticker-data-${id}', blob)`.

### 2.3 System Prompt Assembly (`buildCharacterSystemPrompt`)
In `packages/stage-ui/src/stores/modules/airi-card.ts`:
```typescript
const acting = card.extensions?.airi?.acting
if (acting) {
  if (acting.modelExpressionPrompt?.trim())
    components.push(acting.modelExpressionPrompt)
  if (acting.speechExpressionPrompt?.trim())
    components.push(acting.speechExpressionPrompt)
  if (acting.speechMannerismPrompt?.trim())
    components.push(acting.speechMannerismPrompt)
  // Static, frozen sticker directives:
  if (acting.stickerDirectivesPrompt?.trim())
    components.push(acting.stickerDirectivesPrompt)
}
```
**Prefix Cache Invariant**: Because `buildCharacterSystemPrompt` is constructed once when a card/session initializes and remains static during chat execution, the entire prompt block benefits from 100% KV cache hits across turns.

---

## 3. Token Grammar & Parser Specification

### 3.1 Token Shapes
The lexer in `packages/stage-ui/src/composables/llm-marker-parser.ts` and marker extractor in `packages/stage-ui/src/stores/chat.ts` support two syntax forms:

1. **Short Implicit Form (Phase 1 Baseline)**:
   ```text
   <|STICKER airi-happy|>
   ```
   Renders as an inline reaction slice in the assistant chat bubble.

2. **Attribute Parametric Form (Phase 2 Multi-Modal Routing)**:
   ```text
   <|STICKER id="airi-celebrate" type="slapper" pos="topRight"|>
   <|STICKER id="airi-sad" type="both" pos="bottomLeft"|>
   ```
   - `id`: Unique identifier of the sticker asset from the catalog.
   - `type`: Target manifestation mode:
     - `inline` (default if omitted): Appended exclusively as a chat bubble slice.
     - `slapper`: Spawns onto the desktop stage/viewport via `stickersStore.spawnSticker(id, options)`.
     - `both`: Emits in both the chat bubble and slaps the stage viewport.
   - `pos`: Preferred viewport placement quadrant (`topLeft`, `topRight`, `bottomLeft`, `bottomRight`, `random`).

### 3.2 Parser, Lexer & Boundary Gates
To protect TTS, captions, and history replay, the token pipeline enforces six gates:

1. **Bare-`>` Whitelist Gate**:
   `findLegacyCloseTagIndex` in `llm-marker-parser.ts` includes `<|STICKER` in its whitelist so models closing tags with bare `>` instead of `|>` do not leak into literal text.
2. **Audio / Speech Stripping Gate**:
   `stripMarkers` in `response-categoriser.ts` strips `<|STICKER...|>` before categorizing text into speech. TTS engines (Kokoro, ElevenLabs, OpenAI) never speak sticker tokens.
3. **Caption Isolation Gate**:
   Floating subtitle overlays (`useSpeechCaptionPlayer.ts`, `airi-caption-overlay`) exclude sticker tokens completely.
4. **Reasoning Separation Gate**:
   If an LLM hallucinates or drafts a sticker token inside deep thought tags (`<think> ... </think>`), the marker parser ignores it. Stickers only trigger when emitted in visible speech text.
5. **Single-Sticker Limit Per Turn**:
   Guards prevent repetitive spam by allowing at most one sticker manifestation per assistant turn unless explicitly instructed otherwise.
6. **Dual Storage Contract**:
   - `content`: Display prose with all sticker markers stripped.
   - `rawContent`: Ground-truth inference record preserving `<|STICKER ...|>` so replaying turns into inference context prevents model forgetfulness.

---

## 4. UI Authoring: Acting Tab (`ActingSubTabStickers.vue`)

The Stickers sub-tab in `CardCreationTabActing.vue` is refactored from unhooked mockups to a functional prompt-authoring workstation:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 🎨 Reaction Stickers Directives & Library                              │
│ Configure character reaction stickers, inline cadence, and screen     │
│ widget slappers.                                                       │
├────────────────────────────────────────────────────────────────────────┤
│ [ ] Include Stickers as Desktop Screen Slappers                        │
│     Allows the character to slap stickers onto your stage window       │
│     using <|STICKER id type="slapper" pos="..."|>                      │
├────────────────────────────────────────────────────────────────────────┤
│ Sticker Directives & Instructions                                      │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ ## Reaction Sticker Directives                                     │ │
│ │ You have access to expressive chibi stickers. Use at most one per  │ │
│ │ reply when natural emotional punctuation fits your dialogue.       │ │
│ │ Avoid stickers in serious or technical discussions.                │ │
│ │ Available catalog:                                                 │ │
│ │ - <|STICKER airi-happy|>: Cheerful smile, laughter                 │ │
│ │ - <|STICKER airi-sad|>: Crying, downcast                           │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ [ 🪄 Optimize with AI ] [ 🔄 Sync Directives from Catalog ]            │
├────────────────────────────────────────────────────────────────────────┤
│ Character Sticker Catalog (12 built-in)                                │
│ Click any sticker below to insert its token into your directives:      │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│ │  [Chibi Img] │  │  [Chibi Img] │  │  [Chibi Img] │  │  [Chibi Img] │ │
│ │  airi-happy  │  │   airi-sad   │  │ airi-confused│  │ airi-celebrate││
│ │  [ + Insert] │  │  [ + Insert] │  │  [ + Insert] │  │  [ + Insert] │ │
│ └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### UI Interactions:
1. **Sync Directives from Catalog**:
   Automatically formats and populates `stickerDirectivesPrompt` using the active character catalog (both built-in and character-owned custom stickers) and appropriate tone guidelines.
2. **Add Custom Sticker (`CardStickerAddModal.vue`)**:
   - Allows uploading local PNG/WebP files.
   - Enforces unique semantic slug token IDs (e.g. `columbina-scheming`).
   - Captures label, description, and emotions for prompt synthesis.
   - Saves binary directly to `localforage` and metadata to `card.extensions.airi.stickers`.
3. **AI Sparkle Integration**:
   Uses `@sparkle-click="emit('sparkle-click', 'actingStickerDirectives')"` to allow LLM refinement of sticker behavior and personality tone.

---

## 5. Phased Roadmap

| Phase | Scope | Deliverables | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Prefix-Safe Core & Card Schema** | 1. Add `stickerDirectivesPrompt` & `activeStickerIds` to `card.schema.ts` and `AiriExtension`.<br>2. Wire `stickerDirectivesPrompt` into `buildCharacterSystemPrompt` (frozen prefix).<br>3. Overhaul `ActingSubTabStickers.vue` with prompt textarea, sync button, and catalog insertion pills.<br>4. Preserve in-chat `<ChatSticker />` slice rendering in `assistant-item.vue`. | **Shipped** |
| **Phase 1.5** | **Custom Sticker Upload ("Lazy B" Persistence)** | 1. Add `CardCustomSticker` schema to `extensions.airi.stickers`.<br>2. Build `CardStickerAddModal.vue` with image dropzone, slug validation, and metadata inputs.<br>3. Store binary in `localforage.setItem('sticker-data-${id}', file)`.<br>4. Integrate custom stickers into merged catalog view and "Sync from Catalog" prompt builder.<br>5. Support card export packaging and import extraction for portable sticker sharing. | **In Progress** |
| **Phase 2** | **Multi-Modal Slapper Routing** | 1. Extend token parser regex to support `type="slapper\|both"` and `pos="..."`.<br>2. Wire Stage Viewport overlay in `RendererStage.vue` / `ControlStripHost.vue` to dispatch screen slaps with physics and decay.<br>3. Add quadrant positioning resolution (`topLeft`, `topRight`, etc.). | Planned |
| **Phase 3** | **Sticker Forge (Generative AI Synthesis)** | 1. Connect Artistry / Pollinations / ComfyUI pipeline to generate sticker variations on the fly.<br>2. Prompt recipe builder (LINE sticker / chibi die-cut vector styling). | Planned |

