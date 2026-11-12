# P9 · Lane I1 — native MCP client over streamable HTTP (`airi-mcp`)

Lane: **I1 · MCP client over streamable HTTP** — wave ⑦. Owns
`apps/airi-qt/crates/airi-mcp/**` exclusively (crate `airi-mcp`, already a
workspace member). Additive to the existing stdio client: its public API is
unchanged.

Reference implementation (read-only):

- `packages/stage-ui/src/services/mcp/web-client.ts` and
  `packages/stage-pages/src/pages/settings/modules/mcp.vue` (how the
  Electron/web side talks streamable HTTP and queries the official registry)
- `docs/research-open-apis-and-mcp-servers.md` (registry endpoint + query
  params, documented in-repo)
- `crates/airi-llm/src/sse.rs` (house incremental-SSE parsing pattern)

## What works

`McpHttpClient` — a blocking client on `reqwest`'s blocking API (no tokio)
for the MCP **streamable HTTP** transport (spec 2024-11-05 / 2025-03-26). Same
shape as `McpStdioClient`: `connect(url)` → `initialize()` → `tools_list()` /
`tools_call(name, arguments)` → `close()`.

- `McpHttpClient::connect(url)` — validates the absolute `http`/`https`
  endpoint URL and builds the HTTP client. **No network I/O** happens in
  `connect`; the handshake is `initialize()`'s job.
- `initialize()` — POSTs `initialize` (protocolVersion `"2024-11-05"`, empty
  capabilities, `clientInfo { name: "airi-mcp", version: <crate version> }`),
  captures the `Mcp-Session-Id` **response header** when present, then sends
  `notifications/initialized`. The server's reported protocol version is
  surfaced in `McpInitializeResult::protocol_version` but is not validated.
- `tools_list()` — `tools/list`; `inputSchema` (spec) and `input_schema`
  accepted, entries without a string `name` skipped — same normalisation as
  the stdio client.
- `tools_call(name, arguments)` — maps the response onto the existing
  `McpToolResult` (typed content blocks, `structuredContent`, `isError`). A
  tool-level `isError: true` surfaces as `Ok(result)` with `result.is_error ==
  true`, never as `Err`, matching stdio semantics.
- `close()` — best-effort `DELETE` to the endpoint with the
  `Mcp-Session-Id` header (when one was assigned). All errors ignored by
  design: the spec lets servers answer `405`/`501` here. Consumes `self`.
- Per-request timeout is 5 s (`DEFAULT_REQUEST_TIMEOUT`), raisable via
  `set_timeout()`. `session_id()` returns the captured session id, if any.

### Wire semantics (exact header names used)

Requests: `Content-Type: application/json`, `Accept: application/json,
text/event-stream`, plus `Mcp-Session-Id: <id>` on every request after a
session was assigned. Responses are handled as follows:

