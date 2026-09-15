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
- **Where it shines:** Unrivaled desktop presence and physics. VPet features full Win32 window gravity, collision detection, throwing, climbing, and mood/hunger simulations. Its Steam Workshop integration is by far the largest in the community, with tens of thousands of user-created sprites, animations, and food items.
- **Trade-off:** LLM conversational intelligence and speech are external community plugins (`VPet.Plugin.LLM`) layered on top of a classic desktop pet engine, rather than an integrated multimodal cognitive loop.

### 🦀 Komorebi (Interactive Assistant)
- **Where it shines:** Unmatched memory footprint and native OS efficiency. Built with Rust and Tauri 2, Komorebi boots instantaneously and executes 100% offline via local Piper ONNX and local GGUF models. It is the only companion in this comparison with a built-in local LoRA fine-tuning engine (`komorebi-trainer`) that adapts character personality directly from user response ratings.
- **Trade-off:** Avatar rendering is strictly limited to 2D Live2D models, with no support for 3D VRM, Spine, or MMD.

### 🎭 Project N.E.K.O.
- **Where it shines:** Powerful computer use and immediate database transparency. Project N.E.K.O. features an active web-based `/memory` CRUD table where users can directly inspect, search, and delete live memory records from SQLite. Its ZeroMQ agent server provides desktop automation and screen capture for real-time task assistance.
- **Trade-off:** Setup involves significant infrastructure complexity (Steam client, Python environment, ZeroMQ brokers, and local GPT-SoVITS daemons), and voice conditioning depends on running external services.

### 🎙️ Open-LLM-VTuber
- **Where it shines:** Unrivaled speech diversity. Open-LLM-VTuber's modular `tts_factory.py` registers 19 distinct individual synthesis adapters—spanning CosyVoice, MeloTTS, Sherpa-ONNX, XTTS-v2, and Cartesia—making it the most versatile multi-provider voice lab for VTuber streaming pipelines.
- **Trade-off:** Operates as a split-architecture client/server setup (Python backend requiring conda/venv + web or desktop GUI) rather than an all-in-one standalone binary.

### 🌐 Amica
- **Where it shines:** Effortless browser accessibility. Amica runs cleanly in modern web browsers with zero installation friction, rendering 3D VRM avatars with smooth blendshape animations and client-side Silero VAD voice interruption.
- **Trade-off:** Limited to a flat sliding context window for memory, and local voice generation requires external server daemons or separate RVC post-processing hops.

### 🛡️ NekoGPT
- **Where it shines:** Industrial-grade concurrency contracts. NekoGPT's TypeScript monorepo enforces strict IPC boundary schemas and offloads heavy database operations, archive compression, and audio processing to dedicated background worker threads, preventing UI stutter during intensive local tasks.
- **Trade-off:** Distributed as a commercial Steam application (`Shinobu`), focusing heavily on curated 2D Live2D/Spine characters rather than user-imported 3D VRM pipelines.

### 🍵 Utsuwa
- **Where it shines:** Frictionless desktop installation and clean semantic memory. Utsuwa offers one of the simplest setup workflows in the ecosystem, bundling a local transformers embedding indexer and clean transparent desktop overlay for 3D VRMs.
- **Trade-off:** Conversational voice default relies on push-to-talk rather than continuous full-duplex interruption, and custom voice cloning requires routing through an external OmniVoice daemon.

### 📺 AITuberKit
- **Where it shines:** Built specifically for virtual content creators. AITuberKit features native YouTube live stream comment scraping, superchat reactions, and deep integration with the Japanese voice synthesis ecosystem (VOICEVOX, AivisSpeech, Style-Bert-VITS2).
- **Trade-off:** Recent v2.0+ licensing shifts restrict commercial usage, and long-term memory requires connecting to external Dify/RAG orchestrators.

### 🌸 Soul of Waifu
- **Where it shines:** Turnkey bundled voice conversion. Soul of Waifu ships as a pre-packaged distribution with an integrated RVC v2 pipeline, allowing users to apply custom neural timbres across arbitrary voice inputs without manual audio chaining.
- **Trade-off:** The 1.83 GB monolithic distribution has significant setup fragility across diverse Windows environments, and conversational flow is constrained by single-turn execution loops.

