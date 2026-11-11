<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ⑦ batch — remaining backends (write-safe lanes) + devtools waiver (user decision)

Six lanes, exclusive write scopes, central integration with the workspace gate after
they reported. Plus the devtools waiver (committed separately as `9a1a927d5`).

## User decisions applied

- **P10 MMD approved.** No `.pmx` exists in-repo or on disk — the license-clean
  fixture is still the open item (see §MMD). Physics stays feature-gated OFF;
  PMD deferred; two-step toon ramp recommended (unconfirmed — see MMD note).
- **Devtools waived for Qt v1** — the 25 (a)-class devtools rows
  (7 stage-tamagotchi routes, 10 stage-pages routes, 8 context-flow non-route)
  are now `[-]` "Waived (stay in Electron/web)" via a new `features.waivers.json`
  sidecar (generator patched; regeneration-safe). Unchecked 214 → 189.
  Electron/web remains the parity home of the devtools surface; nothing there is
  removed. Live2D-deferred and Electron-only (c) rows unchanged. Qt Screen
  Capture / Plugin Host pages remain as new functionality (not ports).
- **Remaining backends delegated as write-safe lanes** — this note.

## Lanes

- **Lane I1 — MCP streamable HTTP + registry discovery** (`docs/phase-notes/p9-lane-mcp-http.md`).
  `McpHttpClient` (blocking reqwest, no tokio): initialize → tools/list → tools/call → best-effort `DELETE`; `Accept:` negotiation; response dispatch `application/json` | `text/event-stream` | `202`; incremental SSE parser (multi-line `data:`, keep-alives, split-chunk buffering, never panics); session id via `Mcp-Session-Id` on both directions; typed `HttpStatus`/`Sse` errors (additive). Registry: `list_registry_servers(base_url, query, limit)` — base URL injectable, default targets the official registry (**shape unverified against live registry**, documented). 42 tests (mockito). Not done: OAuth, SSE resume/reconnect, `-32601` server-initiated requests, `MCP-Protocol-Version` header (not invented).
- **Lane I2 — ACP session management** (`docs/phase-notes/p9-lane-acp-sessions.md`).
  Stable-v1 methods verified against the SDK schema: `session/load` (replay accumulation, 10 s bound, raises via `set_timeout`), `session/list` (cursor pagination, 100-page cap), `session/resume`, `session/delete`, `session/set_mode`, `session/set_config_option` (both union arms). New typed errors: `Unsupported` (`-32601`), `SessionNotFound` (`-32002`, judgment call — documented). Additive API only; no Electron parity baseline exists (it calls none of these). 62/62 tests. Not done: `authenticate`/`logout`, elicitation, `session/fork` (unstable-only), `$/cancel_request`, cwd filter, raw cursor passthrough, v2.
- **Lane I3 — channel gateway RPC dispatch** (`docs/phase-notes/p9-lane-channel-rpc.md`).
  `dispatch.rs`: stateless `RpcRegistry` — `runtime.ping`, `runtime.status` (app/version/pid/uptime/protocol), `gateway.config` (**never emits authToken**), `gateway.auth`. `renderer.*` → typed `rpc_not_implemented`; unknown → `rpc_unknown_method`; bad payload → `rpc_bad_payload`. Envelope now `{type,action,id,data|error{code,message}}` (placeholder `payload`-echo replaced — two placeholder-era tests updated). Auth still mandatory pre-dispatch (asserted). Ephemeral-port bind resolves real OS port into `RpcContext`. 66/66 tests (incl. live-listener round trip + token-absence assert). `renderer.*` needs a GUI-thread bridge lane (future).
- **Lane I4 — `airi-sync` BYOS local-FS snapshot engine** (new crate; `docs/phase-notes/p9-lane-sync.md`).
  `create_snapshot` (plain-copy `<id>.snap/files/` tree + manifest.json last), `list_snapshots`, `verify_snapshot` (sha256 re-hash), `restore_snapshot` (DryRun plan | `require_clean` default-true overwrite guard, deletions never propagated), `prune_snapshots` (refuses 0, TOCTOU-checked canonical `*.snap` only). Symlinks never followed; manifest-path validator; pre-flight completeness check. **zip dependency removed** (plain-copy v1). 13/13 tests. Not done: S3/Hyperdrive, encryption at rest, scheduling, compression, IndexedDB migration (never), Qt wiring.
- **Lane I5 — `airi-discord` REST client** (new crate; `docs/phase-notes/p9-lane-discord-gateway.md`).
  Blocking reqwest: `get_gateway_url`, `get_current_bot_user`, `send_message`, `get_channel`; injectable base_url (never discord.gg); `Bot` auth; rate-limit capture (`X-RateLimit-*`), typed `RateLimited{retry_after, global}`; token redacted in Debug, never logged. 14/14 mockito tests. **Gateway WebSocket (op 10 → IDENTIFY → heartbeat → MESSAGE_CREATE) is blocked: no websocket client in the workspace; `tokio-tungstenite` would be a new dependency (user decision).** Next Qt step: write-only token field (0600) → bridge → client; never auto-send; human-in-the-loop only.
- **Lane J1 — `airi-mmd` M0 completion** (`docs/phase-notes/p10-lane-mmd-m0.md`).
  VMD parser (`Vocaloid Motion Data 0002`, bone/morph keys, CP932 names stored raw + ASCII-lossy decode, camera/light/shadow sections skipped, legacy signatures tolerated with flags) — **all 14 repo VMDs parse** (frame ranges 0–5639). PMX morphs now decoded (was `UnsupportedFeature`): group/vertex/bone/UV/additional-UV/material, two-pass index validation. Synthetic PMX round-trip integration test. `AIRI_TEST_MMD_MODEL`/`AIRI_TEST_MMD_ZIP` env-gated live tests (silent skip). 31 tests. Not done: no real `.pmx` ever parsed (all fixtures constructed); camera record size 61 B unverified; `0000`/`0001` tolerance unverified; IK-on/off tail stored opaque (uninterpretable without a count).

## Verification (after integration — lanes edited no shared files)

- `cargo fmt --all --check` clean · `cargo clippy --workspace --all-targets -- -D warnings` clean (30 s).
- `cargo test --workspace` — **46 suites green, 0 failures** (lane crates: airi-mcp 42, airi-acp 62, airi-channel 66, airi-sync 13, airi-discord 14, airi-mmd 31).
- `QT_QPA_PLATFORM=offscreen --smoke` — exit 0 (splash, control-strip, chat, settings, about, stage).
- i18n untouched this wave (no new user-facing strings; parity 4/4 still holds from wave ⑥).

## Honest limits / pending

- No GUI verification of anything beyond module load; no real Discord/ACP/registry traffic ever sent.
- `airi-sync` is engine-only; Cloud Sync page remains an honest scaffold with disabled actions.
- Gateway `renderer.*` RPC is a typed stub — external clients cannot drive the Qt app yet.
- MMD M0 is complete; **M1 (static rest-pose render) is the next P10 milestone** and needs the license-clean `.pmx` call from the user (or acceptance of synthetic-only verification) plus a SDEF→BDEF2 approximation in-scene.
- Discord Gateway WebSocket and any `tokio-tungstenite` addition are **user dependency decisions**.
- Wave ⑦ commits: this note + the two stub crates + lane crates on top of `9a1a927d5` (manifest waiver).
