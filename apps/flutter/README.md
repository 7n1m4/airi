# Anima — Flutter control + chat surface

A **thin client** of `anima-daemon`. The daemon is the single owner of core state
(settings, chat sessions, cards, memory). This app holds view state only: it can
be closed without stopping the agent or the on-demand Godot pet window.

Authoritative design contract: [`docs/design-flutter-godot-pivot.md`](../../docs/design-flutter-godot-pivot.md)
(decisions 1, 3, 10 and invariants 1–3, 5) and
[`docs/design-daemon-client.md`](../../docs/design-daemon-client.md) (decision 1).

## What is in this scaffold

| Area | Files | Notes |
| --- | --- | --- |
| Entry + theme | `lib/main.dart`, `lib/app.dart`, `lib/theme/app_theme.dart` | Material 3 dark companion palette. **Design parity with Vue is deferred** (see below). |
| Navigation shell | `lib/navigation/navigation_shell.dart` | Control/Home, Chat, Settings, Connections, About — thin placeholders only. |
| Feature placeholders | `lib/features/**` | No business logic; settings/providers/memory/cards/sessions are future daemon RPC verbs. |
| Connection form | `lib/connection/connection_settings.dart`, `connection_settings_screen.dart` | Host/port/`ws`↔`wss`/token, validation, derived endpoint placeholder, fail-closed TLS note. |
| Daemon client | `lib/daemon_client/**` | Frame codec, transport abstraction, auth handshake, typed RPC, `core.status` probe, backoff, clear error states. |
| Tests | `test/**` | Pure Dart; in-memory fake transport, no live daemon and no socket. |

## How it talks to the daemon

Protocol is reused verbatim from `crates/anima-channel/src/wire.rs` — nothing new
is invented here:

- WebSocket path `/ws`, default port `6121` (env override on the daemon side).
- **First frame must be auth**: `{"type":"auth","authToken":"…"}` (or the mirror
  `{"type":"module:authenticate","data":{"token":"…"}}`). Bad token → close 1008.
- JSON text frames only, 1 MiB cap. Loopback plaintext `ws://`; non-loopback
  forced `wss://` with the locally minted CA.
- Built-in RPC actions: `runtime.ping`, `runtime.status`, `gateway.config`,
  `gateway.auth`; the daemon registers `core.status`. Replies carry `ok`,
  optional `data`/`error`, and echo the client-supplied `id`.
- Protocol identifier is the **literal carve-out `airi-channel/1`** — do not
  rename it to `anima-*` (wire version 1 stays additive).

`ConnectionSettings` mirrors the derivation rules of the Vue reference
`resolveWebSocketUrl` (`packages/stage-ui/src/stores/mods/api/channel-server.ts`)
and its settings form (`packages/stage-pages/src/pages/settings/system/ConnectionSettings.vue`):
an unset endpoint derives from the daemon-mirrored gateway keys (default
`ws://127.0.0.1:6121/ws`), and a non-loopback `ws://` is **fail-closed to
`wss://`** rather than sending the bearer token in cleartext.

### Transport seams

`DaemonTransport` (`lib/daemon_client/transport.dart`) is the only socket-facing
abstraction. `DirectWebSocketTransport` implements direct LAN/loopback WS today.
Per the resolved mobile decision (D10 / decision B, 2026-11-21), mobile is a
**remote client** over libp2p, Cloudflare Tunnel, or tunnel + libp2p — there is
**no `flutter_rust_bridge` embedded core and no local mobile daemon**. A daemon
hosted under Termux on Android is another acceptable endpoint for the same
interface. Those remote transports are TODO seams (`airi-wxp.3.5`), not
hard-wired; the UI stays thin in every topology for battery life.

## Toolchain prerequisites

- Flutter SDK with Dart `>=3.4.0` (use a stable channel).
- `flutter pub get` to fetch `web_socket_channel` and `flutter_lints`.

Then:

```sh
flutter analyze
flutter test
```

**Scaffold limitation:** neither `flutter` nor `dart` is installed in the
environment where this tree was created, so the project was authored as source
only. `flutter analyze`/`flutter test` were **not run**. Platform runner
directories and `pubspec.lock` are intentionally absent: generate them with the
SDK present, e.g.

```sh
flutter create --platforms=linux,macos,windows,android,ios .
flutter pub get
```

## Intentionally deferred (with reasons)

- **Event subscription + typed Dart event models.** Wave 0 is adding the
  server→client event lane and `event.subscribe`/`event.unsubscribe` to
  `crates/anima-channel`. No subscription RPC is sent here; received `event`
  frames are exposed as a generic envelope through the optional `onEvent` hook,
  and **no event payload shape is hand-written**. The binding strategy is still
  an open decision (`airi-wxp.10`; see `docs/decision-client-bindings.md`, which
  is *proposed*, not yet accepted) — whether this becomes generated bindings or
  hand-written models plus Rust golden conformance fixtures is deliberately not
  prejudged here.
- **Chat streaming.** Needs the Wave-0 `token.delta` lane; owning bead
  `airi-wxp.3.3`. The composer is visibly disabled.
- **Real control surfaces** (settings/providers/memory/cards/sessions):
  `airi-wxp.3.2`. They must be daemon RPC verbs, never a second Dart store writer.
- **Secure token storage.** Token is memory-only this session; Keychain/Keystore
  persistence and the LAN CA-trust UX are `airi-u71.6`.
- **Remote transports / pairing / trust**: `airi-wxp.3.5`, `airi-wxp.3.4`.
- **Packaging & signing**, **i18n/a11y parity with Vue**, **adaptive desktop
  NavigationRail**, and **precise visual parity** with `apps/stage-web` are later
  work (`airi-wxp.3.6`, `airi-wxp.3.7`).
- The Vue web app is kept as the full-UI **behaviour reference** only; do not
  fork its business logic into Dart to "catch up". Extend the daemon instead.