### 💫 AIRI (`dasilva333/airi`)
- **Where it shines:** End-to-end cognitive depth and in-process execution. Features 3 local in-process WebGPU/WASM speech engines (Kokoro, Pocket-TTS, MOSS-TTS) with zero external daemon setup, a built-in voice enrollment studio (`useLocalVoiceClone`), `<|ACTOR|>` mid-stream persona switching, a 4-tier memory architecture (STMM daily summaries, LTMM Sacred Journal, Lifetime thread, and subconscious Echo Chips), an Autonomous ComfyUI Visual Director, and in-app avatar surgery (V-HACK / God Mode).
- **Trade-off:** The breadth of the feature surface creates a steeper learning curve than single-purpose desktop pets or web-only viewers.

---

## 4. Key Architectural Lessons & Takeaways

1. **"Supports Voice" is Not a Binary Checkbox:**
   - There is a vast difference between:
     - **In-Process WebGPU/WASM TTS** (zero Python, zero external daemons, executes entirely within the client application).
     - **Local Server Daemons** (requires running Python FastAPI / PyTorch servers on separate ports).
     - **Audio-to-Audio Timbre Conversion (RVC)** (an optional secondary vocoding filter that alters pitch and timbre after TTS completes).
2. **"Duplex Voice" Requires Software Barge-In:**
   - Desktop companions using Silero VAD achieve software-driven barge-in interruption by cutting audio output buffers and aborting LLM token streams. No desktop companion currently implements hardware acoustic echo cancellation (AEC); quiet environments or headset audio remain essential.
3. **Memory Depth is About Temporal Hierarchy:**
   - Raw vector search over a flat chat log inevitably causes context bloat and contradictory recall. Meaningful continuity requires segmenting short-term daily episodic rollups (STMM), immutable narrative journals (LTMM), and lifetime relational bonds.

---

## 5. Community Review & Reddit Ready Draft

Below is a self-contained, 350-word discussion draft designed for community scrutiny on **r/LocalLLaMA** and **r/AICompanions**:

```markdown
Title: 11 desktop AI companions compared: voice, memory, avatars, and local execution

Hey everyone,

I maintain an active fork of AIRI (an open-source desktop AI companion runtime). Over the past few months, our team did a deep architectural audit across 11 desktop companion projects (including VPet, Project N.E.K.O., Open-LLM-VTuber, Komorebi, Amica, NekoGPT, Utsuwa, AITuberKit, Soul of Waifu, and AIRI).

We wanted to move past superficial marketing tables ("Supports VRM: Yes/No") and evaluate what actually runs on the user’s machine.

Three core architectural findings stood out:

1. Voice Custody & Latency: "Supports local voice" means completely different things across projects. Most open companions (Open-LLM-VTuber, N.E.K.O., Utsuwa) require orchestrating external Python servers (GPT-SoVITS, OmniVoice) on separate localhost ports. Only a few run neural speech directly in-process via WebGPU/WASM (Kokoro, Pocket-TTS). Additionally, direct zero-shot conditioning (generating target timbre directly from text) is often confused with RVC (an audio-to-audio conversion pass requiring secondary pitch extraction and vocoding).
2. Memory Architecture: Most apps still rely on flat sliding context windows or basic vector dumps. When companions attempt true long-term continuity, the divide is stark: Project N.E.K.O. provides an active web-based CRUD table over raw SQLite records, whereas AIRI implements multi-tier temporal hierarchies (daily episodic rollups, immutable journals, and lifetime relational threads).
3. Autonomy & Agency: True ambient presence remains rare. Very few projects implement continuous salience-gated vision or proactive heartbeats with smart silence (knowing when NOT to speak while the user is working). Komorebi stands out with native Rust desktop automation and local LoRA personality fine-tuning, while VPet remains unmatched for pure Win32 desktop physics and modding scale.

We've organized the full comparison into three visual panels (Voice, Memory, and Avatars) in our root repository guide:
👉 Public Guide: https://github.com/dasilva333/airi/blob/main/COMPARISONS.md
👉 Full Forensic Dossier with Commit/Source Line Citations: https://github.com/dasilva333/airi/blob/main/docs/project-companion-comparisons.md

Because software moves fast, we treat this as a living document. If you maintain or use any of these companions and spot an outdated implementation, missing adapter, or mischaracterized pipeline, please let us know in the comments or open a PR!
```

---

## 6. How to Contribute Corrections

If you are a user or maintainer of any featured companion and notice:
- A new version or release that introduces in-process speech or updated memory models
- An unlisted speech provider adapter or audio engine
- A discrepancy in how your architecture is classified

Please open an issue or pull request referencing the relevant source files. We will gladly review the code, verify the behavior, and update both this guide and the underlying forensic dossier.
