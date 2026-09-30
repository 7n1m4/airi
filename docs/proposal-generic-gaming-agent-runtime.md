# Proposal: Generic Gaming Agent Runtime

> **Status**: Implemented & Operational (Phase 1–3 Live in Main) · **Companion RFC**: [`docs/proposal-gaming-show-harness-copilot.md`](./proposal-gaming-show-harness-copilot.md) (Show Harness Action Protocol & Interpreter)
> **Key References**: [`docs/proposal-attention-ecology-local-webgpu-guard.md`](./proposal-attention-ecology-local-webgpu-guard.md) (Stage 0 pHash Salience Gate), [`apps/stage-tamagotchi/src/renderer/components/chat/chat_arcade.vue`](../apps/stage-tamagotchi/src/renderer/components/chat/chat_arcade.vue) (Arcade Room Surface), [`packages/stage-ui/src/composables/arcade/use-arcade-agent.ts`](../packages/stage-ui/src/composables/arcade/use-arcade-agent.ts) (Production Turn Agent & Ghost Cursor), `packages/stage-ui/src/stores/providers/moondream` (Local WebGPU VLM)

A generic, cross-game agent harness and execution engine for AIRI that enables characters to autonomously play games, react in real time, and banter with the user through **interactive backseat gaming** — with zero Python sidecar dependencies.

---

## 1. Motivation & Background

### The Upstream Problem: Per-Game Bespoke Integrations
Upstream AIRI attempted game support by building bespoke, tightly-coupled adapters:
1. **Bespoke Game Bot Clients**: Required complex cognitive architectures coupled to external bot libraries, parsing raw game network packets, managing spatial raycasts, and tracking inventory slots. Discovery of heavy external game dependencies synchronously delayed desktop window startup by over 20 seconds.
2. **Factorio**: Relied on Factorio's RCON (Remote Console) socket and custom Lua injection scripts (`settings/factorio/*`).
3. **The Fundamental Dead End**: Supporting $N$ games required maintaining $N$ separate protocols, game-specific bot clients, and brittle state machines. Whenever a game updated, its bespoke bridge broke.

### The New Direction: A Universal, Zero-Python Gaming Runtime
Instead of building a dedicated bot for every title, this proposal outlines a **universal gaming agent runtime** combining:
1. **A Game-Agnostic Cognitive Harness**: Inspired by `GamingAgent` (LMGame Bench), separating observation, working memory, action validation, and self-reflection from the underlying game engine.
2. **Zero-Python WebAssembly Execution (JS-DOS & Web Canvas)**: Emulating classic PC titles (via JS-DOS / Wasm DOSBox) and running browser games directly inside AIRI's Electron/Web renderer with **zero Python sidecars**, zero virtualenv setup, and zero native compilation headaches.
3. **Interactive Backseat Gaming**: Turning gameplay into a live social co-op experience where the user critiques, coaches, or heckles AIRI in real-time, and AIRI argues back, follows advice, panics, or gloats using her speech runtime and acting tokens.

---

## 2. Framework Landscape Analysis

Recent open-source research has produced four notable game-playing agent benchmarks and runtimes. Here is how they compare in the context of AIRI:

| Framework | Core Engine | Execution Target | Strengths | Drawbacks for AIRI |
| :--- | :--- | :--- | :--- | :--- |
| **`lmgame-org/GamingAgent`** | LLM/VLM Agent Harness | Gymnasium / Stable-Retro | Clean separation between bare VLM and cognitive scaffolding (memory, planning, action validation, reflection). | Python-based; relies on Gymnasium/Retro environments. |
| **`alexzhang13/videogamebench`** | Benchmark Suite (20 DOS & GB games) | **JS-DOS** (Playwright/Browser) & PyBoy (Python) | Proves that JS-DOS in browser canvases can run Doom, Civilization, Warcraft II, and Prince of Persia. | Mixes Python PyBoy with JS-DOS; focused on static evaluation rather than interactive companions. |
| **`gameworld-project/gameworld`** | Browser Benchmark (34 games) | HTML5 Canvas / Chromium | Broad game selection (puzzles, platformers, arcade); dual computer-use and semantic action spaces. | Benchmark-first; no companion dialogue or character persona integration. |
| **`krafton-ai/ORAK`** | Benchmark Suite (12 commercial games) | Heterogeneous (Steam, PySC2, PyBoy, etc.) | High prestige titles (Street Fighter, Slay the Spire, Stardew Valley). | Not a unified harness; requires massive multi-runtime setup across disparate desktop binaries. |

### Architectural Insight: Decoupling Harness from Runner
The candidate projects reveal that gaming agents consist of two independent components:
* **The Cognitive Harness**: Translates the visual scene into reasoning, plans next steps, enforces valid actions, and reflects on outcomes.
* **The Environment Runner**: Executes those actions in a virtual environment and produces the next frame.

By adopting **JS-DOS (WebAssembly)** and **HTML5 Canvas**, AIRI can run the entire environment runner inside its existing Node/Electron/Web stack without external processes.

---

## 3. The Core Interactive Hook: "Backseat Gaming" & Live Banter

