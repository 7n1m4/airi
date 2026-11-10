// SPDX-License-Identifier: GPL-3.0-or-later
// Themed modal dialog (Popup-based) with a header row and a default content
// slot. Opens with open(), closes with the close button or Escape.
import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Popup {
    id: control

    property string title: ""

    default property alias content: body.data

    modal: true
    dim: true
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    padding: 0

    anchors.centerIn: parent
    width: Math.min(480, parent ? parent.width - 2 * Theme.spacingL : 480)

    background: Rectangle {
        radius: Theme.radiusL
        color: Theme.surface
        border.width: 1
        border.color: Theme.border
    }

    contentItem: ColumnLayout {
        spacing: 0

        Item {
            Layout.fillWidth: true
            Layout.preferredHeight: 52
            Layout.topMargin: Theme.spacingS

            Text {
                anchors.verticalCenter: parent.verticalCenter
                anchors.left: parent.left
                anchors.leftMargin: Theme.spacingL
                text: control.title
                font.family: Theme.fontTitle
                font.pixelSize: 16
                font.bold: true
                color: Theme.textPrimary
                elide: Text.ElideRight
                width: parent.width - 2 * Theme.spacingL - closeButton.width
            }

            AButton {
                id: closeButton
                anchors.verticalCenter: parent.verticalCenter
                anchors.right: parent.right
                anchors.rightMargin: Theme.spacingS
                variant: AButton.Ghost
                text: "✕"
                implicitWidth: 36
                implicitHeight: 36
                leftPadding: 0
                rightPadding: 0
                onClicked: control.close()
            }
        }

        ASeparator {
            Layout.fillWidth: true
        }

        ColumnLayout {
            id: body
            Layout.fillWidth: true
            Layout.margins: Theme.spacingL
            spacing: Theme.spacingS
        }
    }
}
