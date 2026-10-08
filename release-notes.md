# 🚀 AIRI v0.9.37-stable.20261008 — Release Notes

This release introduces two major breakthroughs in AI companion design: the **Emotion Calibration Studio & Rehearsal Room**—giving creators an interactive 3-step environment (`Meet` ➔ `Name` ➔ `Verify`) to calibrate avatar expressions with live face framing, diagnostic probes, and System-1 emotion classification—and the **RWKV Persona Foundry**, which unlocks **Zero-Prompt Recurrent State Cartridges** (`.state.bin`) to bake companion lore and speaking style directly into the model's recurrent hidden state without consuming a single prompt token.

Alongside visual calibration and state conditioning, companions now feature **Streaming Autonomous Cues** synchronized with spoken audio, custom **Reaction Sticker Uploads** with dual in-chat and on-stage viewport slapping (including a new Lupin sticker pack), on-device vector search powered by **EmbeddingGemma 2 (Q4)** with Matryoshka representation learning, native support for **Remote Streamable HTTP MCP Servers**, the **Opper Model Provider**, and a **Tray-Only Menu Bar Mode** for distraction-free presence.

---

## ✨ Product Updates

### 🎭 Emotion Calibration Studio & Rehearsal Room
* **Standalone Emotion Calibration Studio**: Introduced a dedicated calibration environment (`/settings/emotions/studio`) designed for fine-tuning facial expressions and body morphs with instant visual feedback.
* **Guided 3-Step Calibration Pipeline**: Experience a stepped workflow (`Meet` ➔ `Name` ➔ `Verify`) featuring live avatar face framing, custom expression overrides, and a comprehensive verification table with reactive personality enhancements.
* **Multi-Phase Rehearsal Room**: Rehearsal room featuring live inline stage previews, curated allowlist baking, and a dedicated System-1 classification toggle with real-time model provider badges.
* **Dedicated Idling Behaviors**: Decomposed the Acting tab to add an independent Idling management panel for configuring idle animations, breathing cycles, and ambient stage presence.

### ⚡ RWKV Persona Foundry & Recurrent State Cartridges
* **Interactive 4-Step Persona Foundry Wizard**: Created a dedicated distillation studio (`/settings/airi-card/foundry`) to distill character cards into portable recurrent state cartridges (`.state.bin`), featuring a 4-tier depth matrix (Quick, Standard, Deep, Comprehensive) and an in-situ taste-test preview with cached primed states.
* **Zero-Prompt Recurrent State Conditioning**: Pre-bakes character lore, mannerisms, and instructions directly into the neural network's recurrent hidden state tensor—completely bypassing prompt token length limits, context window bloating, and KV-cache warm-up latency.
* **State Cartridge V2 ZIP Export**: Distilled `.state.bin` cartridges are seamlessly packaged into single-card ZIP bundles alongside avatar assets for instant zero-prompt sharing.
* **RWKV-7 "Goose" G1 Multi-Model Support**: Upgraded the local WebGPU inference engine to support the newest RWKV-7 G1 architectures with linear-time memory efficiency.
* **Offline Prefab Quantization Pipeline**: Restored the CBOR `.prefab` quantization compiler with direct Hugging Face prefab downloads for instant local execution with minimal VRAM overhead.

### 🎬 Autonomous Acting Cues & Audio Synchronization
* **Live Streaming Autonomous Cues**: Expressions and gestures are now parsed and triggered in real-time as dialogue streams from the LLM, eliminating awkward pauses before your companion reacts.
* **Audio-Synced Hold and Release**: Facial expressions and motion cues now hold naturally across spoken audio slices and release in cadence with TTS speech output instead of vanishing prematurely.
* **Prompt Token Reverse-Extractor**: Dialogue text automatically infers dynamic emotional intensity and maps expressive nuances to avatar blendshapes without requiring explicit cue tags in system prompts.
* **Unified Avatar Capabilities**: Consolidated fragmented avatar schemas into unified `expressionCapabilities` and `motionCapabilities` structures across Live2D, VRM, MMD, and Spine.

### 🖼️ Emotion Stickers & Dual Viewport Reactions
* **Custom Reaction Sticker Uploads**: You can now upload custom sticker collections directly to any character card via the Card Editor's Acting > Stickers sub-tab.
* **12 Bundled Chibi AIRI & Lupin Stickers**: Ships with both the classic chibi AIRI reaction suite and a brand-new set of animated Lupin reaction stickers.
* **Dual Viewport Reaction Slappers**: Emotion stickers dynamically render inline within chat response bubbles and slap onto the active 3D/2D Stage canvas for heightened visual personality.
* **Prefix-Cache Aligned Directives**: Sticker trigger prompts are structured deterministically in prompt templates to prevent evicting KV caches during active conversations.

