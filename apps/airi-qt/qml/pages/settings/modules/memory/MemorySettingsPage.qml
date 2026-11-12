// SPDX-License-Identifier: GPL-3.0-or-later
// Memory module — settings for the short-term / long-term (journal) memory
// surfaces. Wired to the `MemoryController` bridge
// (crates/airi-qt/src/bridges/memory.rs), which persists the memory
// preference blob under `settings/memory` (`enabled`, `topK`) and reads the
// live airi-store journal (`journal_entries`, migration v2) for the
// long-term card. What WORKS in this slice: the enable switch, the top-k
// spinbox (persisted immediately, clamped 1–20), the journal count badge,
// the recent-entries list (id/timestamp/kind/text — no delete path
// exists in the backend), and "Index memories now" — an explicit
// backfill that embeds all unembedded journal/summary rows with the
// configured chat provider (one batched embedding call). When the switch
// is on, the chat pipeline journals each completed turn as a `note` entry
// and embeds it with one batched call per turn; retrieval injects a
// leading system message ("Relevant memories …") assembled by
// `MemoryRetrieval::build_prompt_block`. When off, chat behavior is
// unchanged. Short-term summarization still does not run. The
// retrieval-provider line shows the chat pipeline's current provider when
// one is configured (smoke override, then env `AIRI_QT_PROVIDER`, then the
// first enabled provider row), never any key material.
// Structural source: packages/stage-pages/src/pages/settings/modules/memory-short-term.vue and
// memory-long-term.vue (enable toggles, per-card rebuild/delete actions in
// Vue are deliberately NOT ported — no Qt equivalents exist backend-side).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

pragma ComponentBehavior: Bound

