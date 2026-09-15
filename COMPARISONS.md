# Desktop AI Companions Landscape (2026)
### An Evidence-Backed Architectural Comparison Across 11 Open & Community Runtimes

> **Maintainer Affiliation & Disclosure:**
> This comparison is authored and maintained by the creator of the `dasilva333/airi` fork. It was born out of frustration with superficial marketing checklists (e.g. *"Supports VRM: Yes/No"* or *"Has Memory: Yes/No"*) that conceal fundamental architectural differences—such as whether speech synthesis runs in-process on WebGPU versus requiring an external background server daemon, or whether memory is a flat sliding context window versus a structured temporal hierarchy.
>
> All assessments are anchored in commit-pinned primary source code, local repository checkouts, and runtime logs audited as of **September 2026**. This is a living comparison: **corrections, clarifications, and pull requests from users and maintainers of all featured projects are actively welcomed.**
>
> *For line-by-line repository citations, factory implementation cases, and latency benchmark methodologies, see the canonical [Forensic Deep-Dive Dossier](docs/project-companion-comparisons.md).*

---

## 1. Quick Legend & Evaluation Boundaries

- **`✅` Built-in / In-Engine**: Fully integrated into the companion runtime without requiring external server daemons, separate process orchestrators, or third-party paid cloud proxies.
- **`◐` Partial / External / Cloud**: Functional capability is present, but relies on an external background daemon (e.g. local Python HTTP/FastAPI server), third-party cloud API keys, or an optional post-processing filter.
- **`❌` None / Unsupported**: Capability is not implemented, relies on static fixed models without adaptation, or is outside the project's architectural scope.
- **`?` Unverified**: Candidate feature claimed or documented but not independently verified in inspected source checkouts.

---

## 2. The Landscape at a Glance (3 Transposed Panels)

### Panel 1: Voice, Speech & Local Execution

*How does the companion handle speech synthesis, duplex conversation, and local execution?*

| Companion Application | Interrupt Spoken Replies (Barge-in) | Zero-Shot Voice Conditioning | In-Process Offline TTS | Conversational Turn Pacing & Fillers | Speech Integrations (Normalized) | Target-Voice Deployment Scope |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **AITuberKit** | ◐ WebSocket event abort | ◐ External Server / Cloud | ❌ | ❌ | **10** (VOICEVOX, Aivis, Style-Bert, GSVI, ElevenLabs, OpenAI, Azure, Google, Cartesia) | Local Server Daemon + Cloud API |
| **Amica** | ✅ Silero VAD with abort | ◐ Cloud API Only (ElevenLabs) | ❌ | ❌ | **6 (+1 RVC)** (ElevenLabs, OpenAI, Coqui, Piper, Kokoro, SpeechT5 + RVC filter) | Cloud API + Local Conversion Filter |
| **dasilva333/airi** (This Fork) | ✅ Silero VAD + token flush | ✅ Built-in In-Engine Studio | ✅ Kokoro, Pocket-TTS, MOSS | ✅ Thinking fillers & asides | **23** (Kokoro, Pocket, MOSS, ElevenLabs, Polly, Azure, vLLM, CosyVoice, Gemini, Grok, etc.) | In-Process WebGPU/WASM + Local Server + Cloud |
| **Komorebi** | ◐ Sequential turn queue | ❌ (Fixed Models) | ❌ | ❌ | **2** (Piper ONNX offline, GPT-SoVITS HTTP client) | Local In-Process Engine (Fixed) |
| **NekoGPT** | ◐ Sequential turn queue | ◐ External Server / Cloud | ❌ | ❌ | **10** (Piper, Kokoro, S2Cpp, OmniVoice, Fish, ElevenLabs, Fish Cloud, Azure, Google, Web Speech) | Local Server Daemon + Cloud API |
| **Open-LLM-VTuber** | ◐ WebSocket VAD interrupt | ◐ External Server / Cloud | ❌ | ❌ | **19** (Azure, Bark, Edge, pyttsx3, CosyVoice 1/2, Melo, XTTS, GPT-SoVITS, Coqui, Fish, MiniMax, Piper, etc.) | Local Server Daemon + Cloud API |
| **Project N.E.K.O.** | ◐ Async break | ◐ External Server / Cloud | ❌ | ❌ | **11** (GPT-SoVITS v3, vLLM-Omni, MiniMax, ElevenLabs, CosyVoice, MIMO, Doubao, Gemini, Grok, StepFun) | Local Server Daemon + Cloud API |
| **Soul of Waifu** | ◐ Python VAD thread | ❌ (Requires RVC Filter) | ❌ | ❌ | **2 (+1 RVC)** (Edge-TTS, Coqui TTS + RVC v2 post-processing filter) | Local Conversion Filter + Cloud TTS |
| **Upstream AIRI** | ✅ Real-time VAD interrupt | ❌ (Fixed Models) | ✅ Kokoro-WebGPU | ❌ | **8** (Web Speech, Kokoro, OpenAI, ElevenLabs, Azure, VOICEVOX, AivisSpeech, OpenAI-compatible) | In-Process WebGPU (Fixed) + Cloud |
| **Utsuwa** | ❌ (Push-to-talk default) | ◐ External Server (OmniVoice) | ❌ | ❌ | **4** (ElevenLabs, OpenAI TTS, local-tts localhost HTTP, OmniVoice local proxy) | Local Server Daemon + Cloud API |
| **VPet** | ❌ (Batch audio playback) | ❌ (Fixed SAPI Models) | ❌ | ❌ | **2 (+RVC Plugins)** (Windows SAPI, Edge-TTS + community modded plugins) | Native OS Engine + Modded Plugins |

