// SPDX-License-Identifier: GPL-3.0-or-later
// Audio device settings page: input enable and the selected input/output
// device ids. Device enumeration is not exposed to QML yet, so the device
// ids are pasted as text (e.g. a Pulse/PipeWire source name from
// `pactl list sources short`). Persists through the
// AudioDeviceSettingsController bridge (settings/audio-device).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    AudioDeviceSettingsController {
        id: audioCtl
    }

    property string saveError: ""

    function save() {
        var ok = audioCtl.save(inputField.text, outputField.text, inputEnabledSwitch.checked)
        page.saveError = ok ? "" : I18n.tr("shell.audio.saveError")
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

            Text {
                text: I18n.tr("shell.settings.nav.voice")
                font.family: Theme.fontTitle
                font.pixelSize: 22
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 460
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.audio.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.audio.inputSection")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.audio.inputEnabled")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASwitch {
                            id: inputEnabledSwitch
                            checked: audioCtl.inputEnabled
                            onToggled: page.save()
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.audio.inputDevice")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                    }

                    ATextField {
                        id: inputField
                        Layout.fillWidth: true
                        text: audioCtl.selectedInputDevice
                        placeholderText: I18n.tr("shell.audio.inputDevicePlaceholder")
                        onAccepted: page.save()
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.audio.outputDevice")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                    }

                    ATextField {
                        id: outputField
                        Layout.fillWidth: true
                        text: audioCtl.selectedOutputDevice
                        placeholderText: I18n.tr("shell.audio.outputDevicePlaceholder")
                        onAccepted: page.save()
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.audio.deviceHint")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    AButton {
                        variant: AButton.Accent
                        text: I18n.tr("shell.audio.save")
                        onClicked: page.save()
                    }
                }
            }

            Text {
                Layout.fillWidth: true
                visible: page.saveError.length > 0
                text: page.saveError
                font.family: Theme.fontBody
                font.pixelSize: 12
                wrapMode: Text.WordWrap
                color: Theme.error
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }

    Component.onCompleted: audioCtl.load()
}
