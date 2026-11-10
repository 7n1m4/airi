// SPDX-License-Identifier: GPL-3.0-or-later
// General settings page: interface language, page transitions, remote
// diagnostics sync and the built-in websocket server's TLS flag.
// Persists through the GeneralSettingsController bridge (settings/general).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    GeneralSettingsController {
        id: generalCtl
    }

    DesktopController {
        id: desktopController
    }

    property string saveError: ""

    function save() {
        var ok = generalCtl.save(languageField.text, disableTransitionsSwitch.checked,
                                 usePageSpecificSwitch.checked, remoteSyncSwitch.checked,
                                 websocketSecureSwitch.checked, autostartSwitch.checked)
        page.saveError = ok ? "" : I18n.tr("shell.general.saveError")
    }

    // Apply the OS-level autostart entry first (XDG .desktop on Linux), then
    // persist the mirrored settings/general.autostart flag. Reverts the switch on failure.
    function applyAutostart(checked) {
        var ok = desktopController.setAutostart(checked)
        if (!ok) {
            autostartSwitch.checked = !checked
            page.saveError = I18n.tr("shell.general.saveError")
            return
        }
        page.save()
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
                text: I18n.tr("shell.settings.nav.general")
                font.family: Theme.fontTitle
                font.pixelSize: 22
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 460
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.general.description")
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
                        text: I18n.tr("shell.general.languageSection")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    ATextField {
                        id: languageField
                        Layout.fillWidth: true
                        placeholderText: I18n.tr("shell.general.languagePlaceholder")
                        text: generalCtl.language
                        onAccepted: page.save()
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.general.languageHint")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }
                }
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.general.transitionsSection")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.general.disableTransitions")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASwitch {
                            id: disableTransitionsSwitch
                            checked: generalCtl.disableTransitions
                            onToggled: page.save()
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.general.usePageSpecificTransitions")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASwitch {
                            id: usePageSpecificSwitch
                            checked: generalCtl.usePageSpecificTransitions
                            onToggled: page.save()
                        }
                    }
                }
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.general.privacySection")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.general.remoteSyncEnabled")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASwitch {
                            id: remoteSyncSwitch
                            checked: generalCtl.remoteSyncEnabled
                            onToggled: page.save()
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.general.websocketSecureEnabled")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASwitch {
                            id: websocketSecureSwitch
                            checked: generalCtl.websocketSecureEnabled
                            onToggled: page.save()
                        }
                    }
                }
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.general.startupSection")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.general.autostartEnabled")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        // Reflect the OS-level login entry (XDG autostart on
                        // Linux); toggling applies it and persists the mirror
                        // in settings/general.autostart.
                        ASwitch {
                            id: autostartSwitch
                            checked: desktopController.autostartEnabled()
                            onToggled: page.applyAutostart(checked)
                        }
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

    Component.onCompleted: generalCtl.load()
}
