# 🚀 AIRI Next Release Notes

This release streamlines the canonical **Onboarding V3** journey down to 18 steps—introducing a live in-step LLM dialogue simulator, 100% offline neural starter voices, automated Hugging Face gate helpers, and a unified Proactivity & Screen Awareness console.

Alongside the onboarding polish, this update introduces a **Coordinated Startup Splash Screen** featuring a 3D levitating holographic card loader with synchronized background avatar mounting, adds **Free AI and Character Wizard 3-Way Modal Pickers** with a dedicated **Card Import Hub**, bundles an **Offline Starter Voice Catalog** with 18 zero-shot voices, hardens the **Autonomous Artistry Image Journal Tool**, implements **Live2D Parameter Blend Modes & Timed ACT Expression Cues**, expands the **AIRI Arcade Studio** with cleanroom replay telemetry, and brings hardware-accelerated **WebGPU support to System 1 Laya Cognition**.

---

## ✨ Product Updates

### 🧭 Onboarding V3: Streamlined Steps & First-Run Enhancements
* **Account & Architecture**: Added resilient Cloudflare OAuth auto-refresh to prevent unexpected session disconnects, alongside clearer architecture benefits for local air-gapped vs. cloud-synced companions.
* **Experience Archetypes**: Refined the 6 companion archetype presets and balanced the module selection grid into a clean, symmetrical 5×2 layout with extensible plugin placeholders.
* **Consciousness**: Added a built-in live Dialogue Simulator directly inside the step, letting you test multi-turn LLM reasoning, response latency, and conversational banter before proceeding.
* **Speech**: Added one-click offline starter voice bypasses (ReLU, Sakura, Dr. Aria) requiring zero tokens, alongside HF token format validation and direct "Accept Gate" shortcuts for Pocket-TTS.
* **Emotions**: Added an expression noise gate that filters out internal VRoid mesh rigging morphs (`Fcl_*`) to prevent face twitching, plus built-in starter presets (AvatarSample_A/B, Hiyori) with one-click force recalibration.
* **Vision**: Added verified Cloudflare Workers AI multimodal vision models (Llama 4 Scout 17B, Mistral Small 3.1 24B, Qwen 3.8 27B) with bidirectional strategy synchronization.
* **Proactivity & Awareness**: Consolidated daily operating routines and desktop screen perception into a single unified step, streamlining the canonical onboarding flow from 19 to 18 steps.

### 🎬 Coordinated Startup: Standalone Splash Screen & Boot Milestones
* **Dedicated MPA Splash Screen**: Replaced the static loading screen with a standalone multi-page application splash screen (`splash.html`) that launches instantly upon desktop startup.
* **3D Levitating Holographic Card Loader**: Rendered a perspective-depth 3D levitating card loader with dynamic metallic light glints and smooth floating keyframes while boot milestones load.
* **Milestone-Driven Boot Lifecycle**: Communicates startup stages over IPC (`core` ➔ `models` ➔ `stage-ready` ➔ `ready`), giving real-time visual progress as background engines initialize.
* **Synchronized Avatar Pre-Mounting**: The avatar vessel now mounts silently behind the splash screen, eliminating visual stutter, model pop-in, or T-pose flashes when entering the stage.
* **Zero-Click Auto-Close**: Once both the runtime and the avatar stage report ready, the splash screen holds for 350ms and performs an elegant CSS fade-out exit before closing.
* **Persistent Hidden Intent**: If you launch AIRI minimized or hidden, your companion respects that choice across splash dismissals without unexpectedly stealing focus.

### ⚙️ Settings Quick Access & Dedicated Card Import Hub
* **Character Wizard 3-Way Modal**: Clicking "Character Wizard" in Settings Quick Access now opens a 3-way modal directing you to the full 18-step Onboarding V3 wizard, the AnimaDex Cast Wizard, or the dedicated Card Import Hub.
* **Dedicated Card Import Hub**: Introduced a full-screen landing page (`/settings/airi-card/import-hub`) for rapid drag-and-drop importing of Character Card V2/V3 PNGs, standalone JSONs, and complete single-card ZIP archives.
* **Free AI 3-Way Modal**: Replaced the direct jump on "Free AI" with a curated 3-card modal letting you choose between the Free AI Hub (Cloud · 50+ Models), WebLLM Local / Apple Core AI (WebGPU / Apple Silicon · 100% Private), and Web-RWKV Local (RNN · Constant VRAM).
* **Multi-Layer Indicator Badges**: Quick Access buttons now feature subtle layered badges in their top-right corners to visually highlight actions that open multi-option selection modals.

