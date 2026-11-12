// SPDX-License-Identifier: GPL-3.0-or-later
// Plugin Host (devtools) — UI-complete scaffold.
// Structural port of packages/stage-pages/src/pages/devtools/plugin-host.vue
// (an Electron-only debug page backed by @proj-airi/plugin-sdk's PluginHost).
// There is NO plugin host in the Qt build: no manifest discovery on disk, no
// enablement store, no plugin-sdk bridge, no sessions, no capability bus.
// The Electron host (apps/stage-tamagotchi/src/main/services/airi/plugins/
// index.ts) discovers manifests from <userData>/plugins/v1/<plugin>/*.json
// (apiVersion v1, kind manifest.plugin.airi.moeru.ai) and persists enablement
// to plugins-v1.json. None of that is read or written here. Every mutating
// control is rendered but disabled with an explanatory tooltip; the page says
// so persistently in the banner up top. Nothing is persisted.
// The example plugins listed are repository integration packages under
// integrations/ (airi-plugin-claude-code, airi-plugin-oh-my-pi,
// airi-plugin-vscode), shown as documentation of what a plugin looks like —
// none ships a plugin-host manifest today and none is installed here.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    // ── Deferred-control idioms (the honest "not wired" pattern) ─────────
    // Disabled AButton + ATooltip on wrapper hover (used for every action).
    component DeferredButton: Item {
        id: deferred

        property string text: ""
        property int variant: AButton.Default
        property string tip: I18n.tr("shell.pluginHost.deferredTip")

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

    // Disabled ASwitch + ATooltip on wrapper hover.
    component DeferredSwitch: Item {
        id: deferredSwitch

        property bool checked: false

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
            text: I18n.tr("shell.pluginHost.deferredTip")
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

    // Label : value row for the host status card.
    component SpecRow: RowLayout {
        id: specRow

        property string label: ""
        property string value: ""

        Layout.fillWidth: true
        spacing: Theme.spacingM

        Text {
            text: specRow.label
            font.family: Theme.fontBody
            font.pixelSize: 12
            color: Theme.textSecondary
        }

        Item { Layout.fillWidth: true }

        Text {
            Layout.maximumWidth: 320
            text: specRow.value
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignRight
            font.family: Theme.fontBody
            font.pixelSize: 12
            font.bold: true
            color: Theme.textPrimary
        }
    }

    // Stat tile (Vue 4-up Discovered/Enabled/Loaded/Capabilities grid).
    // Values stay "—" because nothing is measured in this build.
    component StatTile: Rectangle {
        id: statTile

        property string label: ""

        Layout.fillWidth: true
        implicitHeight: 88
        radius: Theme.radiusM
        color: Theme.surfaceHover

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: Theme.spacingM
            spacing: 2

            Text {
                text: statTile.label
                font.family: Theme.fontBody
                font.pixelSize: 11
                font.capitalization: Font.AllUppercase
                color: Theme.textSecondary
            }

            Text {
                text: "—"
                font.family: Theme.fontTitle
                font.pixelSize: 24
                font.bold: true
                color: Theme.textPrimary
            }
        }
    }

    // Documentation example row: a repository integration package, shown to
    // document the shape of a plugin. Not installed, not discovered.
    component ExamplePluginRow: Item {
        id: exampleRow

        property string pluginName: ""
        property string packageName: ""
        property string version: ""
        property string repoPath: ""

        Layout.fillWidth: true
        implicitHeight: rowContent.implicitHeight + 2 * Theme.spacingM

        Rectangle {
            anchors.fill: parent
            radius: Theme.radiusM
            color: Theme.surfaceHover
            border.width: 1
            border.color: Theme.border
        }

        ColumnLayout {
            id: rowContent
            anchors.fill: parent
            anchors.margins: Theme.spacingM
            spacing: Theme.spacingS

            RowLayout {
                Layout.fillWidth: true
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
                        text: exampleRow.pluginName
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    Text {
                        text: exampleRow.packageName + " · v" + exampleRow.version
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        color: Theme.textSecondary
                    }
                }

                ABadge {
                    variant: "info"
                    text: I18n.tr("shell.pluginHost.examples.badge")
                }

                ABadge {
                    variant: "default"
                    text: I18n.tr("shell.pluginHost.examples.chipNotWired")
                }

                Item { Layout.fillWidth: true }

                DeferredSwitch {
                    checked: false
                }
            }

            Text {
                Layout.fillWidth: true
                text: exampleRow.repoPath
                font.family: Theme.fontBody
                font.pixelSize: 11
                wrapMode: Text.WrapAnywhere
                color: Theme.textSecondary
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                Item { Layout.fillWidth: true }

                DeferredButton {
                    variant: AButton.Default
                    text: I18n.tr("shell.pluginHost.examples.load")
                }

                DeferredButton {
                    variant: AButton.Ghost
                    text: I18n.tr("shell.pluginHost.examples.unload")
                }
            }
        }
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
                    text: I18n.tr("shell.pluginHost.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "warning"
                    text: I18n.tr("shell.pluginHost.notWiredBadge")
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 560
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.pluginHost.description")
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
                        text: I18n.tr("shell.pluginHost.deferredNotice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // ── Plugin host status card ───────────────────────────────────
            SectionCaption {
                text: I18n.tr("shell.pluginHost.host.section")
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        Rectangle {
                            implicitWidth: 10
                            implicitHeight: 10
                            radius: 5
                            color: Theme.textSecondary
                        }

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.pluginHost.host.stateValue")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textSecondary
                        }

                        ABadge {
                            variant: "warning"
                            text: I18n.tr("shell.pluginHost.notWiredBadge")
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    SpecRow {
                        label: I18n.tr("shell.pluginHost.host.stateLabel")
                        value: I18n.tr("shell.pluginHost.host.stateValue")
                    }

                    SpecRow {
                        label: I18n.tr("shell.pluginHost.host.busLabel")
                        value: I18n.tr("shell.pluginHost.host.busValue")
                    }

                    SpecRow {
                        label: I18n.tr("shell.pluginHost.host.manifestRootLabel")
                        value: "<userData>/plugins/v1"
                    }

                    SpecRow {
                        label: I18n.tr("shell.pluginHost.host.configLabel")
                        value: "plugins-v1.json"
                    }

                    SpecRow {
                        label: I18n.tr("shell.pluginHost.host.portLabel")
                        value: I18n.tr("shell.pluginHost.host.portValue")
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.pluginHost.host.portHint")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        color: Theme.textSecondary
                    }
                }
            }

            // ── Stats (unknown in this build; shown as "—") ───────────────
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                StatTile { label: I18n.tr("shell.pluginHost.stats.discovered") }
                StatTile { label: I18n.tr("shell.pluginHost.stats.enabled") }
                StatTile { label: I18n.tr("shell.pluginHost.stats.loaded") }
                StatTile { label: I18n.tr("shell.pluginHost.stats.capabilities") }
            }

            // ── Installed plugins ─────────────────────────────────────────
            SectionCaption {
                text: I18n.tr("shell.pluginHost.installed.section")
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                Item {
                    Layout.fillWidth: true
                    Layout.minimumWidth: 180
                    implicitHeight: filterField.implicitHeight

                    ATextField {
                        id: filterField
                        anchors.fill: parent
                        enabled: false
                        placeholderText: I18n.tr("shell.pluginHost.filter.placeholder")
                    }

                    MouseArea {
                        id: filterHover
                        anchors.fill: parent
                        hoverEnabled: true
                    }

                    ATooltip {
                        text: I18n.tr("shell.pluginHost.deferredTip")
                        visible: filterHover.containsMouse
                        x: 0
                        y: parent.height + Theme.spacingS
                    }
                }

                DeferredButton {
                    variant: AButton.Default
                    text: I18n.tr("shell.pluginHost.actions.refresh")
                }

                DeferredButton {
                    variant: AButton.Accent
                    text: I18n.tr("shell.pluginHost.actions.loadEnabled")
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                Item {
                    Layout.fillWidth: true
                    Layout.minimumWidth: 180
                    implicitHeight: loadNameField.implicitHeight

                    ATextField {
                        id: loadNameField
                        anchors.fill: parent
                        enabled: false
                        placeholderText: I18n.tr("shell.pluginHost.actions.loadByNamePlaceholder")
                    }

                    MouseArea {
                        id: loadNameHover
                        anchors.fill: parent
                        hoverEnabled: true
                    }

                    ATooltip {
                        text: I18n.tr("shell.pluginHost.deferredTip")
                        visible: loadNameHover.containsMouse
                        x: 0
                        y: parent.height + Theme.spacingS
                    }
                }

                DeferredButton {
                    variant: AButton.Accent
                    text: I18n.tr("shell.pluginHost.actions.loadPlugin")
                }
            }

            ACard {
                Layout.fillWidth: true

                AEmptyState {
                    Layout.fillWidth: true
                    implicitHeight: 220
                    icon: "🧩"
                    title: I18n.tr("shell.pluginHost.installed.emptyTitle")
                    subtitle: I18n.tr("shell.pluginHost.installed.emptySubtitle")
                }
            }

            // ── Documented example plugins (not installed) ────────────────
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                SectionCaption {
                    Layout.fillWidth: true
                    text: I18n.tr("shell.pluginHost.examples.section")
                }

                ABadge {
                    variant: "info"
                    text: I18n.tr("shell.pluginHost.examples.badge")
                }
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    ExamplePluginRow {
                        pluginName: "airi-plugin-claude-code"
                        packageName: "@proj-airi/airi-plugin-claude-code"
                        version: "0.9.0-alpha.15"
                        repoPath: "integrations/claude-code/airi-plugin-claude-code"
                    }

                    ExamplePluginRow {
                        pluginName: "airi-plugin-oh-my-pi"
                        packageName: "@proj-airi/airi-plugin-oh-my-pi"
                        version: "0.9.0-alpha.15"
                        repoPath: "integrations/oh-my-pi/airi-plugin-oh-my-pi"
                    }

                    ExamplePluginRow {
                        pluginName: "airi-plugin-vscode"
                        packageName: "@proj-airi/airi-plugin-vscode"
                        version: "0.9.0-alpha.15"
                        repoPath: "integrations/vscode/airi-plugin-vscode"
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.pluginHost.examples.note")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        color: Theme.textSecondary
                    }
                }
            }

            // ── Capabilities ──────────────────────────────────────────────
            SectionCaption {
                text: I18n.tr("shell.pluginHost.capabilities.section")
            }

            ACard {
                Layout.fillWidth: true

                AEmptyState {
                    Layout.fillWidth: true
                    implicitHeight: 160
                    icon: "📡"
                    title: I18n.tr("shell.pluginHost.capabilities.emptyTitle")
                    subtitle: I18n.tr("shell.pluginHost.capabilities.emptySubtitle")
                }
            }

            // ── Actions ───────────────────────────────────────────────────
            SectionCaption {
                text: I18n.tr("shell.pluginHost.actions.section")
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                DeferredButton {
                    variant: AButton.Default
                    text: I18n.tr("shell.pluginHost.actions.reload")
                }

                DeferredButton {
                    variant: AButton.Default
                    text: I18n.tr("shell.pluginHost.actions.openDir")
                }

                DeferredButton {
                    variant: AButton.Accent
                    text: I18n.tr("shell.pluginHost.actions.newScaffold")
                }
            }

            // ── Plugin host settings (hypothetical; disabled) ─────────────
            SectionCaption {
                text: I18n.tr("shell.pluginHost.hostSettings.section")
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    FieldLabel {
                        text: I18n.tr("shell.pluginHost.hostSettings.portLabel")
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.pluginHost.hostSettings.portDescription")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        color: Theme.textSecondary
                    }

                    Item {
                        Layout.fillWidth: true
                        implicitHeight: portField.implicitHeight

                        ATextField {
                            id: portField
                            anchors.fill: parent
                            enabled: false
                            placeholderText: I18n.tr("shell.pluginHost.hostSettings.portPlaceholder")
                        }

                        MouseArea {
                            id: portHover
                            anchors.fill: parent
                            hoverEnabled: true
                        }

                        ATooltip {
                            text: I18n.tr("shell.pluginHost.deferredTip")
                            visible: portHover.containsMouse
                            x: 0
                            y: parent.height + Theme.spacingS
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.pluginHost.hostSettings.portHint")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        color: Theme.textSecondary
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    FieldLabel {
                        text: I18n.tr("shell.pluginHost.hostSettings.logLevelLabel")
                    }

                    Item {
                        Layout.fillWidth: true
                        implicitHeight: logLevelSelect.implicitHeight

                        ASelect {
                            id: logLevelSelect
                            anchors.fill: parent
                            enabled: false
                            model: ["debug", "info", "warn", "error"]
                            currentIndex: 1
                        }

                        MouseArea {
                            id: logLevelHover
                            anchors.fill: parent
                            hoverEnabled: true
                        }

                        ATooltip {
                            text: I18n.tr("shell.pluginHost.deferredTip")
                            visible: logLevelHover.containsMouse
                            x: 0
                            y: parent.height + Theme.spacingS
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    FieldLabel {
                        text: I18n.tr("shell.pluginHost.hostSettings.pluginDirLabel")
                    }

                    Item {
                        Layout.fillWidth: true
                        implicitHeight: pluginDirField.implicitHeight

                        ATextField {
                            id: pluginDirField
                            anchors.fill: parent
                            enabled: false
                            placeholderText: I18n.tr("shell.pluginHost.hostSettings.pluginDirPlaceholder")
                        }

                        MouseArea {
                            id: pluginDirHover
                            anchors.fill: parent
                            hoverEnabled: true
                        }

                        ATooltip {
                            text: I18n.tr("shell.pluginHost.deferredTip")
                            visible: pluginDirHover.containsMouse
                            x: 0
                            y: parent.height + Theme.spacingS
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.pluginHost.hostSettings.pluginDirHint")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        color: Theme.textSecondary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Item { Layout.fillWidth: true }

                        DeferredButton {
                            variant: AButton.Accent
                            text: I18n.tr("shell.pluginHost.hostSettings.save")
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