### 🌐 Extensible Tooling: Remote Streamable HTTP MCP Servers
* **Remote Streamable HTTP Transport**: Expanded the Model Context Protocol (MCP) beyond local stdio processes, enabling AIRI to connect directly to external MCP servers over streamable HTTP/HTTPS.
* **Secure Remote Header Authentication**: Configure custom authorization headers (`Authorization: Bearer <token>`) per remote server to securely connect to private cloud-hosted or intranet MCP tool suites.
* **Streamable Remote Badges**: The Settings MCP management dashboard now visually identifies remote HTTP endpoints and monitors live connection health.

### 💃 3D Avatar Rendering, Performance & Lighting Polish
* **Configurable VRM Frame Rate Limiter**: Added dedicated FPS clamping options (30 / 60 / uncapped) to drastically reduce GPU power draw and battery consumption during background operation.
* **Zero-Thrashing Gaze & Head Tracking**: Replaced synchronous DOM layout queries with reactive element boundary listeners, eliminating animation micro-stutter during gaze tracking.
* **Restored Lighting Orbit Controls**: Brought back orbital lighting manipulation for VRM and MMD avatars, complete with warm studio lighting defaults.
* **Graceful Stage Cleanup**: Animation frame loops and canvas drag event listeners now cancel immediately upon unmounting, preventing memory leaks and background CPU cycles.

### 🧠 Cognition, Semantic Search & Desktop Shell Polish
* **EmbeddingGemma 2 (Q4) Semantic Vector Search**: Migrated the local on-device memory search worker to `EmbeddingGemma 2` (Q4 ONNX) with 256-dimensional Matryoshka representation learning (MRL) and asymmetric task prefixing (`query:` vs `title: ... | text: ...`), delivering substantially higher recall for companion memories.
* **Opper Model Provider**: Added native support for the Opper provider platform, complete with structured outputs, function calling, and distributed tracing.
* **Provider-Level Token Usage Dashboard**: The Usage Stats settings card now tracks and visualizes prompt, completion, and reasoning token consumption segmented by provider.
* **Tray-Only Menu Bar Mode**: Added a setting to hide AIRI's application icon from the macOS Dock and Windows taskbar, allowing your companion to run entirely as a sleek menu-bar / system tray accessory.
* **Settings Reset & Storage Resilience**: Resolved an issue in `useLocalStorageManualReset` where resetting deeply-nested settings failed to restore default values due to reactive proxy sharing.
* **Prompt Token Bloat Protection**: Prevented heavy base64 image data payloads from leaking into text journal tool responses, keeping prompt contexts lean.
* **Tilde Syntax Code Fences**: Upgraded the Markdown parser to render and syntax-highlight code blocks wrapped in `~~~` fences alongside standard triple backticks.

---

## 🌐 Community & Upstream Radar
* **Chibi Emotion Stickers**: Ported and adapted the chibi reaction sticker suite from upstream PR [#2714](https://github.com/moeru-ai/airi/pull/2714) by **@reverieach**, extending it with custom user uploads and dual in-chat/on-stage viewport slapping.
* **Remote MCP over Streamable HTTP**: Inspired by upstream PR [#2821](https://github.com/moeru-ai/airi/pull/2821) by **@clansty**, bringing remote HTTP/HTTPS streaming transports and header security to AIRI's MCP tool bridge.
* **Opper Model Provider**: Integrated the Opper platform provider from upstream PR [#2842](https://github.com/moeru-ai/airi/pull/2842) by **@johan-opper**.
* **VRM Frame Rate Limiting & Layout Performance**: Adopted frame rate bounding and head-pose layout thrashing mitigations from upstream PRs [#2609](https://github.com/moeru-ai/airi/pull/2609) and [#2608](https://github.com/moeru-ai/airi/pull/2608) by **@Penluna**.
* **Tray-Only Dock Presence & Animation Checkbars**: Sourced the tray-only app icon setting from upstream PR [#2700](https://github.com/moeru-ai/airi/pull/2700) and accessible toggle checkbars from [#2740](https://github.com/moeru-ai/airi/pull/2740) by **@Penluna**.
* **Reactive Storage Reset Fix**: Sourced the recursive reactive proxy reset solution in `useLocalStorageManualReset` from upstream PR [#2872](https://github.com/moeru-ai/airi/pull/2872) by **@Penluna**.
* **TTS Grapheme Cluster Preservation**: Integrated speech audio chunking fixes from upstream PR [#2369](https://github.com/moeru-ai/airi/pull/2369) by **@nekomeowww** to ensure multi-code-unit symbols and emojis are pronounced faithfully without audio clipping.
* **Journal Data Isolation & Tilde Highlighting**: Incorporated journal tool image data isolation from upstream PR [#2788](https://github.com/moeru-ai/airi/pull/2788) by **@nekomeowww** and tilde code block rendering from upstream PR [#2797](https://github.com/moeru-ai/airi/pull/2797) by **@starvingarc**.
* **Desktop Process Resiliency**: Integrated module-level single-instance guards and file closure safety checks from upstream PRs [#2824](https://github.com/moeru-ai/airi/pull/2824) and [#2826](https://github.com/moeru-ai/airi/pull/2826) by **@bitxwolf**.