In existing research benchmarks, the agent plays games in sterile isolation to maximize an evaluation score. In AIRI, the agent plays games **for and with the user**.

Backseat gaming is one of the most engaging dynamics in live streaming and companion AI:
* The user watches the game feed in an AIRI widget and gives real-time suggestions ("Watch your six!", "Use the potion!", "Go left, trust me!").
* The agent ingests this advice, compares it against its own spatial reasoning, and dynamically responds with emotional and vocal reactions.

```mermaid
sequenceDiagram
    autonumber
    actor User as User (Voice / Chat)
    participant Game as JS-DOS Game Canvas
    participant Harness as Gaming Cognitive Harness
    participant Brain as LLM / VLM (Airi Brain)
    participant Speech as AIRI Speech Runtime
    participant Avatar as Live2D / VRM Avatar

    Game->>Harness: Frame Capture (Downsampled Canvas + OCR)
    Harness->>Brain: Visual Observation + Context + Game Objective
    User->>Harness: "Don't go down that hallway, there's an ambush!"
    Harness->>Brain: Inject Backseat Comment into Turn Prompt
    Brain-->>Harness: Plan: Action=TURN_RIGHT, Spoken="Fine, I'll trust you!", Emotion="scared"
    par Execute Action
        Harness->>Game: Dispatch Controller Key (RIGHT_ARROW)
    and Express Reaction
        Harness->>Speech: Speak "Fine, I'll trust you!" (Audio Ducking on Game)
        Harness->>Avatar: Trigger <|ACT:emotion="scared" motion="look_around"|>
    end
```

### Dynamic Backseat Banter Archetypes
Depending on the character card persona and intimacy state, the agent reacts to backseat advice differently:
1. **The Trusting Neophyte**: Eagerly follows user advice, thanks the user when it works, and acts betrayed when bad advice leads to a game over (`<|ACT:emotion="pout"|>`).
2. **The Stubborn Competitor**: Rejects user suggestions ("I know what I'm doing!"), tries its own plan, and either gloats on success (`<|ACT:emotion="smug"|>`) or frantically covers up its mistakes on failure.
3. **The Panicked Gamer**: Gets overwhelmed during tense encounters (e.g. Doom low health / monsters approaching) and screams for user guidance while spamming evasive maneuvers.

---

## 4. Architectural Design

```mermaid
graph TD
    subgraph "Desktop Shell (apps/stage-tamagotchi/src/renderer/pages/chat.vue)"
        Sidebar[Left Navigation Panel: 'Arcade Room']
        ArcadeSurface["chat_arcade.vue (Side-by-Side Surface)"]
        GameViewport[Left Pane: Retro Web / JS-DOS Canvas]
        BackseatChat[Right Pane: Minimal Backseat Chatbox]
        AudioMixer[WebAudio Ducking Gain Node]
    end

    subgraph "Game Execution Layer (Pure JS / WebAssembly)"
        JSDos[JS-DOS Runner - DOSBox Wasm]
        HTML5Games[GameWorld / Canvas Games]
        InputInjector[Synthetic Keyboard / Mouse Injector]
    end

    subgraph "Cognitive Gaming Harness (packages/gaming-runtime)"
        FrameSampler[Frame Sampler & Scene Differ]
        OCRModule[Lightweight Text / HUD OCR]
        ActionValidator[Discrete Action Space Validator]
        TurnScheduler[Turn Cadence & Frame-Skipping Controller]
        WorkingMemory[Short-Term Spatial & Objective Memory]
    end

    subgraph "AIRI Companion Core"
        VLM[Vision LLM / Model Dispatch]
        BackseatComposer[Backseat Composer & Voice Ingestion]
        SpeechRuntime[Contextual Streaming TTS & Fillers]
        StageMate[Live2D / VRM Stage Avatar]
    end

    Sidebar --> ArcadeSurface
    ArcadeSurface --> GameViewport
    ArcadeSurface --> BackseatChat

    GameViewport --> JSDos
    GameViewport --> HTML5Games
    GameViewport --> FrameSampler

    FrameSampler --> OCRModule
    OCRModule --> TurnScheduler
    TurnScheduler --> WorkingMemory
    BackseatComposer -.->|User Backseat Inputs| WorkingMemory

    WorkingMemory --> VLM
    VLM --> ActionValidator
    ActionValidator --> InputInjector
    InputInjector --> JSDos
    InputInjector --> HTML5Games

    VLM -.->|Dialogue & Emotion Cues| SpeechRuntime
    SpeechRuntime --> StageMate
    SpeechRuntime -.->|Audio Ducking Control| AudioMixer
    SpeechRuntime -.->|Live Transcript & Badges| BackseatChat
```

---

## 5. The "Arcade Room" Desktop Chatbox Surface (`chat_arcade.vue`)

### 5.1 Workspace Navigation Integration
Following the architecture documented in `airi-desktop-chatbox` (`references/workspace-navigation.md`):
* **Surface Key**: `'arcade'`
* **Label**: `'Arcade Room'`
* **Icon**: `'i-solar:gamepad-bold-duotone'`
* **Code-Split Component**: `chat_arcade.vue` registered via `defineAsyncComponent` in `apps/stage-tamagotchi/src/renderer/pages/chat.vue`.
* **Right Panel Behavior**: Reclaims the entire window canvas width, giving optimal real estate for the guided 5-stage setup studio and gameplay arena.

