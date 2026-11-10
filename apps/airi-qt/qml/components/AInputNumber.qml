// SPDX-License-Identifier: GPL-3.0-or-later
// Themed numeric spin box (DoubleSpinBox-based) with up/down step buttons.
// `from`/`to`/`stepSize`/`value` are real; `decimals` defaults to 0 (integer
// display) and can be raised per instance for fractional steps.
import QtQuick 2.15
import QtQuick.Controls
import com.airi.airiqt 1.0

DoubleSpinBox {
    id: control
    editable: true
    decimals: 0

    font.family: Theme.fontBody
    font.pixelSize: 14

    implicitWidth: 132
    implicitHeight: 36
    padding: 0

    opacity: control.enabled ? 1 : 0.45

    contentItem: TextInput {
        z: 2
        text: control.displayText
        font: control.font
        color: Theme.textPrimary
        selectionColor: Theme.accent
        selectedTextColor: Theme.accentContrast
        horizontalAlignment: Qt.AlignHCenter
        verticalAlignment: Qt.AlignVCenter
        readOnly: !control.editable
        validator: control.validator
        inputMethodHints: Qt.ImhFormattedNumbersOnly
    }

    up.indicator: Rectangle {
        x: parent.width - width
        implicitWidth: 28
        implicitHeight: parent.height
        color: control.up.pressed ? Theme.surfacePressed : "transparent"

        Text {
            anchors.centerIn: parent
            text: "▴"
            font.pixelSize: 12
            color: Theme.textSecondary
        }
    }

    down.indicator: Rectangle {
        x: 0
        implicitWidth: 28
        implicitHeight: parent.height
        color: control.down.pressed ? Theme.surfacePressed : "transparent"

        Text {
            anchors.centerIn: parent
            text: "▾"
            font.pixelSize: 12
            color: Theme.textSecondary
        }
    }

    background: Rectangle {
        radius: Theme.radiusS
        color: Theme.surfaceHover
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus ? Theme.accent : Theme.border
    }
}
