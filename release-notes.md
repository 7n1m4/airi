# 🚀 AIRI v0.9.33-stable.20260919 — Release Notes

This release introduces the brand new **Arcade Retro Gaming Agent (WIP preview)** with over 8,000+ classic DOS titles, the dedicated **Sound Studio & Generative Music Playground** powered by MiniMax M3 and YuE 2.0, the **Free AI Hub V2 Upgrade** with one-click model activation and Cloudflare Workers AI integration, comprehensive **Step-by-Step Polish & Hardware Telemetry in Onboarding V3** featuring the new **⭐ Real-Time Text-to-Motion VRM Finale Preview**, the **Phase 2 ZIP Data Vault**, and cross-window **Desktop Settings Navigation**.

---

## ✨ Key Highlights

### 🕹️ Arcade: Autonomous Retro Gaming (Brand New Experimental Feature — WIP)
*Note: This is an early-access Work in Progress (WIP) preview of the upcoming Arcade system.*
- **8,000+ Classic DOS Games**: Instant browser and desktop emulation library powered by integrated DOSBox.
- **Autonomous VLM Game Agent**: Multi-turn visual game perception allowing AIRI to observe, analyze, and play retro titles alongside you.
- **Precision Tool Calibration & Controls**: Calibrated mouse and pointer dispatch, AI drag density, and SimCity building grid coordinate overlays.
- **Companion Deck & Quickload**: Integrated turn memory, quickload game state preservation, and custom per-game prompt tuning modals.

### 🎵 Sound Studio: Generative Music Playground (Brand New Feature)
- **Co-Creation Music Studio**: Brand new dedicated Sound Studio workspace for real-time generative music composition and exploration.
- **High-Fidelity Model Support**: Native support and benchmarks for cutting-edge music generation models including **MiniMax Music-01 (M3)** and **YuE 2.0**.
- **`airi-audio-server` Architecture**: Direct integration with the `audio.cpp` backend for fast, local/remote audio and musical synthesis.

### 🌐 Free AI Hub & Cloudflare Workers AI (V2 Interactive Upgrade)
- **One-Click "Save Provider" & "Use as Active Model"**: Immediately configure and activate working free models into your active LLM runtime directly from the hub without manual copying.
- **"Configured Only" Filter & STT Integration**: Added quick toggle filters for existing active providers, instant STT engine activation, and deep-link shortcuts to provider settings.
- **Cloudflare Workers AI Integration**: Connect your existing Cloudflare account via OAuth PKCE to unlock free access to high-performance models (such as GLM-4.7, Llama 3.3, and DeepSeek) with zero setup friction.
- **Live Endpoint Validator & Automated Refresh**: Built-in endpoint health probing and automated catalog refresh tooling.

### 🧙 Onboarding V3: Step-by-Step Experience Polish & Hardware Intelligence
- **Step 1 (Triage)**: Enhanced high-contrast card layouts to ensure zero background or avatar bleed-through on Account Sign-In vs Local Air-Gapped options.
- **Step 4 (User Profile)**: Enforced strict draft isolation and added smart username preservation when switching user archetypes.
- **Step 6 (Persona)**: Added section 1 reset default buttons for quick character restoration and automated persona tag extraction.
- **Step 8 (Consciousness)**: Redesigned into a 3-Tier Brain Selection (Free Cloudflare/Community AI, Local on-device WebGPU, and Custom BYOK Providers) with hardware capability detection and auto-detected reasoning models.
- **Step 7 (Hearing)**: Added persistent microphone permission helpers and inline access grant actions.
- **Step 9 (Speech)**: Expanded Deepgram voice presets and reinforced voice draft synchronization.
- **Step 10 (Thinking)**: Added custom token ceiling controls and an interactive Response Cadence Simulator to live-test turn latencies, token lengths, and sentence counts.
- **Step 12 (Vision)**: Integrated full character persona context into the 2-hop VLM visual simulation.
- **Step 15 (Artistry)**: Character persona tags now automatically seed and synthesize into visual style generation prompts.
- **Step 17 (Automation & Tools)**: Added on-demand engine prewarming with download progress bars and VRM avatar compatibility alerts.
- **⭐ Step 18 (Stage Finale & Motion Preview)**: Added an interactive **Text-to-Motion Kinetic Finale Widget** — when selecting a 3D VRM vessel, you can prompt and preview custom procedural dances and skeletal gestures live on stage before completing setup; bundled with automated voice profile synthesis and non-blocking launch closure.

### 📦 Data Vault, Memory & Cloud Sync
- **Phase 2 ZIP Data Vault**: Full companion export/import archive with universal smart data migration and LevelDB integrity fixes.
- **Unlinked Memory Bridge**: Modernized orphaned memory management with zero-custody cloud sync support.
- **Engine Optimization**: Eliminated DuckDB memory accumulation on stage reload and purged legacy unused modules.

### 🖥️ Desktop UX, Chat Navigation & Nan0 Early UI Preview
- **Cross-Window Settings Access**: Jump directly into specific settings tabs and provider pages straight from the desktop chat workspace.
- **Lightweight Update Checker**: Built-in desktop release notification banner with inline release notes.
- **Cognition Playground**: Redesigned cognition tab featuring a guided personality questionnaire and playground-first layout.
- **Prompt Hierarchy Invariants**: Enforced strict persona prompt priority and eliminated redundant boilerplate context.
- **Nan0 Living Cognition (Early UI Preview)**: Shipped an early-access non-functional UI mockup for the upcoming 3-segment Living Cognition system (underlying Subconscious Reflex & TypeSafe Jev research progressing in background).