### 5.1 Architecture Transformation: The 5-Stage Guided Studio Lifecycle

The legacy Arcade Room immediately dropped users into an unconfigured split window (65% game canvas, 35% chat panel) running a static preset, forcing catalog browsing into a cramped modal.

The upgraded architecture **scraps the premature split layout in favor of a Guided 5-Stage Lifecycle**:

```mermaid
stateDiagram-v2
    [*] --> Stage1_Hub: Enter Arcade Room

    state Stage1_Hub {
        Full_Catalog_Grid: Full-screen Browse & Search (8,924 titles)
        Faceted_Filters: Engine (S1/S2) • Technology Tiers (Fixed/Scroll/3D) • Genre • Controller
        Knowledge_Dropdown: "Acquired Game Knowledge" library selector
    }

    Stage1_Hub --> Stage2_Config: User Selects Game

    state Stage2_Config {
        Engine_Pick: Recommended Engine Badge (System 1 Reflex vs System 2 Strategy)
        Cost_Warnings: Tip & Cost Warning Callouts
        S1_Provider: System 1 Backend (Laya Local ONNX $0 vs TypeSafe Jev Cloud)
        S2_VLM_Provider: System 2 VLM Override
        Persona_Select: Recommended Companion Persona (Pre-selected, editable)
    }

    Stage2_Config --> Stage3_Calibration: If New Game (No Knowledge)
    Stage2_Config --> Stage5_ClassicArena: If Game Knowledge Already Acquired

    state Stage3_Calibration {
        Full_Viewport: Game Canvas 100% width (No Chat Sidebar yet!)
        Airi_SpeechBubble: "Help me help you! Hit Start and play one quick 15s round!"
        Countdown_Timer: 15s Timer & [Start Recording] Button
        Buffer_Overlay: "Analyzing gameplay motion vectors & compiling state machine..."
    }

    Stage3_Calibration --> Stage4_Review: Recording Finished / Death Detected

    state Stage4_Review {
        Strategy_Summary: Airi explains her understanding of the rules & death conditions
        Mini_Program_Spec: Synthesized actions & keybindings preview
        Review_Actions: [Test 60s Trial Run] • [Re-Record] • [Approve & Save Knowledge]
    }

    Stage4_Review --> Stage5_ClassicArena: User Approves Knowledge

    state Stage5_ClassicArena {
        Game_Viewport: 65% Width Canvas running at full speed
        Backseat_Chat: 35% Width Live Reactions & Persona Banter
        Reflex_Driver: High-speed Laya/Jev loop driving keys in real time
    }
```

---

### 5.2 Stage 1: The Full-Screen Arcade Hub (Discovery & Curation)

The default landing surface for Arcade Room is no longer an active game, but a **Full-Screen Discovery Hub**:

1. **Top Header & Knowledge Selector**:
   - Upgraded game selector on the top-left: switches from raw presets to the **"Acquired Game Knowledge" Library**, displaying games AIRI has already mastered with a `Mastered ✓` badge.
   - Global Search input searching titles and publishers across the catalog.
2. **Faceted Filter Tabs (Powered by the 8,924 Batch Jev Triage Dataset)**:
   - **Cognitive Route**: `[All (8,924)]` | `[⚡ System 1 Reflex (3,627)]` | `[🧠 System 2 Strategy (4,408)]` | `[📖 Interactive Fiction (384)]`
   - **Screen Motion Architecture**: `[Fixed Single Screen (2,720)]` | `[Scrolling 2D (1,485)]` | `[Flip-Screen (1,186)]` | `[3D Raycast (1,065)]`
   - **Primary Genre**: `[Action]` `[Platformer]` `[Strategy]` `[RPG]` `[Shooter]` `[Puzzle]` `[Racing]`
   - **Controller Interface**: `[Gamepad / Arrows]` `[Mouse Pointer]` `[Keyboard Typing]`
3. **Tip & Cost Architecture Callouts**:
   - > [!TIP]
     > **System 1 Reflex Titles (Fixed Single Screen)**: Support automated self-synthesizing state interpreters and run locally at $0.00 cost with 15ms latency via on-device Laya ONNX.
   - > [!WARNING]
     > **System 2 Strategy Titles**: Depend on visual multimodal LLM reasoning on settled frames and consume vision tokens per move.

---

### 5.3 Stage 2: The Pre-Flight Provisioning Cockpit

Selecting any game tile opens a focused provisioning sheet before booting the emulator:

1. **Engine Recommendation**:
   - Automatically highlights the triaged route (e.g. `⚡ System 1 High-Speed Reflex` for *Nibbles*, `🧠 System 2 Strategy` for *SimCity*) with an override switch.
2. **Dedicated Gaming Inference Overrides**:
   - **System 1 Decision Engine**:
     - `Laya Local (On-Device WASM/ONNX)`: **15ms latency, $0.00 Free** *(Recommended default for gaming loops to avoid cloud latency and costs)*.
     - `TypeSafe Jev (Cloud Alpha)`: **100ms latency, $42/Btok**.
   - **System 2 Vision Model**: Inherits from Global Faculty Defaults (`facultyDefaultsStore.resolveFaculty('vision')`), with single-click dropdown override (e.g. Moondream WebGPU vs Gemini Flash Lite).
