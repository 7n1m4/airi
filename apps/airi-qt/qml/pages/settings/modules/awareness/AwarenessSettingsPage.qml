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
// The "Screen awareness (AT-SPI)" card talks to the same daemon via
// `GetFocusDigest`/`SetExcludedApps` (lane P2; the a11y focus events use
// the same channel screen readers use). The digest is computed on demand
// by the daemon, never cached, never persisted, and is shown only in the
// preview dialog. Exclusions are applied by the daemon BEFORE any content
// exists. Password-field nodes are filtered by the daemon and counted in
// `skipped_password_nodes` — this page never sees their content.
// Structural source: packages/stage-pages/src/pages/settings/modules/* (card
// idioms); MemorySettingsPage.qml (page shape, refresh pattern).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

pragma ComponentBehavior: Bound

Item {
    id: page

    property var auditEntries: []
    // AT-SPI screen-awareness state. `excludedApps` is the user's working
    // copy ONLY: the daemon persists its user exclusion list but exposes no
    // GetExcludedApps, so this starts empty and saving replaces the
    // daemon's user list with exactly what is shown here.
    property var excludedApps: []
    property string digestInlineError: ""
    // Latched when GetFocusDigest reports the a11y bus is unusable on this
    // desktop; the Preview row is then swapped for the unavailable state.
    // Never set from anything but an actual daemon reply.
    property bool digestUnavailable: false
    property var digestResult: ({})

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

    // True when the running daemon reports a `screen` source at all (lane
    // P2a). Absent key ⇒ this daemon predates screen awareness (or was
    // built without it) ⇒ the card degrades to the unavailable state.
    readonly property bool screenReported: controller.running
        && Object.prototype.hasOwnProperty.call(page.sources, "screen")

    // True when screen awareness is inert on this desktop: either the
    // daemon reports no screen source, or a live GetFocusDigest said the
    // a11y bus did not answer. A11y availability is NOT in GetStatus —
    // the digest reply is the only honest signal.
    readonly property bool screenUnavailable:
        (controller.running && !page.screenReported) || page.digestUnavailable

    readonly property var digestLines: {
        const l = page.digestResult && Array.isArray(page.digestResult.lines) ? page.digestResult.lines : []
        return l.slice(0, 12)
    }
    readonly property int digestLineCount: {
        const l = page.digestResult && Array.isArray(page.digestResult.lines) ? page.digestResult.lines : []
        return l.length
    }
    readonly property string digestApp: (page.digestResult && page.digestResult.app) ? String(page.digestResult.app) : ""
    readonly property string digestTitle: (page.digestResult && page.digestResult.title) ? String(page.digestResult.title) : ""
    readonly property int digestTextLength: (page.digestResult && typeof page.digestResult.text_length === "number") ? page.digestResult.text_length : 0
    readonly property int digestSkipped: (page.digestResult && typeof page.digestResult.skipped_password_nodes === "number") ? page.digestResult.skipped_password_nodes : 0

    function persistExcludedApps(previous) {
        const ok = controller.setExcludedApps(JSON.stringify(page.excludedApps))
        if (!ok)
            page.excludedApps = previous // keep UI and daemon in agreement
        return ok
    }

    function addExcludedApp() {
        const name = excludedAppAddField.text.trim()
        if (name.length === 0)
            return
        const folded = name.toLowerCase()
        if (page.excludedApps.some(n => n.toLowerCase() === folded)) {
            excludedAppAddField.text = ""
            return
        }
        const previous = page.excludedApps
        page.excludedApps = page.excludedApps.concat([name])
        excludedAppAddField.text = ""
        page.persistExcludedApps(previous)
    }

    function removeExcludedApp(name) {
        const previous = page.excludedApps
        const folded = name.toLowerCase()
        page.excludedApps = page.excludedApps.filter(n => n.toLowerCase() !== folded)
        page.persistExcludedApps(previous)
    }

    function previewFocusDigest() {
        page.digestInlineError = ""
        if (controller.fetchFocusDigest()) {
            try {
                page.digestResult = JSON.parse(controller.focusDigestJson)
                digestDialog.open()
            } catch (e) {
                page.digestInlineError = "Malformed digest JSON from airi-daemon."
                console.log("[airi-qt] awareness: failed to parse focus digest:", e)
            }
            return
        }
        // No dialog; show the daemon's (raw, spec'd, token-free) line.
        const line = String(controller.statusLine)
        page.digestInlineError = line
        if (line.toLowerCase().indexOf("screen awareness unavailable") !== -1)
            page.digestUnavailable = true
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

            // ══ Screen awareness (AT-SPI) ═══════════════════════════════
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS
                    enabled: controller.running
                    opacity: controller.running ? 1 : 0.45

                    Text {
                        text: I18n.tr("shell.awareness.screen.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    // ── AT-SPI-unavailable state — shown instead of the
                    // interactive content; nothing here is fabricated. ──
                    AEmptyState {
                        visible: page.screenUnavailable
                        Layout.fillWidth: true
                        icon: "🖥️"
                        title: I18n.tr("shell.awareness.screen.unavailableTitle")
                        subtitle: I18n.tr("shell.awareness.screen.unavailableSubtitle")
                    }

                    // ── Interactive content (daemon up, screen source
                    // reported, a11y bus answered) ──
                    ColumnLayout {
                        visible: !page.screenUnavailable
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        // ── Master switch ──
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingM

                            ASwitch {
                                checked: page.sourceEnabled("screen")
                                enabled: controller.running
                                onToggled: controller.toggleSource("screen", checked)
                            }

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 2

                                Text {
                                    text: I18n.tr("shell.awareness.screen.masterTitle")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 13
                                    font.bold: true
                                    color: Theme.textPrimary
                                }

                                Text {
                                    Layout.fillWidth: true
                                    wrapMode: Text.WordWrap
                                    text: I18n.tr("shell.awareness.screen.masterCaption")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    color: Theme.textSecondary
                                }
                            }
                        }

                        ASeparator {
                            Layout.fillWidth: true
                        }

                        // ── Exclusion list editor ──
                        Text {
                            text: I18n.tr("shell.awareness.screen.exclusionsTitle")
                            font.family: Theme.fontBody
                            font.pixelSize: 13
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.awareness.screen.exclusionsCaption")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.awareness.screen.exclusionsSessionNote")
                            font.family: Theme.fontBody
                            font.pixelSize: 11
                            color: Theme.textSecondary
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            ATextField {
                                id: excludedAppAddField
                                Layout.fillWidth: true
                                placeholderText: I18n.tr("shell.awareness.screen.exclusionsPlaceholder")
                                enabled: controller.running
                                onAccepted: page.addExcludedApp()
                            }

                            AButton {
                                variant: AButton.Default
                                text: I18n.tr("shell.awareness.screen.exclusionsAdd")
                                enabled: controller.running
                                onClicked: page.addExcludedApp()
                            }
                        }

                        Text {
                            visible: page.excludedApps.length === 0
                            text: I18n.tr("shell.awareness.screen.exclusionsEmpty")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        ListView {
                            id: excludedAppsList
                            visible: page.excludedApps.length > 0
                            Layout.fillWidth: true
                            implicitHeight: Math.min(180, excludedAppsList.count * 40 + Theme.spacingS)
                            clip: true
                            model: page.excludedApps
                            spacing: Theme.spacingS

                            delegate: RowLayout {
                                id: excludedRow
                                required property string modelData
                                width: excludedAppsList.width
                                spacing: Theme.spacingS

                                Text {
                                    Layout.fillWidth: true
                                    text: excludedRow.modelData
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    elide: Text.ElideRight
                                    color: Theme.textPrimary
                                }

                                AButton {
                                    variant: AButton.Ghost
                                    implicitHeight: 30
                                    text: I18n.tr("shell.awareness.screen.exclusionsRemove")
                                    enabled: controller.running
                                    onClicked: page.removeExcludedApp(excludedRow.modelData)
                                }
                            }
                        }

                        ASeparator {
                            Layout.fillWidth: true
                        }

                        // ── Preview (on-demand only, never on a timer) ──
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            AButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.awareness.screen.preview")
                                enabled: controller.running
                                onClicked: page.previewFocusDigest()
                            }
                        }

                        // Daemon-reported failure (e.g. "no focused accessible
                        // tracked yet (focus a window first)", "excluded", …)
                        // shown verbatim-ish here instead of opening the dialog.
                        Text {
                            visible: page.digestInlineError.length > 0
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: page.digestInlineError
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.warning
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

    // ── Focus-digest preview (shown only after an explicit Preview
    // press; content comes from the daemon, never persisted) ─────────────
    AModal {
        id: digestDialog

        title: I18n.tr("shell.awareness.screen.digestTitle")

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingS

            Text {
                text: I18n.tr("shell.awareness.screen.digestApp")
                font.family: Theme.fontBody
                font.pixelSize: 12
                font.bold: true
                color: Theme.textSecondary
            }

            Text {
                Layout.fillWidth: true
                text: page.digestApp
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textPrimary
                elide: Text.ElideRight
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingS

            Text {
                text: I18n.tr("shell.awareness.screen.digestWindow")
                font.family: Theme.fontBody
                font.pixelSize: 12
                font.bold: true
                color: Theme.textSecondary
            }

            Text {
                Layout.fillWidth: true
                text: page.digestTitle
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textPrimary
                elide: Text.ElideRight
            }
        }

        Text {
            Layout.fillWidth: true
            text: page.digestTextLength + " " + I18n.tr("shell.awareness.screen.digestChars")
                + " · " + page.digestSkipped + " " + I18n.tr("shell.awareness.screen.digestPasswordSkipped")
            font.family: Theme.fontBody
            font.pixelSize: 11
            color: Theme.textSecondary
        }

        ASeparator {
            Layout.fillWidth: true
        }

        ListView {
            id: digestLinesList
            Layout.fillWidth: true
            implicitHeight: Math.min(240, digestLinesList.count * 20 + Theme.spacingS)
            clip: true
            model: page.digestLines
            spacing: 2

            delegate: Text {
                id: digestLine
                required property string modelData
                width: digestLinesList.width
                text: digestLine.modelData
                font.family: "monospace"
                font.pixelSize: 11
                color: Theme.textPrimary
                elide: Text.ElideRight
            }
        }

        Text {
            visible: page.digestLineCount > 12
            Layout.fillWidth: true
            text: I18n.tr("shell.awareness.screen.digestTruncated")
            font.family: Theme.fontBody
            font.pixelSize: 11
            color: Theme.textSecondary
        }

        ASeparator {
            Layout.fillWidth: true
        }

        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: I18n.tr("shell.awareness.screen.digestFooter")
            font.family: Theme.fontBody
            font.pixelSize: 11
            color: Theme.textSecondary
        }

        RowLayout {
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingS

            AButton {
                variant: AButton.Accent
                text: I18n.tr("shell.awareness.screen.digestClose")
                onClicked: digestDialog.close()
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
