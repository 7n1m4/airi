// SPDX-License-Identifier: GPL-3.0-or-later
// Modules — static overview of the AIRI module family.
// Presentational port of packages/stage-pages/src/pages/settings/modules/index.vue
// (SETTINGS_CATALOG_ITEMS grouped cards). The Vue page also renders
// GlobalFacultiesMatrix (faculties/failover defaults per module); that matrix
// is explicitly deferred for Qt v1 (p11-audit.md #216, size L) and is NOT
// ported here. This page is intentionally static: no bridge, no live status,
// no toggles, no navigation. It shows what exists — every module the Qt build
// knows about, grouped by family, with an honest Ready / Experimental /
// Deferred badge and a hover tooltip saying where the module lives today.
// Routes are provided by the settings nav (SettingsWindow.qml); deferred
// entries are disabled and clicking does nothing.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    // Status vocabulary: "ready" (wired/working in Qt), "experimental"
    // (works only under synthetic verification), "deferred" (not in Qt; lives
    // in Electron or nowhere yet). Badge variants: success / warning / default.
    readonly property var sections: [
        {
            titleKey: "shell.modules.sectionChat",
            entries: [
                {
                    icon: "🧠",
                    name: "Memory",
                    status: "ready",
                    blurbKey: "shell.modules.entries.memory.blurb",
                    reasonKey: "shell.modules.entries.memory.reason"
                },
                {
                    icon: "🔊",
                    name: "Speech",
                    status: "ready",
                    blurbKey: "shell.modules.entries.speech.blurb",
                    reasonKey: "shell.modules.entries.speech.reason"
                },
                {
                    icon: "🎤",
                    name: "Hearing",
                    status: "ready",
                    blurbKey: "shell.modules.entries.hearing.blurb",
                    reasonKey: "shell.modules.entries.hearing.reason"
                },
                {
                    icon: "👁️",
                    name: "Vision",
                    status: "deferred",
                    blurbKey: "shell.modules.entries.vision.blurb",
                    reasonKey: "shell.modules.entries.vision.reason"
                },
                {
                    icon: "💭",
                    name: "Consciousness",
                    status: "deferred",
                    blurbKey: "shell.modules.entries.consciousness.blurb",
                    reasonKey: "shell.modules.entries.consciousness.reason"
                },
                {
                    icon: "🖥️",
                    name: "Agentic OS",
                    status: "deferred",
                    blurbKey: "shell.modules.entries.agenticOs.blurb",
                    reasonKey: "shell.modules.entries.agenticOs.reason"
                },
                {
                    icon: "🏃",
                    name: "Text-to-Motion",
                    status: "deferred",
                    blurbKey: "shell.modules.entries.textToMotion.blurb",
                    reasonKey: "shell.modules.entries.textToMotion.reason"
                }
            ]
        },
        {
            titleKey: "shell.modules.sectionIntegrations",
            entries: [
                {
                    icon: "💬",
                    name: "Discord",
                    status: "ready",
                    blurbKey: "shell.modules.entries.discord.blurb",
                    reasonKey: "shell.modules.entries.discord.reason"
                },
                {
                    icon: "🔌",
                    name: "MCP",
                    status: "ready",
                    blurbKey: "shell.modules.entries.mcp.blurb",
                    reasonKey: "shell.modules.entries.mcp.reason"
                },
                {
                    icon: "🤵",
                    name: "ACP / Agents",
                    status: "ready",
                    blurbKey: "shell.modules.entries.acp.blurb",
                    reasonKey: "shell.modules.entries.acp.reason"
                },
                {
                    icon: "☁️",
                    name: "Cloud Sync",
                    status: "ready",
                    blurbKey: "shell.modules.entries.cloudSync.blurb",
                    reasonKey: "shell.modules.entries.cloudSync.reason"
                },
                {
                    icon: "🧩",
                    name: "Plugin Host",
                    status: "deferred",
                    blurbKey: "shell.modules.entries.pluginHost.blurb",
                    reasonKey: "shell.modules.entries.pluginHost.reason"
                }
            ]
        },
        {
            titleKey: "shell.modules.sectionRenderers",
            entries: [
                {
                    icon: "🧍",
                    name: "VRM",
                    status: "ready",
                    blurbKey: "shell.modules.entries.vrm.blurb",
                    reasonKey: "shell.modules.entries.vrm.reason"
                },
                {
                    icon: "🌀",
                    name: "Spine",
                    status: "ready",
                    blurbKey: "shell.modules.entries.spine.blurb",
                    reasonKey: "shell.modules.entries.spine.reason"
                },
                {
                    icon: "🔩",
                    name: "MMD",
                    status: "experimental",
                    blurbKey: "shell.modules.entries.mmd.blurb",
                    reasonKey: "shell.modules.entries.mmd.reason"
                },
                {
                    icon: "🎨",
                    name: "Live2D",
                    status: "deferred",
                    blurbKey: "shell.modules.entries.live2d.blurb",
                    reasonKey: "shell.modules.entries.live2d.reason"
                }
            ]
        },
        {
            titleKey: "shell.modules.sectionCardAi",
            entries: [
                {
                    icon: "🃏",
                    name: "Card Creation Studio",
                    status: "deferred",
                    blurbKey: "shell.modules.entries.cardAiStudio.blurb",
                    reasonKey: "shell.modules.entries.cardAiStudio.reason"
                }
            ]
        }
    ]

    function statusLabel(status) {
        switch (status) {
        case "ready": return I18n.tr("shell.modules.statusReady")
        case "experimental": return I18n.tr("shell.modules.statusExperimental")
        default: return I18n.tr("shell.modules.statusDeferred")
        }
    }

    function statusVariant(status) {
        switch (status) {
        case "ready": return "success"
        case "experimental": return "warning"
        default: return "default"
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

            // Header: title + static-page badge.
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                Text {
                    Layout.fillWidth: true
                    text: I18n.tr("shell.modules.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "info"
                    text: I18n.tr("shell.modules.overviewBadge")
                }
            }

            // Honest banner: this page is static; statuses are not live.
            ACard {
                Layout.fillWidth: true
                borderColor: Theme.info

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: "ℹ️"
                        font.pixelSize: 18
                        color: Theme.info
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.modules.notice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.textSecondary
                    }
                }
            }

            Repeater {
                model: page.sections

                delegate: ColumnLayout {
                    required property var modelData

                    Layout.fillWidth: true
                    spacing: Theme.spacingS

                    Text {
                        Layout.fillWidth: true
                        topPadding: Theme.spacingS
                        text: I18n.tr(modelData.titleKey)
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        font.bold: true
                        color: Theme.textSecondary
                        font.capitalization: Font.AllUppercase
                    }

                    Repeater {
                        model: modelData.entries

                        delegate: ACard {
                            required property var modelData

                            readonly property bool isDeferred: modelData.status === "deferred"

                            Layout.fillWidth: true
                            // Deferred entries are visually inert.
                            opacity: isDeferred ? 0.55 : 1.0

                            RowLayout {
                                width: parent ? parent.width : implicitWidth
                                spacing: Theme.spacingM

                                Text {
                                    text: modelData.icon
                                    font.pixelSize: 24
                                }

                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 2

                                    Text {
                                        Layout.fillWidth: true
                                        text: modelData.name
                                        font.family: Theme.fontBody
                                        font.pixelSize: 14
                                        font.bold: true
                                        color: Theme.textPrimary
                                        elide: Text.ElideRight
                                    }

                                    Text {
                                        Layout.fillWidth: true
                                        wrapMode: Text.WordWrap
                                        text: I18n.tr(modelData.blurbKey)
                                        font.family: Theme.fontBody
                                        font.pixelSize: 12
                                        color: Theme.textSecondary
                                    }
                                }

                                // Badge + hover tooltip (reason / where it lives).
                                Item {
                                    implicitWidth: badge.implicitWidth
                                    implicitHeight: badge.implicitHeight

                                    ABadge {
                                        id: badge
                                        variant: page.statusVariant(modelData.status)
                                        text: page.statusLabel(modelData.status)
                                    }

                                    ATooltip {
                                        text: I18n.tr(modelData.reasonKey)
                                        visible: badgeHover.containsMouse
                                        x: 0
                                        y: parent.height + Theme.spacingS
                                    }

                                    MouseArea {
                                        id: badgeHover
                                        anchors.fill: parent
                                        hoverEnabled: true
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Footer: what this page deliberately does not do.
            Text {
                Layout.fillWidth: true
                topPadding: Theme.spacingS
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.modules.footer")
                font.family: Theme.fontBody
                font.pixelSize: 11
                color: Theme.textSecondary
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }
}