3. **Companion Backseat Persona**:
   - Pre-selects the recommended roleplay dynamic from our triage dataset:
     - `hype_cheerleader`: Energetic, screaming at near-misses (*Doom*, *Wolfenstein*).
     - `strategic_adviser`: Calculating budgets and territory (*SimCity*, *Civilization*).
     - `detective_partner`: Investigating story clues and inventory (*Monkey Island*, *Zork*).
     - `laidback_observer`: Relaxed retro commentary (*Nibbles*, *Pac-Man*).
   - Allows full user customization before launch.
4. **Knowledge Gateway**:
   - If Game Knowledge exists in IndexedDB: shows **[ Launch Classic Game ]**.
   - If title is uncalibrated: shows **[ Learn to Play (15s Setup) ]**.

---

### 5.4 Stage 3: The Distraction-Free Calibration Stage

**The chat sidebar is completely hidden during calibration.** The game canvas occupies 100% of the viewport to maximize focus:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [≡] AIRI Arcade Studio — Calibration Mode                                                 [✕ Exit Setup]│
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│       ┌────────────────────────────────────────────────────────────────────────────────────────┐       │
│       │ 🌸 AIRI: "Help me help you! Hit Start and play for 15s so I can learn how it moves!"   │       │
│       └────────────────────────────────────────────────────────────────────────────────────────┘       │
│                                                                                                        │
│                             ┌──────────────────────────────────────────┐                               │
│                             │                                          │                               │
│                             │          FULL-SCREEN GAME CANVAS         │                               │
│                             │             (QBasic Nibbles)             │                               │
│                             │                                          │                               │
│                             │                                          │                               │
│                             └──────────────────────────────────────────┘                               │
│                                                                                                        │
│                              [ 🔴 START RECORDING ]   [ ⏱️ 15s Timer ]                                 │
│                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **User Action**: The user clicks `[ Start 15s Calibration ]` (triggering `collector.start()`).
2. **Calibration Coaching & Deliberate Loss Protocol**:
   - To learn both player locomotion and the visual signature of game-over, the companion instructs the user:
     > *"Play normally for a few seconds so I can see how you move, then **intentionally crash or lose before the 15s timer runs out**! That way I learn your controls and the Game Over screen!"*
   - **Early Loss Trigger**: If the user crashes before the 15s timer finishes (e.g. at 7s or 10s), they can click `[ 💥 I Crashed! (Finish Calibration) ]` or wait for the countdown to automatically freeze and finalize the trace.
