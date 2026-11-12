// SPDX-License-Identifier: GPL-3.0-or-later
// Awareness module — the honest minimal Qt face of the opt-in
// user-session awareness daemon (`airi-daemon`, lane P1a). Wired to the
// `DaemonController` bridge (crates/airi-qt/src/bridges/daemon.rs), which
// talks D-Bus (`org.moeru.airi.Daemon1` on the session bus) — never Rust
// types from the daemon crate. What WORKS in this slice: status display,
// per-source switches, the master kill switch, the local audit viewer
// (recent events from the shared JSONL file) and "Clear audit" (truncate
// to zero bytes; the daemon's in-memory ring buffer is NOT cleared).
// The daemon is dev-run only and is NOT auto-installed; when it is absent
// the page shows an empty state with dev-run instructions and a Retry
// button. Nothing on this page acts autonomously: no agent dispatch, no
// chat wiring, no background side effects beyond one D-Bus GetStatus (and
// one audit-file read) per second.
// Structural source: packages/stage-pages/src/pages/settings/modules/* (card
// idioms); MemorySettingsPage.qml (page shape, refresh pattern).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

pragma ComponentBehavior: Bound

Item {
    id: page

    property var auditEntries: []

    DaemonController {
        id: controller
    }

    // Sources object, re-evaluated whenever the bridge's `sourcesJson`
    // notify signal fires (after every refresh/toggle). Not-a-source keys
    // are tolerated; missing keys read as disabled.
    readonly property var sources: {
        try {
            const s = JSON.parse(controller.sourcesJson)
            return (s && typeof s === "object") ? s : {}
        } catch (e) {
            return {}
        }
    }

    function sourceEnabled(key) {
        return page.sources[key] === true
    }

    function refreshAudit() {
        const raw = controller.recentAudit(50)
        try {
            const parsed = JSON.parse(raw)
            page.auditEntries = Array.isArray(parsed) ? parsed : []
        } catch (e) {
            console.log("[airi-qt] awareness: failed to parse recentAudit:", e)
            page.auditEntries = []
        }
    }

    function formatTimestamp(ms) {
        const d = (typeof ms === "number") ? new Date(ms) : new Date(Number(ms))
        if (isNaN(d.getTime()))
            return ""
        return Qt.formatDateTime(d, "yyyy-MM-dd HH:mm:ss")
    }

    function sourceVariant(source) {
        switch (source) {
        case "sleep": return "info"
        case "lock": return "warning"
        case "media": return "accent"
        case "network": return "success"
        case "power": return "default"
        case "system": return "default"
        default: return "default"
        }
    }

    Component.onCompleted: {
        controller.refresh()
        page.refreshAudit()
    }

    // Poll once per second: one D-Bus GetStatus plus one small JSONL read.
    // Cheap at this cadence; keeps the page honest without signals from
    // the daemon.
    Timer {
        interval: 1000
        repeat: true
        running: true
        onTriggered: {
            controller.refresh()
            page.refreshAudit()
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
                    text: I18n.tr("shell.awareness.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "warning"
                    text: I18n.tr("shell.awareness.badge")
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 640
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.awareness.caption")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // ── Daemon-down card ─────────────────────────────────────────
            ACard {
                Layout.fillWidth: true
                visible: !controller.running

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    AEmptyState {
                        Layout.fillWidth: true
                        icon: "🌙"
                        title: I18n.tr("shell.awareness.daemonDownTitle")
                        subtitle: I18n.tr("shell.awareness.daemonDownSubtitle")

                        AButton {
                            variant: AButton.Accent
                            text: I18n.tr("shell.awareness.retry")
                            onClicked: {
                                controller.refresh()
                                page.refreshAudit()
                            }
                        }
                    }
                }
            }

            // ══ Master kill switch ═══════════════════════════════════════
            ACard {
                Layout.fillWidth: true

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM
                    enabled: controller.running
                    opacity: controller.running ? 1 : 0.45

                    ASwitch {
                        checked: !controller.paused
                        enabled: controller.running
                        onToggled: controller.togglePause()
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2

                        Text {
                            text: I18n.tr("shell.awareness.killSwitch.title")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.awareness.killSwitch.caption")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }
                    }
                }
            }

            // ══ Sources ══════════════════════════════════════════════════
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS
                    enabled: controller.running
                    opacity: controller.running ? 1 : 0.45

                    Text {
                        text: I18n.tr("shell.awareness.sources.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    // ── Sleep/wake ──
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ASwitch {
                            checked: page.sourceEnabled("sleep")
                            enabled: controller.running
                            onToggled: controller.toggleSource("sleep", checked)
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            Text {
                                text: I18n.tr("shell.awareness.sources.sleep.title")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textPrimary
                            }
                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.awareness.sources.sleep.caption")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }
                    }

                    // ── Screen lock ──
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ASwitch {
                            checked: page.sourceEnabled("lock")
                            enabled: controller.running
                            onToggled: controller.toggleSource("lock", checked)
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            Text {
                                text: I18n.tr("shell.awareness.sources.lock.title")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textPrimary
                            }
                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.awareness.sources.lock.caption")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }
                    }

                    // ── Media playback ──
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ASwitch {
                            checked: page.sourceEnabled("media")
                            enabled: controller.running
                            onToggled: controller.toggleSource("media", checked)
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            Text {
                                text: I18n.tr("shell.awareness.sources.media.title")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textPrimary
                            }
                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.awareness.sources.media.caption")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }
                    }

                    // ── Network state ──
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ASwitch {
                            checked: page.sourceEnabled("network")
                            enabled: controller.running
                            onToggled: controller.toggleSource("network", checked)
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            Text {
                                text: I18n.tr("shell.awareness.sources.network.title")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textPrimary
                            }
                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.awareness.sources.network.caption")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }
                    }

                    // ── Battery/AC ──
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ASwitch {
                            checked: page.sourceEnabled("power")
                            enabled: controller.running
                            onToggled: controller.toggleSource("power", checked)
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            Text {
                                text: I18n.tr("shell.awareness.sources.power.title")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textPrimary
                            }
                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.awareness.sources.power.caption")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }
                    }
                }
            }

            // ══ Audit viewer ═════════════════════════════════════════════
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
                            text: I18n.tr("shell.awareness.audit.title")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        AButton {
                            variant: AButton.Ghost
                            implicitHeight: 30
                            text: I18n.tr("shell.awareness.audit.refresh")
                            onClicked: page.refreshAudit()
                        }

                        AButton {
                            variant: AButton.Danger
                            implicitHeight: 30
                            text: I18n.tr("shell.awareness.audit.clear")
                            onClicked: confirmClearDialog.open()
                        }
                    }

                    AEmptyState {
                        visible: page.auditEntries.length === 0
                        Layout.fillWidth: true
                        implicitHeight: 140
                        icon: "👁️"
                        title: I18n.tr("shell.awareness.audit.emptyTitle")
                        subtitle: I18n.tr("shell.awareness.audit.emptySubtitle")
                    }

                    ListView {
                        id: auditList
                        visible: page.auditEntries.length > 0
                        Layout.fillWidth: true
                        implicitHeight: Math.min(360, auditList.count * 62 + Theme.spacingS)
                        clip: true
                        model: page.auditEntries
                        spacing: Theme.spacingS

                        delegate: RowLayout {
                            id: entryRow
                            required property var modelData
                            width: auditList.width
                            spacing: Theme.spacingS

                            ABadge {
                                variant: page.sourceVariant(entryRow.modelData.source)
                                text: entryRow.modelData.source.length > 0 ? entryRow.modelData.source : "system"
                                Layout.alignment: Qt.AlignTop
                            }

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 2

                                Text {
                                    text: page.formatTimestamp(entryRow.modelData.ts_ms)
                                    font.family: Theme.fontBody
                                    font.pixelSize: 10
                                    color: Theme.textSecondary
                                }

                                RowLayout {
                                    spacing: Theme.spacingS

                                    Text {
                                        text: entryRow.modelData.verb
                                        font.family: Theme.fontBody
                                        font.pixelSize: 13
                                        font.bold: true
                                        color: Theme.textPrimary
                                    }

                                    Text {
                                        Layout.fillWidth: true
                                        text: entryRow.modelData.detail
                                        font.family: Theme.fontBody
                                        font.pixelSize: 12
                                        elide: Text.ElideRight
                                        color: Theme.textSecondary
                                    }
                                }
                            }
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    // Honest local-only note (the file is JSONL, not SQLite).
                    Text {
                        Layout.fillWidth: true
                        Layout.maximumWidth: 640
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.awareness.audit.footer")
                        font.family: Theme.fontBody
                        font.pixelSize: 11
                        color: Theme.textSecondary
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WrapAnywhere
                        text: controller.auditPath
                        font.family: Theme.fontBody
                        font.pixelSize: 10
                        color: Theme.textSecondary
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
                color: controller.running ? Theme.textSecondary : Theme.warning
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }

    // ── Clear-audit confirmation ──────────────────────────────────────────
    AModal {
        id: confirmClearDialog

        title: I18n.tr("shell.awareness.confirmClear.title")

        Text {
            Layout.fillWidth: true
            text: I18n.tr("shell.awareness.confirmClear.body")
            font.family: Theme.fontBody
            font.pixelSize: 12
            wrapMode: Text.WordWrap
            color: Theme.textPrimary
        }

        RowLayout {
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingS

            AButton {
                variant: AButton.Ghost
                text: I18n.tr("shell.awareness.confirmClear.cancel")
                onClicked: confirmClearDialog.close()
            }
            AButton {
                variant: AButton.Danger
                text: I18n.tr("shell.awareness.confirmClear.confirm")
                onClicked: {
                    confirmClearDialog.close()
                    controller.clearAudit()
                    page.refreshAudit()
                }
            }
        }
    }
}
