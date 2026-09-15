# 🚀 AIRI v0.9.32-stable.20260915 — Release Notes

This release introduces the **Arcade Room & Autonomous Game Copilot** with over 8,900 retro classics, dedicated **Audio Output Device Selection**, the **Cloudflare & BYOS CloudSync Infrastructure Overhaul**, the **Free AI Hub**, an **Official MCP Registry** integration with live health probes, the **Live2D Gimmick Deck**, **100% Localization Parity across 9 languages**, and comprehensive **Power Throttling & Lifecycle Management**.

---

## ✨ Key Highlights

### 🕹️ 1. Arcade Room & Autonomous Retro Game Copilot

* 🎮 **Built-in JS-DOS & Archive.org Retro Catalog**:
  * Added a dedicated **Arcade Room** workspace in the desktop stage.
  * Embedded high-performance JS-DOS WebAssembly runtime with direct access to an 8,900+ MS-DOS retro game library powered by Archive.org.
  * Features instant screenshot capture and companion quick-ask integration.
* 🤖 **Autonomous Game Copilot with Ghost Cursor**:
  * Introduced `useArcadeAgent`: your companion can now perceive game video frames, analyze gameplay state, and provide real-time strategic commentary and assistance.
  * Real-time **Ghost Cursor** overlay displays where the companion is looking and pointing on the retro canvas.
  * Built-in dynamic vision resolution scaling, Moondream VLM progress feedback, and automated safety failovers (e.g. SimCity operational verification).

---

### 🎙️ 2. Audio Pipeline & Voice Studio Overhaul

* 🔊 **Audio Output Device Selection**:
  * You can now select dedicated speaker and audio output devices specifically for TTS speech playback, independently from system default outputs.
* 🛠️ **`airi-audio-server` Process Management**:
  * Integrated process lifecycle supervision and background server spawner for `airi-audio-server`.
  * Added voice curation studio, transcript alignment, and inline zero-shot voice cloning.
* ⚡ **Pre-Warmed Audio Fillers & Voice Stability**:
  * Integrated inline pre-warm controls for conversational fillers in Onboarding V3.
  * Fixed Kokoro WASM synthesis timeouts and normalized voice metadata.

---

### ☁️ 3. Cloudflare & BYOS CloudSync Infrastructure Overhaul

* 🌐 **Cloudflare Connect Wizard & Account Hub**:
  * Added a dedicated Cloudflare account status indicator, streamlined connect wizard, and account hub in Settings.
  * Fixed OAuth token serialization bugs, added automatic Cloudflare Account ID resolution, and added auto-restoration for Edge Vault credentials with built-in connection healing controls.
* 📦 **Unconditional 3D Asset Backups & Model Sync**:
  * Removed upload gates on display models, backgrounds, VMD dance animations, and VRMA motions, ensuring all custom 3D companion assets are reliably backed up to private Cloudflare R2 / S3 storage.
  * Remote model preview thumbnails now reconcile automatically to R2, and dictionary keys are preserved during remote manifest synchronizations.
* 🧹 **Selective Sync & Disk Reclaim**:
  * Enhanced the **Selective Sync Panel** with bulk "Select All" / "Deselect All" controls, preserved chat session selection states, and character-scoped storage breakdowns.
  * Introduced **Prune Unlinked Local Models**: safely purge local cached 3D binaries to reclaim local disk space while keeping your assets secure in your remote R2 backup.
* ⚡ **Sync Engine Performance & Request Throttling**:
  * Eliminated redundant reads and API request flooding across BYOS cloud synchronization routines.
  * Bundled LevelDB integrity pre-flight checks to protect IndexedDB local state from Chromium WAL corruption.

---

### 🔌 4. Official MCP Registry & Live Memory Hub

* 🌐 **Official Model Context Protocol Registry**:
  * Migrated tool discovery to the official MCP registry with real-time health probing and hardened installer gating.
  * Added custom developer MCP capability packs within the Character Card Editor.
* 🧠 **Live Memory Hub Telemetry**:
  * Connected reactive memory telemetry to the settings surface for monitoring active recall and memory retention.

---

### 🎭 5. Live2D Gimmick Deck & ModelCustomizer Upgrades

* 🃏 **Live2D Gimmick Deck**:
  * Added the Live2D Gimmick Deck with a hybrid translation architecture and Live2D DSL runtime bridge.
  * Access feature-gated gimmicks and costume interactions directly from the avatar context menu.
* 🎛️ **Soundboard & Reactions**:
  * ModelCustomizer now features an integrated **Voice & Reactions soundboard** and language controls to trigger character lines and physical animations.
* 🛡️ **Stage-Mate Native Mesh & Memory Fixes**:
  * Resolved native memory leaks, process storms, and mesh accumulation during repeated avatar swaps.

---

### 🌐 6. Free AI Hub & Provider Ecosystem

* 🎁 **Free AI Hub Discovery Surface**:
  * New discovery surface showcasing free and zero-configuration AI providers and models.
* ☁️ **Expanded Provider Capabilities**:
  * Added Amazon Bedrock backend support and forward-ported Tier 1 & Tier 2 model providers with CORS bypass.
  * Added process lifecycle cards and process management for local ComfyUI instances, including direct Artistry Playground callouts.
  * Fixed Apple Core AI weight requirement checks and cache invalidation.

---

### 🌍 7. 100% Localization Parity Across All 9 Languages

* 🌐 **Full Monorepo Translation Coverage**:
  * Completed 100% localization parity across English, Chinese (Simplified/Traditional), Japanese, Korean, Spanish, French, German, and Russian.
  * Covers Onboarding V3, Desktop Settings, Tamagotchi Stage, Tray menus, and Companion comparison views.
  * Added automated i18n auditing tools (`pnpm run i18n:audit`).

---

### 🔋 8. Power Throttling & Desktop Stability

* 💤 **Display Lock & Sleep Power Throttling**:
  * Stage rendering loops, 3D/Live2D animations, and sensory observation tickers now automatically pause when the OS locks or goes to sleep, saving battery and GPU cycles.
* 🔒 **Channel Server Token Hardening**:
  * Resolved token sync loops in the local Gateway WebSocket channel server to protect paired mobile connections.
* 📱 **Safari & Mobile Web Form Shield**:
  * Mitigated iOS Safari Form Assistant popups from obscuring input in Pocket and Web companion stages.
* 🛡️ **Uninstaller Safety**:
  * Hardened desktop uninstallers to prevent accidental user data loss in custom directories.
