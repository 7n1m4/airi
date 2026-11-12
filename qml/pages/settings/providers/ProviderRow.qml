// SPDX-License-Identifier: GPL-3.0-or-later
// Provider list row: glyph circle (first alphanumeric of the label, Theme
// accent fill), label + kind badge line, green dot when enabled.
// Non-chat providers (engines not wired yet) render dimmed with a
// "not yet available" tooltip but stay selectable so the form can be inspected.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: row

    property var provider      // plain JS object from listProviders() JSON
    property bool active: false

    signal activated(string id)

    implicitWidth: 232
    implicitHeight: 48

    readonly property string glyph: {
        var label = provider && provider.label ? provider.label : ""
        var match = label.match(/[A-Za-z0-9]/)
        return match ? match[0].toUpperCase() : "?"
    }

    Rectangle {
        anchors.fill: parent
        radius: Theme.radiusM
        opacity: row.provider && row.provider.chatCapable ? 1 : 0.55
        color: row.active
            ? Theme.surfaceHover
            : (mouseArea.containsMouse ? Theme.surfaceHover : "transparent")
        border.width: row.active ? 1 : 0
        border.color: Theme.accent
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: Theme.spacingS
        anchors.rightMargin: Theme.spacingS
        spacing: Theme.spacingS
        opacity: row.provider && row.provider.chatCapable ? 1 : 0.6

        Rectangle {
            implicitWidth: 32
            implicitHeight: 32
            radius: 16
            color: Theme.accent

            Text {
                anchors.centerIn: parent
                text: row.glyph
                font.family: Theme.fontTitle
                font.pixelSize: 14
                font.bold: true
                color: Theme.accentContrast
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 0

            Text {
                Layout.fillWidth: true
                text: row.provider ? row.provider.label : ""
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textPrimary
                elide: Text.ElideRight
            }

            Text {
                Layout.fillWidth: true
                text: row.provider ? I18n.tr("shell.providers.kind." + row.provider.kind) : ""
                font.family: Theme.fontBody
                font.pixelSize: 11
                color: Theme.textSecondary
                elide: Text.ElideRight
            }
        }

        Rectangle {
            visible: row.provider ? row.provider.enabled : false
            implicitWidth: 8
            implicitHeight: 8
            radius: 4
            color: Theme.success
        }
    }

    // "Not yet available" tooltip for rows whose engine lands in a later phase.
    ATooltip {
        text: I18n.tr("shell.providers.not-available")
        visible: row.provider !== null && !row.provider.chatCapable && mouseArea.containsMouse
        x: Theme.spacingM
        y: row.height
    }

    MouseArea {
        id: mouseArea
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: {
            if (row.provider)
                row.activated(row.provider.id)
        }
    }
}
