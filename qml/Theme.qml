// SPDX-License-Identifier: GPL-3.0-or-later
import QtQuick 2.15

pragma Singleton

// Theme holds design tokens (colors from OKLCH hue math; spacing/radius/typography).
//
// P0 shipped a dark-only static palette. P2 Wave A extends it, preserving all
// original token names:
//   - `dark` is writable; the whole palette derives from it (light counterpart).
//   - `hue` and `chromaMultiplier` are writable and drive the accent colors.
//   - Use `setDark` / `setHue` / `setChromaMultiplier` (or direct assignment).
//
// Visual note (P2 accepted tradeoff): `bg`/`surface` stay stable per mode;
// only the accent family derives from `hue`. Full OKLCH-to-sRGB pipeline for
// every token lands with the core color work.
QtObject {
    property bool dark: true
    property real hue: 220.44
    property real chromaMultiplier: 1.0

    readonly property real dynamicHue: hue
    readonly property real effectiveChroma: (0.18 + Math.cos(hue * Math.PI / 180) * 0.04) * chromaMultiplier
    readonly property real effectiveSaturation: Math.min(1, 0.45 * chromaMultiplier)

    function setDark(d) { dark = d }
    function setHue(h) { hue = h }
    function setChromaMultiplier(c) { chromaMultiplier = c }

    readonly property color bg: dark ? "#0f1115" : "#f8f9fb"
    readonly property color surface: dark ? "#171a22" : "#ffffff"
    readonly property color surfaceHover: dark ? "#1f2330" : "#f0f2f6"
    readonly property color surfacePressed: dark ? "#252a3a" : "#e2e6ee"
    readonly property color border: dark ? "#2a3040" : "#d9deea"
    readonly property color textPrimary: dark ? "#f2f4f8" : "#1a1d24"
    readonly property color textSecondary: dark ? "#a4adbb" : "#5b6472"

    readonly property color accentContrast: "#ffffff"
    readonly property color accent: Qt.hsla(hue / 360, effectiveSaturation, dark ? 0.52 : 0.45, 1.0)
    readonly property color accentHover: Qt.hsla(hue / 360, effectiveSaturation, dark ? 0.60 : 0.53, 1.0)
    readonly property color accentPressed: Qt.hsla(hue / 360, effectiveSaturation, dark ? 0.42 : 0.36, 1.0)
    readonly property color success: dark ? "#35d27c" : "#0f9d4b"
    readonly property color warning: dark ? "#f5b942" : "#b87100"
    readonly property color error: dark ? "#ff6b6b" : "#c62e2e"
    readonly property color info: dark ? "#6ab0ff" : "#1f6fd1"

    readonly property int radiusS: 6
    readonly property int radiusM: 10
    readonly property int radiusL: 16
    readonly property int spacingS: 8
    readonly property int spacingM: 12
    readonly property int spacingL: 20
    readonly property string fontBody: "Inter"
    readonly property string fontTitle: "Inter"
}
