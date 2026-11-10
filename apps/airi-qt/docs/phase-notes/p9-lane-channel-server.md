<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane G2 — Gateway channel server (Rust crate, Qt port)

Crate: `apps/airi-qt/crates/airi-channel` (`airi-channel`, workspace member). A minimal but real port of the AIRI gateway channel server (`:6121`): a local WebSocket server speaking the auth-token handshake contract from `.agents/skills/airi-gateway-websocket-protocol/SKILL.md`. **The Qt desktop app does not start it yet** — this lane delivers the crate, its tests, and this note. Nothing else in the workspace was touched.

Reference (read-only): Electron main service `apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts`; server-runtime `packages/server-runtime/src/server/index.ts` + `src/index.ts` (protocol shapes: `module:authenticate` → `module:authenticated`, `transport:connection:heartbeat` ping→pong with `MessageHeartbeatKind`/`MessageHeartbeat` enums from `@proj-airi/plugin-protocol`).

## What's implemented vs the skill's contract

| Contract (skill / Electron) | Status | Where / notes |
|---|---|---|
| Default port `6121`, `SERVER_CHANNEL_PORT` override | ✅ | `DEFAULT_PORT`, `server_channel_port()` in `lib.rs`; `parse_port` unit-tested |
| Bind `127.0.0.1` by default | ✅ | Healed config defaults `hostname: "127.0.0.1"`; `ChannelServer::bind` takes explicit hostname (loopback is the default everywhere, `0.0.0.0` requires the config to say so) |
| Config `server-channel/config.json` auto-heal, UUID authToken | ✅ | `config::load_or_heal(path)`; default path `<data>/airi-qt/server-channel/config.json` (`dirs::data_dir()`); missing/invalid JSON or empty/missing `authToken` → fresh UUIDv4, file rewritten; a valid `hostname` is preserved across token regeneration |
| UUIDv4 for token | ✅ | Hand-rolled in `uuid.rs` from `/dev/urandom` on Unix. Non-Unix fallback is xorshift64\* seeded from `SystemTime` nanos ⊕ pid and is **explicitly not cryptographic** — documented in module docs |
| Mandatory authToken handshake before any state | ✅ | `session.rs`. First message must be auth. Two accepted shapes: simple `{"type":"auth","authToken":…}` → `{"type":"auth","ok":true}`; or the server-runtime mirror `{"type":"module:authenticate","data":{"token":…}}` → `{"type":"module:authenticated","data":{"authenticated":true}}`. Mismatch / non-auth / malformed JSON / missing token → typed `error` frame + **close 1008**, before any state or any other message is emitted |
| Unauthenticated sockets receive nothing else | ✅ | Every pre-auth failure path yields exactly one reply (the error frame) and a close; unit test `unauthenticated_socket_receives_nothing_else` |
| Token check with constant-time-ish compare | ✅ | `tokens_equal` — content compared without early exit; length compared first (length leak accepted for fixed-shape UUIDs, documented) |
| `ping` → `pong` | ✅ | `{"type":"ping"}` → `{"type":"pong"}` |
| Server-runtime heartbeat mirror | ✅ | `transport:connection:heartbeat` with `kind:"ping"` → `kind:"pong"`, `message:"💛"`, `at:<ms>` (mirrors `MessageHeartbeat.Pong`). Non-ping kinds get no reply, matching the server-runtime |
| `rpc` passthrough | ✅ (placeholder) | `{"type":"rpc","action":"x","payload":…}` → `{"type":"rpc","action":"x","ok":true,"payload":…}`. **Echoes payload; executes nothing.** Documented placeholder for the real renderer bridge (see deferred) |
| Unknown types → typed error | ✅ | `{"type":"error","error":{"code":"unsupported_type","message":…}}`, connection stays open. Error codes: `auth_required`, `bad_message`, `bad_auth_message`, `invalid_token`, `invalid_rpc`, `unsupported_type` |
| Close handshake | ✅ | Close frames echo the payload; after auth-failure replies a close 1008 is sent; binary frames → close 1003; invalid UTF-8 in a text message → close 1007; fragmented-message violations → 1002; >1 MiB message → 1009 |
| WebSocket framing (hand-rolled) | ✅ | `ws.rs`: HTTP Upgrade parse (GET, Host-independent, `Upgrade`/`Connection` token lists, key, version 13), `Sec-WebSocket-Accept` via inline SHA-1 (`sha1.rs`, FIPS 180-1, RFC 6455 vector `dGhlIHNhbXBsZSBub25jZQ==` → `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`) + inline Base64 (`base64.rs`). Text frames + continuation reassembly, ping/pong, close; client→server frames unmasked by the decoder; server→client never masked; 16-bit and 64-bit extended lengths; 1 MiB payload cap; RSV bits and fragmented control frames rejected. No external crates (no `sha1`, no `ws`) |
| Plain `ws://` | ✅ | No TLS anywhere in this crate |
| LAN binding / `0.0.0.0` | ⚠️ deliberately narrower | Config can request it, but the default and the docs steer to loopback; **no LAN discovery** (`getLocalIPs()` not ported) |
| mkcert TLS | ❌ deferred | See below |
| Real RPC bridge → renderer | ❌ deferred | `rpc` echo only; no eventa/injeca wiring, no host capability calls |
| Origin validation | ❌ deferred | See below |
| Health-check / auto-restart loop | ❌ deferred | Electron retries startup with backoff and health-checks every 5 s; `run()`/`spawn()` serve until stopped, no watchdog |

