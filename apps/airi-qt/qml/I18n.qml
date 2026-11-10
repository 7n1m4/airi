// SPDX-License-Identifier: GPL-3.0-or-later
// I18n singleton: QML entry point for translations.
// Backed by the `I18nBridge` Rust QObject (`airi_i18n` embedded locale data).
// `tr(key)` reads the singleton's `locale` property inside the call so QML
// bindings that depend on a translation re-evaluate on locale change.
import QtQuick 2.15
import com.airi.airiqt 1.0

pragma Singleton

QtObject {
    id: root

    property I18nBridge bridge: I18nBridge {}

    property string locale: bridge.locale
    readonly property var cycleLocales: ["en", "es", "fr", "ja", "zh-Hans"]

    function tr(key) {
        var current = locale
        return bridge.tr(current, key)
    }

    // Advance to the next supported UI language and persist the choice.
    function cycleLocale() {
        var index = cycleLocales.indexOf(locale)
        var next = cycleLocales[(index + 1) % cycleLocales.length]
        locale = next
        bridge.locale = next
        bridge.persistLocale()
        console.log("[airi-qt] i18n: locale switched to", next)
    }
}
