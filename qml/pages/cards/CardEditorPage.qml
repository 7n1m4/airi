// SPDX-License-Identifier: GPL-3.0-or-later
// Card editor page: edits a CCv2/CCv3 character card. Loads by id (file stem)
// from the scanned card dirs; `cardId` empty opens the "new card" form. Saves
// back through the CardController bridge — PNG cards get their embedded
// payload rewritten in-place (avatar pixels preserved), JSON cards are
// re-serialized. Unknown card keys and AIRI extension data are preserved.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

Item {
    id: page

    /// File-stem id of the card to edit; "" opens the new-card form.
    property string cardId: ""
    /// Absolute path of the loaded card ("" for a new card).
    property string cardPath: ""
    /// "png" or "json"; empty for a new card.
    property string cardKind: ""

    /// Emitted after a successful save; carries the saved id (or "" for new).
    signal saved(string id)
    /// Emitted when the user abandons editing.
    signal cancelled()

    CardController {
        id: controller
    }

    property string errorMessage: ""
    property bool busy: false

    // Form fields (mirror the CCv2/CCv3 card envelope the bridge re-applies).
    property string fName: ""
    property string fDescription: ""
    property string fPersonality: ""
    property string fScenario: ""
    property string fFirstMes: ""
    property string fAltGreetings: ""
    property string fMesExample: ""
    property string fSystemPrompt: ""
    property string fPostHistory: ""
    property string fCreator: ""
    property string fCreatorNotes: ""
    property string fCharacterVersion: ""
    property string fTags: ""

    function clearFields() {
        page.cardPath = ""
        page.cardKind = ""
        page.errorMessage = ""
        page.fName = ""
        page.fDescription = ""
        page.fPersonality = ""
        page.fScenario = ""
        page.fFirstMes = ""
        page.fAltGreetings = ""
        page.fMesExample = ""
        page.fSystemPrompt = ""
        page.fPostHistory = ""
        page.fCreator = ""
        page.fCreatorNotes = ""
        page.fCharacterVersion = ""
        page.fTags = ""
    }

    function reload() {
        page.errorMessage = ""
        if (page.cardId.length === 0) {
            page.clearFields()
            return
        }
        var raw = controller.loadCard(page.cardId)
        if (!raw || raw.length === 0) {
            page.errorMessage = I18n.tr("shell.cards.editor.loadError")
            return
        }
        var card = null
        try {
            card = JSON.parse(raw)
        } catch (e) {
            console.log("[airi-qt] cards: failed to parse editor payload:", e)
            page.errorMessage = I18n.tr("shell.cards.editor.loadError")
            return
        }
        page.cardPath = card.path || ""
        page.cardKind = card.kind || "json"
        page.fName = card.name || ""
        page.fDescription = card.description || ""
        page.fPersonality = card.personality || ""
        page.fScenario = card.scenario || ""
        page.fFirstMes = card.firstMes || ""
        page.fAltGreetings = (card.alternateGreetings || []).join("\n")
        page.fMesExample = card.mesExample || ""
        page.fSystemPrompt = card.systemPrompt || ""
        page.fPostHistory = card.postHistoryInstructions || ""
        page.fCreator = card.creator || ""
        page.fCreatorNotes = card.creatorNotes || ""
        page.fCharacterVersion = card.characterVersion || ""
        page.fTags = (card.tags || []).join(", ")
    }

    function buildFieldsJson() {
        var altGreetings = page.fAltGreetings.split("\n")
            .map(function (s) { return s.trim() })
            .filter(function (s) { return s.length > 0 })
        var tags = page.fTags.split(",")
            .map(function (s) { return s.trim() })
            .filter(function (s) { return s.length > 0 })
        return JSON.stringify({
            "path": page.cardId.length > 0 ? page.cardPath : null,
            "name": page.fName.trim(),
            "description": page.fDescription,
            "personality": page.fPersonality,
            "scenario": page.fScenario,
            "firstMes": page.fFirstMes,
            "alternateGreetings": altGreetings,
            "mesExample": page.fMesExample,
            "systemPrompt": page.fSystemPrompt,
            "postHistoryInstructions": page.fPostHistory,
            "creator": page.fCreator,
            "creatorNotes": page.fCreatorNotes,
            "characterVersion": page.fCharacterVersion,
            "tags": tags
        })
    }

    function save() {
        page.errorMessage = ""
        if (page.fName.trim().length === 0) {
            page.errorMessage = I18n.tr("shell.cards.editor.nameRequired")
            return
        }
        page.busy = true
        var ok = controller.saveCard(page.buildFieldsJson())
        page.busy = false
        if (!ok) {
            page.errorMessage = controller.error.length > 0
                ? controller.error
                : I18n.tr("shell.cards.editor.saveError")
            return
        }
        page.saved(page.cardId)
    }

    Component.onCompleted: reload()
    onCardIdChanged: reload()

    Flickable {
        id: flick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.height
        clip: true

        ColumnLayout {
            id: column
            width: flick.width - 2 * Theme.spacingM
            x: Theme.spacingM
            y: Theme.spacingM
            spacing: Theme.spacingM

            RowLayout {
                Layout.fillWidth: true

                Text {
                    text: page.cardId.length > 0
                        ? I18n.tr("shell.cards.editor.title")
                        : I18n.tr("shell.cards.editor.newTitle")
                    color: Theme.textPrimary
                    font.pixelSize: 16
                    font.bold: true
                }
                Item { Layout.fillWidth: true }
                Text {
                    visible: page.cardKind.length > 0
                    text: page.cardKind.toUpperCase()
                    color: Theme.accent
                    font.pixelSize: 10
                    font.bold: true
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

            ACard {
                Layout.fillWidth: true
                ColumnLayout {
                    anchors.fill: parent
                    spacing: Theme.spacingS

                    ATextField {
                        Layout.fillWidth: true
                        placeholderText: I18n.tr("shell.cards.fields.name")
                        text: page.fName
                        onTextChanged: page.fName = text
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS
                        ATextField {
                            Layout.fillWidth: true
                            placeholderText: I18n.tr("shell.cards.fields.creator")
                            text: page.fCreator
                            onTextChanged: page.fCreator = text
                        }
                        ATextField {
                            Layout.preferredWidth: 160
                            placeholderText: I18n.tr("shell.cards.fields.characterVersion")
                            text: page.fCharacterVersion
                            onTextChanged: page.fCharacterVersion = text
                        }
                    }

                    ATextArea {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 72
                        placeholderText: I18n.tr("shell.cards.fields.description")
                        text: page.fDescription
                        onTextChanged: page.fDescription = text
                    }
                    ATextArea {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 56
                        placeholderText: I18n.tr("shell.cards.fields.personality")
                        text: page.fPersonality
                        onTextChanged: page.fPersonality = text
                    }
                    ATextArea {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 56
                        placeholderText: I18n.tr("shell.cards.fields.scenario")
                        text: page.fScenario
                        onTextChanged: page.fScenario = text
                    }
                }
            }

            Text {
                text: I18n.tr("shell.cards.sections.dialogue")
                color: Theme.textSecondary
                font.pixelSize: 11
                font.bold: true
            }

            ACard {
                Layout.fillWidth: true
                ColumnLayout {
                    anchors.fill: parent
                    spacing: Theme.spacingS

                    ATextArea {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 72
                        placeholderText: I18n.tr("shell.cards.fields.firstMes")
                        text: page.fFirstMes
                        onTextChanged: page.fFirstMes = text
                    }
                    ATextArea {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 96
                        placeholderText: I18n.tr("shell.cards.fields.alternateGreetings")
                        text: page.fAltGreetings
                        onTextChanged: page.fAltGreetings = text
                    }
                    ATextArea {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 72
                        placeholderText: I18n.tr("shell.cards.fields.mesExample")
                        text: page.fMesExample
                        onTextChanged: page.fMesExample = text
                    }
                }
            }

            Text {
                text: I18n.tr("shell.cards.sections.behavior")
                color: Theme.textSecondary
                font.pixelSize: 11
                font.bold: true
            }

            ACard {
                Layout.fillWidth: true
                ColumnLayout {
                    anchors.fill: parent
                    spacing: Theme.spacingS

                    ATextArea {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 64
                        placeholderText: I18n.tr("shell.cards.fields.systemPrompt")
                        text: page.fSystemPrompt
                        onTextChanged: page.fSystemPrompt = text
                    }
                    ATextArea {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 64
                        placeholderText: I18n.tr("shell.cards.fields.postHistoryInstructions")
                        text: page.fPostHistory
                        onTextChanged: page.fPostHistory = text
                    }
                }
            }

            Text {
                text: I18n.tr("shell.cards.sections.metadata")
                color: Theme.textSecondary
                font.pixelSize: 11
                font.bold: true
            }

            ACard {
                Layout.fillWidth: true
                ColumnLayout {
                    anchors.fill: parent
                    spacing: Theme.spacingS

                    ATextField {
                        Layout.fillWidth: true
                        placeholderText: I18n.tr("shell.cards.fields.tags")
                        text: page.fTags
                        onTextChanged: page.fTags = text
                    }
                    ATextArea {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 56
                        placeholderText: I18n.tr("shell.cards.fields.creatorNotes")
                        text: page.fCreatorNotes
                        onTextChanged: page.fCreatorNotes = text
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                Layout.bottomMargin: Theme.spacingM

                Item { Layout.fillWidth: true }
                AButton {
                    text: I18n.tr("shell.cards.cancel")
                    onClicked: page.cancelled()
                }
                AButton {
                    variant: AButton.Accent
                    enabled: !page.busy
                    text: page.busy ? I18n.tr("shell.cards.editor.saving") : I18n.tr("shell.cards.save")
                    onClicked: page.save()
                }
            }
        }
    }
}
