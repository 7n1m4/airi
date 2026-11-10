// SPDX-License-Identifier: GPL-3.0-or-later
// Frameless, always-on-top splash shown at startup. Walks the startup
// milestone sequence (core-services → sync → providers → stage-ready), then
// emits `finished` so the entry can reveal the Control Strip.
import QtQuick 2.15
import QtQuick.Window 2.15
import com.airi.airiqt 1.0

Window {
    id: root
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
    color: "transparent"
    width: 380
    height: 220
    visible: true
    title: I18n.tr("shell.app.name")

    property int milestoneIndex: 0
    readonly property var milestones: [
        "shell.splash.milestones.core_services",
        "shell.splash.milestones.sync_engine",
        "shell.splash.milestones.providers",
        "shell.splash.milestones.stage_ready"
    ]

    signal finished()

    ShellApp {
        id: shell
    }

    Windows {
        id: windowsBridge
    }

    Rectangle {
        anchors.fill: parent
        anchors.margins: Theme.spacingS
        radius: Theme.radiusL
        color: Theme.surface
        border.width: 1
        border.color: Theme.border

        Column {
            anchors.centerIn: parent
            width: parent.width - 2 * Theme.spacingL
            spacing: Theme.spacingS

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: I18n.tr("shell.app.name")
                font.family: Theme.fontTitle
                font.pixelSize: 40
                font.bold: true
                color: Theme.accent
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: root.milestoneIndex < root.milestones.length
                    ? I18n.tr(root.milestones[root.milestoneIndex])
                    : I18n.tr("shell.splash.milestones.stage_ready")
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textSecondary
                elide: Text.ElideRight
            }

            AProgress {
                anchors.horizontalCenter: parent.horizontalCenter
                width: parent.width - 2 * Theme.spacingL
                from: 0
                to: root.milestones.length
                value: root.milestoneIndex + 1
            }
        }
    }

    Timer {
        id: milestoneTimer
        interval: shell.isSmoke() ? 80 : 300
        repeat: true
        running: true

        onTriggered: {
            root.milestoneIndex += 1
            if (root.milestoneIndex >= root.milestones.length) {
                milestoneTimer.stop()
                root.finished()
            }
        }
    }

    Component.onCompleted: {
        x = (Screen.virtualX + (Screen.width - width) / 2)
        y = (Screen.virtualY + (Screen.height - height) / 2)
        windowsBridge.visited("splash")
    }
}
