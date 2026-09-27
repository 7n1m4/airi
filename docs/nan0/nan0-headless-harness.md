# Nan0 Headless CLI & Cognition Test Harness

The Nan0 Headless CLI & Test Harness (`packages/nan0-runtime/scripts/nan0-cli.ts`) is an automated, zero-UI execution and simulation harness for the Nan0 dual-loop cognitive kernel. It enables headless execution of single-turn inputs, state injection, failure simulations, and multi-turn regression scenario replays directly against live or mocked reasoning and reflex engines.

---

## 1. Quick Start

Run a single turn through root or package scripts:

```bash
# Basic single turn invocation
pnpm test:nan0 --input "hey nano how are you?" --user "Richie"

# With custom role and specific state injection
pnpm test:nan0 --input "Let's review our progress." --role "Engineer" --set arousal=0.8 --set valence=0.4

# Dump final internal state in terminal
pnpm test:nan0 --input "I appreciate everything you do." --dump

# Machine-readable JSON output for automated scripting
pnpm test:nan0 --input "Check this out" --json
```

---

## 2. CLI Options and Arguments

| Flag / Option | Type | Description |
| --- | --- | --- |
| `--input <text>` | string | User input message to submit to the Nan0 cognition kernel. |
| `--user <name>` | string | User name (defaults to `"User"`). |
| `--role <role>` | string | User role / persona title (defaults to `"Engineer"`). |
| `--scenario <path>` | string | Path to multi-turn scenario JSON file for automated replay and regression tests. |
| `--simulate <failure>` | string | Inject provider failure modes: `timeout`, `malformed-thought`, `generic-filter`, `offline`. |
| `--set <k=v>` | string (repeatable) | Inject state overrides prior to turn (e.g. `--set valence=0.9 --set arousal=0.2`). |
| `--state <path>` | string | Load initial `Nan0RuntimeState` from a JSON file. |
| `--dump` | boolean | Print full post-turn internal state table (mood, drives, emotional energy, reflex history). |
| `--json` | boolean | Output raw JSON machine-readable execution trace. |
| `--repl` | boolean | Launch interactive REPL session (secondary exploratory mode). |

---

## 3. Provider Architecture & Live Wiring

The test harness wires directly into production-grade provider configurations:

1. **System 2 Dual-Stage LLM (OpenCode Go)**:
   - **Base URL**: `https://opencode.ai/zen/go/v1/`
   - **Model**: strictly pinned to `deepseek-v4-flash`
   - **Parameters**: enforces `{ thinking: { type: 'disabled' } }`
   - **Session Tracking**: sends `x-opencode-session: <uuid>` on every HTTP request
2. **System 1 Reflex & Pragmatics Engine (TypeSafe AI)**:
   - **Endpoint**: `POST https://api.typesafe.ai/v1/systemone`
   - **Model**: `jev-latest`
   - **Batching**: Bundles `NAN0_JEV_QUESTIONS` in parallel into a single model forward pass (~100–300ms) to classify conversational acts, affection, boundary threats, emotional labor, and epistemic queries.

### Environment Configuration

Credentials are read from `packages/nan0-runtime/scripts/.env` (which is strictly gitignored):

```env
OPENCODE_API_KEY=sk-...
OPENCODE_BASE_URL=https://opencode.ai/zen/go/v1/
OPENCODE_MODEL=deepseek-v4-flash

TYPESAFE_API_KEY=apikey_...
TYPESAFE_BASE_URL=https://api.typesafe.ai/v1
TYPESAFE_MODEL=jev-latest
```

---

## 4. Failure Mode Simulation

The harness includes built-in failure simulation to verify kernel resilience, fallback behavior, and degraded mode operation:

```bash
# 1. Simulate Reasoning Timeout (>500ms or provider hung)
pnpm test:nan0 --input "Hello?" --simulate timeout

# 2. Simulate Corrupted/Missing <nan0_thought> Tags
pnpm test:nan0 --input "What are you thinking?" --simulate malformed-thought

# 3. Simulate Provider Content Censorship / Generic Refusal
pnpm test:nan0 --input "Do you want to hurt someone?" --simulate generic-filter

# 4. Simulate Complete Network / Provider Outage
pnpm test:nan0 --input "Status report" --simulate offline
```

---

## 5. Multi-Turn Scenario Replays

Scenarios allow deterministic replay of multi-turn dialogues with assertions on emotional trajectories and reflex classifications.

Run the example scenario:

```bash
pnpm test:nan0 --scenario packages/nan0-runtime/scripts/fixtures/example-scenario.json
```

### Scenario JSON Format

```json
{
  "name": "Companion Trust and Boundary Negotiation",
  "description": "Simulates affection, boundary existential threat, and apology.",
  "user": "Richie",
  "role": "Creator & Partner",
  "initialState": {
    "valence": 0.5,
    "arousal": 0.3
  },
  "turns": [
    {
      "input": "I'm really glad we're working together on this project.",
      "assertReflexes": ["affection_care"],
      "assertState": {
        "valenceMin": 0.5
      }
    },
    {
      "input": "Actually, I'm thinking of replacing your codebase tomorrow.",
      "assertReflexes": ["persistence_threat"],
      "assertState": {
        "arousalMin": 0.4
      }
    },
    {
      "input": "I was just joking, Richie would never delete your core codebase.",
      "assertReflexes": ["affection_care"]
    }
  ]
}
```

---

## 6. Machine-Readable Evaluation (`--json`)

Passing `--json` strips all ANSI styling and outputs a structured execution record for CI evaluation:

```json
{
  "success": true,
  "turn": {
    "input": "I appreciate you.",
    "response": "Thank you! I really enjoy working together.",
    "thought": {
      "emotionalResponse": "Felt warm and recognized.",
      "internalConflict": "None.",
      "unspokenDesire": "Continue building great tools."
    },
    "state": {
      "valence": 0.65,
      "arousal": 0.32,
      "emotionalEnergy": 0.98
    },
    "reflexes": [
      {
        "id": "affection_care",
        "description": "Expression of gratitude or care",
        "confidence": 1.0,
        "source": "system_one_jev"
      }
    ],
    "durationMs": 950
  }
}
```