Item {
    id: page

    property var entries: []
    property string saveError: ""
    property bool indexing: false

    MemoryController {
        id: controller
    }

    Connections {
        target: controller

        function onStateChanged() {
            page.reloadEntries()
        }
    }

    function reloadEntries() {
        var parsed = []
        try {
            parsed = JSON.parse(controller.recentJson)
        } catch (e) {
            console.log("[airi-qt] memory: failed to parse recentJson:", e)
            parsed = []
        }
        page.entries = Array.isArray(parsed) ? parsed : []
    }

    function applyResult(ok) {
        page.saveError = ok ? "" : I18n.tr("shell.memory.saveError")
    }

    // Kind chip variant: note→info, dream→accent, milestone→success, summary→warning.
    function kindVariant(kind) {
        switch (kind) {
        case "note": return "info"
        case "dream": return "accent"
        case "milestone": return "success"
        case "summary": return "warning"
        default: return "default"
        }
    }

    // Relative for < 24h, absolute otherwise. Unparseable input → "".
    function formatTimestamp(ms) {
        var d = (typeof ms === "number") ? new Date(ms) : new Date(Number(ms))
        if (isNaN(d.getTime()))
            return ""
        var diff = Date.now() - d.getTime()
        if (diff < 60 * 1000)
            return I18n.tr("shell.memory.time.justNow")
        if (diff < 60 * 60 * 1000)
            return I18n.tr("shell.memory.time.minutesAgo").arg(Math.floor(diff / 60000))
        if (diff < 24 * 60 * 60 * 1000)
            return I18n.tr("shell.memory.time.hoursAgo").arg(Math.floor(diff / 3600000))
        return Qt.formatDateTime(d, "yyyy-MM-dd HH:mm")
    }

    Component.onCompleted: {
        controller.refresh()
        page.reloadEntries()
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
                    text: I18n.tr("shell.memory.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    id: infoBadge
                    variant: "info"
                    text: I18n.tr("shell.memory.badge")

                    MouseArea {
                        id: infoBadgeHover
                        anchors.fill: parent
                        hoverEnabled: true
                        acceptedButtons: Qt.NoButton
                    }

                    ATooltip {
                        text: I18n.tr("shell.memory.infoTip")
                        visible: infoBadgeHover.containsMouse
                        x: 0
                        y: infoBadge.height + Theme.spacingS
                    }
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 640
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.memory.description")
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
                        // Raw English (bridge convention): the locales lane owns
text: I18n.tr("shell.memory.experimentalNotice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // ══ Enable ═══════════════════════════════════════════════════
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ASwitch {
                            checked: controller.enabled
                            onToggled: page.applyResult(controller.setEnabled(checked))
                        }

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Text {
                                text: I18n.tr("shell.memory.enable.title")
                                font.family: Theme.fontBody
                                font.pixelSize: 14
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.memory.enable.description")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }
                    }

                    Text {
                        visible: !controller.enabled
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.memory.enable.disabledCaption")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        font.italic: true
                        color: Theme.textSecondary
                    }
                }
            }

            // ══ Short-term / retrieval ═══════════════════════════════════
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
                            text: I18n.tr("shell.memory.shortTerm.title")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        ABadge {
                            variant: "success"
                            text: I18n.tr("shell.memory.shortTerm.badge")
                        }
                    }

                    // top-k row (disabled + tooltip while memory is disabled).
                    Item {
                        id: topKRow
                        Layout.fillWidth: true
                        implicitHeight: topKRowLayout.implicitHeight

                        RowLayout {
                            id: topKRowLayout
                            width: parent ? parent.width : implicitWidth
                            spacing: Theme.spacingM
                            enabled: controller.enabled
                            opacity: controller.enabled ? 1 : 0.45

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 2

                                FieldLabel {
                                    text: I18n.tr("shell.memory.topK.label")
                                }

                                Text {
                                    Layout.fillWidth: true
                                    wrapMode: Text.WordWrap
                                    text: I18n.tr("shell.memory.topK.description")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    color: Theme.textSecondary
                                }
                            }

                            AInputNumber {
                                from: 1
                                to: 20
                                stepSize: 1
                                decimals: 0
                                enabled: controller.enabled
                                value: controller.topK
                                onValueModified: page.applyResult(controller.setTopK(Math.round(value)))
                            }
                        }

                        MouseArea {
                            id: topKHover
                            anchors.fill: parent
                            hoverEnabled: true
                            enabled: !controller.enabled
                            acceptedButtons: Qt.NoButton
                        }

                        ATooltip {
                            text: I18n.tr("shell.memory.topK.disabledTip")
                            visible: !controller.enabled && topKHover.containsMouse
                            x: 0
                            y: topKRow.height + Theme.spacingS
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    // Retrieval provider row: the chat pipeline's current provider, never keys.
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        FieldLabel {
                            text: I18n.tr("shell.memory.provider.label")
                        }

                        Item {
                            Layout.fillWidth: true
                        }

                        ABadge {
                            variant: controller.retrievalProvider.length > 0 ? "info" : "default"
                            text: controller.retrievalProvider.length > 0
                                ? controller.retrievalProvider
                                : I18n.tr("shell.memory.provider.notConfigured")
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.memory.shortTerm.note")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        color: Theme.textSecondary
                    }
                }
            }

            // ══ Long-term journal ════════════════════════════════════════
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
                            text: I18n.tr("shell.memory.journal.title")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        ABadge {
                            variant: "default"
                            text: String(controller.journalCount)
                        }

                        AButton {
                            variant: AButton.Ghost
                            text: I18n.tr("shell.memory.journal.refresh")
                            implicitHeight: 30
                            onClicked: {
                                controller.refresh()
                                page.reloadEntries()
                            }
                        }
                    }

                    // ── Index backfill action ──────────────────────────
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        AButton {
                            variant: AButton.Ghost
                            implicitHeight: 30
                            enabled: !page.indexing
                            text: I18n.tr("shell.memory.indexNow")
                            onClicked: {
                                page.indexing = true
                                controller.indexMissing()
                                page.indexing = false
                                page.reloadEntries()
                            }
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        Layout.maximumWidth: 640
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.memory.indexHint")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        color: Theme.textSecondary
                    }

                    AEmptyState {
                        visible: page.entries.length === 0
                        Layout.fillWidth: true
                        implicitHeight: 140
                        icon: "📓"
                        title: I18n.tr("shell.memory.journal.emptyTitle")
                        subtitle: I18n.tr("shell.memory.journal.emptySubtitle")
                    }

                    ListView {
                        id: journalList
                        visible: page.entries.length > 0
                        Layout.fillWidth: true
                        implicitHeight: Math.min(360, journalList.count * 74 + Theme.spacingS)
                        clip: true
                        model: page.entries
                        spacing: Theme.spacingS

                        delegate: RowLayout {
                            id: entryRow
                            required property var modelData
                            width: journalList.width
                            spacing: Theme.spacingS

                            ABadge {
                                variant: page.kindVariant(entryRow.modelData.kind)
                                text: entryRow.modelData.kind
                                Layout.alignment: Qt.AlignTop
                            }

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 2

                                Text {
                                    text: page.formatTimestamp(entryRow.modelData.timestampMs)
                                    font.family: Theme.fontBody
                                    font.pixelSize: 10
                                    color: Theme.textSecondary
                                }

                                Text {
                                    Layout.fillWidth: true
                                    text: entryRow.modelData.text
                                    font.family: Theme.fontBody
                                    font.pixelSize: 13
                                    wrapMode: Text.WordWrap
                                    elide: Text.ElideRight
                                    maximumLineCount: 3
                                    color: Theme.textPrimary
                                }
                            }
                        }
                    }
                }
            }

            // ── Persistence footnote ─────────────────────────────────────
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
                        text: I18n.tr("shell.memory.footer")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // ── Status line (raw English, bridge convention) ─────────────
            Text {
                visible: controller.statusLine.length > 0
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: controller.statusLine
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textSecondary
            }

            // Page-level persistence failure (localized).
            Text {
                visible: page.saveError.length > 0
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: page.saveError
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.error
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }
}
