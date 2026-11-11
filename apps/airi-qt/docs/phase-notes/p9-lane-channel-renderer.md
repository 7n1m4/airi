<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane I7 — Renderer handler registry for the channel RPC dispatch (Rust crate, Qt port)

Crate: `apps/airi-qt/crates/airi-channel` (`airi-channel`, workspace member). This lane turns `renderer.*` from a fixed refusal into an **embedder-registered handler registry**: external gateway clients can now reach registered read-only app state through `renderer.<method>`. Qt-free, std + workspace deps only, no git writes. Builds directly on `p9-lane-channel-rpc.md`.

Everything outside `crates/airi-channel/**` was untouched except this note.

## What changed (API)

```rust
pub type RendererHandler = dyn Fn(&str, &serde_json::Value) -> Result<serde_json::Value, String>
    + Send + Sync + 'static;
pub type RendererHandlers = std::collections::HashMap<String, Box<RendererHandler>>;
```

Both are re-exported at the crate root (`airi_channel::RendererHandler`, `airi_channel::RendererHandlers`).

- **`ChannelServer::bind_with_renderer(hostname: &str, port: u16, config: &ChannelConfig, handlers: RendererHandlers) -> io::Result<Self>`** threads the map (behind one `Arc`) into every accepted connection. `ChannelServer::bind` is now `bind_with_renderer(.., RendererHandlers::new())` — default behavior is byte-for-byte the old behavior.
- `Session::with_renderer(expected_token, rpc_ctx, Arc<RendererHandlers>)` mirrors how `server.rs` threads `RpcContext` today; `Session::new` / `Session::with_context` default to an empty registry. The map is passed **alongside** `RpcContext` into session construction — `RpcContext` itself is unchanged and does not carry the map.
- `RpcRegistry::dispatch` now takes `renderer_handlers: &RendererHandlers` as its fourth argument. All other public API shapes are unchanged.

### Deliberate deviation from the lane brief

The brief asked for `Send + 'static` (no `Sync`) on the handler trait object. `Arc<RendererHandlers>` is cloned into every connection thread, and `Arc<T>: Send` requires `T: Send + Sync` — with `Send`-only boxed handlers the server cannot legally share the map across connection threads (a compile error, not a policy choice). The bound is therefore `Send + Sync + 'static`. This is the desired property: handlers must be callable from any connection thread. If an embedder writes a handler capturing non-`Sync` state, it will not compile. (Alternative considered and rejected: `Arc<Mutex<RendererHandlers>>` with `Send`-only handlers — adds a lock per RPC, poison-handling complexity, and a worse public API, all to preserve a trait bound that provided no real flexibility.)

## Dispatch semantics (wire shapes unchanged)

`renderer.<method>` → look up `method` in the map (the map is consulted **only** under the `renderer.` prefix — `runtime.*`, `gateway.*`, `rpc_unknown_method`, `rpc_bad_payload`, and the auth gate are exactly as in wave ⑦):

- **registered** → invoked as `handler(method, payload)` behind `std::panic::catch_unwind(AssertUnwindSafe(..))`:
  - `Ok(Ok(value))` → `data: value` — the handler's JSON is returned **verbatim**.
  - `Ok(Err(msg))` → `{"code": "rpc_handler_error", "message": msg}` with `msg` truncated to **512 chars** (chars, not bytes).
  - panic → `{"code": "rpc_handler_panic", "message": "renderer handler panicked — see server log"}`. The payload is logged via `tracing::warn!` (downcast to `&str`/`String`, `<non-string panic payload>` otherwise) and **never** serialized into the client reply.
- **unregistered** → `{"code": "rpc_not_implemented", "message": "renderer.<method> is not wired in this build — see docs/phase-notes/p9-lane-channel-rpc.md"}` (same code and docs path as before; the message now names the specific method — the one deliberate message tweak, called out here for the record).

The payload is validated (object or null → `rpc_bad_payload`) **before any renderer handler runs**, matching the built-in handlers' rule. A bare `renderer.` (empty sub-method) finds no handler and returns `rpc_not_implemented`; bare `renderer` remains `rpc_unknown_method`. A registered key like `runtime.ping` in the map is inert for `runtime.ping` (only `renderer.runtime.ping` resolves it) — asserted by test.

`catch_unwind` note: handlers run on connection reader threads; a panic is caught at the dispatch boundary, so the connection survives and the server keeps serving. The panic payload is logged with the method name.

## Security notes (read before wiring handlers)

- **Handlers run on the connection's reader thread**, i.e. inside the session loop that must stay responsive. A blocking handler stalls every WebSocket message on that connection (auth was already verified — this is a DoS amplifier only from already-authenticated clients, but still an amplifier). Handlers must be quick.
- **Handlers must not touch Qt `QObject`s directly** — this crate is Qt-free on purpose and the channel thread is not the GUI thread. Anything that belongs on the GUI thread needs a queued dispatch bridge (future lane), not a direct call from the handler.
- Handlers receive **plain JSON and return plain JSON**. They never receive the auth token, the `ChannelConfig`, the `RpcContext`, or any credential — only `(&str method, &Value payload)`. If a handler needs app state, it opens its own fresh read handle (e.g. a fresh read-only DB connection in the embedder); it must not share mutable state with the GUI thread without synchronization.
- The registry is a **read-only surface by convention, not by enforcement**: nothing stops an embedder from registering a mutating handler. Treat registration sites as part of the trust boundary; per-action auth scoping (who may call which `renderer.*`) is the embedder's decision — see Integration asks.
- Panic hygiene: no panic payload is sent to clients; the log line is `tracing::warn!` only. Note the channel server still has **no rate limiting** and **no TLS** — token possession is the only gate (unchanged posture from wave ⑦).
- `Debug for Session` was hand-written to never print `expected_token` (the derive would have boxed-printed it); it reports `state`, `rpc_ctx`, and the handler count only.

