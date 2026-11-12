// SPDX-License-Identifier: GPL-3.0-or-later
// Card library page: searchable list of imported CCv2/CCv3 cards
// (`<profile>/cards/*.png|*.json`, scanned by the same code the chat lane
// uses) with import ("Add card" dialog), delete (with confirmation), a
// per-row "use in chat" toggle (persisted via settings/cards), and edit
// hand-off to the editor page.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15
import QtQuick.Dialogs
import com.airi.airiqt 1.0

Item {
    id: page

    /// Raise when the user presses Edit on a row; carries the card id.
    signal editCard(string id)
    /// Raise when the user presses New card; the editor page opens empty.
    signal createCard()

    CardController {
        id: controller
    }

    Connections {
        target: controller
        function onCardsChanged() { page.syncFromBridge() }
    }

    property var cards: []
    property string filterText: ""
    property string deleteTargetId: ""
    property string errorMessage: ""
    property string statusMessage: ""
    property var exportTargetCard: null

    readonly property var visibleCards: {
        var needle = page.filterText.trim().toLowerCase()
        if (needle.length === 0)
            return page.cards
        return page.cards.filter(function (entry) {
            return entry.name.toLowerCase().indexOf(needle) >= 0
                || entry.greeting.toLowerCase().indexOf(needle) >= 0
                || entry.id.toLowerCase().indexOf(needle) >= 0
        })
    }

    // Pull state out of the bridge without re-triggering a rescan.
    function syncFromBridge() {
        var parsed = []
        try {
            parsed = JSON.parse(controller.cardsJson)
        } catch (e) {
            console.log("[airi-qt] cards: failed to parse card list:", e)
        }
        page.cards = parsed
        page.errorMessage = controller.error
    }

    // Re-scan the cards directories via the bridge.
    function refresh() {
        controller.refresh()
    }

    function localPath(url) {
        var s = url.toString()
        if (s.indexOf("file://") !== 0)
            return s
        s = decodeURIComponent(s.substring(7))
        if (s.startsWith("/") === false && s.charAt(0) === "/")
            s = s.substring(0)
        return s
    }

    function fileName(path) {
        var idx = path.lastIndexOf("/")
        return idx >= 0 ? path.substring(idx + 1) : path
    }

    // Transient status (e.g. "card exported"); cleared by statusTimer.
    Timer {
        id: statusTimer
        interval: 4000
        onTriggered: page.statusMessage = ""
    }

    Component.onCompleted: refresh()

    // Export the pending card to `destination` (byte copy — the bridge
    // resolves the file via the same path the load path uses).
    function exportCard(destination) {
        if (!page.exportTargetCard)
            return
        var ok = controller.exportCardToFile(page.exportTargetCard.id, destination)
        exportDialog.close()
        if (ok) {
            page.errorMessage = ""
            page.statusMessage = I18n.tr("shell.cards.exportDone")
            statusTimer.restart()
        } else {
            page.statusMessage = ""
            page.errorMessage = controller.error
        }
    }

    function openExport(cardEntry) {
        page.exportTargetCard = cardEntry
        exportDialog.openFor(cardEntry)
    }

    FileDialog {
        id: importDialog
        title: I18n.tr("shell.cards.importDialogTitle")
        nameFilters: ["*.png", "*.json"]
        onAccepted: controller.importCard(page.localPath(file))
    }

    CardExportDialog {
        id: exportDialog
        onExportRequested: function (destination) { page.exportCard(destination) }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spacingM
        spacing: Theme.spacingS

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingS

            Text {
                text: I18n.tr("shell.cards.title")
                color: Theme.textPrimary
                font.pixelSize: 16
                font.bold: true
                Layout.alignment: Qt.AlignVCenter
            }

            Item { Layout.fillWidth: true }

            ATextField {
                Layout.preferredWidth: 200
                Layout.alignment: Qt.AlignVCenter
                placeholderText: I18n.tr("shell.cards.searchPlaceholder")
                text: page.filterText
                onTextChanged: page.filterText = text
            }

            AButton {
                text: I18n.tr("shell.cards.import")
                onClicked: importDialog.open()
            }
            AButton {
                text: I18n.tr("shell.cards.new")
                onClicked: page.createCard()
            }
            AButton {
                text: I18n.tr("shell.cards.refresh")
                onClicked: page.refresh()
            }
        }

        Text {
            visible: page.errorMessage.length > 0
            text: page.errorMessage
            color: Theme.error
            font.pixelSize: 11
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
        }

        Text {
            visible: page.statusMessage.length > 0
            text: page.statusMessage
            color: Theme.success
            font.pixelSize: 11
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
        }

        ListView {
            id: listView
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: Theme.spacingS
            clip: true
            model: page.visibleCards

            delegate: Rectangle {
                id: row
                width: listView.width
                implicitHeight: 72
                radius: Theme.radiusM
                color: Theme.surface
                border.color: Theme.border

                required property var modelData

                readonly property bool isActive: modelData.id === controller.activeCardId

                readonly property string avatarSource: modelData.kind === "png"
                    ? "file://" + modelData.path.replace(/ /g, "%20")
                    : ""

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: Theme.spacingS
                    spacing: Theme.spacingM

                    Rectangle {
                        Layout.preferredWidth: 52
                        Layout.preferredHeight: 52
                        radius: Theme.radiusM
                        color: Theme.surfaceHover
                        clip: true

                        Image {
                            id: avatarImage
                            anchors.fill: parent
                            fillMode: Image.PreserveAspectCrop
                            source: row.avatarSource
                            asynchronous: true
                            visible: row.avatarSource.length > 0 && status !== Image.Error
                        }
                        Text {
                            anchors.centerIn: parent
                            visible: !avatarImage.visible || avatarImage.status === Image.Error
                            text: row.modelData.name.length > 0 ? row.modelData.name.charAt(0).toUpperCase() : "?"
                            color: Theme.textSecondary
                            font.pixelSize: 22
                            font.bold: true
                        }
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        Text {
                            text: row.modelData.name
                            color: Theme.textPrimary
                            font.pixelSize: 14
                            font.bold: true
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                        Text {
                            text: row.modelData.greeting.length > 0 ? row.modelData.greeting : I18n.tr("shell.cards.noGreeting")
                            color: Theme.textSecondary
                            font.pixelSize: 11
                            elide: Text.ElideRight
                            maximumLineCount: 2
                            wrapMode: Text.WrapAnywhere
                            Layout.fillWidth: true
                        }
                        Text {
                            text: row.modelData.kind === "png" ? row.modelData.path : I18n.tr("shell.cards.jsonCard")
                            color: Theme.textSecondary
                            font.pixelSize: 9
                            elide: Text.ElideLeft
                            Layout.fillWidth: true
                        }
                    }

                    AButton {
                        text: row.isActive ? "✓ " + I18n.tr("shell.cards.active") : I18n.tr("shell.cards.use")
                        enabled: !row.isActive
                        onClicked: controller.setActiveCard(row.modelData.id)
                    }
                    AButton {
                        text: I18n.tr("shell.cards.edit")
                        onClicked: page.editCard(row.modelData.id)
                    }
                    AButton {
                        text: I18n.tr("shell.cards.export")
                        onClicked: page.openExport(row.modelData)
                    }
                    AButton {
                        text: I18n.tr("shell.cards.delete")
                        onClicked: {
                            page.deleteTargetId = row.modelData.id
                            deleteConfirm.open()
                        }
                    }
                }
            }

            footer: Item {
                visible: listView.count === 0
                height: listView.count === 0 ? 120 : 0
                ColumnLayout {
                    anchors.centerIn: parent
                    spacing: 4
                    Text {
                        text: I18n.tr("shell.cards.emptyTitle")
                        color: Theme.textPrimary
                        font.pixelSize: 14
                        font.bold: true
                    }
                    Text {
                        text: I18n.tr("shell.cards.emptyBody")
                        color: Theme.textSecondary
                        font.pixelSize: 11
                    }
                }
            }
        }
    }

    AModal {
        id: deleteConfirm
        title: I18n.tr("shell.cards.deleteTitle")

        ColumnLayout {
            spacing: Theme.spacingS
            Text {
                text: I18n.tr("shell.cards.deleteBody")
                color: Theme.textPrimary
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
            RowLayout {
                Layout.alignment: Qt.AlignRight
                AButton {
                    text: I18n.tr("shell.cards.cancel")
                    onClicked: deleteConfirm.close()
                }
                AButton {
                    text: I18n.tr("shell.cards.delete")
                    onClicked: {
                        controller.deleteCard(page.deleteTargetId)
                        deleteConfirm.close()
                    }
                }
            }
        }
    }
}
