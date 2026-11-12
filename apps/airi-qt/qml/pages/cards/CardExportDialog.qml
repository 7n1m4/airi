// SPDX-License-Identifier: GPL-3.0-or-later
// Card export dialog: byte-copies the card file to a user-chosen location.
// Mirrors the Electron CardExportDialog intent (download-as-file) with the
// Qt idiom — the bridge does a plain file copy (PNG cards keep their
// embedded tEXt chunks, JSON cards are copied as-is; nothing is
// re-serialized). The actual destination is confirmed in a SaveFile
// FileDialog; existing files are overwritten after that confirmation.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Dialogs
import QtCore
import com.airi.airiqt 1.0

AModal {
    id: dialog

    title: I18n.tr("shell.cards.exportDialogTitle")

    /// Card entry to export; set via openFor(). Shape: {id, name, kind, path}.
    property var card: null
    /// Extension of the underlying card file ("png" | "json").
    property string ext: "json"

    /// Raise when the user confirms a destination in the SaveFile dialog.
    /// Carries the absolute local file path. The page performs the copy.
    signal exportRequested(string destination)

    function extForCard(entry) {
        var kind = entry && entry.kind ? String(entry.kind).toLowerCase() : ""
        if (kind === "png" || kind === "json")
            return kind
        var path = entry && entry.path ? String(entry.path) : ""
        var dot = path.lastIndexOf(".")
        if (dot >= 0) {
            let e = path.substring(dot + 1).toLowerCase()
            if (e === "png" || e === "json")
                return e
        }
        return "json"
    }

    function suggestedFileName(entry) {
        var base = entry && entry.name ? String(entry.name).trim() : ""
        // Strip characters that are hostile to file names on every platform.
        base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        base = base.replace(/[. ]+$/, "")
        if (base.length === 0)
            base = "card"
        var lower = base.toLowerCase()
        if (lower.length >= dialog.ext.length + 1
            && lower.slice(lower.length - dialog.ext.length - 1) === "." + dialog.ext)
            return base
        return base + "." + dialog.ext
    }

    function localPath(url) {
        var s = String(url)
        if (s.indexOf("file://") === 0)
            s = decodeURIComponent(s.substring(7))
        // Windows: file:///C:/path -> /C:/path -> C:/path
        if (s.length >= 3 && s.charAt(0) === "/" && s.charAt(2) === ":")
            s = s.substring(1)
        return s
    }

    /// Open the dialog for `cardEntry` (a row model from CardLibraryPage).
    function openFor(cardEntry) {
        dialog.card = cardEntry
        dialog.ext = dialog.extForCard(cardEntry)
        fileNameField.text = dialog.suggestedFileName(cardEntry)
        dialog.open()
    }

    function openSaveDialog() {
        var name = fileNameField.text.trim()
        if (name.length === 0)
            return
        var folder = StandardPaths.writableLocation(StandardPaths.DocumentsLocation)
        if (folder && folder.toString().length > 0) {
            let s = folder.toString()
            if (s.charAt(s.length - 1) !== "/")
                s += "/"
            saveFileDialog.currentFolder = folder
            saveFileDialog.selectedFile = s + encodeURIComponent(name)
        }
        saveFileDialog.open()
    }

    Text {
        Layout.fillWidth: true
        text: I18n.tr("shell.cards.exportHint")
        font.family: Theme.fontBody
        font.pixelSize: 12
        wrapMode: Text.WordWrap
        color: Theme.textSecondary
    }

    Text {
        Layout.fillWidth: true
        text: I18n.tr("shell.cards.exportFileName")
        font.family: Theme.fontBody
        font.pixelSize: 11
        font.bold: true
        color: Theme.textSecondary
    }

    ATextField {
        id: fileNameField
        Layout.fillWidth: true
        selectByMouse: true
        onAccepted: dialog.openSaveDialog()
    }

    RowLayout {
        Layout.fillWidth: true
        AButton {
            variant: AButton.Ghost
            text: I18n.tr("shell.cards.cancel")
            onClicked: dialog.close()
        }
        Item { Layout.fillWidth: true }
        AButton {
            variant: AButton.Accent
            enabled: fileNameField.text.trim().length > 0
            text: I18n.tr("shell.cards.export")
            onClicked: dialog.openSaveDialog()
        }
    }

    FileDialog {
        id: saveFileDialog
        title: I18n.tr("shell.cards.exportDialogTitle")
        fileMode: FileDialog.SaveFile
        defaultSuffix: dialog.ext
        nameFilters: dialog.ext === "png"
            ? [I18n.tr("shell.cards.exportFilterPng"), I18n.tr("shell.cards.exportFilterAll")]
            : [I18n.tr("shell.cards.exportFilterJson"), I18n.tr("shell.cards.exportFilterAll")]
        onAccepted: dialog.exportRequested(dialog.localPath(selectedFile))
    }
}
