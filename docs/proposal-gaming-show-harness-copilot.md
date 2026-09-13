# Proposal: Show Harness Vision-to-Action Gaming Co-Pilot & Autonomous Companion

> **Status**: Proposed RFC · **Companion RFC**: [`docs/proposal-generic-gaming-agent-runtime.md`](./proposal-generic-gaming-agent-runtime.md) (Generic Gaming Agent Runtime & Arcade Room Architecture)
> **Document**: `docs/proposal-gaming-show-harness-copilot.md`
> **Target Audience**: Gaming Plugin Authors, Vision-Language Engineers, Proactivity Developers
> **Key References**: [`docs/proposal-generic-gaming-agent-runtime.md`](./proposal-generic-gaming-agent-runtime.md), [`docs/proposal-attention-ecology-local-webgpu-guard.md`](./proposal-attention-ecology-local-webgpu-guard.md) (Stage 0 pHash Salience Gate), `apps/stage-tamagotchi/src/renderer/components/chat/chat_arcade.vue` (Arcade Room Surface), `packages/stage-ui/src/stores/providers/moondream` (Local WebGPU VLM), `docs/proposal-destiny2-plugin.md`, `docs/design-plugin-architecture.md`, `packages/stage-ui/src/stores/proactivity.ts`

---

## 🧭 1. Executive Summary & Vision

Project AIRI’s current gaming integration (e.g. [`docs/proposal-destiny2-plugin.md`](./proposal-destiny2-plugin.md)) relies primarily on:
1. **Passive REST API Polling**: Querying external developer portals (Bungie API) for post-game carnage reports and match stats.
2. **Static Optical Character Recognition (OCR)**: Running localized ONNX screen crops (`PP-OCRv6_tiny_rec_onnx`) to inspect text boxes.

While functional, this architecture leaves AIRI blind to what actually happens inside the 3D game world during active gameplay. The character cannot see enemies flanking, cannot celebrate clutch plays in real time, and cannot physically interact with or co-pilot the game.

This proposal introduces **Show Harness for Gaming**: a Vision-to-Action architecture that turns any standard Vision-Language Model (VLM) into an active, real-time **Gaming Co-Pilot and Autonomous Companion**.

It operates as the unified vision-to-action engine across both execution contexts in AIRI:
1. **External Desktop Games** (Destiny 2, Final Fantasy XIV, Visual Novels): Captured via OS video streams (DXGI/ScreenCaptureKit) and driven via virtual gamepad drivers (`ViGEmClient`).
2. **In-Process Arcade Room Web Classics** ([`docs/proposal-generic-gaming-agent-runtime.md`](./proposal-generic-gaming-agent-runtime.md) & [`chat_arcade.vue`](../apps/stage-tamagotchi/src/renderer/components/chat/chat_arcade.vue)): Captured via HTML5 Canvas snapshots and driven directly via JS-DOS WebAssembly synthetic inputs with **zero Python sidecars** and zero native setup.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      THE SHOW HARNESS GAMING PIPELINE                   │
│                                                                         │
│   [ Live Observation: DXGI Stream (Desktop) OR HTML5 Canvas (Arcade) ]   │
│                                │                                        │
│                                ▼                                        │
│          [ Stage 0 Game Salience & Settle Gate (pHash Filter) ]          │
│          (Adapted from Attention Ecology; User-Tuneable Profiles)       │
│                                │                                        │
│                                ▼                                        │
│      [ Vision-Language Model (On-Device Moondream / Cloud VLM) ]        │
│             (Analyzes HUD, Minimap, Crosshairs, Enemies)                │
│                                │                                        │
│                                ▼                                        │
│             [ Discrete Semantic Action Tokens ]                         │
│             e.g. <|ACTION:PingEnemy position="flank_left"|>             │
│                  <|ACTION:CastSuper ability="healing_rift"|>            │
│                  <|ACTION:UP duration="250"|>                           │
│                  <|ACTION:Callout text="Sniper on catwalk!"|>           │
│                                │                                        │
│                                ▼                                        │
│                   [ Bounded Action Interpreter ]                        │
│                   (Zero Unconstrained Mouse Risk)                       │
│                                │                                        │
│                 ┌──────────────┴──────────────┐                         │
│                 ▼                             ▼                         │
│     [ Game Input Emulation ]      [ Proactive Voice Banter ]            │
│     (ViGEm / JS-DOS KeyPress)     (Contextual TTS + Audio Ducking)      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🎮 2. Why Show Harness? (The Gaming Advantage)

Traditional game bots rely either on brittle memory-scraping (cheat-engine hooks prone to anti-cheat bans) or complex reinforcement learning policies that take months to train for a single title.

