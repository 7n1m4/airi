// SPDX-License-Identifier: GPL-3.0-or-later
// One transcript bubble. `entry` is a ChatMessageEntry QObject.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: row
    width: parent ? parent.width : 400
    implicitHeight: bubbleRow.implicitHeight

    required property var entry
    required property var controller

    readonly property bool isUser: entry.role === "user"

    RowLayout {
        id: bubbleRow
        anchors.fill: parent
        layoutDirection: isUser ? Qt.RightToLeft : Qt.LeftToRight
        spacing: Theme.spacingS

        Rectangle {
            id: bubble
            Layout.maximumWidth: row.width * 0.78
            Layout.alignment: isUser ? Qt.AlignRight : Qt.AlignLeft
            implicitWidth: textColumn.implicitWidth + 2 * Theme.spacingM
            implicitHeight: textColumn.implicitHeight + 2 * Theme.spacingS
            radius: Theme.radiusM
            color: isUser ? Theme.accent : Theme.surface
            border.width: isUser ? 0 : 1
            border.color: Theme.border

            ColumnLayout {
                id: textColumn
                anchors.fill: parent
                anchors.margins: Theme.spacingS
                spacing: 4

                Text {
                    id: body
                    Layout.fillWidth: true
                    text: isUser ? entry.content : (entry.content.length === 0 ? "…" : entry.content)
                    textFormat: isUser ? Text.PlainText : Text.MarkdownText
                    wrapMode: Text.WordWrap
                    font.family: Theme.fontBody
                    font.pixelSize: 14
                    color: isUser ? Theme.accentContrast : Theme.textPrimary
                }

                RowLayout {
                    spacing: Theme.spacingS

                    Text {
                        text: Qt.formatDateTime(new Date(entry.createdAt), "hh:mm")
                        font.family: Theme.fontBody
                        font.pixelSize: 10
                        color: isUser ? Qt.rgba(1, 1, 1, 0.75) : Theme.textSecondary
                    }

                    Text {
                        visible: row.controller.streaming && entry.id === row.controller.streamingMessageId
                        text: "▍"
                        font.pixelSize: 12
                        color: isUser ? Theme.accentContrast : Theme.accent

                        SequentialAnimation on opacity {
                            loops: Animation.Infinite
                            running: visible
                            NumberAnimation { from: 1; to: 0.15; duration: 530 }
                            NumberAnimation { from: 0.15; to: 1; duration: 530 }
                        }
                    }
                }
            }
        }
    }
}
