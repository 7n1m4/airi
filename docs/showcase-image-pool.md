# AIRI Showcase Image Pool & Catalog

This catalog tracks all ingested showcase screenshots, semantic filenames, resolutions, and target presentation roles across the documentation.

---

## Pool Directory
All assets are stored in:
`docs/content/public/showcase/` (accessible in VitePress via `/showcase/<filename>`)

---

## Ingested Image Catalog

### Hero 01: Settings Hub & The Engine Room
*Theme: The root foundation of Project AIRI. Hierarchical settings topology, quick-action ribbon, responsive window adaptation, accent theming, and architectural evolution.*

| Semantic File | Dimensions | Size | Description & Presentation Role |
| :--- | :---: | :---: | :--- |
| `hero-01-settings-hub.avif` | 1024 × 626 | 16 KB | **Primary Hero Banner** for `index.md` card and `01-settings-hub.md` header. Shows full landscape desktop workstation: left sidebar, `⌘K` search bar, 10-item Quick Access matrix, and categorical clusters. |
| `hero-01-settings-hub-landscape.avif` | 1024 × 626 | 16 KB | Same as above; standalone semantic reference for landscape desktop mode. |
| `hero-01-settings-hub-portrait.avif` | 799 × 1024 | 20 KB | **Responsive Companion Mode.** Shows the Settings window dynamically collapsed into a compact vertical companion window. Used in the "Responsive Window Modes" section. |
| `hero-01-settings-hub-palette.avif` | 799 × 1024 | 20 KB | **Accent Palette Engine.** Shows the open 24-color accent palette popover, demonstrating theme personalization and dynamic color token injection. |
| `hero-01-settings-hub-upstream.avif` | 1024 × 586 | 8 KB | **Upstream Baseline Comparison.** Shows the original flat, single-tier vertical list in upstream `moeru-ai/airi`. Used in the "Architectural Evolution" side-by-side comparison section. |
| `settings-inference-providers-deck.avif` | 1024 × 623 | 27 KB | **Inference Providers Discovery Deck.** Full categorized provider management: tabs (`Chat`, `Speech`, `Transcription`, `Artistry`, `Vision`, `Motion`, `Cloud & Storage`), Pricing filters (`All`, `Free`, `Paid`), Deployment filters (`Local`, `Cloud`), and curated cards for local WebGPU (RWKV, WebLLM, Moondream2) and cloud providers. |
| `settings-modules-resilient-fallbacks.avif` | 1024 × 623 | 29 KB | **Global Faculties & Resilient Fallbacks Engine.** Central intelligence connector hub with live circuit breakers, auto-failover chains across 5 faculties (Mind, Speech, Hearing, Artistry, Vision), factory-safe resets, and simulated 429/quota outage testing. |
| `settings-speech-voice-playground.avif` | 1024 × 623 | 20 KB | **Speech & Voice Playground Deck.** Interactive voice testing sandbox with live speech synthesis auditioning, custom SSML support, provider switching (Audio Studio, Kokoro TTS), and virtual voice profile generation. |
| `settings-system-preferences-menu.avif` | 1024 × 623 | 17 KB | **System Preferences Hub.** Comprehensive system controls: Connection & Downloads (HuggingFace credentials, server gateways), User Profile & Identity (callsign, companion relationship, voice clone samples), General Preferences, Color Schemes, and Chat Input defaults. |
| `settings-data-management-cloud-backup.avif` | 1024 × 623 | 20 KB | **Data Management & S3 Cloud Backup.** Granular local-first data lifecycle management: export/import for Chat sessions, Characters, Memory & Journal, and Backgrounds; automated S3 cloud backups; and **Orphaned Sessions Maintenance** to restore or clean chat logs from deleted characters. |
| `settings-in-app-documentation-viewer.avif` | 1024 × 623 | 24 KB | **In-App Interactive Documentation Viewer.** Embedded offline-capable documentation browser inside AIRI settings with section tabs (`OVERVIEW`, `SHOWCASE`, `MANUAL`, `CHRONICLES`), deep-linked sidebar, and instant multi-lingual locale switching (`EN`, `ZH`, `JA`). |

### Hero 02: AIRI Card Character System
*Theme: Multi-tab character management, SillyTavern CCv2 PNG compatibility, in-app Electron webview card browsing, and guided import adaptation.*

