// SPDX-License-Identifier: GPL-3.0-or-later
// MCP Servers & Tools — UI-complete scaffold.
// Structural port of packages/stage-pages/src/pages/settings/modules/mcp.vue
// (+ components/McpConnectionTestPanel.vue). There is NO Rust MCP client in
// the Qt build yet (the airi-mcp lane): no bridge, no config-file access, no
// registry client, no probe and no tool dispatch. Every mutating control is
// rendered but disabled with an explanatory tooltip; the page says so
// persistently in the banner up top. Nothing here is persisted.
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
    property bool exampleExpanded: false

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
                                variant: "warning"
                                text: I18n.tr("shell.mcp.notWiredBadge")
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
                                text: "<appData>/airi/mcp.json"
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

                            DeferredButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.mcp.manage.applyRestart")
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.mcp.manage.configuredServers")
                }

                // Documented Electron default entry — not read from disk.
                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        // Clickable header row expands the server details.
                        Item {
                            Layout.fillWidth: true
                            implicitHeight: serverHeader.implicitHeight

                            RowLayout {
                                id: serverHeader
                                anchors.fill: parent
                                spacing: Theme.spacingM

                                Rectangle {
                                    implicitWidth: 10
                                    implicitHeight: 10
                                    radius: 5
                                    color: Theme.textSecondary
                                }

                                ColumnLayout {
                                    spacing: 2

                                    Text {
                                        text: "open-websearch"
                                        font.family: Theme.fontBody
                                        font.pixelSize: 14
                                        font.bold: true
                                        color: Theme.textPrimary
                                    }

                                    Text {
                                        text: I18n.tr("shell.mcp.manage.serverStateUnknown")
                                        font.family: Theme.fontBody
                                        font.pixelSize: 10
                                        font.bold: true
                                        font.capitalization: Font.AllUppercase
                                        color: Theme.textSecondary
                                    }
                                }

                                ABadge {
                                    variant: "info"
                                    text: I18n.tr("shell.mcp.manage.documentedExample")
                                }

                                Item { Layout.fillWidth: true }

                                Text {
                                    text: I18n.tr("shell.mcp.manage.toolsNone")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 11
                                    font.bold: true
                                    font.capitalization: Font.AllUppercase
                                    color: Theme.textSecondary
                                }

                                Text {
                                    text: "▾"
                                    font.pixelSize: 14
                                    color: Theme.textSecondary
                                    rotation: page.exampleExpanded ? 180 : 0
                                }
                            }

                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: page.exampleExpanded = !page.exampleExpanded
                            }
                        }

                        // Expanded details — endpoint, environment, tools, actions.
                        ColumnLayout {
                            Layout.fillWidth: true
                            visible: page.exampleExpanded
                            spacing: Theme.spacingS

                            ASeparator {
                                Layout.fillWidth: true
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: Theme.spacingS

                                SectionCaption {
                                    text: I18n.tr("shell.mcp.manage.endpointLabel")
                                }

                                Item { Layout.fillWidth: true }

                                ABadge {
                                    variant: "info"
                                    text: I18n.tr("shell.mcp.manage.transportStdio")
                                }
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
                                    text: "npx -y open-websearch@latest"
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    wrapMode: Text.WrapAnywhere
                                    color: Theme.textPrimary
                                }
                            }

                            SectionCaption {
                                text: I18n.tr("shell.mcp.manage.envCaption")
                                font.pixelSize: 10
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WrapAnywhere
                                text: "DEFAULT_SEARCH_ENGINE=duckduckgo   SEARCH_MODE=auto   MODE=stdio"
                                font.family: Theme.fontBody
                                font.pixelSize: 11
                                color: Theme.textSecondary
                            }

                            SectionCaption {
                                text: I18n.tr("shell.mcp.manage.toolsLabel")
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.mcp.manage.toolsPending")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: Theme.spacingS

                                AButton {
                                    variant: AButton.Default
                                    text: I18n.tr("shell.mcp.manage.testConnection")
                                    onClicked: page.activeTab = 2
                                }

                                Item { Layout.fillWidth: true }

                                Text {
                                    text: I18n.tr("shell.mcp.manage.disable")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    color: Theme.textSecondary
                                }

                                DeferredSwitch {
                                    checked: true
                                }

                                DeferredButton {
                                    variant: AButton.Danger
                                    text: I18n.tr("shell.mcp.manage.delete")
                                }
                            }
                        }
                    }
                }

                Text {
                    Layout.fillWidth: true
                    Layout.maximumWidth: 560
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.mcp.manage.exampleNote")
                    font.family: Theme.fontBody
                    font.pixelSize: 11
                    color: Theme.textSecondary
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
                            text: I18n.tr("shell.mcp.manage.commandLabel")
                        }

                        ATextField {
                            Layout.fillWidth: true
                            placeholderText: I18n.tr("shell.mcp.manage.commandPlaceholder")
                        }

                        FieldLabel {
                            text: I18n.tr("shell.mcp.manage.argsLabel")
                        }

                        ATextField {
                            Layout.fillWidth: true
                            placeholderText: I18n.tr("shell.mcp.manage.argsPlaceholder")
                        }

                        RowLayout {
                            Layout.fillWidth: true

                            Item { Layout.fillWidth: true }

                            DeferredButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.mcp.manage.addStdio")
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
                                    enabled: false
                                    model: [I18n.tr("shell.mcp.test.targetExample")]
                                    currentIndex: 0
                                }

                                MouseArea {
                                    id: serverSelectHover
                                    anchors.fill: parent
                                    hoverEnabled: true
                                }

                                ATooltip {
                                    text: I18n.tr("shell.mcp.deferredTip")
                                    visible: serverSelectHover.containsMouse
                                    x: 0
                                    y: parent.height + Theme.spacingS
                                }
                            }

                            DeferredButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.mcp.test.runProbe")
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
                                text: I18n.tr("shell.mcp.manage.transportStdio")
                            }

                            Text {
                                Layout.fillWidth: true
                                text: "npx -y open-websearch@latest"
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
                    Layout.fillWidth: true

                    AEmptyState {
                        Layout.fillWidth: true
                        implicitHeight: 180
                        icon: "🛠️"
                        title: I18n.tr("shell.mcp.test.emptyToolsTitle")
                        subtitle: I18n.tr("shell.mcp.test.emptyToolsSubtitle")
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
                            Layout.fillWidth: true
                            enabled: false
                            placeholderText: I18n.tr("shell.mcp.test.toolNamePlaceholder")
                        }

                        FieldLabel {
                            text: I18n.tr("shell.mcp.test.toolArgsLabel")
                        }

                        ATextArea {
                            Layout.fillWidth: true
                            implicitHeight: 96
                            enabled: false
                            placeholderText: I18n.tr("shell.mcp.test.toolArgsPlaceholder")
                        }

                        RowLayout {
                            Layout.fillWidth: true

                            Item { Layout.fillWidth: true }

                            DeferredButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.mcp.test.callTool")
                            }
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
