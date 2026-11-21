---
title: Maintainer Integration Checklist
description: Roadmap and integration status for Anima fork features.
---

# Anima Fork: Maintainer Integration Checklist (Indexed)

This document enumerates independently mergeable features and subsystems implemented in this fork.
Each item is indexed for precise selection during review.

---

## 1. Chat & UX Improvements

I. ACT-driven chat bubble styling (token-based visual states)
II. Context usage UI (token counter + visual meter)
III. Configurable send key (Enter / Ctrl+Enter)
IV. Persona-based auto-titling for memory summaries
V. Context-width inheritance per provider/model
VI. Atomic session rebuild (context compaction with recent retention)
VII. Unified journaling preview (inline carousel feed)

---

## 2. Character System Enhancements

I. Per-character LLM configuration overrides (model, temp, tokens)
II. Anima card JSON format (full config export, no user data)
III. Background bundling with card export
IV. Dynamic export snapshots (outfit + expression capture)
V. SillyTavern PNG import/export compatibility
VI. Duplicate-safe import handling (auto-renaming)

---

## 3. ACT / Expression Pipeline

I. Full ACT token parsing pipeline (chat → expression/animation)
II. Heuristic emotion mapping system (keyword → archetype)
III. Custom expression key mapping (user-defined bindings)
IV. Dynamic expression resolution (VRM expressionMap fallback)
V. VRMA-trigger support via ACT tokens
VI. Blended transitions (lerp-based multi-emotion fade)
VII. Live2D parity (stable baseline manager)

---

## 4. VRM Animation System

I. Expanded VRMA preset library (24 animations)
II. Per-character animation palette selection
III. Idle animation randomizer ("hairball" cycle)
IV. ACT-triggered animation playback
V. Performance priority system (interrupt + resume idle)
VI. User-uploaded VRMA support
VII. VRM settings panel refactor

---

## 5. Scene & Background System

I. Character-scoped persistent backgrounds
II. Transparent rendering pipeline (VRM + Live2D)
III. Image journal → background bridge
IV. AI-triggered background generation + application
V. Background export with character card
VI. Photo mode (composite capture with countdown)
VII. Selfie-based preview system (dynamic card thumbnails)

---

## 6. Memory System

I. Short-term memory summaries (daily context blocks)
II. Long-term journal (IndexedDB persistent storage)
III. Unified retrieval system (long-term → short-term fallback)
IV. Per-character memory isolation
V. Immutable daily summaries

---

## 7. Artistry (Image Generation)

I. Native ComfyUI API integration (no middleware)
II. Replicate provider integration (cost-aware UI)
III. NanoBanana provider support
IV. BYOW (custom ComfyUI workflow mapping)
V. Workflow templates + presets
VI. Prompt placeholder system (`{{PROMPT}}`, `{{IMAGE}}`)
VII. Auto-archival to image journal
VIII. Artistry enable/disable (global + per-character)
IX. Prompt stripping when disabled
X. Interactive gallery widget (metadata + actions)

---

## 8. Vision System

I. Dedicated Vision store (separate from chat LLM)
II. Full request handoff to VLM for image turns
III. Drag/drop + paste image input
IV. Image-aware chat history
V. Multi-provider support (local + cloud VLMs)

---

## 1. Provider Integrations

I. OpenRouter (LLM + onboarding integration)
II. Deepgram STT integration
III. AWS Polly TTS integration
IV. Local Whisper + Kokoro pipeline (on-device)
V. Chatterbox TTS system (preset + transformation pipeline)
VI. Streaming support (DeepSeek / GLM reasoning-delta)
VII. Gemini Live streaming pipeline (audio queue, marker parsing, grounding UI)

---

## 10. Proactivity & Sensors

I. OS telemetry injection (window, app, idle)
II. Activity history tracking
III. System metrics (CPU/GPU, volume, time)
IV. Tool-aware proactivity (dynamic tool access)
V. Session milestone triggers

---

## 11. Desktop UI (Control Island)

I. Glassmorphic floating UI system
II. Mutual exclusion (single active island)
III. Emotion picker UI
IV. Profile switcher integration
V. Animation cycle controls
VI. ScrollLock mic toggle
VII. Manual mic mode (no VAD)
VIII. Resource status island
IX. Transcription feedback toasts
X. Hover timestamps
XI. UI icon standardization

---

## 12. MCP System

I. MCP discovery (filesystem + GitHub + curated)
II. MCP management UI (settings-integrated dashboard)
III. Per-tool enable/disable (titration)
IV. Tool readiness monitoring
V. Config templates + setup guidance
VI. Canonical path resolution

---

## 13. Wardrobe System

I. Schema-driven outfit system
II. Base vs overlay layering logic
III. Interactive outfit builder (state snapshot + preview)
IV. Control Island wardrobe integration
V. Outfit persistence in character cards

---

## 14. Platform / Stability Improvements

I. Window interaction throttling (IPC protection)
II. Secure CORS bypass (Electron main process)
III. Environment guardrails (Node/pnpm constraints)
IV. Identity-guarded model switching
V. Tray position restore
VI. VRM animation stability improvements
VII. Electron sandbox enablement
VIII. MCP config path stabilization

---

## 15. Onboarding System

I. Terminology abstraction (Consciousness / Speech / Hearing)
II. Easy Mode (OpenRouter + Deepgram auto-config)
III. Advanced Mode (manual provider selection)
IV. Multi-step onboarding orchestrator
V. Polymorphic UI components for setup flows

---

## 16. Live2D Parity

I. Unified 3-panel configuration layout
II. Expression mapping (hold-to-bind)
III. Compact UI mode for side panel
IV. Full persistence via AiriCard