| Status / content-type                     | Handling |
|--------------------------------------------|----------|
| `2xx` + `application/json`                | Body parsed as one JSON-RPC response; `result`/`error` mapped as usual (`McpError::JsonRpc` for error objects). |
| `2xx` + `text/event-stream`               | Body parsed as SSE; frames are consumed **incrementally** and the first frame whose JSON-RPC `id` matches this client's request id is used. Server-initiated messages inside the stream (notifications, requests) are parsed and ignored (`trace!`). A server that keeps the stream open after the response frame no longer blocks the client. |
| `202 Accepted` (any/empty body)           | Treated as success (the spec's "notification-only POST" shape); empty body → `Null` result. A 202 with a JSON body is parsed as usual. |
| Any other non-2xx                         | `McpError::HttpStatus { status, body }` (body lossy-decoded, verbatim). In particular `404` for an expired/unknown session is surfaced here — **no automatic re-initialize**. |
| `application/json` but invalid JSON       | `McpError::Protocol`. |
| Unexpected content type / missing          | `McpError::Protocol`. |

Session management: `Mcp-Session-Id` is captured **only from the `initialize`
response** and re-sent on all subsequent requests including the `close()`
DELETE. If the server assigns no session id, no header is sent and everything
still works (tested). If the server re-assigns an id on a later response it is
**not** adopted (kept simple; spec doesn't demand it).

**`Mcp-Protocol-Version` / `MCP-Protocol-Version` is deliberately not sent.**
This repository ships no copy of the spec text defining that header, and this
crate does not invent header names. If a future in-repo doc pins the spec
version, adding the header is a two-line change.

### New `McpError` variants (additive)

- `McpError::HttpStatus { status: u16, body: String }` — non-2xx responses.
- `McpError::Sse(String)` — SSE parse/dispatch failures: a `data:` frame
  whose payload is not valid JSON, or a stream that ended without a
  JSON-RPC response for the expected request id.

`McpError::UnsupportedTransport` remains for backwards compatibility (the
streamable-HTTP transport is implemented, so the HTTP client never returns
it; the stdio client never did either).

### SSE frame parser (`src/sse.rs`, hand-rolled, ~120 lines)

Handles: `field: value` lines with optional single leading space after the
colon; **multi-line `data:` accumulation joined with `\n`** (a leading blank
`data:` does not produce a leading newline); frames dispatched on the blank
line that terminates them; `:`-prefixed comment / keep-alive lines ignored;
`\n` and `\r\n` line endings; lines split across chunks (buffered until a
terminator arrives); a trailing unterminated line / unterminated final frame
is flushed at EOF (lenient, documented); `event:` and `id:` values parsed and
surfaced on the frame but **not used for routing** (MCP routes inside the
JSON-RPC payload, as with the `airi-llm` SSE reader); `retry:` parsed and
**ignored** (no reconnect logic); unknown extension fields ignored; invalid
UTF-8 replaced lossily (never panics); a frame with an empty `data` buffer is
not dispatched.

Explicitly **not** handled (deferred, see below): `retry:` reconnection,
`Last-Event-ID` resume, dispatch on `event:` type, an `id`-based frame store
for resumption, and answering server-initiated requests over SSE (the stdio
client answers them with `-32601`; doing so over HTTP requires a follow-up
POST and is out of scope).

### Registry discovery (`src/registry.rs`)

- `DEFAULT_REGISTRY_BASE_URL =
  "https://registry.modelcontextprotocol.io/v0.1/servers"` — the
  unauthenticated official MCP Registry endpoint, documented in
  `docs/research-open-apis-and-mcp-servers.md` (PulseMCP's v0beta endpoint is
  sunset; the official registry is the sanctioned listing API) and used by
  the AIRI settings MCP page with `version=latest&limit=30&search=…`.
- `list_registry_servers(base_url: &str, query: &str, limit: usize) ->
  Result<Vec<RegistryEntry>, McpError>` — single blocking GET with
  `version=latest`, `limit=<limit>`, and `search=<query>` (omitted when
  `query` is blank). `base_url` is always a parameter; **the test suite
  never touches the network** (mockito).
- `RegistryEntry { name, description, url, version }`. Mapping from the
  registry `server` record: `name` = `server.name`; `description` =
  `server.description` (empty default); `url` = `websiteUrl`, else
  `repository.url`, else first `remotes[].url`, else empty; `version` =
  `server.version`. Both the `{ "server": { … } }` wrapper used by the
  official registry and bare server objects are tolerated. Entries without a
  string `name` are skipped; a response without a `servers` array is
  `McpError::Protocol`; empty `servers` → empty `Vec`.
- **Registry response shape is best-effort and unverified against a live
  registry.** It is reconstructed from in-repo consumers (`mcp.vue`,
  `p9-lane-mcp-*.md`), not from a spec copy in this repo. The health probe
  in `scripts/tests/test-mcp-registry-health.ts` can confirm liveness and
  the `version=latest` contract; field-level mapping beyond `name`/`version`
  is assumed, not confirmed.

## Verified (by `cargo test -p airi-mcp`)

- Full **JSON round trip**: initialize (with `Mcp-Session-Id: session-abc-123`
  captured on the response) → `notifications/initialized` (202) →
  `tools/list` → `tools/call`, with the session header asserted on every
  subsequent request.
- Full **SSE round trip**: same sequence over `text/event-stream`, including
  a `: keep-alive` comment frame, a server `notifications/progress` frame
  before the response frame (ignored), an `event: message` frame, and a
  `tools/call` response split across **two `data:` lines** (multi-line data
  accumulation exercised end-to-end).
- `initialize` **without** `Mcp-Session-Id` → no header is sent subsequently
  (`Matcher::Missing` asserted), everything proceeds.
- HTTP **500** → `McpError::HttpStatus { status: 500, body }`; HTTP **404**
  on `tools/call` → same variant (no re-initialize).
- **Malformed SSE** (`data: {not valid json`) → `McpError::Sse`; SSE stream
  carrying only a notification → `McpError::Sse` (no response frame for the
  request id).
- `tools/call` with `isError: true` → `Ok(McpToolResult { is_error: true, … })`.
- Invalid endpoint URL / non-http(s) scheme → `McpError::Transport` (no I/O).
- Registry: canned `{ "servers": [ { "server": … } ] }` JSON parsed into
  `RegistryEntry`s (URL fallback chain exercised); empty `servers` → empty
  `Vec`; HTTP 503 → `McpError::HttpStatus`; missing `servers` array →
  `McpError::Protocol`.
- SSE parser unit tests: multi-line data join, CRLF + split chunks, comments,
  `event:`/`id:` surfacing, `retry:` ignored, EOF flush, no-data frames
  discarded, `data:value` without space.
- stdio suite still green, proving the stdio public API is untouched.
- Net suite: 27 lib unit tests (pre-existing jsonrpc/types tests + new
  SSE parser and registry entry tests), 9 HTTP-mock integration tests,
  4 registry-mock tests, 2 stdio e2e tests — all green.

`cargo test -p airi-mcp`, `cargo clippy -p airi-mcp --all-targets -- -D
warnings`, `cargo fmt -p airi-mcp --check` — all green.

## Deferred (explicit non-goals of this lane)

- **OAuth / bearer authentication** — the client never sends `Authorization`.
  Remote MCP servers requiring auth need a follow-up lane (probably an
  injectable `Authorization: Bearer …` header or an OAuth flow upstream).
- **SSE resume / reconnection** — no `Last-Event-ID`, no `retry:`, no
  backoff, no re-initialize on `404`.
- **Server-initiated requests over HTTP** — received inside SSE streams and
  ignored (not answered with `-32601` as on stdio, because answering requires
  a separate POST).
- **Registry shape verification** — see above; needs a live probe (or the
  spec) before the settings "Discover" flow can rely on `url`/`version`.
- **`MCP-Protocol-Version` header** — omitted until the spec text lands
  in-repo; do not cargo-cult the header name from SDK memory.
- **Persistent/long-lived SSE streams** beyond the request–response window,
  and `GET <endpoint>` standalone streams (spec allows a server to push
  notifications out-of-band; not implemented, not needed for this scope).

## Integration asks for the main agent

None beyond this crate. `airi-mcp` exports `McpHttpClient`,
`list_registry_servers`, `RegistryEntry`, `DEFAULT_REGISTRY_BASE_URL`,
`SESSION_ID_HEADER` and `ACCEPT_HEADER_VALUE` alongside the existing exports;
no other lane's files need to change for this to compile. If/when a Qt bridge
or settings page wants "connect to remote MCP server", the call sequence is
`McpHttpClient::connect(url)` → `initialize()` → `tools_list()`; note the
initialize handshake is synchronous and blocking (≤5 s worst case), so it
belongs on a worker thread, not the UI thread.
