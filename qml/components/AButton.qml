// SPDX-License-Identifier: GPL-3.0-or-later
// Thin themed wrapper around Qt Quick Controls Button.
// API mirrors Qt Quick Controls; `variant` selects the visual style.
import QtQuick 2.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

Button {
    id: control
    focusPolicy: Qt.StrongFocus

    enum Variant {
        Default,
        Accent,
        Ghost,
        Danger
    }
    property int variant: AButton.Default

    implicitWidth: Math.max(contentItem.implicitWidth + leftPadding + rightPadding, implicitBackgroundWidth)
    implicitHeight: implicitBackgroundHeight
    topPadding: 0
    bottomPadding: 0
    leftPadding: Theme.spacingM
    rightPadding: Theme.spacingM
    spacing: Theme.spacingS
    font.family: Theme.fontBody
    font.pixelSize: 14

    background: Rectangle {
        implicitWidth: 64
        implicitHeight: 36
        radius: Theme.radiusM
        opacity: control.enabled ? 1 : 0.45
        border.width: control.activeFocus ? 2 : 1
        color: {
            switch (control.variant) {
            case AButton.Accent:
                return control.down ? Theme.accentPressed : (control.hovered ? Theme.accentHover : Theme.accent)
            case AButton.Ghost:
                return control.down ? Theme.surfacePressed : (control.hovered ? Theme.surfaceHover : "transparent")
            case AButton.Danger:
                return control.down ? Theme.error : "transparent"
            default:
                return (control.down || control.hovered) ? Theme.surfacePressed : Theme.surfaceHover
            }
        }
        border.color: {
            if (control.activeFocus)
                return Theme.accent
            switch (control.variant) {
            case AButton.Accent:
                return Theme.accentPressed
            case AButton.Ghost:
                return "transparent"
            case AButton.Danger:
                return Theme.error
            default:
                return Theme.border
            }
        }
    }

    contentItem: Text {
        text: control.text
        font: control.font
        width: control.availableWidth
        height: control.availableHeight
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
        color: {
            switch (control.variant) {
            case AButton.Accent:
                return Theme.accentContrast
            case AButton.Danger:
                return control.down ? Theme.accentContrast : Theme.error
            default:
                return Theme.textPrimary
            }
        }
        opacity: control.enabled ? 1 : 0.6
    }
}
