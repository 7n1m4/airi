<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane C1 — MCP streamable-HTTP: static bearer `Authorization` support

Wave ⑨ lane C1. Scope: `apps/airi-qt/crates/airi-mcp/**`,
`apps/airi-qt/crates/airi-qt/src/bridges/mcp.rs`, this note. Nothing else
was touched (no build.rs, no `bridges/mod.rs`, no locales, no QML, no
Cargo.toml anywhere, no git writes).

Date: 2026-11-12. No dependencies were added; `mockito` was already a
dev-dependency of `airi-mcp`.

## What shipped

Remote (`url`-configured) MCP servers in `mcp.json` can now carry a
**static bearer token** that is sent as `Authorization: Bearer <token>` to
the configured endpoint. Previously these servers connected with no auth
at all and were unreachable when they required a token.

### Config format (mcp.json)

One new optional key on a *remote* server entry, next to `url`:

```json
{
  "mcpServers": {
    "example-remote": {
      "url": "https://mcp.example.com/mcp",
      "authToken": "sk-replace-me",
      "enabled": true
    }
  }
}
```

* `authToken` (string, optional). Exactly mirrors the gateway channel's
  pre-existing `authToken` posture: **plaintext in the user's own
  `mcp.json`**, which is the same storage posture as existing secrets in
  this app. `mcp.json` is edited directly by the user/admin — there is no
  UI for the token (the MCP settings page is not part of this lane).
* Empty or whitespace-only `authToken` is treated as **absent** (no header
  is sent), so a stub key left behind by a template does not produce
  `Authorization: Bearer `.
* Entries without `authToken` behave exactly as before this change.
* The token file-format notes apply to the Qt build's own config
  (`<profile>/airi/mcp.json` or `<platform-data>/airi-qt/mcp.json`). Note
  that this path convention mirrors Electron's `appData/airi/mcp.json` —
  the two builds may share a file. This lane does not change how Electron
  parses it; unknown keys are generally tolerated by serde-style parsers
  but **this has not been verified against Electron's `mcpConfigSchema`**
  (see not-done).

A `headers` object also exists on the entry (pre-existing). It is still
**parsed but not sent** by the transport — see honest-limitations below.
Sensitive `headers` values are now redacted in the QML view-model; use
`authToken` for credentials.

### QML view-model additions

`serversJson` (the only thing QML sees) now contains, per server:

* `authConfigured`: boolean — `true` when an `authToken` is set. The token
  itself is never emitted anywhere.
* `headers`: sensitive values (name contains, case-insensitively:
  `auth`, `token`, `secret`, `password`, `credential`, `api-key`,
  `apikey`) are replaced with `***`. Non-sensitive values pass through.
  (Headers were emitted raw before this lane — any `Authorization` a user
  had placed there previously leaked to QML. Fixed here.)

No QML page was modified. The existing page ignores both changes.

### Round-trip protection (save path)

The QML page round-trips the server list through `saveServers`. Because
the view-model never contains secrets, `saveServers` now merges against
the on-disk config before writing:

* a `headers` value equal to `***` is restored from the disk entry with
  the same server name; a `***` value with no disk counterpart is
  **dropped** (a sentinel never lands in `mcp.json`);
* an absent or null `authToken` key preserves the disk entry's token;
* an explicit non-empty `authToken` string in the payload overwrites it
  (admin scripting convenience);
* there is intentionally **no** way to clear a token from QML — remove it
  by editing `mcp.json` directly.

### Client changes (`airi-mcp`)

`McpHttpClient`:

* new constructor `McpHttpClient::connect_with_auth(url, bearer_token:
  Option<&str>) -> Result<Self, McpError>`; `connect(url)` is now exactly
  `connect_with_auth(url, None)` — no behavioral change for existing
  callers.
* token storage: private `bearer_token: Option<String>` field; **no
  accessor** (mirrors `DiscordRestClient`).
* trimming + validation at connect time: whitespace-only → treated as
  absent; a token containing characters invalid in an HTTP header value is
  rejected with `McpError::Transport` **without echoing the token**.
* `Debug` for `McpHttpClient` prints `bearer_token: "***"` and the struct
  fields (previously there was no `Debug` impl).
