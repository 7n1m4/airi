# Nan0 Cognition Runtime

The standalone, TypeScript-native port of Nan0 cognition integrated into AIRI.

For architectural decisions, deep-dive specifications, and the heuristic-elimination journey, read **[ARCHITECTURE-SYSTEM1-UPGRADE.md](./ARCHITECTURE-SYSTEM1-UPGRADE.md)**.

## Architecture Highlights

1. **System 1 (Jev Fast Decisions)**: Mandatory non-autoregressive discrete triage evaluated in ~100–150ms per forward pass, powering conversational continuity, relationship evidence, emotional perturbation, and boundary defense.
2. **System 2 (Consciousness & Outward Speech)**: Dual-pass reasoning client driving internal private thought monologue followed by outward speech generation.
3. **Continuity & Threads**: Neural topic routing without heuristic regex pattern matching.
4. **Relationship Memory**: Evidence classification mapping directly to PCL belief assertions, commitments, breaches, and repairs.
5. **Autonomy & Metabolism**: Temporal event tracking, pending intentions, and proactive idle heartbeats.

## Local Commands

```bash
# Typecheck
pnpm --filter @proj-airi/nan0-runtime typecheck

# Unit Tests (Hermetic, deterministic, offline via mock System 1 fixtures)
pnpm --filter @proj-airi/nan0-runtime test

# Headless CLI Test Harness (Interactive REPL or scripted scenarios)
pnpm --filter @proj-airi/nan0-runtime run harness
pnpm --filter @proj-airi/nan0-runtime run harness --scenario scripts/fixtures/example-scenario.json
```

## Observability & Diagnostics

Set `NAN0_DEBUG=true` before starting the application or harness to enable the local observatory:

```text
NAN0_DEBUG_CONSOLE=true
NAN0_DEBUG_JSONL=true
NAN0_DEBUG_PRIVATE_THOUGHTS=false
NAN0_DEBUG_VERBOSE=false
NAN0_DEBUG_LOG_DIR=logs
```
