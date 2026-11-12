<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P12 — System embedding research: daemonizing AIRI and deepening OS integration

Status: **research / decision substrate**. Nothing in this document authorizes a code change,
a package change, a push, or a release. Every recommendation is attached to a decision the
user gets to make (§I). Today is 2026-11-12. The live context: Qt rewrite in flight on
`wip/airi-qt-rewrite` (unpushed, 10+ WIP commits), v1 scope fully declared in
`p12-cutover-plan.md`, packaging is dev-grade (`packaging/build-deb.sh`), Electron par-lock
holds, and the user's framing is:

> "how to daemonize AIRI and deeply embed her into system so she has eyes on everything
> happening on dbus level and deeper" — on **this** machine, **this** user's session. Personal
> computing sovereignty, not surveillance of anyone else.

Follow-up decision from the project lead (2026-11-12): AIRI must have an **optional
"sudo mode" — a systemd system service running as root (or root-adjacent)** — as a distinct,
explicitly opt-in topology alongside (not replacing) the default posture. This document
designs that properly (§A, §D, §E, §F, §G, §I) instead of dismissing it.

Third rework, same day (2026-11-12), from the project lead: **eBPF is a first-class subsystem
of `airi-system`, explicitly opt-in, and the north star is "sci-fi-level AI companion managing
my OS" — attained strictly along the capability ladder in §D7, never below or above it.**
This document now treats eBPF as the deepest eye AIRI will ever have (§D6), the tech choices
for a Rust codebase (Aya vs libbpf-rs, §D6.4), the honest kernel floor (§D6.5), and the precise
meaning of "AIRI manages my OS" (§D7). Precision over awe; the ambition stays in.

Repo paths cited: `apps/airi-qt/` is the Qt rewrite workspace (`crates/…`, `qml/…`,
`packaging/…`, `docs/phase-notes/…`). `airi-channel` is the loopback WebSocket gateway
(port 6121) already reachable from the outside — AIRI already has a bus-of-sorts; the
design below should reuse its patterns, not duplicate them blindly.

---

## Executive summary

**Recommended path: (b) — a user-session daemon plus an optional, explicitly-enabled root-adjacent
helper (`airi-system`).** The default posture stays pure user-session; sudo mode is off until
the user flips it, with a dry-run preview, one `pkexec`, a persistent indicator, and a one-command
rollback. The Qt app remains the face and the consent surface; the daemon carries the eyes; the
helper carries only the capabilities the user explicitly traded for.

Key honest points up front:

1. **The user session is 90% of the value.** Lock/unlock, screen sleep, media state, network
   up/down, power state, idle time, screen contents (AT-SPI), ambient audio — none of it needs
   root. Session-bus observation is same-UID by default; the session bus on this workstation
   (Arch, systemd 262, `dbus-broker`/`dbus-daemon` 1.16.2) allows any same-UID client to match on
   and eavesdrop everything already (verified against `/usr/share/dbus-1/session.conf`). AIRI
   running as the user is not a privilege escalation; it is residency.
2. **Root buys little at the top of the ladder too.** The "managed OS" north star (project lead,
   2026-11-12: *"sci-fi-level AI companion managing my OS" when the user runs AIRI as systemd
   mode*) is a ladder — L1 system-bus reads → L2 per-action polkit prompts → L3 user-authored
   standing rules over `org.freedesktop.systemd1` + journald → L4 opt-in eBPF audit (§D7).
   L4 is real but it is the *ceiling*, attained only by explicit per-session arms with
   `auth_self`, and it adds no actions at all — eBPF is eyes, systemd is hands, polkit is the
   bouncer. Systemd unit *state* is readable without root; actions need polkit either way;
   root never buys past the ladder.
3. **(c) single root daemon is not worth it on any axis** over (b): it adds other-users' data to
   AIRI's trust domain for zero capability that (b) lacks. Kept in §A only as a comparison; we
   recommend against it plainly.
4. **The blast radius of (b) is bounded by design**: static system user, `CapabilityBoundingSet`
   = `CAP_BPF CAP_PERFMON` (never `CAP_SYS_ADMIN` — fanotify-perm stays a non-goal),
   `ProtectHome=inaccessible`, no network egress by construction
   (`RestrictAddressFamilies=AF_UNIX AF_NETLINK`), <1k LOC typed protocol, fail-closed.
   Egress belongs exclusively to the user-session main process. eBPF is designed here as the
   deepest, opt-in, never-default eye AIRI will ever have — a first-class subsystem of
   `airi-system` (§D6), reached only at rung L4 of the "managed OS" ladder (§D7).
5. **Multi-user machines are out of scope for sudo mode.** On a shared machine, machine-level
   events leak neighbors' presence (device hotplug timing, sleep cycles, unit failures). Sudo mode
   is for the single-user dev workstation / dedicated machine, and its consent text must say so.
6. No covert audio, no password reading, no monitor-mode by default, no reading of
   `org.freedesktop.secrets`, no other users' data, egress never ambient. Screen-lock disarms all
   observation (and tells the helper to quiesce). Details in §F/§G.

| Question | Answer |
|---|---|
| Daemon or not? | Yes — a `systemd --user` service (`Type=notify` or `dbus`), D-Bus-activated as `org.moeru.airi.Daemon1`. |
| Root or not? | Not by default. Sudo mode = opt-in root-*adjacent* helper, not a root rewrite. |
| Recommended posture | **(b) hybrid: user daemon + opt-in `airi-system` helper** |
| Single root daemon (c)? | Not recommended on any axis; see §A. |
| eBPF? | Opt-in, never default; first-class subsystem of `airi-system` (Aya, in-process, armed/detached on demand), rung L4 of the "managed OS" ladder — §D6/§D7. |
| Monitor/eavesdrop mode? | Off by default, interface-scoped match rules if ever enabled, memory-only, §B5. |
| First milestone | Phase 1 (§H): user daemon + session-bus observers + HITL action channel. No sudo mode in Phase 1. |

---

## A. Topology

### A.1 The four shapes, plus the third posture for sudo mode

| # | Shape | How it works | Pros | Cons | Verdict |
|---|---|---|---|---|---|
| 1 | **In-process (status quo)** | AIRI is a Qt desktop app; observation happens only while the app runs | Nothing new; no moving parts | Eyes close with the app; no ambient awareness; can't survive restarts of the UI; everything is on the GUI thread's fate | Keep as fallback only |
| 2 | **User-session daemon** | `systemd --user` service; Qt app is a client/HITL surface; daemon owns observers, owns `org.moeru.airi.Daemon1` on the session bus | Session-scoped consent boundary; same-UID rights (session bus already permits); crash isolation; D-Bus activation dedups; no root; per-user hardening trivial; pair with Qt app that degrades gracefully | No machine-level events needing privilege; still session-only | **Default posture** |
| 3 | **System service (root) for everything** | One root daemon owns observers for all users | Fewer processes | Other users' machine events in scope; `/home` reachable; every action still polkit-gated anyway; session context (active window, a11y) lost — must bridge back per-user; worst blast radius for zero gain over (b) | **NOT recommended.** Kept only for comparison in §A.4 |
| 4 | **Hybrid: user daemon + tiny privileged helper** | User daemon (2) does all session work; `airi-system` system service (root-adjacent, not full root) does a small, static list of machine-level jobs, reached over a system-bus D-Bus name or a socket, each call polkit-checked | Session stays sovereign; helper is small, auditable, fail-closed; sudo mode can be toggled without touching the user side; blast radius enumerated and capped | Two components; an install step (sysuser, polkit, unit); risk of "helper as second product" if not policed | **Recommended (with sudo mode explicitly opt-in)** |

Sudo mode decision from the project lead (2026-11-12): shape 4 ships as an approved-in-principle
option. Posture (a) remains the default; (b) is what "sudo mode" means in this document; (c) is
compared and rejected. See §A.4 for the three postures side by side.

### A.2 Option 2 in detail — the user-session daemon

**Unit shape.** `airi-daemon.service` (user), `Type=notify` (sd_notify READY + WATCHDOG) or
`Type=dbus` with `BusName=org.moeru.airi.Daemon1` (systemd starts it when the bus name is
requested — preferred: zero startup cost at login, auto-starts on first use, and D-Bus activation
already solves single-instance). D-Bus activation file in `$XDG_DATA_HOME/dbus-1/services/
org.moeru.airi.Daemon1.service` (per-user, no root needed) or `/usr/share/dbus-1/services/`
with the package. Standard session servicedirs are read by the reference bus (see
`dbus-daemon(1)`: `$XDG_DATA_HOME/dbus-1/services` and each `$XDG_DATA_DIRS/dbus-1/services`).

**What the daemon owns (user session):**
session-bus observers (§B), AT-SPI client (§C), portal/PipeWire screencast+audio (§B7/§C),
in-memory awareness ring buffer, local audit log, redactor, HITL permission channel to the Qt app
(ACP-style), tray-visible status. **Not** windowing itself — Qt draws the face.

**What stays in the Qt app:** rendering, chat, memory UI, settings/tray, HITL prompts, the ACP
permission UX precedent (`crates/airi-acp`, `p9-lane-acp-hitl.md`). The daemon is the *nerve
center*; the app is the *face and conscience*.

**Single instance.** One user daemon per (user, machine) — enforced three ways: systemd refuses
double-start of a `Type=dbus` unit with an owned BusName; the Qt app already has the
`airi-qt.lock` single-instance discipline (`README.md` "Single-instance lock", `/proc` probe);
D-Bus activation itself dedups concurrent first-requests (one activation, one instance).

**Restart policy.** `Restart=on-failure`, `RestartSec=2`, `StartLimitBurst=5` per
`StartLimitIntervalSec=60`; watchdog (`WatchdogSec=30`, `Type=notify`) catches hangs, not just
crashes. Crash-loop circuit breaker on the Qt side: after N daemon restarts within M minutes the
app stops reconnecting, shows "companion core offline — restart?" instead of hot-looping.

**Protocol versioning.** The daemon speaks a fixed well-known name `org.moeru.airi.Daemon1` and
interfaces `org.moeru.airi.Daemon1` (control) and `org.moeru.airi.Events1` (event fan-out). First
call `GetVersion() → (u32 protocol, s version, as features)`. Additive changes keep protocol=1;
a breaking change bumps the interface to `…Daemon2` (never mutate semantics under the same name).
Qt clients feature-detect via `org.freedesktop.DBus.Introspectable` rather than parsing version
strings. `airi-channel` (the loopback gateway) stays a *separate*, already-reviewed trust domain —
the daemon must not reuse its plaintext-token pattern for in-session IPC; use D-Bus sender checks
(`org.freedesktop.DBus.Peer.GetConnectionCredentials` / `GetConnectionUnixUser`) or the socket
`SO_PEERCRED` pattern if a socket is ever used.

**Qt app with daemon absent.** Everything the app does today keeps working: chat, memory, cards,
MCP, ACP, tray, hotkeys, screen capture (X11). Awareness features show an empty state +
"start the companion core" action (`systemctl --user start airi-daemon` behind a button, or D-Bus
activation — first call auto-starts it). Tray shows a subtle "core offline" glyph after a
grace-period of failed pings; it never pops a modal on startup.

**Daemon with no session / headless boot.** With `loginctl enable-linger` *off* (default), the
user service starts at first login and stops at last logout — correct for a session companion.
If the user turns linger on (not recommended), the daemon starts at boot, finds no session bus
peers and no compositor, and **stays inert**: all session eyes gate on session availability
(`DBUS_SESSION_BUS_ADDRESS` present, `org.freedesktop.portal.Desktop` owner present, screensaver
name present). Linger is a download of duty, not of eyes; document it as such.

**Headless/edge boots**: no `graphical-session.target`, daemon idles, logs one line, `Type=notify`
still READY (a running-but-inert daemon is fine); observers arm lazily on first session signal.

**Restart-storm mitigation:** systemd limits (above), Qt circuit breaker (above), and a hard rule:
the daemon never exits non-zero for *observed* errors — awareness failures degrade to "source
offline" entries, not crashes.

### A.3 Option 3 (for the record): full system service

What it would even mean: `airi.service` as root, bridging to each logged-in user's session
(a11y trees are per-session and only reachable from inside that session). You would end up
implementing option 4 badly: per-user bridges, polkit for every actuation anyway, and AIRI's
trust domain becomes "root + every user's session". Any capability it has, (b) has. The only
axis it wins is "one process to audit", and the honest way to get that is making the user daemon
small, not making everything root. **Reject (c) for v1; revisit only if multi-machine/cluster
direction emerges, which is a different product.**

### A.4 The three postures for sudo mode, side by side

| Axis | (a) Pure `--user` daemon (default) | (b) Hybrid: user daemon + opt-in `airi-system` helper | (c) Single root daemon |
|---|---|---|---|
| Eyes (session) | all | all | all (via per-user bridges) |
| Machine eyes (uevent, RAPL, eBPF tracepoints, unit state actuation) | — | **opt-in** | all (forced) |
| Other users' machine events | no | **yes (disclosed; single-user target)** | yes |
| Other users' session content | no | no (helper never touches session bus) | no (still impossible without bridging into their session) |
| Fuel for a compromise | user session | user session + helper caps (BPF/PERFMON, sysfs reads, uevent stream) | everything on the machine, /home, shadow, keys |
| Extra install complexity | none | sysuser + unit + socket/D-Bus + polkit `.policy` | sysuser + per-user bridge protocol |
| Consent story | standard app | explicit checkbox + dry-run + pkexec + indicator + one-command rollback | cannot be made honest on shared machines |
| Winner? | default | **recommended for those who want machine-level depth** | never |

