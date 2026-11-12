// SPDX-License-Identifier: GPL-3.0-or-later
// Thin themed wrapper around Qt Quick Controls TextField.
import QtQuick 2.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

TextField {
    id: control
    font.family: Theme.fontBody
    font.pixelSize: 14
    color: Theme.textPrimary
    placeholderTextColor: Theme.textSecondary
    selectionColor: Theme.accent
    selectedTextColor: Theme.accentContrast

    implicitHeight: 36
    topPadding: 0
    bottomPadding: 0
    leftPadding: Theme.spacingM
    rightPadding: Theme.spacingM
    verticalAlignment: TextInput.AlignVCenter

    opacity: control.enabled ? 1 : 0.45

    background: Rectangle {
        radius: Theme.radiusS
        color: Theme.surfaceHover
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus ? Theme.accent : Theme.border
    }
}
