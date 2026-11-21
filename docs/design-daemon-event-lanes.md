<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Design: Event Lane — Spike Decision (airi-wxp.2.1)

**Status:** decided · **Date:** 2026-11-21 · **Owner:** project lead · **Bead:** airi-wxp.2.1 (P1)

## Decision

An "event lane" is **option (a): topic-based pub/sub within the existing WS gateway** — an additive server→client `event` frame family on the same authenticated WebSocket connection (`ws://:6121` loopback / forced `wss://` beyond loopback), opt-in via `event.subscribe` / `event.unsubscribe` RPC actions. Default is no subscriptions, so existing Vue/Electrobun clients see no new frames.

This is not option (b): no separate WS sub-protocol, no second connection, no per-lane port. It is not option (c): nothing else is introduced.

## What already exists (verified, no code change needed)

- `crates/anima-channel/src/wire.rs` — `EventTopic` enum (5 topics: `lip_sync.rms`, `emotion.tag`, `token.delta`, `presence.changed`, `status.changed`); `EventPayload` untagged enum mapping each topic to its typed payload struct; `GatewayEvent`; `GatewayServerFrame::Event { topic, data, id }`; subscribe/unsubscribe via `event.subscribe`/`event.unsubscribe` RPC actions; protocol version stays `airi-channel/1` (additive only).
- `crates/anima-channel/src/event_bus.rs` — shared `EventBus` + per-connection bounded `EventLane` (256 frames, drop-oldest; high-rate realtime topics evicted first). Thread-per-connection, lock-based, publishing never blocks on a socket.
- `crates/anima-daemon/src/gateway.rs` — `renderer_handlers(core)` registers `core.status` (Slice B, read-only), plus `providers.list`, `settings.get`, `settings.set`, `vault.status`. `core.status` replies AND publishes `status.changed` to all subscribed lanes via the shared `EventBus` (`with_event_bus(self.event_bus())`).
- `crates/anima-daemon/src/core.rs` — `CoreService::available()` / `snapshot()` / `status_reply()`: read-only, secret-free coarse health (`CoreStatusReply`).

## How core.status fits

`core.status` lives in **both** planes, deliberately:

| Plane | Mechanism | Semantics |
|-------|-----------|-----------|
| RPC (reply) | `renderer.handlers["core.status"]` | On-demand, request/response; returns `CoreStatusReply` or sanitized `Err("core unavailable: ...")`. No subscription needed. |
| Event lane (push) | `publisher.status_changed(...)` | Publishes `status.changed` (`StatusChangedData`) to every lane subscribed to that topic. Opt-in via `event.subscribe`. |

The event lane is separate from `core.status`: subscribing to `status.changed` is opt-in, default off, and never forces an existing client to receive events it did not ask for. `core.status` remains read-only — it never mutates state; it only reads a snapshot and publishes a health event.

## Why option (a)

- **Matches existing clients.** Godot, Flutter, and Vue are all thin WS clients on the same `ws://:6121` connection (design-flutter-godot-pivot.md decision table: one independent WS client per surface, view state only, daemon owns core state). Adding a second connection/sub-protocol buys nothing and doubles auth/TLS/binding surface.
- **One auth gate.** The first-message `authToken` handshake (close 1008 on failure) already gates every connection; the event lane is post-auth only, so no new trust boundary.
- **Additive.** Protocol version unchanged; existing frames, RPC actions, and error codes untouched; `status.changed` joins an already-typed, drift-checked specta schema exported to TS with golden JSON fixtures for Dart/C#.
- **Bounded backpressure.** Per-connection lanes mean a slow Godot or Flutter client cannot block the bus or other clients; overflow drops oldest realtime samples first.

## Relation to the threat model (design-daemon-gateway.md)

Same-uid session access is accepted (no polkit/caller allowlist on D-Bus; same model as the 0600 config file). The event lane adds no new secret exposure: `StatusChangedData` mirrors the `CoreStatusReply` discipline — no auth tokens, D-Bus tokens, provider configs, API keys, prompts, secret-revealing paths, or raw memory. LAN/VPN/tailnet clients still require `wss://` with the minted local CA.

## What stays for follow-up

- CA distribution/Ux to LAN clients (install/trust step not designed).
- Token rotation does not force-close live connections; kill-on-rotate needs tracked connection handles.
- Godot/Flutter hand-written codecs + golden JSON fixture conformance (tracked in airi-wxp.2.8).
- Wave 2 realtime pipeline (VAD/STT → LLM → TTS emitting token delta / amplitude / presence events); actual RMS rate to verify (~15–40 Hz in-tree tap).
- `Operator knob` `AIRI_DEVTOOLS_PEERS` for `route.bypass` devtools routing (implemented, undocumented).
