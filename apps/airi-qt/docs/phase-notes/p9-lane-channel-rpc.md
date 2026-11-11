<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane I3 — Gateway channel RPC dispatch (Rust crate, Qt port)

Crate: `apps/airi-qt/crates/airi-channel` (`airi-channel`, workspace member). This lane replaces the old `rpc` payload-echo **placeholder** with a typed RPC dispatch registry — a real, testable slice of the AIRI gateway protocol — while keeping the wire envelope the channel server has always spoken. Nothing outside `crates/airi-channel/**` was touched (plus this note).

Reference (read-only): Electron's channel server (`apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts`) — it contains **no RPC dispatch either** (the `rpc` path in the crate predates any upstream analog), so there was nothing to mirror at scale; the dispatch layer here is crate-local by design. `packages/server-runtime/src/server/index.ts` likewise has no `rpc` handler.

## Envelope (unchanged shape, now with dispatch)

```text
client → { "type": "rpc", "action": "<method>", "payload": {…}, "id": "<optional client id>" }
server → { "type": "rpc", "action": "<method>", "ok": true,  "data": …,                   "id": "<echoed>" }
server → { "type": "rpc", "action": "<method>", "ok": false, "error": { "code": "…", "message": "…" }, "id": "<echoed>" }
```

- `payload` is optional; absent/`null` is treated as `{}`. A **present** payload must be a JSON object, otherwise `rpc_bad_payload`.
- `id` is echoed verbatim (any JSON value) when the client sent one; omitted otherwise.
- Success replies carry `data` (not the old placeholder `payload` echo). This is the one deliberate wire change; the two placeholder-era tests were updated to the new contract (see Test evidence).
- `action` must be a non-empty string; otherwise the pre-dispatch `invalid_rpc` typed error frame is returned (unchanged behavior).

## Handler table

| Method           | Result `data` shape | Notes |
|------------------|---------------------|-------|
| `runtime.ping`   | `{ "pong": true, "time": <unix secs>, "uptimeSeconds": <secs since server start> }` | Liveness probe; `time` is wall-clock, `uptimeSeconds` is monotonic (`Instant`). |
| `runtime.status` | `{ "app": "airi-qt", "version": <CARGO_PKG_VERSION>, "pid": <u32>, "uptimeSeconds": <secs>, "protocol": "airi-channel/1" }` | Build/process info. `protocol` is the `PROTOCOL` const (`airi-channel/1`). |
| `gateway.config` | `{ "hostname": <str>, "port": <number> }` | **Never includes `authToken`** — replies are constructed from an explicit 2-field map, not from the config struct, and a unit test asserts exactly two keys. The token stays server-side; pairing UX reads the config file, not this RPC. |
| `gateway.auth`   | `{ "authenticated": true, "sessionStartedMs": <ms since Unix epoch> }` | Relies on the mandatory prior handshake; handlers run only after auth, so `authenticated` is unconditionally `true`. No new secrets, no token echo. |
| `renderer.*`     | — | Always `rpc_not_implemented` (see below). |
| anything else    | — | `rpc_unknown_method`. |

All handlers are pure functions over `RpcContext` (hostname, bound port, server-start `Instant`, per-session `session_started_ms`) plus the payload — no sockets, no filesystem, no external IO. Dispatch is a plain `match` in `RpcRegistry::dispatch`; no trait objects, no dynamic registration. `RpcRegistry::METHODS` lists the implemented methods.

The server (`server.rs`) builds one `RpcContext` at `bind()` time (port `0` resolves to the OS-assigned ephemeral port, so `gateway.config` reports the real port) and stamps a fresh `session_started_ms` per accepted connection via `RpcContext::for_session`. `Session::new` keeps its default loopback/`DEFAULT_PORT` context for pure unit tests; `Session::with_context` is what the live server uses.

## Error codes (stable strings)

Codes inside `rpc` failure replies (`error.code`):

| Code | When | Message shape |
|------|------|---------------|
| `rpc_unknown_method` | Top-level method has no handler (and is not `renderer.*`) | `unknown rpc method: '<action>'` |
| `rpc_not_implemented` | Any `renderer.*` method | `renderer-bound RPC is not wired in the Qt build yet — see docs/phase-notes/p9-lane-channel-rpc.md` |
| `rpc_bad_payload` | `payload` present but not a JSON object | `rpc payload must be a JSON object` |

The pre-dispatch envelope error `invalid_rpc` (missing/empty string `action`) is unchanged and still a top-level `error` frame, not an `rpc` reply. The crate's other typed codes are unchanged: `auth_required`, `bad_message`, `bad_auth_message`, `invalid_token`, `unsupported_type`. Error frames remain `{ "type": "error", "error": { "code", "message" } }`.

## What the `renderer.*` gap means

`renderer.getModels`, `renderer.dispatch`, and every other `renderer.*` method returns `rpc_not_implemented` by design. **An external client can authenticate, ping, read status/config, and nothing else — it cannot drive the app.** That is deliberate: the renderer bridge for Qt needs a GUI-thread dispatch target (an eventa/injeca-equivalent or a Qt-side command registry with queued delivery to the GUI thread, streaming/backpressure decisions, and per-action auth scoping). Shipping a half-wired bridge that calls into Qt objects from the channel's reader thread would be worse than a clean typed refusal. Until that lane lands, the gateway is a read-only liveness/status surface for companion clients.

## Auth gating (unchanged, asserted)

