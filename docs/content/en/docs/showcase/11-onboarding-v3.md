# Onboarding V3 & 60-Second Quick Start

![Onboarding V3 & Quick Start Cockpit](/showcase/onboarding-v3-quick-start.avif)

The **Onboarding V3 & Quick Start Cockpit** transforms the first-run experience from a tedious multi-step form into a rapid, visually rich onboarding flow. Designed to deliver a working, embodied AI companion in under 60 seconds, it offers two distinct onboarding paths: the unified **60-Second Quick Start Dashboard** for users who want immediate embodiment, and the guided **6-Step Setup Wizard** for meticulous customization.

---

## 60-Second Quick Start Cockpit

![Quick Start Cockpit](/showcase/onboarding-v3-quick-start.avif)

The **Quick Start Cockpit** provides a unified four-corner dashboard where users configure all primary faculties on a single cohesive canvas:
- **Top Left (Vessel & Stage)**: Instant model selection across Live2D, VRM, Spine, and MMD avatars with live preview framing.
- **Top Right (Consciousness & Brain)**: LLM provider selection (OpenAI, Anthropic, Gemini, DeepSeek, Ollama, RWKV WebGPU) and API key configuration with inline model discovery.
- **Bottom Left (Soul & Persona)**: Character persona selection, SillyTavern card drag-and-drop, and nickname customization.
- **Bottom Right (Voice & Timbre)**: Voice synthesis engine selection (Kokoro local WebGPU, PocketTTS, ElevenLabs, Fish Audio, Edge TTS) with one-click preview auditioning.

A prominent **Launch AIRI Stage** action performs atomic pre-flight validation and initializes the stage session in real time.

---

## Guided Setup Wizard Walkthrough

For creators desiring deep configuration, the multi-step wizard guides the user through each foundational layer of AIRI embodiment:

### 1. Hardware & Environment Verification

![Welcome Hardware Verification](/showcase/onboarding-v3-welcome.avif)

The Welcome step automatically probes the host system:
- Detects GPU acceleration (WebGPU, Apple Metal, NVIDIA CUDA, Vulkan).
- Audits local memory and audio I/O capabilities.
- Offers returning users an instant **Restore Backup (BYOS)** option to recover configurations from S3, Cloudflare R2, or local archives without completing initial setup again.

### 2. Experience Archetypes

![Experience Archetypes](/showcase/onboarding-v3-experience-archetypes.avif)

Sets the high-level operational posture of AIRI through tailored archetypes:
- **Casual Companion**: Warm conversational banter, spontaneous spoken pacing, and gentle desktop reactions.
- **Productivity & Workspace Partner**: Focused task execution, proactive reminders, code assistance, and active-window awareness.
- **Gaming & Stream Backseat**: Reactive banter, screen-watching commentary, and game state empathy.
- **Creative Director & Roleplay**: Unrestricted multi-actor acting cues, ComfyUI image manifestation, and branching scenario lore.

### 3. Soul & Persona Starter Roster

![Persona Starter Cards](/showcase/onboarding-v3-persona-starter-cards.avif)

Features an 8-card visual starter roster spanning varied personality profiles, speaking styles, and default scenarios. Cards support:
- Live pronoun and username token interpolation (`{{user}}` $\rightarrow$ custom user handle).
- One-click import of external SillyTavern CCv2/CCv3 PNG cards and native `.airi` bundles.
- Seamless multi-actor identity tags (`<|ACTOR:...|>`) preserving character lore.

### 4. Physical Vessel 3D Coverflow

![Vessel Coverflow](/showcase/onboarding-v3-vessel-coverflow.avif)

An interactive 3D coverflow carousel rendering avatars in real time:
- Seamlessly cycles across Live2D cubism models, VRM 0.x/1.0 avatars, and Spine 2D skeletons.
- Live idle animations and physics settling directly on the setup canvas.
- Real-time model metadata inspection (author, polycount, expression blendshapes, and texture resolution).

### 5. Pre-Flight Honesty Matrix Finale

![Pre-Flight Honesty Matrix Finale](/showcase/onboarding-v3-stage-finale.avif)

The final pre-flight screen audits operational integrity across all 6 cognitive faculties:
- **Audio Input & Hearing**: Mic active and speech recognition verified.
- **Voice Synthesis Engine**: Selected TTS provider and voice model ready.
- **Memory Hierarchy**: STMM, Long-Term Journal, and Dream Worker active.
- **Consciousness & Reasoning**: Primary LLM connection validated.
- **Avatar Vessel & Stage Driver**: 3D/2D renderer initialized with stage lighting.
- **Autonomous Tools**: Sandboxed local tools and MCP bridges verified.

A live **Turn 0 Opening Dialogue Preview** allows testing the companion's first greeting with full expression cue execution, clean actor badges (e.g. `[ 👤 Aqua ]`), and instant voice playback before launching onto the main stage.

---

## Key Capabilities

- **Unified 60-Second Quick Start Cockpit**: Configure Vessel, Brain, Persona, and Voice on a single canvas.
- **6-Step Guided Customization Wizard**: Deep step-by-step calibration from hardware probing to pre-flight matrix.
- **Interactive 3D Vessel Coverflow**: Real-time avatar preview across Live2D, VRM, Spine, and MMD.
- **Archetype Presets**: Instant system prompt alignment for companion, productivity, streaming, or roleplay.
- **Pre-Flight Honesty Matrix**: 6-faculty audit ensuring zero broken dependencies before stage launch.
- **Turn 0 Dialogue Preview**: Actor badge parsing, clean marker stripping, and live speech preview before deployment.