| Semantic File | Dimensions | Size | Description & Presentation Role |
| :--- | :---: | :---: | :--- |
| `hero-02-card-system.avif`<br>`(hero-01-card-system.avif)` | 1024 × 626 | 55 KB | **Primary Hero Banner** for Card System showcase card & page header. Shows the full 4-column card gallery with custom portraits, per-card action bars (Edit, Export, Snapshot, Duplicate, Favorite, Delete), and sidebar. |
| `card-system-gallery-grid.avif` | 1024 × 626 | 55 KB | Same as above; standalone semantic reference for the Card Gallery. |
| `card-system-community-hubs.avif` | 1024 × 626 | 25 KB | **External Community Hubs.** Shows native import compatibility with JannyAI, JanitorAI, Chub AI, Risu Realm, and DataCat with explanation of SillyTavern `chara_card_v2` PNG mapping. |
| `card-system-inapp-webview.avif` | 1024 × 626 | 54 KB | **In-App Electron Webview Browser.** Shows native embedded webview browsing DataCat inside AIRI for 1-click card discovery and downloads without opening an external browser. |
| `card-system-import-wizard.avif` | 1024 × 626 | 15 KB | **Card Import Interceptor Modal.** Step 1 of 5 configuring an imported companion ("Helena"): name override, required user name binding ("Richie"), greetings preview, and persona context extraction. |
| `card-editor-tab-identity.avif` | 1024 × 623 | 37 KB | **Card Editor: Identity Tab.** Multi-field character identity editing with `<|ACTOR:...|>` token bindings, personality, dynamic scenario, and AI suggestion triggers (`✨`). |
| `card-editor-tab-generation.avif` | 1024 × 623 | 27 KB | **Card Editor: Generation Tab.** Per-card LLM response overrides: reasoning fallback on empty speech, provider/model selector, temperature, token ceilings, and context compaction thresholds. |
| `card-editor-tab-acting-pacing.avif` | 1024 × 623 | 27 KB | **Card Editor: Acting & Pacing Tab.** Fine-grained performance controls: conversational pacing toggles, thinking fillers, Snappy/Balanced/Deep CoT profile presets, and spoken mannerism prompts. |
| `card-editor-tab-modules.avif` | 1024 × 623 | 22 KB | **Card Editor: Modules Tab.** Per-card faculty bindings: primary consciousness LLM, voice profile, 3D VRM model binding (`Mambo`), scene background, and deep links to Studio multi-actor visual assets. |
| `card-editor-tab-artistry-director.avif` | 1024 × 623 | 21 KB | **Card Editor: Artistry & Director Tab.** Autonomous image director settings: Cinematic Autonomy toggle, manifestation sensitivity threshold slider (`23%`), context evaluation history depth, and desktop/discord director notes. |
| `card-editor-proactivity-operating-schedule.avif` | 1024 × 623 | 24 KB | **Card Editor: Proactivity Schedule Tab.** Circadian operating rhythm (Wake up `09:00 AM`, Bedtime `10:00 PM`), subsystem quiet hours suppression, and AFK / user idle presence gating (5-min inactivity threshold). |
| `card-editor-proactivity-heartbeats.avif` | 1024 × 623 | 21 KB | **Card Editor: Proactivity Heartbeats Tab.** Ambient Pull periodic evaluation interval (`5m`), stealth heartbeat prompt injection, and `NO_REPLY` silent sentinel contract. |
| `card-editor-proactivity-screen-watching.avif` | 1024 × 623 | 24 KB | **Card Editor: Screen Watching Tab.** Autonomous perception ticker settings: Reaction delivery mode (Voice & Bubble, Silent Gaming Bubble, Voice Only, Muted), full monitor / virtual screen scope, 2000ms capture intervals, and zero-cost salience gating. |
| `card-editor-proactivity-24h-memory.avif` | 1024 × 623 | 21 KB | **Card Editor: 24h Memory Tab.** 24-hour short-term memory consolidation toggle, 3-day rolling window, 1000-token daily compression budget, and Flat Universe Isolation. |
| `card-editor-tab-tools-capability-packs.avif` | 1024 × 623 | 24 KB | **Card Editor: Tools Tab.** Progressive capability pack toggles: Web & Research Pack (`open-websearch`), Local Workspace & Filesystem Pack (Desktop MCP `@modelcontextprotocol/server-filesystem`), and Visual Artistry & Studio Pack (`image_journal`). |

### Hero 03: AnimaDex Synthesis Wizard
*Theme: Guided character-card creation from scratch with character database exploration, fuzzy auto-tagging, multi-actor alignment, and AI roleplay world generation.*

