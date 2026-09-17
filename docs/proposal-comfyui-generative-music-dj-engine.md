# Proposal: Unified DJ & Music Engine (Tri-Model Generative + Spotify Catalog)

> **Status**: Proposed RFC
> **Document**: `docs/proposal-comfyui-generative-music-dj-engine.md`
> **Target Audience**: Core Developers, Audio/Music Engineers, UI Integrators
> **Key References**: `packages/stage-ui/src/stores/dj-deck.ts`, `airi-audio-server` (`audio.cpp`), `apps/stage-tamagotchi/src/main/services/airi/widgets/providers/comfyui.ts`

This document outlines the architectural design for enabling AI characters to act as dynamic, real-time DJs—interweaving AI-generated tracks (via a Tri-Model Generative Engine: Local MiniMax Music 3.0 & YuE 2 natively served via **AIRI Audio Server / `audio.cpp`**, with remote Suno v6 fallback) with real-world streaming catalogs (via Spotify) while interactively adjusting the setlist and hosting radio-style voiceover transitions in response to ongoing conversation.

---

## 🧭 1. Vision & Goals

Currently, AIRI supports visual generative artistry (via ComfyUI/Replicate) and 3D item manifestation (via TRELLIS). This proposal introduces a **Unified Music Provider and AI DJ Engine** that gives the character both an infinite record crate (Spotify streaming catalog) and a private music production studio supporting **high-performance local C++ audio inference and cloud fallback**:

*   **The Tri-Model Generative Engine**:
    1.  **Local Primary — AIRI Audio Server (`audio.cpp` Native Engine)**:
        *   **MiniMax Music 3.0 & MiniMax H3 Text-to-Audio**: High-fidelity neural music and soundscape generation running natively in C++/CUDA via `audio.cpp` without complex Python/ComfyUI dependency stacks.
        *   **YuE 2 & YuE AR LoRA**: Score-first on-device song generation (<8 GB VRAM) with symbolic score planning, musical key transposition, and full lyric alignment.
        *   *(Legacy/Alternative: Optional ComfyUI node integration for custom graph tinkerers).*
    2.  **Remote Option — Suno v6 (Cloud API)**: Fast, zero-local-VRAM cloud fallback with stem isolation, microediting single lyrics, and tiered creativity (V6, V6 Wild, V6 Mini).
    3.  **Catalog Option — Spotify (Streaming Catalog)**: Searches and streams real licensed music from Spotify's global library (e.g., *"Play some late 90s French house"*).
*   **Three Operational DJ Modes**:
    1.  **Generative Mode**: Synthesizes 100% original music on the fly based on chat context, themes, or user mood (e.g., *"Make a cozy lo-fi song about drinking matcha while coding"*).
    2.  **Catalog Mode (Spotify)**: Searches and streams real licensed music from Spotify's global library.
    3.  **Hybrid DJ Mode (The Radio Experience)**: Blends real tracks with custom-generated tracks, beats, and interludes, acting as an autonomous radio host.
*   **"Always on Deck" Continuous Playback**: Zero-latency transitions between tracks. While Track A is playing, Track B is pre-queued or pre-generated on deck.
*   **Zero-Downtime Fail-Safe (GPU / Fallback)**: If local GPU generation encounters an OOM error, latency spike, or the audio server is offline, the DJ loop gracefully falls back to Suno v6 cloud generation or Spotify catalog search without interrupting playback.
*   **Radio DJ Banter & Audio Ducking**: The character can speak over track intros/outros (e.g., *"Coming up next, one of my favorite tracks from Daft Punk..."*). Music automatically ducks to 20–25% volume during speech and swells back up seamlessly.
*   **Character Musical Identity**: Character cards (`extensions.airi.music`) define distinct musical tastes, favorite genres, BPM preferences, and DJ banter style.

---

## 🎛️ 2. Unified Track Model & Abstraction

