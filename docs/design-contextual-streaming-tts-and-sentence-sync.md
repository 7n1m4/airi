# Design & Architecture: Contextual Prosody vs. Real-Time Sentence-Sync in Streaming Neural TTS

**Status:** Proposed Architecture & Research Specification
**Target Subsystems:**
- `packages/pipelines-audio/src/processors/tts-chunker.ts` (Text chunking and segmentation engine)
- `packages/pipelines-audio/src/speech-pipeline.ts` (Speech pipeline concurrency and playback scheduling)
- `packages/stage-ui/src/services/speech/pipeline-runtime.ts` (Speech bus runtime and intent routing)
- `packages/stage-ui/src/composables/use-speech-caption-player.ts` (Sentence-sync playback player)
- `packages/stage-ui/src/stores/chat.ts` (Chat orchestrator `activeSpokenText` state tracking)
- `packages/stage-ui/src/components/scenes/ControlStripHost.vue` (PlaybackManager lifecycle and caption broadcast)
- `packages/stage-ui/src/components/markdown/markdown-renderer.vue` (CSS `::highlight(spoken-highlight)` renderer)
- `packages/stage-ui/src/components/scenes/CaptionPanel.vue` (Floating window captions)
- `packages/stage-ui/src/components/scenes/HeadTetheredCaption.vue` (In-scene avatar comic bubble plank)
- `packages/stage-ui/src/components/scenes/DatingSimOverlay.vue` (Dating sim dialogue subtitle HUD)
- `docs/design-openai-compatible-tts.md` (OpenAI-compatible speech provider reference)

---

## 1. Executive Summary & The Core Architectural Conflict

Modern text-to-speech (TTS) in interactive virtual companion systems operates under two competing requirements that directly oppose each other:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        THE STREAMING TTS TRILEMMA                                      │
├──────────────────────────────┬──────────────────────────────┬──────────────────────────┤
│ ⚡ 1. Low Latency (TTFA)      │ 🎭 2. Contextual Prosody     │ 🎯 3. Sentence-Sync Clock│
├──────────────────────────────┼──────────────────────────────┼──────────────────────────┤
│ The user expects audio to    │ Modern neural TTS models     │ The UI needs fine-grained│
│ begin playing in <500ms      │ need multi-sentence context  │ knowledge of exactly what│
│ after the LLM begins         │ to compute natural pitch     │ sentence or word is      │
│ streaming text.              │ contours, question rises,    │ actively playing to      │
│                              │ and emotional cadence.       │ drive highlights & sync. │
└──────────────────────────────┴──────────────────────────────┴──────────────────────────┘
```

In AIRI, achieving **Requirement 1 (Low Latency)** has historically relied on aggressively slicing incoming LLM text into small sentence fragments (4–15 words).

While this solves Time-to-First-Audio (TTFA) and accidentally provides **Requirement 3 (Sentence-Sync Clock)**, it severely degrades **Requirement 2 (Contextual Prosody)**. Modern autoregressive and diffusion neural TTS models (Kokoro, ChatTTS, CosyVoice, GPT-SoVITS, Cartesia, ElevenLabs, OpenAI `streaming: true`) reset acoustic hidden states and pitch contours at every chunk boundary, resulting in robotic intonation drops, flat questions, and unnatural rhythm resets.

When we attempt to fix prosody by sending whole multi-sentence paragraphs or streaming unified blocks (`streaming: true`), **we lose the sentence-sync clock entirely**. The server yields a continuous, opaque binary stream of PCM/MP3 audio frames with zero text alignment metadata.

This document formalizes the current system architecture, diagnoses why naive synchronization fixes fail, and articulates the open architectural challenge of achieving **full-context neural prosody alongside drift-free, real-time sentence synchronization**.

---

## 2. Current Architecture & Implementation Manifest

AIRI's current speech synthesis and spoken UI synchronization pipeline spans across several decoupled packages:

```mermaid
graph TD
    LLM[LLM Text Stream] --> Chunker["tts-chunker.ts (Intl.Segmenter + Punctuation)"]
    Chunker -->|TtsInputChunk (4-15 words)| Pipeline["speech-pipeline.ts (Queue & Concurrency Slot)"]
    Pipeline --> Provider["Speech Provider (OpenAI / Kokoro / ElevenLabs)"]
    Provider -->|AudioBuffer / Blob| Playback["playbackManager (Web Audio API)"]

    Playback -->|onStart({ item })| Host["ControlStripHost.vue"]
    Host -->|BroadcastChannel('airi-caption-overlay')| Bus["Caption Event Bus"]

    Bus --> ChatStore["chat.ts (activeSpokenText)"]
    Bus --> CaptionPanel["CaptionPanel.vue / Standalone Window"]
    Bus --> HeadTethered["HeadTetheredCaption.vue / Live2D Bubble"]
    Bus --> DatingSim["DatingSimOverlay.vue"]

    ChatStore --> MdRenderer["markdown-renderer.vue (CSS ::highlight(spoken-highlight))"]