Auth remains mandatory before **any** `rpc` is dispatched: pre-auth `rpc` gets the usual `auth_required` error frame + close 1008 before the dispatch layer is reached. Asserted at three levels: the existing `unauthenticated_socket_receives_nothing_else` unit test (RPC in the pre-auth list), the session-level tests (rpc after auth only), and a new integration check that opens a second, unauthenticated connection to the live server and expects `auth_required` + close 1008.

## Test evidence

Commands (run in `apps/airi-qt`):

- `cargo test -p airi-channel` → **66 passed, 0 failed** (60 unit + 6 integration). Baseline was 51 (46 + 5); net +15: new `dispatch.rs` unit tests, new session-level RPC tests, and the new `rpc_runtime_ping_round_trip` integration test.
- `CHANNEL_TEST_PORT=16199 cargo test -p airi-channel --test channel_server` → 6 passed (fixed-port path; tests self-serialize via `TEST_LOCK`).
- `cargo clippy -p airi-channel --all-targets -- -D warnings` → clean.
- `cargo fmt -p airi-channel -- --check` → clean.
- `#![deny(missing_docs)]`; SPDX headers on all touched files; no new dependencies (std + workspace deps only).

Covered by the new tests:

- `dispatch`: each handler's documented shape; `uptimeSeconds` ≥ 0; `runtime.status` `version == env!("CARGO_PKG_VERSION")`; `gateway.config` has no `authToken`/`auth_token` key and exactly two fields; `gateway.auth` `sessionStartedMs` > 0; unknown method → `rpc_unknown_method`; `renderer.getModels`/`renderer.dispatch`/`renderer.x` → `rpc_not_implemented`; bare `renderer` → `rpc_unknown_method`; non-object payloads (number/string/bool/array) → `rpc_bad_payload`; null/object payloads accepted; `METHODS` table matches the documented set.
- Session-level (pure state machine): authenticated `runtime.ping` reply is dispatched and echoes `id` (string and numeric ids); unknown method → `ok:false` + `rpc_unknown_method` with `id` echoed; `renderer.*` → `rpc_not_implemented` with `id` omitted when absent; non-object payload → `rpc_bad_payload`; `runtime.status` reports build info; connection stays open after RPC failures; `invalid_rpc` unchanged; unauthenticated RPC still rejected before dispatch.
- Integration (`CHANNEL_TEST_PORT` pattern, ephemeral port default, skips with `eprintln!` if bind fails): full handshake → `runtime.ping` round trip with `id` echo; `gateway.config` over the live socket with no `authToken`; second unauthenticated connection gets `auth_required` + close before dispatch.

Placeholder-era tests updated to the new contract: session `rpc_echoes_payload` → `rpc_runtime_ping_is_dispatched_and_echoes_id` (+ siblings), integration "RPC echo placeholder" block → `runtime.ping` round trip. All other pre-existing tests pass unchanged.

Known limitations: no concurrency stress, no slowloris testing, no TLS (unchanged posture), no test that `session_started_ms` strictly increases across connections. `uptimeSeconds` asserted `< 60` in unit tests only to catch unit confusion — not a meaningful SLA.

## Integration asks

**None expected for this lane.** The RPC registry is self-contained and continues the existing "crate is delivered, Qt does not start the server yet" status from `p9-lane-channel-server.md`. The one deferred item that matters:

1. **Renderer dispatch target (future lane, GUI-thread bridge).** Wiring `renderer.*` needs a dispatch bridge from the channel's connection threads onto the Qt GUI thread (queued invocation, not direct calls), target definitions for model/state reads, streaming/backpressure decisions, and per-action auth scoping (e.g. is `renderer.dispatch` allowed to execute arbitrary renderer commands for any token holder?). Until that lands, `rpc_not_implemented` is the honest answer and should not be "temporarily" short-circuited around.
2. **Binding decision unchanged.** If the gateway is ever wired into the Qt app, the bind-on-start vs opt-in question from `p9-lane-channel-server.md` still applies; nothing in this lane changes it.
3. **Do not advertise the gateway to users yet.** `runtime.*`/`gateway.*` are read-only liveness/status info — enough for a pairing probe, not for driving AIRI.

## File map (this lane only)

- `crates/airi-channel/src/dispatch.rs` — new: `RpcContext`, `RpcError` (stable `rpc_*` codes), `RpcRegistry::dispatch`, handler fns, unit tests.
- `crates/airi-channel/src/session.rs` — rpc branch now dispatches; `Session::with_context`; reply echoes client `id`; docs updated.
- `crates/airi-channel/src/server.rs` — builds/passes `RpcContext` (real bind address + shared server-uptime origin) into per-connection sessions.
- `crates/airi-channel/src/lib.rs` — `pub mod dispatch`, re-exports (`RpcContext`, `RpcError`, `RpcRegistry`, `PROTOCOL`, `APP_NAME`), docs updated.
- `crates/airi-channel/tests/channel_server.rs` — rpc echo section → `runtime.ping` round trip; new `rpc_runtime_ping_round_trip` integration test.
- `docs/phase-notes/p9-lane-channel-rpc.md` — this note.

## Working tree

Not committed. `git status` shows this lane's files as modified (`airi-channel/src/{lib,server,session}.rs`, `tests/channel_server.rs`) plus untracked `airi-channel/src/dispatch.rs` and this note. Other modified/untracked paths in the tree (`airi-acp/**`, `airi-mcp/**`, `airi-sync/**`, `airi-discord/**`, workspace `Cargo.toml`/`Cargo.lock`) belong to other lanes and were not touched.
