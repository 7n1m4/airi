// SPDX-License-Identifier: GPL-3.0-or-later
// Discord messaging module — UI-complete scaffold.
// Structural port of packages/stage-pages/src/pages/settings/modules/
// messaging-discord.vue (MessagingDiscord.vue in @proj-airi/stage-ui).
// There is NO Rust Discord gateway in the Qt build: no websocket lifecycle,
// no token store, no guild/channel fetch, no event log. Every control is
// rendered but disabled with an explanatory tooltip, nothing is persisted,
// and the page says so persistently in the banner up top.
// The Access & Routing tab is an upstream "demonstration purposes only"
// preview; it is ported dimmed and fully inert, link-free.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    property int activeTab: 0

    // ── Deferred-control idioms (the honest "not wired" pattern) ─────────
    // Disabled ASwitch + ATooltip on wrapper hover.
    component DeferredSwitchRow: Item {
        id: row
        property string label: ""
        property string description: ""

        implicitWidth: content.implicitWidth
        implicitHeight: content.implicitHeight

        RowLayout {
            id: content
            width: parent.width
            spacing: Theme.spacingM

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: row.label
                    font.family: Theme.fontBody
                    font.pixelSize: 14
                    color: Theme.textPrimary
                }

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: row.description
                    font.family: Theme.fontBody
                    font.pixelSize: 12
                    color: Theme.textSecondary
                }
            }

            ASwitch {
                enabled: false
                checked: false
            }
        }

        MouseArea {
            id: hoverArea
            anchors.fill: parent
            hoverEnabled: true
        }

        ATooltip {
            text: I18n.tr("shell.discord.deferredTip")
            visible: hoverArea.containsMouse
            x: 0
            y: row.height + Theme.spacingS
        }
    }

    // Disabled AButton + ATooltip on wrapper hover.
    component DeferredButton: Item {
        id: deferred
        property string text: ""
        property int variant: AButton.Default
        property string tip: I18n.tr("shell.discord.deferredTip")

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

    // Disabled routing-mode option card + ATooltip on wrapper hover.
    component FallbackOption: Item {
        id: option
        property string title: ""
        property string description: ""
        property bool isDefault: false

        implicitHeight: content.implicitHeight + 2 * Theme.spacingM

        Rectangle {
            anchors.fill: parent
            radius: Theme.radiusM
            opacity: 0.55
            color: Theme.surfaceHover
            border.width: 1
            border.color: Theme.border
        }

        ColumnLayout {
            id: content
            anchors.fill: parent
            anchors.margins: Theme.spacingM
            spacing: Theme.spacingS

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: option.title
                    font.family: Theme.fontBody
                    font.pixelSize: 12
                    font.bold: true
                    color: Theme.textPrimary
                }

                ABadge {
                    visible: option.isDefault
                    variant: "default"
                    text: I18n.tr("shell.discord.acl.defaultBadge")
                }
            }

            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: option.description
                font.family: Theme.fontBody
                font.pixelSize: 10
                color: Theme.textSecondary
            }
        }

        MouseArea {
            id: hoverArea
            anchors.fill: parent
            hoverEnabled: true
        }

        ATooltip {
            text: I18n.tr("shell.discord.deferredTip")
            visible: hoverArea.containsMouse
            x: 0
            y: option.height + Theme.spacingS
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
                    text: I18n.tr("shell.discord.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "warning"
                    text: I18n.tr("shell.discord.connectivity.notWiredBadge")
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 460
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.discord.description")
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
                        text: I18n.tr("shell.discord.deferredNotice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // ── Tabs: Bot Connection | Access & Routing ───────────────────
            AToggleGroup {
                Layout.fillWidth: true
                model: [I18n.tr("shell.discord.tabs.bot"), I18n.tr("shell.discord.tabs.acl")]
                currentIndex: page.activeTab

                onToggled: function (index) { page.activeTab = index }
            }

            // ═════════════════════════════════════════════════════════════
            // TAB 1: BOT CONNECTION
            // ═════════════════════════════════════════════════════════════
            ColumnLayout {
                Layout.fillWidth: true
                visible: page.activeTab === 0
                spacing: Theme.spacingM

                SectionCaption {
                    text: I18n.tr("shell.discord.connectivity.title")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingM

                        // Status row — "Not wired" state.
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
                                text: I18n.tr("shell.discord.connectivity.notWiredState")
                                font.family: Theme.fontBody
                                font.pixelSize: 14
                                color: Theme.textSecondary
                            }

                            Text {
                                text: "—"
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            ABadge {
                                variant: "warning"
                                text: I18n.tr("shell.discord.connectivity.notWiredBadge")
                            }
                        }

                        // Bot token — password echo; disabled until the bridge lands.
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Text {
                                text: I18n.tr("shell.discord.connectivity.tokenLabel")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.discord.connectivity.tokenDescription")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            Item {
                                Layout.fillWidth: true
                                implicitWidth: tokenField.implicitWidth
                                implicitHeight: tokenField.implicitHeight

                                ATextField {
                                    id: tokenField
                                    anchors.fill: parent
                                    enabled: false
                                    echoMode: TextInput.Password
                                    placeholderText: I18n.tr("shell.discord.connectivity.tokenPlaceholder")
                                }

                                MouseArea {
                                    id: tokenHover
                                    anchors.fill: parent
                                    hoverEnabled: true
                                }

                                ATooltip {
                                    text: I18n.tr("shell.discord.deferredTip")
                                    visible: tokenHover.containsMouse
                                    x: 0
                                    y: parent.height + Theme.spacingS
                                }
                            }
                        }

                        // Owner username — owner resolution needs the gateway too.
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Text {
                                text: I18n.tr("shell.discord.connectivity.ownerLabel")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.discord.connectivity.ownerDescription")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            Item {
                                Layout.fillWidth: true
                                implicitWidth: ownerField.implicitWidth
                                implicitHeight: ownerField.implicitHeight

                                ATextField {
                                    id: ownerField
                                    anchors.fill: parent
                                    enabled: false
                                    placeholderText: I18n.tr("shell.discord.connectivity.ownerPlaceholder")
                                }

                                MouseArea {
                                    id: ownerHover
                                    anchors.fill: parent
                                    hoverEnabled: true
                                }

                                ATooltip {
                                    text: I18n.tr("shell.discord.deferredTip")
                                    visible: ownerHover.containsMouse
                                    x: 0
                                    y: parent.height + Theme.spacingS
                                }
                            }

                            Text {
                                text: I18n.tr("shell.discord.connectivity.ownerIdPending")
                                font.family: Theme.fontBody
                                font.pixelSize: 10
                                color: Theme.textSecondary
                            }
                        }

                        // Connect / Disconnect — disabled; no gateway to own.
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            DeferredButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.discord.connectivity.connect")
                            }

                            DeferredButton {
                                variant: AButton.Danger
                                text: I18n.tr("shell.discord.connectivity.disconnect")
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.discord.controls.title")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingM

                        DeferredSwitchRow {
                            Layout.fillWidth: true
                            label: I18n.tr("shell.discord.controls.vision")
                            description: I18n.tr("shell.discord.controls.visionDescription")
                        }

                        ASeparator {
                            Layout.fillWidth: true
                        }

                        DeferredSwitchRow {
                            Layout.fillWidth: true
                            label: I18n.tr("shell.discord.controls.dms")
                            description: I18n.tr("shell.discord.controls.dmsDescription")
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.discord.presence.title")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        AEmptyState {
                            Layout.fillWidth: true
                            icon: "🌐"
                            title: I18n.tr("shell.discord.presence.emptyTitle")
                            subtitle: I18n.tr("shell.discord.presence.emptySubtitle")
                        }

                        Item {
                            Layout.alignment: Qt.AlignHCenter
                            implicitWidth: presenceBadge.implicitWidth
                            implicitHeight: presenceBadge.implicitHeight

                            ABadge {
                                id: presenceBadge
                                variant: "warning"
                                text: I18n.tr("shell.discord.presence.bridgeBadge")
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.discord.debug.title")
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingS

                    DeferredButton {
                        text: I18n.tr("shell.discord.debug.forceSync")
                    }

                    DeferredButton {
                        text: I18n.tr("shell.discord.debug.simulate")
                    }

                    DeferredButton {
                        text: I18n.tr("shell.discord.debug.restart")
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.discord.devConsole.title")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingM

                        RowLayout {
                            Layout.fillWidth: true

                            Item { Layout.fillWidth: true }

                            DeferredButton {
                                text: I18n.tr("shell.discord.devConsole.clearLog")
                            }
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: consoleEmpty.implicitHeight + 2 * Theme.spacingL
                            radius: Theme.radiusM
                            color: Theme.bg
                            border.width: 1
                            border.color: Theme.border

                            Text {
                                id: consoleEmpty
                                anchors.centerIn: parent
                                width: parent.width - 2 * Theme.spacingL
                                horizontalAlignment: Text.AlignHCenter
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.discord.devConsole.empty")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // TAB 2: ACCESS & ROUTING — upstream demo preview, inert here
            // ═════════════════════════════════════════════════════════════
            ColumnLayout {
                Layout.fillWidth: true
                visible: page.activeTab === 1
                spacing: Theme.spacingM

                // Preview banner (link-free; external links are unavailable).
                ACard {
                    Layout.fillWidth: true
                    borderColor: Theme.warning

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            ABadge {
                                variant: "warning"
                                text: I18n.tr("shell.discord.acl.demoBadge")
                            }

                            ABadge {
                                variant: "default"
                                text: I18n.tr("shell.discord.acl.previewBadge")
                            }
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.discord.acl.previewTitle")
                            font.family: Theme.fontBody
                            font.pixelSize: 13
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.discord.acl.previewBody")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        RowLayout {
                            Layout.fillWidth: true

                            Item { Layout.fillWidth: true }

                            DeferredButton {
                                text: I18n.tr("shell.discord.acl.linkLabel")
                                tip: I18n.tr("shell.discord.acl.linkTip")
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.discord.acl.fallbackTitle")
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingS

                    FallbackOption {
                        Layout.fillWidth: true
                        isDefault: true
                        title: I18n.tr("shell.discord.acl.fallbackIgnoreTitle")
                        description: I18n.tr("shell.discord.acl.fallbackIgnoreBody")
                    }

                    FallbackOption {
                        Layout.fillWidth: true
                        title: I18n.tr("shell.discord.acl.fallbackSharedTitle")
                        description: I18n.tr("shell.discord.acl.fallbackSharedBody")
                    }

                    FallbackOption {
                        Layout.fillWidth: true
                        title: I18n.tr("shell.discord.acl.fallbackAutoCreateTitle")
                        description: I18n.tr("shell.discord.acl.fallbackAutoCreateBody")
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingS

                    SectionCaption {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.discord.acl.matrixTitle")
                    }

                    DeferredButton {
                        text: I18n.tr("shell.discord.acl.addMapping")
                    }
                }

                ACard {
                    Layout.fillWidth: true

                    AEmptyState {
                        Layout.fillWidth: true
                        icon: "🗺️"
                        title: I18n.tr("shell.discord.acl.matrixEmptyTitle")
                        subtitle: I18n.tr("shell.discord.acl.matrixEmptySubtitle")
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