## Deferred (explicit cut)

1. **TLS / mkcert** — the Electron service generates a local CA + server cert (SANs: `localhost`, `127.0.0.1`, `::1`, detected LAN IPs), writes `websocket-{ca,key,cert}.pem` into userData, installs the CA into the OS trust store, and passes `tlsConfig` to `createServer`. None of that exists here; there is no TLS stack in the lane's dependency budget (and none was permitted). **Implication:** the auth token crosses the wire in plaintext; over loopback that is the same exposure as the Electron default without `tlsConfig`, which is how the dev workflow runs.
2. **LAN binding + IP discovery** — `getLocalIPs()` (filters `vboxnet`/`docker`/`veth`/… prefixes) not ported. `0.0.0.0` is technically possible via config but is plaintext-on-LAN; not recommended until TLS lands.
3. **Real RPC bridge → renderer** — `rpc` echo is a wire-shape placeholder. The renderer-side bridge (eventa/injeca or the Qt equivalent, target definitions, streaming, backpressure, auth scoping per action) is a design decision for a later wave.
4. **Origin validation** — any local process can attempt the handshake; possession of the token is the only gate. The arch hardening doc (`docs/arch-gateway-security-hardening.md`) lists Origin checking as a mitigation; not ported.
5. **Rate limiting / brute-force protection** — none. Mitigation is token entropy (UUIDv4, 122 bits). Loopback + high entropy is an acceptable stopgap; a LAN-exposed deployment is not.
6. **Module registry, `module:announce`, routing policies, audio streaming** — out of scope by design; this is a handshake + minimal message lane, not a `server-runtime` clone.
7. **Watchdog/auto-restart** — Electron keeps the server alive with backoff + 5 s health checks; here `ServerHandle::stop()` is the only lifecycle control. The Qt integration decision (see below) may obsolete this either way.

## Security posture (honest)

- No TLS; loopback-only by default; `0.0.0.0` is possible but plaintext-LAN.
- Token stored **in plaintext** at `<data>/airi-qt/server-channel/config.json`, exactly like Electron's `createConfig` + `autoHeal: true`. File permissions on the data dir are the only protection.
- Auto-heal means a corrupted/empty config silently regenerates the token — all paired clients drop and must re-pair. That's upstream's contract, not a new behavior, but it should inform the Qt UX (surface "token regenerated" in settings).
- Unmasked client frames are tolerated (decoder accepts them) rather than RFC 6455-strict-rejected, because loopback has no intermediary cache to poison; payloads are length-prefixed and capped at 1 MiB. Documented in `ws.rs`.
- Handshake deadline: 10 s to deliver the HTTP Upgrade headers, then no read timeout — idle authenticated clients are expected (companion apps).
- Binary frames rejected (close 1003); RSV bits rejected; control frames must be FIN + ≤125 B; reserved opcodes rejected (1002).

## Test evidence

Commands (run in `apps/airi-qt`):

- `cargo test -p airi-channel` → **51 passed** (46 unit + 5 integration), 0 failed.
- Integration suite (`tests/channel_server.rs`) run 6× consecutively, plus once with `CHANNEL_TEST_PORT=16199` — all green. Tests self-serialize via a `Mutex` (required when the env var pins a fixed port; harmless otherwise; default is an ephemeral port via port `0`).
- `cargo clippy -p airi-channel --all-targets -- -D warnings` → clean.
- `cargo fmt -p airi-channel -- --check` → clean.
- `#![deny(missing_docs)]` everywhere; every file carries the SPDX header; no new dependencies (std + workspace deps only; `tokio` was dropped from the stub because the implementation is std-threads).

Covered:

- Frame codec: round trips (masked/unmasked, 16/64-bit extended lengths, fragmented stream reassembly, oversize cap, reserved bits, fragmented control frame, invalid 64-bit length path via cap).
- HTTP Upgrade: parse happy path, wrong method, bad/missing version, missing key, `Connection` without `upgrade` token, header-block-complete detection, `101` response shape, RFC 6455 accept-key vector.
- SHA-1 vectors (empty, `abc`, quick-brown-fox, 1000×`a`) and Base64 RFC 4648 vectors.
- UUIDv4 shape + uniqueness.
- Config auto-heal: missing file → created (+ parent dirs) with a UUID token and preserved on second load; invalid JSON → regenerated (file rewritten, token valid); empty `authToken` → regenerated; valid file (incl. `0.0.0.0`) → untouched; hostname preserved across token regeneration.
- Session state machine (pure, no sockets): both auth shapes accepted; wrong token → error + close 1008; first-message-not-auth → error + close; malformed JSON → close pre-auth / typed error post-auth; `ping`→`pong`; heartbeat pong mirror; non-ping heartbeat silent; `rpc` echo; `invalid_rpc`; `unsupported_type` stays open; post-auth session usable after typed errors.
- Integration (raw `TcpStream`, hand-rolled client, ephemeral port): upgrade with known accept vector; simple-shape auth; server-runtime-shape auth; bad token → error frame + close 1008; non-auth first message → `auth_required` + close; ping/pong; heartbeat mirror; `rpc` echo; `unsupported_type` → session still usable; clean close echo; control-frame ping → pong.

