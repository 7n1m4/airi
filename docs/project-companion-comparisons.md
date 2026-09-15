# Project Companion Comparisons: Canonical Architecture & Capability Dossier

**Document ID:** `docs/project-companion-comparisons.md`
**Status:** Living Architectural Evaluation Ledger · Active
**Initial Baseline:** 2026-09-14
**Primary Benchmark:** `dasilva333/airi`

---

## 1. Mission & The Evaluation Standard

### 1.1 Beyond Superficial Checkboxes: The "Cognitive Integration Depth" Metric

Most AI companion comparisons evaluate products using simplistic binary checklists: *"Supports VRM: Yes/No"*, *"Supports Live2D: Yes/No"*, *"Has Voice: Yes/No"*.

In practice, binary checkboxes are misleading. There is a fundamental architectural chasm between:

1. **A Static Mascot** (*The Baseline Companion*):
   - Ingests a `.vrm` or `.model3.json` into a transparent viewport.
   - Loops a canned idle animation, blinks on a generic timer, and triggers hardcoded facial expressions only when an LLM produces rigid tags like `[happy]`.
   - Relies on basic push-to-talk, unbuffered audio streams, or closed third-party cloud APIs.
   - Treats the model as decorative visual wallpaper disconnected from reasoning and memory.

2. **A Cognitively Integrated Avatar Engine** (*The AIRI Standard*):
   - **Live2D as an Executable State Machine**: Comprehensive backward and forward compatibility supporting **Live2D Cubism 2.1, 3.0, 4.0, and 5.0** (from legacy `.moc` to modern `.moc3`). Executes custom Turing-complete DSL scripts with dynamic state variables (`VarFloats`), branching conditional choice trees, chained motions (`start_mtn`), runtime costume commands (`change_cos`), and sound effects.
   - **VRM as a Dynamic Performance Canvas**:
     - *Procedural Text-to-Motion*: Synthesizes brand-new skeletal animations on the fly from prompt descriptions via LLM keyframing / FlowMDM.
     - *Visual Effects & Dynamic Expression Morphs*: Spawns particle VFX and emotion auras dynamically anchored to skeletal bones while driving fine-grained model blendshapes (`ThreeScene.vue`).
     - *In-App Texture Surgery*: AI repainting, MToon material inspection, and direct texture export in Texture Forge.
   - **Multiple Personalities / Dynamic Multi-Character Switching (`<|ACTOR|>` Tokens)**: A single conversational turn can dynamically switch speaking roles across completely different avatar runtimes and voice profiles with synchronized blendshapes and voice handoffs.
   - **Unity High-Fidelity Sidecar (`apps/stage-mate`)**: Offloads to a dedicated Unity C# companion sidecar for tactile physics, camera tracking, and transparent desktop rendering.
   - **2-Pass ACT Expression Bridge**: Normalizes arbitrary vendor blendshapes and morph targets into structured `<|ACT:*|>` tokens with explicit character performance directives.

---

#### 1.2 Lessons from the September 2026 Competitive Audit

An independent 11-page competitive evaluation published on September 14, 2026 reviewed visible AI companions and forks. It recommended `dasilva333/airi` second overall for a Windows desktop trial behind Project N.E.K.O., while identifying `dasilva333/airi` as the **strongest active general-purpose AIRI fork in the sampled forks**.

The audit revealed a core structural asymmetry:
- **Asymmetric Scrutiny**: AIRI was subjected to forensic static and operational code auditing (CI run IDs, commit SHAs, Vitest assertion boundaries, NSIS uninstaller configs, and README download links). Competitors were evaluated predominantly by Steam store listings, marketing claims, and user review counts.
- **The Circular Pigeonhole Trap**: The audit assigned generic user needs to competitors (*"VRM character with local memory"* to Utsuwa, *"Advanced local roleplay/voice"* to Soul of Waifu, *"Relationship continuity"* to Nomi, *"Windows avatar with low setup"* to N.E.K.O.) while categorizing AIRI circularly as *"Highly customized AIRI experience"*.
- **The Ground Truth Reframe**: AIRI covers every one of those needs with greater depth than the assigned winners—beating Utsuwa on voice (duplex barge-in vs push-to-talk), Soul of Waifu on architecture (modular monorepo vs 1.8 GB RAR), and Nomi on cost/sovereignty ($0 local BYOS vs $16/month closed cloud).

This dossier exists to document the objective, verifiable technical facts across every contender.

---

## 2. Contender Engineering Dossiers

Below are dense, high-level architectural notes for each active desktop companion platform.

---

### 2.1 `dasilva333/airi` (The Sovereign Desktop Benchmark)

- **Architecture**: Decoupled Electron desktop runtime (`apps/stage-tamagotchi`). Clean division between Actor Stage (`RendererStage.vue`), Main Ribbon (`ControlStrip.vue`), and Chat Orchestrator.
- **Embodiment Depth & The Unified Model Canvas**:
  - **4 Native Avatar Runtimes**: Full forward/backward compatibility across VRM 0.0 & 1.0, Live2D Cubism (2.1 `.moc` through 3.0/4.0/5.0 `.moc3`), MMD (PMX physics & VMD motion pipelines), and Spine 2D skeletal.
  - **Unified Idle Animation & Expression System**: Unlike competitors with fragmented or hardcoded scripts, a single unified widget and store architecture drives configurable idle motion cycles, blink timers, and dynamic emotion/motion invocation across *all 4 model types simultaneously*.
  - **Dedicated Unity C# Companion Sidecar (`apps/stage-mate`)**: Offloads high-fidelity physics, tactile collisions, and transparent OS rendering to an absorbed Unity engine.
  - **Kinetic Synthesis & Surgery**: Procedural Text-to-Motion generation via LLM keyframing / FlowMDM, skeletal bone-anchored particle VFX auras, and in-app Texture Forge (MToon surgery, AI repainting).
  - **`<|ACTOR|>` Conceptual State Scoping**: Rather than just switching character models, `<|ACTOR|>` acts as an abstract conceptual container holding live global state, allowing inline `<|ACT:*|>` emotion/motion tokens to influence and mutate the scoped state of each individual actor dynamically within the turn.
