// SPDX-License-Identifier: GPL-3.0-or-later
// Small pill badge for statuses/labels. `variant`: default|accent|success|warning|error|info
import QtQuick 2.15
import com.airi.airiqt 1.0

Rectangle {
    id: control

    property string variant: "default"
    property string text: ""

    readonly property color foreground: {
        switch (control.variant) {
        case "accent":
            return Theme.accent
        case "success":
            return Theme.success
        case "warning":
            return Theme.warning
        case "error":
            return Theme.error
        case "info":
            return Theme.info
        default:
            return Theme.textSecondary
        }
    }

    implicitWidth: label.implicitWidth + 2 * Theme.spacingS
    implicitHeight: 20
    radius: implicitHeight / 2
    color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.16)
    border.width: 1
    border.color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.4)

    Text {
        id: label
        anchors.centerIn: parent
        text: control.text
        font.family: Theme.fontBody
        font.pixelSize: 11
        font.bold: true
        color: control.foreground
    }
}
