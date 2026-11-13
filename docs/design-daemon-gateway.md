# Design: Daemon-Hosted Gateway

**Status:** implemented (Rust side, 2026-11-13) · **Owner:** project lead

## Topology

The gateway (`airi-channel`, WS on 6121) moves from the desktop app into the
always-on user-session daemon. The app becomes another thin WS client.

```text
external clients (Slint app, VS Code, scripts)
        │ ws://[host]:6121   wss://[host]:6121 (TLS flag)
        ▼
   airi-daemon          org.moeru.airi.Daemon1 (D-Bus control)
        │                 GetGatewayConfig / ApplyGatewayConfig /
        │                 RegenerateGatewayToken
        ▼
   airi-channel         rustls acceptor, Session state machine,
        │                typed wire frames (see crates/airi-channel/src/wire.rs)
        ▼
   TCP 6121             loopback default; LAN/VPN/tailnet via 0.0.0.0 + TLS
```

## Decisions

- **Single binder.** The `Systemd` unit grants `AF_INET/AF_INET6`; the app's
  in-app channel server must be disabled (pending increment 2 below). Port
  contention during transition: the daemon retries every 15 s and reports
  `bound: false` + `lastError`; awareness is unaffected either way.
- **Config adoption.** The desktop app's `<userData>/server-channel-config.json`
  (Electrobun/Electron `createConfig`) is adopted by *copying* into the
  daemon-owned path on first run, **preserving `authToken` and `tlsConfig`**,
  so paired devices and TLS settings survive the migration. The copy is
  authoritative afterwards; `AIRI_SERVER_CHANNEL_CONFIG` overrides everything
  and is used write-through.
- **TLS is always available; loopback `ws://` is the local default.** Per the
  2026-11-13 call: `ws://` for local is good, wss stays mandatory beyond
  loopback. **Transport policy is enforced in code:** `tlsConfig` on / flag
  off binds plaintext only when the hostname is loopback; any non-loopback
  hostname (`0.0.0.0`, LAN IP, mDNS/tailnet DNS) is **wss-only regardless of
  the flag** (forced, logged, audited via the D-Bus apply path). The forced
  value never rewrites the stored flag, so switching back to loopback
  restores plaintext. `tlsConfig` remains an opaque flag: absent/`null` =
  plaintext (loopback-only); present (`{}`) = `wss://` with a locally minted
  CA + SAN-covered leaf (SANs: localhost, loopback IPs, host LAN IPs,
  configured hostname). The CA lives next to the config (`certs/`) and is
  reused; only the leaf re-mints on SAN drift. Client trust of the local CA
  is a deliberate, user-visible step (same model as mkcert).
- **No public relay.** Internet exposure would need per-client tokens,
  revocation and rate limiting — none of which exist. LAN/VPN/tailnet only.

## Security posture (threat model)

"Is `ws://` on loopback open?" No — connection is gated by the mandatory
first-message auth handshake with the `authToken` (random 122-bit UUID,
close 1008 on failure) in both `ws://` and `wss://` modes. What differs is
what an attacker can *learn* before that gate:

- **Same-uid processes (local malware)**: no difference between `ws` and
  `wss` — same-uid can read `config.json` (0600, owner-only as of
  2026-11-13) or the CA key (0600) directly and authenticate as a client.
  Transport crypto does not help against an attacker who already owns the
  user's files. The mitigations here are OS sandboxing of other processes,
  not transport.
- **Other-uid local users**: mitigated by the **0600** token/config file
  (previously world-readable — fixed), and by loopback binding (no LAN
  exposure). `wss` on loopback adds only defense-in-depth here.
- **LAN/VPN peers (non-loopback bind)**: `ws://` would let anyone on the
  segment sniff the token in flight; this is why **non-loopback is forced
  `wss://`**. Private CA mint + client-side trust is the entry cost.
- **Remote internet**: unsupported. Token-only auth is not revocation- or
  rate-limit-capable for hostile networks.
- Treat the local CA private key exactly like the token: 0600, never leaves
  the host except via the client-trust install step (also 0600 handling).
- **Same-uid session access is accepted.** Any process running in the user's
  session can call the token-bearing verbs on `org.moeru.airi.Daemon1` —
  `GetGatewayConfig` (returns the auth token), `ApplyGatewayConfig` (rebind /
  rotate TLS flag), `RegenerateGatewayToken` (evicts every paired client).
  No sender authorization is enforced (no polkit, no caller allowlist); the
  session bus is treated as same-user-trusted, exactly as `config.json` (0600)
  is. Protection is OS sandboxing of other processes, not the bus. This is a
  deliberate decision; if you want it enforced, it is a policy change, not a
  code fix.
- **D-Bus is the control plane.** `GetGatewayConfig` (read; audited nothing —
  read-only), `ApplyGatewayConfig` (Electron-handler payload shape:
  `{ websocketTlsConfig?, authToken?, hostname? }`; empty token keeps,
  `null` disables TLS, `{}` enables; audited), `RegenerateGatewayToken`
  (audited; affects new connections; live sessions keep their already-
  authenticated state — same as the in-app server today).
- **Protocol stays 1** — everything is additive.

## What shipped (2026-11-13)

