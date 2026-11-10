// SPDX-License-Identifier: GPL-3.0-or-later
// Centered empty-state placeholder: icon, title, optional subtitle and an
// optional action slot (default property).
import QtQuick 2.15
import com.airi.airiqt 1.0

Item {
    id: control

    property string icon: "✦"
    property string title: ""
    property string subtitle: ""

    default property alias action: actionRow.data

    implicitWidth: 320
    implicitHeight: column.implicitHeight

    Column {
        id: column
        anchors.centerIn: parent
        spacing: Theme.spacingS
        width: Math.min(control.width, 380)

        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: control.icon
            font.pixelSize: 44
        }

        Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: control.title
            font.family: Theme.fontTitle
            font.pixelSize: 18
            font.bold: true
            wrapMode: Text.WordWrap
            color: Theme.textPrimary
        }

        Text {
            visible: control.subtitle.length > 0
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: control.subtitle
            font.family: Theme.fontBody
            font.pixelSize: 13
            wrapMode: Text.WordWrap
            color: Theme.textSecondary
        }

        Row {
            id: actionRow
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: Theme.spacingS
        }
    }
}
