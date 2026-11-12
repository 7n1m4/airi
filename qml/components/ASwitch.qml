// SPDX-License-Identifier: GPL-3.0-or-later
// Thin themed wrapper around Qt Quick Controls Switch.
import QtQuick 2.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

Switch {
    id: control
    font.family: Theme.fontBody
    font.pixelSize: 14

    implicitWidth: indicator.implicitWidth + (contentItem.visible ? contentItem.implicitWidth + spacing : 0)
    implicitHeight: 24
    spacing: Theme.spacingS
    focusPolicy: Qt.StrongFocus

    indicator: Rectangle {
        id: indicatorItem
        implicitWidth: 40
        implicitHeight: 22
        x: 0
        y: (control.height - height) / 2
        radius: height / 2
        opacity: control.enabled ? 1 : 0.45
        color: control.checked ? Theme.accent : Theme.surfacePressed
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus ? Theme.accent : (control.checked ? Theme.accent : Theme.border)

        Rectangle {
            id: knob
            x: control.checked ? parent.width - width - 2 : 2
            y: 2
            width: parent.height - 4
            height: parent.height - 4
            radius: height / 2
            color: control.checked ? Theme.accentContrast : Theme.textSecondary

            Behavior on x {
                NumberAnimation { duration: 120 }
            }
        }
    }


    contentItem: Text {
        text: control.text
        font: control.font
        color: Theme.textPrimary
        visible: text.length > 0
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }
}