| Semantic File | Dimensions | Size | Description & Presentation Role |
| :--- | :---: | :---: | :--- |
| `hero-03-animadex-wizard.avif`<br>`(hero-02-animadex-wizard.avif)` | 1024 × 626 | 32 KB | **Primary Hero Banner** for AnimaDex showcase card & page header. Shows the full 12-character Cast selection grid with series filters (`Tag: touhou`), gender filter pills, and `Bound (179)` tracker. |
| `animadex-cast-gallery.avif` | 1024 × 626 | 32 KB | Same as above; standalone semantic reference for the Cast exploration gallery. |
| `animadex-search-autocomplete.avif` | 1024 × 561 | 18 KB | **Fuzzy Tag & Character Autocomplete.** Shows the search dropdown querying `"neuro"` with instant tag suggestions, series badges (`Majin Tantei Nougami Neuro`), and character completions (`Evil Neuro-sama`, `Neuro-sama`, `Neuro-sama (Dog)`). |
| `animadex-custom-character-modal.avif` | 917 × 1024 | 26 KB | **Add Custom Character Modal.** Shows manual character entry: Copyright/Series, Character Name, prompt Generation Trigger tags, and visual modifier tags with image picker. |
| `animadex-actor-alignment.avif` | 1024 × 642 | 13 KB | **Actor Alignment & Multi-Cast Roster.** Step 2 of the wizard showing cast members (`Evil Neuro-sama` and `Neuro-sama`), 3D model binding, TTS voice assignment, and the `Auto-Assign Voices & Motions` button. |
| `animadex-story-generator.avif` | 1024 × 626 | 22 KB | **AI Story & Persona Synthesis.** Step 3 of the wizard showing the 11 trope presets (Desktop Companion, Slice of Life, Isekai, etc.), custom scenario guidance, user persona / prose description, SD image tags, and LLM provider indicator (`opencode-go / deepseek-v4-flash`). |

### Hero 04: Avatars & Model Customizer
*Theme: Multi-engine avatar runtimes (VRM, Live2D, Spine, MMD), dense model library browsing, cloud model repository, 3D coverflow carousel, motion triggering, and AI expression curation.*

| Semantic File | Dimensions | Size | Description & Presentation Role |
| :--- | :---: | :---: | :--- |
| `hero-04-model-selector.avif`<br>`(hero-03-model-selector.avif)` | 1024 × 626 | 41 KB | **Primary Hero Banner** for Model Selector showcase card & page header. Shows the dense 6-column model browser with Live2D, VRM, and Spine format badges, tags, groups, and sorting. |
| `model-selector-grid.avif` | 1024 × 626 | 41 KB | Same as above; standalone semantic reference for the local model library grid. |
| `model-selector-coverflow.avif` | 1024 × 626 | 24 KB | **3D Coverflow Perspective Carousel.** The flashy 3D perspective coverflow mode showcasing models with left/right carousel arrows and active model badge. |
| `model-selector-cloud-catalog.avif` | 1024 × 626 | 41 KB | **Integrated Cloud Model Repository.** Shows the 97-item online model catalog with 1-click cloud downloading across franchises (Hololive, Umamusume, Blue Archive, etc.). |
| `model-customizer-motions-spine.avif` | 1024 × 626 | 19 KB | **Spine 2D Runtime & Motion Triggering.** Live viewport rendering an animated Spine avatar (Butter) with motion list (`Motions (43)`), toast notification (`Triggered motion: Angry_2`), and format indicator. |
| `model-customizer-ai-curation.avif` | 1024 × 626 | 22 KB | **AI Expression & Morph Curation.** Shows the "AI Expression Curation" banner with the `Auto-Curate (AI)` button to automatically translate foreign blendshapes into ACT tokens. |
| `model-customizer-vfx-auras.avif` | 1024 × 626 | 32 KB | **Emotion- & Dialogue-Triggered Procedural Auras/VFX.** Shows the 4 elemental VFX archetypes (Fire, Electric, Magic, Verdant), `<|ACT:vfx="fire"|>` token bindings, emotion keyword mapping, and live bone-tethered flame auras & embers rendering on the VRM avatar. |
| `model-customizer-vhack-texture-deck.avif` | 1024 × 626 | 26 KB | **V-HACK Inspector & Texture Deck.** Real-time in-app texture atlas modding, material inspection, mouse tracking calibration, and dynamic UI theme color extraction from avatar textures. |

### Hero 06: Desktop Embodiment & Control Strip
*Theme: Decoupled companion stage, floating glassmorphic Control Strip ribbon, docked screen-edge states, real-time stage view orchestration, customizer drag-and-drop tuning, and lifetime usage analytics.*