---

### Panel 2: Memory Systems, Autonomy & Agency

*How does the companion remember past interactions, perceive the user, and act autonomously?*

| Companion Application | Interactive Memory Studio UI | Temporal Memory Depth | Autonomous Heartbeats | Continuous Screen Vision | Desktop Tool Automation | Data Sovereignty / Cloud Sync |
| :--- | :---: | :--- | :---: | :---: | :---: | :--- |
| **AITuberKit** | ❌ (External Dify UI) | Flat context window / external Dify | ◐ Random chatter loop | ❌ | ❌ Single turn | User-managed local browser storage |
| **Amica** | ❌ (Browser storage inspector) | Flat sliding context window | ◐ Idle secondary gesture timer | ❌ (Manual webcam) | ❌ Single turn | User-managed IndexedDB storage |
| **dasilva333/airi** (This Fork) | ✅ Dedicated 4-Quadrant Hub | 4-Tier Hierarchy (STMM + LTMM + Lifetime + Echoes) | ✅ Ambient proactivity (`NO_REPLY`) | ✅ Cascaded Salience Gating (OCR/VLM) | ✅ 10-Step Auditable Loop + MCP | BYOS (User S3 / Cloudflare R2 / KV Sync) |
| **Komorebi** | ❌ | Single-tier SQLite FTS5 store | ◐ `proactive.rs` topic initiator | ✅ `xcap` window/desktop capture | ✅ Rust `tool_loop.rs` + `enigo` automation | 100% Local SQLite files |
| **NekoGPT** | ❌ | 2-Phase SQLite cache with worker sync | ❌ | ❌ | ✅ 4-Step bounded tool loop | Local SQLite databases |
| **Open-LLM-VTuber** | ❌ | Letta (MemGPT) archival daemon | ❌ | ◐ BrowserBase automated browsing | ◐ Supported (Subject to schema bugs) | Local SQLite / Letta daemon state |
| **Project N.E.K.O.** | ✅ Web `/memory` CRUD Table | 5-Layer Cognitive Model (Working, Recent, Facts, etc.) | ◐ Timer-based proactive interrupt | ✅ Desktop screen capture + OCR/VLM | ✅ ZeroMQ agent daemon + computer use | Local SQLite databases (`time_indexed.db`) |
| **Soul of Waifu** | ❌ | Single-tier ChromaDB vector store | ❌ | ❌ | ❌ Single turn | Local ChromaDB vector storage |
| **Upstream AIRI** | ❌ | In-progress daily summaries | ❌ | ❌ | ◐ Basic tool loop | Local IndexedDB storage |
| **Utsuwa** | ❌ | Single-tier local vector store | ❌ | ❌ | ❌ Single turn | Manual JSON file import / export |
| **VPet** | ❌ (Save file editing) | Rolling JSON / Tamagotchi state (.lps) | ◐ Tamagotchi hunger/stat alerts | ❌ | ❌ Single turn | Steam Cloud save sync |

---

### Panel 3: Embodiment, Avatars & Modding Ecosystem

*What avatar technologies, visual modifications, and distribution models are supported?*

