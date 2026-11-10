// SPDX-License-Identifier: GPL-3.0-or-later
// Thin themed wrapper around Qt Quick Controls ToolTip.
// Use as a positioned/hover-visible child of the control it describes.
import QtQuick 2.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

ToolTip {
    id: control
    delay: 300
    timeout: 8000
    padding: Theme.spacingS

    background: Rectangle {
        radius: Theme.radiusS
        color: Theme.surface
        border.width: 1
        border.color: Theme.border
    }

    contentItem: Text {
        text: control.text
        font.family: Theme.fontBody
        font.pixelSize: 12
        color: Theme.textPrimary
    }
}