| Semantic File | Dimensions | Size | Description & Presentation Role |
| :--- | :---: | :---: | :--- |
| `hero-06-control-strip.avif`<br>`(control-customizer-stage-view.avif)` | 1024 × 813 | 29 KB | **Primary Hero Banner** for Control Strip showcase card & page header. Shows the **Control Customizer** floating studio: left navigation, Stage View controls (Stage Theme, Actor Stage, Stage Mate, Always-on-Top, Tactile Mode, Drag Mode, Positioning Mode) with instant reactive STRIP toggles, ACTIVE/MUTED status badges, and `Live Synced View` model binding. |
| `control-strip-vertical-ribbon.avif` | 106 × 1024 | 11 KB | **Full Customized Floating Ribbon.** Live 16-button vertical Control Strip with custom tinted glassmorphic pill theme (`#3A85CBFF`), chevron expander, and reactive status dots (green, red, yellow, pink) for instant desktop companion interaction. |
| `control-strip-docked-corner.avif` | 232 × 226 | 2.1 KB | **Screen-Edge Tucked / Docked State.** Shows the minimalist edge-docked tab tucked into the top-left corner under macOS Finder menu bar, proving non-intrusive companion presence. |
| `control-customizer-stage-view.avif` | 1024 × 813 | 29 KB | Same as banner; standalone semantic reference for Stage View interaction modes and coordinate controls. |
| `control-customizer-preview-tuning.avif` | 1024 × 813 | 23 KB | **Live Mockup & Drag-to-Reorder Strip.** Shows the Preview & Tuning deck: live horizontal preview strip, drag-and-drop icon reordering, ACTIVE BUTTONS removal list, and 6-color THEME & TINT palette selector. |
| `control-customizer-usage-stats.avif` | 1024 × 813 | 22 KB | **Control Customizer Usage Stats Deck.** Lifetime LLM metrics inspection: Inference Tokens (`120,028,954`), Voice Tokens (`95,457`), Total Tokens (`120,124,411`), and Report Controls (Time Period, Time Slices, Generate Report Now). |
| `control-strip-popover-theme-atmosphere.avif` | 438 × 1024 | 21 KB | **Theme & Atmosphere Popover.** Fast stage/chatbox ambience tuning: animated atmosphere particles (`None`, `Hearts`, `Sakura`, `Stars`, `Bubbles`, `Crosses`, `Melody`) and live wallpaper scene switcher. |
| `control-strip-popover-stage-layout.avif` | 438 × 1024 | 12 KB | **Stage Layout & Presets Popover.** Quick stage sizing (`Mini`, `Medium`, `Large`, `Full`), Dating Sim mode toggle, and 9-directional screen anchor positioning matrix. |
| `control-strip-popover-characters.avif` | 438 × 1024 | 21 KB | **Characters Quick Switcher Popover.** 122-character instant switcher with quick-access starred favorites, full search autocomplete, and deep-links to Gallery, Edit, and Cards. |
| `control-strip-popover-avatars.avif` | 438 × 1024 | 23 KB | **Avatars Quick Switcher Popover.** Format-aware model browser (`VRM`, `Live2D`, `Spine`, `MMD`) with instant Preview and Apply to Character actions. |
| `settings-floating-controls-manager.avif` | 1024 × 623 | 14 KB | **Floating Controls Settings Manager.** The unified in-settings strip configurator used across web-stage, pocket-stage, and desktop: slot ordering, active slot limits (16 active), reset defaults, and quick slot pruning. |

### Hero 07: 3-Column Chat Workspace & Grounding
*Theme: Powerhouse 3-column interaction workspace, pre-flight grounding inspection, unified journal feed, limits & telemetry popover, daily recap memory modals, quick model favorites, and arcade room gaming.*