To AIRI's DJ brain, all tracks share a normalized data structure regardless of whether they originate from Spotify, local ComfyUI/YuE2 generation, Suno cloud API, or local files:

```typescript
export interface DJTrack {
  id: string
  title: string
  artist: string // e.g., "Daft Punk", "AIRI x YuE2", or "AIRI x Suno"
  genre?: string
  mood?: string
  bpm?: number
  durationMs: number
  source: 'spotify' | 'comfyui' | 'yue2' | 'suno' | 'local'

  // Playback Handles
  spotifyUri?: string // spotify:track:...
  audioBlobKey?: string // IndexedDB/localforage key for local audio
  audioStreamUrl?: string // ComfyUI/YuE2 output URL or local file URL
  artworkUrl?: string // Album cover or generated stage background thumbnail

  // Generation & Composition Metadata
  caption?: string
  lyrics?: string
  abcScore?: string // Raw human-readable ABC notation string
  scorePlan?: {
    tempo: number
    keySignature: string
    chordProgression?: string[]
  }
  lora?: {
    adapterId: string // e.g. "synthwave_lead", "ar_lora_inst_v3abc"
    scale: number // 0.0 to 1.5
  }
  stems?: {
    vocalsUrl?: string
    instrumentalUrl?: string
  }
}
```

---

## 🛠️ 3. The LLM Interface (Tool Calling)

The consciousness orchestrator is equipped with unified tools allowing it to seamlessly curate both generative and catalog music:

### A. `dj_queue_track`
Queues a track into the DJ deck from either a generative prompt or a catalog query.
*   **Arguments**:
    ```json
    {
      "source": "auto" | "spotify" | "comfyui" | "yue2" | "suno",
      "query": "Daft Punk - Digital Love",
      "caption": "french filter house, punchy vintage drums, groovy slap bass, 124 bpm",
      "lyrics": "[Intro]\n[Verse]\nLast night I had a dream about you...",
      "title": "Neon Dreams",
      "priority": "next" | "tail" | "immediate_fade"
    }
    ```
*   `source`: `"auto"` (DJ decides based on mode/preference), `"spotify"`, `"comfyui"`, `"yue2"`, or `"suno"`.
*   `priority`:
    *   `"tail"`: Appends to the end of the setlist.
    *   `"next"`: Pre-loads directly into the "On Deck" slot (Track B).
    *   `"immediate_fade"`: Immediately crossfades into the new track upon readiness.

### B. `dj_search_catalog`
Explicitly queries the Spotify catalog for tracks, albums, or playlists.
*   **Arguments**:
    ```json
    {
      "query": "Japanese City Pop 1980s",
      "type": "track" | "album" | "playlist",
      "limit": 5
    }
    ```

### C. `dj_get_status`
Queries real-time playback telemetry, current deck state, and upcoming queue.
*   **Returns**:
    ```json
    {
      "playbackState": "playing",
      "currentTrack": {
        "id": "spotify:track:2G8F6i...",
        "title": "Digital Love",
        "artist": "Daft Punk",
        "source": "spotify",
        "durationMs": 298000,
        "elapsedMs": 142000,
        "remainingMs": 156000
      },
      "onDeckTrack": {
        "id": "gen_88f21",
        "title": "Matcha Code Beat",
        "artist": "AIRI x YuE2",
        "source": "yue2",
        "status": "ready"
      },
      "mode": "hybrid",
      "queuedCount": 2,
      "volume": 0.8
    }
    ```

