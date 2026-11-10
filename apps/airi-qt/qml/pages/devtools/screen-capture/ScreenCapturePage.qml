// SPDX-License-Identifier: GPL-3.0-or-later
// Screen Capture (devtools) — the first slice of "vision": grab the primary
// screen to a PNG and list the saved captures. The capture itself is real
// (CaptureController bridge → C++ QScreen::grabWindow(0), primary screen
// only); captures land in `<profile>/captures/` (or the platform data dir)
// as capture-<millis>.png. Opening a capture uses Qt.openUrlExternally with
// the system viewer — there is deliberately no bridge call for that. Clear
// All is destructive behind an AModal confirm and only ever deletes files
// matching capture-<digits>.png (enforced again in the bridge).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    // ── Saved captures state ─────────────────────────────────────────────
    property var captures: []
    // Bridge exposes QString; hop through a QML string so `.length` works.
    readonly property string lastErrorText: controller.lastError

    CaptureController {
        id: controller
    }

    Connections {
        target: controller
        function onCapturesChanged() { page.syncFromBridge() }
    }

    function syncFromBridge() {
        var parsed = []
        try {
            parsed = JSON.parse(controller.capturesJson)
        } catch (e) {
            console.log("[airi-qt] capture: failed to parse capturesJson:", e)
        }
        page.captures = parsed
    }

    function thumbSource(entry) {
        if (!entry || !entry.path)
            return ""
        return "file://" + String(entry.path).replace(/ /g, "%20")
    }

    function openCapture(path) {
        Qt.openUrlExternally("file://" + String(path).replace(/ /g, "%20"))
    }

    function formatBytes(bytes) {
        if (bytes < 1024)
            return bytes + " B"
        if (bytes < 1024 * 1024)
            return (bytes / 1024).toFixed(1) + " KB"
        return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    }

    function formatWhen(ms) {
        if (!ms)
            return ""
        return Qt.formatDateTime(new Date(ms), "yyyy-MM-dd hh:mm:ss")
    }

    function captureNow() {
        controller.captureNow()
    }

    Component.onCompleted: {
        controller.refreshCaptures()
        page.syncFromBridge()
    }

    // Caption-style section header (same idiom as the sibling devtools page).
    component SectionCaption: Text {
        font.family: Theme.fontBody
        font.pixelSize: 12
        font.bold: true
        font.capitalization: Font.AllUppercase
        color: Theme.textSecondary
    }

    // Thumbnail cell: image + file name + mtime/size. Click opens the file
    // in the system viewer.
    component CaptureTile: Item {
        id: tile

        property var entry: ({})
        signal openRequested(string path)

        implicitWidth: 184
        implicitHeight: thumbFrame.height + Theme.spacingS + metaColumn.implicitHeight

        Rectangle {
            id: thumbFrame
            width: parent.width
            height: 110
            radius: Theme.radiusM
            color: Theme.surfaceHover
            border.width: 1
            border.color: hoverArea.containsMouse ? Theme.accent : Theme.border
            clip: true

            Image {
                id: thumb
                anchors.fill: parent
                anchors.margins: 1
                fillMode: Image.PreserveAspectFit
                asynchronous: true
                source: page.thumbSource(tile.entry)
                visible: status === Image.Ready
            }

            Text {
                anchors.centerIn: parent
                visible: thumb.status === Image.Error || thumb.status === Image.Null
                text: "🖼"
                font.pixelSize: 28
                color: Theme.textSecondary
            }

            MouseArea {
                id: hoverArea
                anchors.fill: parent
                hoverEnabled: true
                onClicked: tile.openRequested(tile.entry.path || "")
            }
        }

        ColumnLayout {
            id: metaColumn
            anchors.top: thumbFrame.bottom
            anchors.topMargin: Theme.spacingS
            width: parent.width
            spacing: 0

            Text {
                Layout.fillWidth: true
                text: tile.entry.fileName || ""
                font.family: Theme.fontBody
                font.pixelSize: 11
                font.bold: true
                elide: Text.ElideMiddle
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                text: page.formatWhen(tile.entry.createdMs) + " · " + page.formatBytes(tile.entry.bytes || 0)
                font.family: Theme.fontBody
                font.pixelSize: 10
                elide: Text.ElideRight
                color: Theme.textSecondary
            }
        }
    }

    Flickable {
        id: flickable
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.y + column.implicitHeight + Theme.spacingL
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        ColumnLayout {
            id: column
            x: Theme.spacingL
            y: Theme.spacingL
            width: flickable.width - 2 * Theme.spacingL
            spacing: Theme.spacingM

            // ── Header ───────────────────────────────────────────────────
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                Text {
                    Layout.fillWidth: true
                    text: I18n.tr("shell.capture.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "info"
                    text: I18n.tr("shell.capture.badge")
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 560
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.capture.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // ── Last-error banner ────────────────────────────────────────
            ACard {
                Layout.fillWidth: true
                visible: page.lastErrorText.length > 0
                borderColor: Theme.error

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: "⚠"
                        font.pixelSize: 20
                        color: Theme.error
                    }

                    ColumnLayout {
                        spacing: 2

                        Text {
                            text: I18n.tr("shell.capture.errorTitle")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            font.bold: true
                            color: Theme.error
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: page.lastErrorText
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textPrimary
                        }
                    }
                }
            }

            // ── Actions ──────────────────────────────────────────────────
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                AButton {
                    variant: AButton.Accent
                    text: I18n.tr("shell.capture.captureButton")
                    enabled: !controller.working
                    onClicked: page.captureNow()
                }

                AButton {
                    variant: AButton.Default
                    text: I18n.tr("shell.capture.refresh")
                    enabled: !controller.working
                    onClicked: controller.refreshCaptures()
                }

                ABadge {
                    variant: "default"
                    text: page.captures.length
                }

                Item { Layout.fillWidth: true }

                AButton {
                    variant: AButton.Danger
                    text: I18n.tr("shell.capture.clearAll")
                    enabled: page.captures.length > 0 && !controller.working
                    onClicked: clearConfirm.open()
                }
            }

            Text {
                Layout.fillWidth: true
                text: I18n.tr("shell.capture.openHint")
                font.family: Theme.fontBody
                font.pixelSize: 11
                color: Theme.textSecondary
            }

            // ── Saved captures ───────────────────────────────────────────
            SectionCaption {
                text: I18n.tr("shell.capture.capturesSection")
            }

            ACard {
                Layout.fillWidth: true
                visible: page.captures.length === 0

                AEmptyState {
                    Layout.fillWidth: true
                    implicitHeight: 160
                    icon: "📸"
                    title: I18n.tr("shell.capture.emptyTitle")
                    subtitle: I18n.tr("shell.capture.emptySubtitle")
                }
            }

            Flow {
                Layout.fillWidth: true
                spacing: Theme.spacingM
                visible: page.captures.length > 0

                Repeater {
                    model: page.captures

                    CaptureTile {
                        required property var modelData
                        entry: modelData
                        onOpenRequested: function (path) { page.openCapture(path) }
                    }
                }
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }

    // ── Destructive confirm ──────────────────────────────────────────────
    AModal {
        id: clearConfirm

        title: I18n.tr("shell.capture.clearConfirmTitle")

        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: I18n.tr("shell.capture.clearConfirmBody").replace("%1", page.captures.length)
            font.family: Theme.fontBody
            font.pixelSize: 12
            color: Theme.textPrimary
        }

        RowLayout {
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingS

            AButton {
                variant: AButton.Ghost
                text: I18n.tr("shell.capture.clearConfirmCancel")
                onClicked: clearConfirm.close()
            }

            AButton {
                variant: AButton.Danger
                text: I18n.tr("shell.capture.clearConfirmConfirm")
                onClicked: {
                    controller.clearCaptures()
                    clearConfirm.close()
                }
            }
        }
    }
}