| Semantic File | Dimensions | Size | Description & Presentation Role |
| :--- | :---: | :---: | :--- |
| `hero-07-chatbox-workspace.avif`<br>`(hero-05-chatbox-redesign.avif)` | 1024 × 626 | 46 KB | **Primary Hero Banner** for Chatbox showcase card & page header. The full 3-column powerhouse workspace: left navigation rail, `<|ACTOR:...|>` token performance transcript, horizontal Media Gallery carousel (12+ generated images), **PRE-FLIGHT GROUNDING ACTIVE** panel (STMM + RAW memory inspection), and the **Limits & Telemetry** popover (context threshold, response token limit, live TTFT/handoff latency). |
| `chatbox-workspace-full.avif` | 1024 × 626 | 46 KB | Same as above; standalone semantic reference for the 3-column desktop workspace. |
| `chatbox-daily-recap-modal.avif` | 1024 × 626 | 26 KB | **Daily Recap & Short-Term Memory Modal.** Shows the persona-driven recap card (`2026-07-24 — Beach Field Trip Day`) with event summary and chronological key event highlights. |
| `chatbox-arcade-gaming-backseat.avif` | 1024 × 626 | 31 KB | **Arcade Room: Companion Gaming Runtime.** SimCity (1989) running in DOSBox WASM with live AI companion backseating, spectating commentary, and quick backseat action chips. |
| `chatbox-context-injections-menu.avif` | 497 × 1024 | 47 KB | **Context Injections & Runtime Toggles Menu.** Shows runtime gates: Heartbeats, Screen Watching, Dreams, Visual Novel mode, Image Spawn Mode (`Background` / `Widget` / `Inline`), Chat Layout (`Mini`, `Med.`, `Large`, `Full`), RAG, and Salience Gating. |
| `chatbox-model-favorites-picker.avif` | 820 × 824 | 17 KB | **Quick Model & Provider Switcher Popover.** Fast 1-click model switching between saved favorites (`mori-v3 (deepseek-v4-flash)`, `Sakamata Chloe (gemini-2.5-flash)`). |
| `chatbox-minimal-single-column.avif` | 1024 × 876 | 45 KB | **Distraction-Free Minimalist Mode & Screen Attachment.** Single-column focused chat mode with sidebars collapsed, showing the "Attach Image" popover with 1-click "Take Screenshot" screen perception capture. |
| `chatbox-event-ledger.avif` | 1024 × 626 | 16 KB | **AIRI Event Ledger (Production Log).** Unified cognitive audit trail and streaming awareness stream under Workspace -> Recall. Shows real-time event filtering (`All`, `Vision`, `Tools`, `Chat`, `Proactivity`, `Memory`, `Stage`, `Discord`), natural language event search, and timestamped activity history. |
| `producer-prompt-modal.avif` | 1011 × 1024 | 33 KB | **Prompt the Producer (Producer Lite / Suggestion Engine).** Modal showing tone/style instructions (*teasing, vulnerable*), suggestions count slider, audio preview toggles, and Cache-Aligned Full Context. |
| `producer-directives-live-chat.avif` | 1011 × 1024 | 45 KB | **Producer Directives in Live Roleplay.** In-flight roleplay response suggestions with Director Grade `82/100` and 1-click directive injection into the active composer. |
| `memory-context-popover.avif` | 1011 × 1024 | 48 KB | **Memory & Rolling Context Popover.** System Prompt inspector, natural language memory search, Short-Term Memory rolling cache (Last 3 Days status, Today cache, Rebuild session). |

### Hero 08: Situational Awareness & Pacing
*Theme: Desktop perception, continuous VLM screen watching, OS sensors, circadian schedules, ambient heartbeats, interactive perception simulators, and conversational spoken fillers.*

| Semantic File | Dimensions | Size | Description & Presentation Role |
| :--- | :---: | :---: | :--- |
| `hero-08-situational-awareness.avif`<br>`(card-editor-proactivity-screen-watching.avif)` | 1024 × 623 | 24 KB | **Primary Hero Banner** for Situational Awareness showcase card & page header. Shows the **Screen Watching** (Autonomous Perception Ticker) engine: Reaction Delivery Mode (`Voice & Bubble`, `Bubble Only (Silent Gaming)`, `Voice Only`, `Muted`), capture scope (`Displays / Virtual Screen`), 2000ms intervals, and the **Attention Ecology Guard** (Lightweight WASM OCR + CLIP vs Premium Moondream2 Local WebGPU VLM). |
| `card-editor-proactivity-screen-watching.avif` | 1024 × 623 | 24 KB | Same as banner; standalone semantic reference for screen perception. |
| `card-editor-proactivity-heartbeats.avif` | 1024 × 623 | 21 KB | **Proactive Heartbeats & Ambient Pull.** Periodic evaluation intervals (`5m`), stealth heartbeat prompt injection, and the `NO_REPLY` silent sentinel contract. |
| `card-editor-proactivity-operating-schedule.avif` | 1024 × 623 | 24 KB | **Operating Schedule & Bedtime Gating.** Circadian rhythm configuration (`09:00 AM` to `10:00 PM`), subsystem quiet hours suppression, and AFK presence gating (`5 min` continuous inactivity threshold). |
| `settings-vision-simulator-interactive.avif` | 1024 × 623 | 29 KB | **Vision Perception (VLM) & 1-Hop Simulator Deck.** Interactive vision testing environment: Waifu Diffusion Tagger (WD) and Moondream2 VLM provider selection, SwinV2 model tagging, character stand-in prompt directives, and live drop-zone interaction simulator. |
| `pacing-audio-fillers.avif` | 1024 × 623 | 27 KB | **Conversational Pacing & Thinking Fillers Engine.** Audio filler profile presets (`Snappy Chat` 2-5s TTFT, `Balanced` 10-25s CoT, `Deep CoT Explorer` 40-90s CoT for reasoning models like DeepSeek-R1 / Kimi k3), timing budgets, and spoken mannerisms prompt injection. |

