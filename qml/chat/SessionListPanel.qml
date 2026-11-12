// SPDX-License-Identifier: GPL-3.0-or-later
// Left column: recent sessions, search, new-chat action.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

ColumnLayout {
    id: panel

    required property var controller

    spacing: Theme.spacingS

    RowLayout {
        Layout.fillWidth: true

        Text {
            text: I18n.tr("shell.chat.recent")
            font.family: Theme.fontBody
            font.pixelSize: 12
            font.bold: true
            color: Theme.textSecondary
        }

        Item { Layout.fillWidth: true }

        AButton {
            text: I18n.tr("shell.chat.new")
            variant: AButton.Accent
            implicitHeight: 28
            padding: 0
            font.pixelSize: 12
            onClicked: panel.controller.newSession()
        }
    }

    ATextField {
        id: search
        Layout.fillWidth: true
        implicitHeight: 32
        placeholderText: I18n.tr("shell.chat.search-placeholder")
    }

    Flickable {
        Layout.fillWidth: true
        Layout.fillHeight: true
        clip: true
        contentWidth: width
        contentHeight: sessionColumn.implicitHeight
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: sessionColumn
            width: parent.width
            spacing: 2

            Repeater {
                model: panel.controller.sessionsModel
                delegate: AListItem {
                    required property var modelData
                    width: sessionColumn.width
                    title: modelData.title
                    subtitle: Qt.formatDateTime(new Date(modelData.updatedAt), "MMM d, hh:mm")
                    active: modelData.id === panel.controller.sessionId
                    visible: search.text.length === 0
                             || modelData.title.toLowerCase().indexOf(search.text.toLowerCase()) >= 0
                    onClicked: panel.controller.selectSession(modelData.id)
                }
            }
        }
    }

    AButton {
        Layout.fillWidth: true
        text: I18n.tr("shell.chat.delete-session")
        variant: AButton.Danger
        visible: panel.controller.sessionId.length > 0
        onClicked: panel.controller.deleteSession(panel.controller.sessionId)
    }
}
