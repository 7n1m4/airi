# AIRI Card Character System

![AIRI Card Character System](/showcase/hero-01-card-system.avif)

The **AIRI Card Character System** elevates characters from static prompts into living, portable, multi-faculty entities. Supporting both native JSON (`.airi` v1) and SillyTavern `chara_card_v2`/`v3` PNG formats with embedded chunk encoding, cards bundle their 3D/2D vessels, custom wardrobes, audio profiles, acting directives, and autonomous schedules into a single self-contained asset that can be shared across machines.

---

## 10-Tab Deep Configuration Editor

The card editor is a comprehensive management environment organized across 10 specialized configuration tabs:

### 1. Identity & Narrative Persona

![Identity Tab](/showcase/card-editor-tab-identity.avif)

Configures the foundational persona and world context:
- Name, nickname, and creator attribution with live character avatars.
- Markdown-capable description and personality trait definition.
- Dynamic system prompt drafting with blank-field preservation.

### 2. Generation & Model Tuning

![Generation Tab](/showcase/card-editor-tab-generation.avif)

Enables granular, per-character inference overrides:
- Dedicated provider, model, temperature, top-p, and frequency penalty controls.
- Context window budgeting and sliding-window token management.
- Custom stop sequences and structured output schemas.

### 3. Acting & Conversational Pacing

![Acting Tab](/showcase/card-editor-tab-acting-pacing.avif)

Aligns physical embodiment with speech and mannerisms across three distinct prompt layers:
- **Model Expression Prompt**: Teaches the LLM to emit inline `<|ACT:emotion="..."|>` and `<|ACT:motion="..."|>` tags mapped to avatar blendshapes.
- **Speech Delivery Prompt**: Tunes phonetic cadences and emotional audio delivery.
- **Character Mannerism Prompt**: Enforces distinctive verbal idioms and phrasing habits.

### 4. Modules & Embodiment Bindings

![Modules Tab](/showcase/card-editor-tab-modules.avif)

Binds the character to their primary stage presence:
- Assigns default 3D VRM, Live2D cubism, Spine, or MMD avatar models.
- Links preferred speech synthesis voices and audio transformers.
- Automatically swaps stage backgrounds and visual atmosphere on character activation.

### 5. Artistry & Autonomous Director

![Artistry Tab](/showcase/card-editor-tab-artistry-director.avif)

Defines generative visual styling for the character:
- Preferred image generation workflows (ComfyUI, Replicate, Pollinations).
- Positive and negative character prompt tokens for AI self-portraits.
- Director grading thresholds for autonomous scene generation during conversation.

---

## Proactivity, Memory & Operating Schedules

AIRI characters operate on proactive schedules even when you are not actively chatting:

### Operating Schedules & Cognitive Heartbeats

![Operating Schedule](/showcase/card-editor-proactivity-operating-schedule.avif)

- **Operating Schedule**: Sets character waking hours, bedtime routines, and weekend pacing.
- **Cognitive Heartbeats**: Periodic background evaluation of user activity, active desktop windows, and idle duration to initiate spontaneous check-ins.

![Cognitive Heartbeats](/showcase/card-editor-proactivity-heartbeats.avif)

### Screen Watching & 24-Hour Memory Consolidation

![Screen Watching](/showcase/card-editor-proactivity-screen-watching.avif)

- **Screen Perception**: OCR and vision-language analysis enabling characters to comment on games, code, or video streams.
- **24-Hour Memory Consolidation**: Nightly dreaming engine that synthesizes Short-Term Memory into durable Long-Term Text Journals and Lifetime Archives.

![24-Hour Memory Consolidation](/showcase/card-editor-proactivity-24h-memory.avif)

---

## Interoperability & Community Hubs

![Character Gallery Grid](/showcase/card-system-gallery-grid.avif)

- **Drag-and-Drop Import Wizard**: Drop SillyTavern PNG cards or JSON files anywhere on the app for instant parsing with automatic collision renaming.
- **In-App Webview Browser**: Browse character card repositories and community hubs (Chub.ai, CharacterHub) directly within AIRI and import cards with a single click.

![In-App Webview Browser](/showcase/card-system-inapp-webview.avif)

---

## Key Capabilities

- **Native JSON & SillyTavern PNG Interop**: Lossless import/export of CCv2/CCv3 cards with full chunk integrity.
- **Complete Asset Bundling**: Bundles VRM/Live2D models, audio profiles, and scene backgrounds upon export.
- **10-Tab Deep Editor**: Granular control spanning identity, acting cues, generation params, and proactivity.
- **Autonomous Operating Schedules**: Circadian rhythms, cognitive heartbeats, and screen-watching triggers.
- **Nightly Dreaming Engine**: Continuous memory consolidation into permanent journal archives.
- **In-App Community Hub Browser**: Integrated webview for 1-click downloads from character repositories.
