// SPDX-License-Identifier: GPL-3.0-or-later
// Hearing (microphone) module — settings for the local speech-to-text
// ("hearing") pipeline. Wired to the `HearingController` bridge
// (crates/airi-qt/src/bridges/hearing.rs), which persists **user intent
// only** under the `settings/hearing` blob (enabled, pttMode, hotkey,
// deviceName). What WORKS in this slice: every control persists — the
// enable switch, the Auto/PTT listening mode, the push-to-talk hotkey text
// and (when devices are enumerable) the input device selection. What does
// NOT work yet, by design and on the record: (1) no microphone capture, no
// VAD loop, no input level meter — airi-stt ships `capture.rs`/`vad.rs`/
// `mic.rs`, but nothing pumps audio into chat in this Qt build; (2) no
// global hotkey registration — the hotkey is stored verbatim, unregistered;
// (3) no input-device enumeration — airi-stt exposes no public device list
// (its only public device path, `AudioCapture::start`, opens the mic), so
// `devicesJson` is always `[]` and the device card renders an honest empty
// state instead of a fake list. Nothing on this page implies the mic is
// live. Structural source: packages/stage-pages/src/pages/settings/
// modules/hearing.vue (enable toggle, VAD/manual detection mode, hotkey
// Scroll/Caps/Num with default Scroll, audio input device selection).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    // Parsed view of the bridge's `devicesJson` (always a JSON array).
    property var devices: []
    property string saveError: ""

    readonly property int deviceIndex: page.devices.indexOf(controller.deviceName)

    HearingController {
        id: controller
    }

    Connections {
        target: controller

        function onStateChanged() {
            page.reloadDevices()
        }
    }

    function reloadDevices() {
        var parsed = []
        try {
            parsed = JSON.parse(controller.devicesJson)
        } catch (e) {
            console.log("[airi-qt] hearing: failed to parse devicesJson:", e)
            parsed = []
        }
        page.devices = Array.isArray(parsed) ? parsed : []
    }

    function applyResult(ok) {
        page.saveError = ok ? "" : I18n.tr("shell.hearing.saveError")
    }

    Component.onCompleted: {
        controller.refresh()
        page.reloadDevices()
        hotkeyField.text = controller.hotkey
    }

    Flickable {
        id: flickable
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.y + column.implicitHeight + Theme.spacingL
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        ColumnLayout {
            id: column
            x: Theme.spacingL
            y: Theme.spacingL
            width: flickable.width - 2 * Theme.spacingL
            spacing: Theme.spacingM

            // ── Header ───────────────────────────────────────────────────
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                Text {
                    Layout.fillWidth: true
                    text: I18n.tr("shell.hearing.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "warning"
                    text: I18n.tr("shell.hearing.badge")
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 640
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.hearing.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // ══ Enable ═════════════════════════════════════════════════════
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.hearing.enable.title")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        ASwitch {
                            id: enableSwitch
                            checked: controller.enabled
                            onToggled: page.applyResult(controller.setEnabled(checked))
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.hearing.enable.caption")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        color: Theme.textSecondary
                    }
                }
            }

            // ══ Listening mode ═════════════════════════════════════════════
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    Text {
                        text: I18n.tr("shell.hearing.mode.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.hearing.mode.caption")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        color: Theme.textSecondary
                    }

                    AToggleGroup {
                        id: modeGroup
                        Layout.fillWidth: true
                        model: [
                            I18n.tr("shell.hearing.mode.auto"),
                            I18n.tr("shell.hearing.mode.ptt")
                        ]
                        currentIndex: controller.pttMode ? 1 : 0

                        onToggled: function (index) { page.applyResult(controller.setPttMode(index === 1)) }
                    }
                }
            }

            // ══ Push-to-talk hotkey ═══════════════════════════════════════
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    Text {
                        text: I18n.tr("shell.hearing.hotkey.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    ATextField {
                        id: hotkeyField
                        Layout.fillWidth: true
                        placeholderText: I18n.tr("shell.hearing.hotkey.placeholder")

                        onEditingFinished: {
                            var ok = controller.setHotkey(text.trim())
                            page.applyResult(ok)
                            if (!ok)
                                hotkeyField.text = controller.hotkey
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.hearing.hotkey.caption")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        color: Theme.textSecondary
                    }
                }
            }

            // ══ Input device ═══════════════════════════════════════════════
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    Text {
                        text: I18n.tr("shell.hearing.device.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.hearing.device.caption")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        color: Theme.textSecondary
                    }

                    // Honest empty state — no fake device list. airi-stt does
                    // not expose a public device enumerator today.
                    AEmptyState {
                        visible: page.devices.length === 0
                        Layout.fillWidth: true
                        implicitHeight: 150
                        icon: "🎤"
                        title: I18n.tr("shell.hearing.device.emptyTitle")
                        subtitle: I18n.tr("shell.hearing.device.emptySubtitle")
                    }

                    RowLayout {
                        visible: page.devices.length > 0
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        ASelect {
                            id: deviceSelect
                            Layout.fillWidth: true
                            model: page.devices
                            currentIndex: page.deviceIndex

                            onActivated: page.applyResult(controller.setDevice(deviceSelect.currentText))
                        }

                        AButton {
                            variant: AButton.Ghost
                            text: I18n.tr("shell.hearing.device.useDefault")
                            enabled: controller.deviceName !== ""
                            onClicked: page.applyResult(controller.setDevice(""))
                        }
                    }
                }
            }

            // ══ Footer warning ═════════════════════════════════════════════
            ACard {
                Layout.fillWidth: true
                borderColor: Theme.warning

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: "⚠"
                        font.pixelSize: 20
                        color: Theme.warning
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.hearing.footerWarning")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // ── Status line ──────────────────────────────────────────────
            Text {
                Layout.fillWidth: true
                text: controller.statusLine
                font.family: Theme.fontBody
                font.pixelSize: 12
                elide: Text.ElideRight
                color: Theme.textSecondary
            }

            Text {
                visible: page.saveError.length > 0
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: page.saveError
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.error
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }
}