**Show Harness changes the paradigm:**
1. **Off-The-Shelf VLM Reasoning**: Works with on-device WebGPU models (`moondream-local` in browser web workers) or mainstream cloud VLMs (Gemini 2.0 Flash, GPT-4o, Claude 3.5 Sonnet, Qwen-2.5-VL) without task-specific retraining.
2. **Bounded Semantic Action Dictionaries**: Instead of giving an AI raw, unconstrained mouse and keyboard control (which leads to erratic spinning and high ban risk), the developer provides a strict, game-specific dictionary of high-level semantic actions:
   ```typescript
   export interface GameActionManifest {
     gameId: string
     title: string
     supportedActions: {
       name: string
       description: string
       payloadSchema: Record<string, any>
       cooldownMs: number
       emulationTarget: 'virtual_gamepad' | 'keyboard' | 'jsdos_keyboard' | 'voice_callout'
     }[]
   }
   ```
3. **Up to 100% Task Completion**: Because the VLM's search space is constrained to valid semantic primitives, the Action Interpreter executes actions deterministically.

---

## 🕹️ 3. Core Gaming Applications in AIRI

### 3.1 Live "Backseat Gamer" Co-Pilot
* **Visual Spatial Callouts**: The mascot watches the player's stream at 2–5 FPS. When an enemy sniper flashes on the horizon or a flanker appears outside the player's primary focal tunnel, AIRI immediately speaks:
  > *"Eyes left! Sniper perched on the catwalk, duck behind cover!"*
* **HUD & Cooldown Telemetry**: Automatically alerts the player when supers, ultimates, or potion cooldowns become available during intense firefights.

### 3.2 Autonomous Companion Routines (Co-Op Play & Minigames)
* **Automated Repetitive Tasks**: Handles low-stakes, tedious in-game chores while the player takes a break:
  * MMO fishing minigames (detecting the bobber splash and triggering the reel action).
  * Inventory sorting and trash-item salvage.
  * Navigating to a waypoint along clear roads.
* **Controller Emulation via ViGEm / vJoy**: Actions are dispatched to a virtual Xbox/DualShock controller driver, appearing to the operating system and anti-cheat software as standard peripheral inputs.

### 3.3 Visual Novel & Dating Sim Co-Play
* Evaluates on-screen narrative choices and character portraits in real time.
* AIRI reacts to in-game dialogue trees, teasing the player about their romance choices or suggesting branching paths based on her own personality.

---

## 🖥️ 4. Secondary Application: Constrained Desktop UI Navigation

Beyond gaming, Show Harness provides a safe, low-friction solution to the problems that caused `@proj-airi/computer-use-mcp` to be deferred:
* **The Problem with Raw Computer Use**: Giving an agent unrestricted coordinate-based mouse clicks and arbitrary keystrokes requires scary OS accessibility permissions, dangerous risk of deleting files, and frequent miss-clicks.
* **The Show Harness Approach**: The VLM identifies discrete semantic UI affordances (e.g. `ClickButton("Export ZIP")`, `SelectDropdownItem("VRM")`). The Action Interpreter binds these directly to verified DOM elements or known window coordinates, achieving zero-risk deterministic desktop navigation.

---

## ⚙️ 5. Integration with AIRI Architecture

```
                                ┌─────────────────────────────────────────┐
                                │          Screen Ingest Provider         │
                                │   • External: DXGI / ScreenCaptureKit   │
                                │   • Arcade: HTML5 Canvas Frame Snapper  │
                                └────────────────────┬────────────────────┘
                                                     │ 30 FPS Local Stream
                                                     ▼
                                ┌─────────────────────────────────────────┐
                                │   Stage 0: Game Salience & Settle Gate  │
                                │  (Adapted from Attention Ecology pHash) │
                                │   • Settle Gate: ΔpHash <= ε for window │
                                │   • Burst Gate:  ΔpHash > threshold     │
                                │   • User-Tuneable Sensitivity Profiles  │
                                └────────────────────┬────────────────────┘
                                                     │ Validated Frame (1-2s Cadence)
                                                     ▼
                                ┌─────────────────────────────────────────┐
                                │          VLM Reasoning Engine           │
                                │   • Local: WebGPU Moondream ($0 Cost)   │
                                │   • Cloud: Gemini Live / Qwen-VL        │
                                └────────────────────┬────────────────────┘
                                                     │ Action + Banter Tokens
                                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          AIRI Game Action Host & Interpreter                            │
│                                                                                         │
│   ┌─────────────────────────────────────────┐   ┌───────────────────────────────────┐   │
│   │ Game Action Interpreter Engine          │   │ Proactivity & Banter Dispatch     │   │
│   │  • Token Parser (<|ACTION:...|>)        │   │  • Priority Voice Interrupt       │   │
│   │  • Input Rate Limiter & Cooldowns       │   │  • WebAudio Ducking (-70% volume) │   │
│   │  • Action Manifest Schema Validation    │   │  • Live2D/VRM Emotion Cues        │   │
│   └────────────────────┬────────────────────┘   └─────────────────┬─────────────────┘   │
└────────────────────────┼──────────────────────────────────────────┼─────────────────────┘
                         │                                          │
            ┌────────────┴────────────┐                             ▼
            ▼                         ▼                       [ Stage Audio ]
   [ Target A: Desktop Game ] [ Target B: Arcade Room ]    (Contextual TTS & Banter)
    (ViGEm Virtual Gamepad)    (JS-DOS simulateKeyPress)
```

