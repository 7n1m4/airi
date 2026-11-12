// SPDX-License-Identifier: GPL-3.0-or-later
// Data settings page: what AIRI stores locally — archive export/universal
// import (Data Vault, wired to the Rust vault backend), storage status,
// scrub history (wired) and unlinked-data detection (still not wired —
// Qt sessions carry no card linkage yet). Destructive resets remain explicit
// no-ops behind a confirmation whose body says so.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    property string statusMessage: ""
    property string statusTone: "neutral" // neutral | success | error
    property bool showLegacyTools: false
    property var scrubRuns: []

    DataController {
        id: dataCtl
    }

    Connections {
        target: dataCtl
        function onStatsChanged() { page.reloadScrubRuns() }
    }

    function reloadScrubRuns() {
        var runs = []
        try {
            runs = JSON.parse(dataCtl.listScrubRuns())
        } catch (e) {
            console.log("[airi-qt] data: failed to parse scrub runs:", e)
        }
        page.scrubRuns = runs
    }

    function humanBytes(n) {
        if (n >= 1048576)
            return (n / 1048576).toFixed(1) + " MB"
        if (n >= 1024)
            return (n / 1024).toFixed(1) + " KB"
        return n + " B"
    }

    function formatRunDate(ms) {
        var d = new Date(ms)
        if (isNaN(d.getTime()))
            return "" + ms
        return Qt.formatDateTime(d, "yyyy-MM-dd hh:mm")
    }

    Component.onCompleted: {
        dataCtl.refreshStats()
        page.reloadScrubRuns()
    }

    function showNotWiredNotice() {
        page.statusMessage = I18n.tr("shell.data.status.actionNotWired")
        page.statusTone = "neutral"
    }

    // One reusable destructive-action confirmation. Every action it confirms
    // is a no-op until wave ④ — the body says exactly that.
    function confirmDestructive() {
        confirmActionDialog.open()
    }

    // Legacy per-domain export/import row (used by the collapsed section).
    component DomainToolRow: RowLayout {
        id: toolRow

        property string titleKey: ""
        property string descriptionKey: ""
        property bool showDelete: false

        signal exportClicked()
        signal importClicked()
        signal deleteClicked()

        Layout.fillWidth: true
        spacing: Theme.spacingM

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            Text {
                Layout.fillWidth: true
                text: I18n.tr(toolRow.titleKey)
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textPrimary
            }
            Text {
                Layout.fillWidth: true
                text: I18n.tr(toolRow.descriptionKey)
                font.family: Theme.fontBody
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                color: Theme.textSecondary
            }
        }

        AButton {
            variant: AButton.Default
            text: I18n.tr("shell.data.legacy.export")
            onClicked: toolRow.exportClicked()
        }
        AButton {
            variant: AButton.Accent
            text: I18n.tr("shell.data.legacy.import")
            onClicked: toolRow.importClicked()
        }
        AButton {
            visible: toolRow.showDelete
            variant: AButton.Danger
            text: I18n.tr("shell.data.legacy.deleteChats")
            onClicked: toolRow.deleteClicked()
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

            Text {
                text: I18n.tr("shell.data.title")
                font.family: Theme.fontTitle
                font.pixelSize: 22
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 560
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.data.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // Live status banner.
            Rectangle {
                Layout.fillWidth: true
                visible: page.statusMessage.length > 0
                implicitHeight: statusRow.implicitHeight + 2 * Theme.spacingS
                radius: Theme.radiusM
                border.width: 1
                color: {
                    if (page.statusTone === "error")
                        return Qt.rgba(Theme.error.r, Theme.error.g, Theme.error.b, 0.12)
                    if (page.statusTone === "success")
                        return Qt.rgba(Theme.success.r, Theme.success.g, Theme.success.b, 0.12)
                    return Qt.rgba(Theme.textSecondary.r, Theme.textSecondary.g, Theme.textSecondary.b, 0.12)
                }
                border.color: {
                    if (page.statusTone === "error")
                        return Qt.rgba(Theme.error.r, Theme.error.g, Theme.error.b, 0.4)
                    if (page.statusTone === "success")
                        return Qt.rgba(Theme.success.r, Theme.success.g, Theme.success.b, 0.4)
                    return Qt.rgba(Theme.textSecondary.r, Theme.textSecondary.g, Theme.textSecondary.b, 0.4)
                }

                RowLayout {
                    id: statusRow
                    anchors.fill: parent
                    anchors.margins: Theme.spacingS
                    spacing: Theme.spacingS

                    Text {
                        text: page.statusTone === "error" ? "⚠" : (page.statusTone === "success" ? "✓" : "ℹ")
                        font.pixelSize: 14
                        color: page.statusTone === "error" ? Theme.error : Theme.success
                    }
                    Text {
                        Layout.fillWidth: true
                        text: page.statusMessage
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textPrimary
                    }
                    AButton {
                        variant: AButton.Ghost
                        text: "✕"
                        implicitWidth: 28
                        implicitHeight: 28
                        leftPadding: 0
                        rightPadding: 0
                        onClicked: page.statusMessage = ""
                    }
                }
            }

            // ── Data Vault ─────────────────────────────────────────────
            ACard {
                Layout.fillWidth: true
                borderColor: Theme.accent

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.data.vault.title")
                        font.family: Theme.fontTitle
                        font.pixelSize: 17
                        font.bold: true
                        wrapMode: Text.WordWrap
                        color: Theme.textPrimary
                    }
                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.data.vault.description")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        Item { Layout.fillWidth: true }

                        AButton {
                            variant: AButton.Default
                            text: "📥 " + I18n.tr("shell.data.vault.import")
                            onClicked: importDialog.open()
                        }
                        AButton {
                            variant: AButton.Accent
                            text: "📦 " + I18n.tr("shell.data.vault.export")
                            onClicked: exportDialog.open()
                        }
                    }
                }
            }

            // ── Cloud Sync (not wired yet) ─────────────────────────────
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.data.sync.title")
                            font.family: Theme.fontTitle
                            font.pixelSize: 15
                            font.bold: true
                            wrapMode: Text.WordWrap
                            color: Theme.textPrimary
                        }
                        ABadge {
                            variant: "warning"
                            text: I18n.tr("shell.data.sync.badge")
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.data.sync.description")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        ASwitch {
                            enabled: false
                            text: I18n.tr("shell.data.sync.enable")
                            checked: false
                        }
                        Item { Layout.fillWidth: true }
                        AButton {
                            variant: AButton.Default
                            enabled: false
                            text: I18n.tr("shell.data.sync.syncNow")
                        }
                        AButton {
                            variant: AButton.Accent
                            enabled: false
                            text: I18n.tr("shell.data.sync.openSettings")
                        }
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        implicitHeight: syncNotes.implicitHeight + 2 * Theme.spacingM
                        radius: Theme.radiusM
                        color: Theme.surfaceHover
                        border.width: 1
                        border.color: Theme.border

                        ColumnLayout {
                            id: syncNotes
                            anchors.fill: parent
                            anchors.margins: Theme.spacingM
                            spacing: Theme.spacingS

                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.data.sync.zeroCustodyTitle") + " " + I18n.tr("shell.data.sync.zeroCustodyBody")
                                font.family: Theme.fontBody
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                                lineHeight: 1.25
                                color: Theme.textSecondary
                            }
                            ASeparator {
                                Layout.fillWidth: true
                            }
                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.data.sync.avatarsTitle") + " " + I18n.tr("shell.data.sync.avatarsBody")
                                font.family: Theme.fontBody
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                                lineHeight: 1.25
                                color: Theme.textSecondary
                            }
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: syncTarget.implicitHeight + 2 * Theme.spacingS
                            radius: Theme.radiusM
                            color: Theme.surfaceHover
                            border.width: 1
                            border.color: Theme.border

                            ColumnLayout {
                                id: syncTarget
                                anchors.fill: parent
                                anchors.margins: Theme.spacingS
                                spacing: 2

                                Text {
                                    Layout.fillWidth: true
                                    text: I18n.tr("shell.data.sync.activeTarget")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 10
                                    font.bold: true
                                    color: Theme.textSecondary
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: I18n.tr("shell.data.sync.notConfigured")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 11
                                    font.bold: true
                                    color: Theme.textPrimary
                                }
                            }
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: syncLast.implicitHeight + 2 * Theme.spacingS
                            radius: Theme.radiusM
                            color: Theme.surfaceHover
                            border.width: 1
                            border.color: Theme.border

                            ColumnLayout {
                                id: syncLast
                                anchors.fill: parent
                                anchors.margins: Theme.spacingS
                                spacing: 2

                                Text {
                                    Layout.fillWidth: true
                                    text: I18n.tr("shell.data.sync.lastSynced")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 10
                                    font.bold: true
                                    color: Theme.textSecondary
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: I18n.tr("shell.data.sync.never")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 11
                                    font.bold: true
                                    color: Theme.textPrimary
                                }
                            }
                        }
                    }
                }
            }

            // ── Session media optimization & scrub ─────────────────────
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.data.scrub.title")
                        font.family: Theme.fontTitle
                        font.pixelSize: 15
                        font.bold: true
                        wrapMode: Text.WordWrap
                        color: Theme.textPrimary
                    }
                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.data.scrub.description")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }
                    RowLayout {
                        Layout.fillWidth: true

                        Item { Layout.fillWidth: true }

                        AButton {
                            variant: AButton.Default
                            text: "✨ " + I18n.tr("shell.data.scrub.button")
                            onClicked: scrubDialog.open()
                        }
                    }
                }
            }

            // ── Scrub history (empty until the backend lands) ──────────
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.data.scrubHistory.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }
                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.data.scrubHistory.description")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    AEmptyState {
                        Layout.fillWidth: true
                        visible: page.scrubRuns.length === 0
                        icon: "🧹"
                        title: I18n.tr("shell.data.scrubHistory.emptyTitle")
                        subtitle: I18n.tr("shell.data.scrubHistory.emptySubtitle")
                    }

                    Repeater {
                        model: page.scrubRuns

                        delegate: Rectangle {
                            required property var modelData

                            Layout.fillWidth: true
                            implicitHeight: 56
                            radius: Theme.radiusM
                            color: Theme.surfaceHover
                            border.width: 1
                            border.color: Theme.border

                            RowLayout {
                                anchors.fill: parent
                                anchors.margins: Theme.spacingS
                                spacing: Theme.spacingM

                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 0
                                    Text {
                                        Layout.fillWidth: true
                                        text: page.formatRunDate(modelData.startedAt || 0)
                                        font.family: Theme.fontBody
                                        font.pixelSize: 12
                                        font.bold: true
                                        color: Theme.textPrimary
                                    }
                                    Text {
                                        Layout.fillWidth: true
                                        text: (modelData.sessionsScanned || 0) + " sessions · " + (modelData.imagesExtracted || 0)
                                            + " images · " + page.humanBytes(modelData.bytesExtracted || 0)
                                        font.family: Theme.fontBody
                                        font.pixelSize: 11
                                        color: Theme.textSecondary
                                        elide: Text.ElideRight
                                    }
                                }
                                Text {
                                    visible: (modelData.backupPath || "").length > 0
                                    text: "💾"
                                    font.pixelSize: 14
                                }
                            }
                        }
                    }
                }
            }

            // ── Unlinked conversations & memories ───────────────────────
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.data.unlinked.title")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            font.bold: true
                            wrapMode: Text.WordWrap
                            color: Theme.textPrimary
                        }
                        ABadge {
                            variant: "warning"
                            text: I18n.tr("shell.data.unlinked.badge")
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.data.unlinked.description")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    AEmptyState {
                        Layout.fillWidth: true
                        icon: "👻"
                        title: I18n.tr("shell.data.unlinked.emptyTitle")
                        subtitle: I18n.tr("shell.data.unlinked.emptySubtitle")
                    }
                }
            }

            // ── Legacy single-file JSON tools (collapsible) ────────────
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.data.legacy.title")
                            font.family: Theme.fontBody
                            font.pixelSize: 13
                            font.bold: true
                            wrapMode: Text.WordWrap
                            color: Theme.textPrimary
                        }
                        AButton {
                            variant: AButton.Ghost
                            text: (page.showLegacyTools ? "▲ " : "▼ ") + I18n.tr(page.showLegacyTools ? "shell.data.legacy.hide" : "shell.data.legacy.show")
                            onClicked: page.showLegacyTools = !page.showLegacyTools
                        }
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        visible: page.showLegacyTools
                        spacing: Theme.spacingS

                        DomainToolRow {
                            titleKey: "shell.data.legacy.chatsTitle"
                            descriptionKey: "shell.data.legacy.chatsDescription"
                            showDelete: true
                            onExportClicked: page.showNotWiredNotice()
                            onImportClicked: page.showNotWiredNotice()
                            onDeleteClicked: page.confirmDestructive()
                        }
                        ASeparator { Layout.fillWidth: true }
                        DomainToolRow {
                            titleKey: "shell.data.legacy.charactersTitle"
                            descriptionKey: "shell.data.legacy.charactersDescription"
                            onExportClicked: page.showNotWiredNotice()
                            onImportClicked: page.showNotWiredNotice()
                        }
                        ASeparator { Layout.fillWidth: true }
                        DomainToolRow {
                            titleKey: "shell.data.legacy.memoryTitle"
                            descriptionKey: "shell.data.legacy.memoryDescription"
                            onExportClicked: page.showNotWiredNotice()
                            onImportClicked: page.showNotWiredNotice()
                        }
                        ASeparator { Layout.fillWidth: true }
                        DomainToolRow {
                            titleKey: "shell.data.legacy.backgroundsTitle"
                            descriptionKey: "shell.data.legacy.backgroundsDescription"
                            onExportClicked: page.showNotWiredNotice()
                            onImportClicked: page.showNotWiredNotice()
                        }
                    }
                }
            }

            // ── Models & modules ───────────────────────────────────────
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.data.models.title")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                color: Theme.textPrimary
                            }
                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.data.models.description")
                                font.family: Theme.fontBody
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                                color: Theme.textSecondary
                            }
                        }

                        AButton {
                            variant: AButton.Danger
                            text: I18n.tr("shell.data.models.delete")
                            onClicked: page.confirmDestructive()
                        }
                    }

                    ASeparator { Layout.fillWidth: true }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.data.modules.title")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                color: Theme.textPrimary
                            }
                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.data.modules.description")
                                font.family: Theme.fontBody
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                                color: Theme.textSecondary
                            }
                        }

                        AButton {
                            variant: AButton.Default
                            text: I18n.tr("shell.data.modules.reset")
                            onClicked: page.confirmDestructive()
                        }
                    }
                }
            }

            // ── Danger zone ────────────────────────────────────────────
            ACard {
                Layout.fillWidth: true
                borderColor: Theme.error

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.data.danger.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.error
                    }
                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.data.danger.description")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        wrapMode: Text.WordWrap
                        color: Theme.error
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.data.danger.providersTitle")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                font.bold: true
                                color: Theme.textPrimary
                            }
                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.data.danger.providersDescription")
                                font.family: Theme.fontBody
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                                color: Theme.textSecondary
                            }
                        }

                        AButton {
                            variant: AButton.Danger
                            text: I18n.tr("shell.data.danger.providersReset")
                            onClicked: page.confirmDestructive()
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.data.danger.allTitle")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                font.bold: true
                                color: Theme.textPrimary
                            }
                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.data.danger.allDescription")
                                font.family: Theme.fontBody
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                                color: Theme.textSecondary
                            }
                        }

                        AButton {
                            variant: AButton.Danger
                            text: I18n.tr("shell.data.danger.allDelete")
                            onClicked: page.confirmDestructive()
                        }
                    }
                }
            }

            // ── Desktop shell state ────────────────────────────────────
            ACard {
                Layout.fillWidth: true
                borderColor: Theme.warning

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.data.desktop.title")
                            font.family: Theme.fontBody
                            font.pixelSize: 13
                            font.bold: true
                            color: Theme.textPrimary
                        }
                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.data.desktop.description")
                            font.family: Theme.fontBody
                            font.pixelSize: 11
                            wrapMode: Text.WordWrap
                            color: Theme.textSecondary
                        }
                    }

                    AButton {
                        variant: AButton.Default
                        text: I18n.tr("shell.data.desktop.reset")
                        onClicked: page.confirmDestructive()
                    }
                }
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }


    // Single confirmation dialog for every (currently no-op) destructive action.
    AModal {
        id: confirmActionDialog

        title: I18n.tr("shell.data.confirm.title")

        Text {
            Layout.fillWidth: true
            text: I18n.tr("shell.data.confirm.notWiredBody")
            font.family: Theme.fontBody
            font.pixelSize: 12
            wrapMode: Text.WordWrap
            color: Theme.textPrimary
        }

        RowLayout {
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingS

            AButton {
                variant: AButton.Ghost
                text: I18n.tr("shell.data.confirm.cancel")
                onClicked: confirmActionDialog.close()
            }
            AButton {
                variant: AButton.Danger
                text: I18n.tr("shell.data.confirm.confirm")
                onClicked: {
                    confirmActionDialog.close()
                    page.showNotWiredNotice()
                }
            }
        }
    }

    DataExportDialog {
        id: exportDialog
    }

    DataImportDialog {
        id: importDialog
    }

    ScrubHistoryDialog {
        id: scrubDialog
    }
}