### D. `dj_control`
Direct playback and transition controls.
*   **Arguments**:
    ```json
    {
      "action": "fade_to_next" | "skip" | "pause" | "resume" | "set_volume" | "clear_queue",
      "fadeDurationSeconds": 4,
### E. `dj_plan_composition` (Music Room / Sound Studio)
Initiates the fast symbolic planning phase (taking only 3–15s). Generates or mutates an ABC musical notation score without running heavy acoustic diffusion.
*   **Arguments**:
    ```json
    {
      "action": "generate_new" | "mutate_existing",
      "style": "cyberpunk electro complextro 128 bpm",
      "lyrics": "[intro]\nSystem online...",
      "cotMode": "melody" | "full",
      "existingAbcScore": "X:1\nT:Neon Drive\nM:4/4\nK:Cm\n...",
      "mutationInstructions": "transpose the chorus into a dark minor key and double the bassline tempo",
      "loraAdapter": "ar_lora_inst_v3abc",
      "loraScale": 1.0
    }
    ```
*   **Returns**:
    ```json
    {
      "planId": "plan_99a8b",
      "abcScore": "X:1\nT:Neon Drive\nM:4/4\nL:1/8\nQ:1/4=128\nK:Cm\n|: \"Cm\" c2 e2 g2 c'2 | \"Ab\" _A2 c2 e2 _a2 :|",
      "summary": "Generated 64 bars of 128 BPM electro in C Minor with annotated chord progressions and verse/drop structure.",
      "visualArtifactUrl": "music://artifacts/plan_99a8b.abc"
    }
    ```

### F. `dj_render_composition`
Commits an approved or edited ABC score into high-fidelity 48 kHz stereo audio via the YuE 2 NAR ODE pipeline.
*   **Arguments**:
    ```json
    {
      "planId": "plan_99a8b",
      "abcScore": "X:1\nT:Neon Drive\n...",
      "odeSteps": 8,
      "priority": "next" | "tail"
    }
    ```

---

## ⚙️ 4. Modular Provider Architecture

Audio sources are implemented under `packages/stage-ui/src/libs/providers/` as part of the `music` provider category:

```
                          ┌───────────────────────────┐
                          │    MusicProvider Interface│
                          └─────────────┬─────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
