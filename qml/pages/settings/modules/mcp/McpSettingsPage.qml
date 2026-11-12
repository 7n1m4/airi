// SPDX-License-Identifier: GPL-3.0-or-later
// MCP Servers & Tools — Manage/Test tabs wired to the real `McpController`
// bridge (spawn → initialize → tools/list through airi-mcp) and to the app's
// own mcp.json (<profile>/airi/mcp.json). The documented Electron default is
// shown when no config exists, with an explicit "add it" action. Discover
// stays a deferred preview (no registry client).
// The single configured server shown is the documented Electron default
// (apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts:
//   mcpServers["open-websearch"] = { command: "npx",
//     args: ["-y", "open-websearch@latest"] }), labelled as documentation —
// it is not read from disk and not claimed as the user's configuration.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    property int activeTab: 0
    property string probeTarget: ""
    property var servers: []
    property var probeTools: []
    property string probeStatus: ""
    property bool probeOk: false
    property string callOutput: ""
    property bool callOk: false
    property bool probing: false

    McpController {
        id: controller
    }

    Connections {
        target: controller
        function onServersChanged() { page.reloadServers() }
    }

    readonly property var serverNames: page.servers.map(function (s2) { return s2.name })

    function reloadServers() {
        var parsed = []
        try {
            parsed = JSON.parse(controller.serversJson)
        } catch (e) {
            console.log("[airi-qt] mcp: failed to parse serversJson:", e)
        }
        page.servers = parsed
        if (page.probeTarget.length === 0 && parsed.length > 0)
            page.probeTarget = parsed[0].name
    }

    function addDefaultServer() {
        controller.addStdioServer("open-websearch", "npx", "[\"-y\", \"open-websearch@latest\"]")
    }

    function serversForSave() {
        return page.servers.map(function (s2) {
            return {
                name: s2.name,
                command: s2.command === undefined ? null : s2.command,
                args: s2.args || [],
                env: s2.env || {},
                url: s2.url === undefined ? null : s2.url,
                headers: s2.headers || {},
                enabled: s2.enabled !== false
            }
        })
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

    function pickTool(name) {
        toolNameField.text = name
    }

    function addStdioFromFields() {
        var args = page.parseArgsInput(stdioArgsField.text)
        if (args === null)
            return
        controller.addStdioServer(stdioNameField.text, stdioCommandField.text, JSON.stringify(args))
    }

    function runProbe() {
        page.probing = true
        var raw = controller.probeServer(page.probeTarget)
        page.probing = false
        var result = null
        try {
            result = JSON.parse(raw)
        } catch (e) {
            result = { error: "unexpected bridge response" }
        }
        if (result && result.error) {
            page.probeOk = false
            page.probeTools = []
            page.probeStatus = result.error
        } else if (result && result.ok) {
            page.probeOk = true
            page.probeTools = result.tools || []
            page.probeStatus = result.toolCount + " · " + result.durationMs + " ms"
        }
    }

    function runCallTool(toolName, toolArgs) {
        var raw = controller.callTool(page.probeTarget, toolName, toolArgs)
        var result = null
        try {
            result = JSON.parse(raw)
        } catch (e) {
            result = { error: "unexpected bridge response" }
        }
        page.callOutput = JSON.stringify(result, null, 2)
        page.callOk = !!(result && result.ok && !(result && result.error) && !(result && result.isError))
    }

    Component.onCompleted: {
        controller.refreshServers()
        page.reloadServers()
    }

    // ── Deferred-control idioms (the honest "not wired" pattern) ─────────
    // Disabled AButton + ATooltip on wrapper hover (used for every action).
    component DeferredButton: Item {
        id: deferred

        property string text: ""
        property int variant: AButton.Default
        property string tip: I18n.tr("shell.mcp.deferredTip")

        implicitWidth: button.implicitWidth
        implicitHeight: button.implicitHeight

        AButton {
            id: button
            anchors.fill: parent
            enabled: false
            text: deferred.text
            variant: deferred.variant
        }

        MouseArea {
            id: hoverArea
            anchors.fill: parent
            hoverEnabled: true
        }

        ATooltip {
            text: deferred.tip
            visible: hoverArea.containsMouse
            x: 0
            y: deferred.height + Theme.spacingS
        }
    }

    // Disabled ASwitch (checked = enabled) + ATooltip on wrapper hover.
    component DeferredSwitch: Item {
        id: deferredSwitch

        property bool checked: true

        implicitWidth: toggle.implicitWidth
        implicitHeight: toggle.implicitHeight

        ASwitch {
            id: toggle
            anchors.fill: parent
            enabled: false
            checked: deferredSwitch.checked
        }

        MouseArea {
            id: switchHover
            anchors.fill: parent
            hoverEnabled: true
        }

        ATooltip {
            text: I18n.tr("shell.mcp.deferredTip")
            visible: switchHover.containsMouse
            x: 0
            y: deferredSwitch.height + Theme.spacingS
        }
    }

    // Caption-style section header (Vue `.mc-section-header h3`).
    component SectionCaption: Text {
        font.family: Theme.fontBody
        font.pixelSize: 12
        font.bold: true
        font.capitalization: Font.AllUppercase
        color: Theme.textSecondary
    }

    // Field label above an input (Vue FieldInput `label`).
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
                    text: I18n.tr("shell.mcp.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "warning"
                    text: I18n.tr("shell.mcp.notWiredBadge")
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 560
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.mcp.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // ── Persistent deferred notice (Live2D-deferred style) ────────
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
                        text: I18n.tr("shell.mcp.deferredNotice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // ── Tab switcher (Manage | Discover | Test Connection) ────────
            AToggleGroup {
                Layout.fillWidth: true
                model: [
                    I18n.tr("shell.mcp.tabs.manage"),
                    I18n.tr("shell.mcp.tabs.discover"),
                    I18n.tr("shell.mcp.tabs.test")
                ]
                currentIndex: page.activeTab

                onToggled: function (index) { page.activeTab = index }
            }

            // ═════════════════════════════════════════════════════════════
            // TAB 1: MANAGE
            // ═════════════════════════════════════════════════════════════
            ColumnLayout {
                Layout.fillWidth: true
                visible: page.activeTab === 0
                spacing: Theme.spacingM

                SectionCaption {
                    text: I18n.tr("shell.mcp.manage.runtimeStatus")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            FieldLabel {
                                text: I18n.tr("shell.mcp.manage.storageLabel")
                            }

                            Item { Layout.fillWidth: true }

                            ABadge {
                                variant: controller.configLoaded ? "success" : "warning"
                                text: controller.configLoaded
                                    ? I18n.tr("shell.mcp.manage.configLoaded")
                                    : I18n.tr("shell.mcp.manage.configMissing")
                            }
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: configPathText.implicitHeight + 2 * Theme.spacingS
                            radius: Theme.radiusS
                            color: Theme.surfaceHover
                            border.width: 1
                            border.color: Theme.border

                            Text {
                                id: configPathText
                                anchors.fill: parent
                                anchors.leftMargin: Theme.spacingM
                                anchors.rightMargin: Theme.spacingM
                                anchors.topMargin: Theme.spacingS
                                anchors.bottomMargin: Theme.spacingS
                                verticalAlignment: Text.AlignVCenter
                                text: controller.configPath
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                wrapMode: Text.WrapAnywhere
                                color: Theme.textPrimary
                            }
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.mcp.manage.configPathHint")
                            font.family: Theme.fontBody
                            font.pixelSize: 11
                            color: Theme.textSecondary
                        }

                        RowLayout {
                            Layout.fillWidth: true

                            Item { Layout.fillWidth: true }

                            AButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.mcp.manage.applyRestart")
                                enabled: !controller.working
                                onClicked: controller.saveServers(JSON.stringify(page.serversForSave()))
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.mcp.manage.configuredServers")
                }

                // Dynamic server list read from mcp.json; empty state offers the documented default.
                ACard {
                    Layout.fillWidth: true
                    visible: page.servers.length === 0

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        RowLayout {
                            spacing: Theme.spacingS

                            Rectangle {
                                implicitWidth: 10
                                implicitHeight: 10
                                radius: 5
                                color: Theme.textSecondary
                            }
                            Text {
                                text: "open-websearch"
                                font.family: Theme.fontBody
                                font.pixelSize: 14
                                font.bold: true
                                color: Theme.textPrimary
                            }
                            ABadge {
                                variant: "info"
                                text: I18n.tr("shell.mcp.manage.documentedExample")
                            }
                        }
                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.mcp.manage.emptyBody")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            Item { Layout.fillWidth: true }
                            AButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.mcp.manage.addDefault")
                                onClicked: page.addDefaultServer()
                            }
                        }
                    }
                }

                Repeater {
                    model: page.servers

                    delegate: ACard {
                        id: serverCard
                        Layout.fillWidth: true
                        required property var modelData

                        ColumnLayout {
                            width: parent ? parent.width : implicitWidth
                            spacing: Theme.spacingS

                            RowLayout {
                                spacing: Theme.spacingM

                                Rectangle {
                                    implicitWidth: 10
                                    implicitHeight: 10
                                    radius: 5
                                    color: serverCard.modelData.enabled ? Theme.success : Theme.textSecondary
                                }
                                ColumnLayout {
                                    spacing: 2

                                    Text {
                                        text: serverCard.modelData.name
                                        font.family: Theme.fontBody
                                        font.pixelSize: 14
                                        font.bold: true
                                        color: Theme.textPrimary
                                    }
                                    Text {
                                        text: serverCard.modelData.enabled
                                            ? I18n.tr("shell.mcp.manage.serverStateEnabled")
                                            : I18n.tr("shell.mcp.manage.serverStateDisabled")
                                        font.family: Theme.fontBody
                                        font.pixelSize: 10
                                        font.bold: true
                                        font.capitalization: Font.AllUppercase
                                        color: serverCard.modelData.enabled ? Theme.success : Theme.textSecondary
                                    }
                                }
                                ABadge {
                                    variant: "info"
                                    text: serverCard.modelData.transport === "remote"
                                        ? "Remote HTTP"
                                        : I18n.tr("shell.mcp.manage.transportStdio")
                                }
                                Item { Layout.fillWidth: true }
                            }

                            Rectangle {
                                Layout.fillWidth: true
                                implicitHeight: endpointCode.implicitHeight + 2 * Theme.spacingS
                                radius: Theme.radiusS
                                color: Theme.surfaceHover
                                border.width: 1
                                border.color: Theme.border

                                Text {
                                    id: endpointCode
                                    anchors.fill: parent
                                    anchors.leftMargin: Theme.spacingM
                                    anchors.rightMargin: Theme.spacingM
                                    anchors.topMargin: Theme.spacingS
                                    anchors.bottomMargin: Theme.spacingS
                                    verticalAlignment: Text.AlignVCenter
                                    text: serverCard.modelData.summary
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    wrapMode: Text.WrapAnywhere
                                    color: Theme.textPrimary
                                }
                            }

                            RowLayout {
                                spacing: Theme.spacingS

                                AButton {
                                    text: I18n.tr("shell.mcp.manage.testConnection")
                                    onClicked: {
                                        page.probeTarget = serverCard.modelData.name
                                        page.activeTab = 2
                                    }
                                }
                                Item { Layout.fillWidth: true }
                                ASwitch {
                                    checked: serverCard.modelData.enabled
                                    onToggled: controller.setServerEnabled(serverCard.modelData.name, checked)
                                }
                                AButton {
                                    variant: AButton.Danger
                                    text: I18n.tr("shell.mcp.manage.delete")
                                    onClicked: controller.removeServer(serverCard.modelData.name)
                                }
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.mcp.manage.addSection")
                }

                // Add remote server — fields are local state; nothing is written.
                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        Text {
                            text: I18n.tr("shell.mcp.manage.addRemoteTitle")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.mcp.manage.addRemoteDescription")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        FieldLabel {
                            text: I18n.tr("shell.mcp.manage.nameLabel")
                        }

                        ATextField {
                            Layout.fillWidth: true
                            placeholderText: I18n.tr("shell.mcp.manage.namePlaceholder")
                        }

                        FieldLabel {
                            text: I18n.tr("shell.mcp.manage.urlLabel")
                        }

                        ATextField {
                            Layout.fillWidth: true
                            placeholderText: I18n.tr("shell.mcp.manage.urlPlaceholder")
                        }

                        FieldLabel {
                            text: I18n.tr("shell.mcp.manage.authHeaderLabel")
                        }

                        ATextField {
                            Layout.fillWidth: true
                            placeholderText: I18n.tr("shell.mcp.manage.authHeaderPlaceholder")
                        }

                        RowLayout {
                            Layout.fillWidth: true

                            Item { Layout.fillWidth: true }

                            DeferredButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.mcp.manage.addRemote")
                            }
                        }
                    }
                }

                // Add stdio server — fields are local state; nothing is launched.
                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        Text {
                            text: I18n.tr("shell.mcp.manage.addStdioTitle")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.mcp.manage.addStdioDescription")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        FieldLabel {
                            text: I18n.tr("shell.mcp.manage.nameLabel")
                        }

                        ATextField {
                            id: stdioNameField
                            Layout.fillWidth: true
                            placeholderText: I18n.tr("shell.mcp.manage.namePlaceholder")
                        }

                        FieldLabel {
                            text: I18n.tr("shell.mcp.manage.commandLabel")
                        }

                        ATextField {
                            id: stdioCommandField
                            Layout.fillWidth: true
                            placeholderText: I18n.tr("shell.mcp.manage.commandPlaceholder")
                        }

                        FieldLabel {
                            text: I18n.tr("shell.mcp.manage.argsLabel")
                        }

                        ATextField {
                            id: stdioArgsField
                            Layout.fillWidth: true
                            placeholderText: I18n.tr("shell.mcp.manage.argsPlaceholder")
                        }

                        RowLayout {
                            Layout.fillWidth: true

                            Item { Layout.fillWidth: true }

                            AButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.mcp.manage.addStdio")
                                enabled: stdioNameField.text.trim().length > 0 && stdioCommandField.text.trim().length > 0
                                onClicked: page.addStdioFromFields()
                            }
                        }
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // TAB 2: DISCOVER
            // ═════════════════════════════════════════════════════════════
            ColumnLayout {
                Layout.fillWidth: true
                visible: page.activeTab === 1
                spacing: Theme.spacingM

                Item {
                    Layout.fillWidth: true
                    implicitHeight: searchField.implicitHeight

                    ATextField {
                        id: searchField
                        anchors.fill: parent
                        enabled: false
                        placeholderText: I18n.tr("shell.mcp.discover.searchPlaceholder")
                    }

                    MouseArea {
                        id: searchHover
                        anchors.fill: parent
                        hoverEnabled: true
                    }

                    ATooltip {
                        text: I18n.tr("shell.mcp.deferredTip")
                        visible: searchHover.containsMouse
                        x: 0
                        y: parent.height + Theme.spacingS
                    }
                }

                ACard {
                    Layout.fillWidth: true

                    AEmptyState {
                        Layout.fillWidth: true
                        implicitHeight: 240
                        icon: "🧭"
                        title: I18n.tr("shell.mcp.discover.emptyTitle")
                        subtitle: I18n.tr("shell.mcp.discover.emptySubtitle")
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // TAB 3: TEST CONNECTION
            // ═════════════════════════════════════════════════════════════
            ColumnLayout {
                Layout.fillWidth: true
                visible: page.activeTab === 2
                spacing: Theme.spacingM

                SectionCaption {
                    text: I18n.tr("shell.mcp.test.sectionCaption")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingM

                        Text {
                            text: I18n.tr("shell.mcp.test.title")
                            font.family: Theme.fontBody
                            font.pixelSize: 15
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.mcp.test.description")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        FieldLabel {
                            text: I18n.tr("shell.mcp.test.targetLabel")
                        }

                        Text {
                            text: I18n.tr("shell.mcp.test.targetDescription")
                            font.family: Theme.fontBody
                            font.pixelSize: 11
                            color: Theme.textSecondary
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Item {
                                Layout.fillWidth: true
                                implicitHeight: serverSelect.implicitHeight

                                ASelect {
                                    id: serverSelect
                                    anchors.fill: parent
                                    enabled: page.servers.length > 0
                                    model: page.serverNames
                                    currentIndex: Math.max(0, page.serverNames.indexOf(page.probeTarget))
                                    onActivated: page.probeTarget = serverSelect.currentText
                                }
                            }

                            AButton {
                                variant: AButton.Accent
                                text: page.probing ? I18n.tr("shell.mcp.test.probing") : I18n.tr("shell.mcp.test.runProbe")
                                enabled: page.probeTarget.length > 0 && !page.probing
                                onClicked: page.runProbe()
                            }
                        }

                        ASeparator {
                            Layout.fillWidth: true
                        }

                        SectionCaption {
                            text: I18n.tr("shell.mcp.test.targetCaption")
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            ABadge {
                                variant: "info"
                                text: {
                                    for (var i = 0; i < page.servers.length; ++i)
                                        if (page.servers[i].name === page.probeTarget)
                                            return page.servers[i].transport === "remote"
                                                ? "Remote HTTP"
                                                : I18n.tr("shell.mcp.manage.transportStdio")
                                    return "—"
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                text: {
                                    for (var i = 0; i < page.servers.length; ++i)
                                        if (page.servers[i].name === page.probeTarget)
                                            return page.servers[i].summary
                                    return "—"
                                }
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                wrapMode: Text.WrapAnywhere
                                color: Theme.textSecondary
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.mcp.test.toolsCaption")
                }

                ACard {
                    id: toolsCard
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        Text {
                            visible: page.probeStatus.length > 0
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: page.probeStatus
                            font.family: Theme.fontBody
                            font.pixelSize: 11
                            color: page.probeOk ? Theme.textSecondary : Theme.error
                        }

                        AEmptyState {
                            visible: page.probeTools.length === 0
                            Layout.fillWidth: true
                            implicitHeight: 140
                            icon: "🛠️"
                            title: I18n.tr("shell.mcp.test.emptyToolsTitle")
                            subtitle: page.probeStatus.length > 0
                                ? page.probeStatus
                                : I18n.tr("shell.mcp.test.emptyToolsSubtitle")
                        }

                        Repeater {
                            model: page.probeTools

                            delegate: Rectangle {
                                id: toolRow
                                required property var modelData
                                Layout.fillWidth: true
                                implicitHeight: toolRowCol.implicitHeight + 2 * Theme.spacingS
                                radius: Theme.radiusS
                                color: Theme.surfaceHover
                                border.width: 1
                                border.color: Theme.border

                                RowLayout {
                                    id: toolRowCol
                                    anchors.fill: parent
                                    anchors.margins: Theme.spacingS
                                    spacing: Theme.spacingM

                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 0
                                        Text {
                                            Layout.fillWidth: true
                                            text: toolRow.modelData.name
                                            font.family: Theme.fontBody
                                            font.pixelSize: 12
                                            font.bold: true
                                            color: Theme.textPrimary
                                            elide: Text.ElideRight
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            text: toolRow.modelData.description || ""
                                            font.family: Theme.fontBody
                                            font.pixelSize: 10
                                            color: Theme.textSecondary
                                            wrapMode: Text.WordWrap
                                            maximumLineCount: 2
                                            elide: Text.ElideRight
                                        }
                                    }

                                    AButton {
                                        variant: AButton.Ghost
                                        text: I18n.tr("shell.mcp.test.callCaption")
                                        implicitWidth: 72
                                        onClicked: page.pickTool(toolRow.modelData.name)
                                    }
                                }
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.mcp.test.callCaption")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        FieldLabel {
                            text: I18n.tr("shell.mcp.test.toolNameLabel")
                        }

                        ATextField {
                            id: toolNameField
                            Layout.fillWidth: true
                            enabled: page.probeTarget.length > 0
                            placeholderText: I18n.tr("shell.mcp.test.toolNamePlaceholder")
                        }

                        FieldLabel {
                            text: I18n.tr("shell.mcp.test.toolArgsLabel")
                        }

                        ATextArea {
                            id: toolArgsField
                            Layout.fillWidth: true
                            implicitHeight: 96
                            enabled: page.probeTarget.length > 0
                            text: "{}"
                            placeholderText: I18n.tr("shell.mcp.test.toolArgsPlaceholder")
                        }

                        RowLayout {
                            Layout.fillWidth: true

                            Item { Layout.fillWidth: true }

                            AButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.mcp.test.callTool")
                                enabled: page.probeTarget.length > 0 && toolNameField.text.trim().length > 0
                                onClicked: page.runCallTool(toolNameField.text.trim(), toolArgsField.text)
                            }
                        }

                        Text {
                            visible: page.callOutput.length > 0
                            Layout.fillWidth: true
                            text: page.callOk ? "ok" : "error"
                            font.family: Theme.fontBody
                            font.pixelSize: 10
                            font.bold: true
                            font.capitalization: Font.AllUppercase
                            color: page.callOk ? Theme.success : Theme.error
                        }
                        ATextArea {
                            visible: page.callOutput.length > 0
                            Layout.fillWidth: true
                            implicitHeight: 180
                            readOnly: true
                            text: page.callOutput
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
}
