// SPDX-License-Identifier: GPL-3.0-or-later
// Provider detail form: label, kind + saved badges, enable switch, the
// CredentialSchema-driven field set (secrets as password fields), the model
// picker (editable combo fed by `listModels`), test-connection / save /
// remove actions and a status area. Non-chat providers (engines not wired
// yet) render the same form with every control disabled.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

Item {
    id: detail

    property var provider: null        // plain JS object from listProviders() JSON, or null
    property var controller: null      // ProviderSettingsController

    signal refreshRequested()

    // Flat credential map keyed by field.key (api_key, base_url, model, + extras).
    // Mutated in place by field delegates; read wholesale on save.
    property var fieldValues: ({})
    // Provider id whose config is currently loaded into `fieldValues`.
    // Same-id refreshes of the page list must not clobber in-progress edits.
    property string loadedId: ""
    property string savedHint: ""
    property string testStatus: ""
    property bool testOk: false
    property string testDetail: ""
    property var modelsList: []
    property var modelCombo: null      // delegate editable combo, set on completion

    readonly property bool chatCapable: provider ? provider.chatCapable : false

    function glyphOf(label) {
        var match = (label || "").match(/[A-Za-z0-9]/)
        return match ? match[0].toUpperCase() : "?"
    }

    // Localized field label; falls back to the registry's English label when
    // the key has no translation.
    function fieldLabel(field) {
        var key = "shell.providers.field." + field.key
        var translated = I18n.tr(key)
        return translated === key ? field.label : translated
    }

    function clearForm() {
        detail.fieldValues = {}
        detail.loadedId = ""
        detail.savedHint = ""
        detail.testStatus = ""
        detail.testDetail = ""
        detail.modelsList = []
    }

    function loadFromStore() {
        detail.clearForm()
        if (!detail.provider || !detail.controller)
            return
        detail.loadedId = detail.provider.id
        var raw = detail.controller.loadConfig(detail.provider.id)
        try {
            detail.fieldValues = JSON.parse(raw) || {}
        } catch (e) {
            console.log("[airi-qt] providers: failed to parse config for", detail.provider.id, e)
            detail.fieldValues = {}
        }
    }

    function saveConfig() {
        if (!detail.provider || !detail.controller)
            return false
        var ok = detail.controller.saveConfig(detail.provider.id, JSON.stringify(detail.fieldValues))
        if (ok) {
            detail.savedHint = I18n.tr("shell.providers.saved")
            savedHintTimer.restart()
            detail.refreshRequested()
        } else {
            detail.savedHint = I18n.tr("shell.providers.save-failed")
            savedHintTimer.restart()
        }
        return ok
    }

    onProviderChanged: {
        // Reload only across provider ids; page-list refreshes of the same id
        // (enable toggle, post-save badge update) must keep typed credentials.
        if (detail.provider && detail.provider.id === detail.loadedId)
            return
        detail.loadFromStore()
    }

    Timer {
        id: savedHintTimer
        interval: 3000
        repeat: false
        onTriggered: detail.savedHint = ""
    }

    Connections {
        target: detail.controller

        function onTestFinished(id, ok, message) {
            if (!detail.provider || id !== detail.provider.id)
                return
            detail.testOk = ok
            detail.testStatus = ok
                ? I18n.tr("shell.providers.test-success")
                : I18n.tr("shell.providers.test-failed")
            detail.testDetail = message
        }

        function onModelsLoaded(id, models) {
            if (!detail.provider || id !== detail.provider.id)
                return
            var typed = detail.fieldValues["model"] || ""
            detail.modelsList = models
            // Restore any free-typed model after the combo rebuilds its list.
            if (detail.modelCombo)
                detail.modelCombo.editText = typed
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spacingL
        spacing: Theme.spacingM

        // Header: glyph, label, badges, enable switch.
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingM

            Rectangle {
                implicitWidth: 44
                implicitHeight: 44
                radius: 22
                color: Theme.accent

                Text {
                    anchors.centerIn: parent
                    text: detail.glyphOf(detail.provider ? detail.provider.label : "")
                    font.family: Theme.fontTitle
                    font.pixelSize: 18
                    font.bold: true
                    color: Theme.accentContrast
                }
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2

                Text {
                    Layout.fillWidth: true
                    text: detail.provider ? detail.provider.label : ""
                    font.family: Theme.fontTitle
                    font.pixelSize: 18
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                RowLayout {
                    spacing: Theme.spacingS

                    ABadge {
                        variant: "default"
                        text: detail.provider ? I18n.tr("shell.providers.kind." + detail.provider.kind) : ""
                    }

                    ABadge {
                        visible: detail.provider ? detail.provider.configured : false
                        variant: "success"
                        text: I18n.tr("shell.providers.configured")
                    }

                    ABadge {
                        visible: detail.provider ? !detail.provider.chatCapable : false
                        variant: "warning"
                        text: I18n.tr("shell.providers.not-available")
                    }
                }
            }

            ColumnLayout {
                spacing: 2

                Text {
                    Layout.alignment: Qt.AlignHCenter
                    text: I18n.tr("shell.providers.enabled")
                    font.family: Theme.fontBody
                    font.pixelSize: 11
                    color: Theme.textSecondary
                }

                ASwitch {
                    id: enabledSwitch
                    checked: detail.provider ? detail.provider.enabled : false
                    onToggled: {
                        if (!detail.provider || !detail.controller)
                            return
                        detail.controller.saveEnabled(detail.provider.id, checked)
                        detail.refreshRequested()
                    }
                }
            }
        }

        // Diagnostic note straight from the registry (e.g. "local; no API key required").
        // Not localized: it is provider-authored engineering detail.
        Text {
            visible: detail.provider !== null && !!detail.provider.compatNote
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: detail.provider ? detail.provider.compatNote : ""
            font.family: Theme.fontBody
            font.pixelSize: 12
            color: Theme.textSecondary
        }

        // Disabled-state notice for engines that land in a later phase (P9).
        Rectangle {
            visible: detail.provider !== null && !detail.provider.chatCapable
            Layout.fillWidth: true
            implicitHeight: noticeRow.implicitHeight + 2 * Theme.spacingS
            radius: Theme.radiusM
            color: Theme.surfaceHover
            border.width: 1
            border.color: Theme.warning

            RowLayout {
                id: noticeRow
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: Theme.spacingS
                anchors.rightMargin: Theme.spacingS
                spacing: Theme.spacingS

                Text {
                    text: "!"
                    font.pixelSize: 14
                    font.bold: true
                    color: Theme.warning
                }

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.providers.not-available-hint")
                    font.family: Theme.fontBody
                    font.pixelSize: 12
                    color: Theme.textSecondary
                }
            }
        }

        ASeparator { Layout.fillWidth: true }

        // Everything below is disabled until the engine lands (non-chat providers).
        ColumnLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingM
            enabled: detail.chatCapable

            Repeater {
                id: fieldsRepeater
                model: detail.provider ? detail.provider.fields : []

                delegate: ColumnLayout {
                    id: fieldRow
                    Layout.fillWidth: true
                    spacing: Theme.spacingS

                    readonly property var field: modelData
                    readonly property bool isModel: field.key === "model"

                    Text {
                        text: detail.fieldLabel(fieldRow.field) + (fieldRow.field.required ? " *" : "")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        font.bold: true
                        color: Theme.textSecondary
                    }

                    // Secret/standard text field (all fields except `model`).
                    ATextField {
                        id: textInput
                        visible: !fieldRow.isModel
                        Layout.fillWidth: true
                        echoMode: fieldRow.field.secret ? TextInput.Password : TextInput.Normal
                        placeholderText: fieldRow.field.placeholder !== null ? fieldRow.field.placeholder : ""
                        Component.onCompleted: {
                            var v = detail.fieldValues[fieldRow.field.key]
                            text = v !== undefined ? v : ""
                        }
                        onTextChanged: detail.fieldValues[fieldRow.field.key] = text
                    }

                    // `model`: editable combo fed by `listModels`, free text always allowed.
                    RowLayout {
                        visible: fieldRow.isModel
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        ASelect {
                            id: modelCombo
                            Layout.fillWidth: true
                            editable: true
                            model: detail.modelsList
                            Component.onCompleted: {
                                detail.modelCombo = modelCombo
                                var v = detail.fieldValues["model"]
                                editText = v !== undefined ? v : ""
                            }
                            onEditTextChanged: detail.fieldValues["model"] = editText
                            onAccepted: detail.fieldValues["model"] = editText
                        }

                        AButton {
                            id: fetchModelsButton
                            text: I18n.tr("shell.providers.models-refresh")
                            variant: AButton.Ghost
                            enabled: !!detail.controller && !detail.controller.modelsLoading
                        }
                    }
                }
            }

            Text {
                visible: !!detail.controller && detail.controller.modelsError.length > 0
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: detail.controller.modelsError.length > 0
                    ? detail.controller.modelsError
                    : I18n.tr("shell.providers.models-empty")
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.error
            }
            Text {
                visible: !!detail.controller
                    && !detail.controller.modelsLoading
                    && detail.controller.modelsError.length === 0
                    && detail.modelsList.length === 0
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.providers.models-empty")
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textSecondary
            }
        }

        Item { Layout.fillHeight: true }

        // Status line: transient save hint + connection test outcome.
        Text {
            visible: detail.savedHint.length > 0
            Layout.fillWidth: true
            text: detail.savedHint
            font.family: Theme.fontBody
            font.pixelSize: 12
            color: detail.savedHint === I18n.tr("shell.providers.saved") ? Theme.success : Theme.error
        }

        Text {
            visible: detail.testStatus.length > 0
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: detail.testStatus
            font.family: Theme.fontBody
            font.pixelSize: 13
            font.bold: true
            color: detail.testOk ? Theme.success : Theme.error
        }

        Text {
            visible: detail.testDetail.length > 0
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: detail.testDetail
            font.family: Theme.fontBody
            font.pixelSize: 11
            color: Theme.textSecondary
        }

        ASeparator { Layout.fillWidth: true }

        // Actions: Test (saves first — the test runs against stored config), Remove, Save.
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingS

            AButton {
                id: testButton
                text: I18n.tr("shell.providers.test")
                variant: AButton.Default
                enabled: detail.chatCapable
                    && !!detail.controller
                    && !detail.controller.testing
                onClicked: {
                    if (detail.saveConfig())
                        detail.controller.testConnection(detail.provider.id)
                }
            }

            AProgress {
                Layout.preferredWidth: 120
                visible: !!detail.controller && detail.controller.testing
                indeterminate: true
            }

            Item { Layout.fillWidth: true }

            AButton {
                id: removeButton
                text: I18n.tr("shell.providers.delete")
                variant: AButton.Danger
                visible: detail.provider ? detail.provider.configured : false
                enabled: !!detail.controller && !detail.controller.testing
                onClicked: {
                    if (!detail.controller)
                        return
                    if (detail.controller.deleteConfig(detail.provider.id)) {
                        detail.loadedId = ""
                        detail.loadFromStore()
                        detail.refreshRequested()
                    }
                }
            }

            AButton {
                id: saveButton
                text: I18n.tr("shell.providers.save")
                variant: AButton.Accent
                enabled: !!detail.controller
                onClicked: detail.saveConfig()
            }
        }
    }
}
