# Settings Hub & The Engine Room

![Settings Hub & The Engine Room](/showcase/hero-01-settings-hub.avif)

The **Settings Hub & The Engine Room** serves as the central command center for Project AIRI. Designed around a responsive **RippleGrid** architectural surface, it organizes over 70 configurable subsystem facets into 10 rapid-access control zones, complete with responsive orientation switching, accent palette theming, and an integrated upstream comparison inspector.

---

## RippleGrid Control Center

![Settings Hub Landscape](/showcase/hero-01-settings-hub-landscape.avif)

The Settings Hub replaces nested tab lists with a modern, glanceable navigation deck:
- **10 Core Quick-Action Shortcuts**: Direct jumps to Inference Providers, Audio & Speech DSP, Memory & Continuity, Desktop Embodiment, Artistry & Studio, Discord Gateway, S3 Cloud Sync, System Preferences, Documentation, and Diagnostics.
- **Adaptive Layout**: Dynamically reflows between a dense multi-column landscape view and an ergonomic single-column portrait mode for narrow desktop slices or mobile screens.
- **Accent Palette Themes**: Live theme switcher supporting Dark, Light, Cyberpunk Neon, Sakura Pink, and Slate themes with instant CSS token injection.

![Settings Hub Accent Palette](/showcase/hero-01-settings-hub-palette.avif)

---

## The Engine Room Subsystems

### 1. Inference Providers Deck

![Inference Providers Deck](/showcase/settings-inference-providers-deck.avif)

Configures hosted and on-device intelligence backends:
- **Multiple Provider Instances**: Run multiple concurrent accounts of the same provider (e.g. Work OpenRouter vs Personal OpenRouter) with independent credentials and model cache registries.
- **Model Discovery**: Dynamic auto-fetching of available models with capability tagging (tool calling, vision, JSON output, context window).
- **Zero-Roundtrip Local Inference**: WebGPU/WASM integration for RWKV-7, WebLLM, Kokoro TTS, and Whisper STT running entirely on your machine.

### 2. Resilient Fallbacks & Module Chaining

![Resilient Fallbacks](/showcase/settings-modules-resilient-fallbacks.avif)

Guarantees high-availability stage performance:
- **Automated Fallback Cascade**: If a primary cloud provider rate-limits or returns a 5xx error, AIRI gracefully transitions to secondary or local offline models without dropping dialogue continuity.
- **Provider Health Monitoring**: Real-time ping latency and error counters tracked per provider instance.

### 3. Voice Studio & DSP Console

![Voice Playground](/showcase/settings-speech-voice-playground.avif)

Deep voice calibration and audio engineering:
- **Universal Speech Transformer (UST)**: Normalizes phonetic quirks, removes hallucinated XML/cues, and manages spoken pacing across 15+ TTS providers.
- **Voice Playground**: Audition voices, speed multipliers, and pitch contours with real-time waveform visualization.
- **Speaker & Microphone Routing**: Seamless audio device selection with active level meters and automatic VAD gating.

### 4. Data Management & BYOS Cloud Sync

![Cloud Backup & Data Management](/showcase/settings-data-management-cloud-backup.avif)

Complete sovereignty over your companion's memory and state:
- **Bring Your Own Storage (BYOS)**: Automated cloud backups to Amazon S3, Cloudflare R2, Google Drive, or MinIO.
- **Atomic State Snapshots**: One-click local export and restoration of all character cards, chat session histories, and generated art portfolios.
- **Zero Telemetry**: No tracking, phone-home metrics, or developer-hosted databases.

### 5. In-App Documentation & Upstream Inspector

![In-App Documentation Viewer](/showcase/settings-in-app-documentation-viewer.avif)

- **In-App Documentation Viewer**: Reads VitePress documentation directly inside the desktop client without switching windows.
- **Upstream Comparison Inspector**: Visual diff breakdown comparing this fork's capabilities against upstream releases.

![Upstream Comparison Modal](/showcase/hero-01-settings-hub-upstream.avif)

---

## Key Capabilities

- **RippleGrid Command Center**: 10 categorized quick-action shortcuts across all AIRI subsystems.
- **Responsive Landscape & Portrait Views**: Flawless reflow across widescreen displays and compact sidecar windows.
- **Theme & Accent Palette Engine**: 5 built-in colorways with real-time CSS variable interpolation.
- **Multiple Provider Instances**: Configure separate accounts and routing rules per provider backend.
- **Automated Resilient Fallbacks**: Multi-tier provider chaining preventing downtime from API outages.
- **BYOS Cloud Backup**: S3, Cloudflare R2, and local archive sync with zero telemetry.
- **In-App Docs & Upstream Inspector**: Integrated manual viewer and fork capability audits.