### Hero 09: Production Studio & Autonomous Artistry
*Theme: Autonomous scene direction, concept stacks (Base/Layer), Director decision logs, branching story timelines, persistent Scene Vault, and multi-actor staging.*

| Semantic File | Dimensions | Size | Description & Presentation Role |
| :--- | :---: | :---: | :--- |
| `hero-09-artistry-studio.avif`<br>`(studio-directors-monitor.avif)` | 1024 × 626 | 51 KB | **Primary Hero Banner** for Artistry & Studio showcase card & page header. Shows the **Director's Monitor** session timeline: narrative pacing coefficients, tension gauge (`82/100`), multi-actor manifestation tags (`PLACE_ALT_2`, `ACTOR_OSHINO_SHINOBU`, `ACTOR_ONONOKI_YOTSUGI`, `ACTOR_MR_SQUEAKS_HAKOS_BAELZ`), full GENERATION PROMPT box, and live visual state board. |
| `studio-directors-monitor.avif` | 1024 × 626 | 51 KB | Same as above; standalone semantic reference for Director's Monitor. |
| `studio-scene-vault.avif` | 1024 × 626 | 74 KB | **Scene Vault (Generated Art & Selfie History).** 4×2 visual gallery displaying generated story illustrations across persistent universes and story arcs (`butter-world > Beach School Trip`) with episode cards and metadata overlays. |
| `studio-stage-directives-world-bible.avif` | 1024 × 626 | 17 KB | **Stage Directives & World Bible.** Prompt builder inspection showing structured field composition, cast roster enforcement, and active `<|ACTOR:...|>` costume/outfit token bindings (`actor_kommy_lounge`, `actor_kommy_swim`, `actor_kommy_schoolgirl`, etc.). |
| `studio-timelines-and-visual-state.avif` | 1011 × 1024 | 52 KB | **Branching Story Timelines & Visual State Board.** Shows the `STORY TIMELINES` branching universe switcher (Happy Ending, Timeline 6, etc.), Director's Grade `82/100`, persistent `VISUAL STATE BOARD`, and multi-actor manifestation tags. |
| `settings-artistry-live-studio-canvas.avif` | 1024 × 623 | 23 KB | **Artistry & Image Studio Live Studio Canvas.** Global generation engine config (Pollinations AI, ComfyUI Local, Nano Banana Google AI Studio, Replicate.ai), 6 preset inspiration prompts (Anime Teahouse, Cyberpunk Shinjuku, Ghibli Meadow, etc.), and live preview canvas. |
| `studio-director-sensitivity-controls.avif` | 1024 × 623 | 21 KB | **Autonomous Director Fine-Tuning Deck.** Card-level cinematic autonomy controls: manifestation sensitivity threshold slider (`23%`), evaluation target (`User Input`), context history depth (`3 turns`), and desktop/discord director grading notes. |

### Hero 10: Discord Gateway & Connected Surfaces
*Theme: Dual execution targets (Local Desktop Gateway vs Cloudflare Workers 24/7 Edge Relay), multi-channel context routing, VLM image intake, and automated edge deployment.*

