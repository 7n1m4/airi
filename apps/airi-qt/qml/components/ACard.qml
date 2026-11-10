// SPDX-License-Identifier: GPL-3.0-or-later
// Themed card surface. Default slot holds the card content; use Layouts or
// Column/Row inside so implicit sizes propagate.
import QtQuick 2.15
import com.airi.airiqt 1.0

Item {
    id: control

    property real padding: Theme.spacingL
    property color fill: Theme.surface
    property color borderColor: Theme.border

    default property alias content: body.data

    implicitWidth: body.implicitWidth + 2 * control.padding
    implicitHeight: body.implicitHeight + 2 * control.padding

    Rectangle {
        anchors.fill: parent
        radius: Theme.radiusL
        color: control.fill
        border.width: 1
        border.color: control.borderColor
    }

    Item {
        id: body
        anchors.fill: parent
        anchors.margins: control.padding

        // Propagate implicit size from the first child that has one.
        implicitWidth: {
            for (var i = 0; i < children.length; ++i) {
                if (children[i].implicitWidth > 0)
                    return children[i].implicitWidth
            }
            return 200
        }
        implicitHeight: {
            for (var i = 0; i < children.length; ++i) {
                if (children[i].implicitHeight > 0)
                    return children[i].implicitHeight
            }
            return 80
        }
    }
}