```

### 2.1 The Chunking Engine: `packages/pipelines-audio/src/processors/tts-chunker.ts`
Incoming text tokens from the LLM are evaluated character-by-character using `Intl.Segmenter` and heuristic punctuation sets:
- **Hard Punctuations**: `. 。 ? ？ ! ！ … ⋯ ～ ~ \n \t \r`
- **Soft Punctuations**: `, ， 、 – — : ： ; ； 《 》 「 」`
- **Word Limits**: `minimumWords = 4`, `maximumWords = 40`, `boost = 2`

The chunker greedily yields a `TtsInputChunk` as soon as a punctuation mark or word ceiling is crossed, isolating clauses so TTS synthesis can start immediately.

### 2.2 The Scheduling Runtime: `packages/pipelines-audio/src/speech-pipeline.ts`
The speech pipeline coordinates synthesis with a bounded concurrency pool (max 5 active requests) and registers discrete `PlaybackItem<TAudio>` entries with the playback manager. Each item carries its corresponding `item.text`.

### 2.3 The Broadcast Coordinator: `packages/stage-ui/src/components/scenes/ControlStripHost.vue`
When the Web Audio engine begins playing a discrete `PlaybackItem`:
1. `playbackManager.onStart(({ item }))` fires.
2. It pushes a `CaptionSegment` with `{ text: item.text, isActive: true, color, actorId }`.
3. It broadcasts `{ type: 'caption-assistant', segments: [...] }` over `useBroadcastChannel('airi-caption-overlay')`.
4. When `playbackManager.onEnd` fires, `isActive` is set to `false`.

### 2.4 The UI Consumer: `packages/stage-ui/src/components/markdown/markdown-renderer.vue`
In the chat interface, `markdown-renderer.vue` listens to `chatOrchestrator.activeSpokenText`. When updated:
- It uses the modern **CSS Custom Highlight API** (`CSS.highlights.set('spoken-highlight', range)`).
- It executes a forward-searching sliding text-node walker with backtracking to highlight the exact substring matching the active spoken chunk.

---

## 3. The Problem: The Dual-Purpose Trap of Text Slicing

Text slicing in AIRI currently serves two completely different purposes:
1. **Latency Reduction (Low TTFA)**: Getting the first audio soundwaves into the user's ears while the LLM is still generating tokens.
2. **Ground-Truth Clock for UI Synchronization**: Because audio chunk $k$ was synthesized strictly from text slice $k$, the start and end of audio chunk $k$ are guaranteed to correspond to text slice $k$.

### The Prosody Breakdown
Modern neural TTS models are not simple phoneme concatenators; they rely on deep cross-attention, transformer decoders, or diffusion backbones:
- **Pitch Contour Resets**: In natural dialogue, an introductory dependent clause (e.g., *"When you arrived yesterday,"*) has a rising terminal pitch indicating more speech is coming. When sliced into an isolated chunk, the neural TTS generates a falling sentence-final terminal cadence, making the voice sound disconnected and bored.
- **Question Intonation Loss**: In sentences like *"You're really going to wear that, aren't you?"*, the rising inflection of the tag question depends on the semantic tension established in the opening clause. Slicing between clauses destroys this pitch relationship.
- **Autoregressive Hidden-State Erasure**: Slicing prevents the acoustic model's KV cache or recurrent state from carrying emotional inertia from one sentence into the next.

---

## 4. The Unified / Hybrid Streaming Dilemma

To recover full contextual prosody, an obvious solution is **Progressive Concatenation Streaming**:
1. **Slice 1 (The Fast-Path)**: Synthesize the first short clause (3–6 words) immediately so TTFA remains low (< 500ms).
2. **The Remainder Block**: While Slice 1 is playing, buffer all remaining LLM output. Once generation finishes (or reaches a large paragraph boundary), submit the entire remaining text as a single streaming request (`POST /audio/speech` with `streaming: true`).

```text
LLM Output: ["Wait,", " I didn't mean to upset you.", " Can we talk about what happened earlier today?"]
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Chunk 1 (Instant): "Wait," ───────────────▶ Synthesizes in 250ms ──▶ Plays immediately │
│ Remainder: " I didn't mean to upset you. Can we talk about what happened earlier today?"│
│            └──────────────────────────────▶ Synthesizes with full prosody & streaming! │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### The Fatal Consequence: Loss of Temporal Alignment
When the remainder block is sent to the TTS server:
- The server streams raw audio frames (chunked MP3 or PCM audio stream).
- **The client receives raw audio with no boundary timestamps**.
- The client cannot determine when `"I didn't mean to upset you."` finishes and `"Can we talk about what happened earlier today?"` begins.
- `ControlStripHost.vue` cannot dispatch `caption-assistant` updates for individual sentences.
- `markdown-renderer.vue` cannot advance its CSS spoken highlight.
- Subtitle windows and head-tethered comic bubbles are forced to either display the entire multi-sentence blob at once or remain static.