Known limitations of the tests: no concurrency stress (one connection at a time), no slowloris/handshake-timeout assertion, no TLS (nothing to test), no OS-level file-permission check on the config. The integration test relies on wall-clock read timeouts (5 s) rather than flakiness-prone retries; if it ever flakes in CI, mark it `#[ignore]` and rely on the unit suite — but 6/6 green runs so far.

## Integration asks (Qt wiring is deliberately NOT in this lane)

**Bind-on-start vs opt-in is a design decision the desktop port must make explicitly.** Electron starts the gateway unconditionally on app start (`onStart` → `ensureServerRunning` + 5 s health check restarting it). The Qt port should not copy that by accident. Asks for the integration lane/owner:

1. **Bind-on-start vs opt-in.** Recommend opt-in on first release (settings toggle "Enable gateway for external companions", default off) — the crate is loopback-only plaintext and is a new always-on TCP surface. If product wants Electron parity (always on), that's fine, but it should be a signed-off decision, recorded in the wave plan, not a default that slipped in.
2. **Lifecycle ownership.** Who calls `ChannelServer::bind` + `spawn`? Needs the resolved `dirs::data_dir()` story (the Qt app may use a different data root than `~/.local/share`), startup ordering vs the rest of the services, and shutdown on quit (`ServerHandle::stop`).
3. **Config read path.** The gateway's auth token must reach the companion-client pairing UX (settings page "Connection" showing the token, regenerate button calling `electronApplyServerChannelConfig`-equivalent). Regeneration invalidates active connections — mirror Electron's semantics or diverge deliberately; document either way.
4. **Renderer bridge for `rpc`.** The `rpc` echo needs a real dispatch target (eventa-equivalent for Qt, or a Rust-side command registry). Without it the gateway authenticates but can never do anything an external client wants; wire it before advertising the gateway to users.
5. **TLS story before LAN.** Do not wire `0.0.0.0`/LAN exposure (or phone pairing) until the mkcert-equivalent question is settled — either port cert generation or gate the binding behind loopback. Plaintext + `0.0.0.0` is the worst quadrant.
6. **Observability.** The crate logs via `tracing` (`debug`/`warn`); the Qt app should install a subscriber or explicitly accept silence. No metrics, no connection counters yet.
7. **Health surface.** If always-on binding is chosen, port the watchdog (start failure backoff + liveness) or accept a dead gateway that only logs once.

## File map (this lane only)

- `crates/airi-channel/Cargo.toml` — deps: serde, serde_json, thiserror, dirs, tracing (+ tempfile dev). `tokio` removed from the stub (unused).
- `crates/airi-channel/src/lib.rs` — crate docs/security posture, `DEFAULT_PORT`, `server_channel_port`, re-exports.
- `crates/airi-channel/src/ws.rs` — framing + upgrade parse.
- `crates/airi-channel/src/sha1.rs`, `src/base64.rs` — inline crypto for the handshake (SHA-1 is RFC-mandated here and nothing else).
- `crates/airi-channel/src/uuid.rs` — UUIDv4.
- `crates/airi-channel/src/config.rs` — auto-heal persistence.
- `crates/airi-channel/src/session.rs` — pure protocol state machine.
- `crates/airi-channel/src/server.rs` — TCP listener, per-connection threads.
- `crates/airi-channel/tests/channel_server.rs` — integration tests.

## Working tree

Nothing committed or pushed. The crate directory is untracked (`?? apps/airi-qt/crates/airi-channel/`); the only other lane file is this note. `cargo` ran in `apps/airi-qt`. The workspace `Cargo.toml` already listed `crates/airi-channel` as a member before this lane started (pre-existing uncommitted delegation setup, alongside the `airi-acp`/`airi-mcp` entries); `cargo` did rewrite the `airi-channel` package entry in `apps/airi-qt/Cargo.lock` to record its dependencies (`dirs`, `serde`, `serde_json`, `tempfile` dev-dep, `thiserror`, `tracing` — the stub's unused `tokio` entry is gone). No other lock entries were modified. Other modified/untracked paths in the tree (`crates/airi-qt/**`, `qml/**`, `docs/phase-notes/p9-lane-cloud-sync.md`, `p9-lane-plugin-host.md`, etc.) belong to other lanes and were not touched.
