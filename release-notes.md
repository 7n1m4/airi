# 🚀 AIRI v0.9.35-stable.20260928 — Release Notes

This release introduces the complete **Single-Card ZIP Export & Import Ecosystem**, enabling creators to effortlessly package, share, and backup entire companions—including 3D/2D avatar vessels, custom textures, voices, and isolated memories—in a single portable file. Alongside card portability, this update brings a major overhaul to both the **AIRI Card Hub** and **AIRI Card Editor**, unifying avatar staging and configuration under one coherent roof, and debuts the brand new **Embedded Stage Avatar Viewport** directly into Desktop Chat.

Under the hood, this release marks a monumental breakthrough in desktop resource management with **Active VRAM Eviction & Deep Standby Hibernation**. Local inference runtimes now automatically unload from VRAM after 15 minutes of inactivity, bringing idle resource usage down to near-zero and eliminating desktop memory pressure during long sessions. Additionally, creators gain access to the **Cognitive Screen Sentinel** (enabling natural-language question gates for proactive vision), a dedicated **Nan0 Live Cognition Desktop Panel**, smarter **Departure & Return Awareness** that silences false idle boredom alerts when you step away, a resolved **Proactivity AFK Deadlock**, and native **Indonesian Language Support**.

---

## ✨ Product Updates

### 🗃️ Character Cards: AIRI Card Hub & Unified Card Editor

#### AIRI Card Hub (Everyone)
- **Complete Single-Card ZIP Bundles**: You can now export and import individual characters as self-contained `.zip` archives containing all companion metadata, avatar models (VRM, Live2D, MMD, Spine), custom wardrobe textures, speech audio profiles, and isolated memory journals.
- **Universal Format Compatibility**: Enhanced card export modal supporting Character Card V2 and V3 specifications, standalone JSON, and PNG images with embedded metadata chunks for broad compatibility across the companion ecosystem.
- **Interactive Cover Art Selector & Live Preview**: Added a 3-column cover art picker with customizable crop aspect ratios, real-time dynamic query previews, and automatic monogram badge generation for text-only companion cards.
- **Redesigned 5-Tab Card Inspector**: Overhauled the card inspect modal into five canonical tabs featuring comprehensive concept summaries, full specification sheets, and a unified avatar vessel selector.
- **Crisp Typography & Smooth Streaming**: Eliminated CSS 3D transform text blurring and streamlined message streaming by removing unnecessary token cloning overhead.

#### AIRI Card Editor (Unified Configuration)
- **Unified Staging Tab**: Integrated avatar vessel staging directly into the card configuration flow (absorbing the previous Studio tab). Creators can now preview, calibrate, and bind 3D/2D avatar models, select **"None"** for text-only companions, manage multi-actor cast rosters, and pick visual scene backgrounds with direct image uploads—all in one place.
- **Consolidated Generation Tab**: Moved the Consciousness (LLM) model picker directly to the head of the Generation tab alongside thinking mode preset chips (disabling reasoning overhead or fine-tuning thinking token budgets), system prompt templates, and sampling controls.
- **Retirement of the Modules Tab**: Streamlined the card editor navigation by eliminating the legacy Modules tab, giving all visual avatar staging and AI cognition controls natural, dedicated homes in Staging and Generation.
- **Cognition Tab Enhancements**: Sub-tab models and universe RAG++ memory segment with upgraded pill toggles and persistent search engine state.

### 🪟 Desktop Chat: Interactive Embedded Stage Viewport & 3D Visuals
- **Embedded Stage Avatar Viewport**: You can now view and converse with your avatar companion directly inside the Desktop Chat window's right context panel. The embedded stage is fully interactive, synchronizes with global positioning, and expands on demand.
- **3D Levitating Card Splash Loader**: Replaced the static launch screen with a smooth 3D levitating holographic card animation during application startup.

### ⚡ Resource Intelligence: Active VRAM Eviction & Deep Standby Hibernation
- **Automated VRAM Eviction (15-Minute Inactivity TTL)**: Heavy local AI models (WebGPU runtimes, Whisper transcription, Moondream vision, and speech synthesizers) now automatically unload from GPU memory after 15 minutes of inactivity, freeing system memory for other desktop applications.
- **Seamless Deep Standby Recovery**: When you resume chatting or interact with your companion, runtimes dynamically reload on demand without requiring an application restart.
- **Zero-Allocation Attention Guard**: Eliminated memory accumulation and buffer churn in continuous screen perception, capping background capture resolutions to 1080p and ensuring stable, leak-free background vision.
- **In-App Memory Sentinel & Telemetry**: Added runtime diagnostic monitors that track memory pressure, buffer recycling, and background texture eviction across multi-hour sessions.

### 🧠 Nan0 Cognition: Desktop Inspector Panel & Departure Intelligence
- **Live Desktop Cognition Panel**: Open a dedicated real-time desktop inspector window to observe Nan0's subconscious thoughts, emotional salience, and cognitive reflexes live as conversations unfold.
- **Smart Departure & Return Dynamics**: When you tell your companion you are stepping away, heading to work, or going to bed, AIRI gracefully acknowledges the departure and suppresses false "idle boredom" interruptions until you return.
- **System 1 Cognition Upgrades**: Upgraded conversational continuity and relationship memory to pure System 1 intelligence, eliminating brittle keyword matching and lexical fallbacks.
- **Dynamic User Identity Anchors**: Subconscious reasoning prompts now dynamically resolve your configured user identity, completely removing legacy placeholder names.

### 👁️ Proactivity: Cognitive Screen Sentinel & AFK Deadlock Elimination
- **Cognitive Screen Sentinel (Question-Based Semantic Gates)**: Instead of relying on rigid keyword lists or window tags (like "youtube" or "error"), the Screen Watcher can now be activated through natural-language questions. You can pose plain sentences as intelligent perception gates—such as *"Did the user hit a compiler error or failing test?"* or *"Did a notable, unexpected event happen on screen?"* AIRI's System 1 coprocessor continuously checks on-screen visual evidence against these questions in real time, only chiming in when a question is genuinely answered "yes."
- **Decoupled Proactivity Heartbeats (AFK Deadlock Fix)**: Fixed an issue where proactivity suggestions would freeze when switching between active and idle tasks. Active-user heartbeats are now fully decoupled from idle detection gates, preventing AFK deadlocks.
- **Auto-Healing Vision Lifecycle**: Resilient frame decoding that automatically recovers screen watchers after operating system sleep or display sleep events.

### 🌐 Knowledge Graph, Voice Matching & Indonesian Localization
- **Knowledge Graph Entity Normalization**: Intelligent entity folding that resolves name variations, honorifics, and character nicknames, preventing fragmented graph clusters in the Mind Map.
- **AnimaDex Fast Voice Matching**: Sub-second System 1 acoustic voice matching pairing synthesized voices to companion archetypes.
- **Indonesian Language Support & Upstream Contributions**: Added native Indonesian localization across onboarding steps, settings pages, and companion dialogs. Special thanks to upstream contributor **@kaisaaru** for PR [#2662](https://github.com/moeru-ai/airi/pull/2662), with shoutouts to **@chiba233** for PR [#2658](https://github.com/moeru-ai/airi/pull/2658) (screen box sizing) and **@gg582** for PR [#2519](https://github.com/moeru-ai/airi/pull/2519) (Linux CI testing)!
