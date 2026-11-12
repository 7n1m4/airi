# P9 · Lane G1 — native ACP agent client (stdio) (`airi-acp`)

Lane: **G1 · ACP (Agent Client Protocol) agent client over stdio** — replaces
the Electron main-process ACP implementation for the Rust+Qt rewrite. Owns
`apps/airi-qt/crates/airi-acp/**` exclusively.

Reference implementation (read-only):

- `apps/stage-tamagotchi/src/main/services/airi/acp-agents/index.ts`
  (spawn → initialize → session/new → session/prompt → session/update flow;
  `permissionPolicy` of `prompt` / `auto-read` / `auto-all`)
- `node_modules/@agentclientprotocol/sdk` v2.0.2 — schema types used as the
  source of truth (`dist/v1/schema/types.gen.d.ts`, stable v1,
  `PROTOCOL_VERSION = 1`)

## What works

Newline-delimited JSON-RPC 2.0 over stdio, synchronous std-only implementation
(`std::process`, a background reader thread, `std::sync::mpsc`) — the same
shape as `airi-mcp`. No new crates.io dependencies (the stub's `tokio` entry
was dropped; workspace tokio features don't include `process`/`io-util`
anyway). `serde`, `serde_json`, `thiserror`, `tracing` only.

- `AcpAgentClient::spawn(command, args, env)` — spawns the agent, pipes
  stdin/stdout/stderr. `env` entries are layered on the inherited parent
  environment (`Command::env` semantics — identical to the Electron
  `{ ...process.env, ...config.env }` merge). A `airi-acp-reader` thread
  parses one JSON object per line and routes responses to the waiting caller
  **by request id** (numeric; numeric-looking string ids also match). stderr
  is drained into `tracing::debug!`.
- `initialize()` — sends `initialize` with `protocolVersion: 1`,
  `clientCapabilities: {}`, `clientInfo: { name: "airi-acp", version: <crate
  version> }`. Returns `InitializeResult`: `protocol_version` (surfaced but
  **not validated** — same as the Electron service), typed-where-meaningful
  `agent_capabilities` (`loadSession`, prompt/mcp/session-lifecycle presence
  booleans, plus the raw object verbatim), `auth_methods` (raw), `agent_info`.
- `new_session(cwd)` — `session/new` with `{ cwd, mcpServers: [] }`. `cwd`
  defaults to the process cwd; relative paths are absolutised
  (`std::path::absolute`); the schema requires absolute paths. Returns the
  agent-assigned `SessionId`.
- `prompt(session_id, text)` — `session/prompt` with a text content block.
  Collects every `session/update` notification routed to the session until the
  agent answers the prompt request, returns all updates in wire order in
  `PromptResult.updates`, parses `stopReason` into `PromptResult.stop_reason`,
  and concatenates `agent_message_chunk` texts into `PromptResult.final_text`
  (mirrors the Electron `{ stopReason, finalText }` shape, plus the updates).
  One outstanding prompt per session — a second concurrent call gets
  `AcpError::PromptInProgress`.
- `cancel(session_id)` — `session/cancel` notification (same as Electron).
- `close_session(session_id)` — sends the stable `session/close` RPC, then
  always removes local routing state. Returns `CloseSessionResult::
  AgentAcknowledged` on a normal response, or `AgentRefused(message)` when the
  agent answers with a JSON-RPC error (e.g. agents that don't advertise
  `sessionCapabilities.close`). Local cleanup happens either way. (Electron
  never sent `session/close` at all — it only disposed local routing.)
