# Nan0 Runtime: Milestones 1–5 Local Starter

This package is intentionally local-first. Copy `packages/nan0-runtime` into the AIRI workspace and test without pushing.

## Implemented

1. Package scaffold and typed contracts.
2. Observation → kernel → expression message path.
3. Provider-neutral reasoning client call.
4. Explicit port seam for the Python cognition pipeline.
5. Local persisted state plus versioned legacy-memory import.

## Not yet equivalent to the Python Nan0

The current context builder and memory retrieval are deliberately minimal. They prove the route works. Replace them with the existing Python behavior after providing the Python source and representative database export.

## Local commands

```bash
pnpm install
pnpm --filter @proj-airi/nan0-runtime typecheck
pnpm --filter @proj-airi/nan0-runtime build
pnpm dev:tamagotchi
```

## Local observability

Nan0 diagnostics are disabled by default. Set `NAN0_DEBUG=true` before starting the Electron app to enable the local observatory. Console and JSONL output default to enabled once debugging is on; individual controls are:

```text
NAN0_DEBUG_CONSOLE=true
NAN0_DEBUG_JSONL=true
NAN0_DEBUG_PRIVATE_THOUGHTS=false
NAN0_DEBUG_VERBOSE=false
NAN0_DEBUG_LOG_DIR=logs
```

Relative log directories resolve beneath Electron's user-data directory. JSONL files are named `nan0-kernel-YYYY-MM-DD.jsonl`. Private narrative text remains excluded unless `NAN0_DEBUG_PRIVATE_THOUGHTS=true`; diagnostics never enter chat, TTS, rendering, or memory.

## Host wiring

Create an AIRI-specific `Nan0ReasoningClient` that calls the current xsAI generation path. Then create `CallbackHostBindings` and feed AIRI chat messages through `emitObservation()`.

Do not push until the package typechecks and AIRI still starts.