**North star (project lead, 2026-11-12): "sci-fi-level AI companion managing my OS" — attained
only when the user runs AIRI as systemd mode (sudo mode, §E4).** The "managed OS" is precisely
the capability ladder in §D7: L1 (system-bus reads, most users) → L2 (polkit-prompted actions,
recommended ceiling for v1) → L3 (user-written, pre-authorized standing rules over
`org.freedesktop.systemd1` + journald — where the sci-fi feel actually lives, because it is
deterministic policy the user authored, not a runaway AI) → L4 (the opt-in eBPF audit stream,
§D6). Every rung is more than the last, each is individually opt-in, and none of it makes AIRI
PID 1, a kernel module, a bootloader editor, or an unsupervised updater. "Managed OS" is a ladder
rung you climb deliberately, not a switch you flip.

If (b) is ever judged "not worth the install step", that is a fine outcome — (a) alone is a
coherent product. The report's recommendation stands with (a) as the default and (b) as the
explicit opt-in; (c) has no win.

### A.5 Failure-mode matrix (both daemons)

| Failure | User daemon behavior | Qt app behavior | `airi-system` helper behavior |
|---|---|---|---|
| User daemon killed | systemd restarts (bounded) | "core offline" tray glyph; awareness pages show last-known + "reconnect" | unaffected |
| Crash loop | StartLimit stops restarts | circuit breaker banner; suggests `systemctl --user reset-failed` | unaffected |
| User locks screen | daemon disarms session observers; purges awareness ring buffer; audits "lockdown" | tray shows locked state | helper quiesces actuation/observation (notified over IPC by owner) |
| No network | network eyes report down; nothing else changes | banner "offline" already exists | unaffected |
| Helper absent | user daemon reports sudo-mode sources "not enabled" | Sudo-mode card shows Enable (no error) | n/a |
| Helper crashes | helper restarts (bounded); user daemon surfaces "helper unreachable — is sudo mode enabled?" once | same, once | journal + bounded restart |
| Helper protocol mismatch | `GetVersion` fails → helper treated as absent (fail-closed) | prompt to upgrade | refuses to act below its protocol minimum |
| Helper compromise | — | — | **§G.5**: no home access, no secrets, no network, minimal caps, <1k LOC, fail-closed |

---

## B. D-Bus deep dive

