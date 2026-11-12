<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P16 Wave P3 (slice 1) — portal screenshot (user direction 2026-11-13: "continue")

P3 from the research doc (portals & PipeWire) begins with the Wayland capture
gap. The X11 shim stays untouched; the portal path is opt-in per press.

**What landed** (Lane P3a; additive only):
`CaptureController` gains `portalAvailable` / `portalStatus` / `portalBusy`
qproperties, `captureViaPortal()`, a `portalChanged()` signal, and a
`refreshCaptures()` merge that leaves `capturesJson` byte-compatible with the
X11 path's output. The worker thread (mirrors the discord_gateway idiom) runs
the full portal roundtrip OFF the Qt thread: session-bus connection →
`Screenshot("", a{sv}{handle_token})` on `/org/freedesktop/portal/desktop` →
receives `org.freedesktop.portal.Request::Response` on the returned request
path (with `handle_token` correlation — the portal interfaces XML has no
`handle_options` key; that deviation is flagged in the lane note and is the
portal's own documented pattern) → `{uri}` percent-decode → move the temp PNG
into `<captures>/capture-<ms>.png`. 8 s deadline; timeout → typed cancel path
(never exercised with a live click). The consent dialog is the product: nothing
captures without the human pressing the button.

**Page**: Screen Capture (`qml/pages/devtools/screen-capture/ScreenCapturePage.qml`
— a devtools page, a Qt original, not an Electron port) gains
"Capture via portal (Wayland)" — enabled only when `portalAvailable &&
!portalBusy`, with pending/unavailable/consent-asks-every-time captions.
i18n: 5 `shell.capture.portal.*` keys ×10 locales (parity 4/4, audit ×10).

**Live probe (read-only, this machine)**: `available=true, portal: available
(Screenshot version 2)`; portal owner `:1.14`; Hyprland impl serves
Screenshot v2 (GTK does not).

**Honest limits**: no live consent click ever performed (path verified to the
method call only, human gate); `--smoke` untouched by construction
(smoke never triggers the portal; refuses early); no ScreenCast stream, no
GlobalShortcuts portal, no ambient PipeWire audio — all future waves; full
screen only (portal limitation); no region selection; no auto-consent.

**Gate**: fmt/clippy `-D warnings` clean · **768 tests green (52 suites)** ·
offscreen `--smoke` exit 0 · i18n parity 4/4 · audit ×10.
