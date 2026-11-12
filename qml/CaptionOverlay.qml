// SPDX-License-Identifier: GPL-3.0-or-later
// Caption overlay: themed, embeddable closed-caption bar.
//
// Designed to be embedded by the stage window (post-merge) but usable by
// any parent Item or Window. Contract:
//   captionText    — string; when empty the bar fades out (auto-hide).
//   speaker        — optional speaker label rendered above the text; hidden
//                    when empty.
//   fontSizeFactor — real; multiplier on the 18px base size (bind to the
//                    settings percentage divided by 100).
//   dock           — 'top' | 'bottom' | 'head' (alias of 'bottom') | 'none'
//                    (hidden). Real head-tethering would need the stage
//                    avatar transform; the spec treats 'head' as bottom.
//   opacity        — the inherited item opacity (0.0–1.0). QQuickItem.opacity
//                    is FINAL so the overlay cannot redeclare it; bind the
//                    component's opacity instead (e.g. to the settings
//                    percentage / 100). A Behavior is intentionally NOT
//                    installed here so consumers keep full control.
//
// The background is Theme.surface with alpha (Qt.rgba); no literal hex.
import QtQuick 2.15
import com.airi.airiqt 1.0

Item {
    id: root

    property string captionText: ""
    property string speaker: ""
    property real fontSizeFactor: 1.0
    property string dock: "bottom"

    readonly property bool dockNone: dock === "none"
    readonly property bool dockTop: dock === "top"

    opacity: 0.7

    anchors.left: parent ? parent.left : undefined
    anchors.right: parent ? parent.right : undefined
    anchors.top: !dockNone && dockTop && parent ? parent.top : undefined
    anchors.bottom: !dockNone && !dockTop && parent ? parent.bottom : undefined

    implicitHeight: contentColumn.implicitHeight + 2 * Theme.spacingM
    height: implicitHeight
    visible: !dockNone

    // Auto-hide wrapper: fades the bar out when there is nothing to say.
    Item {
        id: autoHide
        anchors.fill: parent
        opacity: root.captionText.length > 0 ? 1.0 : 0.0

        Behavior on opacity {
            NumberAnimation {
                duration: 200
                easing.type: Easing.InOutQuad
            }
        }

        Rectangle {
            anchors.fill: parent
            color: Qt.rgba(Theme.surface.r, Theme.surface.g, Theme.surface.b, 0.78)
        }

        Column {
            id: contentColumn
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: Theme.spacingL
            anchors.rightMargin: Theme.spacingL
            spacing: 2

            Text {
                visible: root.speaker.length > 0
                width: parent.width
                text: root.speaker
                font.family: Theme.fontTitle
                font.pixelSize: Math.max(10, Math.round(12 * root.fontSizeFactor))
                font.bold: true
                font.capitalization: Font.AllUppercase
                elide: Text.ElideRight
                horizontalAlignment: Text.AlignHCenter
                color: Theme.accent
            }

            Text {
                width: parent.width
                text: root.captionText
                font.family: Theme.fontBody
                font.pixelSize: Math.max(10, Math.round(18 * root.fontSizeFactor))
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                wrapMode: Text.WordWrap
                color: Theme.textPrimary
            }
        }
    }
}
