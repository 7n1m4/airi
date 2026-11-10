// SPDX-License-Identifier: GPL-3.0-or-later
// ACP Agents — live agent chat pane wired to the real `AcpController`
// bridge (spawn → initialize → session/new → session/prompt streaming through
// airi-acp). The banner describes the honest limits of the bridge: prompt
// turns and permission requests are wired; `fs/*` and `terminal/*` are not.
// Permission requests from the agent open an `AModal` (and an inline bar)
// backed by `pendingPermissionJson`; the answer goes back over the wire
// through `answerPermission`. One agent session at a time.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

pragma ComponentBehavior: Bound

Item {
    id: page

    property var agents: []
    property var transcript: []
    property var pendingPermission: null

    readonly property var activeAgentEntry: {
        for (var i = 0; i < page.agents.length; ++i)
            if (page.agents[i].name === controller.activeAgent)
                return page.agents[i]
        return null
    }

    AcpController {
        id: controller
    }

    Connections {
        target: controller

        function onTranscriptChanged() {
            page.reloadTranscript()
        }

        function onPermissionRequested() {
            page.reloadPendingPermission()
            if (page.pendingPermission !== null)
                permissionModal.open()
        }

        function onAgentStateChanged() {
            if (controller.agentState !== "running")
                permissionModal.close()
            page.reloadAgents()
        }
    }

    Timer {
        interval: 100
        repeat: true
        running: true
        onTriggered: controller.pumpUpdates()
    }

    function reloadAgents() {
        var parsed = []
        try {
            parsed = JSON.parse(controller.agentsJson)
        } catch (e) {
            console.log("[airi-qt] acp: failed to parse agentsJson:", e)
        }
        page.agents = parsed
    }

    function reloadTranscript() {
        var parsed = []
        try {
            parsed = JSON.parse(controller.transcriptJson)
        } catch (e) {
            console.log("[airi-qt] acp: failed to parse transcriptJson:", e)
        }
        page.transcript = parsed
        if (transcriptList.count > 0)
            transcriptList.positionViewAtEnd()
    }

    function reloadPendingPermission() {
        var parsed = null
        try {
            parsed = JSON.parse(controller.pendingPermissionJson)
        } catch (e) {
            console.log("[airi-qt] acp: failed to parse pendingPermissionJson:", e)
        }
        page.pendingPermission = parsed
    }

    function parseArgsInput(text) {
        var t = text.trim()
        if (t.length === 0)
            return []
        if (t.charAt(0) === "[") {
            try {
                return JSON.parse(t)
            } catch (e) {
                return null
            }
        }
        return t.split(/\s+/)
    }

    // Lenient "KEY=value" lines; blank lines and #-comments are skipped.
    function parseEnvInput(text) {
        var env = {}
        var lines = text.split("\n")
        for (var i = 0; i < lines.length; ++i) {
            var line = lines[i].trim()
            if (line.length === 0 || line.charAt(0) === "#")
                continue
            var eq = line.indexOf("=")
            if (eq <= 0)
                continue
            env[line.substring(0, eq).trim()] = line.substring(eq + 1).trim()
        }
        return env
    }

    function parseEnvTextToJson(text) {
        if (text.trim().length === 0)
            return "{}"
        return JSON.stringify(page.parseEnvInput(text))
    }

    function addAgentFromFields() {
        var args = page.parseArgsInput(stdioArgsField.text)
        if (args === null)
            return
        var ok = controller.addStdioAgent(
            stdioNameField.text.trim(),
            stdioCommandField.text.trim(),
            JSON.stringify(args),
            page.parseEnvTextToJson(envField.text),
            policySelect.currentText)
        if (ok) {
            stdioNameField.text = ""
            stdioCommandField.text = ""
            stdioArgsField.text = ""
            envField.text = ""
            policySelect.currentIndex = 0
        }
        page.reloadAgents()
    }

    function sendPrompt() {
        var text = promptField.text.trim()
        if (text.length === 0)
            return
        if (controller.promptAgent(text))
            promptField.text = ""
    }

    function answerPermission(decision) {
        if (page.pendingPermission === null)
            return
        controller.answerPermission(page.pendingPermission.requestId, decision)
        page.reloadPendingPermission()
        permissionModal.close()
    }

    function kindVariant(kind) {
        switch (kind) {
        case "user": return "info"
        case "agent": return "accent"
        case "thought": return "default"
        case "tool": return "warning"
        case "plan": return "warning"
        case "system": return "default"
        default: return "default"
        }
    }

    function stateVariant(state) {
        switch (state) {
        case "running": return "success"
        case "error": return "error"
        default: return "default"
        }
    }

    Component.onCompleted: {
        controller.refreshAgents()
        page.reloadAgents()
        page.reloadTranscript()
        page.reloadPendingPermission()
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
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                Text {
                    Layout.fillWidth: true
                    text: I18n.tr("shell.acp.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: page.stateVariant(controller.agentState)
                    text: {
                        switch (controller.agentState) {
                        case "running": return I18n.tr("shell.acp.state.running")
                        case "error": return I18n.tr("shell.acp.state.error")
                        default: return I18n.tr("shell.acp.state.stopped")
                        }
                    }
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 640
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.acp.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // ── Honest capability notice ─────────────────────────────────
            ACard {
                Layout.fillWidth: true
                borderColor: Theme.warning

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: "⚠"
                        font.pixelSize: 20
                        color: Theme.warning
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.acp.notice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // Last error line (bridge-set).
            Text {
                visible: controller.lastError.length > 0
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: controller.lastError
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.error
            }

            // ═════════════════════════════════════════════════════════════
            // TOP ROW: configured agents | add agent
            // ═════════════════════════════════════════════════════════════
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                // ── Configured agents ────────────────────────────────────
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.preferredWidth: 1
                    spacing: Theme.spacingS

                    SectionCaption {
                        text: I18n.tr("shell.acp.agents.caption")
                    }

                    ACard {
                        Layout.fillWidth: true
                        visible: page.agents.length === 0

                        AEmptyState {
                            Layout.fillWidth: true
                            implicitHeight: 140
                            icon: "🤖"
                            title: I18n.tr("shell.acp.agents.emptyTitle")
                            subtitle: I18n.tr("shell.acp.agents.emptySubtitle")
                        }
                    }

                    Repeater {
                        model: page.agents

                        delegate: ACard {
                            id: agentCard
                            Layout.fillWidth: true
                            required property var modelData

                            readonly property bool isActive: agentCard.modelData.name === controller.activeAgent

                            ColumnLayout {
                                width: parent ? parent.width : implicitWidth
                                spacing: Theme.spacingS

                                RowLayout {
                                    spacing: Theme.spacingS

                                    Rectangle {
                                        implicitWidth: 10
                                        implicitHeight: 10
                                        radius: 5
                                        color: agentCard.modelData.enabled ? Theme.success : Theme.textSecondary
                                    }

                                    Text {
                                        text: agentCard.modelData.name
                                        font.family: Theme.fontBody
                                        font.pixelSize: 14
                                        font.bold: true
                                        color: Theme.textPrimary
                                        elide: Text.ElideRight
                                    }

                                    ABadge {
                                        variant: "info"
                                        text: agentCard.modelData.permissionPolicy
                                    }

                                    Item { Layout.fillWidth: true }
                                }

                                Text {
                                    Layout.fillWidth: true
                                    text: agentCard.modelData.summary
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    wrapMode: Text.WrapAnywhere
                                    color: Theme.textSecondary
                                }

                                RowLayout {
                                    spacing: Theme.spacingS

                                    AButton {
                                        variant: agentCard.isActive && controller.agentState === "running"
                                            ? AButton.Default
                                            : AButton.Accent
                                        text: agentCard.isActive && controller.agentState === "running"
                                            ? I18n.tr("shell.acp.agents.stop")
                                            : I18n.tr("shell.acp.agents.start")
                                        enabled: agentCard.isActive
                                            ? controller.agentState === "running"
                                            : agentCard.modelData.enabled
                                        onClicked: {
                                            if (agentCard.isActive && controller.agentState === "running")
                                                controller.stopAgent()
                                            else
                                                controller.startAgent(agentCard.modelData.name)
                                            page.reloadAgents()
                                        }
                                    }

                                    ASwitch {
                                        checked: agentCard.modelData.enabled
                                        onToggled: {
                                            controller.setAgentEnabled(agentCard.modelData.name, checked)
                                            page.reloadAgents()
                                        }
                                    }

                                    Item { Layout.fillWidth: true }

                                    AButton {
                                        variant: AButton.Danger
                                        text: I18n.tr("shell.acp.agents.delete")
                                        onClicked: {
                                            controller.removeAgent(agentCard.modelData.name)
                                            page.reloadAgents()
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // ── Add stdio agent ───────────────────────────────────────
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.preferredWidth: 1
                    spacing: Theme.spacingS

                    SectionCaption {
                        text: I18n.tr("shell.acp.addAgent.caption")
                    }

                    ACard {
                        Layout.fillWidth: true

                        ColumnLayout {
                            width: parent ? parent.width : implicitWidth
                            spacing: Theme.spacingS

                            Text {
                                text: I18n.tr("shell.acp.addAgent.title")
                                font.family: Theme.fontBody
                                font.pixelSize: 14
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.acp.addAgent.description")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            FieldLabel {
                                text: I18n.tr("shell.acp.addAgent.nameLabel")
                            }

                            ATextField {
                                id: stdioNameField
                                Layout.fillWidth: true
                                placeholderText: I18n.tr("shell.acp.addAgent.namePlaceholder")
                            }

                            FieldLabel {
                                text: I18n.tr("shell.acp.addAgent.commandLabel")
                            }

                            ATextField {
                                id: stdioCommandField
                                Layout.fillWidth: true
                                placeholderText: I18n.tr("shell.acp.addAgent.commandPlaceholder")
                            }

                            FieldLabel {
                                text: I18n.tr("shell.acp.addAgent.argsLabel")
                            }

                            ATextField {
                                id: stdioArgsField
                                Layout.fillWidth: true
                                placeholderText: I18n.tr("shell.acp.addAgent.argsPlaceholder")
                            }

                            FieldLabel {
                                text: I18n.tr("shell.acp.addAgent.envLabel")
                            }

                            ATextArea {
                                id: envField
                                Layout.fillWidth: true
                                implicitHeight: 72
                                placeholderText: I18n.tr("shell.acp.addAgent.envPlaceholder")
                            }

                            FieldLabel {
                                text: I18n.tr("shell.acp.policyLabel")
                            }

                            ASelect {
                                id: policySelect
                                Layout.fillWidth: true
                                implicitWidth: 0
                                model: ["prompt", "auto-read", "auto-all"]
                                currentIndex: 0
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                Item { Layout.fillWidth: true }
                                AButton {
                                    variant: AButton.Accent
                                    text: I18n.tr("shell.acp.addAgent.addButton")
                                    enabled: stdioNameField.text.trim().length > 0
                                        && stdioCommandField.text.trim().length > 0
                                    onClicked: page.addAgentFromFields()
                                }
                            }
                        }
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // ACTIVE SESSION CONTROL
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.acp.session.caption")
            }

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
                            text: controller.agentState === "running" || controller.agentState === "error"
                                ? I18n.tr("shell.acp.session.activeLabel").arg(controller.activeAgent)
                                : I18n.tr("shell.acp.session.noAgent")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            font.bold: true
                            color: Theme.textPrimary
                            elide: Text.ElideRight
                        }

                        Text {
                            visible: controller.sessionId.length > 0
                            text: controller.sessionId
                            font.family: Theme.fontBody
                            font.pixelSize: 11
                            color: Theme.textSecondary
                            elide: Text.ElideMiddle
                            Layout.maximumWidth: 240
                        }

                        AButton {
                            variant: AButton.Danger
                            text: I18n.tr("shell.acp.session.stopButton")
                            visible: controller.agentState === "running"
                            onClicked: {
                                controller.stopAgent()
                                page.reloadAgents()
                            }
                        }
                    }

                    // Per-active-agent permission policy, live-applied.
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS
                        enabled: controller.activeAgent.length > 0 && page.activeAgentEntry !== null

                        FieldLabel {
                            text: I18n.tr("shell.acp.policyLabel")
                        }

                        ASelect {
                            Layout.fillWidth: true
                            implicitWidth: 0
                            enabled: controller.activeAgent.length > 0 && page.activeAgentEntry !== null
                            model: ["prompt", "auto-read", "auto-all"]
                            currentIndex: {
                                var entry = page.activeAgentEntry
                                if (entry === null)
                                    return 0
                                var idx = ["prompt", "auto-read", "auto-all"].indexOf(entry.permissionPolicy)
                                return Math.max(0, idx)
                            }
                            onActivated: {
                                controller.setAgentPermissionPolicy(controller.activeAgent, currentText)
                                page.reloadAgents()
                            }
                        }
                    }

                    // Inline permission bar (shown when the agent is blocked
                    // waiting for an answer; the modal opens on the signal).
                    RowLayout {
                        Layout.fillWidth: true
                        visible: page.pendingPermission !== null
                        spacing: Theme.spacingS

                        ABadge {
                            variant: "warning"
                            text: I18n.tr("shell.acp.permission.pendingBadge")
                        }

                        Text {
                            Layout.fillWidth: true
                            text: page.pendingPermission !== null
                                ? (page.pendingPermission.toolCall.title || page.pendingPermission.toolCall.name || page.pendingPermission.toolCall.toolCallId || "")
                                : ""
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textPrimary
                            elide: Text.ElideRight
                        }

                        AButton {
                            variant: AButton.Accent
                            text: I18n.tr("shell.acp.permission.allowOnce")
                            implicitHeight: 30
                            onClicked: page.answerPermission("allow_once")
                        }
                        AButton {
                            variant: AButton.Default
                            text: I18n.tr("shell.acp.permission.allowSession")
                            implicitHeight: 30
                            onClicked: page.answerPermission("allow_session")
                        }
                        AButton {
                            variant: AButton.Danger
                            text: I18n.tr("shell.acp.permission.reject")
                            implicitHeight: 30
                            onClicked: page.answerPermission("reject")
                        }
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // TRANSCRIPT
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.acp.transcript.caption")
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    AEmptyState {
                        visible: page.transcript.length === 0
                        Layout.fillWidth: true
                        implicitHeight: 140
                        icon: "💬"
                        title: I18n.tr("shell.acp.transcript.emptyTitle")
                        subtitle: I18n.tr("shell.acp.transcript.emptySubtitle")
                    }

                    ListView {
                        id: transcriptList
                        visible: page.transcript.length > 0
                        Layout.fillWidth: true
                        implicitHeight: Math.min(360, transcriptList.count * 64 + Theme.spacingS)
                        clip: true
                        model: page.transcript
                        spacing: Theme.spacingS

                        delegate: RowLayout {
                            id: entryRow
                            required property var modelData
                            width: transcriptList.width
                            spacing: Theme.spacingS

                            ABadge {
                                variant: page.kindVariant(entryRow.modelData.kind)
                                text: entryRow.modelData.kind
                                Layout.alignment: Qt.AlignTop
                            }

                            Text {
                                Layout.fillWidth: true
                                text: entryRow.modelData.text
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                wrapMode: Text.WrapAnywhere
                                color: entryRow.modelData.kind === "system"
                                    ? Theme.textSecondary
                                    : Theme.textPrimary
                            }
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    // Input row.
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        ATextField {
                            id: promptField
                            Layout.fillWidth: true
                            enabled: controller.agentState === "running" && !controller.working
                            placeholderText: I18n.tr("shell.acp.inputPlaceholder")
                            onAccepted: page.sendPrompt()
                        }

                        AButton {
                            variant: AButton.Accent
                            text: I18n.tr("shell.acp.send")
                            enabled: controller.agentState === "running"
                                && !controller.working
                                && promptField.text.trim().length > 0
                            onClicked: page.sendPrompt()
                        }

                        AButton {
                            text: I18n.tr("shell.acp.cancel")
                            enabled: controller.working
                            onClicked: controller.cancelPrompt()
                        }
                    }
                }
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }

    // ── Permission request modal ───────────────────────────────────────────
    AModal {
        id: permissionModal
        title: I18n.tr("shell.acp.permission.title")

        ColumnLayout {
            width: parent ? parent.width : implicitWidth
            spacing: Theme.spacingS

            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.acp.permission.body")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                wrapMode: Text.WrapAnywhere
                text: page.pendingPermission !== null
                    ? (page.pendingPermission.toolCall.title || page.pendingPermission.toolCall.name || page.pendingPermission.toolCall.toolCallId || "")
                    : ""
                font.family: Theme.fontBody
                font.pixelSize: 14
                font.bold: true
                color: Theme.textPrimary
            }

            RowLayout {
                spacing: Theme.spacingS

                FieldLabel {
                    text: I18n.tr("shell.acp.permission.toolKind")
                }

                ABadge {
                    variant: "warning"
                    text: page.pendingPermission !== null
                        ? String(page.pendingPermission.toolCall.kind || "other")
                        : "other"
                }
            }

            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                visible: page.pendingPermission !== null && page.pendingPermission.options !== undefined
                text: page.pendingPermission !== null && page.pendingPermission.options !== undefined
                    ? I18n.tr("shell.acp.permission.offered").arg(
                        page.pendingPermission.options.map(function (o) { return o.name || o.optionId }).join(", "))
                    : ""
                font.family: Theme.fontBody
                font.pixelSize: 11
                color: Theme.textSecondary
            }

            ASeparator {
                Layout.fillWidth: true
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                AButton {
                    variant: AButton.Accent
                    text: I18n.tr("shell.acp.permission.allowOnce")
                    onClicked: page.answerPermission("allow_once")
                }
                AButton {
                    variant: AButton.Default
                    text: I18n.tr("shell.acp.permission.allowSession")
                    onClicked: page.answerPermission("allow_session")
                }
                AButton {
                    variant: AButton.Danger
                    text: I18n.tr("shell.acp.permission.reject")
                    onClicked: page.answerPermission("reject")
                }
                Item { Layout.fillWidth: true }
                AButton {
                    variant: AButton.Ghost
                    text: I18n.tr("shell.acp.permission.dismiss")
                    onClicked: permissionModal.close()
                }
            }
        }
    }
}
