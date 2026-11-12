// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <QString>

// Screen capture shim, bound from the Rust `capture` bridge via cxx-qt
// (`include!("airi-qt/src/cpp/capture_item.h")`).
//
// `airi_capture_primary_screen` creates `outDir` recursively, grabs the
// primary screen (`QScreen::grabWindow(0)` — the whole screen, not a window),
// saves it as `capture-<millis>.png` (`QDateTime::currentMSecsSinceEpoch`)
// and returns the absolute path of the new PNG.
//
// Single error channel: on any failure the function returns an empty
// QString; the detailed reason is printed to stderr with the
// [airi-qt][capture] prefix (same style as airi_qt_bridge.cpp). The Rust
// bridge maps the empty return onto `lastError`.
//
// Wayland note: `QScreen::grabWindow` is not supported there — the
// compositor denies the grab and Qt returns a null pixmap, which this
// function reports through the same empty-string channel. X11 works.
QString airi_capture_primary_screen(const QString &outDir);