---

## 5. Why Naive Solutions Fail

### ❌ Naive Fix 1: Character-per-Second / Static WPM Extrapolation
* **Hypothesis**: Calculate average speech speed (e.g., 15 characters per second or 160 words per minute) and advance the sentence highlight linearly along the audio duration.
* **Why it Fails**: Emotional speech is non-linear. Excited shouting can exceed 260 WPM; sad or hesitant whispering drops below 90 WPM. Furthermore, commas, periods, and ellipses (`...`) introduce variable silence pauses (200ms–800ms) that static WPM heuristics cannot predict. Over a 3-sentence response, static estimation drifts by several seconds, highlighting sentences long before or after they are spoken.

### ❌ Naive Fix 2: Full On-the-Fly ASR (Whisper) Forced Alignment
* **Hypothesis**: Run a local Whisper model (or WebLLM ASR worker) on the playing audio output to transcribe and detect boundary timestamps in real time.
* **Why it Fails**: Running real-time autoregressive ASR during playback creates severe CPU, WebGPU, and RAM contention with the active Three.js/Live2D avatar rendering loop, the LLM dispatch gateway, and OS sensors. It is far too resource-heavy for battery-powered mobile devices (`apps/stage-pocket`) or low-end laptops.

### ❌ Naive Fix 3: Relying on Server-Side Alignment Metadata
* **Hypothesis**: Demand that the TTS server return word/sentence timestamps in an SSE event stream (e.g. `event: alignment`).
* **Why it Fails**: Standard OpenAI-compatible TTS endpoints (`/v1/audio/speech`) do not define a streaming alignment metadata standard. Most local engines (Kokoro-FastAPI, standard GPT-SoVITS servers, Chatterbox-TTS) return raw binary audio chunks over HTTP chunked transfer. AIRI must remain compatible with standard OpenAI-compatible endpoints without requiring custom server forks.

---

## 6. Architectural Frontiers & Open Research Questions

To resolve this challenge, an architectural solution must satisfy three non-negotiable constraints:
1. **High Prosody**: Preserve multi-sentence contextual awareness for neural acoustic decoders.
2. **Drift-Free Sentence-Sync**: Accurately advance UI highlights, captions, and viseme states at sentence boundaries.
3. **Low Compute Overhead**: Require negligible CPU/GPU footprint on client devices (< 2% CPU, 0 WebGPU contention).

### Open Questions for Architectural & Machine Learning Review:

1. **Acoustic Signal & Silence-Envelope Boundary Detection**:
   - Can Web Audio API `AudioWorklet` nodes perform real-time RMS energy profiling and silence-dip detection, matching observed acoustic pauses against the expected sentence boundary count and rough phonetic lengths of the known text string?
   - How can an acoustic silence detector disambiguate between mid-sentence comma pauses and actual sentence-terminating stops?

2. **Context-Prefill / Acoustic Context Framing (Virtual Prompting)**:
   - For neural TTS architectures, can we formulate a "Context-Prefill" standard where preceding text $T_{\text{context}}$ is passed to condition the acoustic hidden state, but audio generation is instructed to synthesize only the target slice $T_{\text{target}}$?
   - How can this be mapped cleanly onto OpenAI-compatible API schemas without breaking standard providers?

3. **Ultra-Lightweight Streaming Phoneme / CTC Alignment**:
   - Is it feasible to deploy a tiny (< 5MB), non-autoregressive CTC acoustic encoder (e.g., quantized Wav2Vec2/WavLM phonetic head or a 1-layer CNN) purely to compute monotonic alignment paths between the streaming PCM buffer and text phonemes in real time?

4. **The Progressive Hybrid State Machine**:
   - What is the formal state machine for scheduling Slice 1 audio playback, background remainder stream buffering, dynamic cross-fading, and subtitle event emission to guarantee seamless audio playback with zero audible pops, clicks, or timing desynchronizations?