### 🎨 Autonomous Artistry & Image Journal Tooling
* **Resilient Parameter Resolution**: Hardened the `image_journal` tool to defensively accept any prompt key variant passed by diverse LLMs (`prompt`, `description`, `text`, `content`, `caption`, `query`) without failing.
* **Automatic Action Inference & Prompt Injection**: The image journal tool automatically infers missing action names (defaulting to `create` or `apply`), while system prompts now dynamically inject artistry widget instructions whenever Artistry is active on the companion or globally.

### 🎙️ Neural Voice Studio: Offline Starter Voices & Zero-Shot Local TTS
* **18 Bundled Offline Starter Voices**: AIRI now ships with a complete offline starter voice library in `packages/stage-ui/src/assets/voices/`—including ReLU (Empathetic), Sakura (Japanese), Dr. Aria (Professional), Kira, Mio, Sebastian, and 12 other distinct vocal archetypes.
* **Tokenless Zero-Shot Synthesis**: Enjoy expressive, local neural speech powered by Kokoro and Pocket-TTS with zero external network requests and no API keys required.
* **Lightweight Local Voice Picker**: Added a quick 3-card engine picker modal in Settings for fast switching between Pocket-TTS, Kokoro, and Moss-Nano.

### 💃 Avatar Staging: Live2D Blend Modes, Soft Loading & ACT Duration Cues
* **Live2D Parameter Blend Modes**: Full mathematical support for Cubism Add, Multiply, and Overwrite parameter blending, ensuring complex layered expressions (blushing, sweat drops, lighting overlays) render faithfully without clipping.
* **Soft Optional Asset Loader**: Third-party Live2D zip archives with missing `.exp3.json`, `.motion3.json`, physics, or pose definitions now load gracefully with synthetic fallback stubs instead of throwing uncaught loader errors.
* **ACT Token Duration Cues**: The ACT parser now understands timed durations in seconds (e.g., `<|ACT:emotion="smile",duration="3"|>`), automatically managing facial expression reset timers across Live2D, VRM, and Stage-Mate Unity sidecars.

### 🕹️ AIRI Arcade Studio: Cleanroom Replay Engine & CRT Calibration
* **Full-Screen Arcade Hub**: Introduced a dedicated Arcade Hub with 6-facet catalog filtering, difficulty classification, and game bundle discovery.
* **Cleanroom Replay Visualizer**: Upgraded replay tools with an accumulated game board visualizer and half-block character rendering.
* **80×40 Grid Diff Collector**: High-frequency frame diff analysis that captures state changes and synthesizes strategy extractors automatically.
* **Full 4:3 CRT Viewport**: Expanded calibration viewports to native 4:3 CRT framing with a 15-second calibration inspection view.

### 🧠 Cognition, Memory & Cloud Models
* **Reusable Mind Map Overview**: Extracted the Knowledge Graph dashboard into an interactive, reusable component (`KnowledgeGraphOverview.vue`) featuring relationship explorers, cluster metrics, and entity inspector cards.
* **Precision Proper Noun Extraction**: Memory indexing now intelligently strips sentence-initial capitalization noise ("The", "A", "When", "Because"), keeping your companion's knowledge graph free of meaningless grammatical entities.
* **Hardware-Accelerated Laya Engine (System 1)**: Resolved FP16 precision crashes and added a dedicated WebGPU hardware acceleration toggle with automatic CPU/WASM fallback for local System-1 classification.
* **Cloud Model Selector Auto-Tagging**: The model selection dialog now automatically tags capabilities (multimodal, tool-calling) and links cloud models directly to your active companion card, with responsive formatting tailored for mobile and narrow screens.

---

## 🌐 Community & Upstream Radar
* **Character-Owned Live2D Controls & Motion Hooks**: Sourced inspiration from upstream PR [#2458](https://github.com/moeru-ai/airi/pull/2458) by **@nekomeowww** into our Live2D parameter blending maths (Cubism Add/Multiply/Overwrite) and soft zip archive error resilience.
* **Coordinated Splash Lifecycle**: Sourced concept ideas from upstream PR [#2698](https://github.com/moeru-ai/airi/pull/2698) by **@nekomeowww**, taking it further into our standalone multi-page application splash screen with milestone IPC and background avatar pre-mounting.
* **AIRI Design System Conventions**: Aligned with the canonical design specification established by **@RainbowBird** in upstream PR [#2689](https://github.com/moeru-ai/airi/pull/2689), reinforcing chromatic hue standards and responsive component sizing across our desktop and mobile views.
