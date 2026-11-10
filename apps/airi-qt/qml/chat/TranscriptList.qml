// SPDX-License-Identifier: GPL-3.0-or-later
// Scrollable transcript. Auto-scrolls to the bottom while the user is near
// it; appends never rebuild the list (QObjectList model).
import QtQuick 2.15
import com.airi.airiqt 1.0

Flickable {
    id: flick

    required property var controller

    clip: true
    contentWidth: width
    contentHeight: messageColumn.implicitHeight
    boundsBehavior: Flickable.StopAtBounds
    flickableDirection: Flickable.VerticalFlick

    readonly property bool nearBottom:
        contentHeight - height - contentY < 96

    function scrollToBottom() {
        contentY = Math.max(0, contentHeight - height)
    }

    Column {
        id: messageColumn
        width: flick.width
        spacing: Theme.spacingS
        AEmptyState {
            width: messageColumn.width - 2 * Theme.spacingS
            visible: flick.controller.sessionId.length === 0 && !flick.controller.streaming
            icon: "💬"
            title: I18n.tr("shell.chat.empty-title")
            subtitle: I18n.tr("shell.chat.empty-subtitle")
        }

        Repeater {
            model: flick.controller.messagesModel
            delegate: MessageItem {
                required property var modelData
                entry: modelData
                controller: flick.controller
                width: messageColumn.width - 2 * Theme.spacingS
            }
        }
    }

    Connections {
        target: flick.controller
        function onMessagesModelChanged() {
            if (flick.nearBottom)
                flick.scrollToBottom()
        }
    }

    Timer {
        interval: 150
        repeat: true
        running: flick.controller.streaming
        onTriggered: {
            if (flick.nearBottom)
                flick.scrollToBottom()
        }
    }

    Component.onCompleted: scrollToBottom()
}
