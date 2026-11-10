// SPDX-License-Identifier: GPL-3.0-or-later
// Clickable list row: optional leading icon, title (+ optional subtitle),
// optional trailing chevron. Emits `clicked`.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: control

    property string icon: ""
    property string title: ""
    property string subtitle: ""
    property bool showChevron: false
    property bool active: false

    signal clicked()

    implicitWidth: 240
    implicitHeight: subtitle.length > 0 ? 56 : 40

    Rectangle {
        anchors.fill: parent
        radius: Theme.radiusM
        color: mouseArea.pressed
            ? Theme.surfacePressed
            : (mouseArea.containsMouse ? Theme.surfaceHover : "transparent")
        border.width: control.active ? 1 : 0
        border.color: Theme.accent
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: Theme.spacingM
        anchors.rightMargin: Theme.spacingM
        spacing: Theme.spacingM

        Text {
            visible: control.icon.length > 0
            text: control.icon
            font.pixelSize: 18
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            Text {
                Layout.fillWidth: true
                text: control.title
                font.family: Theme.fontBody
                font.pixelSize: 14
                color: Theme.textPrimary
                elide: Text.ElideRight
            }

            Text {
                visible: control.subtitle.length > 0
                Layout.fillWidth: true
                text: control.subtitle
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textSecondary
                elide: Text.ElideRight
            }
        }

        Text {
            visible: control.showChevron
            text: "›"
            font.pixelSize: 18
            color: Theme.textSecondary
        }
    }

    MouseArea {
        id: mouseArea
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: control.clicked()
    }
}
