# P9 · Lane I2 — ACP session-management RPCs (`airi-acp`)

Lane: **I2 · ACP session management** — ports the session-lifecycle RPCs of
the Agent Client Protocol stable v1 schema to the native Rust client. Owns
`apps/airi-qt/crates/airi-acp/**` exclusively. Follows on from
`p9-lane-acp-agents.md` (G1) and `p9-lane-acp-hitl.md` (H1).

Reference (read-only):

- `node_modules/@agentclientprotocol/sdk` v2.0.2 — the method names, param
  shapes and result shapes below are taken **verbatim** from the stable v1
  schema (`schema/v1/schema.json`, types in `dist/v1/schema/types.gen.d.ts`,
  method constants in `dist/v1/schema/index.d.ts` `AGENT_METHODS`,
  `PROTOCOL_VERSION = 1`). The unstable v1 schema adds `session/fork` only;
  the v2 experimental schema drops `session/set_mode` entirely. Everything
  implemented here is in **stable v1**, which is what this crate speaks.
- `apps/stage-tamagotchi/src/main/services/airi/acp-agents/index.ts` —
  **electron does not implement any of these RPCs** (grep: no `session/load`,
  `session/list`, `session/delete`, `session/resume`, `session/set_mode`,
  `session/set_config_option`). There is **no parity baseline**; semantics
  are defined by the schema and this note alone.

## Exact wire methods and shapes (stable v1, `AGENT_METHODS`)

| Method | Params (required) | Result | Capability gate |
|---|---|---|---|
| `session/load` | `sessionId`, `cwd`, `mcpServers` (all required); optional `additionalDirectories` | `{ modes?, configOptions? }` (both nullable) | top-level `loadSession` |
| `session/resume` | `sessionId`, `cwd` (required); optional `additionalDirectories`, `mcpServers` | `{ modes?, configOptions? }` | `sessionCapabilities.resume` |
| `session/list` | `{}`; optional `cwd`, `cursor` | `{ sessions: SessionInfo[], nextCursor? }` (`sessions` required) | `sessionCapabilities.list` |
| `session/delete` | `sessionId` | `{}` (empty object) | `sessionCapabilities.delete` |
| `session/set_mode` | `sessionId`, `modeId` | `{}` (empty object) | none (no dedicated capability; agents signal support via `modes`) |
| `session/set_config_option` | `sessionId`, `configId`, plus either `{ value: string }` (value id; default when `type` absent) or `{ type: "boolean", value: boolean }` | `{ configOptions: SessionConfigOption[] }` (required) | none |

`SessionInfo` (required: `sessionId`, `cwd`): optional `additionalDirectories`,
`title`, `updatedAt`. `SessionModeState` (required: `currentModeId`,
`availableModes`): `availableModes[*]` = `{ id, name, description? }`.