| Semantic File | Dimensions | Size | Description & Presentation Role |
| :--- | :---: | :---: | :--- |
| `hero-10-discord-surfaces.avif`<br>`(discord-bot-connection.avif)` | 1024 × 623 | 20 KB | **Primary Hero Banner** for Discord Gateway showcase card & page header. Shows the **Discord Bot Connection & Orchestration Deck**: Execution Target Mode (`Local (This PC)` vs `Cloud Relay`), live Gateway service controls, Bot Token configuration, Owner Username bindings (`dasilva333`), Vision / VLM Image Intake toggle, Direct Message handling, and the in-app interactive "Simulate Message" test sandbox. |
| `discord-bot-connection.avif` | 1024 × 623 | 20 KB | Same as above; standalone semantic reference for the Discord Bot Connection tab. |
| `discord-cloud-relay-studio.avif` | 1024 × 623 | 18 KB | **Cloud Relay Studio & Cloudflare Edge Engine.** 24/7 cloud deployment surface: OAuth authentication status, KV Memory Window Mode (`Fixed Window` vs `Unlimited Deep Coherence`), 1-click `Deploy Character to Cloudflare Edge` action button, and live Active Instances dashboard (`Airi Moriv LIVE`, custom `workers.dev` endpoint, deployed timestamp, memory sync, and teardown controls). |
| `discord-access-routing-table.avif` | 1024 × 623 | 21 KB | **Access & Context Routing Table.** Multi-channel routing and access control: Global Fallback Mode (`Strict (Deny Unassigned)`, `Shared Fallback Character`, `Isolated Memory Fallback`), and channel mapping matrix (`channel-123456789 #lounge`, `dm-987654321 Direct Message`) with target character assignment and trigger modes (`Mentions & Direct Messages` vs `All Channel Messages`). |
| `discord-cloudflare-deploy-modal.avif` | 1024 × 623 | 11 KB | **Edge Deployment: Session Selection Modal (Step 1).** Step 1 of deploying a character to Cloudflare Edge: chat session history binding selector, allowing the user to select which active local conversation timeline seeds the 24/7 edge memory. |
| `discord-cloudflare-config-modal.avif` | 1024 × 623 | 17 KB | **Edge Deployment: Configuration & System Prompt Modal (Step 2).** Step 2 of deploying a character: Cloudflare Workers root subdomain handle (`richie.workers.dev`), Edge LLM Provider & Model selector (`deepseek-v4-pro`), conversation history seeding radio (`System Prompt Only` vs `All Session History`), and full assembled system prompt preview with live character persona and Discord formatting directives. |

---

## Upcoming Hero Slots (Pending Ingestion)

