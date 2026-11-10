// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick 2.15

// Caption overlay (stage:caption). Text is set from StageApp.
Item {
    id: captionRoot
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    height: 48
    opacity: text.length > 0 ? 1.0 : 0.0

    property alias text: label.text
    property string speaker: ""

    Behavior on opacity {
        NumberAnimation { duration: 200 }
    }

    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.55)
    }

    Text {
        id: label
        anchors.fill: parent
        anchors.margins: 8
        color: "white"
        font.pixelSize: 16
        horizontalAlignment: Text.AlignCenter
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
        wrapMode: Text.WordWrap
    }
}
