# 🚀 AIRI v0.9.37-stable.20261006 — Release Notes

This release introduces the brand new **Emotion Calibration Studio** and **Rehearsal Room**—giving creators an interactive, guided 3-step environment (`Meet` ➔ `Name` ➔ `Verify`) to test, calibrate, and fine-tune avatar expressions with live face framing, diagnostic probes, and System-1 emotion classification. Alongside visual calibration, companions now feature **Streaming Autonomous Cues**, enabling dynamic facial expressions and body language that trigger organically during live LLM generation and stay perfectly synchronized with spoken audio playback.

Under the hood, this update debuts a local **Chibi AIRI Emotion Sticker Library** with dual in-chat and on-stage viewport slapping, restores full offline `.prefab` layer quantization for the **Web-RWKV Engine** (supporting the latest RWKV-7 "Goose" G1 models on WebGPU), unlocks **Remote Streamable HTTP MCP Servers** with custom header authorization, adds a provider-level **Inference Token Telemetry Dashboard**, integrates a **Tray-Only Menu Bar Mode** for distraction-free presence, and eliminates layout thrashing during 3D avatar head tracking and gaze loops.

---

## ✨ Product Updates

### 🎭 Emotion Calibration Studio & Rehearsal Room
* **Standalone Emotion Calibration Studio**: Introduced a dedicated calibration environment (`/settings/emotions/studio`) designed for fine-tuning facial expressions and body morphs with instant visual feedback.
* **Guided 3-Step Calibration Pipeline**: Experience a stepped workflow (`Meet` ➔ `Name` ➔ `Verify`) featuring live avatar face framing, custom expression overrides, and a comprehensive verification table with reactive personality enhancements.
* **Multi-Phase Rehearsal Room**: Rehearsal room featuring live inline stage previews, curated allowlist baking, and a dedicated System-1 classification toggle with real-time model provider badges.
* **Dedicated Idling Behaviors**: Decomposed the Acting tab to add an independent Idling management panel for configuring idle animations, breathing cycles, and ambient stage presence.

### 🎬 Autonomous Acting Cues & Audio Synchronization
* **Live Streaming Autonomous Cues**: Expressions and gestures are now parsed and triggered in real-time as dialogue streams from the LLM, eliminating awkward pauses before your companion reacts.
* **Audio-Synced Hold and Release**: Facial expressions and motion cues now hold naturally across spoken audio slices and release in cadence with TTS speech output instead of vanishing prematurely.
* **Prompt Token Reverse-Extractor**: Dialogue text automatically infers dynamic emotional intensity and maps expressive nuances to avatar blendshapes without requiring explicit cue tags in system prompts.
* **Unified Avatar Capabilities**: Consolidated fragmented avatar schemas into unified `expressionCapabilities` and `motionCapabilities` structures across Live2D, VRM, MMD, and Spine.

### 🖼️ Emotion Stickers & Dual Viewport Reactions
* **12 Bundled Chibi AIRI Reaction Stickers**: Integrated a high-resolution chibi AIRI emotion sticker library into chat and stage rendering pipelines.
* **Dual Viewport Reaction Slappers**: Emotion stickers dynamically render inline within chat response bubbles and slap onto the active 3D/2D Stage canvas for heightened visual personality.
* **Configurable Reaction Frequency**: Added a dedicated Stickers panel in Character Card Acting settings to adjust sticker reaction density, destination targets, and audition previews.

### ⚡ Web-RWKV Engine: RWKV-7 "Goose" Architecture & Offline Prefabs
* **RWKV-7 G1 Multi-Model Support**: Upgraded the local WebGPU inference engine to support the newest RWKV-7 "Goose" G1 model architectures with linear-time memory efficiency.
* **Offline Prefab Quantization Pipeline**: Restored the CBOR `.prefab` quantization compiler with direct Hugging Face prefab downloads for instant, zero-setup local execution with minimal VRAM overhead.
* **Local Inference Benchmark Playground**: Added an interactive benchmarking surface to measure tokens-per-second throughput and real-time GPU memory allocation across quantized layers.

