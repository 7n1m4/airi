// SPDX-License-Identifier: GPL-3.0-or-later
// Thin themed wrapper around Qt Quick Controls Slider.
import QtQuick 2.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

Slider {
    id: control
    implicitWidth: 160
    implicitHeight: 28
    focusPolicy: Qt.StrongFocus

    opacity: control.enabled ? 1 : 0.45

    background: Item {
        x: control.leftPadding
        y: control.topPadding + control.availableHeight / 2 - height / 2
        width: control.availableWidth
        height: 4

        Rectangle {
            anchors.fill: parent
            radius: height / 2
            color: Theme.surfacePressed
        }

        Rectangle {
            width: control.visualPosition * parent.width
            height: parent.height
            radius: height / 2
            color: Theme.accent
        }
    }

    handle: Rectangle {
        x: control.leftPadding + control.visualPosition * (control.availableWidth - width)
        y: control.topPadding + control.availableHeight / 2 - height / 2
        implicitWidth: 16
        implicitHeight: 16
        width: implicitWidth
        height: implicitHeight
        radius: width / 2
        color: Theme.accent
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus ? Theme.accentHover : Theme.accentPressed
    }
}
