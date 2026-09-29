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
* **Right Panel Behavior**: In `chat.vue`, `showRightPanel` is explicitly restricted to `activeSurface === 'messages'`. Selecting `'Arcade Room'` reclaims the entire window canvas width, giving optimal real estate for the game and chat split.

### 5.2 Side-by-Side Layout Wireframe

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [≡] AIRI - Chat Window [Arcade Room]                                                      [⚙] [_][□][X]│
├─────────────────┬────────────────────────────────────────────────────┬─────────────────────────────────┤
│  WORKSPACE      │             GAME VIEWPORT (65% Width)              │    BACKSEAT CHAT (35% Width)    │
│                 │ ┌────────────────────────────────────────────────┐ │ ┌─────────────────────────────┐ │
│ 💬 Chat View    │ │                                                │ │ │ 🌸 AIRI                     │ │
│ 📹 Director     │ │              JS-DOS / RETRO CANVAS             │ │ │ "Alright, let's see what    │ │
│ 📖 World Bible  │ │             (Doom / Civ I / 2048)              │ │ │ this game is all about!"    │ │
│ 🎨 Studio       │ │                                                │ │ │ <|ACT:emotion="smug"|>      │ │
│ 📁 Media        │ │                    [ 4:3 ]                     │ │ ├─────────────────────────────┤ │
│ 🧬 Thread       │ │                                                │ │ │ 👤 You                      │ │
│ 📜 Event Ledger │ │                                                │ │ │ "Watch out behind you,      │ │
│ 📝 Notes        │ │                                                │ │ │ there's an explosive barrel"│ │
│ 🎬 Rehearsal    │ ├────────────────────────────────────────────────┤ │ ├─────────────────────────────┤ │
│ 🕹️ Arcade Room  │ │ [Preset: Doom Shareware ▼] [Restart] [Savestate]│ │ │ 🌸 AIRI                     │ │
│                 │ │ Mode: [● AI Playing] [○ You Play] [🔊 ────○──] │ │ │ "Wait, where?! Don't yell   │ │
│ ─────────────── │ └────────────────────────────────────────────────┘ │ │ at me, I'm aiming!"         │ │
│ ⚙️ Settings     │   Tips: Use [Space] to pause; LLM plays in bursts.  │ │ <|ACT:emotion="panicked"|>    │ │
│                 │                                                    │ ├─────────────────────────────┤ │
│                 │                                                    │ │ [ Backseat advice...      ] │ │
│                 │                                                    │ │ [Careful!] [Shoot!] [Heal!] │ │
│                 │                                                    │ └─────────────────────────────┘ │
└─────────────────┴────────────────────────────────────────────────────┴─────────────────────────────────┘
```

### 5.3 Dual Play Modes
The Arcade Room supports two interactive modes selectable via a toggle:
1. **AI Autopilot (Agent Plays, User Backseats)**:
   * The cognitive harness reads the canvas, selects discrete actions, and sends synthetic inputs.
   * The user types or speaks backseat tips into the minimal chatbox.
   * AIRI debates, panics, or listens, streaming dialogue into the chat transcript and TTS runtime.
2. **Co-Pilot / Spectate (User Plays, Agent Backseats You)**:
   * The user clicks into the game canvas and plays directly using standard keyboard/mouse controls.
   * The cognitive harness runs in spectator mode (sampling frames every 3–5 seconds or on major state shifts via lightweight OCR).
   * AIRI acts as your live personal gaming companion, cheering your victories, gasping at near-misses, and roasting your deaths!

### 5.4 The Cognitive Path Picker & Two-Tier Semantic Architecture

When launching an Arcade session, users are not forced into a one-size-fits-all model. Because AIRI cannot magically extract internal RAM pointers or symbol tables from 8,000 legacy DOS binaries on the fly, the runtime decouples gaming cognition into a **Two-Tier Semantic Architecture**:

```mermaid
flowchart TD
    Launch[User Launches DOS / Canvas Game in Arcade Room] --> CurationCheck{Catalog Jev Metadata}

    CurationCheck -->|Turn-Based / Strategy / Puzzle| RecA[Path A Recommended: System 2]
    CurationCheck -->|Arcade / Reflex / Platformer / 2D Grid| RecB[Path B Recommended: System 1]

    RecA --> PathPicker{Cognitive Engine Path Picker}
    RecB --> PathPicker

    PathPicker -->|Path A: Deliberative Strategy & Puzzles| S2[System-2 Multimodal Loop\nVLM -> CoT Reasoning -> Action Plan -> Execute\nLatency: 800ms - 2,500ms]

    PathPicker -->|Path B: Real-Time Reflex Copilot| S1Workflow["'Help Me Help You' Demonstration\nUser plays 15s -> Collector traces deltas & keys"]

    S1Workflow --> LLMCompiler[System-2 LLM Compiler\nSynthesizes 'Mini Program' Visual State Machine Interpreter]

    LLMCompiler --> S1Sandbox[60-Second Sandboxed Safety Test\nAdaptive Lookahead Cadence + Jev Choice]

    S1Sandbox --> Confirm{"User Approves?"}
    Confirm -->|Yes| PersistStore["Atomic Persistence in IndexedDB\n(local:arcade_knowledge:game_id)"]
    Confirm -->|Refine| S1Workflow