**Session-not-found.** ACP has no session-specific not-found code. The
documented codes in the schema's `ErrorCode` union are `-32000` (auth
required) and `-32002` (resource not found, "A given resource, such as a
file, was not found"). This crate maps `-32002` onto
`AcpError::SessionNotFound(session_id)` for the session-scoped RPCs — a
judgment call, not a schema guarantee. `-32000` passes through as
`AcpError::JsonRpc` (auth flow is not implemented).

## What was added to `airi-acp`

### New public types (`types.rs`)

```rust
pub struct SessionSummary {           // `SessionInfo`
    pub session_id: SessionId,
    pub cwd: String,                  // schema-required; "" when absent
    pub title: Option<String>,
    pub updated_at: Option<String>,   // `updatedAt`
    pub additional_directories: Vec<String>,
    pub raw: Value,
}
pub struct SessionMode { pub id: String, pub name: String, pub description: Option<String> }
pub struct SessionModeState { pub current_mode_id: String, pub available_modes: Vec<SessionMode> }

/// Returned by both `session/load` and `session/resume` (same wire shape).
pub struct SessionSetupResult {
    pub session_id: SessionId,
    pub modes: Option<SessionModeState>,
    pub config_options: Option<Vec<Value>>,   // kept verbatim; schema still churns
    pub updates: Vec<SessionUpdate>,          // replayed `session/update`s, wire order
    pub raw: Value,
}

pub enum SessionConfigValue {         // union arms of SetSessionConfigOptionRequest
    ValueId(String),                  // { "value": "<SessionConfigValueId>" }
    Boolean(bool),                    // { "type": "boolean", "value": true }
}
pub struct SetSessionConfigOptionResult { pub config_options: Vec<Value>, pub raw: Value }

pub enum DeleteSessionResult { AgentAcknowledged, AgentRefused(String) }
```

### New / changed errors (`error.rs`)

- `AcpError::Unsupported { method }` — the agent answered `-32601`
  (method not found). Mapped centrally for every RPC that goes through
  `send_request_with_timeout`, and for the callback-based `session/load` /
  `session/resume` path. `is_method_not_found()` now recognises both this
  and the raw `JsonRpc { code: -32601, .. }` form.
- `AcpError::SessionNotFound(session_id)` — mapped from the documented
  `-32002` "resource not found".
- `JSONRPC_RESOURCE_NOT_FOUND = -32002` exported alongside the existing
  `JSONRPC_METHOD_NOT_FOUND`.
- **Not added:** a `Protocol(Value)` variant. The existing
  `AcpError::JsonRpc { code, message, data: Option<Value> }` already passes
  the agent's error object through verbatim (data preserved), and
  `Protocol(String)` is kept unchanged for internal violations; changing
  its payload would break every existing match for zero gain.
- No signature changes to any existing public function. `close_session`
  semantics preserved: a `-32601` from `session/close` still degrades to
  `CloseSessionResult::AgentRefused` (now via the new `Unsupported` arm).

### `AcpAgentClient` — new methods (`client.rs`)

```rust
pub fn load_session(&self, session_id: &str, cwd: Option<&Path>)
    -> Result<SessionSetupResult, AcpError>;
pub fn resume_session(&self, session_id: &str, cwd: Option<&Path>)
    -> Result<SessionSetupResult, AcpError>;
pub fn list_sessions(&self) -> Result<Vec<SessionSummary>, AcpError>;
pub fn delete_session(&self, session_id: &str)
    -> Result<DeleteSessionResult, AcpError>;
pub fn set_mode(&self, session_id: &str, mode_id: &str) -> Result<(), AcpError>;
pub fn set_config_option(&self, session_id: &str, config_id: &str,
    value: &SessionConfigValue) -> Result<SetSessionConfigOptionResult, AcpError>;
```

Behaviour notes:

- **Replay accumulation.** `session/load` replays history as `session/update`
  notifications *before* the response. The implementation registers the same
  per-session event subscription used by `prompt()` (reader thread routes
  notifications by `params.sessionId`), accumulates every update in wire
  order, and stops at the RPC response — `SessionSetupResult.updates`.
  `session/resume` shares the code path (its replay is normally empty; an
  agent that emits updates anyway is not silently dropped). Local routing
  is removed after the call; a later `prompt()` re-registers its own
  subscription. Updates for the session arriving *after* the response are
  dropped (traced), exactly as with prompt turns.
- **One operation per session.** Load/resume register the same subscription
  slot as a prompt turn; a load concurrent with an in-flight prompt (or vice
  versa, or two loads) fails with `AcpError::PromptInProgress`.
- **cwd** defaults to the process cwd and is absolutised (`std::path::absolute`)
  for all three lifecycle RPCs — the schema requires absolute paths.
  `mcpServers` is sent as `[]` (unchanged; not exposed yet).
- **Timeout.** The whole load/resume (including a long replay) is bounded by
  the short-RPC timeout `DEFAULT_REQUEST_TIMEOUT` (10 s, raisable via
  `set_timeout`). Raise it for agents with very large replays; a prompt-style
  5-minute bound was rejected because the schema presents load/resume as
  short synchronous calls.
- **`list_sessions`** sends `{}` first page (the optional `cwd` filter is not
  exposed yet), follows `nextCursor` until absent/empty, cap 100 pages —
  exceeding the cap fails with `AcpError::Protocol` instead of looping
  forever. `SessionInfo` entries missing/invalid `sessionId` are skipped,
  mirroring the schema's skip-invalid-items semantics.
- **`delete_session`** is best-effort, mirroring `close_session`: local
  routing is always removed. `Ok(DeleteSessionResult::AgentAcknowledged)` on
  a normal response; other JSON-RPC errors (≠ `-32601`/`-32002`) →
  `Ok(DeleteSessionResult::AgentRefused(message))` (session may leak on the
  agent side); `-32601` → `Err(Unsupported)`; `-32002` →
  `Err(SessionNotFound)`; transport failures → `Err` either way.
- **Error mapping asymmetry, documented:** `close_session` still maps a
  `-32601` to `AgentRefused` (backwards compatibility), while the *new*
  methods map it to `Err(AcpError::Unsupported)` per the lane requirement
  that unknown/unimplemented methods fail with a clear typed error, never
  hang or panic.
- Capabilities are **not** pre-checked; support is discovered from the
  agent's answer (an agent that lies about `sessionCapabilities` still gets
  the RPC, and a `-32601` is mapped, not crashed).
- Parsing is lenient throughout: unknown `SessionInfo`/mode fields are kept
  in `raw`; malformed entries are skipped; `configOptions` (schema still
  churning) is carried verbatim as `Vec<Value>`; `config_options` is `None`
  when absent or `null`, `Some([])` when empty.

### Internal refactors (no behaviour change)