| Slot | Hero Name | Planned Core Surfaces | Target Semantic Filenames | Status |
| :---: | :--- | :--- | :--- | :---: |
| **01** | **Settings Hub & The Engine Room** | RippleGrid hub, 10 quick-action shortcuts, responsive modes, accent palette, upstream comparison, provider discovery, resilient fallbacks, voice playground, system preferences, data management & S3 backup, and in-app documentation viewer. | `hero-01-settings-hub.avif`<br>`hero-01-settings-hub-portrait.avif`<br>`hero-01-settings-hub-palette.avif`<br>`hero-01-settings-hub-upstream.avif`<br>`settings-inference-providers-deck.avif`<br>`settings-modules-resilient-fallbacks.avif`<br>`settings-speech-voice-playground.avif`<br>`settings-system-preferences-menu.avif`<br>`settings-data-management-cloud-backup.avif`<br>`settings-in-app-documentation-viewer.avif` | ✅ **Complete (11 assets)** |
| **02** | **AIRI Card Character System** | Multi-tab editor (Identity, Generation, Acting/Pacing, Modules, Artistry/Director, Schedule, Heartbeats, Screen Watching, 24h Memory, Tools), SillyTavern PNG import/export, portable bundling. | `hero-02-card-system.avif`<br>`card-system-community-hubs.avif`<br>`card-system-inapp-webview.avif`<br>`card-system-import-wizard.avif`<br>`card-editor-tab-identity.avif`<br>`card-editor-tab-generation.avif`<br>`card-editor-tab-acting-pacing.avif`<br>`card-editor-tab-modules.avif`<br>`card-editor-tab-artistry-director.avif`<br>`card-editor-proactivity-operating-schedule.avif`<br>`card-editor-proactivity-heartbeats.avif`<br>`card-editor-proactivity-screen-watching.avif`<br>`card-editor-proactivity-24h-memory.avif`<br>`card-editor-tab-tools-capability-packs.avif` | ✅ **Complete (14 assets)** |
| **03** | **AnimaDex Synthesis Wizard** | Multi-step guided card wizard, AI story suggestions, WD14 auto-tagging, voice auto-assignment. | `hero-03-animadex-wizard.avif`<br>`animadex-search-autocomplete.avif`<br>`animadex-custom-character-modal.avif`<br>`animadex-actor-alignment.avif`<br>`animadex-story-generator.avif` | ✅ **Complete (5 assets)** |
| **04** | **Avatars & Model Customizer** | 6-column dense browser, 3D coverflow, 97-model cloud catalog, Spine 2D runtime, AI expression curation, procedural VRM VFX & auras, V-HACK texture deck. | `hero-04-model-selector.avif`<br>`model-selector-coverflow.avif`<br>`model-selector-cloud-catalog.avif`<br>`model-customizer-motions-spine.avif`<br>`model-customizer-ai-curation.avif`<br>`model-customizer-vfx-auras.avif`<br>`model-customizer-vhack-texture-deck.avif` | ✅ **Complete (7 assets)** |
| **05** | **Live2D Interactive Runtime & DSL** | Gimmick Deck, discovered switches, runtime costume swaps, state variables, branching dialogue scripts. | `live2d-gimmick-deck.avif`<br>`live2d-costume-swap.avif` | ⏳ Pending |
| **06** | **Desktop Embodiment & Control Strip** | Decoupled stage window, floating glassmorphic Control Strip ribbon, docked corner tab, Control Customizer, drag-and-drop tuning deck, usage stats, 4 tethered popovers, and cross-platform Floating Controls manager. | `hero-06-control-strip.avif`<br>`control-strip-vertical-ribbon.avif`<br>`control-strip-docked-corner.avif`<br>`control-customizer-preview-tuning.avif`<br>`control-customizer-usage-stats.avif`<br>`control-strip-popover-theme-atmosphere.avif`<br>`control-strip-popover-stage-layout.avif`<br>`control-strip-popover-characters.avif`<br>`control-strip-popover-avatars.avif`<br>`settings-floating-controls-manager.avif` | ✅ **Complete (10 assets)** |
| **07** | **3-Column Chat Workspace & Grounding** | 3-column workspace, pre-flight grounding panel, limits & telemetry popover, daily recap modal, context toggles, arcade backseat gaming, minimal single-column mode, memory rolling cache, event ledger. | `hero-07-chatbox-workspace.avif`<br>`chatbox-daily-recap-modal.avif`<br>`chatbox-arcade-gaming-backseat.avif`<br>`chatbox-context-injections-menu.avif`<br>`chatbox-model-favorites-picker.avif`<br>`chatbox-minimal-single-column.avif`<br>`chatbox-event-ledger.avif`<br>`memory-context-popover.avif` | ✅ **Complete (10 assets)** |
| **08** | **Situational Awareness & Pacing** | Desktop perception, active-window telemetry, OS sensors, AFK gates, contextual spoken fillers, interactive VLM simulator. | `hero-08-situational-awareness.avif`<br>`card-editor-proactivity-screen-watching.avif`<br>`card-editor-proactivity-heartbeats.avif`<br>`card-editor-proactivity-operating-schedule.avif`<br>`settings-vision-simulator-interactive.avif`<br>`pacing-audio-fillers.avif` | ✅ **Complete (5 assets)** |
| **09** | **Production Studio & Autonomous Artistry** | Director's Monitor, concept stacks (Base/Layer), ComfyUI BYOW pipeline, multi-actor handoff, Scene Vault, World Bible directives, Artistry settings canvas, Director sensitivity deck. | `hero-09-artistry-studio.avif`<br>`studio-directors-monitor.avif`<br>`studio-scene-vault.avif`<br>`studio-stage-directives-world-bible.avif`<br>`studio-timelines-and-visual-state.avif`<br>`settings-artistry-live-studio-canvas.avif`<br>`studio-director-sensitivity-controls.avif` | ✅ **Complete (7 assets)** |
| **10** | **Discord Gateway & Connected Surfaces** | Dual execution target (Local vs Edge), Cloudflare Workers 24/7 deployment, multi-channel context routing, VLM image intake, DM toggle. | `hero-10-discord-surfaces.avif`<br>`discord-bot-connection.avif`<br>`discord-cloud-relay-studio.avif`<br>`discord-access-routing-table.avif`<br>`discord-cloudflare-deploy-modal.avif`<br>`discord-cloudflare-config-modal.avif` | ✅ **Complete (5 assets)** |
| **11** | **Onboarding V3 & Quick Start Showcase** | First-run onboarding wizard and 60-Second Quick Start dashboard: Welcome hardware check, Quick Start 4-corner cockpit, Experience archetypes, Soul & Persona 8-card grid, Physical Vessel 3D coverflow, and Pre-Flight Honesty Matrix finale with live Turn 0 preview. | `onboarding-v3-welcome.avif`<br>`onboarding-v3-quick-start.avif`<br>`onboarding-v3-experience-archetypes.avif`<br>`onboarding-v3-persona-starter-cards.avif`<br>`onboarding-v3-vessel-coverflow.avif`<br>`onboarding-v3-stage-finale.avif` | ✅ **Complete (6 assets)** |