| Companion Application | Supported Avatar Formats | Dynamic Mid-Stream Actor Switching | Procedural Motion Generation | In-App Texture / Wardrobe Surgery | Primary Distribution & Licensing |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **AITuberKit** | VRM 0.0/1.0, Live2D, MotionPNGTuber | ❌ | ❌ | ❌ | Next.js Web / Custom Source-Available (v2.0+) |
| **Amica** | 3D VRM (0.0 / 1.0) | ❌ | ❌ | ❌ | MIT Open Source · Web / Electron |
| **dasilva333/airi** (This Fork) | VRM 0.0/1.0, Live2D, Spine 2D, MMD | ✅ (`<\|ACTOR\|>` tokens) | ✅ Text-to-VRMA Diffusion | ✅ V-HACK / God Mode / Texture Forge | MIT Open Source · Electron Desktop / Web |
| **Komorebi** | Live2D Cubism | ❌ | ❌ | ❌ | Open Source · Tauri 2 / Rust Desktop |
| **NekoGPT** | Live2D Cubism, Spine 2D | ❌ | ❌ | ❌ | Commercial Steam Product (`Shinobu`) |
| **Open-LLM-VTuber** | Live2D, VRM | ❌ | ❌ | ❌ | MIT Open Source · Python Backend + Web/Desktop Client |
| **Project N.E.K.O.** | VRM, Live2D | ❌ | ❌ | ❌ | Free-to-Play Steam Product + Python Core |
| **Soul of Waifu** | Live2D, VRM | ❌ | ❌ | ❌ | Open Source · Bundled RAR Release |
| **Upstream AIRI** | VRM 0.0/1.0, Live2D, Spine, MMD | ❌ | ❌ | ❌ | MIT Open Source · Electron Desktop / Web |
| **Utsuwa** | 3D VRM (0.0 / 1.0) | ❌ | ❌ | ❌ | MIT Open Source · Electron Desktop Installer |
| **VPet** | Win32 Sprites, GIF, Spine | ❌ | ❌ | ❌ | Open Source · Steam Workshop Ecosystem |

---

## 3. Contender Strengths & Architectural Trade-offs

Every companion in this ecosystem was built to solve a specific problem. Understanding their design goals helps you pick the right tool for your setup:

### 🐾 VPet (Virtual Pet Simulator)
- **Where it shines:** Unrivaled desktop presence and physics simulation. VPet features true Win32 desktop window physics—gravity, collision, climbing, throwing, and active pet state/hunger simulation. Its Steam Workshop modding community is the largest in the desktop companion space with thousands of user-created sprites and animations.
- **Architectural trade-off:** LLM conversational intelligence and speech are community plugin wrappers layered onto a classic 2D sprite engine, rather than an integrated multimodal cognitive loop.
- **Versus AIRI Fork:** VPet delivers classic 2D desktop pet physics; AIRI counters with the **Stage-Mate Unity sidecar**—bringing full 3D physics, procedural IK dangling, macarons, toy guns, dancing, sitting on window borders, and edge peeking—paired with an in-app AI character creator that synthesizes custom companion personalities, voice bindings, and story prompts in seconds.

### 🦀 Komorebi (Interactive Assistant)
- **Where it shines:** Native Rust efficiency, instant boot times, and minimal memory footprint. Built on Tauri 2, it runs completely offline using local Piper ONNX and llama.cpp. It is the only companion with a local training engine that adapts character personality LoRAs directly from user response feedback.
- **Architectural trade-off:** Embodiment is strictly limited to 2D Live2D avatars, and its tool execution and voice pipelines rely on sequential, single-threaded processing loops.
- **Versus AIRI Fork:** Komorebi achieves offline execution by bundling Piper ONNX; AIRI runs **100% offline directly in-process** via 3 native neural speech engines (Kokoro-WebGPU, Pocket-TTS with 26 voice embeddings, and MOSS-TTS) alongside local browser LLMs—delivering fully autonomous offline presence without background server daemons while supporting rich 3D VRM, Spine, and MMD embodiment.

