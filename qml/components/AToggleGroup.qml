// SPDX-License-Identifier: GPL-3.0-or-later
// Row of checkable AButtons with exclusive selection via a ButtonGroup.
// `model` is a list of strings (labels); `currentIndex` is the selected row.
import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: control

    property var model: []
    property int currentIndex: 0

    signal toggled(int index)

    implicitWidth: row.implicitWidth
    implicitHeight: row.implicitHeight

    ButtonGroup {
        id: exclusiveGroup
        exclusive: true
    }

    RowLayout {
        id: row
        anchors.fill: parent
        spacing: Theme.spacingS

        Repeater {
            model: control.model

            delegate: AButton {
                required property int index
                required property string modelData

                ButtonGroup.group: exclusiveGroup
                checkable: true
                checked: index === control.currentIndex
                text: modelData
                variant: checked ? AButton.Accent : AButton.Default

                onClicked: {
                    control.currentIndex = index
                    control.toggled(index)
                }
            }
        }
    }
}
