// SPDX-License-Identifier: GPL-3.0-or-later
// Speech — the speech settings surface. Merges the old /settings/modules/speech
// modules page and the /settings/providers/speech landing into one Qt page:
// a TTS provider picker (26 catalog rows from `airi-speech`'s TTS_PROVIDER_DEFS,
// port status shown straight from the crate), a voice/speed card, a sample
// synthesis card, and an honest STT placeholder. Persists through the
// SpeechController bridge (settings/speech). Sample files are written to disk
// and are not playable in-app yet. Speech-to-text clients are ported in
// airi-stt (whisper-local, OpenAI-compatible, Deepgram, Aliyun NLS) but the
// Qt hearing surface does not exist yet (manifest item #61).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

pragma ComponentBehavior: Bound

Item {
    id: page

    SpeechController {
        id: controller
    }

    property var defs: []
    property string sampleResult: ""
    property bool sampleFailed: false

    readonly property var selectedDef: {
        for (var i = 0; i < page.defs.length; ++i) {
            if (page.defs[i].id === controller.selectedProviderId)
                return page.defs[i]
        }
        return null
    }

    Component.onCompleted: {
        page.reloadDefs()
        controller.refresh()
        voiceField.text = controller.voice
    }

    Connections {
        target: controller
        function onStateChanged() { page.reloadDefs() }
    }

    function reloadDefs() {
        var parsed = []
        try {
            parsed = JSON.parse(controller.defsJson)
        } catch (e) {
            console.log("[airi-qt] speech: failed to parse defsJson:", e)
        }
        page.defs = parsed
    }

    function statusVariant(status) {
        switch (status) {
        case "ported": return "accent"
        case "partial": return "info"
        default: return "default"
        }
    }

    function statusLabel(status) {
        switch (status) {
        case "ported": return I18n.tr("shell.speech.status.ported")
        case "partial": return I18n.tr("shell.speech.status.partial")
        default: return I18n.tr("shell.speech.status.unsupported")
        }
    }

    function synthesizeSample() {
        var result = String(controller.synthesizeSample(sampleText.text))
        page.sampleResult = result
        page.sampleFailed = result.indexOf("error:") === 0
    }

    // Caption-style section header.
    component SectionCaption: Text {
        font.family: Theme.fontBody
        font.pixelSize: 12
        font.bold: true
        font.capitalization: Font.AllUppercase
        color: Theme.textSecondary
    }

    // Field label above an input.
    component FieldLabel: Text {
        font.family: Theme.fontBody
        font.pixelSize: 12
        font.bold: true
        color: Theme.textPrimary
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
            Text {
                text: I18n.tr("shell.speech.title")
                font.family: Theme.fontTitle
                font.pixelSize: 22
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 640
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.speech.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // ═════════════════════════════════════════════════════════════
            // PROVIDER PICKER
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.speech.providers.caption")
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    ListView {
                        id: providerList
                        Layout.fillWidth: true
                        implicitHeight: 420
                        clip: true
                        spacing: Theme.spacingS
                        model: page.defs

                        ScrollBar.vertical: ScrollBar {}

                        delegate: ACard {
                            id: defRow
                            required property var modelData
                            Layout.fillWidth: true
                            width: ListView.view ? ListView.view.width : implicitWidth

                            readonly property bool unsupported: defRow.modelData.status === "unsupported"
                            readonly property bool selected: controller.selectedProviderId === defRow.modelData.id

                            opacity: defRow.unsupported ? 0.45 : 1.0
                            borderColor: defRow.selected ? Theme.accent : Theme.border

                            ColumnLayout {
                                width: parent ? parent.width : implicitWidth
                                spacing: Theme.spacingS

                                RowLayout {
                                    Layout.fillWidth: true
                                    spacing: Theme.spacingS

                                    Text {
                                        Layout.fillWidth: true
                                        text: defRow.modelData.name
                                        font.family: Theme.fontBody
                                        font.pixelSize: 14
                                        font.bold: true
                                        color: Theme.textPrimary
                                        elide: Text.ElideRight
                                    }

                                    ABadge {
                                        variant: page.statusVariant(defRow.modelData.status)
                                        text: page.statusLabel(defRow.modelData.status)
                                    }
                                }

                                Text {
                                    Layout.fillWidth: true
                                    text: defRow.modelData.defaultBaseUrl.length > 0
                                        ? defRow.modelData.defaultBaseUrl
                                        : I18n.tr("shell.speech.noDefaultEndpoint")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 11
                                    color: Theme.textSecondary
                                    elide: Text.ElideRight
                                }

                                Text {
                                    Layout.fillWidth: true
                                    text: defRow.modelData.note
                                    font.family: Theme.fontBody
                                    font.pixelSize: 11
                                    wrapMode: Text.WordWrap
                                    color: Theme.textSecondary
                                }
                            }

                            // One hover+click handler: clicks on Unsupported rows
                            // are ignored (rows render disabled) but hover still
                            // shows the explanatory tooltip.
                            MouseArea {
                                id: defRowMouseArea
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: defRow.unsupported ? Qt.ForbiddenCursor : Qt.PointingHandCursor
                                onClicked: {
                                    if (!defRow.unsupported)
                                        controller.selectProvider(defRow.modelData.id)
                                }
                            }

                            ATooltip {
                                text: defRow.modelData.note
                                visible: defRow.unsupported && defRowMouseArea.containsMouse
                                x: Theme.spacingM
                                y: parent.height
                            }
                        }
                    }

                    Text {
                        visible: page.defs.length === 0
                        text: I18n.tr("shell.speech.providers.empty")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.error
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // VOICE / SPEED (visible only with a provider selected)
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                visible: page.selectedDef !== null
                text: I18n.tr("shell.speech.voice.caption")
            }

            ACard {
                visible: page.selectedDef !== null
                Layout.fillWidth: true
                Layout.maximumWidth: 720

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    Text {
                        visible: controller.missingKey
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.speech.missingKey")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }

                    FieldLabel {
                        text: I18n.tr("shell.speech.voice.label")
                    }

                    ATextField {
                        id: voiceField
                        Layout.fillWidth: true
                        enabled: !controller.missingKey
                        placeholderText: page.selectedDef && page.selectedDef.defaultVoice.length > 0
                            ? page.selectedDef.defaultVoice
                            : I18n.tr("shell.speech.voice.placeholderDefault")
                        onTextChanged: {
                            if (text !== controller.voice)
                                controller.applyVoice(text)
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        FieldLabel {
                            text: I18n.tr("shell.speech.speed.label")
                        }

                        Item { Layout.fillWidth: true }

                        ABadge {
                            variant: "default"
                            text: Number(controller.speed).toFixed(2) + "×"
                        }
                    }

                    ASlider {
                        id: speedSlider
                        Layout.fillWidth: true
                        enabled: !controller.missingKey
                        from: 0.25
                        to: 4.0
                        stepSize: 0.05
                        value: controller.speed
                        onMoved: controller.applySpeed(value)
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        Text {
                            text: controller.statusLine
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: String(controller.statusLine).indexOf("error") === 0
                                ? Theme.error
                                : Theme.success
                        }

                        Item { Layout.fillWidth: true }

                        AButton {
                            variant: AButton.Accent
                            text: I18n.tr("shell.speech.save")
                            onClicked: controller.save()
                        }
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // SAMPLE SYNTHESIS
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.speech.sample.caption")
            }

            ACard {
                Layout.fillWidth: true
                Layout.maximumWidth: 720

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.speech.sample.description")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        color: Theme.textSecondary
                    }

                    FieldLabel {
                        text: I18n.tr("shell.speech.sample.label")
                    }

                    ATextArea {
                        id: sampleText
                        Layout.fillWidth: true
                        implicitHeight: 96
                        placeholderText: I18n.tr("shell.speech.sample.placeholder")
                        enabled: page.selectedDef !== null
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        AButton {
                            variant: AButton.Default
                            text: I18n.tr("shell.speech.sample.button")
                            enabled: page.selectedDef !== null && sampleText.text.trim().length > 0
                            onClicked: page.synthesizeSample()
                        }

                        Item { Layout.fillWidth: true }
                    }

                    Text {
                        visible: page.sampleResult.length > 0
                        Layout.fillWidth: true
                        wrapMode: Text.WrapAnywhere
                        text: page.sampleFailed
                            ? page.sampleResult
                            : I18n.tr("shell.speech.sample.written") + " " + page.sampleResult
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        font.bold: page.sampleFailed
                        color: page.sampleFailed ? Theme.error : Theme.success
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.speech.sample.notPlayable")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        color: Theme.textSecondary
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // STT — described, not wired
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.speech.stt.caption")
            }

            ACard {
                Layout.fillWidth: true
                Layout.maximumWidth: 720

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    Text {
                        text: I18n.tr("shell.speech.stt.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.speech.stt.body")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.textSecondary
                    }
                }
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }
}