`start_prompt` now shares `register_subscription` and `make_finish_callback`
with the load/resume path; `new_session` uses the extracted `absolutise_cwd`
helper. No existing signature touched; all 54 pre-existing tests still pass
unchanged (see below).

## Tests

`python3` mock agent (`tests/stdio_mock.rs`) extended in-place:

- new mode `sessions` — implements `session/load` (replays two
  `agent_message_chunk` notifications, then answers with `modes` +
  `configOptions`; `sess-missing` → `-32002`), `session/resume` (modes, no
  replay), `session/list` (cursor pagination: page 1 = `sess-mock-1` +
  `nextCursor: "page2"`, page 2 = `sess-mock-2`), `session/delete`
  (`{}`; `sess-missing` → `-32002`), `session/set_mode` (`{}`),
  `session/set_config_option` (one updated option). Other modes now
  `-32601`-fall-through for these methods.
- `basic` mode doubles as the "capability not advertised" agent (catch-all
  `-32601`).

New integration tests (8): load accumulates the two replayed chunks
(`final text == "Loaded history"`) + parses `modes`/`configOptions`;
load `sess-missing` → typed `SessionNotFound`; resume returns setup state
with empty `updates`; `list_sessions` parses both pages in order
(id/cwd/title/updatedAt/additionalDirectories); `delete_session` →
`AgentAcknowledged`; delete `sess-missing` → typed `SessionNotFound`;
`set_mode` + both `set_config_option` arms round-trip; an agent without the
methods (`-32601`) → typed `Unsupported` for all six methods, no hang (5 s
timeouts). Pre-existing skip-if-no-python3 guards apply.

```
cargo test -p airi-acp
```

**Evidence (this machine, python3 3.14.9):**

```
running 42 tests (unit)      — ok, 0 failed
running 20 tests (integration) — ok, 0 failed   (12 pre-existing + 8 new)
cargo clippy -p airi-acp --all-targets -- -D warnings   — clean
cargo fmt -p airi-acp --check                           — clean
```

Pre-existing tests: 54 → 62 (42 unit + 20 integration). No pre-existing
`#[test]` function was edited or removed (verified against `HEAD`).

## Not ported (explicit)

- `authenticate`, `logout` — auth flow untouched (`authMethods` still parsed
  but unused; `-32000` passes through as `JsonRpc`).
- Elicitation (`elicitation/*`, `elicitation_complete`) — client capability
  still never advertised.
- `session/fork` — unstable v1 only; this crate speaks stable v1.
- `$/cancel_request`, `logout`, unstable v2 protocol, HTTP/WebSocket
  transports — unchanged from G1.
- `session/list`'s optional `cwd` filter and raw cursor pass-through
  (`nextCursor` is consumed internally for pagination, not exposed).
- `additionalDirectories` on `session/load`/`session/resume` (schema allows
  it; not exposed — matches the crate's current `mcpServers: []` posture).
- `session/set_mode` has no typed mode enum — `mode_id` is an opaque string
  from `SessionSetupResult::modes.available_modes[*].id`.
- `SessionConfigOption` is not a typed union (schema still churning); only
  the request value arm (`SessionConfigValue`) is typed.
- Agent-side mode/config *change notifications* (`current_mode_update`,
  `config_option_update`) arrive as `SessionUpdate::Other` — unchanged.

## Deltas vs Electron

**None — no parity baseline.** The Electron ACP service
(`apps/stage-tamagotchi/src/main/services/airi/acp-agents/index.ts`) does
not call any of these methods. Anything AIRI builds on top of `load_session`
etc. is new behaviour, not a port.

## Semantics notes / pitfalls

- `session/load`'s replay is **before the response on the wire**; a client
  that only reads the response would lose history — this crate accumulates
  via the subscription, so ordering between the last replayed chunk and the
  response is preserved.
- A `PromptInProgress` from `load_session` means "session busy" (a prompt or
  another load is in flight), not a protocol error from the agent.
- `-32002` → `SessionNotFound` assumes the agent used the documented
  resource-not-found code for a missing session; an agent inventing a
  different code gets `AcpError::JsonRpc` passthrough.
- 100-page pagination cap: a mis-paginating agent gets a loud
  `AcpError::Protocol`, not an infinite loop.

## Integration asks for the main agent

**None beyond the crate.** The Qt bridge does not need changes to compile
against this crate (API is purely additive). When the embedder wants to
surface "re-attach session" UI it can call `load_session` directly; nothing
needs to be registered in `build.rs`, `SettingsWindow.qml`, locales, or
`packages/i18n` for this lane. Suggested (not required) follow-ups:

- Surface `load_session`/`list_sessions`/`delete_session` on the Qt ACP
  bridge when a "previous sessions" UI lands — today nothing consumes them.
- Decide whether a high-latency agent (huge replay) needs
  `set_timeout` raised; the default 10 s may be short for `session/load`.