┌──────────────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│  Generative Providers        │    │  Spotify Web Provider│    │ Local File Provider  │
│  - AIRI Audio Server Engine  │    │  - Streaming catalog │    │ - IndexedDB cache    │
│    (audio.cpp: MiniMax, YuE2)│    │  - Connect / Web SDK │    │ - localforage assets │
│  - Remote Suno v6 (Cloud)    │    │  - Search & Playback │    │ - Stored playlists   │
│  - ComfyUI (Optional Custom) │    │                      │    │ - Stored playlists   │
└──────────────────────────────┘    └──────────────────────┘    └──────────────────────┘
```

#### A. Local Primary Engine: AIRI Audio Server (`audio.cpp` C++ Runtime)
* **Dedicated Music API Endpoint (`POST /v1/audio/music`)**:
  Music synthesis differs structurally from plain TTS speech: it requires multi-modal conditioning (genre prompt, structured lyrics with verse/chorus tags, duration, tempo/BPM, and optional LoRA adapters). Rather than overloading `/v1/audio/speech`, `airi-audio-server` exposes a dedicated endpoint:
  ```json
  POST /v1/audio/music
  {
    "model": "minimax-music-3" | "yue-2",
    "prompt": "melodic synthwave, analog synths, driving bassline, 120 bpm",
    "lyrics": "[Verse]\nNeon reflections on the wet asphalt...\n[Chorus]\nRunning through the grid...",
    "duration_seconds": 60,
    "temperature": 0.8,
    "lora": "synthwave_retro_v1"
  }
  ```
* **1-Click Add-on Installation Flow (`install.bat` / `npm run add-music`)**:
  Music models (MiniMax Music 3, YuE 2) are significantly larger than lightweight TTS models (3 GB – 10 GB). To maintain zero-bloat for pure speech users:
  1. `install.bat` provides an optional modular add-on menu: `[M] Install Generative Music Models (MiniMax / YuE 2)`.
  2. Users can run `npm run add-music` anytime to download GGUF music weights and verified sidecars in 1 click.
* **Advanced Capability: YuE 2 AR LoRAs & Style Conditioning**:
  `audio.cpp` supports LoRA adapter injection into the Autoregressive (AR) stage (`--lora <path>`):
  - **Genre/Vocal Adapters**: Custom LoRAs steer acoustic timbre, specific vocal styles (e.g. Japanese anime vocals, metal screaming, acoustic folk), or unique musical keys.
  - **AIRI Integration**: Character cards can declare an optional `extensions.airi.music.default_lora` to ensure the character's generated music matches their artistic persona.
* **LoRA Management & Training Lifecycle (`/v1/audio/music/loras`)**:
  `airi-audio-server` provides a complete RESTful adapter cartridge management and training pipeline:
  ```json
  GET    /v1/audio/music/loras              // List installed LoRAs, ranks, sizes, tags
  POST   /v1/audio/music/loras              // Upload ready-to-use .safetensors adapter
  DELETE /v1/audio/music/loras/:id          // Archive or remove an adapter
  POST   /v1/audio/music/loras/train        // Trigger background style/voice fine-tuning run
  GET    /v1/audio/music/loras/jobs         // Monitor progress, epochs, loss, and ETAs
  POST   /v1/audio/music/loras/jobs/:id/cancel // Abort an in-flight training session
  ```
  - **Hot-Swapping Cartridges**: In the desktop UI, LoRAs are rendered as visual *synthesizer cartridges* with configurable scale sliders (0.0 to 1.5).
  - **Automated Fine-Tuning**: Users can drag and drop 5–10 reference stems/recordings or ABC scores. The server queues a background LoRA training worker (`rank=16..32`, target modules: `q_proj`, `v_proj`, `k_proj`, `o_proj`) and registers the resulting `.safetensors` adapter automatically upon completion.
  - **VRAM Concurrency Guard During Training**: Backward-pass gradients during LoRA fine-tuning consume significant GPU memory. While a training job is actively executing, `airi-audio-server` engages an automated hardware guard on `/v1/audio/speech` (and other inference endpoints), returning a temporary busy state (`503 Service Unavailable / In Training`) to prevent concurrent TTS requests from causing CUDA out-of-memory crashes on 8GB consumer GPUs.
  - **Runtime LoRA Injection & Dynamic Scaling**: Unfused AR LoRAs (`--lora`) are natively supported by `audio.cpp`. Dynamic runtime scaling (`loraScale: 0.0 - 1.5`) without restarting the model process is an active area of investigation in `audio.cpp`; if live alpha scaling is not natively supported in the current C++ engine, switching cartridges initiates a lightweight model instance reload (~5–10s) rather than live in-memory multiplier interpolation.

### B. Local Generative: YuE 2 (Score-First & Deep ABC Planning Architecture)
* **Hardware Footprint & Shootout Findings**:
  * Evaluated directly on 8GB consumer hardware (RTX 4070 Laptop GPU, 128-bit memory bus, CUDA 13.1, SM 8.9).
  * Consumes only **~2.8 GB to 3.3 GB VRAM** in `Q4_0`, leaving **>4.7 GB VRAM free** to seamlessly co-exist with ComfyUI and AIRI's real-time voice pipeline without OOM or host memory thrashing.
  * In contrast, MiniMax Music 3.0 consumed ~7.2 GB VRAM (88% of GPU capacity) and required ~11.7 min for 10s audio, making YuE 2 **3.5x–4x faster** with significantly lower resource contention.
  * Outputs native studio-broadcast **48,000 Hz stereo** (vs 44.1 kHz on MiniMax).
* **Two-Tiered Architecture (Symbolic Plan vs Acoustic Diffusion)**:
  * **Stage 1: Symbolic AR Planning (ABC Score CoT)**: The 3B model generates standard **ABC musical notation** (`cot=melody` or `cot=full`) outlining key signature, tempo/BPM, bars, chords (`[Cm]`, `[G#]`), melodies, dynamics, and song parts (`[intro]`, `[drop]`, `[verse]`). Generates at **~115 tokens/sec** taking only **~3–20 seconds**.
  * **Stage 2: Acoustic Diffusion (NAR ODE Flow)**: Solves the acoustic flow matching differential equations across 8 ODE steps (16 forward passes), transforming the symbolic score and lyrics into high-fidelity stereo audio.
* **Empirical 2-Minute Track Findings (`cot=full` vs `cot=off`)**:
  * **Score-Guided Coherence (`cot=full`)**: In empirical 2-minute festival dubstep tests, `cot=full` produced a dual-staff score in $D\sharp$ minor with explicit chord progression changes ($D\sharp m \to B \to G\sharp m \to F\sharp$) and bar-aligned drop moments, resulting in substantially richer acoustic textures, coordinated vocal-instrumental sync, and exact song duration alignment (**120.0s exact** vs 116.4s).
  * **Negligible Latency Delta**: The symbolic notation planner took **only 20.7 seconds** out of a 27-minute total generation run (<1.2% of total time), proving that the dramatic leap in musical composition quality is entirely worth the marginal generation time.
* **Plug-and-Play AR LoRAs**:
  * Verified support for unfused AR LoRAs (`ar_lora_inst_v3abc.safetensors`, 392 projections) with zero runtime conversion. Enables hot-swapping genre adapters (synthwave, EDM, lo-fi, acoustic) on the fly.
* **Interactive ABC Studio & Conversational Co-Creation ("Sound Studio" / "Music Room")**:
  * **Natural Language Steering of Musical Graphs**: Because ABC notation is compact human-readable text, the character can initiate a *compositional planning phase*, return the generated ABC notation score as a visual artifact/graph, and let the user inspect or modify the composition via natural language or direct visual editing prior to triggering heavy acoustic rendering.
  * **Dedicated Left-Sidebar Panel ("Sound Studio" / "Music Room")**: A specialized studio tab in the UI featuring a built-in visual ABC score/piano-roll viewer and chord sheet editor. Users can say *"transpose the bridge into a darker minor key and make the drop hit at bar 16"*, the LLM edits the ABC score, and YuE 2 renders the exact customized audio via `--request-option abc="..."`.

### C. Remote Generative: Suno v6 (Cloud API)
* Zero local VRAM requirement for low-spec hosts.
* Precision stem isolation and lyric microediting without re-rendering entire tracks.
* Three model tiers: V6 (stable production), V6 Wild (creative ideas), V6 Mini (rapid drafting).

### D. Optional Generative: ComfyUI (Custom Graph Tinkerers)
* Reuses `apps/stage-tamagotchi/src/main/services/airi/widgets/providers/comfyui.ts` for advanced users wanting custom diffusion node setups.
* Injects `{{CAPTION}}`, `{{LYRICS}}`, `{{BPM}}`, and `{{DURATION}}` into workflow templates.

### D. Spotify Streaming Adapter
* **Authentication**: OAuth 2.0 PKCE flow stored securely in Electron safeStorage.
* **Search & Metadata**: Uses Spotify Web API (`/v1/search`, `/v1/me/player`).
* **Audio Transport**: Uses **Spotify Web Playback SDK** in the renderer (or Spotify Connect API for remote playback on external speakers).
* *Note: Requires Spotify Premium per Spotify API terms.*

### E. Fail-Safe & Latency Controller (The Generation Time Reality)
* **Latency Tiering**:
  * **Instantaneous / Real-Time Tier (< 10s)**: Spotify streaming (0s), Pre-rendered local "Record Crate" tracks (0s), and Suno v6 cloud API (<10s).
  * **Heavy Asynchronous Tier (~27 min on 8GB GPU)**: Full 2-minute YuE 2 NAR ODE generation.
* **Operational Dispatch Logic**:
  * When `dj_queue_track` is called with `priority="next"` (for an imminent track transition occurring in < 60s), the engine **strictly routes to the Real-Time Tier** (Spotify, Suno v6, or pre-rendered local tracks).
  * When local YuE 2 song creation is requested during an active set, the system registers it as a **"Backstage Studio Order"** (`priority="tail"` or background job). It generates asynchronously without blocking the "On Deck" slot.
  * If a scheduled local generation job fails, throws OOM, or times out:
    1. The controller automatically falls back to Suno v6 cloud generation or executes a fallback search on Spotify matching the target genre/mood.
    2. The replacement track is cued immediately to the "On Deck" slot.
    3. The agent is notified via status telemetry to provide in-character commentary:
       > *"My local synth module hit an overload, so I'm pulling this track from the cloud while it cools down!"*

---

## 🎛️ 5. DJ Deck Engine & Dual-Stream Audio Pipeline

The playback engine in `packages/stage-ui/src/stores/dj-deck.ts` coordinates both native Web Audio and Spotify streaming:

```
[ Local / Generative Audio ] ──► [ Web Audio GainNode A/B ] ──┐
                                                              ├──► [ Master Audio Output ]
[ Spotify Web Playback ]     ──► [ Spotify Player Volume ]  ──┘           ▲
                                                                          │
                                                               (Ducking Controller)
                                                                          ▲
                                                                [ Character TTS Speech ]
```

### A. Seamless Crossfading
* **Generative-to-Generative**: Web Audio API equal-power crossfade curve between Deck A and Deck B.
* **Spotify-to-Generative (or vice versa)**: Coordinated software volume ramp down on Spotify Connect player while ramping up the Web Audio GainNode over 3–5 seconds.

### B. Dynamic Voice Audio Ducking
* Monitored via `useSpeechRuntimeStore()` and `character-speaking` state:
* When the character speaks (via Kokoro, ElevenLabs, etc.):
  * Active music stream volume is exponentially attenuated to **20–25%** over 200ms.
* When speech concludes:
  * Music volume smoothly recovers to **100%** over 600ms.

### C. Radio Host Banter Loop (Track Intros & Outros)
* When a new track is cued and begins playing at ducked volume, the agent can deliver a brief 1–2 sentence spoken intro during the first 5 seconds (e.g., over the instrumental intro bars).
* Proactivity hooks allow the agent to announce transitions naturally in voice dialogue.

---

## 🧠 6. Status-Anchored Proactivity & Setlist Adaptation

Instead of arbitrary clock-interval polling, the DJ engine hooks directly into the Proactivity Engine (`packages/stage-ui/src/stores/proactivity.ts`):

1. **Threshold Event**: When the active track reaches `remainingMs <= 40000` (40 seconds) and the "On Deck" slot is empty.
2. **Contextual Wakeup**: The proactivity dispatcher sends a telemetry event to the consciousness orchestrator:
   > *"[DJ Deck Status]: Current track 'Digital Love' ends in 38s. Mode: Hybrid. User mood: Focused/Coding. What is next on deck?"*
3. **Agent Action (Pacing & Source Resolution)**:
   - For immediate succession (`priority="next"`), the LLM selects a track from the real-time sources: Spotify, Suno v6, or an already-rendered song in the character's local "Record Crate".
   - If the agent is inspired to create an entirely new original local song via YuE 2, it initiates an asynchronous composition job (`priority="tail"`) for later in the session, while simultaneously queueing an instant track or short interlude for the immediate transition.

---

## 🖥️ 7. UI Surfaces & State Sync

*   **DJ Deck Overlay / Control Strip Widget**:
    *   Displays current track title, artist, source badge (`[Spotify]` | `[YuE2]` | `[MiniMax]` | `[Suno]`), waveform/progress bar, and "On Deck" track preview chip.
    *   Play/pause, skip, mode selector (`Generative` | `Spotify` | `Hybrid`), and crossfade button.
*   **"Music Room" / "Sound Studio" Left Sidebar Tab**:
    *   Dedicated interactive studio space for deep musical co-creation with the character.
    *   **Interactive ABC Notation & Piano-Roll Canvas**: Visualizes the generated composition plan (bars, chord voicings, key signature, tempo) using lightweight Web/WASM music notation renderers (such as `abcjs` or VexFlow).
    *   **Conversational Score Refinement**: The user and agent converse directly in the studio chat. The agent can mutate the score in real time (e.g. adding a syncopated synth lead, modulating into a minor key, or shifting BPM) before committing the plan to the ODE acoustic renderer.
    *   **LoRA Cartridge Rack & Training Workshop**: Visual rack displaying installed genre and vocal style adapters (rank, size, scale slider `0.0`–`1.5`, active switch). Features a drag-and-drop dropzone for training custom LoRAs from audio stems or ABC notation datasets with live epoch/loss telemetry.
    *   **One-Click Stem & Score Export**: Export raw ABC notation, MIDI files, and generated 48 kHz stereo audio directly from the studio.
*   **Chat Stream Moments**:
    *   Subtle inline track chips when a new song starts playing.
*   **Cross-Window Sync (`BroadcastChannel`)**:
    *   Registered channel: `airi-dj-sync` (listed in `docs/rosetta-stone.md` §13).
    *   Synchronizes playback state, deck buffers, and queue across Control Strip, Stage, and Chatbox windows.

---

## ⚠️ 8. Technical Realities & Audio Nuances

*   **Spotify Premium Requirement**: The Spotify Web Playback SDK strictly requires an active Spotify Premium subscription. For non-Premium users, the engine defaults to **Generative Mode** (YuE2 / MiniMax / Suno) and **Local File Mode**.
*   **DRM Audio Boundary**: Spotify streams are DRM-encrypted and cannot be directly routed through Web Audio API `AudioNode` chains (e.g., custom visualizer FFTs or audio filters). Volume ducking for Spotify is handled directly via SDK player volume controls (`player.setVolume()`).
*   **Full Raw Audio for Generative Tracks**: YuE 2 and MiniMax generated tracks provide 100% raw PCM/WAV access, enabling custom EQ filtering, spatial audio, and visualizer waveform rendering.

---

## 📅 9. Roadmap & Implementation Checklist

- [x] **AIRI Audio Server Music & LoRA Extension**:
  - [x] Add `POST /v1/audio/music` endpoint handling genre prompts, structured lyrics, duration, and LoRA adapters.
  - [x] Add `POST /v1/audio/music/plan` for fast symbolic ABC score planning.
  - [x] Add LoRA adapter management & training endpoints (`/v1/audio/music/loras`, `/v1/audio/music/loras/train`, `/v1/audio/music/loras/jobs`).
  - [x] Add 1-click installation script (`npm run add-music` / `install.bat` music option) for MiniMax Music 3 and YuE 2 GGUF models.
- [ ] **AIRI Client Music Provider**:
  - [ ] Define `MusicProvider`, `DJTrack`, and provider registry entries in `packages/stage-ui/src/libs/providers/`.
  - [ ] Implement `AiriAudioServerMusicProvider` connecting to `/v1/audio/music`.
  - [ ] Implement Suno v6 cloud API wrapper for fast remote fallback.
  - [ ] Implement Spotify OAuth PKCE flow and Web Playback SDK / Connect API wrapper.
- [ ] **DJ Deck Store**: Build `packages/stage-ui/src/stores/dj-deck.ts` with dual-deck buffer management, crossfading, and TTS audio ducking.
- [ ] **Unified DJ Tools**: Implement `dj_queue_track`, `dj_search_catalog`, `dj_get_status`, and `dj_control` in `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/`.
- [ ] **Playback-Anchored Proactivity**: Connect DJ deck remaining-time threshold to the proactivity dispatcher.
- [ ] **DJ Widget & UI**: Create the "Now Playing / On Deck" media strip component on Stage and Control Strip.
- [ ] **"Sound Studio" Left Sidebar Panel**: Implement dedicated Music Room tab with embedded `abcjs` score renderer, LoRA Cartridge Rack, and bidirectional conversational ABC score editor.
