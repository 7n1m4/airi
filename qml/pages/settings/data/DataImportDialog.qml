// SPDX-License-Identifier: GPL-3.0-or-later
// Universal Data Import dialog: port of the Vue ImportVaultModal.
// The dropzone, file picker and selection list are fully functional. Confirm
// inspects each selected archive via the DataController bridge and restores
// chats + memory (existing rows win; cards and credentials are not applied).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Dialogs
import com.airi.airiqt 1.0

AModal {
    id: page

    title: I18n.tr("shell.data.importDialog.title")

    property var selectedFileNames: []
    property var selectedFilePaths: []
    property bool isDragging: false
    property bool resultVisible: false
    property bool resultOk: false
    property string resultText: ""

    DataController {
        id: dataCtl
    }

    function localPath(url) {
        var s = String(url)
        if (s.indexOf("file://") === 0)
            s = decodeURIComponent(s.substring(7))
        if (s.length >= 3 && s.charAt(0) === "/" && s.charAt(2) === ":")
            s = s.substring(1) // Windows drive letters
        return s
    }

    function runImport() {
        var summaries = []
        var ok = true
        for (var i = 0; i < page.selectedFilePaths.length; ++i) {
            var raw = dataCtl.commitVaultImport(page.selectedFilePaths[i])
            var report = null
            try {
                report = JSON.parse(raw)
            } catch (e) {
                report = { error: "unexpected bridge response" }
            }
            if (report && report.error) {
                ok = false
                summaries.push(page.basename(page.selectedFilePaths[i]) + ": " + report.error)
            } else if (report) {
                var line = page.basename(page.selectedFilePaths[i])
                    + ": +" + report.sessions_inserted + " sessions, +" + report.messages_inserted + " messages"
                if (report.not_applied && report.not_applied.length > 0)
                    line += " (not applied: " + report.not_applied.join(", ") + ")"
                summaries.push(line)
            }
        }
        page.resultOk = ok
        page.resultText = (ok ? I18n.tr("shell.data.status.importDone") + "\n" : "") + summaries.join("\n")
        page.resultVisible = true
    }

    readonly property bool hasSelection: page.selectedFileNames.length > 0

    function basename(path) {
        var parts = String(path).split(/[\\/]/)
        return parts[parts.length - 1]
    }

    function addUrls(urls) {
        var names = []
        var paths = []
        for (var i = 0; i < urls.length; ++i) {
            var path = page.localPath(urls[i])
            paths.push(path)
            names.push(page.basename(path))
        }
        page.selectedFileNames = names
        page.selectedFilePaths = paths
    }

    Text {
        Layout.fillWidth: true
        text: I18n.tr("shell.data.importDialog.subtitle")
        font.family: Theme.fontBody
        font.pixelSize: 12
        wrapMode: Text.WordWrap
        color: Theme.textSecondary
    }

    // Dropzone / browse target.
    Rectangle {
        id: dropzone
        Layout.fillWidth: true
        implicitHeight: 148
        radius: Theme.radiusL
        color: page.isDragging ? Qt.rgba(Theme.accent.r, Theme.accent.g, Theme.accent.b, 0.08) : "transparent"
        border.width: 2
        border.color: page.isDragging ? Theme.accent : Theme.border

        // Inner hairline frame: dashed borders need custom painting, this reads
        // as the same "drop here" affordance without a Canvas.
        Rectangle {
            anchors.fill: parent
            anchors.margins: 4
            radius: Theme.radiusL
            color: "transparent"
            border.width: 1
            border.color: Theme.border
        }

        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: importFileDialog.open()
        }

        DropArea {
            anchors.fill: parent
            onEntered: page.isDragging = true
            onExited: page.isDragging = false
            onDropped: function (drop) {
                page.isDragging = false
                page.addUrls(drop.urls)
            }
        }

        ColumnLayout {
            anchors.centerIn: parent
            spacing: Theme.spacingS
            width: parent.width - 2 * Theme.spacingL

            Text {
                Layout.alignment: Qt.AlignHCenter
                text: "📦"
                font.pixelSize: 34
            }
            Text {
                Layout.alignment: Qt.AlignHCenter
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter
                text: I18n.tr("shell.data.importDialog.dropTitle")
                font.family: Theme.fontBody
                font.pixelSize: 13
                font.bold: true
                wrapMode: Text.WordWrap
                color: Theme.textPrimary
            }
            Text {
                Layout.alignment: Qt.AlignHCenter
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter
                text: I18n.tr("shell.data.importDialog.dropSubtitle")
                font.family: Theme.fontBody
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                color: Theme.textSecondary
            }
        }
    }

    RowLayout {
        Layout.alignment: Qt.AlignHCenter

        AButton {
            variant: AButton.Default
            text: I18n.tr("shell.data.importDialog.browse")
            onClicked: importFileDialog.open()
        }
    }

    // Selected files (names only — nothing is read until the backend lands).
    ColumnLayout {
        Layout.fillWidth: true
        visible: page.hasSelection
        spacing: 2

        Text {
            Layout.fillWidth: true
            text: I18n.tr("shell.data.importDialog.selectedTitle")
            font.family: Theme.fontBody
            font.pixelSize: 11
            font.bold: true
            color: Theme.textSecondary
        }
        Repeater {
            model: page.selectedFileNames

            delegate: Text {
                required property string modelData

                Layout.fillWidth: true
                text: "• " + modelData
                font.family: Theme.fontBody
                font.pixelSize: 11
                elide: Text.ElideRight
                color: Theme.textPrimary
            }
        }
    }

    // Honest wave note (always visible — this dialog cannot inspect or write).
    Rectangle {
        Layout.fillWidth: true
        implicitHeight: waveNoteText.implicitHeight + 2 * Theme.spacingS
        radius: Theme.radiusM
        color: Qt.rgba(Theme.warning.r, Theme.warning.g, Theme.warning.b, 0.12)
        border.width: 1
        border.color: Qt.rgba(Theme.warning.r, Theme.warning.g, Theme.warning.b, 0.4)

        Text {
            id: waveNoteText
            anchors.fill: parent
            anchors.margins: Theme.spacingS
            verticalAlignment: Text.AlignVCenter
            text: I18n.tr("shell.data.importDialog.waveNote")
            font.family: Theme.fontBody
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            color: Theme.warning
        }
    }

    // Result banner (import outcome; stays until dismissed).
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

    ASeparator {
        Layout.fillWidth: true
    }

    RowLayout {
        Layout.alignment: Qt.AlignRight
        spacing: Theme.spacingS

        AButton {
            variant: AButton.Ghost
            text: I18n.tr("shell.data.importDialog.cancel")
            onClicked: page.close()
        }
        AButton {
            variant: AButton.Accent
            enabled: page.hasSelection
            text: I18n.tr("shell.data.importDialog.confirm")
            onClicked: page.runImport()
        }
    }

    FileDialog {
        id: importFileDialog
        title: I18n.tr("shell.data.importDialog.title")
        fileMode: FileDialog.OpenFiles
        nameFilters: [I18n.tr("shell.data.importDialog.filterVault"), I18n.tr("shell.data.importDialog.filterAll")]
        onAccepted: page.addUrls(selectedFiles)
    }
}
