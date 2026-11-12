<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Packaging & the dev-release posture

Status: **dev release only** (user decision 2026-11-12 — "dev release for now").
Nothing in this directory ships a production package. Nothing is signed, no
update feed exists for airi-slint, and no tag has been cut. Electron/web remains
the primary desktop product; the Slint app is the preview line
(`wip/airi-slint-rewrite`).

## What this is

- `build-deb.sh` — assembles `airi-slint-dev_0.1.0~dev1_amd64.deb` from the local
  cargo target dir:
  1. `cargo build -p airi-slint` (debug by default — a dev artifact may be fat and
     slow to load; `--release` packages an optimized binary instead),
  2. stages the Debian layout (`usr/bin/airi-slint`, desktop entry, icon,
     `usr/share/doc/airi-slint-dev`),
  3. builds the `.deb` with `dpkg-deb` when present, otherwise assembles the
     AR archive by hand (`ar` + `tar` + xz — present on Arch; **untested on
     Debian/Ubuntu**, use it as a last resort, not as the release path),
  4. writes to `dist/` at the repo root (gitignored).

- `airi-slint.desktop` — desktop entry (`AIRI (Slint dev)`, `Exec=airi-slint`).
- `airi-slint.png` — 512×512 icon (the project icon; GPL-3.0-or-later assets).
- `LICENSE.txt` — app license (GPL-3.0-or-later).

## Build it

```sh
./packaging/build-deb.sh            # debug binary
./packaging/build-deb.sh --release  # optimized
```

Output lands in the repo-root `dist/`. QA on a Debian/Ubuntu box that actually
has `dpkg-deb`: `sudo dpkg -i dist/airi-slint-dev_*.deb` and launch from the app
menu. **Install it at your own risk — it is a dev build.**

## Runtime dependencies

The Slint build links the `renderer-software` backend, so there are **no Qt
runtime packages**. The only shared libraries are the ones the Rust crates
already need (fontconfig/freetype for text shaping, libpng via `image`).

`ffmpeg` is needed for screen capture (not a hard dependency of the package —
the app detects and disables capture without it at runtime).

The `Depends:` list in `build-deb.sh` is approximate. A real release job must
generate it with `dpkg-shlibdeps` rather than by hand.

## What is NOT done yet (all deliberate, all blocking any public release)

1. **No CI release job.** Nothing builds/publishes airi-slint packages. The
   Electron `.github/workflows/release-linux-desktop.yml` ships Electron and
   has a fork-name `PRODUCT_NAME: 'airi-dasilva333'` to scrub before reuse.
2. **No update-feed re-point.** `airi_core::update::check_for_update` watches
   the **Electron** release feed (`api.github.com/repos/anlmalabs/airi/releases/latest`).
   It must be pointed at an airi-slint-tagged feed (or exemplary release) only
   when the first airi-slint tag is cut — never before. Check + notify only; unsigned
   self-update stays out of scope.
3. **No tag, no push.** `wip/airi-slint-rewrite` stays local until feature parity
   is user-confirmed (parity = every manifest row resolved, done or waived,
   plus user sign-off on the Electron par-lock — see
   `docs/phase-notes/p12-cutover-plan.md` §7).
4. **No signature, no repo.** Packages are unsigned; no APT channel exists.
5. **Wayland** untested; screen capture and window flags are X11-tested only.

## Uninstall / rollback

```sh
sudo dpkg -r airi-slint-dev   # or sudo pacman -R / remove the extracted files
```

User data lives in the platform data dir (`~/.local/share/airi-slint`); removing
the package does not remove it.

## Dev-run airi-daemon

`airi-daemon` (Phase P1) is the user-session awareness daemon: it owns
`org.moeru.airi.Daemon1` on the session bus, watches five T0 sources
(logind sleep, screensaver lock, MPRIS playback, NetworkManager state,
UPower on-battery), keeps an in-memory ring (cap 200) plus an append-only
audit JSONL (7-day retention, pruned on startup), and answers control RPCs
(`GetStatus`, `SetSource`, `Pause`). It is **not wired into the airi-slint app
yet** — the P1b lane builds the face. Nothing in this directory ships it in
the deb; the steps below are dev-install only.

Build and install from the repo root:

```sh
cargo build -p airi-daemon
cargo install --path crates/airi-daemon --root ~/.local   # lands in ~/.local/bin/airi-daemon
```

Install the user unit and the D-Bus activation file:

```sh
mkdir -p ~/.config/systemd/user ~/.local/share/dbus-1/services
cp packaging/systemd/airi-daemon.service ~/.config/systemd/user/
cp packaging/dbus/org.moeru.airi.Daemon1.service ~/.local/share/dbus-1/services/
systemctl --user daemon-reload
systemctl --user start --now airi-daemon
```

Check that it is up and inspect it:

```sh
journalctl --user -u airi-daemon -f           # logs; all lines pre-redacted
busctl --user call org.moeru.airi.Daemon1 /org/moeru/airi/Daemon1 \
  org.moeru.airi.Daemon1 GetStatus            # JSON: protocol/version/paused/sources/...
busctl --user call org.moeru.airi.Daemon1 /org/moeru/airi/Daemon1 \
  org.moeru.airi.Daemon1 Pause b true          # kill switch: disarm all + purge ring
```

Capability probe that claims nothing on the bus and exits 0:

```sh
~/.local/bin/airi-daemon --selftest
```

Notes and honest limits:

- Unit hardening: `ProtectSystem=strict` + `ProtectHome=read-only` with a
  single `ReadWritePaths=%h/.local/share/airi-slint/audit` exception, because
  the audit log lives in the home directory. If you run with a non-default
  `XDG_DATA_HOME`, widen `ReadWritePaths` to match `<data>/airi-slint/audit`
  or the audit log will fail to open (the daemon stays up, just without
  audit). The unit's `%h/.local/share/...` path assumes the default.
- D-Bus activation (`~/.local/share/dbus-1/services/org.moeru.airi.Daemon1.service`)
  starts the daemon on first use of the name; with `Type=dbus` +
  `BusName=` systemd dedups and refuses a second instance. The daemon also
  exits(1) if it cannot own the name.
- Enable at login: `systemctl --user enable airi-daemon`
  (WantedBy=graphical-session.target). `systemctl --user stop airi-daemon`
  and `disable` remove it again — nothing else in this package depends on
  it yet.
- Audit file: `<data>/airi-slint/audit/awareness-audit.jsonl` (default
  `~/.local/share/airi-slint/audit/awareness-audit.jsonl`), append-only,
  7-day retention, pruned at every startup.
- No network is used; `RestrictAddressFamilies=AF_UNIX` in the unit enforces
  that even against bugs.