* the `Authorization` header is attached in `send_request`,
  `send_notification` and `close()` (best-effort `DELETE`), i.e. on every
  request path to the configured endpoint. Header names used are exactly
  `Accept`, `Content-Type`, `Mcp-Session-Id` and (only when configured)
  `Authorization`.
* every error escaping `initialize` / `tools_list` / `tools_call` /
  `send_notification` is passed through `scrub_error`, which replaces all
  occurrences of the literal token with `***` in: `Transport`, `Sse`,
  `Protocol`, `UnsupportedTransport` strings; the `HttpStatus` body; the
  `JsonRpc` `message`; and recursively inside `JsonRpc` `data`. The
  `close()` debug log line is scrubbed as well.
* timeout/body-cap behavior is unchanged (5 s default request timeout,
  reusable via `set_timeout`; `connect_timeout` 5 s; no body cap was added
  or removed — none existed and none was asked for).

`McpError::HttpStatus` doc-comment updated to state the token scrub; the
variant itself is unchanged (backwards compatible). `lib.rs` docs updated
(static bearer supported; the "Not implemented" list now scopes OAuth only).

### Redirect policy

**Redirects are not followed.** The `reqwest` blocking client is built
with `redirect::Policy::none()`. Rationale: MCP streamable-HTTP endpoints
answer requests directly, and `reqwest` forwards header values on redirect;
a cross-origin redirect (or a compromised endpoint) would otherwise carry
`Authorization: Bearer <token>` to a different origin — a silent
cross-server credential leak. Surfacing `3xx` as `McpError::HttpStatus`
(an error) is the honest failure mode. This applies whether or not a
token is configured, so unconfigured clients also stop following redirects
(behavior change for servers that relied on redirect following — see
limitations). The `close()` `DELETE` is likewise not re-targeted.

### Where redaction is enforced

| Surface | Mechanism |
|---|---|
| `McpHttpClient` `Debug` | manual impl; token shown as `***` |
| `McpError` Display/Debug (all variants carrying server/transport text) | `scrub_error` at the public-API boundary (`initialize`, `call`, `send_notification`) |
| `close()` trace log | token replaced with `***` |
| `McpServerEntry` `Debug` | manual impl; token `***`, sensitive headers redacted |
| `serversJson` QML view-model | token never emitted; `authConfigured` boolean only; sensitive headers → `***` |
| disk write (`saveServers`) | `***` sentinels restored from disk or dropped; `authToken` preserved from disk when absent from payload |
| QML-invokables (`probeServer`, `callTool`, `saveServers`, `lastError`) | no token in any returned string; underlying errors scrubbed by `airi-mcp` |

`McpConfigFile` keeps its derived `Debug`, which is now safe because
`McpServerEntry`'s manual `Debug` redacts.

### Redaction does NOT cover

A server that replies with e.g. a base64-transformed or reversed token
payload is out of scope — scrubbing matches the literal token string only.
Also, an intentional user-side decision to embed the token in the
endpoint URL itself (`https://user:token@host/...`) would put it in
`endpoint()` output and in transport-error URL strings; scrub_error still
applies to the error path (the URL-embedded literal substring would also
be replaced), but the URL is otherwise visible. Don't do that.

## Tests

### airi-mcp (`cargo test -p airi-mcp`) — 51 passed, 0 failed

Unit (27): pre-existing jsonrpc/sse/registry units — all still green.

New integration suite `crates/airi-mcp/tests/http_auth.rs` (9 tests; all
against `mockito`, no real network):

1. `bearer_token_is_sent_on_every_request`
2. `no_authorization_header_when_no_token_configured`
3. `whitespace_only_token_is_treated_as_no_token`
4. `unauthorized_401_surfaces_typed_error_without_token` (asserts both
   `Display` and `Debug` of the error are token-free)
5. `error_strings_never_contain_the_token_even_when_the_server_echoes_it`
   (hostile 403 body echo **and** JSON-RPC `error` object echo, incl.
   `data`; asserts `Display` and `Debug`)
6. `debug_output_redacts_the_token`
7. `redirects_are_not_followed` (302 → typed `HttpStatus(302)`; the
   redirect target mock is asserted to receive zero requests)
8. `close_sends_authorization_header_to_the_same_endpoint`
9. `bearer_token_with_invalid_header_characters_is_rejected`

Pre-existing suites still green: `http_mock.rs` 9, `registry_mock.rs` 4,
`stdio_mock.rs` 2.