### 🎭 Project N.E.K.O.
- **Where it shines:** Desktop OS task automation and database transparency. Features an active web-based CRUD table for direct inspection, search, and deletion of live SQLite memory rows, alongside an agent server for real-time computer use and desktop screen perception.
- **Architectural trade-off:** Requires coordinating a multi-process stack (Steam client, Python environment, background brokers, and local GPT-SoVITS daemons), with voice conditioning dependent on external server processes.
- **Versus AIRI Fork:** N.E.K.O. provides a single flat table over raw SQLite rows; AIRI provides **4 dedicated CRUD management hubs** across each temporal tier (Daily Summaries, Sacred Journal, Lifetime Artifacts, Echoes) with live reactive token telemetry. For desktop perception, where N.E.K.O. continuously pushes raw frames to OCR/VLM, AIRI deploys a **Cascaded Salience Gate** (lightweight OCR vs. Moondream2 VLM caching) to eliminate idle GPU burn, backed by an auditable 10-step desktop automation loop.

### 🎙️ Open-LLM-VTuber
- **Where it shines:** Unmatched speech-provider breadth. Integrates 19 distinct individual synthesis engines (spanning CosyVoice, MeloTTS, Sherpa-ONNX, XTTS-v2, and Cartesia), making it the premier multi-engine voice testbed for VTuber streaming setups.
- **Architectural trade-off:** Operates as a split-architecture client/server system (Python backend requiring conda/venv environments + separate web/desktop frontend) rather than an integrated standalone companion application.
- **Versus AIRI Fork:** Open-LLM-VTuber is a specialized backend voice and streaming router; AIRI is an all-in-one standalone companion runtime that pairs 23 registered speech interfaces with in-process zero-shot voice cloning, conversational turn pacing (thinking fillers and subconscious asides), and dynamic actor voice switching mid-dialogue.

### 🌐 Amica
- **Where it shines:** Clean, focused 3D VRM presentation with zero installation. Amica runs effortlessly in modern web browsers, rendering 3D VRMs with smooth blendshapes, look-at camera tracking, and client-side Silero VAD voice interruption.
- **Architectural trade-off:** Memory is limited to a flat sliding context window, and local speech generation requires configuring external local server daemons or secondary RVC post-processing hops.
- **Versus AIRI Fork:** Both projects offer zero-install web runtimes, but Amica deliberately focuses on a streamlined, single-screen avatar chat interface; AIRI expands into a complete companion operating environment with multi-tier temporal memory, in-process WebGPU speech synthesis, in-app texture editing, and desktop overlay stages.

### 🛡️ NekoGPT
- **Where it shines:** Industrial-grade concurrency and strict contract boundaries. NekoGPT isolates SQLite database transactions, archive compression, and audio streaming into dedicated background worker threads, preventing event-loop blocking and UI stutter during heavy tasks.
- **Architectural trade-off:** Distributed primarily as a commercial Steam product, focusing on curated 2D Live2D and Spine characters rather than user-imported 3D VRM pipelines or open customization.
- **Versus AIRI Fork:** NekoGPT prioritizes rock-solid worker thread isolation and commercial stability for curated 2D visual novel-style characters; AIRI provides an open, hackable runtime with extensive 3D/2D model custody, procedural motion diffusion, and user-owned cloud synchronization.

### 🍵 Utsuwa
- **Where it shines:** Polished, low-friction desktop installation. Utsuwa offers one of the simplest setup experiences for 3D VRM companions, pairing a clean transparent desktop overlay with a built-in local embedding indexer for conversational memory.
- **Architectural trade-off:** Relies on push-to-talk by default rather than continuous duplex interruption, and voice cloning requires setting up an external HTTP voice daemon.
- **Versus AIRI Fork:** Utsuwa touts minimal setup; AIRI counters with a **60-second Quick Start onboarding flow** and an automated **2-phase model analysis engine** that reads the imported VRM's blendshape tree, classifies facial expressions, and synthesizes model-tailored acting prompts automatically—delivering deeper avatar custody with zero manual bone or slider mapping.

### 📺 AITuberKit
- **Where it shines:** Built specifically for live streaming and content creation. Features native YouTube live chat scraping, superchat trigger handling, and deep integration with the Japanese speech synthesis ecosystem (VOICEVOX, AivisSpeech, Style-Bert-VITS2).
- **Architectural trade-off:** Recent v2.0+ licensing shifts impose custom commercial restrictions, and long-term memory requires external orchestration through Dify or third-party RAG services.
- **Versus AIRI Fork:** AITuberKit is tailored for audience-facing YouTube broadcasting and stream monetization; AIRI is designed for 1-on-1 private companion presence, featuring 4-tier local temporal memory, offline WebGPU execution, and permissive open-source licensing (MIT).

