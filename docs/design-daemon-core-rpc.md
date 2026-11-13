# Design: Daemon core RPC boundary

**Status:** accepted · **Owner:** project lead
**Scope:** Slice B boundary only. No implementation is implied by this document.

## Context

Slice A added a transport-only Rust gateway client in `crates/airi-channel`.
It proves that a client can authenticate, call `runtime.ping`/`runtime.status`,
and close cleanly. It does **not** move service ownership into the daemon.

`airi-core` still runs in-process inside `airi-slint`, where it opens the
application SQLite store (`<profile>/airi.sqlite`, default
`~/.local/share/airi-slint/airi.sqlite`, or an explicit `--profile`). The daemon
does not link `airi-core`, does not open the store, and exposes no `core.*`
RPC.

AIRI's target topology has one owner per store file in daemon mode. Two writers
are not made safe by "eventual consistency" because the current paths are not
built for cross-process SQLite ownership. The boundary must be explicit before
any daemon core code is linked.

## Decision

1. **Daemon mode has one writer: `airi-daemon`.**
   In daemon mode, the daemon opens the application SQLite store and owns all
   `AppCore` state: sessions, messages, provider table state, settings mutation,
   memory, journals, and card writes when those slices land. `airi-slint` must
   not open, create, or mutate that store while it is operating in daemon mode.

2. **Fallback mode is explicit and local.**
   Fallback preserves today's embedded path: Slint may open the local store and
   construct local services when daemon mode is disabled, unavailable, or not
   yet complete. Fallback is a migration bridge, not a second runtime for the
   same store. A process must choose one mode for a profile at startup; live
   ownership must not flip mid-session.

3. **Mode selection is local configuration plus health, not daemon voting.**
   The client-side selection model is `auto`, `disabled`, or `required`:

   - `disabled`: use the local path only; no daemon core RPC is attempted.
   - `auto`: probe the daemon; use daemon mode only when it answers a healthy
     `core.status`; otherwise fall back to the local path and show/log that the
     daemon path was not used.
   - `required`: probe the daemon; if it is unhealthy, stay unavailable for
     core-dependent work. Do not silently open a competing local writer.

   The default remains the current local behavior until daemon mode exists.

4. **Daemon store startup failure fails closed for core state.**
   If `airi-daemon` cannot open the application store, it must not register
   core handlers that mutate or claim availability. The gateway may continue to
   answer non-core RPCs (`runtime.*`, `gateway.*`) and should report core as
   unavailable through `core.status` with a sanitized `rpc_*` error. It must
   never fall back to an empty, temporary, or different database and present it
   as the user's application state.

5. **Client startup/connection failure is mode-dependent.**
   In `disabled` mode, local startup is unchanged. In `auto` mode, daemon
   connection or unhealthy `core.status` routes to the local fallback. In
   `required` mode, core-dependent UI/work is unavailable until the daemon is
   reachable and healthy; the app must not open the store behind the daemon's
   back.

6. **Profile/store identity is explicit.**
   The daemon owns stores selected by the same rules Slint uses today: an
   explicit profile path wins; otherwise the platform data directory plus
   `airi-slint/airi.sqlite` is used. A missing schema is created only by the
   normal store migration path. The daemon must not invent a new core database,
   adopt a staging copy, or silently migrate user data as part of Slice B;
   schema/adoption changes require their own issue and review.

7. **RPC namespace is additive and read-only first.**
   Slice B may add `core.status` only. It must return a sanitized, immutable
   snapshot suitable for a health probe, for example: application name,
   version, core/store availability, store health, protocol version, and
   coarse counts when they are safe to expose. It must **not** return the
   auth token, D-Bus token, provider configs, API keys, secrets, prompts,
   paths that reveal secrets, raw memory contents, or any capability to mutate
   state.

8. **No existing wire semantics change.**
   Current `auth`, `module:authenticate`, `ping`,
   `transport:connection:heartbeat`, and `rpc` semantics stay intact. New core
   methods are additive `rpc` actions with typed DTOs exported through the
   existing specta/TypeScript drift pipeline. Stable `rpc_*` codes are reused;
   new codes must follow the same no-secret-message rule.

9. **Control plane and data plane stay separate.**
   D-Bus remains the Linux control plane for privileged gateway verbs
   (`GetGatewayConfig`, `ApplyGatewayConfig`, `RegenerateGatewayToken`). Same-uid
   session access to the bus is accepted for this deployment model; protection is
   OS process/file sandboxing, not sender authorization. The WS gateway remains
   the data plane for core RPC; beyond loopback it requires `wss://` with the
   locally trusted CA. Neither plane is suitable for secrets in replies.

10. **Ownership deletion is deferred until parity is proven.**
    Slint's embedded `AppCore`/store path remains as fallback until the daemon
    has implemented the needed surface, passed ownership/fallback tests, and the
    migration has been exercised. Deleting slint-side ownership is Slice D
    work, not Slice B.

## Slice B acceptance boundary

Slice B is complete only when:

- the daemon links `airi-core` behind an explicit service object;
- `core.status` has a typed DTO, specta/TS export, and drift check;
- a daemon handler returns a sanitized core/store status;
- the Rust client exposes a typed `core.status` helper or documented request;
- Slint can select daemon/fallback mode explicitly and tests prove no dual
  writer in daemon mode; and
- docs describe the implemented surface truthfully.

Anything beyond `core.status`—including `chat.send`, streamed `chat.event`
frames, settings/memory/card migration, or deletion of slint-side ownership—is
outside this boundary.

## Rejected alternatives

- **Both sides open the same SQLite file.** Rejected: cross-process write
  ownership and hidden competing services are the bug, not an optimization.
- **Daemon silently uses a fresh/temporary store after failure.** Rejected: it
  would make availability look healthy while hiding data loss or split-brain
  state.
- **Auto silently becomes required.** Rejected: it changes user-visible failure
  behavior without consent and makes deployment/debug ambiguity worse.
- **Core RPC returns raw config or secrets.** Rejected: health/status must be
  safe for any authenticated local client; secrets belong in the control-plane
  file model or explicit provider-management flows, never in `core.status`.
- **Bulk move slint bridges into the daemon before protocol parity exists.**
  Rejected: the agreed order is transport → read-only core RPC → chat →
  migration → deletion.