```

#### 5.4.1 The "Semantic Experience" of Pair Gaming
In this architecture, the user enjoys a natural, cohesive semantic relationship with their companion:
1. **The User interacts with System 2**: You converse, strategize, and joke with AIRI's conscious persona in the backseat chat.
2. **System 2 manages its own System 1 interface**: System 2 observes human play, diagnoses the rules of the game, writes a specialized "Mini Program" (visual state machine interpreter), and commands System 1 as its high-speed motor reflexes.
3. **The Illusion of Unified Play**: Technically, System 2 is not executing the 100ms reflex loop directly. However, because System 2 synthesized the state machine, monitors the game's health, and chimes in with live vocal commentary, the user genuinely experiences their companion playing alongside them with authentic agency.

#### 5.4.2 Doing Our Homework: Jev Catalog Batch Curation Pass
Rather than forcing users to guess which engine suits an unfamiliar 1989 shareware title, Project AIRI applies **TypeSafe Jev** to perform an offline batch curation pass over the 8,900+ MS-DOS preservation catalog:
- **Triage Query**: Evaluates game title, year, developer, and archive metadata into:
  - `tempo`: `turn_based` | `real_time_reflex` | `narrative_text`
  - `input_modality`: `keyboard_arrows` | `mouse_pointer` | `complex_keypad`
  - `visual_architecture`: `cga_text_mode` | `vga_graphics_mode` | `vector_3d`
- **Recommended Path Badging**:
  - *Civilization*, *SimCity*, *Oregon Trail*, *2048*, *Sokoban* $\rightarrow$ **Recommended: Path A (System 2)**.
  - *Nibbles*, *Digger*, *Pac-Man*, *Prince of Persia*, *Doom*, *Wolfenstein 3D* $\rightarrow$ **Recommended: Path B (System 1)**.
- The Path Picker modal clearly highlights the recommended engine while preserving full user agency to toggle modes.

---

#### 5.4.3 Path A: System-2 Deliberative Strategy Engine (Existing Operational Mode)
- **Target Games**: Turn-based strategy (*SimCity 1989*, *Civilization*), point-and-click adventures (*The Secret of Monkey Island*), numerical puzzles (*2048*).
- **Execution Pipeline**:
  $$\text{Canvas Frame} \xrightarrow[\text{Capture}]{<5\text{ms}} \text{VLM Reasoning (CoT)} \xrightarrow[\text{ActionPlan JSON}]{800\text{ms}-2,500\text{ms}} \text{Ghost Cursor Dispatch}$$
- **Characteristics**: High spatial context, zero pre-configuration required, tolerates complex graphical UI palettes, authentic spoken monologues explaining moves to the user.

---

#### 5.4.4 Path B: System-1 High-Speed Reflex Engine (Self-Synthesizing Mini Program)
- **Target Games**: Real-time arcade titles, 2D grid mazes, platformers, action shooters (*Nibbles*, *Digger*, *Prince of Persia*, *Doom*).
- **The Challenge**: Querying a multimodal LLM on every frame causes 1,500ms latency ($1,000s/month), causing the player to crash instantly. Conversely, Jev is non-autoregressive and blind to raw pixels.
- **The Solution**: The **"Help Me Help You" Demonstration & Mini Program Synthesis Workflow**.

##### Step 1: The Demonstration ("Help Me Help You")
When Path B is selected for an unmapped title, AIRI prompts:
> *"I haven't played this one yet! Play one quick 15-second round so I can observe how the game moves and learn the rules."*

1. The user clicks **Record** (invoking `collector.start()`).
2. The user plays for 10–20 seconds using normal keyboard controls.
3. The lightweight runtime collector samples the canvas/framebuffer at 10 Hz:
   - Captures $80 \times 40$ binary grid deltas ($\Delta = \text{Frame}_t - \text{Frame}_{t-1}$).
   - Records active keypresses (`['ArrowUp']`, `['ArrowLeft']`, `[' ']`).
   - Dedupes identical resting frames.
4. User clicks **Stop** (`collector.end()`), yielding a compact JSON trace (~20–40 KB).

##### Step 2: The LLM Compiler (Synthesizing the "Mini Program")
The System-2 LLM receives the raw trace JSON and functions as a **metaprogramming compiler**:
1. **Entity & Velocity Attribution**:
   - The pixel that turns to `1` each frame without an erasing counterpart is the **Agent Head**.
   - $\vec{v} = \text{Head}_t - \text{Head}_{t-1}$ determines the cardinal **Heading Vector** (`UP`, `DOWN`, `LEFT`, `RIGHT`).
   - Isolated pixels appearing without movement are identified as **Targets/Objectives** (e.g. food numbers).
   - Sudden multi-pixel surges in a fixed bounding box (e.g. 80 pixels appearing at rows 16–20) are classified as **Game Over / Death Modals**.
2. **Mini Program Generation**:
   The LLM writes a pure JavaScript visual state machine interpreter:
   ```javascript
   // Synthesized Game Knowledge Interpreter
   export function extractGameState(currentGrid, lastGrid, lastState) {
     const head = detectLeadingPixel(currentGrid, lastGrid)
     const heading = computeVelocityVector(head, lastState?.head)
     const obstacles = scanRadialRays(currentGrid, head, heading)
     const target = locateNearestStaticTarget(currentGrid, head)

     return {
       snapshot: `Agent at (${head.x}, ${head.y}) moving ${heading}. Ahead: ${obstacles.ahead}. Left: ${obstacles.left}. Right: ${obstacles.right}. Target: ${target.direction} (dist: ${target.distance})`,
       isDead: detectBoundingBoxSurge(currentGrid, [23, 16, 55, 20]),
       head,
       heading
     }
   }
   ```
3. **Jev Choice Schema Formulation**:
   The LLM compiles the discrete action space with calibrated consequence framing:
   ```json
   {
     "maneuver": {
       "type": "choice",
       "instructions": "Select the immediate steering maneuver to avoid collision and navigate toward target.",
       "criteria": {
         "TURN_LEFT": "Commit turn into open corridor (Safest path)",
         "TURN_RIGHT": "Commit turn into obstacle (Fatal collision)",
         "HOLD_STRAIGHT": "Continue straight ahead into wall (Fatal collision)"
       }
     }
   }
   ```

##### Step 3: Adaptive Lookahead & Latency Compensation
Execution latency differs fundamentally across inference backends:
- **Laya Local (WASM / WebGPU)**: $15\text{ms} - 35\text{ms}$ RTT $\rightarrow$ 20–30 Hz execution.
- **TypeSafe Jev (OpenRouter Alpha)**: $90\text{ms} - 150\text{ms}$ RTT $\rightarrow$ 5–10 Hz execution.

To prevent overshooting obstacles while awaiting a network packet:
1. The engine tracks the rolling round-trip time ($\tau_{\text{RTT}}$).
2. The state extractor projects the agent's velocity vector forward by $\Delta t = \tau_{\text{RTT}}$.
3. It asks Jev: *"At your projected position in $\tau_{\text{RTT}}$, which steering maneuver do you commit to?"*
4. Between query ticks, the emulator executes the **Carry-Hold Pattern**, holding the last validated steering input so the game physics remain smooth and free of micro-stutter.

##### Step 4: 60-Second Sandboxed Safety Test Run
- AIRI announces: *"Got it! Let me try!"*
- The runtime sends the initial start key (e.g. Space) and begins executing the synthesized loop.
- **Safeguard Watchdog**:
  - A strict **60-second execution ceiling** prevents runaway loops or unintended background consumption.
  - Automatically suspends if unhandled exceptions occur, or when `isDead` evaluates to true.
- Backseat advice from the chat composer (*"Watch out behind you!"*, *"Save ammo!"*) injects directly into Jev's live state snapshot in real time.

##### Step 5: Permanent "Game Knowledge" Persistence
- When the run completes, the UI prompts: *"Did Airi play well?"*
- Upon user confirmation, the compiled Mini Program, key mappings, and Jev schema are saved atomically into IndexedDB under `local:arcade_knowledge:<game_identifier>`.
- Any subsequent launch of that title instantly loads the Game Knowledge profile—enabling AIRI to play with instant native reflexes with zero re-calibration.

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
