// SPDX-License-Identifier: GPL-3.0-or-later
// Character card picker: lists imported cards (CCv2/CCv3) and applies one to
// new sessions (persona / system prompt / greeting / avatar).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Dialogs
import com.airi.airiqt 1.0

Item {
    id: picker

    required property var controller

    implicitHeight: content.implicitHeight

    property var cardIds: []
    property var cardNames: []
    property string importError: ""

    // Convert a file:// URL from a FileDialog to a local filesystem path.
    function localPath(url) {
        var s = url.toString()
        if (s.indexOf("file://") !== 0)
            return s
        s = decodeURIComponent(s.substring(7))
        // Windows: file:///C:/path -> /C:/path
        if (s.length >= 3 && s.charAt(0) === "/" && s.charAt(2) === ":")
            s = s.substring(1)
        return s
    }

    function importCardPicked() {
        var src = picker.localPath(importCardDialog.selectedFile)
        if (src.length === 0)
            return
        var dest = picker.controller.importCard(src)
        if (dest.length === 0) {
            picker.importError = I18n.tr("shell.chat.card-picker.import-error")
            return
        }
        picker.importError = ""
        picker.refresh()
    }

    function refresh() {
        picker.controller.listCards()
        var ids = []
        var names = []
        var model = picker.controller.cardsModel
        for (var i = 0; i < model.length; ++i) {
            // QObjectList is exposed as a JS array-like of QObjects
            ids.push(model[i].id)
            names.push(model[i].name)
        }
        picker.cardIds = ids
        picker.cardNames = names
    }

    function avatarUrl(path) {
        if (!path || path.length === 0)
            return ""
        return "file://" + encodeURI(path)
    }

    FileDialog {
        id: importCardDialog
        title: I18n.tr("shell.chat.card-picker.import")
        fileMode: FileDialog.OpenFile
        nameFilters: ["Cards (*.png *.json)", "All files (*)"]

        onAccepted: picker.importCardPicked()
    }

    Component.onCompleted: refresh()

    ColumnLayout {
        id: content
        width: parent.width
        spacing: Theme.spacingS

        // Active card chip, or the picker itself.
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingS
            visible: picker.controller.activeCardId.length > 0

            Rectangle {
                width: 26
                height: 26
                radius: 13
                color: Theme.surfacePressed
                clip: true

                Image {
                    anchors.fill: parent
                    source: picker.avatarUrl(picker.controller.activeCardAvatar)
                    fillMode: Image.PreserveAspectCrop
                    visible: picker.controller.activeCardAvatar.length > 0
                }

                Text {
                    anchors.centerIn: parent
                    text: picker.controller.assistantName.length > 0
                        ? picker.controller.assistantName.charAt(0).toUpperCase()
                        : "?"
                    font.pixelSize: 12
                    font.bold: true
                    color: Theme.textPrimary
                }
            }

            Text {
                text: picker.controller.assistantName
                font.family: Theme.fontBody
                font.pixelSize: 13
                font.bold: true
                color: Theme.textPrimary
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            AButton {
                text: "✕"
                variant: AButton.Ghost
                implicitWidth: 28
                implicitHeight: 26
                onClicked: picker.controller.clearCard()
            }
        }

        ASelect {
            id: select
            Layout.fillWidth: true
            visible: picker.controller.activeCardId.length === 0 && picker.cardNames.length > 0
            model: [I18n.tr("shell.chat.card-picker.none")].concat(picker.cardNames)
            onActivated: function(index) {
                if (index <= 0)
                    picker.controller.clearCard()
                else
                    picker.controller.activateCard(picker.cardIds[index - 1])
            }
        }

        AEmptyState {
            Layout.fillWidth: true
            visible: picker.controller.activeCardId.length === 0 && picker.cardNames.length === 0
            icon: "🎭"
            title: I18n.tr("shell.chat.card-picker.empty-title")
            subtitle: I18n.tr("shell.chat.card-picker.empty-subtitle")
        }

        RowLayout {
            AButton {
                variant: AButton.Ghost
                text: I18n.tr("shell.chat.card-picker.import")

                onClicked: importCardDialog.open()
            }

            Text {
                Layout.fillWidth: true
                visible: picker.importError.length > 0
                text: picker.importError
                font.family: Theme.fontBody
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                color: Theme.error
            }
        }
    }
}