### 🌸 Soul of Waifu
- **Where it shines:** Turnkey bundled neural voice conversion. Ships with an integrated RVC v2 pipeline, allowing users to apply custom voice timbre transfer across diverse models without manual audio routing.
- **Architectural trade-off:** Conversational flow is limited to single-turn request loops, and voice customization relies on post-processing audio conversion passes that add latency rather than direct speech parameter control.
- **Versus AIRI Fork:** Soul of Waifu uses an external RVC model to resynthesize voice timbre; AIRI integrates an in-engine **DSP Audio Studio** that applies real-time formant shifting, pitch adjustment, parametric EQ, speed, and spatial effects across *all* integrated speech providers—paired with one-click AI voice tailoring that automatically tunes preset parameters to match the character's exact personality.

### 🌱 Upstream AIRI (`moeru-ai/airi`)
- **Where it shines:** Turnkey setup convenience. Upstream makes it effortless to get started: users can enter a payment card via Stripe to access pre-configured hosted cloud models, bypassing the friction of sourcing API keys, picking models, or configuring compatible providers across all 5 senses.
- **Architectural trade-off:** Steers toward a centralized hosted subscription model with prepaid credit proxies, routing chat and vision through an opaque auto-gateway where the operator chooses the underlying model.
- **Versus AIRI Fork:** Upstream optimizes for commercial cloud convenience; this fork optimizes for **user-first sovereignty with portable profiles**. AIRI provides all 5 senses (chat, vision, speech, transcription, and motion) as local, offline-capable models out of the box—paired with a free-tier catalog initiative for setup convenience without cloud lock-in or subscription paywalls.

### 💫 AIRI (`dasilva333/airi`)
- **Where it shines:** Deep multimodal integration and user-first custody. Features 3 in-process WebGPU/WASM neural speech engines running offline without background server daemons, a built-in reference voice cloning studio, 4-tier temporal memory (daily episodic summaries, immutable narrative journal, lifetime relational thread, and subconscious echo chips), an Autonomous Visual Director, and in-engine avatar customization.
- **Trade-off:** The sheer breadth of the runtime creates a steeper initial learning curve and higher configuration surface than single-purpose desktop pets or web-only viewers.

---

## 4. Key Architectural Lessons & Takeaways

1. **"Supports Voice" is Not a Binary Checkbox:**
   - There is a vast difference between:
     - **In-Process WebGPU/WASM TTS** (zero Python, zero external daemons, executes entirely within the client application).
     - **Local Server Daemons** (requires running Python FastAPI / PyTorch servers on separate ports).
     - **Audio-to-Audio Timbre Conversion (RVC)** (an optional secondary vocoding filter that alters pitch and timbre after TTS completes).
2. **"Supports VRM / Live2D" Goes Far Beyond File Loading:**
   - Evaluating avatar support purely on whether a `.vrm` or `.model3.json` loads misses what the companion actually *does* with that body:
     - **Viewport Looping vs. Reactive Agency:** A static transparent window playing looped idle animations differs vastly from dynamic blendshape emotion parsing, tactile touch reactions, and head-following physics.
     - **Fixed Clips vs. Generative Motion:** Pre-baked animation playback limits expression; runtime procedural motion generation (Text-to-VRMA) allows companions to synthesize novel physical actions on the fly.
     - **In-App Custody vs. External DCC Dependency:** Whether users can toggle wardrobes, switch actors mid-dialogue, or modify textures in-engine directly, versus needing external Blender or Unity pipelines for basic changes.
3. **"Duplex Voice" Requires Software Barge-In:**
   - Desktop companions using Silero VAD achieve software-driven barge-in interruption by cutting audio output buffers and aborting LLM token streams. No desktop companion currently implements hardware acoustic echo cancellation (AEC); quiet environments or headset audio remain essential.
4. **Memory Depth is About Temporal Hierarchy:**
   - Raw vector search over a flat chat log inevitably causes context bloat and contradictory recall. Meaningful continuity requires segmenting short-term daily episodic rollups (STMM), immutable narrative journals (LTMM), and lifetime relational bonds.

---

## 5. How to Contribute Corrections

If you are a user or maintainer of any featured companion and notice:
- A new version or release that introduces in-process speech or updated memory models
- An unlisted speech provider adapter or audio engine
- A discrepancy in how your architecture is classified

Please open an issue or pull request referencing the relevant source files. We will gladly review the code, verify the behavior, and update both this guide and the underlying forensic dossier.
