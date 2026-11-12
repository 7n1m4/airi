# P11 — features.md audit (Lane P11-audit)

> 2026-11-12 update (wave ⑪ integration): module-services wave landed — Memory (airi-core backend, Qt page), Speech (airi-speech catalog, Qt page), Hearing (settings surface, no capture), Modules overview page, CardExportDialog. Manifest reclassified: 13 rows ticked (#26/#221 MCP, #58 cloud-sync local-FS, #68 messaging-discord, #52 memory, #62 modules landing, #61 hearing, #65 long-term, #66 short-term, #70 speech, #108 speech landing, + 2 unwaived card-export rows); unchecked 189 → 116. The 23 per-provider speech/transcription rows stay (b) unchecked pending a manifest-refresh decision; #126 transcription landing stays (a); #64 lifetime-memory and #67 memory-signals stay (a) — not built this wave.

> 2026-11-12 update (user decision, "next move"): the previously listed
> remaining (a)-gap blocks are now waived for v1 — card-AI suite 43 rows,
> knowledge-graph 8 rows, artistry/consciousness/vision/agentic-os/emotion 11
> rows — see `features.waivers.json` and `p12-cutover-plan.md` §7. Manifest:
> 127 unchecked / 87 waived / 20 checked. Remaining unchecked rows are
> Electron/web par-locked (stage-tamagotchi roots), provider/module/settings
> rows with working Electron counterparts but no Qt backend, and blocked-on-lanes
> items. The Qt v1 scope is fully declared.

Read-only audit of `apps/airi-qt/docs/port-manifest/features.md` (234 items, 10 ticked → **224 unchecked**, all classified here). No files other than this one were touched; nothing was ticked, regenerated, or applied. Evidence is local-tree reads as of 2026-11-10; nothing was compile- or run-verified (no cargo/pnpm/tests were run).

Method: followed `docs/phase-notes/p11-parity-design.md` (§1–§4), the phase notes (`p2`…`p10`), `apps/airi-qt` crates/bridges/QML, `features.ticks.json`, and — for item identity — the Vue source paths in each manifest line (spot-checked with `head` for the non-obvious ones: `window-shortcuts.vue` (fully commented out), `/dashboard` (empty stub), `motion/index.vue` (redirect), `/v2/settings` (stubs), `ConnectionSettings`/`connection.vue` duplication).

Class definitions: **(a)** real gap — no Qt counterpart found and the item represents a feature worth porting; **(b)** done-never-ticked — Qt implementation exists (page/bridge/crate), evidence listed; **(c)** out of scope — reason given (architecture collapse, Electron-only, browser-only, licensed/disabled/stub, etc.); **(d)** blocked — depends on another in-flight or explicitly-deferred wave/lane (MCP, card-AI, cloud-sync, System-1/Laya wiring, P10/MMD). Confidence: high = verified in-tree; medium = strong indirect evidence; low = best-effort guess (only one row, #101).

## 1. Counts

| Class | Count | Share of 224 |
|---|---|---|
| (a) real gap | **86** | 38% |
| (b) done, never ticked | **43** | 19% |
| (c) out of scope | **44** | 20% |
| (d) blocked | **51** | 23% |

Route split of the 224: 142 routes (152 total − 10 ticked, all routes) + 82 non-route files. Confidence distribution: (a) 39 high / 46 medium / 1 low; (b) 28 high / 15 medium; (c) 29 high / 15 medium; (d) 45 high / 6 medium / 0 low.

Reality check vs. the parity-design note: the honest audited-unit count is confirmed to be materially lower than 224 actionable rows — 87 rows (39%) are either ticks-to-apply (b, 43) or not-a-port (c, 44), and 51 (23%) are parked behind named lanes. That leaves **86 (a)** rows, of which **25 are the devtools family** (all recommended for a single global waiver decision — see §4.2) and **8 are the knowledge-graph family** (large greenfield). The (a)-excluding-devtools, excluding-knowledge-graph set is ~53 rows.

## 2. Full classification (all 224 unchecked items, manifest order)

Columns: `#` (audit index) | route | class | evidence (Qt file/crate or reason) | confidence. Duplicate manifest rows are cross-referenced in §5.

| # | route | class | evidence | confidence |
|---|---|---|---|---|
| 1 | `/actor` | (a) | No Qt counterpart for the interactive actor/stage page (Electron RendererStage: backgrounds/atmosphere, whisper dock, overlays, drag). Qt stage covers VRM+Spine only (qml/stage/StageWindow.qml, qml/StageScene.qml) | medium |
| 2 | `/caption` | (a) | Qt captions exist only in-stage (qml/CaptionOverlay.qml, settings_stage.rs StageSettingsPage); the separate frameless caption window (drag, ignore-mouse, follow-stage IPC) is not ported | medium |
| 3 | `/customizer` | (a) | No Qt counterpart; StageSettingsPage control-strip card tracks only stage/caption ids (p3-stage-settings.md); customizer's 22-button catalog + background tint not ported | high |
| 4 | `/dashboard` | (c) | Vue file is an empty stub (<div>Dashboard</div>); nothing to port | high |
| 5 | `/devtools` | (a) | No Qt counterpart found (no devtools pages/bridges anywhere in apps/airi-qt); devtools, likely waive — user decision pending | high |
| 6 | `/devtools/lag-visualizer` | (a) | No Qt counterpart found; devtools (frame-time visualizer); recommend devtools waiver | high |
| 7 | `/devtools/live2d` | (c) | Live2D/Cubism license deferred; Live2dSettingsPage.qml is an explicit deferred-renderer placeholder (p6-render-pages.md); parity-design sample item 1 | high |
| 8 | `/devtools/performance-visualizer` | (a) | No Qt counterpart found; devtools (performance visualizer); recommend devtools waiver | high |
| 9 | `/devtools/screen-capture` | (a) | No Qt counterpart found; devtools screen-capture (Electron desktopCapturer); recommend devtools waiver | medium |
| 10 | `/devtools/stage-vfx` | (a) | No Qt counterpart found; devtools (stage VFX); Qt stage has no VFX layer; recommend devtools waiver | high |
| 11 | `/devtools/use-electron-all-displays` | (c) | Electron-only internals (useElectronAllDisplays — Electron IPC displays); no Qt meaning | high |
| 12 | `/devtools/use-electron-relative-mouse` | (c) | Electron-only internals (useElectronRelativeMouse); no Qt meaning | high |
| 13 | `/devtools/use-magic-keys` | (c) | Browser/Electron idiom demo (VueUse magic-keys); no Qt meaning; devtools | medium |
| 14 | `/devtools/use-window-mouse` | (c) | Browser-only demo (window mouse position, useWindowMouse); no Qt meaning; devtools | medium |
| 15 | `/devtools/vision` | (a) | No Qt counterpart found; devtools (vision debug); recommend devtools waiver | high |
| 16 | `/devtools/widgets-calling` | (a) | No Qt counterpart found; devtools (widgets-calling); recommend devtools waiver | high |
| 17 | `/index` | (a) | Qt stage window renders VRM/Spine only (StageWindow.qml); full renderer page (backgrounds/atmosphere, Live2D/MMD, VAD loop, chat orchestrator) not at parity; no Qt counterpart found | medium |
| 18 | `/inlay` | (c) | Electron-only inlay/Spotlight window (vibrancy, backgroundMaterial, frameless BrowserWindow); no Qt meaning; no Qt counterpart | high |
| 19 | `/notice/fade-on-hover` | (b) | qml/pages/notice/FadeOnHoverNoticePage.qml (p9-laneA) — static port; notice-host bridge + video assets deferred/disabled | medium |
| 20 | `/notice/gemini` | (b) | **CUT from the Qt build 2026-11-12** (user decision: no Gemini-centric surface; all models present equal opportunities). `qml/pages/notice/GeminiNoticePage.qml` deleted; provider catalog keeps `google-gemini` as a peer | medium |
| 21 | `/notice` | (b) | qml/pages/notice/NoticePage.qml (p9-laneA) — informative hub; notice router/host not wired | medium |
| 22 | `/onboarding-v3` | (b) | qml/pages/onboarding/OnboardingV3Page.qml (p9-laneA) — static port; first-run store/host not wired | medium |
| 23 | `/onboarding` | (b) | **CUT from the Qt build 2026-11-12** (user decision: Onboarding V3 is the kept surface). `qml/pages/onboarding/OnboardingPage.qml` deleted; v3 page kept | medium |
| 24 | `/settings/docs/[...path]` | (a) | No Qt docs viewer found (no docs route/page/bridge in apps/airi-qt); stage-tamagotchi docs SPA unported | high |
| 25 | `/settings/docs` | (a) | No Qt docs viewer found; same as [...path] above | high |
| 26 | `/settings/modules/mcp` | (d) | Blocked on MCP backend/pages lane; airi-mcp crate (stdio client) landed but tools/bridges into Qt UI explicitly out of scope so far (crates/airi-mcp, p-notes: 'Qt bridges — wiring this crate into the Qt UI is a separate lane') | high |
| 27 | `/settings/system/connection` | (a) | No Qt counterpart found; server-channel WS settings (ws://…:6121/ws, auth token, TLS) + CORS-bypass (Electron-only) + HF token unported | medium |
| 28 | `/settings/system/developer` | (c) | Electron-only devtools hub (opens electronOpenMainDevtools + links to devtools pages); devtools waived | medium |
| 29 | `/settings/system/dock-mode` | (c) | Electron/compositor-specific dock-mode (DockPosition left/right of another window; useDockModeStore over Electron IPC); no Qt meaning | medium |
| 30 | `/settings/system/general` | (b) | qml/pages/settings/system/GeneralSettingsPage.qml + crates/airi-qt/src/bridges/settings_general.rs (GeneralSettingsController); settings/general section; smoke-verified | high |
| 31 | `/settings/system` | (c) | Settings catalog grid (SETTINGS_CATALOG_ITEMS ripple grid); subsumed by Qt SettingsWindow nav (qml/shell/SettingsWindow.qml); no route needed | medium |
| 32 | `/settings/system/window-shortcuts` | (c) | Disabled upstream: entire <script setup> is commented out in the Vue source; nothing to port | high |
| 33 | `/widgets` | (b) | qml/pages/widgets/WidgetsPage.qml (p9-laneA) — static catalog port; widgets fetch/remove bridge deferred | medium |
| 34 | `/devtools/beat-sync` | (a) | No Qt counterpart found; devtools (beat-sync analyser); recommend devtools waiver | high |
| 35 | `/devtools/context-flow` | (a) | No Qt counterpart found; devtools (context-flow visualizer); recommend devtools waiver | high |
| 36 | `/devtools/core-ai-lab` | (a) | No Qt counterpart found; devtools (core-ai-lab); recommend devtools waiver | high |
| 37 | `/devtools/image` | (a) | No Qt counterpart found; devtools (image); recommend devtools waiver | high |
| 38 | `/devtools/markdown-stress` | (a) | No Qt counterpart found; devtools (markdown stress); recommend devtools waiver | high |
| 39 | `/devtools/orbital-navigation` | (a) | No Qt counterpart found; devtools (orbital navigation); recommend devtools waiver | high |
| 40 | `/devtools/plugin-host` | (a) | No Qt counterpart found; devtools (plugin-host); Qt has no plugin system; recommend devtools waiver | medium |
| 41 | `/devtools/providers-transcription-realtime-aliyun-nls` | (a) | No Qt counterpart found; devtools (aliyun-nls realtime transcription); airi-stt aliyun client exists but token acquisition out of scope; recommend devtools waiver | high |
| 42 | `/devtools/vibrant` | (a) | No Qt counterpart found; devtools (vibrant color extraction); recommend devtools waiver | high |
| 43 | `/devtools/websocket-inspector` | (a) | No Qt counterpart found; devtools (websocket inspector); parity-design sample item 3 (likely waive) | high |
| 44 | `/knowledge-graph/MindMapExplorer` | (a) | No Qt counterpart found anywhere in apps/airi-qt (knowledge-graph / MindMapExplorer); large greenfield port | high |
| 45 | `/settings/about` | (b) | qml/shell/AboutWindow.qml — about window incl. version + UpdateController release check (bridges/update.rs); Vue page is a settings section, Qt splits it into its own window | medium |
| 46 | `/settings/airi-card/foundry` | (d) | Blocked on card-AI wave (p9-card-wave2 explicitly defers guided/foundry/import-hub wizards + ~40k lines of the airi-card suite) | high |
| 47 | `/settings/airi-card/guided` | (d) | Blocked on card-AI wave (p9-card-wave2 deferred) | high |
| 48 | `/settings/airi-card/import-hub` | (d) | Blocked on card-AI wave (p9-card-wave2 defers import-hub wizard explicitly) | high |
| 49 | `/settings/data` | (b) | qml/pages/settings/data/DataSettingsPage.qml + vault backend wired (airi-core/src/vault.rs, bridges/data.rs, airi-store v4 scrub_runs; p9-lane-data-backend.md supersedes the UI-only note) | high |
| 50 | `/settings/dating-sim` | (a) | No Qt counterpart found; dating-sim module (DatingSim store + LLM-driven sync); experimental feature, unreviewed | medium |
| 51 | `/settings` | (b) | Qt SettingsWindow + nav (qml/shell/SettingsWindow.qml) serves as the settings landing; not a 1:1 port of the Vue settings index grid | medium |
| 52 | `/settings/memory` | (a) | Backend ported (airi-core/src/memory/{short_term,retrieval,embedding}.rs; airi-store v2/v3 summaries/journal/embeddings) but NO Qt settings surface exists — backend done, UI missing (parity-design sample item 6) | high |
| 53 | `/settings/models/emotions` | (d) | Blocked on card-AI/models wave: Emotion Calibration Studio explicitly deferred (p9-card-wave2 models/emotions note); Qt has no expression-calibration infrastructure | medium |
| 54 | `/settings/models` | (a) | No Qt counterpart found; models management page (library/explore/cloud + captureFrame); Qt has ExploreModelsPage only; Vibrant/captureFrame unported | medium |
| 55 | `/settings/modules/agentic-os` | (a) | No Qt counterpart found; agentic-os module (agentic store, companion scopes, event log, presence); large module | medium |
| 56 | `/settings/modules/artistry` | (a) | No Qt counterpart found; artistry module (image generation, Pollinations/Replicate presets, background store); large; also depends on artistry provider breadth | medium |
| 57 | `/settings/modules/beat-sync` | (a) | No Qt counterpart found; beat-sync analyser (nekopaw/tempora worklet, beat detector); medium | medium |
| 58 | `/settings/modules/cloud-sync` | (d) | Blocked on sync-engine/cloud-sync phase — explicitly untouched by p9-laneB ('Cloud Sync ... sync engine bridge is a separate phase'); no Qt sync backend | high |
| 59 | `/settings/modules/consciousness` | (a) | No Qt counterpart found; consciousness module (ConsciousnessWorkspace); large | medium |
| 60 | `/settings/modules/gaming-factorio` | (c) | Game-specific niche integration (Factorio agent module); not planned for Qt v1; vendor/game-specific; candidate for waiver | medium |
| 61 | `/settings/modules/hearing` | (a) | Backend ported (airi-stt: capture, Silero VAD, OpenAI-compatible/Deepgram/Aliyun STT) but NO Qt hearing/mic settings surface exists — backend done, UI missing | medium |
| 62 | `/settings/modules` | (a) | No Qt counterpart found; modules landing grid (SETTINGS_CATALOG_ITEMS + GlobalFacultiesMatrix); Qt SettingsWindow has no Modules section | medium |
| 63 | `/settings/modules/libp2p` | (d) | Blocked on sync-engine/cloud-sync phase; libp2p is the peer transport for sync (useLibp2pStore consumed by cloud-sync); no Qt counterpart; p9-laneB leaves sync engine as a separate phase | medium |
| 64 | `/settings/modules/memory-lifetime` | (a) | Backend landed (airi-core memory: journal/retrieval/embeddings; summaries/journal_entries tables); LifetimeMemoryView not ported; no Qt surface | high |
| 65 | `/settings/modules/memory-long-term` | (a) | Backend landed (airi-core memory + airi-store summaries/journal); no Qt settings surface (parity-design sample item 7 for short-term) | high |
| 66 | `/settings/modules/memory-short-term` | (a) | Backend landed (airi-core memory/{short_term,retrieval}.rs + airi-store v2/v3); no Qt settings surface (parity-design sample item 7) | high |
| 67 | `/settings/modules/memory-signals` | (a) | No Qt counterpart found; memory-signals (proactive recall/signal triggers per card); same memory family | medium |
| 68 | `/settings/modules/messaging-discord` | (c) | Social-platform integration (Discord bot module); not planned for Qt v1 (no lane, no backend); vendor-specific | medium |
| 69 | `/settings/modules/messaging-friends` | (c) | Social-platform integration (friends messaging module); not planned for Qt v1 (no lane, no backend); vendor-specific | medium |
| 70 | `/settings/modules/speech` | (a) | Backend ported (airi-speech 26 TTS defs + client_kokoro; airi-stt) but NO Qt speech settings surface exists — backend done, UI missing (parity-design sample item 9 for microsoft-speech) | medium |
| 71 | `/settings/modules/system-one` | (a) | Backend landed (airi-laya LayaModel, p9-laya) but airi-llm keeps laya-local stub as no_chat/Unsupported; no Qt system-one page — wiring + UI missing | medium |
| 72 | `/settings/modules/text-to-motion` | (a) | No Qt counterpart found; text-to-motion module (flowmdm, VRM/VRMA animation generation); large; related to P10 motion | medium |
| 73 | `/settings/modules/vision` | (a) | No Qt counterpart found; vision module (moondream/blip/apple-core-ai analysis, radio-card providers); large | medium |
| 74 | `/settings/modules/x` | (c) | Social-platform integration (X/Twitter component); not planned for Qt v1; vendor-specific | medium |
| 75 | `/settings/providers/artistry/comfyui` | (a) | No Qt counterpart found; artistry provider (ComfyUI backend client); large | medium |
| 76 | `/settings/providers/artistry` | (a) | No Qt counterpart found; artistry provider index (image generation landing); large | medium |
| 77 | `/settings/providers/artistry/nanobanana` | (a) | No Qt counterpart found; artistry provider (nanobanana); large | medium |
| 78 | `/settings/providers/artistry/pollinations` | (a) | No Qt counterpart found (Pollinations image-gen path; not the chat registry row); artistry gap | medium |
| 79 | `/settings/providers/artistry/replicate` | (a) | No Qt counterpart found; artistry provider (replicate imagegen presets); large | medium |
| 80 | `/settings/providers/chat/[providerId]` | (c) | Architecture: per-provider Vue pages collapsed into generic ProvidersPage.qml driven by airi_llm::PROVIDER_DEFS (45 rows); page row is not a port requirement (parity-design §4 trap) | high |
| 81 | `/settings/providers/chat/amazon-bedrock` | (c) | In Rust registry, chatCapable=false (no_chat: 'arrives in a later phase'); renders as not-available row in ProvidersPage; no dedicated page needed | high |
| 82 | `/settings/providers/chat/apple-core-ai` | (c) | Not in Rust registry; Apple-only on-device chat (Apple Core AI); platform-specific; no Qt counterpart planned | medium |
| 83 | `/settings/providers/chat/azure-ai-foundry` | (c) | In Rust registry (azure creds, OpenAI-compatible wire); generic ProvidersPage renders it; parity item: page-level row not a port requirement | high |
| 84 | `/settings/providers/chat/blip-local` | (c) | Not in Rust registry; BLIP local vision chat (requires vision stack, not ported); Qt has no vision chat; parity manifest architecture (collapsed into generic page only if registered) | medium |
| 85 | `/settings/providers/chat` | (b) | qml/pages/settings/providers/ProvidersPage.qml + ProviderRow/ProviderDetail (p2-wave-b-providers); registry-driven list replaces the Vue index; smoke-verified | high |
| 86 | `/settings/providers/chat/lm-studio` | (c) | In Rust registry (LocalServer, ollama_local creds); generic ProvidersPage renders it; page-level row not a port requirement | high |
| 87 | `/settings/providers/chat/moondream-local` | (c) | Not in Rust registry; Moondream local vision chat (requires vision stack, not ported); no Qt counterpart | medium |
| 88 | `/settings/providers/chat/ollama` | (c) | In Rust registry (LocalServer, :11434); generic ProvidersPage renders it; page-level row not a port requirement | high |
| 89 | `/settings/providers/chat/qwen-portal` | (c) | Not in Rust registry (parity-design sample item 8 — deliberate replacement by generic page; qwen-portal contract undecided); high | high |
| 90 | `/settings/providers/chat/web-llm` | (c) | Browser-only (WebLLM/WASM in renderer); no Qt meaning | high |
| 91 | `/settings/providers/chat/web-rwkv` | (c) | Browser-only (WebRWKV WASM); no Qt meaning | high |
| 92 | `/settings/providers/cloud` | (d) | Blocked on cloud-sync phase (p9-laneB: sync engine bridge is a separate, untouched phase); no Qt sync backend | high |
| 93 | `/settings/providers/cloud/local-fs` | (d) | Blocked on cloud-sync phase (p9-laneB); local-fs sync target unported | high |
| 94 | `/settings/providers/cloud/s3` | (d) | Blocked on cloud-sync phase (p9-laneB); S3 sync target unported | high |
| 95 | `/settings/providers/free-hub` | (a) | No Qt counterpart found; free-AI catalog browser (FreeAICatalog store + resolveProviderId helpers); real feature, not scheduled; medium | medium |
| 96 | `/settings/providers` | (b) | qml/pages/settings/providers/ProvidersPage.qml (p2-wave-b-providers); Vue providers index subsumed by registry-driven page | high |
| 97 | `/settings/providers/motion/flowmdm` | (a) | No Qt counterpart found; text-to-motion/flowmdm motion-generation playground (VRMA output); large; motion is P10-adjacent | medium |
| 98 | `/settings/providers/motion` | (c) | Vue page is a redirect stub (router.replace('/settings/providers#motion')); nothing to port | high |
| 99 | `/settings/providers/speech/airi-audio-server` | (b) | airi-speech OpenAI-compatible TTS client covers airi-audio-server (127.0.0.1:8095/v1); TTS registry row ported (p5-tts); no dedicated settings page (speech UI not landed) | high |
| 100 | `/settings/providers/speech/alibaba-cloud-model-studio` | (b) | airi-speech unspeech proxy client (POST {unspeech}/audio/speech) — alibaba-cloud-model-studio row ported (p5-tts); no dedicated settings page | high |
| 101 | `/settings/providers/speech/app-local-audio-speech` | (a) | No Qt counterpart found; app-local-audio-speech (device-id local audio TTS via hearing store speechProviderSettings); unusual local path; unreviewed | low |
| 102 | `/settings/providers/speech/aws-polly-tts` | (b) | airi-speech AWS Polly SigV4 client ported; signature self-graded (unit tests only; never run against live AWS); no dedicated settings page (p5-tts) | medium |
| 103 | `/settings/providers/speech/chatterbox` | (b) | airi-speech OpenAI-compatible client covers chatterbox (same contract as airi-audio-server); TTS registry row ported (p5-tts); no dedicated settings page | high |
| 104 | `/settings/providers/speech/comet-api-speech` | (b) | airi-speech OpenAI-compatible client covers comet-api-speech (p5-tts); no dedicated settings page | high |
| 105 | `/settings/providers/speech/deepgram-tts` | (b) | airi-speech unspeech proxy client — deepgram-tts row ported (p5-tts); no dedicated settings page | high |
| 106 | `/settings/providers/speech/elevenlabs` | (b) | airi-speech native ElevenLabs client (xi-api-key, /v1/text-to-speech/{voiceId}) ported (p5-tts); no dedicated settings page | high |
| 107 | `/settings/providers/speech/index-tts-vllm` | (b) | airi-speech OpenAI-compatible client (index-tts-vllm @ localhost:11996, path /tts/audio/speech per Vue); ported with caveats; no dedicated settings page (p5-tts) | medium |
| 108 | `/settings/providers/speech` | (a) | No Qt counterpart found; speech providers landing page (AudioStudio-based hearing/speech settings); Qt has NO speech settings surface at all (parity-design item 9); a landing does not exist | medium |
| 109 | `/settings/providers/speech/kokoro-local` | (b) | airi-speech KokoroSynthesizer (client_kokoro.rs, in-process 82M, p9-kokoro) — kokoro-local row ported (TtsStatus::Partial); no dedicated settings page | high |
| 110 | `/settings/providers/speech/microsoft-speech` | (b) | airi-speech unspeech proxy client — microsoft-speech row ported (microsoft/{model}); parity-design sample item 9; no dedicated settings page | high |
| 111 | `/settings/providers/speech/moss-nano-local` | (a) | airi-speech: explicit UnsupportedProvider (in-process adapter, no HTTP contract); not ported; no Qt counterpart found | medium |
| 112 | `/settings/providers/speech/openai-audio-speech` | (b) | airi-speech OpenAI-compatible client (openai-audio-speech) ported (p5-tts); no dedicated settings page | high |
| 113 | `/settings/providers/speech/openai-compatible-audio-speech` | (b) | airi-speech OpenAI-compatible client (openai-compatible-audio-speech) ported (p5-tts); no dedicated settings page | high |
| 114 | `/settings/providers/speech/openrouter-audio-speech` | (b) | airi-speech OpenRouter audio client (chat/completions + modalities: audio, pcm16) ported (p5-tts); no dedicated settings page | high |
| 115 | `/settings/providers/speech/player2-speech` | (b) | airi-speech Player2 client (POST /tts/speak, player2-game-key) ported (p5-tts); no dedicated settings page | high |
| 116 | `/settings/providers/speech/pocket-tts-local` | (a) | airi-speech: explicit UnsupportedProvider (in-process adapter, no HTTP contract); not ported; no Qt counterpart found | medium |
| 117 | `/settings/providers/speech/virtual-audio-studio` | (c) | airi-speech: explicit UnsupportedProvider (virtual-audio-studio is Vue-only FX composition over other engines; no HTTP contract); out of scope | high |
| 118 | `/settings/providers/speech/volcengine` | (b) | airi-speech unspeech proxy client — volcengine/{model} row ported (requires extra.app_id); (p5-tts); no dedicated settings page | high |
| 119 | `/settings/providers/speech/xai-audio-speech` | (b) | airi-speech OpenAI-compatible client (xai-audio-speech) ported (p5-tts); no dedicated settings page | high |
| 120 | `/settings/providers/system1/[providerId]` | (d) | Blocked on System-1 wiring lane: airi-laya LayaModel landed (p9-laya) but airi-llm keeps laya-local/typesafe-ai as no_chat/Unsupported ('lands in a later phase'); integration sketch deliberately not wired (p9-laya); no Qt system1 provider page | medium |
| 121 | `/settings/providers/system1/laya-local` | (d) | Blocked on System-1 wiring lane: same as above; laya-local registry row exists but is not wired to airi-laya; no Qt page; p9-laya integration sketch unexecuted | medium |
| 122 | `/settings/providers/transcription/aliyun-nls-transcription` | (b) | airi-stt aliyun streaming client ported (WSS StartTranscription/SentenceEnd; pre-issued token REQUIRED — AK/SK HMAC token acquisition deliberately out of scope); no dedicated settings page (p5-stt) | medium |
| 123 | `/settings/providers/transcription/browser-web-speech-api` | (c) | Browser-only (webkitSpeechRecognition / Web Speech API); no Qt meaning; no Qt counterpart | high |
| 124 | `/settings/providers/transcription/comet-api-transcription` | (b) | airi-stt OpenAI-compatible whole-blob client (POST {base}/audio/transcriptions) covers comet-api via base_url; no dedicated settings page (p5-stt) | medium |
| 125 | `/settings/providers/transcription/deepgram-transcription` | (b) | airi-stt deepgram streaming client ported (WS, Interim/Final); no dedicated settings page (p5-stt) | high |
| 126 | `/settings/providers/transcription` | (a) | No Qt counterpart found; transcription providers landing page; Qt has NO transcription settings surface (only backend clients in airi-stt) | medium |
| 127 | `/settings/providers/transcription/openai-audio-transcription` | (b) | airi-stt OpenAI-compatible client (openai-audio-transcription) ported; no dedicated settings page (p5-stt) | high |
| 128 | `/settings/providers/transcription/openai-compatible-audio-transcription` | (b) | airi-stt OpenAI-compatible client (openai-compatible-audio-transcription) ported; no dedicated settings page (p5-stt) | high |
| 129 | `/settings/providers/transcription/whisper-local` | (b) | airi-stt WhisperLocalClient (whisper-rs, in-process whisper-local, p9-whisper) ported; no dedicated settings page | high |
| 130 | `/settings/providers/transcription/xai-audio-transcription` | (b) | airi-stt OpenAI-compatible client covers xai-audio-transcription via base_url; no dedicated settings page (p5-stt) | medium |
| 131 | `/settings/providers/vision` | (a) | No Qt counterpart found; vision providers landing (moondream/blip/apple-core-ai); Qt has no vision stack; not in Rust registry | medium |
| 132 | `/settings/scene` | (a) | No Qt counterpart found; scene/backgrounds settings (ATMOSPHERE_OPTIONS, background store, captures); Qt has empty/no backgrounds (p9-laneB: backgrounds domain = 0) | medium |
| 133 | `/settings/stage` | (a) | No Qt counterpart found; Vue stage/index.vue is the StageControlEditor (control-strip customizer); explicitly not ported (parity-design sample item 10) | high |
| 134 | `/settings/system/ConnectionSettings` | (a) | No Qt counterpart found; shared WS connection form (VITE-default ws://localhost:6121/ws, auth, HF token, TLS); used from the connection page | medium |
| 135 | `/settings/system/color-scheme` | (b) | qml/ThemeSettingsPage.qml (hue/chroma/dark-mode, ThemeBridge) — covers hue/chroma/mode; Vue accent presets (warm/flora/ocean/bloom) NOT ported | medium |
| 136 | `/settings/system` | (c) | Settings catalog grid (SETTINGS_CATALOG_ITEMS ripple grid); subsumed by Qt SettingsWindow nav; no route needed | medium |
| 137 | `/v2` | (c) | Experimental v2 UI (relu.avif hero, auth store, provider-catalog fetch from remote API); not part of desktop port scope; never routed in desktop build | high |
| 138 | `/v2/settings` | (c) | Experimental v2 RouterView stub; nothing to port | high |
| 139 | `/v2/settings` | (c) | Duplicate path of #138 (/v2/settings); v2 experimental; no Qt counterpart | high |
| 140 | `/v2/settings/providers` | (c) | Experimental v2 (remote provider catalog, splitpanes, breakpointsTailwind); not desktop port scope; no Qt counterpart | high |
| 141 | `/v2/settings/providers/edit` | (c) | Experimental v2 RouterView stub (edit/); nothing to port | high |
| 142 | `/v2/settings/providers/edit/[providerId]` | (c) | Experimental v2 provider editor (zod validators, remote provider catalog, validation dialog); no Qt meaning; no Qt counterpart | medium |
| 143 | `/v2/settings/providers` | (c) | Duplicate of #140 (/v2/settings/providers); v2 experimental; no Qt counterpart | high |
| 144 | `/devtools/context-flow/components/context-flow-actions` | (a) | No Qt counterpart found; context-flow devtools components (Pinia context-flow store consumers); recommend devtools waiver | high |
| 145 | `/devtools/context-flow/components/context-flow-entry-card` | (a) | No Qt counterpart found; context-flow devtools component; recommend devtools waiver | high |
| 146 | `/devtools/context-flow/components/context-flow-filters` | (a) | No Qt counterpart found; context-flow devtools component; recommend devtools waiver | high |
| 147 | `/devtools/context-flow/components/context-flow-preview` | (a) | No Qt counterpart found; context-flow devtools component; recommend devtools waiver | high |
| 148 | `/devtools/context-flow/components/context-flow-spark-notify` | (a) | No Qt counterpart found; context-flow devtools component; recommend devtools waiver | high |
| 149 | `/devtools/context-flow/components/context-flow-stream` | (a) | No Qt counterpart found; context-flow devtools component; recommend devtools waiver | high |
| 150 | `/devtools/context-flow/composables/use-context-flow-formatters.test` | (c) | Test file (.test.ts) — Vue test not portable to Qt; 1 of 4 such rows (see honest limits) | high |
| 151 | `/devtools/context-flow/composables/use-context-flow-formatters` | (a) | No Qt counterpart found; context-flow devtools composable; recommend devtools waiver | high |
| 152 | `/devtools/context-flow/context-flow-types` | (a) | No Qt counterpart found; context-flow devtools types module (plain .ts, never routable); recommend devtools waiver | high |
| 153 | `/knowledge-graph/components/ChronologicalTimelineView` | (a) | No Qt counterpart found; knowledge-graph component (chronological timeline); large greenfield family (8 rows) | high |
| 154 | `/knowledge-graph/components/ConstellationCanvas` | (a) | No Qt counterpart found; knowledge-graph component (constellation canvas); large greenfield family | high |
| 155 | `/knowledge-graph/components/EntityDetailDrawer` | (a) | No Qt counterpart found; knowledge-graph component (entity detail drawer); large greenfield family | high |
| 156 | `/knowledge-graph/components/KnowledgeGraphOverview` | (a) | No Qt counterpart found; knowledge-graph component (overview); large greenfield family | high |
| 157 | `/knowledge-graph/components/MindMapHeader` | (a) | No Qt counterpart found; knowledge-graph component (mind-map header); large greenfield family | high |
| 158 | `/knowledge-graph/components/MindMapZeroState` | (a) | No Qt counterpart found; knowledge-graph component (mind-map zero state); large greenfield family | high |
| 159 | `/knowledge-graph/components/UniversalTimeScrubber` | (a) | No Qt counterpart found; knowledge-graph component (time scrubber); large greenfield family | high |
| 160 | `/settings/airi-card/components/AutoVoiceConfigModal` | (d) | Blocked on card-AI wave (p9-card-wave2: voice creator flow explicitly deferred); no Qt counterpart | medium |
| 161 | `/settings/airi-card/components/CardCreate` | (d) | Blocked on card-AI wave (p9-card-wave2 deferred suite) | high |
| 162 | `/settings/airi-card/components/CardCreationDialog` | (d) | Blocked on card-AI wave (p9-card-wave2 deferred suite) | high |
| 163 | `/settings/airi-card/components/CardDetailDialog` | (d) | Blocked on card-AI wave (p9-card-wave2 explicitly defers CardDetailDialog) | high |
| 164 | `/settings/airi-card/components/CardEditorForm` | (b) | qml/pages/cards/CardEditorPage.qml + bridges/cards.rs — Qt card editor covers the core CCv2/v3 form fields (save-back incl. PNG tEXt round-trip); per-field AI rewrite / full AIRI-extension editing NOT ported (suite, p9-card-wave2) | medium |
| 165 | `/settings/airi-card/components/CardExportDialog` | (a) | No Qt counterpart found; card export/download-as-file flow (Qt CardController saves in place only); small; orthogonal to card-AI wave | medium |
| 166 | `/settings/airi-card/components/CardImportWizard` | (d) | Blocked on card-AI wave (p9-card-wave2 explicitly defers CardImportWizard) | high |
| 167 | `/settings/airi-card/components/CardListItem` | (b) | qml/pages/cards/CardLibraryPage.qml — Qt library implements row list/scan/avatar/kind badge/use/delete flows (same scan_cards as chat); Vue row component superseded | high |
| 168 | `/settings/airi-card/components/ConceptBuilderModal` | (d) | Blocked on card-AI wave (AI concept builder; deferred suite) | high |
| 169 | `/settings/airi-card/components/CreateModeSelectorDialog` | (d) | Blocked on card-AI wave (deferred suite) | high |
| 170 | `/settings/airi-card/components/CustomCharacterModal` | (d) | Blocked on card-AI wave (deferred suite) | high |
| 171 | `/settings/airi-card/components/DeleteCardDialog` | (b) | qml/pages/cards/CardLibraryPage.qml — Qt delete flow: per-row Delete with AModal confirmation (clears activeCardId if it pointed at the deleted card) | high |
| 172 | `/settings/airi-card/components/FieldAiGeneratorModal` | (d) | Blocked on card-AI wave (AI per-field generation; explicitly deferred in p9-card-wave2) | high |
| 173 | `/settings/airi-card/components/ImageTagExtractorModal` | (d) | Blocked on card-AI wave (p9-card-wave2 sample item 4; ImageTagExtractorModal) | high |
| 174 | `/settings/airi-card/components/SyncCardDialog` | (d) | Blocked on card-AI wave (sync dialog; deferred suite; adjacent to sync-engine phase) | high |
| 175 | `/settings/airi-card/components/TabLoadingPlaceholder` | (d) | Blocked on card-AI wave (tab loading placeholder component of deferred suite; no Qt counterpart) | medium |
| 176 | `/settings/airi-card/components/VoiceCreatorModal` | (d) | Blocked on card-AI wave (VoiceCreatorModal; voice creator flow explicitly deferred in p9-card-wave2) | high |
| 177 | `/settings/airi-card/components/tabs/CardCreationTabActing` | (d) | Blocked on card-AI wave (acting tab; deferred suite) | high |
| 178 | `/settings/airi-card/components/tabs/CardCreationTabArtistry` | (d) | Blocked on card-AI wave (artistry tab; deferred suite) | high |
| 179 | `/settings/airi-card/components/tabs/CardCreationTabCognition` | (d) | Blocked on card-AI wave (cognition tab; deferred suite) | high |
| 180 | `/settings/airi-card/components/tabs/CardCreationTabGeneration` | (d) | Blocked on card-AI wave (generation tab; deferred suite) | high |
| 181 | `/settings/airi-card/components/tabs/CardCreationTabIdentity` | (d) | Blocked on card-AI wave (identity tab; deferred suite) | high |
| 182 | `/settings/airi-card/components/tabs/CardCreationTabModules` | (d) | Blocked on card-AI wave (modules tab; deferred suite) | high |
| 183 | `/settings/airi-card/components/tabs/CardCreationTabProactivity` | (d) | Blocked on card-AI wave (proactivity tab; explicitly deferred in p9-card-wave2) | high |
| 184 | `/settings/airi-card/components/tabs/CardCreationTabTools` | (d) | Blocked on card-AI wave (tools tab; deferred suite) | high |
| 185 | `/settings/airi-card/components/tabs/ProductionStudioTab` | (d) | Blocked on card-AI wave (production studio tab; deferred suite) | high |
| 186 | `/settings/airi-card/components/tabs/acting/ActingSubTabCues` | (d) | Blocked on card-AI wave (acting sub-tab cues; deferred suite) | high |
| 187 | `/settings/airi-card/components/tabs/acting/ActingSubTabIdling` | (d) | Blocked on card-AI wave (acting sub-tab idling; deferred suite) | high |
| 188 | `/settings/airi-card/components/tabs/acting/ActingSubTabPacingPlayground` | (d) | Blocked on card-AI wave (acting sub-tab pacing playground; deferred suite) | high |
| 189 | `/settings/airi-card/components/tabs/acting/ActingSubTabStickers` | (d) | Blocked on card-AI wave (acting sub-tab stickers; stickers explicitly deferred in p9-card-wave2) | high |
| 190 | `/settings/airi-card/components/tabs/acting/ActingSubTabThinking` | (d) | Blocked on card-AI wave (acting sub-tab thinking; deferred suite) | high |
| 191 | `/settings/airi-card/components/tabs/acting/ActingSubTabVoice` | (d) | Blocked on card-AI wave (acting sub-tab voice; deferred suite) | high |
| 192 | `/settings/airi-card/components/tabs/acting/components/CardStickerAddModal` | (d) | Blocked on card-AI wave (stickers flow; explicitly deferred in p9-card-wave2) | high |
| 193 | `/settings/airi-card/components/tabs/cognition/CognitionSubTabAffect` | (d) | Blocked on card-AI wave (cognition sub-tab affect; deferred suite) | high |
| 194 | `/settings/airi-card/components/tabs/cognition/CognitionSubTabMemory` | (d) | Blocked on card-AI wave (cognition sub-tab memory; deferred suite) | high |
| 195 | `/settings/airi-card/components/tabs/cognition/CognitionSubTabPlayground` | (d) | Blocked on card-AI wave (cognition sub-tab playground; deferred suite) | high |
| 196 | `/settings/airi-card/components/tabs/cognition/CognitionSubTabRouting` | (d) | Blocked on card-AI wave (parity-design sample item 5; CognitionSubTabRouting) | high |
| 197 | `/settings/airi-card/components/tabs/cognition/CognitionSubTabTriggers` | (d) | Blocked on card-AI wave (cognition sub-tab triggers; deferred suite) | high |
| 198 | `/settings/airi-card/components/tabs/generation-thinking-presets.test` | (c) | Test file (.test.ts) — Vue test not portable to Qt; 1 of 4 such rows | high |
| 199 | `/settings/airi-card/components/tabs/generation-thinking-presets` | (d) | Blocked on card-AI wave (generation tab thinking presets module; deferred suite) | high |
| 200 | `/settings/airi-card/composables/use-card-export` | (a) | No Qt counterpart found; card export/download composable (PNG/JSON download); Qt CardController saves in place only; small; orthogonal to card-AI wave | medium |
| 201 | `/settings/airi-card/composables/useActingCapabilities` | (d) | Blocked on card-AI wave (acting capabilities composable; deferred suite) | high |
| 202 | `/settings/airi-card/foundry-presets` | (d) | Blocked on card-AI wave (foundry presets; card foundry deferred) | high |
| 203 | `/settings/components/SettingsQuickAccess` | (a) | No Qt counterpart found; settings quick-access bar (card/onboarding quick actions); Electron navigation idiom; small | medium |
| 204 | `/settings/components/SettingsSearchBar` | (a) | No Qt counterpart found; settings search bar (static search index navigation); Qt SettingsWindow has no search; small-medium | medium |
| 205 | `/settings/components/SettingsUpdateBanner` | (a) | No Qt counterpart found; global 'update available' banner (Qt exposes check+notify only inside AboutWindow); small | medium |
| 206 | `/settings/composables/use-desktop-release-checker.spec` | (c) | Test file (.spec.ts) — Vue test not portable to Qt; 1 of 4 such rows | high |
| 207 | `/settings/composables/use-desktop-release-checker` | (b) | crates/airi-core/src/update.rs (check_for_update) + bridges/update.rs (UpdateController) — release check covered (check+notify only by deliberate design; no download/install parity) | high |
| 208 | `/settings/data/components/ExportVaultModal` | (b) | qml/pages/settings/data/DataExportDialog.qml (p9-laneA/B + p9-lane-data-backend) — export wired to airi-core vault backend (collect_archive); modal superseded | high |
| 209 | `/settings/data/components/ImportVaultModal` | (b) | qml/pages/settings/data/DataImportDialog.qml — import wired (inspectVault/commitVaultImport; chats+memory restore); modal superseded | high |
| 210 | `/settings/data/components/ScrubHistoryModal` | (b) | qml/pages/settings/data/ScrubHistoryDialog.qml — scrub wired (scrub_session_media + backup); modal superseded | high |
| 211 | `/settings/data/settings-search-index` | (a) | No Qt counterpart found; re-export of the stage-ui static settings search index; depends on settings search; small | medium |
| 212 | `/settings/data/status` | (c) | Thin Vue status-emitter helpers; nothing to port line-by-line (p9-laneB read it for structure only); Qt DataController surfaces status directly | high |
| 213 | `/settings/models/components/DiscoverCarousel` | (c) | Replaced in Qt: DiscoverCarousel (3D coverflow) deliberately superseded by a horizontal list in ExploreModelsPage.qml (p9-card-wave2) | high |
| 214 | `/settings/models/components/ModelSettingsSkeleton` | (c) | Vue-only skeleton loader for the models settings page; Qt ExploreModelsPage renders directly; nothing to port | medium |
| 215 | `/settings/modules/components/EntityDetailModal` | (a) | No Qt counterpart found; modules EntityDetailModal (module entity details); modules UI gap; medium | medium |
| 216 | `/settings/modules/components/GlobalFacultiesMatrix` | (a) | No Qt counterpart found; GlobalFacultiesMatrix (faculties/failover defaults matrix per module); modules UI gap; large | medium |
| 217 | `/settings/modules/components/LifetimeHistoryModal` | (a) | No Qt counterpart found; memory-lifetime history modal (persisted lifetime history view); backend landed, UI missing; medium | medium |
| 218 | `/settings/modules/components/LifetimeMemoryView` | (a) | No Qt counterpart found; memory-lifetime view component (breadcrumb + change-character); backend landed, UI missing; medium | medium |
| 219 | `/settings/modules/components/LifetimeProvisioningModal` | (a) | No Qt counterpart found; memory-lifetime provisioning modal (consent/provisioning for lifetime cores); backend landed, UI missing; medium | medium |
| 220 | `/settings/modules/components/McpConnectionTestPanel` | (d) | Blocked on MCP lane (MCP connection test panel; airi-mcp landed but Qt bridge/pages not — see #221) | high |
| 221 | `/settings/modules/mcp` | (d) | Blocked on MCP lane; airi-mcp crate (stdio client) landed; no Qt bridge/pages/settings; p-notes: wiring into Qt UI is a separate lane; duplicate of #26 | high |
| 222 | `/settings/providers/free-hub/helpers.test` | (c) | Test file (.test.ts) — Vue test not portable to Qt; 1 of 4 such rows | high |
| 223 | `/settings/providers/free-hub/helpers` | (a) | No Qt counterpart found; free-hub helpers (resolveProviderId platform→provider mapping); part of free-hub gap; small | medium |
| 224 | `/settings/system/connection` | (a) | No Qt counterpart found; shared WS connection form (duplicate of #134); no Qt counterpart | medium |

## 3. Suggested sidecar ticks (NOT applied)

The 43 rows classified **(b)**. To tick them, add these keys (the manifest source paths — exactly as they appear on the `features.md` lines) to `features.ticks.json` (or re-tick by hand); do **not** edit the checkboxes in `features.md` while it stays generator-output with hand ticks:

> **Outcome (main agent, verified):** 10 of the 43 were applied after independent inspection — `settings/index.vue`, `providers/chat/index.vue` (10-line redirect), `airi-card/components/CardEditorForm.vue` / `CardListItem.vue` / `DeleteCardDialog.vue` (Qt card editor/library coverage), `composables/use-desktop-release-checker.ts` (check-only parity), and the four vault rows (`/settings/data/index.vue` + the 3 vault modals — all wired to the real vault backend). The other 33 were **held**, contrary to the audit's suggestion, because inspection showed they are NOT (b) at this port stage: the 23 speech/transcription rows point at per-provider Vue pages (settings form + `SpeechPlayground` + voice list) that have no Qt counterpart at all (Qt `ProvidersPage` is only the generic catalog); `providers/index.vue` (model cache manager + artistry/sync-engine UI) and `/settings/about` (settings-embedded update center) likewise have no Qt counterpart; the 6 static notice/onboarding/widgets scaffolds stay unticked (presentational, host unwired); `settings/system/color-scheme.vue` (preset palettes missing) and the stage-tamagotchi `settings/system/general.vue` (hideAppIcon unported) stay unticked. If the backend-port-as-(b) convention is later accepted as sufficient for those rows, they can be ticked then with the caveat that no settings UI exists.

```
apps/stage-tamagotchi/src/renderer/pages/notice/fade-on-hover.vue
apps/stage-tamagotchi/src/renderer/pages/notice/gemini.vue
apps/stage-tamagotchi/src/renderer/pages/notice/index.vue
apps/stage-tamagotchi/src/renderer/pages/onboarding-v3.vue
apps/stage-tamagotchi/src/renderer/pages/onboarding.vue
apps/stage-tamagotchi/src/renderer/pages/settings/system/general.vue
apps/stage-tamagotchi/src/renderer/pages/widgets.vue
packages/stage-pages/src/pages/settings/about/index.vue
packages/stage-pages/src/pages/settings/data/index.vue
packages/stage-pages/src/pages/settings/index.vue
packages/stage-pages/src/pages/settings/providers/chat/index.vue
packages/stage-pages/src/pages/settings/providers/index.vue
packages/stage-pages/src/pages/settings/providers/speech/airi-audio-server.vue
packages/stage-pages/src/pages/settings/providers/speech/alibaba-cloud-model-studio.vue
packages/stage-pages/src/pages/settings/providers/speech/aws-polly-tts.vue
packages/stage-pages/src/pages/settings/providers/speech/chatterbox.vue
packages/stage-pages/src/pages/settings/providers/speech/comet-api-speech.vue
packages/stage-pages/src/pages/settings/providers/speech/deepgram-tts.vue
packages/stage-pages/src/pages/settings/providers/speech/elevenlabs.vue
packages/stage-pages/src/pages/settings/providers/speech/index-tts-vllm.vue
packages/stage-pages/src/pages/settings/providers/speech/kokoro-local.vue
packages/stage-pages/src/pages/settings/providers/speech/microsoft-speech.vue
packages/stage-pages/src/pages/settings/providers/speech/openai-audio-speech.vue
packages/stage-pages/src/pages/settings/providers/speech/openai-compatible-audio-speech.vue
packages/stage-pages/src/pages/settings/providers/speech/openrouter-audio-speech.vue
packages/stage-pages/src/pages/settings/providers/speech/player2-speech.vue
packages/stage-pages/src/pages/settings/providers/speech/volcengine.vue
packages/stage-pages/src/pages/settings/providers/speech/xai-audio-speech.vue
packages/stage-pages/src/pages/settings/providers/transcription/aliyun-nls-transcription.vue
packages/stage-pages/src/pages/settings/providers/transcription/comet-api-transcription.vue
packages/stage-pages/src/pages/settings/providers/transcription/deepgram-transcription.vue
packages/stage-pages/src/pages/settings/providers/transcription/openai-audio-transcription.vue
packages/stage-pages/src/pages/settings/providers/transcription/openai-compatible-audio-transcription.vue
packages/stage-pages/src/pages/settings/providers/transcription/whisper-local.vue
packages/stage-pages/src/pages/settings/providers/transcription/xai-audio-transcription.vue
packages/stage-pages/src/pages/settings/system/color-scheme.vue
packages/stage-pages/src/pages/settings/airi-card/components/CardEditorForm.vue
packages/stage-pages/src/pages/settings/airi-card/components/CardListItem.vue
packages/stage-pages/src/pages/settings/airi-card/components/DeleteCardDialog.vue
packages/stage-pages/src/pages/settings/composables/use-desktop-release-checker.ts
packages/stage-pages/src/pages/settings/data/components/ExportVaultModal.vue
packages/stage-pages/src/pages/settings/data/components/ImportVaultModal.vue
packages/stage-pages/src/pages/settings/data/components/ScrubHistoryModal.vue
```

Tick-caveats per cluster (read before applying):

1. **Notices / onboarding (6 rows)** — `notice/fade-on-hover`, `notice/gemini`, `notice`, `onboarding-v3`, `onboarding`, `widgets`: the QML ports are **static/presentational** (all actions disabled, first-run state not wired, notice host + widgets bridge deferred). Ticking means "the Qt shell exists", not "the flow works end-to-end". If ticks should mean "user-visible feature done", hold these six.
2. **Speech / transcription providers (23 rows)** — tick means "backend client + registry row ported" (p5-tts.md, p5-stt.md, p9-kokoro, p9-whisper), NOT "settings page exists". There is **no Qt speech/transcription settings surface at all**; one could argue these should wait for that surface. The parity-design calibration explicitly counts backend-port as (b).
3. **Card suite (3 rows)** — `CardEditorForm` (covered minus per-field AI rewrite), `CardListItem`, `DeleteCardDialog`: covered by Qt CardEditorPage/CardLibraryPage. The remaining ~40 airi-card rows are (d).
4. **color-scheme (1 row)** — Qt ThemeSettingsPage covers hue/chroma/dark-mode; the Vue accent-preset palettes (warm/flora/ocean/bloom) are **not** ported. Tick with that caveat or split the row.
5. **`settings/index.vue` (1 row)** — ticking `/settings` (stage-pages) means "SettingsWindow nav subsumes the settings landing", not a 1:1 page port.
6. **Release checker (1 row)** — tick means check+notify parity only (Qt deliberately has no download/install); see p11-parity-design §2.
7. **Vault modals (3 rows)** + `/settings/data` + `settings/index` etc.: vault flows are wired to the real backend (data-lane-backend). Orphan detection, destructive resets, Cloud Sync remain honestly unwired — those manifest rows are (d) or absent, not these.

Validation command (if ever applied): `node apps/airi-qt/scripts/gen-manifest/gen-manifest.mjs` will re-emit all `- [ ]`; ticks must come from the sidecar. Do not run it casually — it wipes hand ticks.

## 4. Actionable backlog — the (a) items, grouped and ordered

Sizes: **S** ≈ ≤1 day, **M** ≈ 2–5 days, **L** ≈ >1 week (incl. testing). "Blocked" (d) items are NOT in this backlog. Recommended order follows the parity-design-cutover framing: **P9-wave-④ module services → P9-wave-⑤ devtools → P10 remainder → cutover**.

### 4.1 P9-wave-④ — Module services UI (backend landed, UI missing) — do first

Backend exists (`airi-core/src/memory/*`, `airi-store` v2–v4, `airi-speech`, `airi-stt`, `airi-laya`); these are settings-surface ports only. All **M** unless noted:

| Item(s) # | Suggested work | Size |
|---|---|---|
| 52 | `/settings/memory` — memory settings page (provider/model, enable, top-k, decay); backend ready | M |
| 66 | memory-short-term page | M |
| 65 | memory-long-term page (journal list, markdown render) | M |
| 64 | memory-lifetime page (wraps LifetimeMemoryView) | M |
| 67 | memory-signals page (per-card signal triggers) | M |
| 70 | `/settings/modules/speech` — TTS/STT provider + voice picker surface; **required before any speech-provider tick means "usable"** | M/L |
| 61 | `/settings/modules/hearing` — mic enable, PTT/auto, hotkey, input device, live level | M |
| 71 | `/settings/modules/system-one` — Laya on/off, model download status (airi-laya state), "System-1" explanation; needs the airi-llm→airi-laya wiring decision (small) or a narrow System1Controller bridge | M |
| 62 | `/settings/modules` — modules landing (catalog grid or nav section) | S/M |
| 218 | LifetimeMemoryView — change-character flow + breadcrumb | M |
| 217 | LifetimeHistoryModal — persisted lifetime history list | M |
| 219 | LifetimeProvisioningModal — consent/provisioning for lifetime cores | M |
| 215 | EntityDetailModal — module entity details (shared) | M |
| 216 | GlobalFacultiesMatrix — faculties/failover defaults matrix | L |
| 57 | beat-sync module page — note: this one is **new work** (no backend in Qt), not just UI; only do if beat-sync is wanted in Qt v1 | M |

≈ 15 rows, mostly M; roughly one focused wave. Cross-cut with the vault/orphan-detection TODO (data lane) — orphan detection is explicitly unwired (`sessions.metadata` has no `characterCardId` linkage in Qt) and would slot naturally into the same wave.

### 4.2 P9-wave-⑤ — Devtools: decide once, globally (user decision, blocks 25 rows)

The devtools family is the single biggest false-positive block (parity-design §4). Recommend **waiving all Qt v1 devtools** ("devtools waived for Qt v1"), which flips all of these to (c) with zero code:

- Stage-tamagotchi (a): 5 `/devtools`, 6 lag-visualizer, 8 performance-visualizer, 9 screen-capture, 10 stage-vfx, 15 vision, 16 widgets-calling.
- Stage-pages (a): 34 beat-sync, 35 context-flow, 36 core-ai-lab, 37 image, 38 markdown-stress, 39 orbital-navigation, 40 plugin-host, 41 providers-transcription-realtime-aliyun-nls, 42 vibrant, 43 websocket-inspector.
- Context-flow non-route (a): 144 actions, 145 entry-card, 146 filters, 147 preview, 148 spark-notify, 149 stream, 151 use-context-flow-formatters, 152 context-flow-types.

**Order:** this is a *decision*, not an engineering wave — put it first on the agenda, it unblocks the count. If the user wants even one devtools page, port `/devtools/index` as a placeholder shell and waive the rest. If ported instead of waived: ~25 × S (each is a small standalone page), plus the knowledge graph (§4.4) is the recurring trap — it is **not** a devtools page and stays (a).

### 4.3 Settings chrome & small surfaces — parallel, independent

All S–M, no cross-deps; safe to run as a batch alongside 4.1:

| # | Item | Size |
|---|---|---|
| 203 | SettingsQuickAccess (quick actions grid) | S |
| 204 | SettingsSearchBar + 211 settings-search-index (static index nav) | S/M |
| 205 | SettingsUpdateBanner (global update banner; pairs with UpdateController work) | S |
| 165 | CardExportDialog + 200 use-card-export (card download-as-file; orthogonal to card-AI wave) | S |
| 226 | `/settings/docs` + 224 docs/[...path] (docs viewer; or waive as "README lives in repo") | M |
| 126 | transcription index page (landing for the ported STT clients) | S |
| 108 | speech index page (landing for the ported TTS clients) — pair with 70 | S |
| 101 | app-local-audio-speech (device-id local audio; **low confidence, re-check before porting**) | S |
| 111 | moss-nano-local local TTS adapter (in-process, like kokoro) | M |
| 116 | pocket-tts-local local TTS adapter | M |
| 131 | `/settings/providers/vision` (vision provider landing; requires a vision stack decision) | M |
| 54 | `/settings/models` (models management: library/explore tabs; Qt has Explore only; Vibrant/captureFrame unported) | M/L |
| 95 | free-hub + 223 free-hub helpers (free-AI catalog browser; or waive as curation-only) | M |
| 50 | dating-sim (experimental; low priority; candidate for waiver) | S/M |

### 4.4 Large greenfields — own lanes, after 4.1–4.3

| # | Item | Size | Notes |
|---|---|---|---|
| 44 | `/knowledge-graph/MindMapExplorer` + 153–159 (7 components) | L | 8 rows; no Qt backend of any kind (no entity ledger in `airi-store`) |
| 56 | artistry module + 75 comfyui + 76 artistry index + 77 nanobanana + 78 pollinations + 79 replicate | L | Needs a provider-breadth decision (Pollinations/Replicate/ComfyUI clients don't exist in Qt) — dovetails with a future artistry wave |
| 55 | agentic-os module | L | Presence/companion/event-log stores; no Qt backend |
| 59 | consciousness module (ConsciousnessWorkspace) | L | No Qt backend |
| 72 | text-to-motion + 97 flowmdm | L | **P10-adjacent** (VRMA/VMD generation); schedule behind or with P10 |
| 73 | vision module | L | Requires vision-stack decision (moondream/blip not in Rust registry) |
| 1 | `/actor` (interactive actor stage) | L | bg/atmosphere, whisper dock, overlays, drag |
| 17 | `/index` (main stage renderer) | L | bg/atmosphere, Live2D/MMD hand-off, VAD loop — overlaps P4/P10/P6 |
| 2 | `/caption` (separate caption window, follow-stage IPC) | M | or explicitly fold into in-stage captions (document as (c)) |
| 3 | `/customizer` (22-button control-strip customizer) | M | StageSettingsPage covers 2 of ~22 ids today |
| 133 | `/settings/stage` — `StageControlEditor` (strip editor) | M | parity-design sample item 10 |
| 132 | `/settings/scene` (backgrounds/atmosphere picker) | M/L | no Qt backgrounds infra (p9-laneB: backgrounds domain = 0) |
| 27 | connection (stage-tamagotchi) + 134 ConnectionSettings + 224 connection (stage-pages) | M | WS URL/auth/TLS/HF token; CORS-bypass half is Electron-only — split it out |

### 4.5 Cutover gates

Cutover prep should treat **all (a) rows as scheduled-or-waived** before the stage-tamagotchi freeze. Sequence: 4.2 decision (0 code) → 4.1 (module services) + 4.3 (chrome) → 4.4 in user-priority order → P10 remainder (MMD blocked (d); text-to-motion behind it) → user sign-off. The 43 (b) ticks (§3) can land immediately after any regeneration that preserves ticks. Nothing here moves the cutover date by itself; what moves it is §4.2's decision and the update-mechanism decision (p11-parity-design §2), both user calls.

## 5. Honest limits, duplicates, and manifest anomalies

**What I could not classify confidently:**

- **#101** `app-local-audio-speech` — only low-confidence (a). It is an odd local path through the hearing store (`speechProviderSettings['app-local-audio-speech'].deviceId`), not a network engine; whether Qt wants it at all is a product call. Re-check before porting.
- **#120/#121** `system1/[providerId]` and `system1/laya-local` — classified (d) (blocked on the System-1 wiring lane) rather than (a)/(b): `airi-laya` landed but `airi-llm` deliberately keeps `laya-local` as `no_chat`/Unsupported, and p9-laya's integration sketch is "deliberately not wired". If the user rules "not wiring System-1 into Qt v1", both become (c).
- **#53** `models/emotions` — (d) with medium confidence. Deferred per p9-card-wave2; if the card-AI wave is cancelled outright, it is either (a) (Emotion Calibration Studio, ~2.5k lines, needs expression-calibration infra Qt does not have) or (c) (waive).
- **#63 / #84** `libp2p` and **#79/#92/#93/#94** `cloud-sync`/cloud providers — all (d) on the sync-engine phase, which nobody has scheduled. If the user declares cloud-sync out of Qt v1 scope entirely, five rows flip to (c).
- **#27/#134/#224** connection pages — MEDIUM (a). The WS/TLS/HF-token half is plausibly portable; the CORS-bypass half is Electron-only and must be split before estimating. The manifest gives no signal whether any lane wants this; I assumed "port (a)" but a waiver is defensible.
- **#45** `/settings/about` — (b) medium: Qt's About is a standalone window, not a settings section; ticking means "about surface exists", not "same UX".
- **All "(b) backend-done" speech/transcription rows (23 rows)** — token acquisition for Aliyun (#122) is explicitly out of scope (needs pre-issued token), Polly signature is self-graded/never live-verified (#102), and Kokoro is `TtsStatus::Partial` (espeak-ng dependent). "Ported" ≠ "battle-tested".
- I kept the speech-provider rows as plain (b) per the parity-design note's own calibration (backend port counts as done; the settings surface is a separate (a) row, #108), rather than the split-class treatment the note mentions in sample item 9. The 45-row LLM registry count was re-verified in-tree (`grep -c 'def("' registry.rs` = 45).

**Duplicates / anomalies in the manifest (4 exact dup rows + 2 same-route rows):**

1. `/settings/modules/mcp` — appears twice: **#26** (stage-tamagotchi) and **#221** (stage-pages). Both (d). The generator emits the stage-pages copy because `electron.vite.config.ts` excludes `settings/modules/mcp.vue` but the generator doesn't — see p11-parity-design §1.3.
2. `/settings/system/connection` — twice: **#27** (stage-tamagotchi) and **#224** (stage-pages), both (a)-medium. Plus **#134** `ConnectionSettings.vue`, the shared form both render — a third, distinct row for the same logical surface.
3. `/v2/settings` — twice: **#138** (`v2/settings.vue`) and **#139** (`v2/settings/index.vue`), same route name, both (c).
4. `/v2/settings/providers` — twice: **#140** (`v2/settings/providers.vue`) and **#143** (`v2/settings/providers/index.vue`), both (c). (Also `v2/settings/providers/edit` #141 and `…/edit/[providerId]` #142 — distinct from the dup pair.)
5. `/settings/system/index` — twice: **#31** (stage-tamagotchi) and **#136** (stage-pages), both (c) — the four "explicit route exclusions" from the electron config appear as stage-pages copies, exactly as the parity note describes (§1.3).
6. Tick asymmetry: stage-tamagotchi `/settings/system/general` is unchecked (#30, classified (b)) while the stage-pages `general.vue` is ticked — same logical page, inconsistent state; the electron-excluded copy is the checked one.
7. Route-count inflation confirmed: 82 of 224 (37%) are non-route files (components/composables/tests/plain `.ts`). Of the "plain `.ts`" rows the parity note says there are 14 — correct: #151, #152, #199, #200, #201, #202, #207, #211, #212, #223 (10) plus the 4 test files (#150 `.test.ts`, #198 `.test.ts`, #206 `.spec.ts`, #222 `.test.ts`). **The mission brief said "3 `.test.ts` files" — there are 4 test-convention rows, one of which is `.spec.ts`, not `.test.ts`.** I still classified all 4 as (c).
8. `.ts` rows the generator counts as "routes" are never auto-routable (`.ts` never routes) — 18 of the 224 rows are not pages at all in any sense.
9. `/settings/system/window-shortcuts` (#32) is dead upstream — the entire `<script setup>` is commented out in the Vue source; (c) is honest but the row is arguably generator noise.
10. `/dashboard` (#4) is an empty stub `<div>Dashboard</div>`; `/settings/providers/motion` (#98) is a redirect stub to `#motion`. Both (c).

**Counting cross-check:** 234 total = 224 unchecked + 10 ticked ✓. 142 unchecked routes + 82 unchecked non-routes ✓ (all 10 ticks are routes). 152 routes header vs 37+115=152 ✓; 37+115+82=234 ✓.

**What this audit deliberately did NOT decide** (user calls, per p11-parity-design §6): whether devtools are ported or waived (§4.2); whether the airi-card suite is scheduled or dropped (37 (d) rows + #53); whether cloud-sync/libp2p exist in Qt v1 at all (5 rows); the update-mechanism parity decision; cutover itself; the generator/sidecar fix (this audit did not regenerate anything — tick state still lives only in `features.ticks.json`, and the 10 hand ticks in `features.md` remain the only manifest of record).

**Bottom line.** If the user (i) applies §3's 43 ticks, (ii) waives devtools per §4.2, (iii) waives or schedules the card-AI suite and cloud-sync explicitly, and (iv) schedules §4.1–4.3, then `features.md` (after a generator re-emit + sidecar re-apply) can plausibly reach zero-unchecked before cutover with only the large greenfields (knowledge graph, artistry, vision, consciousness, agentic-os, stage/renderer) and P10/MMD left as honestly-undone, user-acknowledged gaps.
