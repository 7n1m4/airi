# Proposal: Show Harness Vision-to-Action Gaming Co-Pilot & Autonomous Companion

> **Status**: Proposed RFC
> **Document**: `docs/proposal-gaming-show-harness-copilot.md`
> **Target Audience**: Gaming Plugin Authors, Vision-Language Engineers, Proactivity Developers
> **Key References**: `docs/proposal-destiny2-plugin.md`, `docs/design-plugin-architecture.md`, `packages/stage-ui/src/stores/proactivity.ts`

---

## 🧭 1. Executive Summary & Vision

Project AIRI’s current gaming integration (e.g. [`docs/proposal-destiny2-plugin.md`](./proposal-destiny2-plugin.md)) relies primarily on:
1. **Passive REST API Polling**: Querying external developer portals (Bungie API) for post-game carnage reports and match stats.
2. **Static Optical Character Recognition (OCR)**: Running localized ONNX screen crops (`PP-OCRv6_tiny_rec_onnx`) to inspect text boxes.

While functional, this architecture leaves AIRI blind to what actually happens inside the 3D game world during active gameplay. The character cannot see enemies flanking, cannot celebrate clutch plays in real time, and cannot physically interact with or co-pilot the game.

This proposal introduces **Show Harness for Gaming**: a Vision-to-Action architecture that turns any standard Vision-Language Model (VLM) into an active, real-time **Gaming Co-Pilot and Autonomous Companion**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      THE SHOW HARNESS GAMING PIPELINE                   │
│                                                                         │
│   [ Live Game Video Stream / Screen Capture (WebCodecs / DXGI) ]        │
│                                │                                        │
│                                ▼                                        │
│             [ Vision-Language Model (VLM Reasoner) ]                    │
│             (Analyzes HUD, Minimap, Crosshairs, Enemies)                │
│                                │                                        │
│                                ▼                                        │
│             [ Discrete Semantic Action Tokens ]                         │
│             e.g. <|ACTION:PingEnemy position="flank_left"|>             │
│                  <|ACTION:CastSuper ability="healing_rift"|>            │
│                  <|ACTION:Callout text="Sniper on catwalk!"|>           │
│                                │                                        │
│                                ▼                                        │
│                   [ Bounded Action Interpreter ]                        │
│                   (Zero Unconstrained Mouse Risk)                       │
│                                │                                        │
│                 ┌──────────────┴──────────────┐                         │
│                 ▼                             ▼                         │
│     [ Game Input Emulation ]      [ Proactive Voice Banter ]            │
│     (ViGEm / vJoy Virtual Pad)    (Kokoro / ElevenLabs TTS)             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🎮 2. Why Show Harness? (The Gaming Advantage)

Traditional game bots rely either on brittle memory-scraping (cheat-engine hooks prone to anti-cheat bans) or complex reinforcement learning policies that take months to train for a single title.

**Show Harness changes the paradigm:**
1. **Off-The-Shelf VLM Reasoning**: Works with mainstream multimodal models (Gemini 2.0 Flash, GPT-4o, Claude 3.5 Sonnet, Qwen-2.5-VL) without task-specific retraining.
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
       emulationTarget: 'virtual_gamepad' | 'keyboard' | 'voice_callout'
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
                               ┌─────────────────────────────┐
                               │  Screen Capture Provider    │
                               │  (DXGI Desktop Duplication /│
                               │   WebCodecs Frame Stream)   │
                               └──────────────┬──────────────┘
                                              │ 2-5 FPS JPEG / WebP
                                              ▼
                               ┌─────────────────────────────┐
                               │     VLM Reasoning Engine    │
                               │   (Gemini Live / Qwen-VL)   │
                               └──────────────┬──────────────┘
                                              │ Action Tokens
                                              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    AIRI Game Action Host (Electron Main)                   │
│                                                                            │
│   ┌────────────────────────────────┐    ┌──────────────────────────────┐   │
│   │ Game Action Interpreter        │    │ Proactivity Speech Dispatch  │   │
│   │  • Input Rate Limiter          │    │  • Priority Voice Interrupt  │   │
│   │  • Anti-Cheat Safe Curves      │    │  • Character Banter Context  │   │
│   └───────────────┬────────────────┘    └───────────────┬──────────────┘   │
└───────────────────┼─────────────────────────────────────┼──────────────────┘
                    │ Virtual Controller                  │ Audio Out
                    ▼                                     ▼
             [ Target Game ]                       [ Stage Audio ]
```

1. **Screen Ingest**: Captured in the Electron main process via Windows DXGI Desktop Duplication API (or macOS ScreenCaptureKit) at zero CPU overhead.
2. **Action Interception**: Emits tokens through `@moeru/eventa` to `apps/stage-tamagotchi/src/main/services/airi/gaming/action-host.ts`.
3. **Safety Interlocks**: A global hardware toggle (e.g. `Ctrl + Shift + Esc`) immediately severs all virtual controller and keyboard input emulation.

---

## 📅 6. Roadmap & Implementation Checklist

- [ ] **Action Manifest Protocol**: Define `GameActionManifest` and `GameActionToken` in `packages/plugin-protocol/`.
- [ ] **Virtual Gamepad Bridge**: Integrate ViGEmClient (or virtual keyboard driver) as an optional native Electron module.
- [ ] **Destiny 2 & RPG Action Profiles**: Author standard action dictionaries for Destiny 2, FFXIV, and generic Visual Novels.
- [ ] **Action Interpreter Engine**: Implement deterministic token parsing and rate-limited dispatch in `stage-tamagotchi`.
- [ ] **Gaming Mode Control Strip Island**: Add a "Gaming Co-Pilot" widget to the Stage Control Strip showing active VLM FPS, detected game state, and action logs.
