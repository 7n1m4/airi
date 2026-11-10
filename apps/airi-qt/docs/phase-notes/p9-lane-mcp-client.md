# P9 · Lane D1 — native MCP client (stdio) (`airi-mcp`)

Lane: **D1 · MCP client over stdio** — replaces the Electron main-process MCP
implementation for the Rust+Qt rewrite. Owns
`apps/airi-qt/crates/airi-mcp/**` exclusively.

Reference implementation (read-only):

- `apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts`
  (stdio + streamable-HTTP via `@modelcontextprotocol/sdk`, default config
  opens `open-websearch` via `npx`)
- `packages/stage-ui/src/stores/mcp-tool-bridge.ts` (renderer tool descriptor /
  call types, `server::tool` qualification)

## What works

JSON-RPC 2.0 over stdio, newline-delimited messages, fully synchronous std-only
implementation (`std::process`, a background reader thread, `std::sync::mpsc`).
No new crates.io dependencies — workspace deps only (`serde`, `serde_json`,
`thiserror`, `tracing`); the stub's unused `anyhow`/`tokio` entries were dropped.

- `McpStdioClient::spawn(command, args, env)` — spawns the server, pipes
  stdin/stdout/stderr, starts a `airi-mcp-reader` thread that parses
  newline-delimited JSON from stdout and routes responses to the waiting
  caller **by request id** (numeric ids only; string ids that parse as `u64`
  are also matched). stderr is drained on a `airi-mcp-stderr` thread into
  `tracing::debug!` so a chatty server cannot block on a full pipe.
  `env: Some(&[…])` is layered **on top of the inherited parent environment**
  (`Command::env` semantics).
- `initialize()` — sends `initialize` with `protocolVersion: "2024-11-05"`,
  `capabilities: {}`, `clientInfo: { name: "airi-mcp", version: <crate
  version> }`, then `notifications/initialized`. Returns `McpInitializeResult`
  (`protocol_version`, `capabilities`, optional `server_info`, plus the raw
  `result` for forward-compat). The server's reported protocol version is
  surfaced but **not validated** against the requested one.
- `tools_list()` — sends `tools/list`; parses `{ tools: [{ name, description?,
  inputSchema }] }` into `McpToolDescriptor`s. Both `inputSchema` (spec) and
  `input_schema` are accepted as keys; non-object schemas normalise to `{}`;
  entries without a string `name` are skipped.
- `tools_call(name, arguments)` — sends `tools/call`; maps `content:
  [{type:"text", text}]` into typed `McpToolContent::Text` blocks (other block
  types preserved verbatim as `McpToolContent::Other`), plus
  `structuredContent` (objects only) and `isError`. `McpToolResult::text()`
  joins text blocks with `\n` for LLM/log consumption.
- `close(self)` / `Drop` — kills the child, waits for it, joins the reader
  thread, and fails all in-flight requests with `McpError::Closed`. Idempotent.
- Typed errors: `McpError::{Spawn, Transport, Closed, JsonRpc{code,message,
  data}, Timeout{method,timeout}, Protocol, UnsupportedTransport}`.
  Default per-request timeout is **5 s** (`DEFAULT_REQUEST_TIMEOUT`), raisable
  per client with `set_timeout()`.
- `pid()` and `is_closed()` helpers for future runtime-status parity with the
  Electron `describeRuntime()` rows.

Server-initiated requests (`roots/list`, `sampling/…`, …) are answered with a
JSON-RPC `-32601` error so the server does not block forever; server
notifications are ignored (traced at `trace!`).

## Semantics notes vs the Electron implementation

- **Timeout model differs.** Electron used a 10 s request timeout with a 15 s
  `maxTotalTimeout` and retry-once semantics for tool-name fallback. This
  client has a single 5 s default, no retry, and no `maxTotalTimeout`.
- **Environment semantics differ.** The SDK merged its own safe-default
  environment plus the configured `env`; this client inherits the parent
  environment and layers the configured entries on top (the closest std-only
  equivalent — usually what an `npx` launcher wants).
- **`isError` is surfaced, not retried or auto-failed.** MCP tool-level
  failures travel inside a normal result; they are returned to the caller.
- **Tool name qualification (`server::tool`)** is deliberately **not** in this
  crate — one client = one server = bare wire tool names. The renderer/Qt
  layer owns `::` qualification (mirrors `toolNameSeparator` in
  `mcp-tool-bridge.ts`).