### 5.1 Adapting Attention Ecology: The Stage 0 Game Salience & Settle Gate
In Project AIRI's background perception architecture ([`docs/proposal-attention-ecology-local-webgpu-guard.md`](./proposal-attention-ecology-local-webgpu-guard.md)), **Stage 0** uses perceptual hashing (`pHash`) to reject ~90% of desktop ticks at microsecond cost before triggering heavier models.

Gaming observation adopts this exact pHash change-detection engine, but solves a distinct challenge:
* **The Screen-Watching Difference**: Desktop screen-watching relies on a static baseline (idle user = static screen). In gaming, the viewport is almost never static due to 3D camera sway, particle effects, character idling, and running animations.
* **The Dual-Mode Solution**:
  1. **Settle Gating (Turn-Based / Post-Action)**: For turn-based strategy (Civilization, Chess), puzzle boards (2048), or following a macro action burst (Doom), the gate tracks the frame-to-frame Hamming distance:
     $$\Delta_{\text{pHash}} = \text{HammingDistance}(\text{pHash}_t, \text{pHash}_{t-1})$$
     When $\Delta_{\text{pHash}} \le \text{settleEpsilon}$ continuously across a settling window `settleWindowMs` (e.g. 250ms), the visual state is confirmed to be at rest. The clean settled frame is immediately dispatched to the VLM.
  2. **Burst Gating (Real-Time Spectating)**: In real-time co-pilot mode, the gate monitors deviation from the last evaluated reference frame. A sudden spike ($\Delta_{\text{pHash}} > \text{burstThreshold}$) signals high-salience moments (low health red flashes, sudden enemy ambush, inventory opening, death screens), triggering an immediate prioritized reaction turn.

### 5.2 User-Tuneable Sensitivity Profiles
Because game pacing varies across genres, the gaming gate must not enforce hardcoded thresholds. The Arcade Room (`chat_arcade.vue`) and Desktop Game Co-Pilot settings expose user-tuneable sensitivity profiles:

| Profile Preset | Target Genres & Titles | Settle Window | pHash Delta Threshold | Min Cadence | Max Heartbeat |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Turn-Based / Puzzle** | *2048*, *Civilization*, *Sokoban*, *Tactics RPGs* | 300 ms | 6 (High sensitivity to subtle board changes) | 1,500 ms | 10,000 ms |
| **Fast Action / FPS** | *Doom*, *Destiny 2*, *Shooters*, *Platformers* | 150 ms | 22 (Ignores minor camera bob, catches major scene shifts) | 800 ms | 3,500 ms |
| **Narrative / Visual Novel** | Dating Sims, Visual Novels, Dialogue Trees | 200 ms | 12 (Triggers on text advance or sprite change) | 1,000 ms | 8,000 ms |
| **Custom Sliders** | User-configured per game | 50–1000 ms | 1–64 bits | 500–5000 ms | 1–30 s |

### 5.3 Dual Execution Targets
Show Harness decouples semantic action interpretation from hardware targets:
1. **Target A: External Desktop Games (Electron Main)**:
   - Emits tokens through `@moeru/eventa` to `apps/stage-tamagotchi/src/main/services/airi/gaming/action-host.ts`.
   - Injects virtual inputs through `ViGEmClient` (virtual Xbox 360 / DualShock 4 controller driver) or OS-level virtual keyboard hooks.
2. **Target B: In-Process Arcade Room (Renderer JS-DOS)**:
   - Evaluated directly inside the renderer worker (paired with local WebGPU `moondream-local`).
   - Dispatches programmatic keypresses directly into JS-DOS Wasm via `currentCommandInterface.simulateKeyPress(keyCode, durationMs)` or DOM keyboard events. Zero native compilation or system drivers required.

### 5.4 Safety Interlocks
1. **Global Hardware Killswitch**: In desktop mode, a global hotkey (`Ctrl + Shift + Esc`) immediately severs all virtual controller and keyboard input emulation.
2. **Arcade Pause Interlock**: In the Arcade Room, pressing `[Space]` or clicking outside the canvas immediately halts the VLM action loop and pauses JS-DOS emulation.

---

## 📅 6. Roadmap & Implementation Checklist

- [ ] **Action Manifest Protocol**: Define `GameActionManifest` and `GameActionToken` in `packages/plugin-protocol/`.
- [ ] **Virtual Gamepad Bridge**: Integrate ViGEmClient (or virtual keyboard driver) as an optional native Electron module.
- [ ] **Destiny 2 & RPG Action Profiles**: Author standard action dictionaries for Destiny 2, FFXIV, and generic Visual Novels.
- [ ] **Action Interpreter Engine**: Implement deterministic token parsing and rate-limited dispatch in `stage-tamagotchi`.
- [ ] **Gaming Mode Control Strip Island**: Add a "Gaming Co-Pilot" widget to the Stage Control Strip showing active VLM FPS, detected game state, and action logs.
