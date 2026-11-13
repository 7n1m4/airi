# Daemon client (Slice A)

**Status:** accepted direction; only the transport slice is implemented.
**Scope:** `crates/airi-channel` Rust client; no daemon business logic yet.

## Decisions

1. **The daemon is the single owner of core state in daemon mode.** Slint must
   not run a competing `AppCore`/store writer while talking to the daemon.
   A thin bridge may keep a local fallback only until the daemon path is
   complete; after deletion, only one side owns the store.
2. **Client placement:** the gateway client lives in `crates/airi-channel`
   next to the server implementation and wire types — not in a new crate and
   not in `airi-slint`. This keeps the protocol, both sides, and the shared
   codec under one roof.
3. **Protocol evolution is additive.** Existing `auth`, `module:authenticate`,
   `ping`, `transport:connection:heartbeat` and `rpc` semantics do not change.
   Chat/memory/settings streaming requires a new event lane/frame, chosen
   before Slice C — it is not modelled in Slice A.
4. **`wss://` beyond loopback.** Plain `ws://` remains acceptable only on
   loopback. Remote slint/clients must use `wss://` with the locally minted
   CA, matching the server posture.
5. **Sequencing:** transport first (this slice), then a read-only core RPC in
   the daemon, then chat streaming, then memory/settings/cards migration. No
   bulk move of `airi-slint/src/bridges/*` into the daemon.

## Slice A (implemented here)

- RFC6455 client handshake over plain `ws://` or `wss://`.
- `GatewayClient::connect`, `authenticate`, `rpc`, typed `runtime_ping` /
  `runtime_status`, `close`.
- Integration tests against the real `ChannelServer`, including TLS.
- No reconnect policy, daemon wiring, UI, or token storage.

## Next slices

- **B.** Daemon owns `AppCore`; expose read-only core RPC/status; slint stays
  unchanged except health.
- **C.** Chat over WS (`chat.send` + streamed `chat.event` frames); slint
  gains daemon mode with fallback.
- **D.** Memory/settings/cards migrate; delete slint-side ownership.