- **`open-websearch` default config is intentionally absent** (see below).

### Config file format — intentionally NOT implemented

The Electron side reads/writes `mcp.json` (`app.getPath('appData')/airi/
mcp.json`), validates it with zod (`mcpServers` map → strict stdio `{command,
args?, env?, cwd?, enabled?}` or strict HTTP `{url, headers?, enabled?}`),
seeds a default `open-websearch` entry (`npx -y open-websearch@latest`,
`DEFAULT_SEARCH_ENGINE=duckduckgo`, `SEARCH_MODE=auto`, `MODE=stdio`), and
manages sessions, runtime status, and qualified tool names across servers.

**None of that is in `airi-mcp`.** No config schema, no file discovery, no
default server, no `cwd` support, no multi-server registry. This crate is a
single-server transport client; config persistence and the
`applyAndRestart`/`listTools` fan-out belong to the integration lane that owns
`mcp.json`. Until then, callers hardcode/derive their own spawn parameters.

### Out of scope, not implemented

- Streamable HTTP transport — returns a typed
  `McpError::UnsupportedTransport("streamable-http not ported yet")`-style
  variant if a caller forces it (the variant exists; the stdio path never
  returns it). HTTP header/auth semantics, `McpConfigFile` persistence, Qt
  bridges, and the `enabled: false` skip logic are likewise unimplemented.

## Test evidence

`cargo test -p airi-mcp` (all green; the stdio round-trip test spawns a mock
MCP server as `python3 -c '<script>'`, answers `initialize` /
`notifications/initialized` / `tools/list` (two fake tools, one with
`inputSchema`, one with the `input_schema` alias) / `tools/call` (echo +
`structuredContent`) and a `-32000` error for `__boom__`; it is skipped with an
`eprintln!` if python3 is absent — it was present, Python 3.14.9):

```
test jsonrpc::tests::jsonrpc_error_from_tolerates_missing_fields ... ok
test jsonrpc::tests::parse_initialize_result_extracts_fields ... ok
test jsonrpc::tests::notification_envelope_has_no_id ... ok
test jsonrpc::tests::parse_tool_result_defaults_for_minimal_response ... ok
test jsonrpc::tests::parse_tools_list_accepts_input_schema_alias ... ok
test jsonrpc::tests::response_id_normalization_accepts_numbers_and_numeric_strings ... ok
test jsonrpc::tests::response_to_result_maps_error_object ... ok
test jsonrpc::tests::response_to_result_returns_result_payload ... ok
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

     Running tests/stdio_mock.rs
test spawn_failure_is_a_typed_error ... ok
test handshake_tools_list_and_call_roundtrip ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

   Doc-tests airi_mcp
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

`cargo clippy -p airi-mcp --all-targets -- -D warnings` → clean.
`cargo fmt -p airi-mcp --check` → clean.
`cargo check -p airi-mcp` → green.

The python3 mock asserts: handshake completes (`protocolVersion`,
`serverInfo.name == "airi-mock"`), both tool-schema key variants parse, the
env tuple passed at `spawn` reaches the child (`env_report` tool reads
`AIRI_MCP_TEST=1`), `tools/call` round-trips arguments + structured content,
and a server-side `{"error": {…}}` maps to `McpError::JsonRpc { code: -32000,
message: "boom", data: {"why": "testing"} }`.

## Exact integration asks for the main agent

None beyond keeping `airi-mcp` registered as a workspace member.

- No new workspace or crate dependencies are required. The only files outside
  the lane I could not avoid touching are `Cargo.toml` (workspace member list)
  and `Cargo.lock`, which were **already modified before this lane started**
  (both `airi-mcp` and `airi-mmd` registration); the first `cargo build`
  synced the lock entries to the current manifests. No packages were removed
  and no crates.io deps were added.
- When the Qt bridge lane wires this up: one `McpStdioClient` per configured
  server, call `initialize()` once after spawn, qualify tools as
  `server::tool` at the bridge layer, and expect 5 s (not 10 s) timeouts —
  raise via `set_timeout()` if the `npx` cold-cache case matters.
- Need streamable HTTP later? That is a separate lane; `McpError::
  UnsupportedTransport` is the reserved error variant for it.
- Config (`mcp.json`) persistence, the default `open-websearch` seed, and the
  `::` fallback-name retry from the Electron implementation are unported by
  design; please confirm that is still the desired split.