### airi-qt (`cargo test -p airi-qt --bins`) — 17 passed, 0 failed

New bridge unit tests in `bridges/mcp.rs` (7):

`auth_token_serializes_as_camel_case_auth_token_key`,
`missing_auth_token_deserializes_to_none_and_omits_the_key`,
`debug_output_redacts_the_token`,
`sensitive_headers_are_redacted_case_insensitively`,
`redacted_sentinels_are_restored_from_disk_on_save`,
`redacted_sentinel_without_disk_counterpart_is_dropped`,
`bearer_token_trims_and_rejects_whitespace`.

### Other gates

* `cargo check -p airi-qt` — clean (the bridge is compiled; not skipped).
* `cargo clippy -p airi-mcp -p airi-qt --all-targets -- -D warnings` — clean.
* `cargo fmt --check` (whole `apps/airi-qt` workspace) — clean.
* GUI smoke: **not run** — the central session owns that gate.

Note: `airi-qt` was compiled and unit-tested via the normal binary target
(`cargo test --bins`); a `/tmp`-copy check was not needed and not used.

## What remains untouched

* QML (`qml/pages/settings/modules/mcp/McpSettingsPage.qml`) — not modified;
  nothing in this lane requires new locale keys.
* `bridges/mod.rs`, `build.rs`, locales, `Cargo.toml` files — untouched.
* stdio transport (`client.rs`) — untouched.
* `McpConfigFile` on-disk schema: `authToken` is additive and optional;
  serialization omits it when `None`; no migration is required or performed.
* The `headers` field is still parsed-but-not-sent by the transport
  (only `authToken` produces an `Authorization` header).
* The settings page: no token field was added. If a user/admin UI for
  editing remote `authToken` is wanted, that is a separate lane
  (locale keys + UI + review) — report, don't sneak in.

## Honest limitations / caveats

* **Redirect behavior change affects unconfigured clients too**: previously
  `reqwest`'s default policy followed redirects (up to 10); now none do.
  A remote MCP server that redirects (e.g. `http` → `https`) will surface
  `McpError::HttpStatus(302)` with a location the caller never dereferences.
  Users with such servers must configure the final URL directly. Chosen
  deliberately; see the redirect section.
* **`headers` is not wired to the transport.** A user who puts
  `headers: { "Authorization": "Bearer …" }` in `mcp.json` gets it redacted
  in the UI but **not sent**. This is pre-existing behavior kept to stay
  minimal; wiring arbitrary headers to the wire is a separate decision.
* **Electron schema compatibility of the `authToken` key**: the Qt build
  reads/writes the same `mcp.json` convention Electron uses. Unknown keys
  are usually tolerated by Electron's `mcpConfigSchema` (zod `.passthrough()`
  or similar) but this has **not been verified**; if Electron strips
  unknown keys on its own save, the token would vanish from the file on the
  next Electron-side save. Editing is expected to happen by hand / by Qt.
* **`env` values are still emitted raw** to QML (pre-existing; env often
  carries stdio-server API keys). Out of this lane's scope — worth a
  follow-up lane if the settings page ever displays them.
* Scrubbing replaces exact literal token occurrences only (see above).
* No live-network test was run; all transport tests use `mockito` loopback.

## Not done (explicitly)

* No OAuth flow, no `WWW-Authenticate` handling, no token refresh, no
  token discovery (RFC 9728 or otherwise), no DPoP/mTLS.
* No UI change of any kind (no QML, no locales, no new settings keys).
* No persistence beyond `mcp.json` (no keychain, no secure storage — same
  posture as existing secrets).
* No token logging anywhere (trace/debug kept token-free; no `println`s).
* No redirect following (by design, above).
* No `headers` → transport wiring.
* GUI smoke test not run (central session gate).
* No git commit/push; changes are in the working tree only.

## If you extend this later

* To support OAuth: that is a new lane with its own design discussion —
  do not grow this client incrementally with refresh logic.
* To wire `headers` through: it needs the same redaction/round-trip
  treatment `authToken` got, plus the decision of which headers are safe
  to forward (this lane deliberately does not answer it).
* If a Qt-side "set token" affordance is approved, it needs: page field +
  `McpController` invokable writing to `mcp.json` atomically + locale keys
  + a decision on whether the token echo back to the UI is ever allowed
  (presumably never).