- `session/request_permission` (server-initiated) is answered inside the
  reader thread from a configurable `PermissionPolicy`:
  - `prompt` → **fails closed**: selects the first `reject_*` option (or the
    last option when none exists). There is no renderer in this crate to ask.
  - `auto-read` → allow only read-like tool calls: `kind == "read"`
    (case-insensitive) or the tool call's `title` contains `read`
    (case-insensitive). Everything else is rejected.
  - `auto-all` → first `allow_*` option wins, falling back to the first
    option (mirrors Electron's `find(kind.startsWith("allow")) || options[0]`).
  - Empty `options` → protocol-level `outcome: "cancelled"`.
- Typed errors: `AcpError::{Spawn, Transport, Closed, JsonRpc{code,message,
  data}, Timeout{method,timeout}, Protocol, PromptInProgress}`.
- `pid()`, `is_closed()`, `set_permission_policy()`, `set_timeout()`,
  `set_prompt_timeout()` helpers. `Drop` kills the child, joins the reader,
  fails in-flight requests with `AcpError::Closed`.

## Protocol interpretation vs the SDK

- **`session/prompt`'s response IS the turn-end signal.** On the wire there
  is no separate "stop" message; the SDK's `ActiveSession.nextUpdate()`
  synthesises a `{ kind: "stop" }` message from the prompt response. This
  crate folds the prompt response into the same per-session event stream
  (`SessionEvent::Finished`) so ordering between the final notifications and
  the response is preserved, and the `PendingCallback` indirection in the
  pending-request map lets prompt responses bypass the usual oneshot.
- **`session/update` routing is by `params.sessionId`** into per-session
  subscribers registered by `prompt()`. There is no implicit global queue;
  updates for a session with no in-flight prompt are traced and dropped
  (Electron's `ActiveSession` drops them the same way once disposed).
- **Method names** come straight from the schema's `AGENT_METHODS` /
  `CLIENT_METHODS` constants (`session/new`, `session/prompt`,
  `session/cancel`, `session/close`, `session/update`,
  `session/request_permission`).
- **Lenient parsing.** Update payloads are parsed into typed structs where
  meaningful (`ToolCall`, `ToolCallUpdate`, `ContentChunk`, `ContentBlock`),
  but anything unparseable or from a newer protocol revision falls back to
  `SessionUpdate::Other { update, raw }` instead of failing the turn.
  `StopReason`, `ToolKind`, `ToolCallStatus` carry `Other`/`Unknown`
  fallbacks. `final_text` concatenates only `ContentBlock::Text` payloads.
- **`clientCapabilities` is sent empty** — no `fs/*`, no `terminal/*`, no
  elicitation. Server-initiated requests other than
  `session/request_permission` are answered with JSON-RPC `-32601`.
- **`mcpServers` is sent as `[]`** — `session/new` in the schema requires the
  field; we don't expose MCP-server-per-session yet.
- **`session/close` is stable v1** (gated in the schema by
  `sessionCapabilities.close`). We attempt it unconditionally and degrade to
  local-only cleanup on JSON-RPC error, because agents in the wild don't all
  advertise it.
- **`protocolVersion` is not validated** in `initialize` — surfaced in
  `InitializeResult::protocol_version`, matching the Electron behaviour.
- **Permission response shape**: `{ outcome: { outcome: "selected",
  optionId } }` or `{ outcome: { outcome: "cancelled" } }` — exactly the
  `RequestPermissionResponse` / `SelectedPermissionOutcome` union.

## Semantics deltas vs the Electron service (honest list)

1. **`auto-read` was not implemented in Electron at all.** The `auto-read`
   and `auto-all` branches in `index.ts` are byte-identical (both pick the
   first allow-kind option, else `options[0]`). This crate implements the
   documented intent: read-like tools (kind `read` or title containing
   `"read"`, case-insensitive) are allowed, everything else rejected.
   Deliberately ignored: `name`, `rawInput`, regex word boundaries — a broader
   heuristic would auto-allow more than intended.
2. **`prompt` policy fails closed instead of asking a human.** Electron
   round-tripped to the renderer (`onPermissionRequest` → UI →
   `respondPermission`) and waited indefinitely. This crate has no UI, so it
   immediately selects the reject-style option. If AIRI wants a real prompt
   UX, that is an integration decision for the Qt layer (see asks).
3. **Timeouts are bounded (Electron/SDK waited forever).** Short RPCs:
   10 s default (`DEFAULT_REQUEST_TIMEOUT`, raisable via `set_timeout`).
   Prompt turns: 5 minutes (`DEFAULT_PROMPT_TIMEOUT`, raisable via
   `set_prompt_timeout`).
4. **Electron's deny fallback never matched.** It checked
   `kind.startsWith("deny")`, but the wire kinds are `reject_once` /
   `reject_always`, so it always fell back to `options[options.length - 1]`.
   This crate checks `starts_with("reject")` first, then falls back to the
   last option — same effective behaviour, now intentional.
5. **`close_session` sends `session/close`**; Electron only disposed local
   routing and leaked the session on the agent side.
6. **One prompt in flight per session**, enforced (`PromptInProgress`).
   Electron effectively allowed queueing via multiple `ActiveSession`s.
   Overlapping prompts on one session would interleave `session/update`s
   unpredictably anyway.
7. **Updates for sessions without an in-flight prompt are dropped** (traced).
   Electron kept them in the `ActiveSession` queue until consumed.
8. **`initialize` is not yet followed by any runtime-status/config-file
   machinery** (`acp.json` discovery, `applyAndRestart`, runtime status rows,
   `stopAll` on quit). Those are app-level concerns of the Electron service
   and are **not** part of this crate; the crate is the client transport +
   session protocol only.
9. **`final_text` semantics**: Electron concatenated all
   `agent_message_chunk` text blocks regardless of `messageId`; we do the
   same (we keep `message_id` on `ContentChunk` but do not group by it).
10. **Environment inheritance semantics match Electron** (`env` layered on
    the inherited parent environment); stderr goes to `tracing` instead of
    being ignored.

## Not ported (explicit)

- `fs/read_text_file`, `fs/write_text_file`, `terminal/*` (and the matching
  client capabilities — never advertised).
- `session/load`, `session/list`, `session/delete`, `session/resume`,
  `session/set_mode`, `session/set_config_option`, `authenticate`, `logout`,
  `elicitation/*`, `$/cancel_request`.
- `mcpServers` in `session/new` (sent as `[]`), `additionalDirectories`.
- Plan updates (`plan`) are carried as raw JSON (`SessionUpdate::Plan(Value)`);
  AIRI does not render plans yet.
- `available_commands_update`, `current_mode_update`, `config_option_update`,
  `session_info_update`, `usage_update`, `notice`, `compaction_*` — carried
  verbatim as `SessionUpdate::Other`.
- Human-in-the-loop `prompt` permission UX; `respondPermission`.
- Agent config file (`acp.json`) management, runtime status bookkeeping, Qt
  bridges — intentionally app/shell level, not this crate.
- Unstable v2 protocol and HTTP/WebSocket transports.

## Test evidence

`cargo test -p airi-acp` (this machine, python3 3.14.9):

- 30 unit tests (`src/jsonrpc.rs`, `src/permission.rs`, `src/client.rs`) —
  envelope coding, response-id normalisation, permission decision table
  (auto-all/auto-read/prompt, empty options, fallback order, lenient option
  parsing), lenient initialize/update parsing, stop-reason mapping.
- 8 integration tests (`tests/stdio_mock.rs`) against a `python3 -c` mock
  agent implementing `initialize` (echoes capabilities + agentInfo),
  `session/new`, `session/prompt` (streams two `agent_message_chunk`
  notifications then `{"stopReason": "end_turn"}`), permission requests
  (echoes the selected option id back as the agent message so tests can assert
  it through the full round-trip), `session/cancel`, `session/close`.
  Assert: handshake capabilities + agentInfo, session id parses, updates
  accumulate in order, `stop_reason == EndTurn`, `final_text`, permission
  allow/deny behaviour per policy (`auto-read` allows read, denies edit;
  `auto-all` allows edit; `prompt` rejects), `session/close` acknowledged.
  Tests skip silently with an `eprintln!` note when `python3` is absent.

```
cargo clippy -p airi-acp --all-targets -- -D warnings   # clean
cargo fmt -p airi-acp --check                           # clean
cargo test -p airi-acp                                  # 38 passed, 0 failed
```

## Integration asks for the main agent

None beyond this crate. One decision to make at integration time (not a
blocker): the `prompt` permission policy. This crate fails closed because it
has no UI; if AIRI wants Electron's round-trip-to-renderer behaviour, the Qt
layer needs an async permission-request channel surfaced from the agent loop
(mirroring `onPermissionRequest` / `respondPermission`) before `reject` is
the wrong default. Until then, `auto-read` is the safest non-trivial policy.
Also note: agents that want MCP servers attached to a session will need
`session/new`'s `mcpServers` plumbed through — currently sent as `[]`.
