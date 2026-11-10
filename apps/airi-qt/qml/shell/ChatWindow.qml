// SPDX-License-Identifier: GPL-3.0-or-later
// Chat workspace window. The bridge surface lives in `ChatController`
// (Rust); this file only wires layout + bindings.
import QtQuick 2.15
import QtQuick.Window 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Window {
    id: chatWindow
    width: 880
    height: 640
    minimumWidth: 720
    minimumHeight: 520
    title: I18n.tr("shell.chat.title")
    color: Theme.bg

    ChatController {
        id: chatController
    }

    // Backend events flow core → broadcast → pump; drain on the Qt thread.
    Timer {
        interval: 33
        repeat: true
        running: true
        onTriggered: chatController.pumpEvents()
    }

    Component.onCompleted: {
        if (chatController.isSmoke())
            chatController.send(".smoke")
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // Top bar: app mark + active-card picker.
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 48
            spacing: Theme.spacingS

            Item { width: Theme.spacingM }

            Text {
                text: I18n.tr("shell.app.name")
                font.family: Theme.fontTitle
                font.pixelSize: 16
                font.bold: true
                color: Theme.textPrimary
            }

            Item { Layout.fillWidth: true }

            CardPicker {
                id: cardPicker
                controller: chatController
                Layout.preferredWidth: 260
            }

            Item { width: Theme.spacingM }
        }

        ASeparator {
            Layout.fillWidth: true
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            // Left: sessions.
            SessionListPanel {
                controller: chatController
                Layout.preferredWidth: 240
                Layout.fillHeight: true
                Layout.leftMargin: Theme.spacingM
                Layout.topMargin: Theme.spacingM
                Layout.bottomMargin: Theme.spacingM
            }

            Rectangle {
                width: 1
                Layout.fillHeight: true
                color: Theme.border
            }

            // Right: transcript + status + composer.
            ColumnLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: Theme.spacingS
                Layout.margins: Theme.spacingM

                TranscriptList {
                    controller: chatController
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                }

                // Error banner (cleared from the bridge, or dismissed here).
                RowLayout {
                    Layout.fillWidth: true
                    visible: chatController.error.length > 0
                    spacing: Theme.spacingS

                    ABadge {
                        text: I18n.tr("shell.chat.status.error")
                        variant: "error"
                    }

                    Text {
                        text: chatController.error
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        color: Theme.error
                        elide: Text.ElideRight
                        wrapMode: Text.Wrap
                        Layout.fillWidth: true
                        maximumLineCount: 2
                    }

                    AButton {
                        text: "✕"
                        variant: AButton.Ghost
                        implicitWidth: 30
                        implicitHeight: 26
                        onClicked: chatController.clearError()
                    }
                }

                Composer {
                    controller: chatController
                    Layout.fillWidth: true
                }
            }
        }
    }
}
