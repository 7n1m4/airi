// SPDX-License-Identifier: GPL-3.0-or-later
// Thin themed wrapper around Qt Quick Controls ProgressBar.
import QtQuick 2.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

ProgressBar {
    id: control

    implicitWidth: 200
    implicitHeight: 6

    background: Rectangle {
        implicitHeight: 6
        radius: 3
        color: Theme.surfacePressed
    }

    contentItem: Item {
        implicitHeight: 6

        Rectangle {
            width: control.visualPosition * parent.width
            height: parent.height
            radius: 3
            color: Theme.accent

            Behavior on width {
                NumberAnimation { duration: 150 }
            }
        }
    }
}
