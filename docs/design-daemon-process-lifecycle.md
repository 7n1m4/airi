<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Decision: process lifecycle, tray ownership, and the port 6121 owner

- **Status:** decided — policy only. No supervisor, launcher or tray implementation is
  authorized by this document.
- **Date:** 2026-11-21
- **Beads:** `airi-wxp.11` (this decision) · unblocks `airi-wxp.5` (E5 Process lifecycle and
  tray management) and `airi-wxp.5.1` (Supervisor topology + port 6121 owner)
- **Cross-links:** [`design-daemon-gateway.md`](./design-daemon-gateway.md) (WS :6121 topology,
  TLS policy, threat model) · [`design-daemon-client.md`](./design-daemon-client.md)
  (thin-client rule, decision 1) · [`design-flutter-godot-pivot.md`](./design-flutter-godot-pivot.md)
  (pivot decision 8 — "D-Bus stays for privileged verbs; tray/GUI drives Flutter/Godot
  process lifecycle") · [`analysis-slint-logic-inventory.md`](./analysis-slint-logic-inventory.md)
  row U7 (the Slint tray/hotkey/autostart bridge is client-local)

## The decision, in five lines

1. **`anima-daemon` exclusively owns port 6121.** It is the only process that binds it and
   the only process that ever will again. No client binds it — not as a fallback, not during
   startup, not while the daemon is down.
2. **`anima-daemon` is the only long-lived process.** It is user-session-scoped, D-Bus
   activatable, and survives the closing of every client.
3. **Every client is a thin WS client.** Flutter (control + chat), the Godot pet, and the Vue
   web/Electrobun surfaces hold view state only.
4. **A single tray process owns the tray and the GUI process lifecycle.** Its job is launching,
   focusing and stopping *client* processes — never core state, never a socket. That process is
   a **new, net-new supervisor/tray**, not the daemon and not one of the GUIs.
5. **When the daemon is absent, clients degrade.** They show "core offline" and retry with
   bounded backoff. They do **not** start a daemon, bind a port, or run an embedded core.

## 1. Port 6121 owner: the daemon, exclusively

Verified in tree today:

| Fact | Where |
|---|---|
| The daemon binds `<hostname>:<SERVER_CHANNEL_PORT or 6121>` | `crates/anima-daemon/src/gateway.rs:16-17`, `port_from_env()` at `:718`, `main.rs:242-244` |
| The daemon re-tries a failed bind every 15 s and reports `bound:false` + `lastError` | `gateway.rs:38-44`, `RETRY_INTERVAL` `:61`, `maybe_retry()` `:281-299` |
| The desktop app checks the bus *before* binding anything | `apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts:279-320` |
| The bus probe is `GetGatewayConfig` over `busctl --user --json=short` | `apps/stage-tamagotchi/src/main/services/airi/daemon-gateway.ts:67-108` |
| The probe is one-shot at app start; there is no re-check loop | `channel-server/index.ts:279` vs. `:425-434` (the 5 s health loop only runs in the in-app branch) |

The existing fallback — "the desktop app binds 6121 only when the daemon does not answer"
(`design-daemon-gateway.md:26-30`) — is a **migration bridge, now retired**:

- The condition it was written for is gone. The app it was protecting (`anima-slint`) is deleted
  big-bang (pivot decision 6) and `apps/stage-tamagotchi` loses its in-app channel server at its
  parity-gated retirement (pivot decision 5).
- As long as any client can bind 6121, there are two binders and the daemon's own retry loop
  (`gateway.rs:281-299`) is load-bearing. One binder deletes that whole failure mode.
- Same-uid is trusted (threat model, `design-daemon-gateway.md:53-84`), so no sandbox argument
  depends on the app holding the port.

**Single-binder rule.** Only `anima-daemon` binds 6121. A client that finds nothing listening
reports "core offline"; it never binds the port itself, and never spawns a daemon.

**Transition (E5).** Delete the in-app channel-server bind path from `stage-tamagotchi`, keeping
`getDaemonGatewayStatus` / `applyDaemonGatewayConfig` as the read/config path. `bound:false`
plus `lastError` stays a *status report*, never a license for a second binder.

## 2. Process lifecycle: one long-lived process, thin clients

| Process | Lifetime | Owns | May not |
|---|---|---|---|
| `anima-daemon` | user session; D-Bus activated, `Restart=on-failure`, `StartLimitBurst=5/60s` (`packaging/systemd/airi-daemon.service:16-26`) | port 6121, core state, settings, cards, memory, audit, realtime pipeline (pivot decision 7), event fan-out | require a client to be running; adopt a tray role |
| Supervisor / tray (net-new) | user session, started at login, outlives every client | the tray icon, the menu, the client process table | bind 6121; own core state; be a D-Bus data path (pivot decision 8) |
| Flutter control + chat | on demand, closeable | view state | write core state; block the pet |
| Godot pet | on demand, outlives Flutter | view state + renderer | write core state; depend on Flutter |
| Vue web / Electrobun desktop | on demand (Electrobun: live fallback until parity) | view state (plus, today, its own in-app server — deleted in E5) | write core state; bind 6121 |

This is pivot invariant 1 restated (`design-flutter-godot-pivot.md:132-135`), and
`design-daemon-client.md` decision 1 applied to the new clients. The Godot entry scene already
encodes the client half: "closing Flutter must not tear this process down"
(`godot/scripts/Main.cs`, class comment).

**Launch / stop / restart flow (target, E5):**

| Action | Path | Notes |
|---|---|---|
| Login | systemd user target → daemon (D-Bus) + supervisor (tray) | daemon may equally be D-Bus activated on first `GetGatewayConfig`; both are correct |
| Start pet | tray → `spawn godot` → Godot connects `ws://127.0.0.1:6121`, auths, `event.subscribe` | endpoint `godot/scripts/Net/DaemonClient.cs:58`, token read at `:105-108`, connect `:132`, disconnect `:275` |
| Start control surface | tray → `spawn flutter` → same gateway contract | endpoint defaults `apps/flutter/lib/connection/connection_settings.dart:21-24` |
| Stop client | tray menu (or window close) → process exits; daemon unaffected | Godot disconnects in `_ExitTree` (`godot/scripts/Main.cs:102-114`) |
| Restart client | tray → stop + start | bounded; a client crash is not a daemon event |
| Restart daemon | `systemctl --user restart anima-daemon`, or fix the bind error the daemon reports | the supervisor never restarts the daemon — see §2 |
| Stop everything | tray "Quit" → stops clients, then the tray process | the daemon may keep running (it is not GUI state) |

**The supervisor does not restart the daemon.** It can *report* that the daemon is unreachable,
because it has no privileged verb for it. `systemd` already owns daemon restart
(`Restart=on-failure`, bounded by `StartLimitBurst`/`StartLimitIntervalSec`, and the Slint-side
circuit breaker the unit comment refers to dies with Slint). Two restart authorities over one
process is one too many.

**The supervisor never starts the daemon on demand either.** D-Bus activation does that when a
control verb is first called; pre-starting from the tray would race that path for no gain. The one
exception is packaging: the tray item may carry "Start core" as a user-visible convenience that
shells out to `systemctl --user start anima-daemon` — still systemd's child, never the tray's.

**Only one instance.** The daemon owns `org.moeru.airi.Daemon1` and exits(1) when it cannot
(`main.rs:143-156`); systemd refuses a second unit with the same `BusName`
(`packaging/systemd/airi-daemon.service:2-8`); the D-Bus activation file points at the same
Exec. The supervisor therefore never guards "is the daemon already up" — asking for the name is
the guard.

## 3. Tray ownership: one tray item, owned by the supervisor

**Decision: a dedicated supervisor process owns the system tray.** Not the daemon, not Flutter,
not the Godot pet, not `stage-tamagotchi` after its retirement.

Why the daemon must not own the tray:

- The daemon is deliberately UI-free and target-shaped for headless/remote hosts: it is
  `ProtectSystem=strict`, `MemoryMax=256M`, `CPUQuota=25%`, and it may run under Termux or on a
  CI box with no session-bus tray host at all. Linking a StatusNotifierItem into it adds a GUI
  toolkit and a display dependency to the one process that must survive everything.
- Tray failure would then be daemon failure, or would need an awkward "tray is optional" branch in
  the daemon. Today that branch already exists on the client side
  (`crates/anima-slint/src/bridges/desktop.rs:120-146`: no `StatusNotifierWatcher` → no icon, app
  runs normally). That degradation belongs in a process whose job *is* the tray.
- The tray is a *client lifecycle* affordance (show settings, open chat, toggle pet, quit). It is
  control-plane-adjacent, and pivot decision 8 is explicit that this must not become a new
  privileged data path.

Why not a client-owned tray: only one process can own the tray item, so a client-owned tray means
"the tray dies when that client dies" — which is exactly the failure the pivot forbids (closing
Flutter must not stop the pet, and by symmetry closing Flutter must not remove the tray).

**Shape.** One tray process, one icon, menu = client lifecycle. Slint's tray
(`bridges/desktop.rs:225-233`: Toggle Chat / Toggle Stage / Awareness / Reset Positions / Settings /
About / Quit) is the closest existing prior art and is client-local (U7); the richest in-tree menu
(`apps/stage-tamagotchi/src/main/tray/index.ts:157-176`: Control Strip, chat, stage, customizer,
wizard, AnimaDex, settings, about, devtools, quit) is the reference menu, not code to port
wholesale. Platform notes carried forward: the Linux backend is Ayatana AppIndicator, where
primary-icon activation never fires (`docs/design-electrobun-port.md:52`), so every action must be
reachable from the menu.

**Compatibility during transition.** While `apps/stage-tamagotchi` is still the live fallback
(pivot decision 5), it keeps *its own* Electrobun tray
(`apps/stage-tamagotchi/src/main/tray/index.ts`) and the new supervisor stays dark — one icon per
session. At Electrobun retirement the Electrobun tray is deleted with the app and the supervisor's
tray becomes the only one. Two tray items must never be installed at once.

## 4. When the daemon does not answer

**Fallback rule: degrade to "core offline", never to "someone else's core".**

| Client | On connect/auth failure | On drop after connect | Never |
|---|---|---|---|
| Godot pet | log, keep the window alive, render idle | bounded reconnect, keep window | bind 6121, spawn a daemon, embed a core |
| Flutter control | show "core offline", offer retry | exponential backoff 1 s → 30 s, 5 attempts (`apps/flutter/lib/daemon_client/reconnect_policy.dart:7-10`) | bind 6121, embed `flutter_rust_bridge`, spawn a daemon |
| Vue web | show disconnected | re-resolve the URL and retry | bind 6121 (it never could) |
| Electrobun desktop | in-app server **deleted in E5**; before that, the retired fallback applies | same | bind 6121 |

The Flutter policy is the reference shape and stays as-is; Godot's client keeps its current "log
and keep the window alive" behaviour (`godot/scripts/Main.cs:60-65`) and grows the same bounded
policy rather than a different one. Neither is a reconnect *storm*: 5 attempts, then quiet.

**One daemon, and what "absent" means.** A client that cannot reach the session bus at all is in
the macOS/Windows/no-bus case; it behaves identically (offline, retry). Nothing about client
startup probes the daemon's *health* beyond "can I authenticate", and nothing about the daemon's
absence changes the daemon's own behaviour: `bound:false` + `lastError` remains visible over D-Bus
for whoever is holding the tray.

**Never fall back to an embedded core.** Pivot decision B rejected an embedded
`flutter_rust_bridge` core and a per-device mobile daemon; a desktop fallback that silently ran
`anima-core` in-process would reintroduce exactly the two-writers problem
`design-daemon-client.md` decision 1 forbids, and would make the SQLite store's ownership depend on
whether a socket answered.

## 5. Consequences and follow-ups (not authorized here)

- **E5 (`airi-wxp.5`)** builds the supervisor + tray: process table, launch/stop/restart of
  Flutter and Godot, tray menu, login autostart, and the single-icon handoff from Electrobun.
- **E5 also deletes** the in-app channel server from `stage-tamagotchi` (bind path, config
  minting, 5 s health loop) and keeps only the D-Bus read/apply path — the point at which
  `design-daemon-gateway.md:26-30`'s "single binder" note and its port-contention paragraph
  (`:38-44`) become historical and should be trimmed.
- **Retire** `crates/anima-slint/src/bridges/desktop.rs` (tray/hotkey/autostart/notification) with
  Slint (inventory row U7, pivot Wave 6). Its autostart logic (`:281-320`) is the reference for
  the supervisor's login entry, not a dependency.
- **D-Bus surface stays as-is.** No new lifecycle verbs: privileged verbs remain
  `GetGatewayConfig` / `ApplyGatewayConfig` / `RegenerateGatewayToken`
  (`crates/anima-daemon/src/control.rs:20-24`). Launch/stop is a process-table concern in the
  supervisor, not a bus concern.
- **LAN / wss / token trust is unchanged.** Port ownership does not alter the threat model:
  loopback `ws://` by default, forced `wss://` beyond loopback, first-message `authToken` gate,
  0600 config and CA key (`design-daemon-gateway.md:53-84`). The supervisor holds *no* token and
  mints *no* cert; it starts processes that read the daemon-owned
  `<data>/airi-slint/server-channel/config.json` themselves (`godot/scripts/Net/DaemonClient.cs:58,405-422`).
- **Open follow-ups for E5**, not decided here: supervisor implementation language (staying in the
  Rust workspace is the obvious default, but it is E5's call); whether the tray item also surfaces
  daemon bind status (`bound` / `lastError`); what "Quit" does to the daemon; whether the supervisor
  is itself a systemd unit (recommended — same login target, `Restart=on-failure`, no respawn logic
  of its own) or a plain autostart entry.
- **What E5 should not build:** a launch-on-demand supervisor that starts Flutter/Godot in
  reaction to files or cards. Clients are started from the tray, from a desktop entry, or by the
  user — never by the daemon, never by a watcher in the supervisor. The daemon has no opinion
  about which clients run.
- **Two small cleanups this doc makes explicit, neither in scope here:** the daemon's usage text
  omits `--no-gateway` (`crates/anima-daemon/src/main.rs:80-89`) — harmless, but it is a real
  escape hatch. And the pivot's two "tray/lifecycle ownership is OPEN" caveats
  (`design-flutter-godot-pivot.md:216-218` and `:418-419`) are answered here; E5 should update
  them when it lands rather than leaving a stale OPEN.