### 🌐 Extensible Tooling: Remote Streamable HTTP MCP Servers
* **Remote Streamable HTTP Transport**: Expanded the Model Context Protocol (MCP) beyond local stdio processes, enabling AIRI to connect directly to external MCP servers over streamable HTTP/HTTPS.
* **Secure Remote Header Authentication**: Configure custom authorization headers (`Authorization: Bearer <token>`) per remote server to securely connect to private cloud-hosted or intranet MCP tool suites.
* **Streamable Remote Badges**: The Settings MCP management dashboard now visually identifies remote HTTP endpoints and monitors live connection health.

### 💃 3D Avatar Rendering, Performance & Lighting Polish
* **Configurable VRM Frame Rate Limiter**: Added dedicated FPS clamping options (30 / 60 / uncapped) to drastically reduce GPU power draw and battery consumption during background operation.
* **Zero-Thrashing Gaze & Head Tracking**: Replaced synchronous DOM layout queries with reactive element boundary listeners, eliminating animation micro-stutter during gaze tracking.
* **Restored Lighting Orbit Controls**: Brought back orbital lighting manipulation for VRM and MMD avatars, complete with warm studio lighting defaults.
* **Graceful Stage Cleanup**: Animation frame loops and canvas drag event listeners now cancel immediately upon unmounting, preventing memory leaks and background CPU cycles.

### 🧠 Cognition, Token Telemetry & Desktop Shell Polish
* **Provider-Level Token Usage Dashboard**: The Usage Stats settings card now tracks and visualizes prompt, completion, and reasoning token consumption segmented by provider.
* **Tray-Only Menu Bar Mode**: Added a setting to hide AIRI's application icon from the macOS Dock and Windows taskbar, allowing your companion to run entirely as a sleek menu-bar / system tray accessory.
* **Prompt Token Bloat Protection**: Prevented heavy base64 image data payloads from leaking into text journal tool responses, keeping prompt contexts lean.
* **Tilde Syntax Code Fences**: Upgraded the Markdown parser to render and syntax-highlight code blocks wrapped in `~~~` fences alongside standard triple backticks.
* **Router Deadlock Elimination**: Resolved navigation locks when rapidly switching between settings tabs and accelerated card editor opening performance.

---

## 🌐 Community & Upstream Radar
* **Chibi Emotion Stickers**: Ported and adapted the chibi reaction sticker suite from upstream PR [#2714](https://github.com/moeru-ai/airi/pull/2714) by **@reverieach**, extending it with dual in-chat and on-stage viewport slapping.
* **Remote MCP over Streamable HTTP**: Inspired by upstream PR [#2821](https://github.com/moeru-ai/airi/pull/2821) by **@clansty**, bringing remote HTTP/HTTPS streaming transports and header security to AIRI's MCP tool bridge.
* **VRM Frame Rate Limiting & Layout Performance**: Adopted frame rate bounding and head-pose layout thrashing mitigations from upstream PRs [#2609](https://github.com/moeru-ai/airi/pull/2609) and [#2608](https://github.com/moeru-ai/airi/pull/2608) by **@Penluna**.
* **Tray-Only Dock Presence & Animation Checkbars**: Sourced the tray-only app icon setting from upstream PR [#2700](https://github.com/moeru-ai/airi/pull/2700) and accessible toggle checkbars from [#2740](https://github.com/moeru-ai/airi/pull/2740) by **@Penluna**.
* **TTS Grapheme Cluster Preservation**: Integrated speech audio chunking fixes from upstream PR [#2369](https://github.com/moeru-ai/airi/pull/2369) by **@nekomeowww** to ensure multi-code-unit symbols and emojis are pronounced faithfully without audio clipping.
* **Journal Data Isolation & Tilde Highlighting**: Incorporated journal tool image data isolation from upstream PR [#2788](https://github.com/moeru-ai/airi/pull/2788) by **@nekomeowww** and tilde code block rendering from upstream PR [#2797](https://github.com/moeru-ai/airi/pull/2797) by **@starvingarc**.
* **Desktop Process Resiliency**: Integrated module-level single-instance guards and file closure safety checks from upstream PRs [#2824](https://github.com/moeru-ai/airi/pull/2824) and [#2826](https://github.com/moeru-ai/airi/pull/2826) by **@bitxwolf**.
