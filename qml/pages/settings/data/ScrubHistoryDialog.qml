// SPDX-License-Identifier: GPL-3.0-or-later
// Scrub & Resolve Session Media dialog: port of the Vue ScrubHistoryModal.
// Both actions run the real scrub via the DataController bridge (inline base64
// images are extracted to the backgrounds store and replaced with asset
// pointers). "Scrub Without Backup" skips the pre-scrub archive; "Create Backup
// & Scrub" writes one first. Progress states are not faked — the dialog
// reports the final result.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

AModal {
    id: page

    title: I18n.tr("shell.data.scrubDialog.title")

    DataController {
        id: dataCtl
    }

    property bool resultVisible: false
    property bool resultOk: true
    property string resultText: ""
    property bool working: false

    function humanBytes(n) {
        if (n >= 1048576)
            return (n / 1048576).toFixed(1) + " MB"
        if (n >= 1024)
            return (n / 1024).toFixed(1) + " KB"
        return n + " B"
    }

    function runScrub(withBackup) {
        page.working = true
        var raw = dataCtl.scrubRun(withBackup)
        page.working = false
        var report = null
        try {
            report = JSON.parse(raw)
        } catch (e) {
            report = { error: "unexpected bridge response" }
        }
        if (report && report.error) {
            page.resultOk = false
            page.resultText = report.error
        } else if (report) {
            page.resultOk = true
            page.resultText = I18n.tr("shell.data.status.scrubDone")
                + " — " + report.images_found + " images, " + page.humanBytes(report.bytes_extracted || 0)
                + (report.backup_path ? " (backup: " + report.backup_path + ")" : "")
        }
        page.resultVisible = true
    }

    Text {
        Layout.fillWidth: true
        text: I18n.tr("shell.data.scrubDialog.subtitle")
        font.family: Theme.fontBody
        font.pixelSize: 12
        wrapMode: Text.WordWrap
        color: Theme.textSecondary
    }

    // What the scrub does, plus the honest current-size fallback.
    Rectangle {
        Layout.fillWidth: true
        implicitHeight: scrubInfo.implicitHeight + 2 * Theme.spacingM
        radius: Theme.radiusM
        color: Theme.surfaceHover
        border.width: 1
        border.color: Theme.border

        ColumnLayout {
            id: scrubInfo
            anchors.fill: parent
            anchors.margins: Theme.spacingM
            spacing: Theme.spacingS

            Text {
                Layout.fillWidth: true
                text: I18n.tr("shell.data.scrubDialog.promptBody")
                font.family: Theme.fontBody
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                lineHeight: 1.25
                color: Theme.textPrimary
            }

            ASeparator {
                Layout.fillWidth: true
            }

            RowLayout {
                Layout.fillWidth: true

                Text {
                    Layout.fillWidth: true
                    text: I18n.tr("shell.data.scrubDialog.currentChatSize")
                    font.family: Theme.fontBody
                    font.pixelSize: 11
                    color: Theme.textSecondary
                }
                Text {
                    text: I18n.tr("shell.data.scrubDialog.sizeUnknown")
                    font.family: Theme.fontBody
                    font.pixelSize: 11
                    font.bold: true
                    color: Theme.textPrimary
                }
            }
        }
    }

    // Backup reassurance banner.
    Rectangle {
        Layout.fillWidth: true
        implicitHeight: safetyRow.implicitHeight + 2 * Theme.spacingM
        radius: Theme.radiusM
        color: Qt.rgba(Theme.warning.r, Theme.warning.g, Theme.warning.b, 0.12)
        border.width: 1
        border.color: Qt.rgba(Theme.warning.r, Theme.warning.g, Theme.warning.b, 0.4)

        RowLayout {
            id: safetyRow
            anchors.fill: parent
            anchors.margins: Theme.spacingM
            spacing: Theme.spacingS

            Text {
                text: "🛡"
                font.pixelSize: 16
            }
            Text {
                Layout.fillWidth: true
                text: I18n.tr("shell.data.scrubDialog.safetyTitle") + " " + I18n.tr("shell.data.scrubDialog.safetyBody")
                font.family: Theme.fontBody
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                lineHeight: 1.25
                color: Theme.warning
            }
        }
    }

    // Honest wave note (always visible).
    Text {
        Layout.fillWidth: true
        text: I18n.tr("shell.data.scrubDialog.waveNote")
        font.family: Theme.fontBody
        font.pixelSize: 10
        wrapMode: Text.WordWrap
        color: Theme.textSecondary
    }

    // Result banner (scrub outcome; stays until dismissed).
    Rectangle {
        Layout.fillWidth: true
        visible: page.resultVisible
        implicitHeight: resultRow.implicitHeight + 2 * Theme.spacingS
        radius: Theme.radiusM
        color: Qt.rgba((page.resultOk ? Theme.success : Theme.error).r,
                       (page.resultOk ? Theme.success : Theme.error).g,
                       (page.resultOk ? Theme.success : Theme.error).b, 0.12)
        border.width: 1
        border.color: Qt.rgba((page.resultOk ? Theme.success : Theme.error).r,
                              (page.resultOk ? Theme.success : Theme.error).g,
                              (page.resultOk ? Theme.success : Theme.error).b, 0.4)

        RowLayout {
            id: resultRow
            anchors.fill: parent
            anchors.margins: Theme.spacingS
            spacing: Theme.spacingS

            Text {
                Layout.fillWidth: true
                text: page.resultText
                font.family: Theme.fontBody
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                color: page.resultOk ? Theme.success : Theme.error
            }
            AButton {
                variant: AButton.Ghost
                text: "✕"
                implicitWidth: 28
                implicitHeight: 28
                leftPadding: 0
                rightPadding: 0
                onClicked: page.resultVisible = false
            }
        }
    }

    RowLayout {
        Layout.fillWidth: true
        Layout.alignment: Qt.AlignRight
        spacing: Theme.spacingS

        AButton {
            variant: AButton.Default
            text: I18n.tr("shell.data.scrubDialog.cancel")
            onClicked: page.close()
        }
        AButton {
            variant: AButton.Default
            text: page.working ? "…" : I18n.tr("shell.data.scrubDialog.scrubWithoutBackup")
            enabled: !page.working
            onClicked: page.runScrub(false)
        }
        AButton {
            variant: AButton.Accent
            text: page.working ? "…" : I18n.tr("shell.data.scrubDialog.backupAndScrub")
            enabled: !page.working
            onClicked: page.runScrub(true)
        }
    }
}