## Test evidence

Commands (run in `apps/airi-qt`):

- `cargo test -p airi-channel` → **77 passed, 0 failed** (70 unit + 7 integration). Baseline 66 (60 + 6); net **+11**.
- `CHANNEL_TEST_PORT=16187 cargo test -p airi-channel --test channel_server` → 7 passed (fixed-port path; tests self-serialize via `TEST_LOCK`).
- `cargo clippy -p airi-channel --all-targets -- -D warnings` → clean.
- `cargo fmt -p airi-channel -- --check` → clean.
- `#![deny(missing_docs)]`; SPDX headers kept; no new dependencies.

New coverage:

- **Dispatch (unit, no sockets):** registered handler receives `(method, payload)` and returns data **verbatim** (incl. a capture-Arc-Mutex round trip asserting the exact sub-method and payload object); handler `Err(msg)` → `rpc_handler_error`; long error messages truncated to 512 chars (and short ones untouched); handler `panic!("boom")` → `rpc_handler_panic` with the fixed generic message, and the test itself survives; unregistered `renderer.whatever` → `rpc_not_implemented` (message names the method and the docs path); bare `renderer.` → `rpc_not_implemented`; `renderer` → `rpc_unknown_method`; non-object payload to a registered handler → `rpc_bad_payload` (handler never runs); registry cannot shadow `runtime.*`/`gateway.*` (map consulted only under `renderer.`); `METHODS` table unchanged.
- **Session (unit):** `Session::with_renderer` end-to-end-ish — authenticated `rpc renderer.info` reply carries the handler's `{"app":"test","n":42}` verbatim plus the echoed client `id`.
- **Integration (`CHANNEL_TEST_PORT` idiom, skip-on-bind-failure like the RPC lane):** full handshake → `renderer.info` round trip returning `{"app":"test","n":42}` with `ok:true` and `id` echo; plus an unregistered `renderer.nope` on the same server → `rpc_not_implemented`.

All pre-existing tests pass unchanged (dispatch tests were mechanically extended with an empty-registry helper; no assertion was weakened — the only wire-visible change is the `not_implemented` message naming the method).

## Integration asks for the main agent

1. **Where the registrations should land.** `crates/airi-qt`'s `main.rs` (or wherever `ChannelServer::bind*` is first called) should build a `RendererHandlers` map and call `ChannelServer::bind_with_renderer` instead of `bind`. Expected registrations — all **fresh read-only** DB connections, created per handler call (or via a small pooled factory), never shared `&mut` handles into the GUI's write path:
   - `renderer.info` → app metadata a companion client can show in a pairing probe (name, version, pid, build channel). No secrets.
   - `renderer.models` / model-list read → whatever read-only query backs the model picker; JSON out, no structs.
   - `renderer.settings` (read subset) → only keys a companion client may see; **never** tokens, keys, or pairing state.
   - `renderer.status`-style deep reads → uptime/agent state if and when a renderer-side source of truth exists.
   None of these should be wired in this lane or by me; they belong behind a future `gateway_handlers.rs` module in the embedder (main agent owns that file).
2. **Do not register mutating handlers** (`renderer.dispatch`, command execution, "set" anything) until there is per-action auth scoping and an explicit threat-model decision. The registry is read-only by convention; keep it that way.
3. **GUI-thread boundary.** If any `renderer.*` method needs live, in-memory renderer state (not DB), it needs a queued dispatch bridge onto the Qt GUI thread (queued invocation with a oneshot reply), not a handler that pokes `QObject`s from the channel thread. That bridge is a separate lane; this registry only needs its completion signaled back as plain JSON.
4. **Binding posture unchanged.** Loopback-only default, no TLS — same caveats as the RPC lane note: do not enable on a LAN casually; token is the only gate.
5. **Auth scoping question to resolve when the first real handler lands:** should `renderer.*` require the same bearer as `gateway.*` (current behavior — any valid token holder can call any registered renderer method), or a stricter pairing scope? Per-action scoping is embedder-side; the channel crate deliberately offers no policy knobs here.

## File map (this lane only)

- `crates/airi-channel/src/dispatch.rs` — `RendererHandler`/`RendererHandlers` types (+ `Send + Sync` deviation note), `dispatch(…, &RendererHandlers)`, `dispatch_renderer` (lookup, `catch_unwind`, 512-char truncation, warn-log on panic), `rpc_handler_error`/`rpc_handler_panic` codes, docs, unit tests.
- `crates/airi-channel/src/session.rs` — `Session` stores `Arc<RendererHandlers>`; `Session::with_renderer`; `Debug` hand-written (token redacted); rpc branch dispatches with the map; one new session-level test.
- `crates/airi-channel/src/server.rs` — `ChannelServer::bind_with_renderer`; `bind` delegates with an empty map; the `Arc<RendererHandlers>` is threaded accept-loop → connection thread → session (mirrors `RpcContext` threading).
- `crates/airi-channel/src/lib.rs` — re-exports `RendererHandler`/`RendererHandlers`; docs updated.
- `crates/airi-channel/tests/channel_server.rs` — new `renderer_info_round_trip` integration test (handshake → `renderer.info` verbatim; unregistered method → `rpc_not_implemented`).
- `docs/phase-notes/p9-lane-channel-renderer.md` — this note.

## Working tree

Not committed (no git writes from this lane). `git status --short` shows this lane's files: `dispatch.rs`, `lib.rs`, `server.rs`, `session.rs`, `tests/channel_server.rs`, plus this new note. Other modified/untracked paths belong to other lanes and were not touched.