- `crates/airi-channel`: `certs` module (rcgen local-CA + leaf minting,
  sidecar staleness detection, `0600` key storage), rustls accept loop
  (`wss://`), `utf-8`/idle semantics unchanged; `tlsConfig` round-trips in
  `ChannelConfig`.
- `crates/airi-daemon`: `gateway` module — config adoption, listener
  lifecycle, 15 s retry, D-Bus methods, audit of mutations, `--no-gateway`
  escape hatch.
- `packaging/systemd/airi-daemon.service`: `AF_INET`/`AF_INET6` allowed,
  `ReadWritePaths` += server-channel dir, `MemoryMax=256M`.
- Verification: Rust round-trip TLS test (mint → bind → upgrade → auth →
  `rpc runtime.ping` over `wss://`), D-Bus smoke against a `dbus-run-session`
  bus (Get/Apply/Regenerate/bad-payload), `openssl s_client` against the
  minted CA (`Verification: OK`), 82 + 70 unit/integration tests green.

## Transport alternatives (considered, parked)

**Unix Domain Sockets (Linux/macOS) / named pipes (Windows) for local clients.**
Real advantages: kernel-enforced peer identity (`SO_PEERCRED` / `getpeereid` /
pipe ACLs) instead of the shared auth token on disk, no port to contend for
(6121 contention vanishes), marginally lower latency.

Why it's not the data plane:

- **The largest current consumer can't use it.** The Electrobun/CEF renderer
  is a browser context: no raw sockets, no named pipes. A local-socket design
  either leaves the renderer on WS (the abstraction buys nothing) or adds a
  main-process WS↔socket proxy (strictly worse than loopback WS).
- **Remote/mobile clients can't use it at all.** The unified Rust native app
  (Android/iOS/desktop) and any LAN/VPN/tailnet client need a network
  transport; maintaining two data-plane transports (UDS + WS+TLS) means two
  implementations, two auth stories, two test matrices — and the browser
  path forces WS to exist anyway.
- **The kernel-auth benefit already exists for the control plane on Linux:**
  D-Bus/session-bus policy + bus-name ownership gives `org.moeru.airi.Daemon1`
  exactly what UDS 0600 grants, for exactly the privileged verbs that need
  it (config apply, token rotation, kill switch).
- Windows named pipes are first-class but not source-compatible with UDS
  code, and the daemon's data path is hand-rolled threads (no tokio in
  `airi-channel`), so "both" means platform `cfg` + duplicated accept loops.
- Performance is not a reason here: message rate is human-cadence, payloads
  are KBs. TCP loopback overhead is unmeasurable in this profile.

**gRPC.** Would buy protobuf schema evolution, deadlines, codegen, streaming,
health checks. Costs: browsers/CEF cannot speak native gRPC (grpc-web needs a
proxy hop — we have none), every TS/Python client gains a codegen step, the
existing eventa/plugin-protocol/JSON stack *and* the D2 Rust-canonical wire
types would be duplicated or thrown away, tonic/prost build weight lands in a
workspace with deliberately hand-rolled hot paths, and the message profile
(tiny, human-cadence) makes HTTP/2 multiplexing worthless. Already rejected
once in the library recon (no jsonrpsee/tarpc/tonic/socketioxide); unchanged.

**What we do instead (recorded):** control plane = D-Bus session bus on
Linux (kernel-authenticated, local-only privileged verbs; the renderer/native
apps re-back to it — increment 2). Data plane = WS everywhere, `wss://` with
the minted local CA for anything beyond loopback. Window/Unix paths: parked.

**A cheap future option, not taken now:** `airi-channel` already wraps every
connection in a `ConnectionStream` enum (plain or TLS) over the same
`Read`+`Write` handler. A `cfg(unix)` UnixListener variant for *native-only*
hot paths (e.g. if the daemon ever pipes high-rate mic/TTS audio) is a small
additive change — never for the webview or mobile. Revisit if profiling ever
says otherwise.

## Pending / known gaps

- **Increment 2 (app side):** implemented on `feat/unify-daemon-gateway`
  (2026-11-13): eventa re-backed to the D-Bus verbs via
  `busctl --user --json=short` (no new deps); the app binds 6121 only when
  the daemon does not answer on the session bus; the renderer derives
  `ws://` / `wss://` from the daemon-reported flag. Control-plane DTOs are
  exported to TS through the same specta pipeline (drift-checked in CI).
- Token rotation does not force-close live connections (matches the in-app
  server). If we want kill-on-rotate, the server needs tracked connection
  handles.
- Operator knob: `AIRI_DEVTOOLS_PEERS` (comma-separated peer names/ids) —
  allowlist for `route.bypass` devtools routing in `packages/server-runtime`;
  unset = no bypass. Implemented and unit-tested; otherwise undocumented.
- LAN clients need the CA (`websocket-ca-cert.pem`) installed/trusted —
  distribution is a UX step not yet designed (show path/fingerprint in
  settings UI?).
- `renderer.*` handlers: the daemon registers none; only the desktop app
  surfaces (Slint control socket) can carry them.
- Slint native app's WS client is not built yet — that's the other consumer
  of the Rust-canonical wire types (`crates/airi-channel/src/wire.rs`).
