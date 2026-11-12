// SPDX-License-Identifier: GPL-3.0-or-later
// Export Data Archive dialog: port of the Vue ExportVaultModal.
// The domain switches are live (selection drives the estimated-size row and
// the archive contents). Confirm writes a real stored-ZIP archive via the
// DataController bridge (chats/memory/providers/cards as selected) and shows
// where it landed — or the backend's error message if anything fails.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

AModal {
    id: page

    title: I18n.tr("shell.data.exportDialog.title")

    // One live flag per export domain. No backend yet, so no byte stats.
    property bool selCharacters: true
    property bool selChatSessions: true
    property bool selMemory: true
    property bool selProviders: true
    property bool selBackgrounds: false

    property bool copiedBanner: false
    property string resultText: ""
    property bool resultOk: false
    property bool resultVisible: false

    DataController {
        id: dataCtl
    }

    function humanBytes(n) {
        if (n >= 1048576)
            return (n / 1048576).toFixed(1) + " MB"
        if (n >= 1024)
            return (n / 1024).toFixed(1) + " KB"
        return n + " B"
    }

    function selectionBytes() {
        var bytes = {}
        try {
            bytes = JSON.parse(dataCtl.statsJson)
        } catch (e) {
            bytes = {}
        }
        var domains = (bytes && bytes.domains) ? bytes.domains : []
        var total = 0
        for (var i = 0; i < domains.length; ++i) {
            var d = domains[i]
            var wanted = d.id === "chats" ? page.selChatSessions
                : d.id === "memory" ? page.selMemory
                : d.id === "providers" ? page.selProviders
                : d.id === "characters" ? page.selCharacters
                : page.selBackgrounds
            if (wanted)
                total += d.bytes || 0
        }
        return total
    }

    function selectionBytesLabel() {
        var total = page.selectionBytes()
        if (total <= 0)
            return I18n.tr("shell.data.exportDialog.sizeUnknown")
        return page.humanBytes(total)
    }

    function runExport() {
        var payload = JSON.stringify({
            characters: page.selCharacters,
            chats: page.selChatSessions,
            memory: page.selMemory,
            providers: page.selProviders,
            backgrounds: page.selBackgrounds
        })
        var raw = dataCtl.exportVault(payload, "")
        var result = null
        try {
            result = JSON.parse(raw)
        } catch (e) {
            result = { error: "unexpected bridge response" }
        }
        if (result && result.error) {
            page.resultOk = false
            page.resultText = result.error
        } else if (result && result.path) {
            page.resultOk = true
            page.resultText = I18n.tr("shell.data.status.exportDone") + " " + result.path
                + " (" + page.humanBytes(result.bytes || 0) + ")"
        }
        page.resultVisible = true
    }

    Component.onCompleted: dataCtl.refreshStats()

    readonly property bool chatOrMemoryWithoutCharacters:
        (page.selChatSessions || page.selMemory) && !page.selCharacters

    // Deterministic placeholder: fixed key order, no timestamps, no user data.
    function buildPlaceholderManifest() {
        var manifest = {
            "airi-export-placeholder": true,
            "note": "UI-only placeholder emitted by the QML data page. No user data is included. The real archive writer arrives with the wave ④ data bridge.",
            "domains": {
                "characters": page.selCharacters,
                "chatSessions": page.selChatSessions,
                "memory": page.selMemory,
                "providers": page.selProviders,
                "settings": page.selProviders,
                "backgrounds": page.selBackgrounds
            }
        }
        return JSON.stringify(manifest, null, 2)
    }

    function copyPlaceholderManifest() {
        clipboardHelper.text = page.buildPlaceholderManifest()
        clipboardHelper.selectAll()
        clipboardHelper.copy()
        page.copiedBanner = true
    }

    // Domain row helper kept inline to match the settings-page idiom.
    component DomainRow: Rectangle {
        id: root

        property string titleKey: ""
        property string hintKey: ""
        property bool checked: false
        signal toggled(bool value)

        Layout.fillWidth: true
        implicitHeight: row.implicitHeight + 2 * Theme.spacingM
        radius: Theme.radiusM
        color: Theme.surfaceHover
        border.width: 1
        border.color: Theme.border

        RowLayout {
            id: row
            anchors.fill: parent
            anchors.margins: Theme.spacingM
            spacing: Theme.spacingM

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2

                Text {
                    Layout.fillWidth: true
                    text: I18n.tr(root.titleKey)
                    font.family: Theme.fontBody
                    font.pixelSize: 13
                    font.bold: true
                    color: Theme.textPrimary
                }
                Text {
                    Layout.fillWidth: true
                    text: I18n.tr(root.hintKey)
                    font.family: Theme.fontBody
                    font.pixelSize: 11
                    wrapMode: Text.WordWrap
                    color: Theme.textSecondary
                }
            }

            Text {
                text: "—"
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textSecondary
            }

            ASwitch {
                checked: root.checked
                onToggled: root.toggled(checked)
            }
        }
    }

    Text {
        Layout.fillWidth: true
        text: I18n.tr("shell.data.exportDialog.subtitle")
        font.family: Theme.fontBody
        font.pixelSize: 12
        wrapMode: Text.WordWrap
        color: Theme.textSecondary
    }

    DomainRow {
        titleKey: "shell.data.exportDialog.characters"
        hintKey: "shell.data.exportDialog.charactersHint"
        checked: page.selCharacters
        onToggled: function (value) { page.selCharacters = value }
    }

    DomainRow {
        titleKey: "shell.data.exportDialog.chats"
        hintKey: "shell.data.exportDialog.chatsHint"
        checked: page.selChatSessions
        onToggled: function (value) { page.selChatSessions = value }
    }

    DomainRow {
        titleKey: "shell.data.exportDialog.memory"
        hintKey: "shell.data.exportDialog.memoryHint"
        checked: page.selMemory
        onToggled: function (value) { page.selMemory = value }
    }

    DomainRow {
        titleKey: "shell.data.exportDialog.providers"
        hintKey: "shell.data.exportDialog.providersHint"
        checked: page.selProviders
        onToggled: function (value) { page.selProviders = value }
    }

    DomainRow {
        titleKey: "shell.data.exportDialog.backgrounds"
        hintKey: "shell.data.exportDialog.backgroundsHint"
        checked: page.selBackgrounds
        onToggled: function (value) { page.selBackgrounds = value }
    }

    // Cross-domain linkage hint (live binding, works without a backend).
    Rectangle {
        Layout.fillWidth: true
        visible: page.chatOrMemoryWithoutCharacters
        implicitHeight: linkageText.implicitHeight + 2 * Theme.spacingS
        radius: Theme.radiusM
        color: Qt.rgba(Theme.warning.r, Theme.warning.g, Theme.warning.b, 0.12)
        border.width: 1
        border.color: Qt.rgba(Theme.warning.r, Theme.warning.g, Theme.warning.b, 0.4)

        Text {
            id: linkageText
            anchors.fill: parent
            anchors.margins: Theme.spacingS
            verticalAlignment: Text.AlignVCenter
            text: I18n.tr("shell.data.exportDialog.linkageWarning")
            font.family: Theme.fontBody
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            color: Theme.warning
        }
    }

    // Result banner (success or backend error; stays until dismissed).
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

    // Persistent confirmation after the placeholder manifest is copied.
    Rectangle {
        Layout.fillWidth: true
        visible: page.copiedBanner
        implicitHeight: copiedRow.implicitHeight + 2 * Theme.spacingS
        radius: Theme.radiusM
        color: Qt.rgba(Theme.success.r, Theme.success.g, Theme.success.b, 0.12)
        border.width: 1
        border.color: Qt.rgba(Theme.success.r, Theme.success.g, Theme.success.b, 0.4)

        RowLayout {
            id: copiedRow
            anchors.fill: parent
            anchors.margins: Theme.spacingS
            spacing: Theme.spacingS

            Text {
                Layout.fillWidth: true
                text: I18n.tr("shell.data.status.placeholderCopied")
                font.family: Theme.fontBody
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                color: Theme.success
            }
            AButton {
                variant: AButton.Ghost
                text: "✕"
                implicitWidth: 28
                implicitHeight: 28
                leftPadding: 0
                rightPadding: 0
                onClicked: page.copiedBanner = false
            }
        }
    }

    // Hidden helper for clipboard access without a Rust bridge.
    // opacity-0 (not visible:false) keeps the selection/copy path alive.
    TextEdit {
        id: clipboardHelper
        width: 1
        height: 1
        opacity: 0
        text: ""
    }

    ASeparator {
        Layout.fillWidth: true
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingM

        Text {
            Layout.fillWidth: true
            text: I18n.tr("shell.data.exportDialog.estimatedSize") + " ≈ " + page.selectionBytesLabel()
            font.family: Theme.fontBody
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            color: Theme.textSecondary
        }

        AButton {
            variant: AButton.Ghost
            text: I18n.tr("shell.data.exportDialog.copyPlaceholder")
            onClicked: page.copyPlaceholderManifest()
        }
    }

    RowLayout {
        Layout.alignment: Qt.AlignRight
        spacing: Theme.spacingS

        AButton {
            variant: AButton.Ghost
            text: I18n.tr("shell.data.exportDialog.cancel")
            onClicked: page.close()
        }
        AButton {
            variant: AButton.Accent
            text: I18n.tr("shell.data.exportDialog.confirm")
            onClicked: page.runExport()
        }
    }
}
