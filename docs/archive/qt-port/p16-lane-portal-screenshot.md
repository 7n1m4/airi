# P3a — Lane `portal-screenshot`: XDG portal screenshot for the Qt capture page

Wave P3 (portals & PipeWire), first slice. Additive-only edits to three files;
nothing else in the tree was touched. All conclusions below are verified
against this machine unless explicitly marked otherwise.

## Scope correction (path)

The lane brief guessed the page at
`qml/pages/settings/modules/capture/ScreenCapturePage.qml` — **that path does
not exist** in this tree. The actual and only ScreenCapturePage is
`apps/airi-qt/qml/pages/devtools/screen-capture/ScreenCapturePage.qml`
(a devtools page). That file was edited, additive only.

## What was added

### Bridge (`crates/airi-qt/src/bridges/capture.rs`)

`CaptureController` grew three qproperties and one qinvokable — nothing
existing was restructured:

- `portalAvailable` (bool, `portalAvailable`) — probed at construction and at
  every `refreshCaptures()`. Defaults to false before the first probe.
- `portalStatus` (QString, raw English, always `portal: …`-prefixed) —
  one-liner: `portal: available (Screenshot version 2)` /
  `portal: unavailable (no name owner)` / `portal: unavailable (…)` /
  `portal: waiting for consent…` / `portal: saved capture-<ms>.png` /
  `portal: <reason>`.
- `portalBusy` (bool) — true while a portal capture is in flight.
- `captureViaPortal() -> bool` — returns `true` only when the worker thread
  was spawned. Returns `false` (and says why in `portalStatus`) when the
  portal is unavailable, a capture is already in flight, smoke mode is
  active, or the captures directory cannot be resolved. Never auto-called —
  the page button is the only trigger in the app.
- `portalChanged()` signal — emitted after any probe/outcome change (from
  `refreshCaptures()`/`captureViaPortal()`).

Shared state: `PortalShared` in an `Arc<Mutex<…>>` behind a `OnceLock`,
mirroring the `discord_gateway.rs` worker idiom (poison-tolerant lock,
ephemeral worker, outcome merged on the next `refreshCaptures()`). The worker
thread never touches a QObject. `refreshCaptures()` additionally re-probes
the portal and drains any pending outcome into the qproperties; a finished
capture also lands in `capturesJson` because the scan picks up
`capture-<digits>.png` — the JSON shape is unchanged (existing consumers see
no format change).

### The portal roundtrip, as implemented

Contract verified against the installed interface XMLs
(`/usr/share/dbus-1/interfaces/org.freedesktop.portal.Screenshot.xml`,
`org.freedesktop.portal.Request.xml`) and by live read-only introspection on
this machine:

1. New **blocking** session-bus connection (`Connection::new_session()`),
   never the GUI thread's connection. 800 ms timeout on the method calls.
2. Pass `handle_token` (`airi_capture_<pid>_<epoch_ms>`, a valid object-path
   element) in `options: a{sv}`. The request path is then predictable:
   `/org/freedesktop/portal/desktop/request/<sender>/<token>` where `<sender>`
   is the unique name with leading `:` stripped and `.`→`_`.
3. Subscribe to `org.freedesktop.portal.Request::Response` **before** the
   call (the race avoidance the `org.freedesktop.portal.Request` docs
   recommend). The match rule has **no path filter**: the connection is
   private to this capture, so any `Response` on it is ours; the one-shot
   callback records `(response: u, results: a{sv})` and auto-removes itself.
4. Call `org.freedesktop.portal.Desktop` at `/org/freedesktop/portal/desktop`,
   interface `org.freedesktop.portal.Screenshot`, method `Screenshot`,
   args `(parent_window: "", options: a{sv} = {handle_token: s})`. Reply
   carries the request object path `o`. If the returned handle differs from
   the expected one (old portal), a warning is logged — the unfiltered
   subscription still catches the Response.
5. Wait for `Response(response: u, results: a{sv})` with an **8 s deadline**
   (`conn.process(100 ms)` poll). Timeout → best-effort `Close()` on the
   request path and an honest `portal: no response after 8 s — cancelled…`
   error. `response == 1` → cancelled; `>= 2` → failed.