3. **Trace Accumulation ($80 \times 40$ Downsampling Schema)**:
   - Captures an offscreen downsampled $80 \times 40$ binary grid stream at 10 Hz matching the canonical format of `personal_airi/game_frames.json`:
     - **Frame 0**: Initial baseline `fullGrid: string[]` (40 rows of 80 `'0'`/`'1'` characters).
     - **Frames $1 \dots N$**: Sparse diff packets `{ t: number, keys: string[], added: [col, row][], removed: [col, row][] }`.
   - Records synchronous key events (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Space`) with millisecond timestamps to correlate inputs with pixel deltas.
4. **Completion & Freezing**: When time expires or early loss is triggered, the game stays running/frozen, and a synthesis overlay appears:
   *"AIRI is watching the replay... Correlating player inputs with pixel deltas and synthesizing game state extractor..."*

---

### 5.5 Stage 4: Strategy Review & Generic State Extractor Synthesis

The System-2 LLM receives the recorded demonstration trace JSON and synthesizes an executable **Generic State Extractor (Mini-Program)**:

1. **Unbiased, Generic Synthesis Mission**:
   - The LLM prompt is intentionally **open-ended and non-prescriptive**—it does not supply biased assumptions or pre-baked entity names (like `playerHead`, `food`, or `tail`) that could contaminate generic extraction across disparate genres (shooters, mazes, paddles, puzzles).
   - The LLM analyzes the real sequence of `{ t, keys, added, removed }`:
     - Correlates user keypresses with moving pixel clusters to identify controllable entities and motion vectors.
     - Distinguishes dynamic interactive elements from static arena boundaries.
     - Identifies the visual signature that occurred when the user crashed (e.g. sudden dialog boxes, multi-pixel bursts, freeze).
2. **The Mini-Program Contract (Pure JS State Extractor)**:
   - The synthesized code is **not a hardcoded heuristic bot** (no cyclic modulo loops or hardcoded turn rules).
   - It is a fast, sandboxed JavaScript state parser (`extractGameState`) running in $<1\text{ms}$:
     ```javascript
     /**
      * Synthesized Game State Extractor
      * Evaluates raw 80x40 grids/diffs into a structured semantic situation report.
      */
     function extractGameState(prevGrid, currGrid, diff) {
       // Returns dynamic game state object:
       // {
       //   controllableEntity: { x, y, heading },
       //   activeHazards: [...],
       //   activeTargets: [...],
       //   isGameOver: boolean
       // }
     }
     ```
3. **Review Dialog UI**:
   - **Airi's Game Comprehension**: Natural-language summary of perceived mechanics, hazards, and tactical directives.
   - **Synthesized Extractor Viewer**: Syntax-highlighted code block displaying the full `extractGameState` JavaScript implementation.
   - **`[ 📋 Copy Extractor Code ]`**: One-click clipboard copy with toast confirmation for transparent inspection.
   - **Execution Controls**:
     - **`[ 60-Second Sandboxed Test ]`**: Launches an automated 60-second trial run where AIRI plays live using the synthesized extractor and Jev reflexes while you observe.
     - **`[ ⏱️ Recalibrate (15s) ]`**: Discards trace and returns to Stage 3 to re-demonstrate without resetting the running game instance.
     - **`[ ✅ Approve & Save Knowledge ]`**: Atomically persists the Mini-Program and strategy into IndexedDB (`local:arcade_knowledge:<game_id>`).

---

### 5.6 Stage 5: The Classic Co-Pilot Arena & 60-Second Live Sandbox Test Run

Once knowledge is approved (or during the 60-Second Sandboxed Test), the runtime executes the **Decoupled Eyes $\to$ Brain $\to$ Hands Pipeline**:

```
┌────────────────────────────────────────────────────────────────────────┐
│               DECOUPLED REAL-TIME CO-PILOT PIPELINE                    │
│                                                                        │
│ 1. [Eyes] Live Canvas ──► 80x40 Downsampler ──► extractGameState()     │
│    (Runs at 15–20 Hz in <1ms, yielding clean SemanticGameState)       │
│                                                                        │
│ 2. [Brain] Jev System 1 (or Laya Local WASM)                           │
│    Evaluates discrete choices ('UP'|'DOWN'|'LEFT'|'RIGHT')             │
│    in ~100ms (Jev Cloud) or ~15ms (Laya Local)                         │
│                                                                        │
│ 3. [Hands] JS-DOS Command Interface                                    │
│    simulateKeyPress(chosenAction) dispatches keypress to game          │
│                                                                        │
│ 4. [Safety Watchdog]                                                   │
│    Terminates if 60s expires or extractGameState.isGameOver === true   │
└────────────────────────────────────────────────────────────────────────┘
```

The Arena layout opens in its refined classic split layout:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [≡] AIRI - Chat Window [Arcade Room: QBasic Nibbles] [Mastered ✓]                         [⚙] [_][□][X]│
├─────────────────┬────────────────────────────────────────────────────┬─────────────────────────────────┤
│  WORKSPACE      │             GAME VIEWPORT (65% Width)              │    BACKSEAT CHAT (35% Width)    │
│                 │ ┌────────────────────────────────────────────────┐ │ ┌─────────────────────────────┐ │
│ 💬 Chat View    │ │                                                │ │ │ 🌸 AIRI [Laidback Observer]   │ │
│ 📹 Director     │ │              JS-DOS / RETRO CANVAS             │ │ │ "Alright, let's grab that    │ │
│ 📖 World Bible  │ │                 (QBasic Nibbles)               │ │ │ number 3 before the wall!"  │ │
│ 🎨 Studio       │ │                                                │ │ │ <|ACT:emotion="smug"|>      │ │
│ 📁 Media        │ │                    [ 4:3 ]                     │ │ ├─────────────────────────────┤ │
│ 🧬 Thread       │ │                                                │ │ │ 👤 You                      │ │
│ 📜 Event Ledger │ │                                                │ │ │ "Watch out behind you!"     │ │
│ 📝 Notes        │ │                                                │ │ ├─────────────────────────────┤ │
│ 🎬 Rehearsal    │ ├────────────────────────────────────────────────┤ │ │ 🌸 AIRI                     │ │
│ 🕹️ Arcade Room  │ │ [Engine: Laya Local $0 (15ms)] [Knowledge: ✓]   │ │ │ "I see it! Turning down!"   │ │
│                 │ │ Mode: [● AI Playing] [○ You Play] [🔊 ────○──] │ │ │ <|ACT:emotion="excited"|>   │ │
│ ─────────────── │ └────────────────────────────────────────────────┘ │ ├─────────────────────────────┤ │
│ ⚙️ Settings     │   Reflex loop running at 15 Hz via Laya WASM.     │ │ [ Backseat advice...      ] │ │
│                 │                                                    │ └─────────────────────────────┘ │
└─────────────────┴────────────────────────────────────────────────────┴─────────────────────────────────┘
```

- **Motor Reflex Loop**: The compiled Mini Program runs at 15–20 Hz in the background, extracting state in $<1\text{ms}$ and querying Laya Local / Jev.
- **Backseat Chat Stream**: AIRI provides continuous verbal personality banter, emotional cues (`<|ACT:emotion="..."|>`), and responds dynamically to user text or voice advice injected into her state payload.

---

### 5.7 The Acquired Game Knowledge Index & Registry

Acquired game knowledge profiles are persisted under `local:arcade_knowledge:<game_identifier>` with the following schema:

```typescript
export interface AcquiredGameKnowledge {
  gameId: string
  title: string
  engine: 'system1_reflex' | 'system2_strategy' | 'system2_narrative'
  technologyTier: 'fixed_single_screen' | 'flip_screen_rooms' | 'smooth_scrolling_camera' | 'first_person_or_3d' | 'static_ui_or_turn_based'
  runtimeProvider: 'laya_local' | 'typesafe_jev' | 'vlm_faculty'
  persona: 'hype_cheerleader' | 'strategic_adviser' | 'detective_partner' | 'laidback_observer'
  miniProgramSource: string // Evaluated sandboxed pure JS state extractor function (extractGameState)
  actionSpace: {
    instructions: string
    choices: Record<string, string>
    keyMapping: Record<string, string>
  }
  learnedAt: number
}
```

---

## 6. Subsystem Specifications

### 6.1 The JS-DOS WebAssembly Runner
* **Library**: `js-dos` (or `@emulators/dosbox-x` / `emulators` package) running directly inside Electron or browser web workers.
* **Zero Native Binaries**: Compiles DOSBox into WebAssembly (`.wasm`), eliminating all Python sidecars and operating system discrepancies.
* **Savestate Integration**: JS-DOS supports serializing and deserializing memory state snapshots. This allows:
  * Checkpointing games before dangerous attempts.
  * Instant rewind / restart on game-over without replaying intro screens.
  * Fast state inspection (reading memory addresses for health, score, or ammo if mapped).

### 6.2 The Unified Action Space & Show Harness Protocol
Games must not require bespoke per-title bot clients. The harness standardizes all games into two canonical input spaces (`GamepadAction` and `PointerAction`).

> [!TIP]
> **Deterministic Token Protocol**: The concrete token grammar, bounded semantic dictionaries, and execution engine are defined in companion RFC [`docs/proposal-gaming-show-harness-copilot.md`](./proposal-gaming-show-harness-copilot.md) ("Show Harness"). The VLM outputs discrete tokens such as `<|ACTION:UP duration="250"|>`, which the Action Interpreter maps directly to JS-DOS `currentCommandInterface.simulateKeyPress()` or canvas events without unconstrained mouse risks.

```typescript
export type DiscreteGamepadButton
  = | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
    | 'BUTTON_A' | 'BUTTON_B' | 'BUTTON_X' | 'BUTTON_Y'
    | 'START' | 'SELECT'
    | 'WAIT'

export interface GamepadAction {
  type: 'gamepad'
  button: DiscreteGamepadButton
  durationMs?: number // e.g. hold UP for 250ms
}

export interface PointerAction {
  type: 'pointer'
  action: 'click' | 'double_click' | 'drag' | 'hover'
  x: number // Normalized 0.0 - 1.0 coordinates
  y: number
  targetX?: number
  targetY?: number
}

export interface GamingActionPlan {
  actions: (GamepadAction | PointerAction)[]
  thought: string
  spokenCommentary?: string
  actingCue?: string // e.g. <|ACT:emotion="smug" motion="nod"|>
}
```

### 6.3 Frame Cadence & Latency Management
Real-time games (like *Doom*) run at 35–60 FPS, while VLM inference takes 500ms–2000ms. To bridge this gap:
1. **Turn-Based Auto-Pause**: For turn-based games (Civilization, 2048, Sokoban, Pokemon, Oregon Trail), the game naturally waits for input.
2. **Action-Burst Execution**: For real-time games (Doom, Prince of Persia), the LLM generates short macro bursts (e.g. `[MOVE_FORWARD(500ms), FIRE, TURN_LEFT(200ms)]`). During execution, the game runs, then the harness samples the settling frame before triggering the next reasoning turn.
3. **Conversational Pacing & Fillers**: When inference takes >800ms, AIRI's Conversational Pacing engine (`proposal-conversational-pacing-thinking-fillers.md`) emits spontaneous vocal fillers ("Hmm...", "Wait a second...", "Let's see...") so the stream never feels frozen.

### 6.4 Audio Ducking & Avatar LookAt
* **Audio Ducking**: When the agent speaks, the game's WebAudio gain node is automatically reduced by 70% (`gain.linearRampToValueAtTime(0.3, ...)`), then smoothly restored when TTS finishes.
* **Stage LookAt**: The Live2D / VRM avatar's gaze can be dynamically routed to point toward the game widget location on the desktop screen, giving the visual appearance that she is actively looking at the monitor while playing.

### 6.5 The Game Salience & Settle Gate (Adapting Attention Ecology pHash)
In continuous background screen perception ([`docs/proposal-attention-ecology-local-webgpu-guard.md`](./proposal-attention-ecology-local-webgpu-guard.md)), **Stage 0** utilizes low-cost perceptual hashing (`pHash`) to reject ~90% of identical ticks at microsecond cost before waking heavier models.

Gaming observation adapts this exact technology to the game canvas / viewport (`chat_arcade.vue`), but with a vital architectural distinction:
* **Desktop watching has a static baseline**: In desktop mode, a user reading code or browsing stays still for seconds at a time; simple binary change detection (changed vs unchanged) suffices.
* **Gaming has continuous motion, animations, and genre-dependent pacing**: Games feature camera bobbing, ambient sprite animations, particle effects, and post-move transition animations. A naive change detector would trigger on every single tick, whereas waiting for zero changes would never trigger during real-time gameplay.

To solve this, the gaming runtime introduces a **Dual-Mode Settle & Burst Filter with User-Tuneable Sensitivity**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    GAME SALIENCE & SETTLE GATE PIPELINE                      │
│                                                                              │
│    Game Canvas / Viewport ────► Fast pHash Extractor (30 FPS, Offscreen)     │
│                                           │                                  │
│                                           ▼                                  │
│                   ┌───────────────────────────────────────┐                  │
│                   │      Mode-Dependent Settle Logic      │                  │
│                   └───────────────────┬───────────────────┘                  │
│                                       │                                      │
│        ┌──────────────────────────────┴──────────────────────────────┐       │
│        ▼                                                             ▼       │
│  [Turn-Based / Action Burst]                                 [Real-Time Fast Action]  │
│  • Monitors post-action animation                             • Tracks cumulative Hamming delta│
│  • Settle Gate: Waits until Hamming                          • Burst Gate: delta > threshold  │
│    delta <= epsilon for settleWindowMs (e.g. 250ms)             (e.g. enemy ambush, new room) │
│  • Captures clean resting state                              • OR maxHeartbeatMs watchdog     │
│        │                                                             │       │
│        └──────────────────────────────┬──────────────────────────────┘       │
│                                       │ Trigger Validated Frame              │
│                                       ▼                                      │
│               [ WebGPU On-Device Moondream / Cloud VLM Reasoner ]            │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 1. Settle Detection (Turn-Based & Post-Burst Execution)
When Airi executes a move (e.g. swiping in *2048*, ending a turn in *Civilization*, moving a piece in *Chess*, or finishing a 500ms walk macro in *Doom*), the game engine plays transition animations.
- Sampling immediately produces motion-blurred artifacts or half-computed board states.
- The **Settle Gate** samples canvas frames via pHash and computes the Hamming distance between consecutive frames:
  $$\Delta_{\text{pHash}} = \text{HammingDistance}(\text{pHash}_t, \text{pHash}_{t-1})$$
- When $\Delta_{\text{pHash}} \le \text{settleEpsilon}$ continuously for `settleWindowMs` (typically 200–350ms), the scene is confirmed to be at rest.
- The clean settled frame is immediately captured and dispatched to the VLM loop.

#### 2. Burst Change Detection (Spectator Mode & Real-Time Observation)
In **Co-Pilot / Spectator Mode** (where the user plays and Airi backseats):
- A blind fixed interval (e.g. polling every 2 seconds) frequently misses crucial events (e.g. an enemy jumping around a corner and disappearing 500ms later) or wastes API tokens on empty hallway walking.
- The **Burst Gate** tracks the Hamming distance from the last evaluated checkpoint frame. When a visual shock occurs ($\Delta_{\text{pHash}} > \text{burstThreshold}$), such as:
  - Low health flash (screen tinting red)
  - Opening inventory / dialogue / map screen
  - Entering a new visual zone or door
  - Boss or enemy entering field of view
- The gate fires an immediate prioritized reasoning turn so Airi can react spontaneously ("Look out!", "Nice shot!").

#### 3. User-Tuneable Sensitivity Profiles
Because game pacing varies drastically across titles, the Arcade Room settings drawer exposes tuneable profiles:

| Profile Preset | Target Games | Settle Window | pHash Delta Threshold | Min Cadence | Max Heartbeat |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Turn-Based / Puzzle** | *2048*, *Civilization*, *Sokoban*, *Oregon Trail* | 300 ms | 6 (High sensitivity to subtle UI changes) | 1,500 ms | 10,000 ms |
| **Real-Time / Fast Action** | *Doom*, *Wolfenstein 3D*, *Prince of Persia* | 150 ms | 22 (Filters camera bobbing, triggers on major visual shifts) | 800 ms | 3,500 ms |
| **Narrative / Visual Novel** | Dating Sims, Interactive Fiction, RPG dialogue | 200 ms | 12 (Triggers on text advance or portrait sprite swap) | 1,000 ms | 8,000 ms |
| **Custom Sliders** | Any custom or user-imported ROM | Slider (50–1000ms) | Slider (1–64 bits) | Slider (500–5000ms) | Slider (1–30s) |

---

## 7. Game Library Roadmap

### Phase 1: Zero-Dependency DOS & Web Classics
* **DOS (via JS-DOS WebAssembly)**:
  * *Doom / Doom II* (Shareware/Freeware): Classic 2.5D FPS action.
  * *Prince of Persia*: Precision 2D platforming with high visual clarity.
  * *Civilization I*: Turn-based strategy ideal for long-term planning and backseat debate.
  * *The Oregon Trail*: Text/graphical decision-making with high narrative humor.
* **HTML5 Canvas / Web**:
  * *2048*: Numerical puzzle solving; great for testing spatial logic.
  * *Sokoban*: Box-pushing puzzle benchmark.
  * *Flappy Bird / Runner*: Fast-reflex reflex testing.

### Phase 2: WebAssembly Console Emulation (No Python)
* Evaluate browser-native WebAssembly Game Boy emulators (e.g. `WasmBoy` or `binjgb-wasm`) to bring *Pokémon Red* and *Tetris* into the pure-web runtime without introducing Python/PyBoy sidecars.

---

## 8. Comparison: Upstream vs. Generic Gaming Runtime

| Capability | Upstream Approach | Proposed Generic Runtime |
| :--- | :--- | :--- |
| **Technology Stack** | Bespoke bot libraries (Node.js) + Factorio RCON | JS-DOS (WebAssembly) + HTML5 Canvas |
| **External Dependencies** | Node native modules, external game instances | Zero external installs; 100% in-process WebAssembly |
| **New Game Cost** | Weeks to months (bespoke protocol implementation) | Minutes (ROM / shareware file drag-and-drop) |
| **User Interaction** | Dry terminal chat or silent bot | Live backseat voice/chat banter with vocal fillers |
| **Avatar Integration** | None | Full Live2D / VRM emotions, acting cues, and gaze tracking |
| **Startup Overhead** | 20s blocking dependency discovery | Lazy on-demand WebAssembly initialization |

---

## 9. Implementation Phases

### Phase 1: Engine Foundation & JS-DOS Spike
- [x] **JS-DOS Wasm Integration**: Embedded `@emulators/dosbox` and browser canvas runner in `chat_arcade.vue` with 0 native sidecars.
- [x] **Classic Presets & Custom Imports**: Shipped 1-click presets (*SimCity 1989*, *Doom*, *Prince of Persia*, *Civilization*, *The Oregon Trail*, *2048*, etc.) plus custom `.zip`/`.jsdos` drag-and-drop loading and IndexedDB caching.
- [x] **Programmatic Key & Mouse Emulation**: Canvas-relative coordinate calculation, synthetic mouse click/drag dispatch, and keyboard injection.

### Phase 2: Cognitive Harness & Frame Pipeline
- [x] **Frame Capture & Normalization**: Canvas screenshot serialization to data URLs and downsampling for high-speed VLM ingestion.
- [x] **Structured Turn Planning (`ActionPlan`)**: System prompt constraining VLM responses to valid JSON plans containing step-by-step actions (`click`, `drag`, `key`, `wait`), spatial targets, and in-character spoken reactions.
- [x] **Dynamic VLM Resolution & Multi-Provider Safety Failover**: Integrated with Global Faculties Matrix (`facultyDefaultsStore.resolveFaculty('vision')`). Automatically routes turns through the user's configured vision model (e.g. OpenCode Go DeepSeek-V4 Flash Vision, OpenAI-compatible MiMo, Gemini Flash Lite) and automatically falls back to secondary providers on quota or network failure, while filtering out raw image taggers.

### Phase 3: Desktop Chatbox "Arcade Room" Integration (`chat_arcade.vue`)
- [x] **Navigation & Viewport**: Registered `'arcade'` route with side-by-side retro game viewport and backseat companion chat.
- [x] **Ghost Cursor Overlay**: Implemented `useGhostCursor` offering visible spatial feedback as Airi navigates menus and executes canvas actions.
- [x] **Pass to Airi & Auto-Play Modes**: Shipped single-turn delegation ("Pass to Airi") and continuous autonomous co-pilot loops with safety cancellation interlocks.
- [x] **Persona Banter & Action Cards**: Rendered rich execution status cards, action step pills, and companion voice reactions (`<|ACT:emotion="..."|>`) in the chat transcript.

---

### 9.1 Operational Milestone: SimCity (1989) Real-World Verification

The autonomous co-pilot architecture was empirically verified live in Electron running *SimCity (1989)* on DOSBox WASM:
1. **Visual Reasoning & Planning**: Airi inspected the canvas, identified an unpowered zone, and formulated a strategic opening play:
   > *"Alright, Mayor! This land is fresh and ready for a power grid backbone. I'll drop a Coal Power Plant right in that open field to spark our new city!"*
2. **Deterministic Canvas Dispatch**: Generated a verified multi-step sequence:
   * `Click (50, 430)`: Selected the Coal Power Plant icon from the left tool palette.
   * `Wait`: Allowed the game engine UI state to settle.
   * `Click (550, 500)`: Placed the structure centrally onto the map grid.
3. **Smooth Spatial Telemetry**: The visual ghost cursor tracked across the canvas to coordinates `(50, 430)` and `(550, 500)`, pulsing on contact, while the UI displayed "Moves executed on canvas!" and marked the action card as `Executed ✓`.

---

## 10. Open Questions & Design Considerations

> [!NOTE]
> **Shareware vs. User-Provided ROMs**:
> To keep AIRI legally clean and distributable, built-in presets only bundle open-source or shareware games (e.g. Doom Shareware, FreeDOS titles, open-source HTML5 games). A simple drag-and-drop `.zip` or `.rom` importer allows users to load their own preservation titles directly into IndexedDB.

> [!TIP]
> **Audio Ducking Latency**:
> By hooking directly into the WebAudio graph of the JS-DOS emulator, volume changes occur with <10ms latency when TTS starts, preventing companion dialogue from being drowned out by game music.