URLs in this section: [`dbus-daemon(1)`](https://dbus.freedesktop.org/doc/dbus-daemon.1.html),
[D-Bus spec 0.43 (2024-10-29)](https://dbus.freedesktop.org/doc/dbus-specification.html),
[`org.freedesktop.login1(5)`](https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.login1.html),
[dbus git](https://gitlab.freedesktop.org/dbus/dbus).

### B1. Session bus vs system bus — for a companion

| | Session bus | System bus |
|---|---|---|
| Default policy (reference bus) | `allow send_destination="*" eavesdrop="true"`, `allow receive eavesdrop`, `allow own="*"` (verified, `/usr/share/dbus-1/session.conf`); `dbus-broker` follows the same file | Default-**deny** for own and most send; allow receive (signals) + requested replies; services ship their own `system.d/*.conf` policies |
| Who can talk | Same UID only (socket owned by user; `unix:tmpdir` listener) | Any local UID, gated per destination name by each service's shipped policy + polkit for actions |
| What AIRI gets for free | Everything in §B2 session rows: MPRIS, screensaver, portals, a11y broker, notifier role | Read-only: login1 state/signals, UPower, NM state, BlueZ list (each service's policy allows reads) |
| What AIRI must not touch | — | `org.freedesktop.UDisks2` actions, `systemd1` unit actuation beyond interactive polkit, NM modify — all need polkit; never pre-granted |
| AIRI's own name | `org.moeru.airi.Daemon1` (+ `.Events1`) | (only if sudo mode: `org.moeru.airi.System1`) |
| Watch out | Anything sent to the session bus is already visible to any same-UID process; **AIRI must treat all bus input as untrusted** (spoofed signals exist) | Monitor mode (`BecomeMonitor`) needs privilege; eavesdropping denied by default for good reason |

**Verdict up front:** session bus is the home bus; system bus is a reading room with a polkit
bouncer. The helper (if sudo mode) is the only component that speaks on the system bus; the user
daemon may also *read* login1/UPower/NM directly without any helper — those reads need no
privilege. The helper exists for the things users cannot read (RAPL is sysfs-root; eBPF needs
caps) or that should not be automated (actuation), not for ordinary reads.

### B2. Standard interfaces/signals worth having as "eyes"

Legend: Tier = consent tier (§F). "Content" = whether payloads can include user data.

| Interface / name | Bus | What AIRI gets | Tier | Content? | Notes / honest limits |
|---|---|---|---|---|---|
| `org.freedesktop.login1` Manager signals `PrepareForSleep(b)`, `PrepareForShutdown(b)`, `PrepareForShutdownWithMetadata` | system | Sleep/wake/shutdown lifecycle — perfect "eyes closing" hooks; also the *wake* trigger for morning briefings | T0 | no | Read by anyone; signals are broadcasts |
| `…login1.Session` `Lock()`/`Unlock()` signals, props `LockedHint`, `IdleHint`, `IdleSinceHint`, `Active`, seats/users objects | system | **Screen lock/unlock = master disarm trigger**; also "user present?" | T0 | no | The own-session Session object is readable; `LockedHint` is how the session says "locked". Prefer this over DE-specific screensaver names |
| `org.freedesktop.ScreenSaver` (Xfce etc.) / `org.gnome.ScreenSaver` / `org.kde.ScreenSaver`: `ActiveChanged(b)` | session | DE fallback for lock detection (defense in depth with login1) | T0 | no | Version-dependent property/signal names across DEs; treat login1 as primary |
| `org.mpris.MediaPlayer2.<player>` (MPRIS) — props `PlaybackStatus`, `Metadata`, `CanPause…`; signals `PropertiesChanged` | session | What's playing/paused/track | T0 (state) / T1 (metadata) | yes (track/artist/title) | Names are per-player well-known names; watch name owner for vanish |
| `org.freedesktop.DBus.Properties` `PropertiesChanged` generic | either | One match rule for *all* property changes; filter by `arg0` (the interface string) | — | n/a | The workhorse; see §B3 |
| `org.freedesktop.Notifications` | session | **No "notification posted" signal exists.** Only `NotificationClosed`, `ActionInvoked` | T2 (observe) / T2 (send) | n/a | AIRI cannot passively hear other apps' notifications without monitor mode; she *can* send her own; she can be the notifying app |
| `org.freedesktop.UPower` (`.Device`) — `OnBattery`, props, `DeviceAdded/Changed/Removed` | system | Power state, battery %, on-AC — drives "low power — go quiet" behavior | T0 | no | Read needs no auth |
| `org.freedesktop.NetworkManager` — `State`, `StateChanged(u)`, `Connectivity` | system | Up/down/portal'd/offline | T0 | no | Actions (connect/switch) are T2 + polkit, never silent; NM ships its own `system.d` policy allowing reads |
| `org.bluez` — `org.freedesktop.DBus.ObjectManager`, `InterfacesAdded/Removed`, device props | system | Paired/connected devices (phone in range) | T0/T1 | **yes — presence inference** | Presence of a phone ≈ presence of its owner; consent-visible, toggleable, T1 |
| `org.freedesktop.portal.Desktop` proxies: `org.freedesktop.portal.Screenshot`, `…ScreenCast`, `…GlobalShortcuts`, `…Inhibit`, `…NetworkMonitor`, `…PowerProfileMonitor`, `…Background`, `…Settings` | session (system-mediated) | Consent-mediated capture/screencast, hotkeys on Wayland, idle-inhibit, own-autostart | T2/T3 per API | yes (capture) | Portal = user-gesture consent dialogs; see §B7. Docs: [xdg-desktop-portal](https://flatpak.github.io/xdg-desktop-portal/docs/) |
| `org.freedesktop.FileManager1` | session | Expose AIRI as a handler ("open with AIRI") — **no "user opened file manager" event exists** | T2 | no | Adaptation, not observation — §B4 |
| `org.freedesktop.secrets` | session | **NEVER READ.** May *store* AIRI's own tokens (libsecret) with user consent | T2 (store own) / forbidden | secrets | The Secret Service ACL still prompts; AIRI never asks for other apps' collections |
| `org.a11y.Bus` (session) → a11y bus: `org.a11y.atspi.*` | session | On-screen text/roles/states tree — "what's on screen" without pixels | T1/T2 (opt-in) | **yes** | §C. Legitimate: the screen-reader channel |
| `org.kde.KWin` (scripting) / `org.gnome.Shell.Eval` | session | Window management scripting | — | yes | Fragile, version-locked, sandbox-limited (GNOME restricts Eval); **NOT recommended** as a foundation; noted for completeness |
| `org.freedesktop.systemd1` (system) — `ListUnits`, `GetUnit`, signals `UnitNew/Removed` | system | Unit state awareness (backup running, docker dirty) | T0 | no (unit names) | Read-only allowed; actuation is T2 + polkit `org.freedesktop.systemd1.manage-units`, always interactive; never granted statically to AIRI |
| `org.freedesktop.timedate1` | system | NTP sync status, timezone | T0 | no | Read-only; actions (set timezone) non-goal |

### B3. `PropertiesChanged` — the subclassing cheat code

Almost everything above is an `org.freedesktop.DBus.Properties` citizen. The pattern:

```
AddMatch("type='signal',interface='org.freedesktop.DBus.Properties',"
         "arg0='org.mpris.MediaPlayer2.Player'")
```

`arg0` is the interface name string of the changed property bag — so one rule per interface you
care about; avoid the unfiltered global rule (you will drown in `com.*.*.Changed` noise and
your own CPU will melt before any policy does). `EmitsChangedSignal` introspection annotations
(`const` / `true` / `false`) tell you whether subscribing is worthwhile. Debounce: deliver at
most one "changed" per (object, interface) per 250 ms into the awareness ring. Log drops, never
silently lose: the audit log gets a `source: rate-limited` counter row.

Match rules are cheap-ish; eavesdropping on **unicast** traffic is another matter — see B5.

### B4. Names AIRI could own — bus citizenship, not just observation

Owning names is how AIRI adapts *into* the desktop instead of watching it from the shrubbery:

| Name | Path | Interfaces | Purpose |
|---|---|---|---|
| `org.moeru.airi.Daemon1` | `/org/moeru/airi/Daemon1` | `org.moeru.airi.Daemon1` (control: `GetVersion`, `GetStatus`, `ArmSource`, `DisarmAll`, `GetAuditTail`) | Well-known entry; D-Bus-activatable |
| `org.moeru.airi.Events1` | `/org/moeru/airi/Events1` | `org.moeru.airi.Events1` (signals: `AwarenessChanged(s what, as props)`, `Lockdown()`, `ActionNeeded(s request_id)`) | Subscribe-what-you-want stream for other apps and for the Qt app |
| `org.moeru.airi.Notify1` (optional) | `/…/Notify1` | `org.freedesktop.Notifications` subset | If AIRI ever *becomes* a notification source — decline for v1 |
| `org.moeru.airi.Open1` | — | via `org.freedesktop.FileManager1` | AIRI as a file-open handler |
| (sudo mode) `org.moeru.airi.System1` | `/org/moeru/airi/System1` | `org.moeru.airi.System1` (`GetVersion`, `SubscribeSystem(as kinds)`, `Invoke(s action, a{sv} args)` → polkit-checked) | system-bus half of the helper |

Also: expose `org.moeru.airi.Mcp1` later as a D-Bus-native MCP-ish bridge so MCP clients can ask
AIRI without the WebSocket. Not v1. And reuse `airi-channel` precedent for external reach (6121,
loopback-only, token in config, auto-heal) — but inside the session use D-Bus sender credentials,
never a bearer token in a world-readable file.

### B5. MONITOR MODE — full-traffic observation

Mechanics ([spec §Monitoring](https://dbus.freedesktop.org/doc/dbus-specification.html#message-bus-monitoring-interface)):
`org.freedesktop.DBus.Monitoring.BecomeMonitor(as rules, u flags)` on `/org/freedesktop/DBus`.
The connection becomes a *monitor*: it loses all bus names, may not send messages, receives
messages matching `rules` **as if every rule contained `eavesdrop='true'`**, and an **empty rule
list means everything**. Introduced in spec 0.26 / dbus 1.9.10; `eavesdrop` match deprecated in
its favor. Match rules: `type`, `sender`, `interface`, `member`, `path`, `argN`, `argNpath` —
you can scope to *one interface* (e.g. `type='method_call',interface='org.freedesktop.Notifications'`).

**What user-level policy overrides allow.** On the reference bus, the well-known session bus has
*no* per-user policy directory upstream — `<includedir>session.d</includedir>` inside
`/usr/share/dbus-1/session.conf` is relative to `/usr/share/dbus-1/` (root-owned) and
`/etc/dbus-1/session.d` is root-owned. So a user **cannot** grant themselves monitor rights by
dropping a file in `~/.config/dbus-1/session.d/` — that path is not read by the well-known bus.
What the session bus grants implicitly: any same-UID client may `AddMatch` (incl. `eavesdrop`)
and may `BecomeMonitor` — verification on this workstation: `session.conf` ships
`<allow send_destination="*" eavesdrop="true"/>` and `<allow eavesdrop="true"/>`, i.e. **the same
intruder-or-app you are is already ahead of AIRI**. Monitor mode adds *convenience and coverage*
(replies/unicasts), not new power, on a same-UID session bus.

**What requires root:** the system bus. `BecomeMonitor` there is limited to privileged users
(root in practice) — it does not relax system-bus ACL rules the old eavesdrop did (deliberate
spec design: monitoring the system bus does not change delivery). Policy on the system bus is
*additive* per service: `system.d/*.conf` allow what each service needs; local overrides belong
in `/etc/dbus-1/system.d/*.conf` (root), never in the package.

**Blast radius.** Full monitor = every payload on the bus: OAuth tokens in transit to local
proxies, mailed content, clipboard sync traffic, password-manager bridge chatter — everything
encrypted never appears (TLS payloads stay TLS), but *everything plain within the bus* does.
For AIRI: this is a loaded gun pointed inward, at her own user's apps. Rules for ever enabling it:

- opt-in, off by default, separate checkbox from every other awareness source;
- interface-scoped rule list (never empty); never capture `org.freedesktop.secrets*` or `com.
  redhat.*`-style credential paths without the user listing them by name;
- **memory-only**, 5-minute ring, purged on lock and on kill switch; never journaled, never
  persisted, never sent to any model endpoint;
- a redaction pass (regex for `sk-…`, `ghp_…`, `Bearer …`, `password=…`, JWT-ish blobs) before
  anything derived from it leaves memory — derived *summaries* may persist under T1, raw never;
- the settings page shows which interfaces are being monitored and a live "bytes seen / bytes
  dropped" counter.

**dbus-monitor CLI reality check:** `dbus-monitor --session` works unprivileged today — so
"monitor-mode is off" is only meaningful as AIRI-policy, not as a kernel boundary. Say that out
loud in the UI copy.

### B6. Policy XML — correct shape

The DOCTYPE and skeleton (from `dbus-daemon(1)`; both `dbus-daemon` and `dbus-broker` accept it):

```xml
<!DOCTYPE busconfig PUBLIC
 "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <policy user="airi-system">
    <allow own="org.moeru.airi.System1"/>
  </policy>
  <policy context="default">
    <allow send_destination="org.moeru.airi.System1"/>
  </policy>
</busconfig>
```

Useful attributes: `own="name"` / `own_prefix="org.moeru.airi"` (prefix owns the whole tree),
`send_destination=`, `send_interface=`, `send_member=`, `send_path=`, `send_type=`,
`send_broadcast=`, `receive_sender=`, `eavesdrop=` (only meaningful with send_/receive_),
`min_fds`/`max_fds`. Semantics that bite people:

- Rules are applied in order; **last match wins**; `context="mandatory"` overrides everything later? No — *applied last, wins* over `default`/`user`/`group`.
- `<deny send_interface="org.foo.Bar"/>` alone blocks **no-interface** messages too — always pair with `send_destination=` (`<deny send_interface="…" send_destination="org.foo.Service"/>`).
- `own="*"` grants claiming any name — never do this outside the session default.
- Session default is allow-all; **policy files shipped by a package must narrow, never widen**.
  AIRI's package ships *no* session-bus policy at all (none needed); it ships only the helper's
  system-bus policy (`system.d/org.moeru.airi.System1.conf`) and the helper's polkit file.

If AIRI ever needs to *receive* a system-bus signal other services don't broadcast widely (e.g.
specific NM signal), verify the service's policy already permits receive; otherwise the choice is:
ask upstream, or don't have that eye. Never ship a policy that opens the system bus broadly.

### B7. Wayland/portals vs X11 vs headless

| Capture/input path | X11 | Wayland | Headless (cage/headless wlroots, no session) |
|---|---|---|---|
| Full screen | Any client can `XGetImage` — **permissionless**; repo's `capture_item.cpp` uses this | Compositor denies; must go through portal `org.freedesktop.portal.ScreenCast` (PipeWire stream; user picks screen; persistent if consented) or one-shot `Screenshot` | Portal likely absent; degrade: no capture |
| Global hotkeys | X11 grabs (repo: `x11rb` ScrollLock, Wayland grabs apply to XWayland only) | `org.freedesktop.portal.GlobalShortcuts` (support varies by backend: KDE/Hyprland strong, GNOME maturing) | none |
| Idle inhibit | XScreenSaver | `org.freedesktop.portal.Inhibit` | none |
| Clipboard | X selection (unprivileged read) | Portals/compositor-gated; expect friction | none |
| a11y | AT-SPI over a11y bus (toolkit-level, display-server-agnostic) | same — AT-SPI works on Wayland | absent tree |
| Audio | PipeWire/Pulse — user session | same | muted until PipeWire runs |

X11 being permissionless cuts both ways: on X11, **any** same-UID process (including a compromised
plugin) can already grab the screen and sniff keys at the X level — AIRI is not the weak link
there, she is merely also honest about it. The repo already documents `QScreen::grabWindow(0)`
failing on this Wayland machine (p9-lane-screen-capture.md) — Phase 3 is where that migrates to
the portal path (both for X11-era parity and Wayland correctness), with the capture permission UX
the user already consents through. X11-vs-Wayland is a *supported-target* decision (§I), not a
blocker for the daemon plan.

### B8. System bus: what users can already read vs what needs the helper/root

| System-bus fact | Needs helper? |
|---|---|
| login1 session/seat/user state, `PrepareForSleep/Shutdown`, Lock/Unlock signals, IdleHint | No — any UID |
| UPower OnBattery/devices, `DeviceAdded/Changed/Removed` | No |
| NM `State`, connectivity, device types (not wifi passwords) | No |
| BlueZ object list, device names/RSSI, paired state | No |
| systemd1 unit list/state, signals | No (read); **actuation** = polkit per call |
| timedate1 NTP status | No (read) |
| **Any system-bus *method*** (reboot, suspend, rfkill, mount, unit start…) | polkit per call; helper must not alias them |
| **RAPL energy counters** (sysfs `energy_uj`) | Yes — root-only since PLATYPUS mitigations |
| **eBPF anything** | Yes — `CAP_BPF`+`CAP_PERFMON` |
| **fanotify permission events** | `CAP_SYS_ADMIN` — **non-goal** |

---

## C. "Eyes" beyond D-Bus — AT-SPI2

AT-SPI2 is the same channel screen readers use. On Linux it is a separate bus: the session bus
carries `org.a11y.Bus` (the launcher/broker), and the actual tree traffic happens on the
*accessibility bus* whose address you fetch via `GetAddress` (or `AT_SPI_BUS_ADDRESS`); check
`org.a11y.Status.IsEnabled` on the session bus (GNOME settings daemon owns it) to learn whether
applications build their trees. References:
[at-spi2-core](https://gitlab.gnome.org/GNOME/at-spi2-core) (read-only mirror on GitHub),
[libatspi docs](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi),
[spec XMLs in-tree](https://gitlab.gnome.org/GNOME/at-spi2-core/-/tree/main/xml).

**What it exposes.** An accessible tree per application: objects with role (`label`, `entry`,
`push button`, `password text`, `table`, `text`…), states (`focused`, `showing`, `enabled`),
name/description, relations (labelled-by), actions (`Press`), and the `Text` interface for text
content plus the `Component` interface for geometry. Events stream on the a11y bus: focus
changed, window activated, object state/property changed, announce.

**Toolkit coverage (out of the box).** GTK (atk-adaptor, always), Qt (a11y bridge, builds the
tree when IsEnabled; KDE/GNOME both), Firefox (with a11y enabled — auto-enabled by IsEnabled),
Chromium/Electron (enable a11y via `--force-renderer-accessibility` or on demand; coverage decent,
not universal), Java (java-atk-wrapper — often *off* by default, call it best-effort), Flutter
(partial), terminal emulators (via their toolkits; text readable when a11y tree exists — many
terminals, e.g. Konsole/VTE, expose text). "What's on screen" via AT-SPI is therefore *mostly*
available, not always — honest gap to document per app.

**Consent/permission shape.** Same-UID processes can read the a11y tree; there is no per-app
prompt anywhere in the Linux stack. Enabling IsEnabled for AIRI enables it for every same-UID
process (it is one bit). So: AT-SPI is a **user-session opt-in** (T2-style "I want her to see
my screen"), never a hidden default, and never represented as a sandbox boundary. That is the
*legitimate* "screen reading" path precisely because it is inspectable by the same terminal that
runs the screen reader — and because it sees **UI semantics**, not keystrokes.

**What it cannot do:** read raw keystrokes, read other users' trees (it's a per-session bus),
see pixels, see TLS plaintext, see kernel state. **What it CAN do badly:** if an application
mislabels a password entry as ordinary `entry`/`text` (custom-drawn web apps, some Electron
cases), its plaintext may be readable. Mitigation rails (mandatory):

1. Skip subtrees with any accessible object of role `password text` / state `protected` (ATK
   exposes protected content semantics; libatspi role name is `password text`).
2. Heuristic exclusion on object name/description matching `password|passphrase|secret|token|
   api[-_]?key|pin` — belt on top of braces.
3. Never persist raw a11y strings; the summarizer works on the changed-focused subtree only and
   passes everything through the credential redactor (§F) before any persistence or model call.
4. Password-manager apps (KeePassXC etc.): add explicit denylist of app names/window titles
   (`keepass`, `1password`, `bitwarden`, `secret-service`) — configurable, default on.

**Performance.** Full-tree walks are O(n) D-Bus calls — hundreds to thousands of round trips.
Never poll the tree. Architecture: event-driven (subscribe to focus/window/state-change) +
lazy subtree walk on event + 250 ms debounce + hard cap (e.g. 500 objects / 32 KB text per
summary). Continuous "what is she looking at" polling is a laptop-melter and a privacy irritant;
don't. Expect ~5–50 ms per focused-widget burst; schedule on the daemon, off the GUI thread.

**Value over screenshots.** "Which app, which window, which document title, which text field,
roughly what's on screen — without pixels and without an image leaving the machine." Complement
to (not replacement for) captures; lands in Phase 2.

---

## D. Kernel and below — capability matrix (sudo-mode split)

Tier = consent tier (§F). "User can" = runs as ordinary session process, no caps. "Helper" =
`airi-system` (§E2) with its minimal bounding set. Non-goal = never, regardless of root.
Subsections: **D6** = eBPF as a first-class opt-in subsystem; **D7** = the "managed OS"
capability ladder (L1–L4).

| Mechanism | User session (no root) | With `airi-system` helper | Verdict / notes |
|---|---|---|---|
| Session D-Bus/a11y/PipeWire — everything in B/C | ✅ | n/a — helper must NOT touch the session bus or audio | Stays in user daemon, always |
| `/proc`, `/sys` read-only (procs, load, `power_supply`, `thermal_zone*`) | ✅ world-readable (environ is same-UID/root only; `hidepid` tightens) | marginal extra: RAPL only | User-side covers ~90%; helper adds RAPL (see below) |
| RAPL energy counters `/sys/class/powercap/*/energy_uj` | ❌ root-only (PLATYPUS, kernel ≥5.10) | possible with `CAP_DAC_READ_SEARCH` or root | Optional telemetry eye; user-typed opt-in; **not** in v1 helper; polkit-gated, values aggregated only (no per-app breakdown beyond S0/psys), else non-goal |
| netlink `NETLINK_KOBJECT_UEVENT` (device add/remove) | ✅ on stock kernels (verified: `udevadm monitor --kernel` prints `add` events as uid 1000) | unnecessary | USB/ACPI hotplug awareness for the *machine*; metadata only (subsystem, devpath, action) — T0/T1. Helper not needed |
| `inotify` (own dirs: Downloads, sync folder) | ✅ (watches limited by `fs.max_user_watches`; non-recursive — walk roots, not trees) | n/a | Great for "you saved a file" flows; T1 |
| `fanotify` `FAN_CLASS_NOTIF` watch-only | ❌ `CAP_SYS_ADMIN` | would need `CAP_SYS_ADMIN` | **non-goal** — subtree-wide fs watching is anti-goal for a companion; inotify covers it |
| `fanotify` `FAN_CLASS_PRE_CONTENT`/permission events (`FAN_OPEN_PERM`…) | ❌ | would need `CAP_SYS_ADMIN` | **hard non-goal** — a companion must never veto or gate file access; not in any phase |
| eBPF (all streams — see §D6) | ❌ `kernel.unprivileged_bpf_disabled=2` here (2 = cannot re-enable until reboot); needs `CAP_BPF`+`CAP_PERFMON` (≥5.8) | ✅ first-class subsystem (§D6), opt-in per stream, detached on lock | Never armed by default, never at L1/L2/L3; L4 only; tracepoints only; fixed record formats (no struct-offset guessing); redacted; memory-only rings |
| eBPF uprobes (libc/libssl…) | ❌ | technically | **non-goal** — memory-harvest grade capability; not shipping |
| evdev / joydev (`/dev/input/event*`) | ❌ (group `input` or root) | could be | **HARD NON-GOAL, forever** — this is a keylogger with extra steps; not even in experimental L4 |
| libinput debug (`libinput-debug-events`) | ❌ (device access) | could be | same verdict; non-goal |
| PipeWire screen/audio via portals | ✅ (portal consent) | ❌ never | audio helper would bypass session indicators — never |
| `dmesg` | ❌ (`dmesg_restrict=1` here) | root could | **non-goal** — kernel logs can carry secrets/KASLR; never |
| systemd system-bus *reads* (systemd1, timedate1, NM state, UPower, logind, BlueZ) | ✅ | n/a | §B8 |
| systemd system-bus *writes* (start/stop unit) | ❌ polkit per call | per-call polkit, never ambient | helper must not be a polkit bypass; only interactively-authorized invocations; v1: none |
| NM profile switching / rfkill / connectivity actions | ❌ polkit per call | polkit per call only | **not in helper v1**; revisit behind dedicated actions (`org.moeru.airi.system.nm_modify`) with `auth_self` prompt each time; T2/T3; likely never |
| chrony/NTP status, unit state, LVM/UDisks events | ✅ read | n/a (read) | read-only surfaces, T0 |
| udev *rules* / hwdb writes | ❌ root | could be | **non-goal** — helper never writes system configuration, ever |
| `/etc` writes, package management, service edits | ❌ root | could be | **non-goal** |
| Thermal/zone fan policy | ❌ | could be | **non-goal** |
| X11 screen grab | ✅ (permissionless) | n/a | user-side (§B7); portal preferred |

**Design consequence — the helper is not "root with extra steps", it is a small capability
bundle:** `CAP_BPF` + `CAP_PERFMON` (optional, only when L4 is armed; §D6.5), a read handle on
`/sys/class/powercap` (optional, off by default), and socket/D-Bus activation gated by group
membership, an owner-uid check, and polkit for actuation. It is *never* `CAP_SYS_ADMIN` — not
"permitted but unused", absent from the bounding set entirely (§D6.5). See §E2 for the unit.

**What deliberately stays even WITH sudo mode:** everything session — AT-SPI, notifications,
media, clipboard, PipeWire, windows, X11/portal capture, tray, hotkeys. Sudo mode adds *machine*
eyes, never *session* authority.

### D6. eBPF as a first-class subsystem of `airi-system` (opt-in, §D7 rung L4)

Framing, plainly: this is the deepest visibility AIRI will ever have, and the project lead has
named the north star — *"sci-fi-level AI companion managing my OS" when the user runs AIRI as
systemd (sudo) mode*. This section designs that ceiling honestly: what eBPF adds, what it must
never do, what it costs to ship, and what "managed OS" legitimately means (§D7). eBPF is a
subsystem of the helper — compiled into the `airi-system` binary behind a crate feature
(`ebpf`), **armed and detached on demand, never resident** — not a separate daemon, not a
default, not a silent convenience.

**D6.1 Consent tier.** eBPF audit is T3-adjacent (machine-wide event visibility beyond what a
user session exposes) and sits at rung L4 (§D7). Tiering rules:

- off by default; enabling requires the L4 arm action `org.moeru.airi.system.ebpf.enable`
  (polkit, `auth_self`, **per arm**, never cached beyond the minute);
- arming presents: the exact event set, the redaction guarantee, the memory-only retention, and
  the lockdown-detach behavior;
- `CAP_SYS_ADMIN` is **never** requested — if a kernel path fails with only
  `CAP_BPF`/`CAP_PERFMON`, the helper reports "unsupported kernel path" and refuses; the
  fallback is a *reboot into a newer kernel or a distro with BTF*, not a wider capability;
- every arm/disarm lands in the audit log with the event set requested and the user's answer.

**D6.2 Event streams → companion features.** Each row is an independent opt-in; arming stream A
never arms stream B. "Best tool?" verdicts are explicit — eBPF is not always the right hammer.

| Stream (tracepoint/program) | Companion feature | What AIRI may do with it | Retention | Verdict: eBPF the right tool? |
|---|---|---|---|---|
| `sched:sched_process_exec` | **"What did she watch you launch today"** — process lineage digest | redacted exec line (path basename + hash of args by default; full path only if user opts in), parent→child chain, per-day counts; never env, never argv payloads by default | T1 (local, 7 days) or T0 counters | Yes — sd-bus has nothing for execs; `/proc` polling is racy |
| `openat2`/`openat` + `unlink`/`rename` tracepoints | **Filesystem activity timeline**; storage-pressure forecasting; "you modified `/etc/X` but no owning unit was restarted" lint | path of files touched (with `$HOME`/dotfile denylist `/.ssh/,/.gnupg/,/shadow,/etc/sudoers` enforced in-program — nothing leaves the kernel on denied paths), counts per subtree; never file *contents* (open flags only, never `read`/`write` payloads) | T1, 7 days, capped | Partially — inotify covers own dirs; eBPF adds machine-wide + network-share visibility and unlinks/renames (awkward via inotify). Opt-in as a pair, path-only |
| `tcp_v4_connect` / `tcp_v6_connect` (tracepoints on the connect path; no kprobe needed) | **Outbound connection metadata** — "your build is talking to a registry you've never seen"; egress hygiene for her own speech | 5-tuple (dst IP, dst port, proto) + byte counters + process name; **no DNS lookups' answers, no SNI, no payload, no timing correlations beyond coarse buckets** | T0 ring (5 min) + T1 digest aggregates only | For this job, yes — but flag it as the **exfil-risk frame**: destination IPs are browsing/telemetry metadata about the user's *own machine*, and they reveal what services the machine talks to. AIRI never resolves or retains raw IP history; the feature is "aggregate destinations per day + novel-destination flags", never a historical address book |
| `sched:sched_switch` + runqueue/`sched:sched_wakeup` latency | **Machine health** — "your render is starved", "swapping?", "which process monopolized CPU for 10 min" | scheduler latency histograms, top-offender processes, UI hints + voice summaries; never content | T0 live + T1 daily rollups | Yes — nothing else gives per-process runqueue latency system-wide without privilege |
| `oom_kill` tracepoint (`oom:oom_kill` / `oom_kill_process` in recent kernels; record carries victim task + oom_score) | **The "OS managed by her" event** — she catches the OOM kill in the act | immediate user notification with victim process + score + cgroup context; proposes mitigations ("your editor took the hit — Chrome's tab X is the hog; reduce or exclude?"); never takes mitigation without consent (L2/L3) | T0 + audit line | Yes — **sd-bus has no OOM signal**; journald shows it after the fact (we watch that too, see below); `memory.events` is poll-only. eBPF is the precise tool. Non-negotiable caveat: still never a veto |
| Failed-unit / service-exit detection | "nginx died at 03:12 — restart it?" | **Do not use eBPF.** Use `org.freedesktop.systemd1` signals (`UnitNew`, property `ActiveState`/`SubState` via `PropertiesChanged`) + journald match on `_SYSTEMD_UNIT` + `Priority<=3` | T1 7 days | **No — sd-bus + journald is the correct substrate** (structured, redacted, exact, cheaper, no privilege). eBPF adds nothing; explicitly not built on eBPF |

**Exfil-risk framing (mandatory, and in the consent text):** the network stream sees *who this
machine talks to*, which is metadata worth protecting even though it is not payload. AIRI's rule:
she flags **novel destinations** (first-seen IP:port for a process, allowlist = configured
providers/registries) and **volume anomalies**; she never builds a browsable history of
destinations; she cannot decrypt; and the whole stream is off unless armed. This stream, alone,
justifies calling eBPF "T3-adjacent" rather than "T1".

**D6.3 What the subsystem must refuse (hard non-goals, in the binary):** no uprobes anywhere; no
kprobes on `security_*`, `cap_*`, `credentials`, `keyctl_*`, or `ptrace_may_access` paths; no
LSM hooks (BPF LSM is root-adjacent by design — not shipping); no `sched_process_fork` stack
pumps (fork is derivable from exec lineage); no payload capture of any kind (`read`/`write`
tracepoints are compiled out); no network *payloads* (only the 5-tuple row above); no persistence
to disk of raw ring data (rings → redactor → T0/T1 rules → at most a digest on disk); helper
disarms all eBPF on session-lock relay and on `DisarmAll()`.

**D6.4 Tech choices for a Rust codebase — Aya vs libbpf-rs vs BCC.**

| Choice | Build complexity | Kernel req | Portability (CO-RE) | Verifier/tooling friction | Ship shape in .deb | Verdict |
|---|---|---|---|---|---|---|
| **Aya** (pure-Rust eBPF, `aya` crate; userspace + eBPF both Rust) | eBPF program compiled at *build time* via `aya-build`/nightly `-Z build-std` BPF target or prebuilt ELF; no C, no clang, no libbpf at build or runtime | ≥5.8 for CAP_BPF/CAP_PERFMON split; fixed-format tracepoints need **no BTF** (record is stable ABI); aya can consume BTF when present for richer programs (`aya::btf`) | CO-RE optional; our six streams need none (fixed tracepoint formats; `task_struct` never dereferenced) | Same kernel verifier as everyone; Rust eBPF panics abort cleanly; no LLVM pinning of userspace | Single static-ish helper binary; eBPF ELF embedded via `include_bytes!`; no runtime clang, no `bpftool`, no headers | **Recommended** — matches the Rust tree, one binary, smallest supply chain, best fit for `.deb` |
| **libbpf-rs** (CO-RE, C skeleton) | eBPF in C → clang → skeleton header → Rust FFI; needs clang + kernel headers at build; two languages in the critical path | ≥4.18 for basics; CO-RE needs vmlinux BTF (`CONFIG_DEBUG_INFO_BTF`) for struct reads; tracepoints still fine without it | **Best-in-class CO-RE** (relocation against target BTF) — strongest when reading `task_struct` et al. | Excellent docs; libbpf is the ecosystem reference; but C-in-Rust-tree friction + two toolchains for a dev package builds | skeleton baked into binary; BTF needed on some programs; distro BTF variance is yours to manage | Fallback if a future stream *must* read `task_struct` fields (e.g. cgroup id enrichment). Not for v1 L4 |
| **BCC** | C/Python/Lua compiled at *runtime* | broad, oldest kernels | n/a (runtime compile) | runtime LLVM dependency, huge footprint, startup cost, debuginfo hunts | would balloon the dev package; runtime compile = attack surface + latency | **Rejected** |

Honest cross-check, per the project rule of trusting source over habit: the six streams in
D6.2 use only **tracepoints with stable record formats** (`sched_process_exec`'s record layout
is ABI; `oom_kill` likewise on ≥6.x; `tcp_v4_connect` via the connect tracepoint group) or
raw tracepoints for `sched_switch` — none dereference kernel structs, so **no BTF dependency**.
If a future stream needs BTF (e.g. cgroup v2 path enrichment), the rule is: use aya + target
BTF where present and *degrade out* elsewhere — never require `CONFIG_DEBUG_INFO_BTF`.

**Where eBPF lives:** D6.2's streams need privileged loading/attachment; the only privileged process in
this design is `airi-system`. Decision: **eBPF engine lives inside the helper**, compiled in
(`--features ebpf` in dev package; release builds include it but ship it *disarmed*). Reasons:
one privileged artifact to audit; one cap-bounding set; arming = IPC message, no extra process;
disarm on lock/crash/`DisarmAll()` = close maps, detach programs, done. A *separate* eBPF helper
would add a second privileged process for zero isolation gain — rejected. A *userspace-only*
implementation (polling `/proc`) is the documented fallback for kernels that can't support L4.

**D6.5 Capability minimization — the honest floor and ceiling.**

- **What attachment actually needs:** program load checks `CAP_BPF` (≥5.8) on the load path;
  tracepoint attach/perf-related paths check `CAP_PERFMON`; `BPF_RAW_TRACEPOINT_OPEN`
  historically also consulted `CAP_SYS_ADMIN` on older kernels. Practical outcome on modern
  kernels (**6.1 LTS and later recommended; 5.10 LTS workable**): `CAP_BPF` + `CAP_PERFMON`
  suffices for tracepoint programs with fixed formats. **We do not request `CAP_SYS_ADMIN`.**
- **The honest version note:** on some 5.8–5.14 kernels, raw-tracepoint open paths still demand
  `CAP_SYS_ADMIN`; and `lockdown=integrity`/`confidentiality` does **not** block BPF (only
  kexec, unsigned modules, `/dev/mem` etc.), so Secure Boot machines are fine. Distros without
  tracepoint support or with `kernel.unprivileged_bpf_disabled=2` (this workstation) simply
  refuse — the helper reports "kernel does not permit eBPF on this machine" and L4 shows
  unavailable with a one-line explanation and a docs link. No retry storms.
- **No BTF needed** for our streams (see D6.4) — but the helper queries BTF presence at arm time
  and reports it; operators on Debian-flavored kernels lacking BTF lose nothing we ship.
- **CapabilityBoundingSet** in the unit stays exactly `CAP_BPF CAP_PERFMON`. `CAP_SYS_ADMIN`
  is not present, not "permitted but unused", **absent**. If that ever fails on a target, the
  answer is a newer kernel — not a bigger bitset.
- Ambient capabilities: `AmbientCapabilities=CAP_BPF CAP_PERFMON` so the unprivileged-in-practice
  sysuser can actually exercise them (bounding alone restricts but doesn't grant). Order
  matters; systemd applies ambient caps only when the file set is non-empty and the caps are in
  the bounding set — again: absent `CAP_SYS_ADMIN` everywhere.
- Verifier quirks handled in design: fixed-format reads only, bounded loops (unrolled histogram
  buckets), no unbounded string reads (fixed 64-byte arg hashes + optional path tail, denylist
  enforced *before* hashing leaves the kernel… hash is computed in-kernel; raw strings never
  cross), ring buffer drops are counted and surfaced ("eBPF ring overflowed — 3,214 events
  lost") rather than backpressured.

**D6.6 Shipping it in a `.deb` (dev package, `build-deb.sh` lineage):** the eBPF ELF is built at
package-build time by a builder (nightly rustc + `aya-build`), embedded with `include_bytes!`,
and the helper binary `airi-system` is a single ELF — **no clang, no `bpftool`, no kernel headers
at install or runtime**. `linux-headers-$(uname -r)` is **not** a dependency (we never kprobe, we
never compile at runtime). BTF is read from `/sys/kernel/btf/vmlinux` at arm time if present, for
information only. Reproducibility note for the release crowd: pin the builder image
(`rust:nightly-<date>`) — recorded in packaging README next to the Spine vendoring policy.

### D7. "AIRI manages my OS" — the capability ladder

The north star is real and reachable — as *pre-authorized, user-authored policy executed by a
systemd-native supervisor*, not as a free-floating mind with root. Precisely:

| Rung | Name | What AIRI may do | Authorization | Status |
|---|---|---|---|---|
| **L1** | Observe | Everything §B/§C/§D-user can: system-bus reads, session eyes, audit digests. No actions. | toggles (T0/T1) | default; most users stay here forever |
| **L2** | Act via HITL | Any actuation (restart a unit, apply a fix) — each **interactive** prompt, ACP UX, polkit `auth_self` per call | per-action prompt | recommended ceiling for v1-capable users |
| **L3** | Act via standing rules | User-written, bounded rules: e.g. "if `nginx.service` dies, restart it", "if swap > 90% and memory pressure critical, drop caches? no — notify me". Stored in `/etc/airi-system/rules.d/*.rule` (JSON, human-inspectable), applied only within their declared surface (specific unit names, specific actions), every application audited with the rule that fired it; anything outside surface ⇒ falls back to L2/HITL. Rules are plain text the user can `cat` and `rm` — no opaque binary blobs; writing/modifying a rule requires one polkit prompt (`org.moeru.airi.system.rules.apply`); rules never self-modify | write-time polkit + continuous audit | the sci-fi rung, without the runaway — **the actual "managed OS"** |
| **L4** | eBPF audit | The §D6 streams; deep machine introspection; no actions (L4 is *eyes*, not hands) | per-arm polkit + stream-specific checkbox | opt-in experimental |

**What "AIRI manages my OS" means, exactly:** a higher-level policy/insight layer **above**
systemd — supervision over unit lifecycle + journald watch + eBPF audit + polkit-gated
authorization — where *you* author the policy and *she* executes within it, explains what she
did, and asks otherwise. **Never:** PID 1 replacement; kernel modules; bootloader/firmware edits;
silent self-update; kernel config changes; `/etc` drift the user didn't rule on; initramfs
reach; unprompted firewall/network reconfiguration; package installs without L2/L3 explicitly
allowing the package as target. Secure Boot is compatible (BPF is not blocked by lockdown; the
line she never crosses is exactly the line lockdown itself draws).

**Where the "managed OS" story breaks — stated plainly:**

- **Wayland isolation**: screen *content* stays portal-gated (P3). A "managed OS" she cannot see
  your screen wins nothing there; AT-SPI (§C) is the sanctioned eyes, portals the pixels.
- **Other users**: out of scope, period (§A4/§E4); sudo mode is for single-user/dedicated machines.
- **Secure Boot**: fine for eBPF; hard line at kernel modules — that line *is* the ceiling.
- **Kernels**: eBPF is not guaranteed everywhere — no BTF is fine for our streams, but no tracepoints/no `CAP_BPF` distros (or `unprivileged_bpf_disabled=2`, this machine) refuse cleanly; L4 shows unavailable, everything else works.
- **L3 misconfiguration**: a standing rule wrong-but-permitted still fires — the audit log and the "applied: rule #…" line exist precisely so the user can catch their own bad rule days later. Rules are diffable text; treat them like dotfiles.
- **She is not a safety net for root**: L2/L3 never authorize deleting/overwriting user data without an interactive confirm, regardless of any rule wording; the helper refuses destructive filesystem verbs outright.

---

## E. Packaging and lifecycle

### E1. User-side (`--user` half) — concrete shape

`~/.config/systemd/user/airi-daemon.service` (dev) / `/usr/lib/systemd/user/airi-daemon.service`
(package):

```ini
[Unit]
Description=AIRI companion core (user session)
Documentation=https://github.com/anlmalabs/airi
After=graphical-session.target
PartOf=graphical-session.target
# Not Requires= — the daemon must run in degraded headless mode too

[Service]
Type=dbus
BusName=org.moeru.airi.Daemon1
ExecStart=/usr/bin/airi-daemon
Restart=on-failure
RestartSec=2
StartLimitIntervalSec=60
StartLimitBurst=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/.local/share/airi %h/.cache/airi %h/.config/airi-qt
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX
LockPersonality=true
RestrictRealtime=true
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
MemoryMax=512M
CPUQuota=50%

[Install]
WantedBy=default.target
```

- D-Bus activation file `$XDG_DATA_HOME/dbus-1/services/org.moeru.airi.Daemon1.service`:
```ini
[D-BUS Service]
Name=org.moeru.airi.Daemon1
Exec=/usr/bin/airi-daemon
SystemdService=airi-daemon.service
```
(`SystemdService=` ties activation to the user unit — supported per `dbus-daemon(1)`.)
- XDG autostart (`~/.config/autostart/airi.desktop`) remains the Qt app's job (`desktop.rs`
  already writes it); the daemon is activated by BusName request, not by autostart copy.
- Journal: `journalctl --user -u airi-daemon`. All lines pass the redactor; no awareness payloads
  above debug level ever; panic hook as in the Qt app.
- Resource caps above are starting points; enforce with `MemoryHigh=384M` softer tier if swapping
  matters.

### E2. Sudo-mode helper (`airi-system`) — recommended concrete shape

**Decision (recommended): system service + socket-activated, polkit-gated IPC — NOT a root
daemon, NOT D-Bus-name-owned by root.** Comparison of the two last candidates:

| Shape | Pros | Cons |
|---|---|---|
| **System service + unix socket activation** (`airi-system.socket` → `airi-system.service`), peercred auth, tiny typed protocol | activation without root daemon parsing traffic while idle; `SocketMode=0660 SocketGroup=airi-system`; protocol fits in <100 lines each way; zero D-Bus dependency | another socket path to manage (`/run/airi-system/…`) |
| System service + system-bus name `org.moeru.airi.System1`, D-Bus-activated | consistent with D-Bus world; sd-bus; polkit subject = method caller uid | every local UID can attempt to call; every method needs polkit gate; more parsing surface (D-Bus) inside a privileged process |

Recommendation: **socket activation**, because the privileged parser should be as small as
possible and D-Bus method surfaces grow. Fallback note: if sd-bus ergonomics win during
prototyping, the D-Bus variant is acceptable **iff** every method is polkit-checked and the
service grants no `own` beyond its name.

`airi-system.socket`:
```ini
[Socket]
ListenStream=/run/airi-system/daemon.sock
SocketMode=0660
SocketUser=airi-system
SocketGroup=airi-system
Accept=no

[Install]
WantedBy=sockets.target
```
Members of group `airi-system` (= the owner(s) added at enable time) may connect; all others get
EACCES. The owner uid is recorded at install (`/etc/airi-system/owner`); helper compares
`SO_PEERCRED` uid against it — defense in depth beyond group membership (protects against
accidental group creep).

`airi-system.service` (hardened, root-adjacent not full root):
```ini
[Unit]
Description=AIRI system helper (sudo mode; opt-in)
Documentation=https://github.com/anlmalabs/airi
ConditionFileIsExecutable=/usr/lib/airi/airi-system

[Service]
Type=notify
User=airi-system
Group=airi-system
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=inaccessible
ReadWritePaths=/var/lib/airi-system
ProtectProc=invisible
ProcSubset=pid
PrivateUsers=no                 # eBPF + RAPL do not need user ns; set yes if eBPF drops below scope
PrivateDevices=yes
DevicePolicy=closed
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_NETLINK
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictRealtime=true
SystemCallFilter=@system-service @bpf
SystemCallErrorNumber=EPERM
CapabilityBoundingSet=CAP_BPF CAP_PERFMON
AmbientCapabilities=CAP_BPF CAP_PERFMON
NoNewPrivileges=true
MemoryMax=128M
CPUQuota=20%
TasksMax=16
Restart=on-failure
RestartSec=2
StartLimitIntervalSec=60
StartLimitBurst=5
WatchdogSec=15

[Install]
WantedBy=multi-user.target
```

Notes on the hard choices:

- **DynamicUser analysis.** `DynamicUser=yes` is attractive (no sysuser management) but: it is
  incompatible with a *named, stable* identity for (i) polkit rules matching a subject user, (ii)
  `SocketGroup=airi-system` pre-agreed with the user, (iii) `/var/lib/airi-system` ownership
  across upgrades. DynamicUser also implies `ProtectSystem=strict`-ish assumptions and is
  designed for stateless daemons; our eBPF/RAPL features want a predictable mount namespace for
  `/sys/class/powercap` (still fine under `ProtectSystem=strict` + read-only `/sys`, which is the
  default posture) but the *identity* point dominates. **Verdict: static sysuser `airi-system`,
  `DynamicUser=no`.** Static user costs a `useradd -r -s /usr/bin/nologin` in `.deb` postinst —
  acceptable and auditable. (If the helper ever becomes truly stateless *and* we drop RAPL+eBPF,
  revisit DynamicUser then.)
- **`ProtectHome=inaccessible`** — not `read-only`. The helper has **zero** business in `/home`.
  This is the single most important line in the unit.
- **`MemoryDenyWriteExecute=true`** — fine for our BPF use (we don't JIT from userland; the
  verifier JITs in-kernel).
- **`RestrictAddressFamilies=AF_UNIX AF_NETLINK`** — no `AF_INET`/`AF_INET6`: **the helper has no
  network path by construction.** Egress is architecturally impossible for the helper; only the
  user-session main process can reach the network (its own sandbox still applies).
- **`ProcSubset=pid` + `ProtectProc=invisible`** — `/proc` shows only pids the helper owns (its
  own), shrinking info leak surface while keeping `fork` introspection possible.
- **`PrivateDevices=yes` + `DevicePolicy=closed`** — helper opens no device nodes. RAPL sysfs is
  not a device node; eBPF needs no device.
- **`WatchdogSec=15` + `Type=notify`** — hangs (bpf map stalls) trip the watchdog → restart →
  fail-closed after `StartLimitBurst`.
- **Kill switch**: helper honors a `DisarmAll` IPC; on user-session lock signal (relayed from the
  user daemon) it pauses observation and drops eBPF programs (detach + close maps) — observation
  state does not survive lock.
- **eBPF subsystem (§D6).** The `ebpf` crate feature compiles the subsystem in; it is inert
  until armed over IPC. Arming loads the embedded ELF, attaches only the requested streams, and
  arms nothing else; lock/`DisarmAll()` detaches every program and closes every map before the
  disarm is acknowledged. Watchdog covers bpf-map stalls. If any stream fails to load on the
  running kernel (caps, lockdown, missing tracepoint), the helper reports the failing stream by
  name and refuses that stream only — other armed streams are unaffected.

**Identity & group membership.** Package creates sysuser `airi-system` + group `airi-system`.
`pkexec airi-systemctl enable` (shipped by the package to `/usr/bin`) does: stop-if-running,
`groupadd airi-system`-idempotent, `usermod -aG airi-system <invoking-uid>`, writes
`/etc/airi-system/owner` (600, root:root, contains username+uid), `systemctl daemon-reload &&
systemctl enable --now airi-system.socket`, prints the exact grants it applied.
`pkexec airi-systemctl disable`: stop + disable socket+service + remove uid from group +
remove owner file + `systemctl reset-failed`. One command, one pkexec prompt, full reversal.

### E3. polkit actions (`/usr/share/polkit-1/actions/org.moeru.airi.policy`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE policyconfig PUBLIC
 "-//freedesktop//DTD polkit Policy Configuration 1.0//EN"
 "http://www.freedesktop.org/software/polkit/policyconfig-1.dtd">
<policyconfig>
  <vendor>AIRI</vendor>
  <vendor_url>https://github.com/anlmalabs/airi</vendor_url>

  <action id="org.moeru.airi.system.enable">
    <description>Enable AIRI sudo mode (system-level helper)</description>
    <message>Authentication is required to enable AIRI sudo mode</message>
    <defaults>
      <allow_any>auth_admin</allow_any>
      <allow_inactive>auth_admin</allow_inactive>
      <allow_active>auth_admin</allow_active>
    </defaults>
  </action>

  <action id="org.moeru.airi.system.invoke">
    <description>Perform an AIRI system-helper action</description>
    <message>AIRI wants to perform a system-level action</message>
    <defaults>
      <allow_any>no</allow_any>
      <allow_inactive>no</allow_inactive>
      <allow_active>auth_self</allow_active>
    </defaults>
    <annotate key="org.freedesktop.policykit.imply">org.moeru.airi.system.invoke</annotate>
  </action>

  <action id="org.moeru.airi.system.ebpf.enable">
    <description>Arm the experimental eBPF audit stream</description>
    <message>Authentication is required to arm AIRI's experimental eBPF stream</message>
    <defaults>
      <allow_any>no</allow_any>
      <allow_inactive>no</allow_inactive>
      <allow_active>auth_self</allow_active>
    </defaults>
  </action>

  <action id="org.moeru.airi.system.rules.apply">
    <description>Write or modify an AIRI standing rule (L3)</description>
    <message>Authentication is required to change AIRI's standing rules</message>
    <defaults>
      <allow_any>auth_admin</allow_any>
      <allow_inactive>auth_admin</allow_inactive>
      <allow_active>auth_self</allow_active>
    </defaults>
  </action>

  <action id="org.moeru.airi.system.nm_modify">
    <description>Change network configuration for AIRI (experimental; off)</description>
    <message>AIRI wants to change system network settings</message>
    <defaults>
      <allow_any>no</allow_any>
      <allow_inactive>no</allow_inactive>
      <allow_active>no</allow_active>
    </defaults>
  </action>
</policyconfig>
```

Notes: no `allow_*` is ever `yes`. The enable action uses `auth_admin` deliberately — enabling
sudo mode on a shared machine is an admin decision, not a "click yes" one. `invoke` is
`auth_self` (owner re-auth per call for actions that need it; read-only subscriptions don't call
polkit at all — membership in `airi-system` group + peercred owner check is the gate for T0
reads; polkit is reserved for actuation, standing-rule writes, and arming eBPF). `rules.apply`
is `auth_self` for the owner writing their own rules in the active session, `auth_admin` for
everything else; rule *application* (firing) is pre-authorized at write time and needs no
per-fire prompt — that is the entire point of L3, and the audit log is what keeps it honest.
`ebpf.enable` is deliberately **not** cached across arms. **No authorization rule ships in the
package** (`/etc/polkit-1/rules.d` is distro/sysadmin territory per polkit docs — applications
must never ship rules).

### E4. Enable/disable UX (settings card, no silent root)

Settings → Awareness → Sudo mode card states, in this order:

1. What it is: "AIRI runs a root-adjacent helper (`airi-system`) on the capability ladder (L1
   observe → L2 prompt-per-action → L3 your standing rules → L4 opt-in eBPF audit; §D7). It can
   observe machine events your session can't: device hotplug, network up/down, sleep/wake,
   systemd unit state, and — **only if you arm it separately** — the §D6 eBPF streams (exec
   lineage, filesystem timeline, outbound 5-tuple metadata, scheduler latency, OOM-kill alerts).
   It **never** reads your home directory, files, passwords, or session; it has **no ability to
   reach the network**; and L4 events never persist payloads."
2. Who it's for: "Single-user workstation or dedicated machine. On a shared machine this
   observes other people's machine events — do not enable without their informed consent."
2b. The L4 arm is a **separate** consent step, after sudo mode is already on: per stream, with
   the exact event list shown, `auth_self` every time, re-disarmable in one click, and always
   off at boot and on lock.
3. Dry-run button: `pkexec airi-systemctl enable --dry-run` → prints exactly: sysuser created,
   user added to group, socket unit enabled, polkit actions installed, caps granted, owner file
   written. The checkbox does not flip until the dry-run output has been shown (in-app, scrollable).
4. Checkbox label: "Enable sudo mode (I understand this observes machine events for every user on
   this machine, and I have consent to enable it)" — mandatory, unchecked by default, reverts
   itself if the user navigates away or cancels the pkexec prompt.
5. When active, **persistent indicator**: distinct tray glyph + statusline entry "sudo mode"
   (never color-only; text + icon), plus a settings banner with "Disable…" one click away.
6. Disable: one command `pkexec airi-systemctl disable` (also in the card); confirm; done.

### E5. Packaging (`apps/airi-qt/packaging/build-deb.sh` lineage)

The existing dev recipe (`airi-qt-dev`, `dpkg-deb`-or-manual-`ar`, dist/ gitignored, dev-grade
posture per cutover plan §7.6) extends naturally — do not fork it:

- new flags: `--with-system-helper` stages `/usr/lib/airi/airi-system`, `airi-system.service`,
  `airi-system.socket`, `/usr/share/polkit-1/actions/org.moeru.airi.policy`,
  `/usr/lib/sysusers.d/airi-system.conf`, `/usr/bin/airi-systemctl`, docs under
  `/usr/share/doc/airi-qt-dev/sudo-mode.md`.
- `postinst`: `sysusers.d` applies the sysuser (no network, no shell); `systemctl
  daemon-reload`; **helper NOT enabled/started by postinst** — enable is always the explicit
  user flow via `airi-systemctl`. `prerm`: stops/disables units, removes group membership and
  owner file, removes polkit file (conffile-clean).
- Depends: unchanged + `policykit-1` (or `pkexec` from polkit), `systemd`. `Recommends:` nothing
  new. Runtime absence of polkit → card shows "sudo mode unavailable (polkit missing)", enable
  disabled.
- rpm/flatpak equivalents later; flatpak: **no sudo mode** (no system helper in sandbox) — the
  card is absent there by construction. AUR/whatever later.
- Releases: dev-grade until v1 ships; the dev package remains `airi-qt-dev` (cutover plan §7.6);
  sudo mode ships in the same dev package as a flag, not a fork.
- **eBPF builder story** (§D6.6): eBPF objects are compiled at package-build time (nightly rustc +
  `aya-build`, pinned builder image), embedded in the helper with `include_bytes!`; the `.deb`
  ships a single `airi-system` ELF. **No** runtime LLVM/`clang`/`bpftool`/`linux-headers-*`; BTF
  is read from `/sys/kernel/btf/vmlinux` at arm time for information only. Contracts by arch are
  x86_64-only for now; aarch64 is a separate decision with its own builder pin.
- The helper's `--check` selftest mode (`airi-system --check`) loads nothing, verifies its own
  unit file/sysuser/polkit/socket pairing, and prints what *would* be granted — this is what the
  dry-run button surfaces and what CI runs on every package build.

### E6. Lifecycle details

- **Protocol**: helper greeting `{"protocol":1,"features":["uevent","powercap","ebpf","rules"],
  "ladder":2}`; user daemon checks before enabling sudo-mode sources in UI; mismatch → generic
  "helper outdated — upgrade AIRI" state, fail-closed. `ladder` advertises the highest rung
  (L1–L4) the user has authorized via the enable/rules/eBPF flows; UI renders from the
  negotiated value, never from guesswork.
- **State**: helper writes nothing but its journal by default (plus `/var/lib/airi-system/`
  reserved for future caches — empty v1). Nothing user-data-shaped is stored by the helper.
- **Logs**: `journalctl -u airi-system`; payloads (uevent paths, RAPL numbers) are metadata —
  still pass the redactor before journaling at info level; debug level off in release.
- **Rollback**: §E4/E5. `apt remove airi-qt-dev` disables everything (units + polkit + sysuser
  removed); user data untouched; journal lines remain until vacuum.
- **Upgrade**: drop-in restart policy; new helper versions re-negotiate; older user daemons
  ignore unknown greeting keys.
- **Restart storms**: `StartLimitIntervalSec=60`, `StartLimitBurst=5`, watchdog + `Restart=
  on-failure`; after burst, helper stays down and the user daemon reports "sudo mode needs
  attention" instead of restarting it — the *human* decides.

---

## F. Consent tiers and privacy rails (mandatory)

Tiers (apply to every observation source; per-source toggles live in one Settings page):

| Tier | Name | Definition | Examples | Default |
|---|---|---|---|---|
| **T0** | Observer | In memory only, zero persistence, zero egress, toggleable per source | lock/unlock events, PrepareForSleep, NM/UPower/logind states, X11 window titles (opt-in), unit states | **on** (toggleable) |
| **T1** | Local memory | On-disk persistence on this machine only, retention-bounded, user-inspectable | awareness ring persisted to journal db (7 days default), "was I in a call at 3pm?" queries | off |
| **T2** | Acting | AIRI performs an action on the user's behalf; each action gated by an explicit interactive permission (ACP-style HITL UX, existing `airi-acp` `PermissionRequest` precedent + `answer_permission`) | inhibit idle, send a notification, open a URL, stop a unit (polkit prompt), arm eBPF stream | off (per action) |
| **T3** | Outside | Anything egressing beyond this machine, or acting on other machines/users | cloud LLM call containing observed context; remote shell; sync of awareness data | **never ambient; out of scope by default; only via per-message explicit user consent** |

Rails (all mandatory, all shipped in Phase 1 unless noted):

1. **Per-source toggles** — one settings page ("Awareness"), one row per source: name, what it
   sees, tier, retention, "last triggered …". Everything off is a valid state.
2. **Master kill switch** — tray item ("AIRI: observe nothing") + global hotkey (reuse the
   `desktop.rs` ScrollLock pattern). Kill switch = disarm all observers **and** helper quiesce
   (IPC) **and** full eBPF detach (L4) **and** purge in-memory buffers — one action, verified by
   reading back the helper's negotiated ladder state. Re-arming requires the settings page, not
   the hotkey.
3. **Local audit log** — append-only JSONL in `<data>/airi-qt/awareness-audit.jsonl`; every
   observation-arm/disarm/action/drop with timestamp + source + tier + decision; viewable and
   deletable in settings ("forget everything I saw today/all"); **includes which half (user
   daemon vs helper) produced each line**; redacted before write.
4. **Redaction before persistence or egress** — regex pass for credential shapes (`sk-`, `ghp_`,
   `Bearer `, `password=`, JWT triple-dot blobs, `AKIA…`, `xox[bp]-…`) applied to *everything* on
   its way out of memory — into logs, into T1 persistence, and above all before any prompt to any
   model (cloud or local). Documented egress boundary in-app: **awareness data never enters a
   prompt automatically**; injection is per-message, with a visible "awareness context attached"
   chip; cloud endpoints show a distinct warning.
5. **No covert audio** — hearing stays opt-in with a visible tray microphone indicator (existing
   `p11-lane-hearing` posture); sudo mode never gains audio (§D).
6. **Lockdown on screen lock** — login1 `LockedHint`/`Lock()` (primary) + screensaver
   `ActiveChanged` (fallback): disarm all session observers, purge awareness ring, relay disarm
   to helper, tray shows lock glyph; only lock/unlock signals remain armed to detect unlock.
7. **Never other users' data** — user daemon: session-scoped by construction; helper: no home,
   no session bus, no audio, machine events only; multi-user machines are out of scope for sudo
   mode; consent copy says so verbatim (§E4).
8. **Never passwords** — a11y password-role exclusion + name/description heuristics + app denylist
   (§C); secrets portal untouched; RAPL/eBPF carry no credentials; X11 caveat documented
   (permissionless capture exists — capture page already warns).
9. **Egress boundary explicit** — the only bytes leaving the machine are chat prompts the user
   sends (plus models they explicitly attach); awareness context is attached only per message;
   T3 sources (anything sync-like) do not exist.
10. **Spoof-resistance** — all bus input untrusted; no security decision is ever made from a
    signal; actuation is gated by polkit/HITL, never by "someone told the bus".
11. **Sudo mode specific rails** — §E4: dry-run preview, mandatory checkbox, persistent
    indicator (tray + statusline), one-command disable, helper has zero network and zero home
    access, owner-uid check on IPC, machine events logged as type+timestamp only.
12. **eBPF (L4) specific rails** — per-stream arm only, `auth_self` per arm, off at boot and on
    screen-lock (programs detached, maps closed before the disarm is acknowledged — never
    "still running but quiet"), rings in memory with fixed size and hard drop counters (drops
    are reported, never backpressured), in-kernel denylist for credential paths before any
    string crosses to userspace, **no payload capture anywhere** (exec = basename + arg hash;
    fs = path + op only; net = 5-tuple + counters; OOM = victim metadata), redactor on every
    byte before any persistence or model call, eBPF stream output never reaches a prompt without
    the per-message "eBPF digest attached" chip, and a one-click "disarm L4" on the sudo-mode
    card that is verified by reading back negotiated ladder state (not by trusting the click).

### Sudo-mode consent copy (the checkbox, verbatim intent)

> **Enable sudo mode?**
> AIRI will run a small system service (`airi-system`, user `airi-system`) alongside your
> session. It lets AIRI observe machine-level events your session cannot: device hotplug (USB…),
> network up/down, sleep/wake, systemd unit state, and — only if you arm it separately — an
> experimental eBPF stream of process starts.
>
> It does **not** read your home directory, your files, your browser, your passwords, your
> session, or your audio. It has **no ability to connect to the network** — only your normal
> AIRI app can send anything anywhere.
>
> On a multi-user machine, this observes *every user's* machine events (when things were plugged
> in, when the machine slept). Enable only on a machine dedicated to you, or with the informed
> consent of everyone who uses it.
>
> You can disable at any time from Settings → Awareness → Sudo mode, or with one command:
> `pkexec airi-systemctl disable`.
>
> \[ ] I understand and I consent — enable sudo mode

---

## G. Threat model

IDs: T-n. "Blast radius" = what a successful compromise/misuse yields.

| # | Threat | Blast radius | Mitigation | Residual |
|---|---|---|---|---|
| T1 | Secret visible on screen (API key in an editor) gets summarized into awareness, then into a cloud prompt | cloud provider sees the secret | redactor pre-persistence **and** pre-prompt; per-message attach only; T3 never ambient; "awareness attached" chip UX | user overrides redaction label → their call, loudly labeled |
| T2 | AT-SPI reads a password in a mislabeled web field | local plaintext → local logs/prompt | §C: password-role + heuristic + app-name exclusions; never persist raw; denylist | evasive custom widgets; residual small, documented |
| T3 | Root helper compromise (any code path bug) | machine events + caps (`CAP_BPF`/`CAP_PERFMON`), `/sys` reads; **no** home, **no** secrets, **no** network | static sysuser, `ProtectHome=inaccessible`, `DevicePolicy=closed`, `RestrictAddressFamilies=AF_UNIX AF_NETLINK`, `CapabilityBoundingSet` minimal, `ProtectProc=invisible`, <1k LOC, no untrusted parsing (typed length-prefixed protocol), fail-closed on any inconsistency, watchdog | user-session compromise is still game over — that's the existing trust anchor |
| T4 | Helper confused deputy: any local process asks it to act | unwanted machine actions | socket group `airi-system` (only owner members connect) + `SO_PEERCRED` uid == `/etc/airi-system/owner` + polkit per actuation + `CloseOnExec` hygiene | physical/root already owns machine |
| T5 | Shipped polkit policy too broad (e.g. `allow_active=yes`) | unattended privileged actions | policy in §E3: nothing `yes`; enable=`auth_admin`; invoke=`auth_self`; rules never shipped (admin's prerogative per polkit docs) | sysadmin overrides — their audit, their machine |
| T6 | Policy file (`system.d`) misconfigured wider than needed | helper callable by wrong subjects | helper policy is *additive*, own-name only; send not granted; no `own="*"`; README explains `/etc` override | package-review catches |
| T7 | Monitor mode (if enabled) captures sync tokens/messages | every payload on the bus | §B5: interface-scoped rules only, memory-only 5-min ring, lockdown purge, kill switch | monitor is opt-in power; redact anyway |
| T8 | Spoofed D-Bus signals drive AIRI into actions | social-engineering the companion | signals never authorize; HITL/polkit gate every action; jitter/debounce nonsense events | none meaningful |
| T9 | Crash loop / restart storm (daemon or helper) | resource burn, log spam | systemd `StartLimit*`, watchdog, Qt circuit breaker, helper stays down after burst until human intervenes | mild |
| T10 | Debug/logging leaks captured content into journal | journal readable by user (own journal) + root | redactor before write; info-level never carries payloads; debug off in release; audit JSONL user-deletable | root reads journal — root already owns machine |
| T11 | Supply chain: eBPF complexity / aya dependency | kernel attack surface | aya (pure-Rust, memory-safe eBPF, no C in tree); fixed-format tracepoints (no struct-offset guessing); no hand-rolled verifier tricks; eBPF behind a compiled-in feature flag, disarmed at rest; unsigned ELFs never loaded at runtime | kernel bugs exist; L4 labeled experimental honestly |
| T17 | eBPF exec-arg redaction fails (env-leaky arg like `AWS_SECRET=… mytool`) | secret hash is fine; raw string must never cross the ring | argv strings hashed **in-kernel**; raw arg bytes never copied out (only basename + hash + exit code); denylist applied pre-hash; redactor as second wall; fuzzed against arg-fixtures suite pre-merge | nothing — design refuses by construction |
| T18 | Outbound 5-tuple stream builds a de-facto browsing history | egress-surface inference about the user | stream exists only when armed per-session; retention is T0 ring + T1 daily *aggregates*; novel-destination flags only; no resolution, no address-book export, auto-off on lock | determined observer with helper access sees metadata — root already outranks this |
| T19 | L3 standing rule fires destructively (user wrote a bad rule) | bounded by rule surface (unit names, action verbs) | rules are plain text, bounded verb set (start/stop/restart/reload only), fire only on their declared trigger, every application audited with rule id, rules never self-modify, write requires polkit; destructive filesystem verbs do not exist in the L3 verb set at all | user error — caught by audit trail, not prevented (can't be) |
| T12 | Helper left enabled after user thinks they disabled; L4 left armed across reboot | ambient machine observation / eBPF audit continues | disable is atomic: stop → disable socket+service → remove group → remove owner file → `systemctl reset-failed`; L4 is **never armed at boot** (helper starts disarmed; arm is always an explicit per-session act); settings card verifies `systemctl is-active` == inactive and negotiated `ladder` == L2 before showing "disabled" | admin can't remove what admin reinstalls — fine |
| T13 | X11 permissionless capture (existing) | any app + AIRI sees screen | portal path Phase 3; warning copy; lockdown on lock | X11 itself is the leak; doc, don't fix |
| T14 | Shared machine: co-users' machine events leak (hotplug timing reveals their dock/phone presence) | privacy loss for third parties | sudo mode default off; multi-user warning mandatory; consent checkbox; enable only single-user/dedicated machines | consent honesty — nothing technical fixes social |
| T15 | Awareness ring on disk persists after "lock" if write raced | stale sensitive text | ring purged before any lockdown flag set; audit logs purge events; T1 optional | negligible |
| T16 | `airi-channel` 6121 exposed beyond loopback carrying awareness context | token theft → remote calls with her context | keep loopback default; TLS deferred but mandatory before LAN; awareness never flows via channel (architectural rule: awareness→chat only via in-process attach) | config mistake; documented |

**Egress boundary, explicit.** Bytes may leave the machine over the network only: (i) chat prompts
the user sends to their configured provider (existing behavior, unchanged); (ii) anything the user
explicitly attaches to such a prompt (an "awareness context attached" is attach, not ambient);
(iii) update checks (existing, unauthenticated GitHub releases, check-only — see cutover plan
§2.6). The helper has no network capability at all (T3, §E2). No telemetry. No analytics.
Matches `PRIVACY.md`'s "presence without custody" promise.

---

## H. Implementation shape (sketch, no code)

Phases map onto the existing Qt architecture; "reuse" = build on what exists, not parallel
implementations.

| Phase | Contents | Reuses | New | Exit criteria |
|---|---|---|---|---|
| **P1** — user daemon & session observers | `airi-daemon` user service; D-Bus-activated `org.moeru.airi.Daemon1/.Events1`; observers: logind sleep/lock/idle, screensaver ActiveChanged (fallback), MPRIS playback (PropertiesChanged, arg0-filtered), NM state, UPower battery/AC, systemd1 unit *state* (read-only); local ring buffer; audit JSONL; HITL action channel via ACP UX; kill switch (tray + hotkey); Settings "Awareness" page v1 (toggles + audit viewer + retention) | airi-channel patterns (loopback discipline, auto-heal lessons, but D-Bus sender auth instead of token), `airi-acp` permission engine (`PermissionRequest`/`answer_permission`), `desktop.rs` tray/hotkey plumbing (ksni, ScrollLock), SettingsWindow nav, i18n pipeline, `p7-memory-journal` storage habits (SQLite WAL) | `crates/airi-daemon` + `crates/airi-observe` (observer framework) + Qt bridge `bridges/daemon.rs` (33 ms drain, mirrors desktop bridge) + tray statusline | daemon survives `pkill -9`, recovers, kill switch provably disarms, audit log inspectable, all P1 sources default-off-except-T0 |
| **P2** — AT-SPI awareness | `crates/airi-a11y`: a11y bus discovery, event subscriptions, focused-subtree walker with hard caps, redactor-integrated summarizer; Settings toggle + per-app exclusion list; awareness chip for per-message injection | P1 audit/toggles/ring, `p11-lane-memory` retrieval for "last focused document…" queries | a11y client (atspi crate or D-Bus direct) | user reads "what was I working on" summary, pass on password-field test fixture |
| **P3** — portals & PipeWire | screen capture moved to `org.freedesktop.portal.Screenshot/ScreenCast` (X11 fallback kept); ambient audio = hearing opt-in via portal/native PipeWire with visible indicator; GlobalShortcuts portal for hotkeys | screen capture bridge (`capture.rs` gains portal path), hearing settings page (`p11-lane-hearing`), speech pipeline (airi-stt/airi-speech), `XDG_DESKTOP_PORTAL` plumbing | ashpd integration (Rust portal lib) or raw D-Bus portal client | Wayland machine does full loop: portal consent → delta of screen → eyes; hotkey works portal-native |
| **P4a** — system-bus reads | (no helper) daemon reads logind/UPower/NM/systemd1 directly; NM-profile **switch** stays out; results in T0 surfaces | P1 | none | NM state correct on up/down; logind PrepareForSleep drives morning/evening briefings |
| **P4b** — sudo mode foundation | `airi-system` helper per §E2/E3: socket activation, peercred+group gate, tray indicator, dry-run enable flow in Settings card, `airi-systemctl`, uevent subscriber (hotplug awareness), RAPL reporter (optional, off), helper audit, `--check` selftest | §E packaging work; `build-deb.sh --with-system-helper` | `crates/airi-system` (<1k LOC target for the non-eBPF core), `xtask`/script integration, sysuser packaging | enable→observe→disable round trip on dev machine; `systemctl status` clean; no home access (strace-checked); network zero (ss-checked) |
| **P4c** — standing rules (L3) | user-written bounded rules over `org.freedesktop.systemd1` (`start/stop/restart/reload` of explicitly-named units on declared triggers); plain-text rule files; apply engine inside helper; audit per fire; rules UI in settings (list/edit/delete with pkexec) | P4b helper (rules need the privileged apply path anyway), `org.moeru.airi.system.rules.apply` polkit action | rule schema + applier + audit wiring + `Settings → Standing rules` page | "nginx dies ⇒ restart" fires correctly, fires only its rule, audit line carries rule id; wrong rule demonstrably bounded by unit-name surface |
| **P5** — eBPF audit stream (L4, opt-in, helper-gated; the "managed OS" rung) | §D6 streams, armed individually: ① `sched_process_exec` lineage digest, ② fs timeline (path-only, unlink/rename + open count, storage-pressure forecasting), ③ outbound 5-tuple metadata with novel-destination flags (never payload/SNI/DNS answers), ④ runqueue/sched_switch latency histograms + offender hints, ⑤ `oom_kill` catch → victim report + mitigation proposal (action stays L2/L3, never automatic); sd-bus+journald cover unit-failure detection instead of eBPF — explicitly not built on eBPF | P4b helper, redactor, audit log | aya programs (fixed-format tracepoints, no BTF required) + arm/detach IPC + negotiated-ladder UI readback | per-stream arm, per-stream fail-closed, lockdown detach verified by readback; "what did this build run?" answered with zero payload residue; OOM fire drill catches a synthetic victim setup |

**Not in scope / not now:** anything in §D non-goals (incl. fanotify-perm, evdev, uprobes, BPF LSM);
KDE/GNOME window scripting; notification interception (monitor-mode-only, off by default, §B5);
FileManager1 handlers; Secret Service reads (never); root rewrite (rejected §A.3); kernel modules,
initramfs, bootloader, package installs without L2/L3 naming the package.

---

## I. Explicit decisions needed from the user

Crisp list. Each has a recommendation; none is decided by this document.

**Posture & shape**
1. Approve (b) hybrid posture: (a) default `--user`-only, (b) hybrid available via sudo mode, (c) rejected — confirm, or override.
2. **Sudo-mode enable decision** — is shipping sudo mode approved at all for the next milestone, or defer to v1.1+? (Rec: approve architecture + packaging in v1.1; Phase 1–P3 first. Do not block the daemon milestone on the helper.)
   - 2a. Enable mechanics: settings card shells to `pkexec airi-systemctl enable` + dry-run preview (Rec: yes) vs D-Bus-activated helper with polkit `invoke` on every call (Rec: no — noisier).
   - 2b. Helper IPC: socket activation (Rec) vs system-bus `org.moeru.airi.System1` + sd-bus + polkit per method.
   - 2c. uevent hotplug in scope for sudo mode v1? (Rec: yes, T0 metadata.)
   - 2d. RAPL telemetry in scope? (Rec: no for v1; addable later behind `org.moeru.airi.system.rapl.read` with `auth_self`.)
   - 2e. Shared-machine policy: helper explicitly unsupported/refused on multi-user machines (Rec: yes — check `users | wc -l` > 1 at enable time and refuse without `--i-know-multi-user` flag)?

**"Managed OS" ladder & eBPF**
3. Approve the ladder framing as the product posture: L1 observe (default), L2 per-action HITL (v1 ceiling), L3 user-written standing rules over systemd1 (the sci-fi rung), L4 eBPF audit (opt-in) — confirm, or pull any rung.
   - 3a. **Enable eBPF at all?** (Rec: approve the L4 subsystem *design* now; schedule behind P4b+P5; silence = strike.)
   - 3b. Default state: **off, always** (Rec) — arm is per-session, per-stream, `auth_self` each time. Agree?
   - 3c. **aya vs libbpf-rs** for the Rust tree (Rec: **aya** — D6.4 table: single binary, no C toolchain, no BTF needed for our streams, best .deb shape). Override only with a concrete technical reason in review.
   - 3d. **Target machine**: the systemd-mode companion desktop (dedicated, single-user) is the L4 target (Rec); never the shared/multi-user machine, never servers (Rec: sudo mode docs say exactly this).
   - 3e. Which streams ship in the first L4 milestone? (Rec: ① exec lineage, ⑤ oom_kill, ④ sched latency — the three with the best story-per-risk; ② fs timeline and ③ network metadata follow one milestone later, ③ is the most contentious — flag it explicitly.)
   - 3f. eBPF location (Rec: inside `airi-system`, armed on demand) vs a separate `airi-ebpf` helper (Rec: no — second privileged process, zero isolation gain) vs userspace `/proc` polling as the only implementation (Rec: documented fallback for non-BPF kernels, not the primary).
   - 3g. `CAP_SYS_ADMIN` fallback for troublesome 5.x kernels — approve? (Rec: **no**. Refuse, report, point at kernel upgrade; enabling it even "temporarily" teaches the wrong lesson and widens every door at once.)
   - 3h. Kernel floor to advertise: **6.1 LTS recommended, 5.10 minimum** (Rec); machines below floor get L4-unavailable with a link, everything else intact.
   - 3i. BTF requirement: none for our streams (Rec: none — degradation path is "stream unavailable", never "install BTF module").
   - 3j. L3 standing rules: approve authoring UX (text rules in `/etc/airi-system/rules.d/`, one polkit per write, audit per fire) — and is L3 in v1.1 or v1.2? (Rec: v1.1 after sudo-mode foundation, before L4.)
4. Bus name: `org.moeru.airi.Daemon1` (and `.Events1`, helper = `airi-system`/`org.moeru.airi.System1`)? (Rec: yes; keep `airi` reverse-DNS — moeru.ai is AIRI upstream identity; confirm the org string you want.)
5. Packaging shape for sudo mode: extend `packaging/build-deb.sh` with `--with-system-helper` in one dev package (Rec) vs separate `airi-system-dev` package.
6. Protocol surface v1: control (`GetVersion`, `ArmSource`, …) + one events stream — enough? (Rec: yes; MCP-over-D-Bus explicitly v1.1+.)

**Sources & tiers**
7. Default-on sources for P1: lock/unlock, sleep/wake, NM/UPower/logind state, media state (all T0). Agree? Or stricter default-off-everything?
8. Notification observation: never / monitor-mode-opt-in-only / drop entirely. (Rec: monitor opt-in only, memory-only, or drop; never as default.)
9. AT-SPI: ship in P2 with the §C exclusions? Or keep P2 out of scope entirely? (Rec: ship, opt-in.)
10. BlueZ presence eye: include as T1 toggle? (Rec: yes, default off.)
11. X11 supported or portal-only for capture in P3? (Rec: portal-first + X11 fallback; the "Wayland reality check" is already pre-v1 checklist item §5.7 of the cutover plan.)

**Rails**
12. Audit log retention default (Rec: 7 days, configurable, JSONL, deletable) + redaction engine choice (regex only vs + local small model classifier — Rec: regex only in v1; local classifier is a T1 feature, not v1).
13. Kill switch hotkey binding: ScrollLock reuse or new? (Rec: ScrollLock, mirrors mic toggle; document conflict.)
14. Lockdown coverage: lock *and* sleep/wake? (Rec: both; unlock wakes observers only after explicit re-arm? No — unlock re-arms T0 silently, same as XScreenSaver expectations; document.)
15. Telemetry boundary sign-off: egress = user-initiated prompts + update check only; nothing else, ever; sudo mode adds nothing because it cannot speak to the network. Confirm this wording ships in-app.

**Meta**
16. Which phase gets scheduled after P1? (Rec: P2 AT-SPI as its own lane, P3 portals after capture/Wayland groundwork lands.)
17. Sign-off on "no root daemon, no `CAP_SYS_ADMIN`, no evdev, no fanotify-perm, no dmesg" as hard non-goals. (Rec: yes.)
18. Who reviews the helper's code path as its own security-critical artifact — pre-merge review requirement? (Rec: yes, treated like the ACP permission engine.)
19. Cutover plan interplay: does any of this touch the Electron par-lock? (Rec: no; all of this is Qt-only, Electron untouched.)

---

## J. Prior art (brief — architecture, not trivia)

- **KDE KDED5 / kded modules** — long-running user-session service modules auto-started per session; the canonical "companion drops into the session" pattern in free software.
- **GNOME Shell extensions** — observation via the shell itself (allowed, intimate, version-locked); existence proof that session-scope suffices for deep UI eyes.
- **systemd user units + D-Bus activation** — the mechanism that makes "daemon appears when first asked, one instance, no login-time cost" free; we lean on it directly (§A.2, E1).
- **PipeWire** — session daemon + portals; the template for consent-mediated capture AIRI will reuse in P3; also WirePlumber monitor modules reacting to device events as a model for the uevent subscriber's shape.
- **llama.cpp server** — "localhost daemon, thin clients, explicit protocol" — the delivery pattern AIRI's gateway already follows (6121); informs the daemon's protocol hygiene.
- **polybar / waybar systemd-network-monitor & network modules** — poll-or-subscribe pattern for NM/sysfs without privilege; proof of life for §B2/B8.
- **`airi-channel` gateway (this repo)** — the loopback WebSocket, token in `config.json`, auto-heal on missing config; we reuse the discipline, replace the auth (D-Bus credentials, not a bearer token, inside the session).
- **power-profiles-daemon** — system service + polkit action + upower-style API for a *narrow* privileged capability; the canonical example of (b) done right and small.
- **playerctl/playerctld** — MPRIS proxy: proof that "media eyes" are commodity infrastructure.
- **KDE Connect** — user-session daemon + session D-Bus + discovery; closest shipped relative to "AIRI as a bus citizen".
- **flatpak xdg-desktop-portal-gnome/kde** — consent UX for capture/hotkeys; the P3 substrate ([portal docs](https://flatpak.github.io/xdg-desktop-portal/docs/)).
- **`p9-lane-screen-capture.md`, `p11-lane-hearing.md`, `p8-tray-hotkeys.md`, `p9-lane-acp-hitl.md`** (this repo) — capture failure semantics, opt-in hearing posture, tray/hotkey plumbing, HITL permission UX: the four seams P1–P3 plug into.
- **bcc `execsnoop` / `tcpconnect`** — the original "see every exec / connect box-wide" tools our L4 streams mirror; prior art for opt-in eBPF, and a warning about BCC's runtime-LLVM tax we decline to pay (§D6.4).
- **Grafana Beyla / Cilium Pixie** — production eBPF observability shipped as prebuilt agents with CO-RE; proof that "eBPF without kernel headers" is the shipping reality on modern distros (Arch/Ubuntu BTF: present; Debian: check).
- **Aya + aya-build** — the Rust eBPF toolchain decided for L4 (§D6.4); runs eBPF from the same process as the helper, compiles at package-build time.
- **WirePlumber monitor modules** (already line 3) — the event-source pattern for our uevent subscriber: register interest → get callback → act narrowly.
- **systemd as the supervised substrate** — `org.freedesktop.systemd1` + journald are the "managed OS" backbone; eBPF is eyes, systemd is hands, polkit is the bouncer (§D7).

---

## K. Source URLs

- D-Bus daemon man page (policy, eavesdrop, BecomeMonitor context, service dirs): https://dbus.freedesktop.org/doc/dbus-daemon.1.html
- D-Bus specification 0.43 (monitoring interface, `BecomeMonitor`, eavesdrop deprecation, `arg0path` matching): https://dbus.freedesktop.org/doc/dbus-specification.html
- D-Bus home / project (spec + reference impl): https://www.freedesktop.org/wiki/Software/dbus/
- systemd unit/exec semantics (user units, hardening directives referenced): https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html and https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html
- `org.freedesktop.login1(5)` (Manager/Session signals, LockedHint, Inhibit, polkit actions for logind): https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.login1.html
- XDG Desktop Portal docs (Screenshot, ScreenCast, GlobalShortcuts, Inhibit, NetworkMonitor, PowerProfileMonitor, Background, GlobalShortcuts backends): https://flatpak.github.io/xdg-desktop-portal/docs/
- AT-SPI2 (at-spi2-core; interfaces, `org.a11y.Bus`, password-text role, registry daemon): https://gitlab.gnome.org/GNOME/at-spi2-core (mirror: https://github.com/GNOME/at-spi2-core) — libatspi docs: https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi
- fanotify(7) — permission events require CAP_SYS_ADMIN: https://man7.org/linux/man-pages/man7/fanotify.7.html
- polkit(8) — actions, `.policy` files, no-rules-in-apps rule, `auth_admin` vocabulary: https://www.freedesktop.org/software/polkit/docs/latest/polkit.8.html
- eBPF / Aya (`aya`, `aya-build`; pure-Rust eBPF decided for L4, D6.4): https://aya-rs.dev/docs/ and https://github.com/aya-rs/aya
- Linux BPF docs (capability split ≥5.8; `unprivileged_bpf_disabled=2` observed on this workstation 2026-11-12; BPF is not blocked by Secure Boot lockdown): https://docs.kernel.org/bpf/index.html and https://docs.kernel.org/admin-guide/sysctl/kernel.html#unprivileged-bpf-disabled
- `bpf(2)` — raw tracepoint constraints, CAP_SYS_ADMIN history on older kernels: https://man7.org/linux/man-pages/man2/bpf.2.html
- libbpf / CO-RE (fallback if a future stream needs struct-offset relocation; not needed for v1 streams): https://docs.kernel.org/bpf/bpf_design_QA.html
- UPower reference (device/on-battery API; readable without auth): https://upower.freedesktop.org/docs/UPower.html
- NetworkManager D-Bus API (state/connectivity; action auth via polkit): https://networkmanager.dev/docs/api/latest/
- MPRIS (Media Player D-Bus Interface): https://specifications.freedesktop.org/mpris-spec/latest/
- XDG Base Directory spec (servicedirs for D-Bus activation): https://specifications.freedesktop.org/basedir-spec/latest/
- Repo-local: `apps/airi-qt/packaging/build-deb.sh`, `packaging/README.md`, `docs/phase-notes/p12-cutover-plan.md`, `p9-lane-screen-capture.md`, `p9-lane-acp-hitl.md`, `p11-lane-hearing.md`, `p8-tray-hotkeys.md`, `p7-memory-journal.md`, `README.md` (single-instance lock, platform notes), `PRIVACY.md`, `crates/airi-channel/src/lib.rs`, `crates/airi-qt/src/bridges/{desktop.rs,capture.rs,hearing.rs}`, `packaging/build-deb.sh`.

## NOT recommended (explicit)

| Item | Why not |
|---|---|
| Single root daemon (c) | Other users' data in trust domain; no capability gain over (b); consent impossible on shared machines |
| `CAP_SYS_ADMIN` for the helper | Far bigger hammer than any approved feature; eBPF splits off with `CAP_BPF`/`CAP_PERFMON`; fanotify-perm is a veto power AIRI must not have |
| eBPF uprobes / kprobes on security functions | Memory-harvest grade; non-goal permanently |
| eBPF for unit-failure detection | Wrong tool — `org.freedesktop.systemd1` signals + journald match are structured, redacted, exact (§D6.2) |
| eBPF network payload / DNS-answer / SNI capture | 5-tuple + counters is the ceiling; addresses are not a browsing history (§D6.2) |
| BCC / runtime-LLVM eBPF in the dev package | Huge dependency, runtime compile attack surface; Aya compiles at package time (§D6.4) |
| L4 armed at boot or "disarm but leave loaded" | Arm is per-session, explicit; disarm = programs detached and maps closed, verified by negotiated-ladder readback (T12) |
| evdev/joydev/libinput-debug for "mood" | Keylogger; hard non-goal |
| `org.freedesktop.secrets` reads | Credentials never; ours only to *store*, and only via OS keyring with explicit user action |
| Monitor/eavesdrop as a *default* | Session bus is same-UID-readable already; retaining traffic ambiently is a choice, never a default |
| KWin scripting / `org.gnome.Shell.Eval` as core eyes | Version-fragile, sandbox-limited, breaks per DE release |
| Shipping polkit `.rules` in the package | polkit docs: applications never ship rules; sysadmin's prerogative |
| Helper with network access | Architecturally impossible in recommended design (`RestrictAddressFamilies=AF_UNIX AF_NETLINK`) |
| Root daemon "just for RAPL" | sysfs read behind one `CAP_DAC_READ_SEARCH`, not a root era |
| Blanket `own="*"` or monitor-grant policy files | Violates "policy narrows, never widens" (§B6) |
| Silent helper enablement | §E4: dry-run + checkbox + pkexec + indicator + reversible; no silent root anywhere |
| Root/helper watching lock state by polling | Unlock must re-arm; disarm is event-driven from logind; no polling loops in the helper |

---

**Bottom line.** AIRI daemonizes as a user service first: same-UID, session-scoped, D-Bus-native,
AT-SPI for screen eyes, portals/PipeWire for capture and audio, ACP-style HITL for actions, tray
kill switch and lockdown for consent. Sudo mode — approved 2026-11-12 — ships as an optional,
reversible, root-*adjacent* helper (`airi-system`) carrying exactly `CAP_BPF CAP_PERFMON` and
machine-level event delivery; it never touches the session, the home directory, the network, or
other users' data, and the single-user machine is its honest target. The north star is a ladder,
not a switch: L1 (observe) → L2 (prompt per action) → L3 (you write the rules, she runs them,
audited) → L4 (eBPF audit, opt-in, never default). Posture (c) is rejected; (a) is the default;
(b) is the opt-in the lead asked for. First milestone is Phase 1; sudo mode is P4b; L3 standing
rules are P4c; L4 eBPF is P5 — designed in §D6 precisely so it can be shipped, armed, and
disarmed with a clean conscience. §I wants your calls on 19 points — the checklist there is
the whole game.