6. On `response == 0`, read `results["uri"]` (`s`), convert to a path
   (percent-decoded, see below), move the file into the captures directory as
   `capture-<epoch_ms>.png` (refuses overwrite by bumping the ms), never
   reading/decoding the image.
7. Record the outcome in `PortalShared`; `refreshCaptures()` merges it into
   `portalStatus` (+ `lastError` on failure) and re-emits `capturesChanged`.

Detail notes:

- The **move** is `fs::rename` first; on any failure it falls back to
  `fs::copy` + `fs::remove_file` of *the portal's own temp file we just
  copied*. Portal temp files land on `$XDG_RUNTIME_DIR` (tmpfs) while the
  captures dir lives on the data filesystem, so rename can legitimately fail
  across the boundary. No other file is ever removed — `clearCaptures()`
  semantics are untouched, and the portal temp file is the only deletion on
  this path (see "Deviations").
- `uri_to_path` percent-decodes each path segment, requires a `file://`
  scheme and either an empty or `localhost` authority, and rejects
  trailing-slash directories, the root path, invalid percent-escapes and
  invalid UTF-8. Unix-oriented by design (the app targets Linux/BSD desktop
  portals; Windows drive letters are out of scope).
- Smoke mode: `captureViaPortal()` returns `false` with
  `portal: suppressed in smoke mode` and **never opens the portal**. The
  hidden `live_portal_probe_prints_result` unit test is `#[ignore]`d so the
  normal test suite and smoke never touch dbus; it was run once by hand.

### Page (`qml/pages/devtools/screen-capture/ScreenCapturePage.qml`)

Additive only; the X11 ("Capture Screen") button and its label are untouched:

- New `AButton` "Capture via portal (Wayland)" next to the X11 button.
  Enabled iff `portalAvailable && !portalBusy`; while in flight it shows the
  busy label (`shell.capture.portal.busy`) and is disabled.
- `Timer portalPoll` (500 ms) restarts when a capture starts and drives
  `refreshCaptures()` until `portalBusy` clears (the X11 path refreshes
  synchronously; this is its async analogue). The captures list updates
  through the existing `onCapturesChanged → syncFromBridge()` path — no new
  consumer of `capturesJson`.