- **Speech & Audio Custody**:
  - Full duplex with real-time barge-in cancellation and **Silero VAD** (PR #14, 74 verified pacing tests).
  - Turn pacing coordinator with dynamic thinking fillers during LLM latency.
  - UST speech transformers stripping stage directions and roleplay markdown before synthesis.
  - Custom speech replacement rules & pronunciation lexicons.
  - In-process WebGPU & WASM local neural TTS (**Kokoro-WebGPU**, **Pocket-TTS**, **MOSS-TTS**) + 10+ cloud TTS backends.
  - Reusable per-character Audio Studio profiles (pitch, rate, reverb/filters).
- **Cognition & Staging**:
  - **77 Registered AI Provider Integrations** (across LLM, speech, vision, and tool backends; including 10+ distinct TTS engines and 6+ STT engines).
  - **10-Turn Auditable Tool Execution**: Deeply modularized, testable `core-agent` loop supporting up to 10 sequential tool iterations with strict loop termination guards.
  - **Fine-Grained Tool Context Gating**: Dynamic schema pruning that injects only relevant tool definitions into the LLM context window—eliminating context pollution, token bloat, and prompt confusion.
  - **2-Pass ACT Expression Bridge**: Normalizes dialogue intent to vendor blendshapes with dual-key persistence (`content` vs unstripped `rawContent` to eliminate historical behavioral drift).
  - **Grounding Context Assembler**: VLM screen analysis, telemetry cues, and multi-tier memory injection.
- **Memory & Storage Stack**:
  - **DuckDB-WASM Analytical Engine**: High-performance in-browser analytical database and local vector embedding indexer.
  - **Hybrid Semantic Retrieval Engine**: Combines WebGPU `@huggingface/transformers` (`bge-small-en-v1.5`), in-memory BM25 lexical search, 5W extraction (`who`/`what`/`where`/`when`/`why`), temporal decay, Reciprocal Rank Fusion (RRF, $k=60$), and MMR diversity reranking. Compatible with Long-Context Memory (LoCoMo) retrieval evaluation patterns.
  - **IndexedDB / unstorage / localforage**: Binary-safe repository persistence and outbox queues.
  - **2-Tier Temporal Memory**: Short-Term Memory daily summaries (STMM), immutable Sacred Journal (LTMM), Lifetime Relational Thread, Dreaming Worker consolidation, and Subconscious Echo Chips.
  - Optional user-owned Cloudflare R2/KV backup and selective synchronization (BYOS).
- **Perception & Agency**:
  - Chat photo perception (VLM).
  - Desktop screen watching with Cascaded Salience Gating (lightweight OCR vs Moondream2).
  - Ambient proactivity heartbeats with `NO_REPLY` smart silence directive.
  - Autonomous Artistry Director with ComfyUI Bring-Your-Own-Workflow (`workflow_api.json`).
- **Sovereignty & Economics**:
  - 0 telemetry, 0 tracking pixels, 0 central server operators.
  - 100% local-first IndexedDB and DuckDB-WASM storage.
  - $0 mandatory subscriptions, no metered credit burning.
  - Canonical Onboarding V3 with `Quick Start (60s)`.

---

### 2.2 Upstream AIRI (`moeru-ai/airi`)

- **Architecture**: Monolithic Electron/Web stage retaining the legacy `controls-island` inside the avatar viewport.
- **Embodiment**: Focuses on VRM and Live2D. Live2D keyframe motion recording and timeline workbench. Tachie avatars with emotion-based illustration switching. No MMD or Spine runtimes; Godot 4 experiments unreleased.
- **Inference & Provider Scope**: Retains broad direct provider support (OpenAI, Anthropic, OpenRouter, Ollama, vLLM). Additionally developing hosted cloud services, remote database syncing (PR #2471), prepaid Flux credits via Stripe billing (PR #2533), Apple App Store IAP (PR #2339), and remote email verification (PR #2473).
- **Cognitive Scope**: Single-actor character card model (1:1); no `<|ACTOR|>` mid-stream switching. Memory and journal settings remain in-progress/partial in inspected snapshots.

---

### 2.3 Project N.E.K.O. (`Project-N-E-K-O/N.E.K.O`)

- **Tech Stack & Architecture**: Python 3.11 (`uv`) + FastAPI/Uvicorn + ZeroMQ + Electron/Chromium Web Frontend + PixiJS / Three.js + SQLite FTS5 + Steamworks SDK. Licensed under Apache-2.0.
- **Service Topography**: Split multi-process microservice model:
  - `Port 48911`: Main Application Server (FastAPI / WebSocket streaming `/ws/{character_name}`).
  - `Port 48912`: Dedicated Memory Server daemon.
  - `Port 48915`: Agent Server (ZeroMQ transport for tool calls and computer use).
- **Embodiment Depth**:
  - **Avatar Formats**: Live2D (PixiJS `/api/live2d`), VRM 0.x/1.0 (Three.js `/api/model/vrm`), MMD (`three-mmd`), PNGTuber 2D sprites, and VMC OSC streaming (`/api/vmc`).
  - **Static Playback Model**: Operates as a transparent Electron viewport triggering pre-baked animation clips and blendshapes.
  - **Limits**: No procedural motion diffusion (no Text-to-VRMA), no in-app texture surgery, no bone-attached particle VFX auras, and single-actor viewports only (no mid-sentence multi-actor persona switching).
- **Audio & Voice Custody**:
  - **TTS Engines**: GPT-SoVITS v3 (streaming JSON PCM / raw binary frames), Doubao TTS, CosyVoice, OpenAI-compatible speech.
  - **Duplex Boundaries**: Asynchronous request-response streaming architecture. Lacks sub-50ms native hardware duplex barge-in, speculative thinking fillers, or dynamic spoken asides.
  - **Text Preprocessing**: Basic regex stripping of markdown stage directions; lacks full UST phonetic/token transformers.
- **Memory Architecture**:
  - **Storage**: SQLite backed by FTS5 full-text search with CJK tokenization and vector embeddings. Context budgeting via `tiktoken`.
  - **Memory Inspection**: Features a web-based "Memory Browser" (`/memory`) for manual inspection, editing, and deletion.
  - **Limits**: Lacks multi-tier STMM daily episodic summaries, LTMM immutable Sacred Journal, and dreaming consolidation.
- **Perception & Autonomy**:
  - **Screen Perception**: Proactive screen-capture pipeline with caching to reduce redundant inference. OCR + VLM analysis for computer automation.
  - **Heartbeat Scheduling**: 20s–60s evaluation cycles with dual interaction paths (*Proactive Interrupt* dialogue vs *Passive Callback* system prompt injection).
- **Sovereignty, Telemetry & Performance**:
  - **Steam Telemetry**: `utils/token_tracker/telemetry.py` aggregates token usage, pseudonymized device SHA-256 hashes, and **Steam64 ID** when running under Steamworks (`steam_appid.txt: 4099310`). Can be opted out via `DO_NOT_TRACK=1`.
  - **Windows 11 GPU Overhead (Issue #3059)**: Specific user report of elevated idle GPU utilization on Windows 11 with v0.9.0 in desktop pet mode at medium quality/60 FPS. Mitigated via adaptive framerate throttling in PR #3057.
  - **Offline Capability**: Capable of offline execution only if locally hosted with Ollama/vLLM and local GPT-SoVITS; default experience depends on third-party cloud services.

---

### 2.4 NekoGPT (`NekoGPT-Opensource`)

- **Tech Stack & Architecture**: TypeScript Monorepo (`waifuprogramming-experiencia`) featuring `@nekogpt/contracts`, `@nekogpt/agent`, `@nekogpt/desktop`, `@nekogpt/renderer`, `@nekogpt/avatar-bridge`, and `@nekogpt/services`. Governed by `absolute-nekogpt.md` and packaged via SteamPipe VDF templates (`steam/`, `scripts/prepare-steam-depot.cjs`).
- **Source & Commercial Licensing Reality**:
  - **Closed-Source / Private Commercial App**: Unlike public open-source projects, NekoGPT is a **proprietary, closed-source commercial software product sold on Steam for ~$10 ($9.99 USD)**. Local source access is via private repository collaboration with the author.
  - **Steam Distribution**: Built strictly for Steam release with offline license verification, asset verification trees, and Steamworks depot staging.
- **Core Engineering Philosophy (`absolute-nekogpt.md`)**:
  - **Contract-Driven Decoupling**: Resolves legacy monolithic debt (~162k LOC) by enforcing strict unidirectional layering (`Renderer -> Typed IPC Envelope -> Application Service -> Domain Ports -> Infrastructure Adapters`) with Valibot/Zod schemas.
  - **Offloaded Worker Architecture**: Offloads heavy disk I/O, archive extraction, and database indexing to isolated worker threads (`vite.db-worker.config.ts`, `vite.archive-worker.config.ts`), preventing Electron main event-loop stalls.
  - **Database Worker (`database-worker.js`)**: Executes `sql.js` (WASM SQLite) on worker threads with serialized promise queue depth tracking and 2-phase atomic backups (`.bak` / `.replace-old`).
- **Embodiment Depth**:
  - **Strictly Live2D-Only**: Permanently Live2D Cubism 3/4 only. All 3D runtimes (VRM, Spine, MMD/PMX, Unity, FBX, OBJ) are explicitly purged and enforced via build policy gates (`scripts/release-policy.cjs`).
  - **Avatar Bridge Server (`packages/avatar-bridge`)**: Runs an authenticated local WebSocket server (`ws://127.0.0.1:17878/nekogpt-avatar`) broadcasting structured JSON states with mandatory token handshake.
  - **Emotion & Motion Mapping**: `AGENT_EMOTION_TO_LIVE2D` statically maps 24 distinct emotion keys (`excited`, `confused`, `relieved`, `caring`, `teasing`, `worried`, `shy`, etc.) to Live2D expressions and motions with clamped intensity weighting `[0.0, 1.0]`.
  - **Lip-Sync Pipeline**: Web Audio API RMS volume analysis (`AudioContext` / `AnalyserNode`) mapped directly to Live2D `ParamMouthOpenY`.
  - **Limits**: No procedural motion generation (no Text-to-VRMA), no bone VFX/auras, and texture customization is limited to ArtMesh RGBA tinting (`multiply` and `screen` color blend modes).
- **Audio & Voice Custody**:
  - **TTS Providers**: Local adapters (Kokoro at `:8880`, Piper at `:10200`, Fish TTS Local, S2Cpp, OmniVoice) and Cloud adapters (ElevenLabs Flash v2.5, OpenAI, Azure SSML, Google Cloud, Fish Audio Cloud).
  - **STT Engines**: Local Whisper ONNX runtime (WebGPU/WASM worker with `whisper-small`) and Whisper.cpp / Transformers.js worker, plus cloud speech APIs.
  - **Turn Dynamics**: Bounded sequential turns; lacks sub-50ms native duplex barge-in cancellation and dynamic thinking fillers.
- **Cognition & Agent Architecture**:
  - **Bounded Agent Loop (`packages/agent/src/NekoAgentRuntime.ts`)**: Powered by `@open-agent-loops/core` with `maxSteps: 4`, sequential tool execution mode, and per-session promise queue serialization.
  - **Built-in Tool Suite**: 5 core tools (`updateEmotionState`, `setCharacterState`, `enqueueTTS`, `saveMemoryNote`, `searchMemory`).
  - **Prompt Hierarchy**: `buildNekoAgentSystemPrompt` structures hierarchical context with roleplay locks, `<persona>`, `<user_profile>`, and `<short_term_memory>` working blocks.
- **Memory & Persistence**:
  - **Hybrid RAG Service (`packages/services/src/memory/rag-memory-service.ts`)**: Fast, deterministic 256-dimensional feature hashing (FNV-1a char n-grams + word bigrams) combined with Lexical Jaccard, Recency exponential decay ($\exp(-\text{age}/180)$), and Persona weight boosts. Persisted via `AtomicJsonStore`.
  - **Short-Term Memory (STMM)**: Daily turn journaling (`turns/{date}.json` up to 400 turns/day) pre-compacted into bullet summaries within a 1,000-token/day budget. Reads synchronously from memory cache during turns to eliminate turn latency.
- **Sovereignty, Steam & Release Integrity**:
  - **Release Policy Gate (`scripts/release-policy.cjs`)**: Verifies 0% forbidden 3D asset dependencies, asserts 100% offline boot asset availability (no external CDNs), and computes a deterministic `sha256-tree-v1` directory digest.
  - **Steam Depot Packaging (`scripts/prepare-steam-depot.cjs`)**: Automates unit tests, production build, packaged offline smoke tests, and depot staging to `steam/content/` with `nekogpt-depot-manifest.json`.

---

### 2.5 Utsuwa (`JuiceBoxxGames/Utsuwa`)

- **Tech Stack & Architecture**: SvelteKit + TypeScript + Three.js + Tauri (Rust backend wrapper) + Tailwind CSS. Licensed under GNU AGPL-3.0-or-later (relicensed from MIT post-v0.12.0). Audited release: v0.14.0 (Desktop Beta & Web `app.utsuwa.ai`).
- **Embodiment Depth**:
  - **Exclusively VRM (.vrm)**: Powered by Three.js and `@pixiv/three-vrm`.
  - **Format Blind Spots**: Zero support for 2D runtimes (Live2D Cubism, Spine 2D) or MMD (`.pmx`/`.vmd`).
  - **No Procedural Motion Generation**: Uses pre-baked Three.js/VRM animation clips; lacks text-to-motion or diffusion-based kinematic generation (FlowMDM/VRMA).
  - **No In-App Texture/Asset Surgery**: Lacks runtime mesh editing, material shader overriding (MToon surgery), or AI texture repainting (requires external editing in VRoid Studio or Blender).
  - **Desktop Overlay**: Tauri native window transparency (`transparent: true`, `always_on_top: true`, `decorations: false`).
- **Audio & Voice Custody**:
  - **Interaction Model**: Push-to-Talk (PTT) and Hands-Free Voice Mode driven by client-side Web Audio VAD.
  - **Duplex & Barge-In Reality**: Lacks native hardware AEC duplex streaming; speech turn loop is sequential (Listen → Transcribe → Infer → TTS Stream). Real-time stream truncation on barge-in interruption (Issue #128 proposal) remains an open proposal.
  - **TTS Providers**: Cloud providers (OpenAI, ElevenLabs, Groq) and local HTTP endpoints. Incorporates OmniVoice for voice cloning.
  - **Missing Primitives**: Lacks in-process local WebGPU TTS (e.g. Kokoro-WebGPU), thinking fillers, and adaptive pacing.
- **Cognitive Staging**:
  - **Providers**: OpenAI, Anthropic, Gemini, Groq, OpenRouter, plus local OpenAI-compatible endpoints (Ollama, LM Studio, vLLM).
  - **Emotion Mapping**: Parses dialogue emotion markers (`[happy]`, `[sad]`, `[blush]`, `[angry]`) to standard VRM blendshapes (`happy`, `angry`, `sad`, `surprised`, `relaxed`, `blink`, `neutral`).
  - **Dating Sim Mechanics**: Integrates stateful affinity/intimacy scores inspired by Japanese dating sims via system prompt injections.
- **Memory Architecture**:
  - **Local Vector Search**: Uses client-side `@xenova/transformers.js` to compute local text embeddings and indexes chat history into client-side vector/IndexedDB storage.
  - **Top-K Retrieval**: Basic Cosine Similarity matching against latest user query.
  - **Architecture Deficits**: Lacks multi-tier temporal memory lifecycle (no STMM daily summaries, no immutable LTMM Sacred Journal, no background dreaming consolidation).
- **Perception & Autonomy**:
  - **Vision**: On-demand screen capture and image attachments sent to multimodal LLMs (GPT-4o, Claude, Gemini, LLaVA).
  - **Autonomy**: Strictly reactive; lacks continuous background screen watching, salience gating (pHash/CLIP/OCR), or proactive ambient heartbeats.
- **Sovereignty, Packaging & Economics**:
  - **Tauri Footprint**: Lightweight ~15–25 MB installer (Windows `.msi`/`.exe`, macOS `.dmg`, Linux `.AppImage`).
  - **AGPL Sovereignty**: 100% open-source, zero subscriptions, zero tracking/crypto, fully functional offline when paired with Ollama and local TTS.
  - **Friction**: Unsigned desktop beta binaries require bypassing Windows SmartScreen and macOS Gatekeeper.

---

### 2.6 Soul of Waifu (`jofizcd/Soul-of-Waifu`)

- **Tech Stack & Architecture**: Windows-centric companion coupling an Electron frontend with a local FastAPI / Python CPython backend. Modalities include *Soul System* (chat), *Soul Stage* (TTRPG / Game Master), and *Soul Companion* (transparent desktop overlay). Audited release: v2.5.1 (August 28, 2026). Licensed under GPL-3.0.
- **Embodiment Depth**:
  - **Avatar Formats**: Live2D (`.model3.json`) and 3D VRM 0.0/1.0 via Three.js / WebGL layer.
  - **Limits**: Strictly static animation playback (`.vrma` / `.motion3.json`); no procedural motion diffusion (no Text-to-VRMA), no in-app texture/material surgery (no Texture Forge or MToon live tweaks), no bone-attached particle VFX auras, and no multi-actor persona switching.
- **Audio & Voice Custody**:
  - **Speech Engines**: Local `faster-whisper` + `silero-vad` for STT; hybrid TTS supporting `coqui-tts` (XTTS-v2), Edge-TTS, and optional `RVC-v2` voice conversion post-processing.
  - **Duplex Boundaries**: Asynchronous voice loop with VAD break. Python audio device buffer flushing collisions can cause playback queue stuttering during mode transitions.
  - **Missing Primitives**: Lacks in-process local WebGPU TTS (dependent entirely on heavy PyTorch/ONNX Python subprocesses), thinking fillers, conversational pacing budgets, and UST phonetic transformers.
- **Cognitive Staging & Providers**:
  - **Providers**: Local GGUF execution via `llama-cpp-python` / Ollama, or OpenAI-compatible proxies (OpenRouter, Mistral, OpenAI).
  - **Emotion Parsing**: Shallow bracket/asterisk regex extraction (`[happy]`, `[blush]`, `*smiles*`) mapped directly to discrete VRM BlendShape presets or Live2D expression indices. Lacks multi-actor routing (`<|ACTOR|>`) or timing delays (`<|DELAY:ms|>`).
- **Memory & Lorebook**:
  - **Storage**: Hybrid JSON files, SQLite relational stores, and local ChromaDB vector embeddings. Includes SillyTavern-style Lorebook keyword injection.
  - **Limits**: Relies on mutable JSON state updates rather than deterministic memory dreaming loops or immutable dual-layer ledgers (no STMM summaries or LTMM Sacred Journal).
- **Perception & Autonomy**:
  - **Vision**: Primitive single-frame screenshot capture passed on-demand to VLMs upon tool calls. Lacks continuous background sensory telemetry (no pHash, CLIP, OCR salience gating).
  - **Proactivity**: Limited to basic idle dialogue timers. No ComfyUI API integration or autonomous Director loops.
- **Sovereignty, Packaging & Distribution Fragility**:
  - **Monolithic Distribution**: Distributed as a massive ~1.83 GB RAR archive containing pre-packaged embedded Python interpreters, CUDA binaries, PyTorch wheels, and model weights.
  - **Source Repo Discrepancies (Issues #57 & #64)**: Cloning the GitHub repo and attempting a clean source build fails because essential UI icons, fonts, classifier models, and embedding weights are omitted from git tracking and exist solely inside release RAR binaries (Issues #57 and #64).
  - **Platform Fragility**: Hard-locked to Windows batch scripts (`installer.bat`, `start.bat`), breaks on folder paths with spaces or non-ASCII characters.

---

### 2.7 Open-LLM-VTuber (`Open-LLM-VTuber/Open-LLM-VTuber`)

- **Tech Stack & Architecture**: Python FastAPI backend (`server.py` / `uv run run_server.py`) + React / Chakra UI / Vite web frontend (`Open-LLM-VTuber-Web`) wrapped in Electron. Audited release: v1.2.1 (August 26, 2025). Licensed under MIT.
- **Embodiment Depth**:
  - **Exclusively Live2D**: Supports Live2D Cubism 3, 4, and 5 Web SDK via PixiJS.
  - **Format Blind Spots**: Zero native runtime support for 3D **VRM**, **MMD** (PMX/VMD physics), or **Spine 2D**.
  - **Client/Server Coupling**: Transparent desktop pet mode is a webview wrapper requiring an independently running local Python backend daemon.
- **Audio & Voice Custody**:
  - **Interaction Model**: Bidirectional WebSocket streaming with Silero / WebRTC VAD. Supports speech interruption (halts downstream LLM token generation, flushes audio buffers, and truncates conversation history).
  - **Speech Engines**: Python-bound ASR (Faster-Whisper, Whisper.cpp, Sherpa-ONNX, FunASR) and TTS (CosyVoice, GPT-SoVITS, Sherpa-ONNX, Edge-TTS, ElevenLabs).
  - **Limitations**: No dynamic thinking fillers, no custom pronunciation dictionaries/UST phonetic transformers, and 0 in-process WebGPU/WASM local TTS (relies on Python C++/CUDA backends).
- **Cognitive Staging & Tool Calls**:
  - **Providers**: OpenAI, Anthropic, Gemini, Ollama, Groq, Mistral, LMStudio via central `conf.yaml`.
  - **Tool Dispatch & Gemini Bug (Issue #444)**: Integrated Model Context Protocol (MCP) client. Suffered breaking crashes (`400 INVALID_ARGUMENT`) with newer Gemini models (`gemini-2.5-flash`, `gemini-3.5-flash-lite`) because message serialization stripped Google's cryptographic `thought_signature` metadata from function call payloads.
- **Memory Architecture**:
  - **Letta / MemGPT Integration**: Long-term stateful memory introduced in v1.2.0 via `letta-client` (prior experimental Mem0 integration was deprecated and removed).
  - **Latency & Overhead**: Operating through Letta requires multi-step agentic turns (internal memory management functions and retrieval queries prior to token emission), introducing 2–5+ seconds of turn latency and significant token overhead.
- **Perception & Autonomy**:
  - **Vision**: Camera frame snapshots and desktop screen capture transmitted over WebSocket to multimodal LLMs; supports BrowserBase MCP for browser automation.
  - **Autonomy**: Governed by static idle duration thresholds (`conf.yaml`); lacks OS sensory telemetry, cascaded salience gating (OCR/Moondream), or background dreaming consolidation.
- **Sovereignty, Packaging & Setup Friction**:
  - **High Setup Burden**: Requires Python 3.10+ environments (`uv`/`conda`), CUDA/Torch installations for local speech, manual `conf.yaml` management, and running two decoupled systems (FastAPI backend + Vite/React frontend). Not a unified single-binary desktop app.

---

### 2.8 MateEngine (Rendering Dependency — Outside Companion-App Comparison)

> **MateEngine — rendering dependency, outside the companion-app comparison.** AIRI integrates a modified Unity runtime through Stage-Mate (`apps/stage-mate`). This dossier evaluates complete conversational companion applications; it does not rank standalone avatar renderers that require separate external components to provide a conversational experience.
- **Standalone Scope**: Unity-based desktop toy (`shinyflvre/Mate-Engine`). Provides high-fidelity Unity rendering, tactile interactions, and camera controls, but lacks native companion cognitive faculties: system prompt configuration is limited to a single flat text box, and native TTS does not exist (external voice mod is a separate component).
- **Integration into AIRI**: Rather than competing as an independent companion, MateEngine's rendering and physics engine are integrated into AIRI through the `apps/stage-mate` sidecar, connected to AIRI's 77-provider cognitive pipeline, multi-tier memory hierarchy, and duplex audio runtime.

---

### 2.9 Kindroid & Nomi (Managed SaaS Platforms — Boundary Context)

- **Product Category**: Closed cloud-hosted subscription services ($14–$16/month).
- **Embodiment**: Flat photo-animation driving video (Kindroid, released March 25, 2026) or 2D portrait imagery (Nomi). **Neither provides an embodied 2D/3D avatar roaming or sharing the desktop.**
- **Audio & Media Economics**:
  - Kindroid: 1,000,000 monthly audio credits. Animated video costs 2,000–4,000 credits/min plus 400 credits/min for call connection, exhausting the entire allowance in at most **~6.9 hours of visual calls** before factoring in speech synthesis fees.
  - Nomi: Unlimited native voice calls with shared text/call memory (Mind Map 2.0). Voice processing latency documented in official guides.
- **Tradeoffs**: High convenience for phone/browser calls; completely lacks desktop presence, model ownership, local execution, and user data custody.

---

### 2.10 `NashChennc/airi` (Alaya Memory Layer & Academic Research Fork)

- **Author & Research Background**: NaN / NashChennc (M.S. researcher at LDS@USTC, University of Science and Technology of China, author of NExTGuard on Sparse Autoencoders and streaming LLM safety).
- **Core Architecture & Philosophy**:
  - **Alaya Memory Layer**: A neuroscience-inspired, planner-centric episodic/semantic memory architecture designed around:
    - Non-linear time-decay mechanisms for memory salience.
    - Hierarchical consciousness-level memory streams.
    - Dispatcher/event-trigger loops for memory reconsolidation and reinforcement.
  - **`core-agent` Extraction**: Decouples conversational agent orchestration into a framework-agnostic package with typed dependency injection ports (`AgentContextPort`, `AgentLLMPort`, `AgentSessionPort`).
- **Relationship & Divergence from `dasilva333/airi`**:
  - **Complementary Memory Paradigms**: While NashChennc designs memory from an academic LLM interpretability / SAE perspective, `dasilva333/airi` implements a production-grade 4-tier temporal ledger (STMM daily summaries + append-only Sacred Journal LTMM + Dreaming Worker + Subconscious Echo Chips).
  - **Context Prompt Format Synergy**: Both forks converged on identical bulleted injection semantics (`[Context]\n- sourceKey: text`).
  - **Multi-Actor & Multi-Engine Scope**: NashChennc's runtime remains single-actor and Live2D/VRM standard; does not incorporate multi-actor dynamic staging (`<|ACTOR|>`), 4 runtimes (MMD/Spine), or the Stage-Mate Unity sidecar.

---

### 2.11 Amica (`semperai/amica`)

- **Tech Stack & Lineage**: Direct modernization fork of Pixiv's `ChatVRM` built on Next.js (React) + Three.js + `@pixiv/three-vrm` + Tauri desktop wrapper.
- **Embodiment Depth**:
  - **Exclusively VRM (.vrm 0.0/1.0)**: Rendered via Three.js (`VRMLookAtHead`, spring bone physics, audio frequency lip-sync).
  - **Limits**: Zero support for 2D runtimes (Live2D Cubism, Spine 2D) or MMD (`.pmx`). No procedural motion diffusion (no Text-to-VRMA; loads pre-baked `.vrma`/`.fbx` clips), no bone particle VFX, and no in-app texture surgery (Texture Forge).
- **Audio & Voice Custody**:
  - **VAD & Barge-in**: Integrates Silero VAD (`@ricky0123/vad-web`) enabling real-time audio playback stop and `AbortController.abort()` LLM token termination upon user speech.
  - **Speech Engines**: Multi-provider TTS (ElevenLabs, Coqui, Piper, OpenAI, Web Speech, RVC post-processing) and STT (Web Speech API, in-browser Whisper via `transformers.js`, local `whisper.cpp`).
  - **Gaps**: No dynamic thinking fillers, no custom pronunciation dictionaries, and no native WebGPU in-process audio.
- **Cognitive Staging & Providers**:
  - **Connectors**: Direct HTTP REST clients for Ollama, Llama.cpp server, OpenRouter, KoboldAI, Oobabooga, and OpenAI endpoints.
  - **Emotion Parsing**: Regex bracket parsing (`[happy]`, `[sad]`, `[relaxed]`) driving `VRMExpressionManager` blendshapes. Strict 1:1 single-character canvas; no multi-actor `<|ACTOR|>` handoffs.
- **Memory Architecture**:
  - **Flat Sliding Window**: Retains conversation history in browser `localStorage` / client state.
  - **Limits**: Lacks multi-tier temporal memory (no STMM daily summaries, no immutable LTMM Sacred Journal, no background dreaming consolidation).
- **Perception & Autonomy**:
  - **Vision**: Manual / interval webcam frame snapshots (`canvas.toDataURL()`) sent to multimodal LLMs (Bakllava, Llava, GPT-4V).
  - **Autonomy (`amicaLife`)**: Periodic idle timer triggering random secondary gestures and eye-darts. Lacks continuous OS screen perception, salience gating, or proactive telemetry heartbeats.
- **Sovereignty & Setup**: Next.js SPA packaged in Tauri. True offline execution requires independently managing background daemons (Ollama, Piper, Whisper server).

---

### 2.12 Komorebi (`kiskaserver/interactive_assistent`)

- **Tech Stack & Architecture**: Windows-focused companion built on Tauri 2 (Rust backend `src-tauri/crates/*` + React/TypeScript frontend on Webview2). Focuses on "always-on pair-programming, study buddy, and game coach".
- **Embodiment Depth**:
  - **Exclusively Live2D**: Powered by Live2D Cubism 5 SDK via PixiJS (`pixi-live2d-display`).
  - **Limits**: Zero support for 3D VRM, Spine 2D, or MMD. No procedural motion diffusion or in-app texture editing.
  - **Emotion & Lip-Sync**: LLM emotion intent markers trigger `.exp3.json` expressions and motion groups; Web Audio RMS lip-sync drives `ParamMouthOpenY`.
- **Audio & Voice Custody**:
  - **Local Speech**: Sub-100ms offline vocal generation via `Piper` ONNX neural TTS and local `whisper.cpp` transcription in `komorebi-voice` (with Deepgram / SoVITS options).
  - **Limits**: Sequential audio queue; lacks sub-50ms acoustic duplex barge-in cancellation, dynamic thinking fillers, and UST phonetic transformers.
- **Cognition, Tools & Computer Use**:
  - **Screen Perception**: Uses `xcap` in `komorebi-desktop` for full-desktop or window-region screen captures passed as multimodal payloads.
  - **OS Automation**: Uses `enigo` to simulate mouse movement, clicking, and keystrokes for computer automation.
  - **Proactive Loops**: `proactive.rs` (idle time & window title topic initiator) and `coach.rs` (real-time gaming/coding context observer).
- **Memory & Adaptive Learning**:
  - **Local Folder RAG**: SQLite database with **FTS5 full-text search** over chunked local user documents.
  - **Local LoRA Trainer (`komorebi-trainer`)**: Interleaved ratings and corrections stored in `feedback.sqlite` serve as training corpus for local LoRA personality fine-tuning.
  - **Limits**: Lacks multi-tier STMM daily summaries, immutable Sacred Journal LTMM, and dreaming consolidation.
### 2.13 AITuberKit (`tegnike/aituber-kit`)

- **Tech Stack & Lineage**: Next.js (React) + TypeScript + Tailwind CSS web application derived from Pixiv's `ChatVRM`.
- **Embodiment Depth**:
  - **Formats**: 3D VRM 0.0/1.0 (Three.js), Live2D Cubism 3/4 (`pixi-live2d-display`), and MotionPNGTuber (video state switching).
  - **Limits**: Zero procedural motion generation (static VRMA/BVH clips), no bone particle VFX, and no in-app texture editing.
- **Audio & Voice Custody**:
  - **Speech Engines**: Broad adapter library for local (VOICEVOX, AivisSpeech, Style-Bert-VITS2, GPT-SoVITS) and cloud TTS (ElevenLabs, OpenAI, Azure, Google). STT via Web Speech API or cloud Whisper.
  - **Realtime WebSocket**: Integrates OpenAI Realtime API over WebSocket for bidirectional audio; lacks native acoustic echo cancellation (AEC), hardware-level duplex suppression, or thinking fillers.
- **Streaming & Cognitive Staging**:
  - **Stream Comment Scraping**: YouTube Data API v3 polling and OneComme (わんコメ) WebSocket integration for multi-platform live chat reading.
  - **Limits**: Strictly single-actor 1:1 prompt factory with simple bracketed regex emotion tags (`[happy]`, `[motion:name]`); no multi-actor `<|ACTOR|>` staging.
- **Memory & RAG**:
  - **No Native RAG Engine**: Completely offloads long-term memory and knowledge retrieval to external **Dify** workflows or stores message arrays in browser `localStorage`.
- **Licensing Shift (v2.0.0+)**:
  - Shifted from MIT to a **Custom Non-Commercial License** (commercial usage, monetized streams, and business deployments require purchasing a private license from the author). Active development suspended in late 2025.

---

### 2.14 VPet (Virtual Pet Simulator) (`LorisYounger/VPet`)

- **Tech Stack & Architecture**: C# / .NET 6/8 + Windows Presentation Foundation (WPF). Desktop pet simulator with millions of Steam downloads.
- **Embodiment & Physics**:
  - **2D Sprite Animation Engine**: Custom frame-by-frame PNG sequence animation player (`PNGAnimation`, `GraphCore`). Zero native 3D VRM or Live2D core (relies on experimental webview plugins).
  - **Desktop Environment Integration**: Deep Win32 workspace bounds integration (`SystemParameters.WorkArea`), gravity falling velocity steps ($y += v_y$), border climbing/crawling, and coordinate-based mouse dragging/throwing.
- **Cognition & LLM Pipeline**:
  - **Decoupled Plugin Model**: LLM intelligence is not in the core engine; implemented as an external reflection plugin (`VPet.Plugin.ChatGPT`). Sends asynchronous REST calls and routes output strings to speech bubbles (`MWController.Main.Say()`).
- **Voice & Audio**:
  - Edge-TTS plugin (`VPet.Plugin.EdgeTTS`) and community VITS/RVC bridges. Batch fire-and-forget playback; no duplex, barge-in, or thinking fillers.
- **State & Economy Simulation**:
  - Quantitative Tamagotchi state simulation (Hunger, Thirst, Stamina, Mood, Health, Money, EXP). State serialized via high-speed hierarchical text library `LinePutScript` (`.lps`), with rolling JSON chat logs.
- **Modding & Resource Footprint**:
  - Native Steam Workshop integration with in-app Mod Maker (`VPet-Simulator.Tool`).
  - Ultra-lightweight footprint: 80MB–180MB RAM, <1% CPU idle utilization, 100% offline base game.

---

### 2.15 Commercial, Paid & Niche Desktop Systems (Audit of Wider Market Evidence)

The September 2026 report surveyed multiple paid, closed-source, or niche commercial applications. Below is the audited breakdown of their actual costs, hardware demands, and capability boundaries:

1. **Asiden (`Asiden Labs`)**:
   - **Cost & Acquisition**: **$10 ($9.99 USD) Early Access purchase on Windows** + optional paid cloud AI subscription tiers (Source 42, 67).
   - **Hardware Demands**: Heavy local hardware footprint requiring Windows 11, 16 GB RAM, and a dedicated NVIDIA GPU with at least 8 GB VRAM.
   - **Ecosystem**: Solo developer project; combines local and cloud LLM/voice routing. Lacks multi-engine avatar versatility (no MMD/Spine) or procedural motion generation.
2. **Questie AI (`Questie AI`)**:
   - **Cost & Acquisition**: **$19.99/month entry plan** with vendor-metered usage hours (Source 43).
   - **Focus**: Specialized for gaming commentary (watches visible gameplay via screen capture and provides spoken audio commentary).
   - **Limits**: Spectator/commentary companion, not an autonomous game-playing agent or customizable embodied companion.
3. **Whispers from the Star (`Anuttacon`)**:
   - **Cost & Acquisition**: **$9.99 Windows commercial game on Steam** (Source 45) with a free demo.
   - **Focus**: Polished, cinematic interactive narrative featuring Stella (AI-driven voice, text, and video interactions).
   - **Limits**: Fixed narrative video game experience, not an ambient, general-purpose customizable desktop companion.
4. **HoloWaifu (`HoloWaifu`)**:
   - **Cost & Acquisition**: Commercial product with free Windows trial and recurring paid tier structure (Source 66).
   - **Scope**: Claims VRM support and voice integration; licensing and billing terms remain inconsistent, with limited public technical validation.
5. **Replika (`Luka Inc.`)**:
   - **Cost & Acquisition**: **$19.99/month or $69.99/year (Replika Pro)**.
   - **Scope**: Established 3D mobile/web avatar with proprietary memory systems; lacks local data ownership, custom model importing, and floating desktop integration.
6. **Razer AVA (`Razer`)**:
   - **Cost & Status**: Hardware-tied companion in closed beta (Source 39, 62). Requires NDA, charges a refundable reservation deposit, and automatically deletes beta memory state.
7. **Deprecated & Shuttered Commercial Products**:
   - **Backyard AI (formerly Faraday)**: Officially **deprecated and sunset desktop apps on June 25, 2025** in favor of cloud-only web services (Source 46).
   - **BSide: Olivia Lin (`miHoYo`)**: Officially announced **server shutdown and store delisting on August 31, 2026** (Source 47), converting existing downloads to limited offline static modes.

---

## 3. The Master Multi-Column Architectural Matrix

This matrix extends the verified capability catalog from the AIRI repository, providing a normalized, side-by-side comparison across the active contenders.

> **Legend**:
> ✅ **Implemented & Verified**: Dedicated, integrated capability present in source/release.
> ◐ **Partial / Constrained**: Feature exists but has notable boundaries (e.g., push-to-talk only, external backend required, locked routes).
> ❌ **Absent**: No equivalent integrated implementation found in inspected source or documentation.

---

### 3.1 Embodiment & Avatar Integration Depth

| Capability / Dimension | `dasilva333/airi` | Upstream AIRI | Project N.E.K.O. | NekoGPT | Utsuwa | Soul of Waifu | Open-LLM-VTuber | Amica | Komorebi | AITuberKit | VPet |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **VRM 0.0 & 1.0 Runtime** | ✅ Built-in | ✅ Built-in | ✅ Built-in | ❌ (Live2D-only gate) | ✅ Built-in | ✅ Built-in | ❌ (Live2D-only) | ✅ Built-in | ❌ (Live2D-only) | ✅ Built-in | ❌ (Plugin only) |
| **Live2D Cubism (2.1 – 5.0)** | ✅ (2.1 to 5.0) | ✅ (3/4/5) | ✅ (3/4/5) | ✅ (3/4) | ❌ | ✅ (3/4) | ✅ (3/4/5) | ❌ | ✅ (Cubism 5) | ✅ (3/4) | ❌ (Plugin only) |
| **MMD Runtime (PMX & VMD)** | ✅ Built-in | ❌ | ✅ (`three-mmd`) | ❌ (Banned) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Spine 2D Skeletal Runtime** | ✅ Built-in | ❌ | ❌ | ❌ (Banned) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (Plugin only) |
| **Expression Morphs & Blendshapes**| ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ (Sprite states) |
| **Bone-Attached Particle VFX Auras**| ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Configurable Idle Animation Cycles**| ✅ (All 4 Types) | ◐ (VRM/Live2D) | ◐ (VRM/Live2D) | ◐ (Live2D-only) | ◐ (VRM-only) | ◐ (VRM/Live2D) | ◐ (Live2D-only) | ◐ (VRM-only) | ◐ (Live2D-only) | ◐ (VRM/Live2D) | ◐ (Sprites) |
| **Dedicated High-Fidelity Sidecar** | ✅ (`stage-mate`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Turing-Complete DSL Scripts** | ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Procedural Text-to-Motion** | ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **In-App Texture Surgery** | ✅ (Texture Forge) | ❌ | ❌ | ◐ (ArtMesh Tint) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Multiple Personalities & Handoffs**| ✅ (`<\|ACTOR\|>`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Desktop Physics & Window Gravity** | ✅ (`stage-mate`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Native Win32) |

---

### 3.2 Speech, Duplex Conversational Loop & Audio Custody

| Capability / Dimension | `dasilva333/airi` | Upstream AIRI | Project N.E.K.O. | NekoGPT | Utsuwa | Soul of Waifu | Open-LLM-VTuber | Amica | Komorebi | AITuberKit | VPet |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Full Duplex Audio & Barge-In** | ✅ (Silero VAD + AEC) | ✅ Real-Time | ◐ Async break | ◐ Sequential | ❌ (Issue #128) | ◐ Python VAD | ◐ WebSocket VAD | ✅ Silero Abort | ◐ Sequential | ◐ WS Event abort | ❌ (Batch play) |
| **Turn Pacing & Thinking Fillers** | ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Subconscious Spoken Asides** | ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **In-Process WebGPU / WASM TTS** | ✅ (Kokoro/Pocket/MOSS) | ✅ (Kokoro) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **UST Stage-Direction Filtering** | ✅ Built-in | ◐ Basic regex | ◐ Basic regex | ◐ Basic regex | ◐ Basic regex | ◐ Basic regex | ◐ Basic regex | ◐ Basic regex | ◐ Basic regex | ◐ Basic regex | ❌ |
| **Custom Pronunciation Rules** | ✅ Built-in | ❌ | ◐ Word list | ◐ Word list | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Character Audio Studio Profiles** | ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Mid-Dialogue Voice Switching** | ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Distinct TTS Engine Integrations** | **10+ Engines** | 8 Engines | 4 Engines | 10 Local/Cloud | 4 Engines | 3 Engines | 5 Engines | 6 Engines | 2 Engines | 8 Engines | 2 Engines |
| **Total AI Integrations (All Kinds)**| **77 Providers** | 69 Providers | Cloud/Local | 10 Local/Cloud | Local/Cloud | Local/Cloud | Backend-bound | 6+ Adapters | Piper/Whisper | 11+ REST/WS | EdgeTTS Plugin |

---

### 3.3 Cognition, Prompting & Multi-Character Staging

| Capability / Dimension | `dasilva333/airi` | Upstream AIRI | Project N.E.K.O. | NekoGPT | Utsuwa | Soul of Waifu | Open-LLM-VTuber | Amica | Komorebi | AITuberKit | VPet |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Bring-Your-Own Model / API Key** | ✅ Full Custody | ✅ Full Custody | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Plugin Key |
| **Run Inference Locally (Ollama/etc)**| ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | ◐ Plugin |
| **Hosted Managed AI Routing** | ❌ (Strict Local) | ◐ (Auto Proxy) | ◐ Default Cloud | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **2-Pass ACT Normalization** | ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Multi-Actor Dynamic Staging** | ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Fine-Grained Tool Context Gating**| ✅ Dynamic Pruning| ❌ | ❌ | ◐ Static Filter | ❌ | ❌ | ❌ | ❌ | ◐ Static Filter | ❌ | ❌ |
| **Production Studio / Rehearsal** | ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Multi-Step Tool Execution Loop** | ✅ (10-Step Loop) | ◐ | ◐ | ◐ (4-Step Loop) | ❌ | ❌ | ◐ (Issue #444) | ❌ | ✅ (`tool_loop.rs`) | ❌ | ❌ |

---

### 3.4 Memory Hierarchy & Temporal Continuity

| Capability / Dimension | `dasilva333/airi` | Upstream AIRI | Project N.E.K.O. | NekoGPT | Utsuwa | Soul of Waifu | Open-LLM-VTuber | Amica | Komorebi | AITuberKit | VPet |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Primary Storage Engine** | **DuckDB-WASM + IDB** | Unstorage IDB | SQLite FTS5 | SQL.js WASM | IndexedDB | SQLite + Chroma | Letta Archival | LocalStorage | SQLite FTS5 | LocalStorage / Dify | `LinePutScript` (.lps) |
| **Daily Summaries (STMM)** | ✅ Built-in | ◐ In-Progress | ◐ | ✅ (Sync Cache) | ◐ | ◐ | ◐ | ❌ | ◐ | ❌ | ❌ (Rolling JSON) |
| **Persistent Episodic Journal** | ✅ (Sacred Journal)| ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Cross-Session Relationship Thread**| ✅ Built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Subconscious Memory Anchors** | ✅ (Echo Chips) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **User-Owned Cloud Sync (BYOS)**| ✅ (S3/R2/KV) | ❌ (Proprietary) | ❌ | ❌ | ◐ Import/Export | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ Steam Cloud |
| **Local Vector / Keyword Search** | ✅ (DuckDB+BM25) | ❌ | ✅ (SQLite FTS5) | ✅ (256-dim Hash) | ✅ (Transformers) | ✅ (ChromaDB) | ✅ (Letta) | ❌ | ✅ (SQLite FTS5) | ◐ Dify Plugin | ❌ |

---

### 3.5 Perception, Agency & Visual Artistry

| Capability / Dimension | `dasilva333/airi` | Upstream AIRI | Project N.E.K.O. | NekoGPT | Utsuwa | Soul of Waifu | Open-LLM-VTuber | Amica | Komorebi | AITuberKit | VPet |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Image & Photo Input (VLM)** | ✅ Built-in | ✅ Built-in | ✅ Supported | ◐ Attachment | ✅ Attachment | ◐ Attachment | ◐ Attachment | ✅ Snapshot | ◐ Screenshot | ✅ Supported | ❌ |
| **Live Webcam Video Input** | ✅ Built-in | ✅ Built-in | ◐ | ❌ | ❌ | ❌ | ◐ | ✅ Built-in | ❌ | ✅ Built-in | ❌ |
| **Continuous Screen Observation**| ✅ Salience Gated | ❌ | ✅ (OCR/VLM) | ❌ | ❌ | ❌ | ◐ (BrowserBase) | ❌ | ✅ (`xcap`) | ❌ | ❌ |
| **Context-Aware Initiation / Silence**| ✅ (`NO_REPLY`) | ❌ | ◐ (Timer) | ❌ | ❌ | ❌ | ❌ | ◐ (Gestures) | ◐ (`proactive.rs`)| ◐ (Chatter loop) | ◐ (Stat alerts) |
| **Autonomous ComfyUI Director**| ✅ (BYOW) | ◐ Partial | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Native OS Input Automation** | ✅ (via MCP) | ❌ | ✅ (ZeroMQ) | ❌ | ❌ | ❌ | ◐ (BrowserBase) | ❌ | ✅ (`enigo`) | ❌ | ❌ |
| **Stream Live Chat Ingestion** | ✅ (via Plugins) | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ (Bilibili) | ❌ | ❌ | ✅ (YouTube/OneComme) | ❌ |

---

### 3.6 Sovereignty, Packaging & Operating Cost

| Capability / Dimension | `dasilva333/airi` | Upstream AIRI | Project N.E.K.O. | NekoGPT | Utsuwa | Soul of Waifu | Open-LLM-VTuber | Amica | Komorebi | AITuberKit | VPet |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Telemetry Audited Scope** | **0 Telemetry** | Minimal | Steam64 Logged | **0 Telemetry** | **0 Telemetry** | **0 Telemetry** | **0 Telemetry** | **0 Telemetry** | **0 Telemetry** | **0 Telemetry** | **0 Telemetry** |
| **Acquisition Price** | **$0 (Free)** | $0 (Free) | $0 (Free) | **~$10 ($9.99 on Steam)** | $0 (Free) | $0 (Free) | $0 (Free) | $0 (Free) | $0 (Free) | $0 (Free) | $0 (Free on Steam) |
| **Monthly Subscription** | **$0 (None)** | Optional Stripe | Free + Paid Cloud | $0 (One-time Buy) | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| **Software License** | **MIT** | MIT | Apache-2.0 | 🔒 Proprietary | AGPL-3.0 | GPL-3.0 | MIT | MIT | MIT | ⚠️ Non-Commercial v2 | MIT / Apache-2.0 |
| **Source Accessibility** | **Public Open Source**| Public Open Source| Public Open Source| 🔒 Private Repo | Public Open Source| ⚠️ Issues (#57/#64)| Public Open Source| Public Open Source| Public Open Source| Public Source | Public Open Source |
| **Single Desktop Installer** | ✅ (Win/Mac/Linux) | ✅ | ✅ (Steam) | ✅ (Steam Depot) | ✅ (~20MB) | ❌ (1.8GB RAR) | ❌ (Python Req) | ◐ (Tauri/Web) | ✅ (~30MB) | ❌ (Web/Docker) | ✅ (Steam / ~100MB) |
| **Onboarding Quick Start** | ✅ (<60s to Speech) | ◐ | ◐ (Steam Default)| ◐ | ◐ | ❌ (Manual Setup) | ❌ (Python Req) | ◐ | ◐ | ◐ | ✅ (Instant Play) |

---

## 4. Next Steps for Research & Validation

1. **Empirical Latency & Memory Profiling**: Benchmark real-world duplex response latency across AIRI (WebGPU/Kokoro/WebAudio), Utsuwa (Tauri/VAD), Amica (Next/Silero), and Komorebi (Tauri 2/Piper).
2. **Multi-Agent vs. Multi-Actor Analysis**: Contrast NekoGPT's `@open-agent-loops/core` multi-agent paradigm against AIRI's `<|ACTOR|>` mid-stream multi-character dynamic staging.
3. **Upstream Radar Tracking**: Maintain tracking in `docs/UPSTREAM_RADAR.md` to monitor ongoing fork divergences and evaluate selective cherry-pick candidates.
