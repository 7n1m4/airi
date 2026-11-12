#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Dev-only .deb assembler for airi-slint (user decision 2026-11-12: "dev release
# for now" — nothing here is a production release or suitable for distribution).
#
# Builds a `airi-slint-dev` package from the local cargo target dir:
#   1. `cargo build -p airi-slint` (debug — fast; a dev artifact is allowed to be fat).
#      Pass --release to package a release binary instead.
#   2. Stages the Debian layout (DEBIAN/control + /usr/bin, /usr/share/applications,
#      /usr/share/icons/hicolor/512x512/apps, /usr/share/doc/airi-slint-dev).
#   3. Assembles the .deb AR archive by hand when dpkg-deb is absent
#      (ar(1) + tar(1) — deterministic, no new dependencies).
#
# Output: <repo>/dist/airi-slint-dev_<version>_amd64.deb
# The dist/ directory is gitignored — build artifacts are never committed.
#
# NOTE: dependency versions below are approximate for a dev package.
# A CI/release job must regenerate them with dpkg-shlibdeps once a real
# release pipeline exists (see packaging/README.md "What is NOT done yet").
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
PROFILE="debug"
[ "${1:-}" = "--release" ] && PROFILE="release"
VERSION="0.1.0~dev1"
PKG="airi-slint-dev"
OUT="$ROOT/dist/${PKG}_${VERSION}_amd64.deb"
STAGE="$ROOT/dist/${PKG}_${VERSION}_amd64"
BIN="$ROOT/target/${PROFILE}/airi-slint"

echo "==> building airi-slint (${PROFILE})"
cargo build -p airi-slint ${PROFILE:+$([ "$PROFILE" = release ] && echo --release)}

echo "==> staging package tree"
rm -rf "$STAGE"
mkdir -p \
  "$STAGE/DEBIAN" \
  "$STAGE/usr/bin" \
  "$STAGE/usr/share/applications" \
  "$STAGE/usr/share/icons/hicolor/512x512/apps" \
  "$STAGE/usr/share/doc/${PKG}"

install -m 0755 "$BIN" "$STAGE/usr/bin/airi-slint"
install -m 0644 "$ROOT/packaging/airi-slint.desktop" "$STAGE/usr/share/applications/airi-slint.desktop"
install -m 0644 "$ROOT/packaging/airi-slint.png"     "$STAGE/usr/share/icons/hicolor/512x512/apps/airi-slint.png"
install -m 0644 "$ROOT/packaging/LICENSE.txt"      "$STAGE/usr/share/doc/${PKG}/copyright"
cat > "$STAGE/usr/share/doc/${PKG}/changelog" <<EOF2
${PKG} (${VERSION}) unstable; urgency=low

  * Development snapshot build of the AIRI Slint rewrite (wip/airi-slint-rewrite).
    Not a release. See docs/phase-notes/p12-cutover-plan.md.

 -- AIRI developers <noreply@moeru.ai>  $(date -Ru)
EOF2
gzip -9n "$STAGE/usr/share/doc/${PKG}/changelog"

cat > "$STAGE/DEBIAN/control" <<EOF2
Package: ${PKG}
Version: ${VERSION}
Architecture: amd64
Maintainer: AIRI developers <noreply@moeru.ai>
Section: utils
Priority: optional
Depends: libc6, libstdc++6, libgcc-s1, libglib2.0-0t64 | libglib2.0-0, libfontconfig1, libfreetype6, libpng16-16t64 | libpng16-16, libgl1, libegl1, libxkbcommon0,
Recommends: ffmpeg
Description: AIRI VTuber companion (Slint development build)
 AIRI — Decentralized AI-based VTuber companion. This package is a
 DEVELOPMENT BUILD from the wip/airi-slint-rewrite branch. It is not a
 production release, is not signed, receives no updates, and ships no
 auto-update feed. Electron/web remains the primary desktop product
 until the user flips the cutover recommendation (see
docs/phase-notes/p12-cutover-plan.md).
Homepage: https://github.com/anlmalabs/airi
EOF2
echo "installed-size: $(du -sk "$STAGE/usr" | cut -f1) KB" >> "$STAGE/DEBIAN/control"

if command -v dpkg-deb >/dev/null 2>&1; then
  echo "==> dpkg-deb present — using it"
  mkdir -p "$ROOT/dist"
  dpkg-deb --root-owner-group --build "$STAGE" "$OUT"
  dpkg-deb --info "$OUT"
else
  echo "==> dpkg-deb absent — assembling AR archive by hand (dev path, untested on Debian)"
  mkdir -p "$ROOT/dist"
  TMPDIR_AR="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR_AR"' EXIT
  # debian-binary
  printf '2.0\n' > "$TMPDIR_AR/debian-binary"
  # control.tar.xz (root:root ownership via --owner=0 --group=0)
  (cd "$STAGE/DEBIAN" && tar --create --xz --owner=0 --group=0 --numeric-owner \
      --file="$TMPDIR_AR/control.tar.xz" .)
  # data.tar.xz
  (cd "$STAGE" && tar --create --xz --owner=0 --group=0 --numeric-owner \
      --exclude=./DEBIAN --file="$TMPDIR_AR/data.tar.xz" .)
  ( cd "$TMPDIR_AR" && ar rcs "$OUT" debian-binary control.tar.xz data.tar.xz )
fi

echo "==> built: $OUT"
ls -lh "$OUT"