- New status/warning lines: `portalStatus` one-liner (secondary), a
  "waiting for consent" hint (only while `portalBusy`), and — only when the
  portal is unavailable — the honest caption
  `shell.capture.portal.unavailable` plus `shell.capture.portal.consentNote`
  ("the portal path asks for your consent in a system dialog each time —
  by design").

### Not touched (as required)

`build.rs`, `bridges/mod.rs`, the C++ shim, locales, `Cargo.toml`,
`MainShell.qml`, `SettingsWindow.qml`, no git writes, no new dependencies
(`dbus`, `dirs`, `serde_json` were already in the workspace).

## Deviations from the lane brief (read this first)

1. **`{handle_options → empty dict}` is not a portal option key.** The brief
   asked for `options: a{sv} = {handle_options → empty dict}`. The installed
   `org.freedesktop.portal.Screenshot.xml` documents only `handle_token`
   (`s`), `modal` (`b`), `interactive` (`b`, since v2) and `target` (`u`,
   since v3); a grep of every interface XML in `/usr/share/dbus-1/interfaces/`
   finds no `handle_options` anywhere. Passing an unknown key would not be a
   contract violation per se (unknown options are ignored), but inventing
   one was not necessary and would have forfeited the race-free
   subscribe-before-call pattern the `org.freedesktop.portal.Request` spec
   explicitly recommends. Implemented instead: `handle_token` + subscription
   before the call (documented in the code and above). The `Screenshot`
   signature itself — `(s parent_window, a{sv} options) -> o handle` — is
   exactly as the brief and the contract both specify (empty `parent_window`
   is valid). Flagging per the "STOP and report" rail: this was a one-key
   contract-conformance deviation, not a workaround for a signature
   mismatch — no KDE/GNOME difference was implicated. Happy to switch to a
   bare empty options dict (`{}`) if the consent-gated live run shows any
   issue with `handle_token`.
2. **Live click was not performed** (explicitly the user's gate; the
   verification section of the brief says probe + unit tests + code reading,
   no dialog). Nothing in this lane opens the portal except the page button.
3. **`move_file` falls back to copy+remove** when rename fails (see above).
   The removed file is always the portal's own temp file that we just copied
   byte-for-byte; it is the only file ever deleted on the portal path.
4. **Smoke was not re-run** (central gate). The portal path is unreachable
   in smoke (`captureViaPortal()` refuses early; `cargo test` never calls
   dbus), and the probe in `Default::default()` is the same class of
   read-only call the smoke tour may make by policy.

## Probe evidence (this machine, 2026-11-12)

`cargo test -p airi-qt live_portal_probe -- --ignored --nocapture`:

```
portal probe: available=true status=portal: available (Screenshot version 2)
test bridges::capture::tests::live_portal_probe_prints_result ... ok
```

Read-only D-Bus inspection (`gdbus`, no dialog, no `Screenshot`):

- `org.freedesktop.Portal.Desktop` name owner: **`:1.14`** (active;
  `gdbus … NameHasOwner org.freedesktop.portal.Desktop` → `(true,)`;
  `GetNameOwner` → `(':1.14',)`).
- `org.freedesktop.DBus.Properties.Get … Screenshot version` → **`<uint32 2>`**;
  `GetAll` → `{ 'AvailableTargets': <uint32 0>, 'version': <uint32 2> }`.
- Which backend serves it: **Hyprland** —
  `org.freedesktop.impl.portal.desktop.hyprland` (`:1.29`) implements
  `org.freedesktop.impl.portal.Screenshot` (impl `version = 2`); the GTK
  backend (`org.freedesktop.impl.portal.desktop.gtk`, `:1.22`) does **not**
  (its introspection has no `impl.portal.Screenshot`).
  `hyprland-portals.conf` confirms `default=hyprland;gtk` with
  `Interfaces=org.freedesktop.impl.portal.Screenshot;…`.
- The frontend is xdg-desktop-portal (`xdg-desktop-portal` process owning
  `:1.14`), documented version 3 XML but reporting `version = 2` for the
  Screenshot interface — the GTK-style "value ≥ documented" contract.
- `AvailableTargets = 0` (no targets advertised — v2 behavior; `target` is a
  v3 key, so we do not pass it).

The probe in the bridge itself does exactly two calls:
`NameHasOwner` + `Properties.Get(version)`. Reported here honestly: the
"which backend" attribution comes from the impl-backend introspection above,
not from the bridge (the desktop-portal frontend deliberately does not say
which backend it routed to).

## Verification

| Check | Result |
|---|---|
| `cargo test -p airi-qt` | **86 passed, 0 failed** (69 pre-existing + 17 new), 1 ignored (`live_portal_probe`) |
| `cargo test --workspace` | **52 suites, 768 passed** (751 baseline + 17 new) |
| `cargo clippy -p airi-qt --all-targets -- -D warnings` | clean |
| `cargo fmt -p airi-qt -- --check` | clean |
| `qmllint -I <module sandbox> ScreenCapturePage.qml` | exit 0; 4 warnings, all the pre-existing `Unqualified access [unqualified]` `page.*`-in-inline-component class (p9-documented idiom); none from the new lines |
| Live portal probe (bridge fn, `--ignored` test) | `available=true, portal: available (Screenshot version 2)` |
| Live consent dialog / `Screenshot` call | **not performed** — user's gate |
| `--smoke` / app launch | **not run** — central gates |

The module sandbox for qmllint was `/tmp/opencode/qmllint-portal/com/airi/airiqt/`
(copy of `qml/` + the cxx-qt-generated `qmldir`/`plugin.qmltypes` from the
16:10 build, which already lists the new portal surface); nothing was
committed. The brief warned the build sandbox files land in the repo target
dir — the sandbox was built under `/tmp/opencode` and the generated files
were only *copied* there, never edited in place.

### Unit tests added (in-crate, `capture.rs`)

17 tests + 1 `#[ignore]`d live probe:

- `uri_to_path`: plain `file:///`, `%20`, `%C3%B6` (ö), mixed escapes,
  `localhost` authority, non-file schemes rejected, bad authorities/relative
  rejected, trailing slash + root rejected, invalid percent-escapes and
  invalid UTF-8 rejected.
- `unique_capture_path`: collision bump (`capture-<ms>` taken → `<ms+2>`),
  free name uses the requested ms.
- `portal_probe_status`: bus error / no name owner / available with version /
  version-lookup failure (pure mapping, no dbus).
- `try_begin_capture` / `finish_portal_capture` / `drain_portal_outcome`:
  busy/available gate transitions with an injected fake worker result
  (refuses when unavailable / when in flight; begin→finish flips flags and
  records the outcome; drain is one-shot).

Not unit-tested (per the brief): the portal dialog itself, the live dbus
roundtrip, and the move/copy file path (covered implicitly by manual review;
a synthetic end-to-end would need a fake portal on a private socket —
explicitly out of scope for this slice).

## i18n keys to add — namespace `shell.capture.portal.*`

**Locales were not edited.** Keys nest under the existing `capture:` map in
`packages/i18n/src/locales/*/shell.yaml` (flattened `shell.capture.portal.*`):

```yaml
capture:
  portal:
    button: 'Capture via portal (Wayland)'
    busy: 'Waiting for consent…'
    pendingHint: 'The portal opens a system consent dialog. Approve it to save the shot — it asks every time, by design.'
    unavailable: 'Portal unavailable on this desktop — screenshots via X11 only.'
    consentNote: 'The portal path asks for your consent (a system dialog) each time — that is by design, not a bug.'
```

All flat keys: `shell.capture.portal.button`, `shell.capture.portal.busy`,
`shell.capture.portal.pendingHint`, `shell.capture.portal.unavailable`,
`shell.capture.portal.consentNote`. Until the keys land, `I18n.tr` returns
the key itself (missing keys echo), so the page shows raw key strings — expected.
The X11 button's generic label (`shell.capture.captureButton` = 'Capture
Screen') was left untouched per the brief; if central wants honest X11
branding, that would be a rename/new key — not done here.

## Integration points

- QML → bridge: `CaptureController.captureViaPortal()` / `portalAvailable` /
  `portalBusy` / `portalStatus`; the page's existing `onCapturesChanged`
  sync is unchanged.
- Bridge → filesystem: `<profile>/captures/` (or `<data>/airi-qt/captures/`),
  same `capture-<epoch_ms>.png` convention as the X11 path; listed by the
  same `scan_captures()` and deletable by the same `clearCaptures()`.
- Smoke rail: `capture_via_portal()` early-returns under `--smoke`; the
  smoke tour never sees a dialog or a portal call.
- No MainShell/SettingsWindow wiring needed (the page is already reachable
  in the devtools tree).

## Honestly unverified

- No live consent dialog has ever been answered by this code path (user's
  gate). Everything about the interaction with the Hyprland backend after
  the button press — dialog shown, `Response` signal shape, the `uri`
  result, whether the portal temp file lives on a filesystem that forces the
  copy+remove fallback, and whether consent is remembered — is
  contract-based reading and code review, not observation.
- The timeout→`Close()` path is implemented but never exercised live.
- `hyprland` backend attribution relies on external introspection, not on the
  portal's self-description.
- Availability probe says nothing about whether the compositor will actually
  grant the screenshot once the user consents (out of scope here).

## Not-done list (explicit)

- No region/selection mode — the portal does full-screen only on v2
  (`AvailableTargets = 0` anyway; `target` is v3).
- No ScreenCast stream — a future wave.
- No GlobalShortcuts binding — a future wave.
- No ambient PipeWire audio — a future wave.
- No auto-consent, no remember-this-choice handling (the portal does not
  offer one for Screenshot), no `interactive: true` option (default off;
  consent dialog is what it is).
- No `modal` option passed (Hyprland/GTK default modal behavior is
  acceptable; not part of the brief).
- No clippy/fmt/QML-lint of the real build beyond what is listed; no
  `--smoke` re-run; no locale edits; no commit (left in the working tree).

