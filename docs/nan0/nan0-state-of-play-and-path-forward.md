Nan0 Integration: State of Play and Path Forward
Overview

The AIRI data‑catalog archive contains 101 documents ranging from feature proposals and porting guides to architecture overviews. Only one document, nan0‑integration‑feedback.md, specifically targets the Nan0 cognition system, but many other files describe the broader architecture needed to integrate Nan0 cleanly into AIRI. This report synthesizes the relevant information from every document to assess where AIRI currently stands and what still needs to be built to support Nan0. Citations are provided from the source documents as evidence of the current design state.

Current Architecture Relevant to Nan0
1. Memory and Cognition

AIRI already has a rich memory architecture that provides long‑term, short‑term and lifetime memory stores. The Rosetta Stone document explains that long‑term journal entries, daily short‑term summaries and lifetime archives are stored in IndexedDB and managed via a layered memory index (layered‑memory.ts). Semantic search uses Transformers.js and Orama to provide in‑browser vector recall
screenshot
.

Long‑Term Memory: stored in memory‑text‑journal.ts with a search index provided by layered‑memory.ts
screenshot
.
Short‑Term Memory: daily summaries stored in memory‑short‑term.ts with configurable window size and token budget
screenshot
.
Lifetime Memory: a multi‑pass pipeline that deduplicates and compacts past sessions into an “eternal thread”
screenshot
.
Search: the search layer already supports storing additional metadata (e.g., actorId, relationship) on each document, so adding actor semantics for Nan0 is trivial
screenshot
.

These native TypeScript systems mean that AIRI does not require Chroma DB or a Python service for vector recall. The Nan0 integration doc therefore rejects any plan to run Nan0’s Python memory engine as a sidecar and insists that the memory and cognition router be re‑implemented in TypeScript
screenshot
. Native implementation ensures parity between the Electron desktop build and the web‑only web‑stage where launching Python processes is impossible
screenshot
.

2. Discord Integration and Voice Modes

The Discord revamp proposal defines the upcoming API for voice interactions. It introduces two user‑facing commands:

/voicemode – chooses where to play TTS output: puppet (default local speakers), voicenote (upload voice notes to Discord), or none (mute)
/voicecall – selects the real‑time voice pipeline: tts (classic STT → LLM → TTS) or gemini (Gemini Live low‑latency audio bridge)

The Nan0 feedback emphasises that puppet mode must remain the default, because playing audio locally while routing the text to Discord is essential for home‑base users
screenshot
. It also argues that the Gemini Live path is too costly and should be deferred; instead the classic STT/LLM/TTS pipeline using Deepgram and a custom LLM/TTS should be the default
screenshot
. The /voicecall command is therefore a key milestone for the integration.

3. Session and Character Isolation

The current AIRI Discord service does not track separate sessions per channel. The Nan0 audit notes that each Discord channel needs its own active character and session mapping to avoid context mixing. The proposed mapping is:

Channel ID→Active Character ID→Active Session ID

screenshot
.

This requirement ties into the existing Timeline and Universe concepts described in other documents. Multiple chat sessions can coexist inside a universe and must be scoped correctly for RAG queries
screenshot
. Implementing per‑channel sessions in Discord will align with this timeline structure and ensure that Nan0’s memory retrievals are scoped properly.

4. Audio & TTS Infrastructure

Several documents cover the evolution of AIRI’s speech pipeline:

Audio Studio: proposes a “virtual provider” system where voice profiles wrap base engines (Kokoro, OpenAI, Azure, ElevenLabs) and apply pitch/rate/equalizer transformations
screenshot
.
MOSS‑TTS‑Nano Proposal: suggests adding MOSS‑TTS‑Nano (0.1B) as a first‑class speech provider running entirely in the browser via ONNX/WebGPU with a WASM/CPU fallback and voice‑cloning support
screenshot
. The provider will integrate into the existing unified inference protocol and share GPU resources with other models. It requires implementing moss‑nano‑local with the same speech() interface as Kokoro.
Higgs Audio v3 and other proposals: discuss external TTS engines but are less relevant to Nan0 since they require Python sidecars.

These documents illustrate that AIRI’s audio pipeline is flexible and oriented toward local (client‑side) execution with unified GPU coordination. Nan0’s voice pipeline should therefore hook into this unified framework rather than introducing separate processes.

5. Proactivity and Memory Recall

The Attention Ecology proposal introduces a local WebGPU guard using an RWKV‑7 model to filter environmental telemetry before sending it to the cloud. While not directly a Nan0 feature, it demonstrates how AIRI intends to minimise token usage and API costs. Likewise, the Dynamic Memory RAG Injection proposal describes a new “Grounding Options” popover where users can choose to inject sensor data, timeline memory, universe memory, recent topics, and visual scene state into each turn. These features rely on the same memory store used in the Nan0 feedback and confirm that the vector search infrastructure is well established
screenshot
.

Nan0 Feedback and Required Changes

The nan0‑integration‑feedback.md document lists specific grievances with the initial audit and lays out concrete action items:

Reject Python sidecar – Nan0’s Python memory service must not run alongside AIRI. Instead, its memory and cognition router must be rewritten in TypeScript, leveraging AIRI’s existing in‑browser vector search
screenshot
.
Port Chroma DB data – diaries and episodic events stored in Chroma DB should be indexed through the layered‑memory.ts API. Actor relationships (actorId, targetActorId, relationship) can be added as metadata on each document to support future social reasoning
screenshot
.
Restore puppet mode – ensure that the Discord integration continues to support the default local audio playback when routing text to Discord. This mode was omitted in the other audit but is already part of the planned /voicemode command
screenshot
.
Prioritise classic TTS in voice calls – defer Gemini Live integration and instead implement /voicecall using Deepgram STT, a custom LLM, and a TTS provider
screenshot
.
Per‑channel session/character mapping – implement channel‑level session isolation so that each Discord channel maintains its own active character and session
screenshot
.

These action items are aligned with AIRI’s existing architecture, but they require specific implementation work.

Comparison: Where We Are vs. Where We Need to Go
Area	Current Implementation	Gaps for Nan0	Needed Work
Memory & Cognition	Long‑term, short‑term and lifetime memory stores with a hybrid vector search index (layered‑memory.ts), enabling in‑browser vector recall and open metadata fields
screenshot
.	Nan0’s Python‑based memory system uses Chroma DB; no TypeScript router exists for its diaries and episodic events.	Re‑implement Nan0’s memory ingestion and cognition router in TypeScript. Map existing Chroma DB entries into AIRI’s memory store and index them through layered‑memory.ts, including actor metadata. Remove Python sidecar.
Voice Modes & Calls	Discord revamp defines /voicemode and /voicecall commands with puppet, voicenote, none and tts, gemini options. Puppet mode (local playback) is currently default
screenshot
.	The Nan0 audit indicated that puppet mode was omitted in another spec. Gemini Live is expensive and should not be used by default
screenshot
.	Ensure that the implementation of /voicemode includes puppet as the default. For /voicecall, implement the classic tts pipeline using Deepgram STT, a custom LLM and a TTS provider such as Kokoro or MOSS‑Nano; defer Gemini Live.
Session Isolation	AIRI supports multiple chat sessions within a universe, but Discord integration currently uses a single global session.	Nan0 requires per‑channel session and character tracking so that conversation context does not bleed between channels
screenshot
.	Extend the Discord service to map each channelId to its own active character and session. Persist this mapping and update it when users run /character commands.
Speech Provider & Voice Cloning	Kokoro is the default local TTS provider. The Audio Studio allows creation of virtual voice profiles that wrap base providers and apply pitch/rate/equalizer effects
screenshot
. MOSS‑TTS‑Nano (ONNX) is proposed as a sidecar‑free local TTS engine
screenshot
.	Nan0 may require a custom TTS (e.g. MOSS‑Nano) to provide high‑quality voices without relying on cloud services. Voice cloning for user‑specific voices is not yet implemented.	Add moss‑nano‑local as a first‑class speech provider following the unified inference protocol. Support voice cloning by persisting reference audio and exposing voice profiles through the Audio Studio. Ensure the provider falls back to WASM/CPU when WebGPU is unavailable.
Proactivity & Context Injection	Attention Ecology and Dynamic Memory RAG proposals implement local filtering and user‑controlled memory injection, ensuring only relevant telemetry or memory snippets are sent to the model
screenshot
.	Nan0’s cognition may benefit from these features, but they are not explicitly tied to Nan0.	Adopt the Grounding Options popover to let users control whether Nan0’s context uses sensor data, timeline recall or universe‑scoped memories. Use the same vector search backend for memory retrieval.
Provider & Store Refactoring	Several documents describe ongoing refactoring of the provider registry and store (e.g. providers.ts restructuring) and porting efforts (Artistry, audio).	None directly hinder Nan0, but mis‑alignment between branches could complicate integration.	Coordinate Nan0 integration with these refactoring efforts to avoid merge conflicts. Ensure new providers like moss‑nano‑local follow the new registry patterns.
Conclusions and Recommendations
Embrace a browser‑native stack – The existing AIRI architecture already demonstrates that memory, cognition and TTS can run entirely in TypeScript/JavaScript. Nan0 should adopt this stack and avoid any Python sidecars
screenshot
.
Leverage existing memory infrastructure – Index Nan0’s diaries and episodic memories using layered‑memory.ts and attach actor metadata directly. This integrates seamlessly with the short‑term, long‑term and lifetime memory pipelines
screenshot
.
Implement voice commands promptly – The /voicemode and /voicecall commands are critical for user control. Ensure puppet mode remains the default and implement the classic TTS pipeline using Deepgram and a custom LLM/TTS provider
screenshot
.
Add MOSS‑TTS‑Nano provider – Integrating the ONNX‑based MOSS‑Nano engine provides a high‑quality, local TTS option with voice cloning. This aligns with Nan0’s desire for custom voices and a Python‑free stack
screenshot
.
Isolate sessions by channel – Extend the Discord integration to track sessions per channel and per character to prevent context leakage. This will align with the universe/timeline architecture and support Nan0’s cognitive models
screenshot
.
Coordinate with ongoing refactors – Several documents outline major refactoring efforts. The Nan0 work should be synchronized with these changes to avoid duplicate implementations or merge conflicts.

By following these recommendations, the AIRI team can complete the migration from Nan0’s standalone Python prototype to a clean, integrated TypeScript implementation, harnessing the full power of AIRI’s memory systems, unified audio pipeline and proactive context management.
