# Unified Sticker System Specification: In-Chat Slices & Desktop Screen Spawning

> **Living Technical Specification & Traceability**:
> * **Upstream Base PR**: [#2714](https://github.com/moeru-ai/airi/pull/2714) — `feat(chat): add optional emotion stickers and a local library`
> * **Upstream Commit**: [`7187df8caf`](https://github.com/moeru-ai/airi/commit/7187df8caf36adcb00fb86efbca6934c9c61d56e) _(reverieach & Columbina, 2026-10-05)_
> * **Target Workspace Fork**: `dasilva333/airi`
> * **Governing Skills**: [`airi-acting-cue-act-tokens`](../.agents/skills/airi-acting-cue-act-tokens/SKILL.md), [`airi-desktop-chatbox`](../.agents/skills/airi-desktop-chatbox/SKILL.md), [`airi-stage-ui-surfaces`](../.agents/skills/airi-stage-ui-surfaces/SKILL.md)

This document details the unified architecture, data contracts, and interaction models for the **Sticker System** in `dasilva333/airi`. It bridges upstream's newly contributed in-chat emotion stickers (PR [#2714](https://github.com/moeru-ai/airi/pull/2714) / commit `7187df8caf`) with this fork's dormant desktop screen-spawning engine, anchoring authoring in the **Acting Tab** rather than obsolete legacy modules.

---

## 1. Vision & Architectural Philosophy

Stickers in AIRI are not mere static emojis—they represent **Kinetic Emotional Manifestations**. They provide a visual, playful bridge between the character's internal state and the user's workspace across two complementary modalities:

1. **In-Chat Reaction Slices**: Inline chibi stickers nested cleanly inside the conversational stream (`assistant-item.vue`), giving chat replies visual cadence and emotional punctuation.
2. **Desktop Stage / Tamagotchi Screen Slapping**: Dynamic overlays spawned directly onto the user's screen or stage viewport (`StickerStack` / `StickerWidget`), rotating slightly, floating, and decaying organically to mimic physical stickers slapped onto glass.

By decoupling authoring from upstream's removed "Modules" tab and integrating it directly into the **Acting Tab** (alongside ACT tokens, pacing fillers, and speech mannerisms), stickers become a first-class character acting dimension.

---

## 2. Dual Manifestation Surfaces

### Modality A: In-Chat Emotion Stickers (Chat Bubbles)
* **Rendering Target**: Nested within `ChatAssistantMessage.slices` as `{ type: 'sticker', stickerId: string }`.
* **Component**: Handled by `<ChatSticker :sticker-id="slice.stickerId" />` inside `packages/stage-ui/src/components/scenarios/chat/components/assistant-item.vue`.
* **Visual Presentation**: Rendered at `160×160px` with light/dark surface awareness, rounded contours, and graceful loading fallbacks.
* **Grammar & Dispatch**: Emitted inline by the LLM via `<|STICKER <id>|>`. Stripped before reaching TTS audio synthesis so speech engines never pronounce sticker markers.

### Modality B: Desktop Screen Spawning (Tamagotchi Screen Slapping)
* **Rendering Target**: Viewport-wide overlay managed by `packages/stage-ui/src/components/scenarios/stickers/sticker-stack.vue` mounted in desktop stage windows (`RendererStage.vue` / `ControlStripHost.vue`).
* **Component**: Rendered via `packages/stage-ui/src/components/scenarios/stickers/sticker-widget.vue`.
* **Spawning Heuristics & Micro-Animations**:
  * **Spawn Spring**: Scales from `0` to `1.1` in `200ms` before settling at `1.0`.
  * **Rotation Jitter**: Automatically skewed by `(3 + Math.random() * 5) * direction` (between `3°` and `8°` clockwise or counterclockwise) to feel organically placed.
  * **Positioning**: Screen percentage coordinates (`10%` to `90%` viewport bounding) or anchored around the Control Strip perimeter.
  * **Holographic Tilt**: Interactive 3D CSS transform (`rotateX` / `rotateY`) following cursor hover with a soft sheen reflection.
  * **Peel & Sweep**: Users can drag stickers or click to peel them away immediately.
  * **Auto-Decay (Ephemeral)**: Placements carry an `expiresAt` timestamp (default: 5–15 seconds, configurable per spawn) and automatically clean up via `useIntervalFn`.

---

## 3. Triggering & Invocation Contracts

The sticker system supports both lightweight streaming token markers and deliberate tool invocations:

```mermaid
flowchart TD
    LLM[Language Model / Inference] -->|Streams Reply| Parser[llm-marker-parser.ts]
    LLM -->|Tool Call| Tool[spawn_sticker tool]

    Parser -->|<|STICKER id|> Detected| Router{Destination}
    Router -->|In-Chat Mode| ChatSlice[Append ChatSlicesSticker to Assistant Message]
    Router -->|Stage Desktop Mode| ScreenPlacement[Call stickersStore.spawnSticker]

    Tool -->|spawn_sticker id, x, y, duration| ScreenPlacement

    ChatSlice --> ChatUI[assistant-item.vue <ChatSticker />]
    ScreenPlacement --> OverlayUI[StickerStack <StickerWidget />]

    Parser -->|Speech Text Stream| TTS[Audio Pipeline / TTS: Stripped & Clean]
```

### 1. Special Marker Token: `<|STICKER <id>|>`
* Follows the canonical AIRI special token convention established by `<|ACT:emotion|>` and `<|ACTOR:character|>`.
* **Zero Latency**: Requires no additional tool-call roundtrip; streams naturally during conversation.
* **Catalog Prompt Injection**: When enabled, the prompt builder engine appends an eligible catalog supplement to the system instructions:
  ```text
  You can send one optional sticker per reply with a marker from this catalog.
  Use stickers when the user requests one or when a lighthearted response fits. Avoid them in serious conversations.
  Keep your text complete. Never invent sticker IDs or image URLs.
  Choose the ID whose name and emotion tags best fit the conversation.
  <|STICKER airi-happy|>: happy, cheerful
  <|STICKER airi-sad|>: sad, crying
  ...
  ```

### 2. Built-in Tool: `spawn_sticker`
* Defined in `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/stickers.ts`.
* Allows explicit spatial and temporal control when the character proactively decorates the user's screen:
  * `stickerId`: Target sticker identifier.
  * `x`, `y`: Viewport percentages (`0-100`).
  * `duration`: Lifespan in seconds before decay.

---

## 4. Pipeline Tracing, Whitelists & Boundary Gates (Due Diligence)

Introducing `<|STICKER <id>|>` into the AIRI runtime requires strict synchronization across multiple architectural gates to avoid text leakage into TTS, desynchronized caption streams, or inference behavioral drift:

```
[ LLM Stream Output ]
        │
        ├── 1. Lexer / Parser Gate (llm-marker-parser.ts)
        │      ├─ Splits onLiteral vs onSpecial('<|STICKER id|>')
        │      └─ Whitelist in findLegacyCloseTagIndex ('<|STICKER')
        │
        ├── 2. Categorization & Speech Gate (response-categoriser.ts)
        │      ├─ createStreamingCategorizer.filterToSpeech excludes stickers
        │      └─ stripMarkers regex removes <|...|> and legacy bare `>`
        │
        ├── 3. TTS Audio Engine (speech.ts & UST)
        │      └─ Audio Studio UST receives clean speech; NEVER speaks token
        │
        ├── 4. Captions Subsystem (airi-caption-overlay & useSpeechCaptionPlayer)
        │      └─ Sentence-sync segments are purely spoken dialogue; stickers omitted
        │
        ├── 5. Chat History Persistence (ChatAssistantMessage)
        │      ├─ content: sanitized text (stickers stripped)
        │      └─ rawContent: full stream WITH <|STICKER id|> preserved for multi-turn replay
        │
        └── 6. Manifestation Dispatch
               ├─ Chat Bubble: Appends { type: 'sticker', stickerId } to message.slices
               └─ Desktop Stage: ControlStripHost calls stickersStore.spawnSticker(id)
```

### Gate 1: Parser & Lexer Whitelist (`llm-marker-parser.ts`)
* **Legacy Bare-`>` Close Whitelist**:
  `findLegacyCloseTagIndex()` accepts a plain `>` closing delimiter **only** for whitelisted prefixes (`<|ACT`, `<|DELAY`, `<|LLM_`).
  * **Requirement**: Add `upperPrefix.startsWith('<|STICKER')` to this whitelist. If a model emits `<|STICKER airi-happy>` with a bare `>`, it must not stall or split the stream.
* **Special Token Normalization**:
  Curly brace closers (`|}`) are normalized to `|>` via `normalizeSpecialToken()`.
  Escaped delimiters (`<{'|'}'` / `{'|'}>`) are de-escaped safely during buffer consumption.

### Gate 2: Categorization & Speech Filtering Gate (`response-categoriser.ts`)
* **Streaming Categorizer**:
  `createStreamingCategorizer.filterToSpeech()` filters text before passing it to speech queues. Special tokens routed to `onSpecial` bypass `onLiteral`, ensuring stickers never reach the speech buffer.
* **Dual-Regex `stripMarkers()` Enforcement**:
  ```typescript
  export function stripMarkers(text: string) {
    return text
      .replace(/<\|[\s\S]*?\|>/g, '')
      // Whitelist update: include STICKER in legacy bare-close regex
      .replace(/<\|(?:ACTOR|ACT|DELAY|STICKER|llm_[\w:-])[^\r\n>]*>/gi, '')
  }
  ```
  `stripMarkers` and `findLegacyCloseTagIndex` must stay in lockstep. Widening one without the other either leaks raw tokens into TTS or silently drops cues.

### Gate 3: TTS & Audio Studio UST Gate (`speech.ts`)
* **Speech Synthesis Input**:
  TTS engines (ElevenLabs, MiniMax, OpenAI, Kokoro, Edge) receive strictly `categorization.speech` or `cleanMessageContent`.
* **Universal Speech Transformer (UST)**:
  `transformTextForSpeech` in `speech.ts` strips emojis and symbols per user settings. The `<|STICKER|>` marker must be stripped *before* entering UST to prevent speech engines from vocalizing "less than bar sticker".

### Gate 4: Caption Subsystem Boundary (`airi-caption-overlay`)
* **Protocol Invariant**:
  Captions broadcast across `airi-caption-overlay` using `CaptionSegment { text, color, actorId, isActive }`.
* **Publisher Decoupling**:
  `useSpeechCaptionPlayer.ts` synchronizes caption chunks with active per-sentence audio playback.
* **Strict Exclusion**:
  Stickers are rich visual manifestations (bubbles or screen slaps), **never spoken subtitles**. Stickers must never generate empty or raw caption segments in floating caption windows (`apps/stage-tamagotchi/src/renderer/pages/caption.vue`), dating-sim inline panels, or Live2D head-tethered planks.

### Gate 5: Storage Twin-Key Contract (`rawContent` vs `content`)
* **`rawContent` (Inference Ground Truth)**:
  Retains the complete, unadulterated LLM stream including all `<|ACT...|>`, `<|ACTOR...|>`, `<|DELAY...|>`, and `<|STICKER...|>` tokens.
  * **Critical Invariant**: When multi-turn chat history is re-fed to the model as inference context, `chat.ts` must use `rawContent || content`. Stripping markers from history causes the model to "forget" sticker syntax (behavioral drift).
* **`content` (Sanitized Display)**:
  Stores clean prose with markers stripped.
* **Outbound / Remote Gate**:
  External consumers (Discord bot outbound, webhook sync, session exports) must pass through `stripMarkers(content)` so remote clients never receive internal tokens.

### Gate 6: Stage Dispatch & Double-Execution Guard (`ControlStripHost.vue`)
* **Queue Dispatch**:
  For desktop screen-slapping, `ControlStripHost.vue` listens to `onTokenSpecial` and maps `<|STICKER <id>|>` to `stickersStore.spawnSticker(id)`.
* **Double-Execution Trap**:
  External mod/plugin messages (`modsServer.onEvent('output:gen-ai:chat:message')`) re-run marker processing. Local streaming messages already execute token-by-token via the speech pipeline's hook.
  * **Requirement**: Guard sticker dispatch with `stage-tamagotchi` / `stage-web` origin flags to ensure a sticker is never spawned twice.

---

## 5. Authoring & Settings Surface: The Acting Tab

Rather than cluttering settings with an obsolete "Modules" tab, sticker settings and preview authoring belong in the **Card Creation / Edit Acting Tab** (`CardCreationTabActing.vue`):

1. **Sticker Expression Section**:
   * Sits alongside **Model Expression Prompt**, **Speech Mannerisms**, and **Pacing Fillers**.
   * Toggle: Enable/Disable Sticker Reactions for this character.
   * Frequency Selector: `Off` | `25%` | `50%` | `75%` | `100%` eligibility.
   * Destination Target:
     * `Chat Only`: Render exclusively within chat bubbles.
     * `Screen Overlay Only`: Slap onto the desktop stage.
     * `Hybrid (Contextual)`: Slap onto desktop when stage window is focused; keep in chat when workspace chatbox is focused.
2. **Library Manager Modal**:
   * Previews all registered stickers with their emotion tags (`happy`, `sad`, `celebrate`, etc.).
   * Drag-and-drop custom image importer with automatic PNG/WebP downscaling.
   * Test Spawn Button: Slaps the selected sticker onto the screen immediately for visual testing.

---

## 6. Bundled Assets: Default AIRI Chibi Pack

The initial release bundles the 12 transparent chibi AIRI reaction PNGs from upstream PR #2714 in `packages/stage-ui/src/assets/stickers/`:

| Sticker ID | Canonical Emotion | Prompt / Visual Focus |
| :--- | :--- | :--- |
| `airi-happy` | `happy` | Cheerful smile, sparkling eyes |
| `airi-sad` | `sad` | Teardrop, downturned mouth |
| `airi-angry` | `angry` | Pouting cheeks, steam puff |
| `airi-confused` | `confused` | Tilted head, question mark |
| `airi-surprised` | `surprised` | Wide eyes, open mouth |
| `airi-thanks` | `thanks` | Clasped hands, warm blush |
| `airi-celebrate` | `celebrate` | Party popper, confetti |
| `airi-tired` | `tired` | Droopy eyes, sigh bubble |
| `airi-affectionate` | `affectionate` | Floating hearts, gentle gaze |
| `airi-awkward` | `awkward` | Sweat drop, hesitant smile |
| `airi-agree` | `agree` | Nodding, thumbs up |
| `airi-disagree` | `disagree` | Crossed arms, head shake |

---

## 7. Dormant Codebase Harvest & Implementation Plan

This architecture reactivates and unifies dormant code already present in `dasilva333/airi`:

| Component | File Path | Existing State | Action Needed |
| :--- | :--- | :--- | :--- |
| **Pinia Store** | `packages/stage-ui/src/stores/stickers.ts` | Fully implemented (localforage, rotation jitter, decay) | Align sticker catalog interface with upstream emotion tags |
| **Stage Overlay** | `packages/stage-ui/src/components/scenarios/stickers/sticker-stack.vue` | Implemented, exported in index.ts | Mount in `RendererStage.vue` / `ControlStripHost.vue` |
| **DOM Widget** | `packages/stage-ui/src/components/scenarios/stickers/sticker-widget.vue` | Implemented (drag, physics, tilt) | Verify styling and UnoCSS classes |
| **Chat Component** | `packages/stage-ui/src/components/scenarios/chat/components/sticker.vue` | Upstream PR #2714 | Port into `packages/stage-ui/src/components/scenarios/chat/components/` |
| **Bubble Integration**| `packages/stage-ui/src/components/scenarios/chat/components/assistant-item.vue` | Lacks `slice.type === 'sticker'` | Add `<ChatSticker />` slice rendering branch |
| **Marker Parsing** | `packages/stage-ui/src/composables/llm-marker-parser.ts` | Parses `<|ACT:..|>` | Add `<|STICKER` to `findLegacyCloseTagIndex` whitelist |
| **Marker Stripping**| `packages/stage-ui/src/composables/response-categoriser.ts` | Strips `<|ACT..|>` | Add `STICKER` to legacy bare-close regex |
| **Authoring UI** | `packages/stage-pages/src/pages/settings/airi-card/components/tabs/CardCreationTabActing.vue` | Acting tab live | Add Sticker Acting section and modal trigger |
