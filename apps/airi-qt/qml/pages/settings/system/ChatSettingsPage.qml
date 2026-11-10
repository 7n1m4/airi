// SPDX-License-Identifier: GPL-3.0-or-later
// Chat settings page: send shortcut, suggestion-accept shortcut, stream
// idle timeout and system-message handling.
// Persists through the ChatSettingsController bridge (settings/chat).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    ChatSettingsController {
        id: chatCtl
    }

    readonly property var sendModeValues: ["enter", "ctrl-enter", "double-enter"]
    readonly property var suggestModeValues: ["enter", "ctrl-enter", "double-enter", "disabled"]

    property string saveError: ""

    function save() {
        var sendMode = page.sendModeValues[Math.max(0, sendModeSelect.currentIndex)]
        var suggestMode = page.suggestModeValues[Math.max(0, suggestModeSelect.currentIndex)]
        var ok = chatCtl.save(sendMode, suggestMode, streamIdleTimeout.value,
                              showDirectorNotesSwitch.checked, combineSystemMessagesSwitch.checked)
        page.saveError = ok ? "" : I18n.tr("shell.chat-settings.saveError")
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
                text: I18n.tr("shell.settings.nav.chat")
                font.family: Theme.fontTitle
                font.pixelSize: 22
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 460
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.chat-settings.description")
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
                        text: I18n.tr("shell.chat-settings.inputSection")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.chat-settings.sendMode")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASelect {
                            id: sendModeSelect
                            implicitWidth: 180
                            model: [
                                I18n.tr("shell.chat-settings.modeEnter"),
                                I18n.tr("shell.chat-settings.modeCtrlEnter"),
                                I18n.tr("shell.chat-settings.modeDoubleEnter"),
                            ]

                            Component.onCompleted: {
                                var idx = page.sendModeValues.indexOf(chatCtl.sendMode)
                                currentIndex = idx >= 0 ? idx : 0
                            }

                            onActivated: page.save()
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.chat-settings.suggestMode")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASelect {
                            id: suggestModeSelect
                            implicitWidth: 180
                            model: [
                                I18n.tr("shell.chat-settings.modeEnter"),
                                I18n.tr("shell.chat-settings.modeCtrlEnter"),
                                I18n.tr("shell.chat-settings.modeDoubleEnter"),
                                I18n.tr("shell.chat-settings.modeDisabled"),
                            ]

                            Component.onCompleted: {
                                var idx = page.suggestModeValues.indexOf(chatCtl.suggestMode)
                                currentIndex = idx >= 0 ? idx : 2
                            }

                            onActivated: page.save()
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.chat-settings.streamIdleTimeout")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        AInputNumber {
                            id: streamIdleTimeout
                            from: 0
                            to: 3600000
                            stepSize: 10000
                            editable: true
                            value: Math.round(chatCtl.streamIdleTimeoutMs)
                            onValueModified: page.save()
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.chat-settings.streamIdleTimeoutHint")
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
                        text: I18n.tr("shell.chat-settings.messagesSection")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.chat-settings.showDirectorNotes")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASwitch {
                            id: showDirectorNotesSwitch
                            checked: chatCtl.showDirectorNotes
                            onToggled: page.save()
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.chat-settings.combineSystemMessages")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASwitch {
                            id: combineSystemMessagesSwitch
                            checked: chatCtl.combineSystemMessages
                            onToggled: page.save()
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

    Component.onCompleted: chatCtl.load()
}
