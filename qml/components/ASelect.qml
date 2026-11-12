// SPDX-License-Identifier: GPL-3.0-or-later
// Thin themed wrapper around Qt Quick Controls ComboBox.
import QtQuick 2.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

ComboBox {
    id: control
    font.family: Theme.fontBody
    font.pixelSize: 14

    implicitHeight: 36
    implicitWidth: 160
    leftPadding: Theme.spacingM
    rightPadding: Theme.spacingL * 2
    topPadding: 0
    bottomPadding: 0

    opacity: control.enabled ? 1 : 0.45

    background: Rectangle {
        radius: Theme.radiusS
        color: Theme.surfaceHover
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus ? Theme.accent : Theme.border
    }

    contentItem: Text {
        text: control.displayText
        font: control.font
        color: Theme.textPrimary
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }

    indicator: Text {
        x: control.width - width - Theme.spacingM
        anchors.verticalCenter: parent.verticalCenter
        text: "▾"
        font.pixelSize: 12
        color: Theme.textSecondary
    }

    popup: Popup {
        y: control.height + Theme.radiusS
        width: control.width
        implicitHeight: Math.min(contentItem.implicitHeight + topPadding + bottomPadding, 240)
        padding: 1

        background: Rectangle {
            radius: Theme.radiusS
            color: Theme.surface
            border.width: 1
            border.color: Theme.border
        }

        contentItem: ListView {
            implicitHeight: contentHeight
            clip: true
            model: control.popup.contentModel
            currentIndex: control.highlightedIndex
            ScrollBar.vertical: ScrollBar {}

            delegate: ItemDelegate {
                id: delegateItem
                width: ListView.view.width
                text: modelData
                hoverEnabled: true
                highlighted: ListView.isCurrentItem
                font: control.font

                background: Rectangle {
                    radius: Theme.radiusS
                    color: delegateItem.hovered || ListView.isCurrentItem ? Theme.surfacePressed : "transparent"
                }

                contentItem: Text {
                    text: delegateItem.text
                    font: delegateItem.font
                    color: Theme.textPrimary
                    verticalAlignment: Text.AlignVCenter
                    elide: Text.ElideRight
                }
            }
        }
    }
}
