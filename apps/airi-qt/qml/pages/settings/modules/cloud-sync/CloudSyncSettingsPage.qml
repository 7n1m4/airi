// SPDX-License-Identifier: GPL-3.0-or-later
// Cloud Sync module — partially wired to the real `SyncController` bridge
// (crates/airi-qt/src/bridges/sync.rs) and the `airi-sync` snapshot engine.
// What WORKS in this slice: the local-folder target (persisted to
// <profile>/airi/sync.json or <platform-data>/airi-qt/sync.json), snapshot
// list refresh, "Test Connection" (probe snapshot, kept on purpose),
// "Sync Now" (snapshot of the Qt data directory), per-snapshot Verify and
// Restore… (dry-run plan confirm; a second explicit "Overwrite anyway" path
// after a DirtyTarget refusal).
// What stays DISABLED in this slice: S3 (not implemented), the sync-interval
// slider (no scheduling backend), Selective Sync, Local Mesh Sync, Conflicts,
// prune, restore-settings-only and the restore-remote-backup row (the
// destructive restore path lives inside each snapshot's Restore… dialog).
// Every disabled control keeps the explanatory tooltip; nothing is persisted
// except the target path, and no status is fabricated.
// The Qt shell has no sync-provider sub-pages, so the credential fields upstream
// keeps under /settings/providers/cloud/* are inlined into the Storage Target
// card here; the "Configure" route upstream is intentionally omitted.
// Dialogs (Selective Sync scope, Prune Unlinked Models) are intentionally not
// ported — they would be dead UI.
pragma ComponentBehavior: Bound
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    // ── Live bridge state ───────────────────────────────────────────────
    // Everything the local-FS slice can honestly do flows through this
    // controller; QML holds only parsed views of its JSON boundary.
    SyncController {
        id: controller
    }

    Connections {
        target: controller
        function onSnapshotsChanged() { page.reloadSnapshots() }
    }

    property var snapshots: []
    property var verifyResults: ({})
    property string storageStatus: ""
    property bool storageStatusOk: true
    property string actionStatus: ""
    property bool actionStatusOk: true
    property string restoreSnapshotId: ""
    property string restoreLabelText: ""
    property var restorePlan: null
    property string restoreError: ""
    property bool restoreOverwriteVisible: false

    readonly property bool targetConfigured: controller.targetPath.trim().length > 0

    Component.onCompleted: {
        controller.refreshSnapshots()
        localPathField.text = controller.targetPath
        page.reloadSnapshots()
    }

    function reloadSnapshots() {
        var parsed = []
        try {
            parsed = JSON.parse(controller.snapshotsJson)
        } catch (e) {
            console.log("[airi-qt] cloud-sync: failed to parse snapshotsJson:", e)
            parsed = []
        }
        page.snapshots = parsed
    }

    function formatBytes(n) {
        if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB"
        if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB"
        if (n >= 1024) return (n / 1024).toFixed(1) + " KB"
        return n + " B"
    }

    function formatDate(ms) {
        return Qt.formatDateTime(new Date(ms), "yyyy-MM-dd HH:mm")
    }

    function snapshotTitle(snap) {
        return (snap.label && snap.label.length > 0) ? snap.label : snap.id
    }

    function saveTarget() {
        var ok = controller.saveTargetPath(localPathField.text)
        page.storageStatusOk = ok
        page.storageStatus = ok
            ? I18n.tr("shell.cloudSync.live.configSaved")
            : controller.lastError
    }

    function runProbe() {
        var raw = controller.probeTarget()
        var res = null
        try {
            res = JSON.parse(raw)
        } catch (e) {
            res = { error: "unexpected bridge response" }
        }
        if (res && res.ok) {
            page.storageStatusOk = true
            page.storageStatus = I18n.tr("shell.cloudSync.live.probeOk").arg(res.probeId)
        } else {
            page.storageStatusOk = false
            page.storageStatus = I18n.tr("shell.cloudSync.live.probeFailed")
                .arg(res && res.error ? res.error : "unknown error")
        }
    }

    function runSyncNow() {
        page.actionStatus = ""
        var ok = controller.createSnapshot("")
        if (ok) {
            page.actionStatusOk = true
            page.actionStatus = I18n.tr("shell.cloudSync.live.syncDone")
        } else {
            page.actionStatusOk = false
            page.actionStatus = controller.lastError
        }
    }

    function runVerify(snap) {
        var raw = controller.verifySnapshot(snap.id)
        var res = null
        try {
            res = JSON.parse(raw)
        } catch (e) {
            res = { error: "unexpected bridge response" }
        }
        var entry = {}
        if (res && res.ok) {
            entry = {
                ok: true,
                text: I18n.tr("shell.cloudSync.live.verifyOk").arg(res.filesChecked).arg(page.formatBytes(res.bytesChecked))
            }
        } else if (res && res.error) {
            entry = { ok: false, text: I18n.tr("shell.cloudSync.live.verifyError").arg(res.error) }
        } else {
            entry = {
                ok: false,
                text: I18n.tr("shell.cloudSync.live.verifyFailed")
                    .arg((res.missing || []).length).arg((res.mismatched || []).length)
            }
        }
        var next = {}
        for (var key in page.verifyResults) {
            if (key !== snap.id)
                next[key] = page.verifyResults[key]
        }
        next[snap.id] = entry
        page.verifyResults = next
    }

    function openRestore(snap) {
        page.restoreSnapshotId = snap.id
        page.restoreLabelText = page.snapshotTitle(snap)
        page.restoreError = ""
        page.restoreOverwriteVisible = false
        page.restorePlan = null
        var raw = controller.dryRunRestore(snap.id)
        var plan = null
        try {
            plan = JSON.parse(raw)
        } catch (e) {
            plan = { error: "unexpected bridge response" }
        }
        page.restorePlan = plan
        restoreModal.open()
    }

    function confirmRestore(allowDirty) {
        var ok = controller.restoreSnapshot(page.restoreSnapshotId, allowDirty)
        if (ok) {
            restoreModal.close()
            page.actionStatusOk = true
            page.actionStatus = I18n.tr("shell.cloudSync.live.restoreDone")
            return
        }
        page.restoreError = controller.lastError
        // "Overwrite anyway" only makes sense when the plan had modified
        // files — the engine's require_clean guard is the only refusal this
        // path relaxes.
        if (!allowDirty && page.restorePlan && (page.restorePlan.overwrite || []).length > 0)
            page.restoreOverwriteVisible = true
    }

    // ── Deferred-control idioms (the honest "not wired" pattern) ─────────
    // Disabled AButton + ATooltip on wrapper hover (used for every action).
    component DeferredButton: Item {
        id: deferred

        property string text: ""
        property int variant: AButton.Default
        property string tip: I18n.tr("shell.cloudSync.deferredTip")

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

    // Disabled ASwitch (optional scalar state) + ATooltip on wrapper hover.
    component DeferredSwitchRow: Item {
        id: row
        property string label: ""
        property string description: ""
        property bool checked: false

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
                checked: row.checked
            }
        }

        MouseArea {
            id: hoverArea
            anchors.fill: parent
            hoverEnabled: true
        }

        ATooltip {
            text: I18n.tr("shell.cloudSync.deferredTip")
            visible: hoverArea.containsMouse
            x: 0
            y: row.height + Theme.spacingS
        }
    }

    // Label + description + disabled field + wrapper tooltip (Vue FieldInput
    // with `disabled` behaviour; password fields set echoMode).
    component DeferredField: ColumnLayout {
        id: field

        property string label: ""
        property string description: ""
        property string placeholder: ""
        property int echoMode: TextInput.Normal

        Layout.fillWidth: true
        spacing: Theme.spacingS

        Text {
            text: field.label
            font.family: Theme.fontBody
            font.pixelSize: 13
            font.bold: true
            color: Theme.textPrimary
        }

        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: field.description
            font.family: Theme.fontBody
            font.pixelSize: 12
            color: Theme.textSecondary
        }

        Item {
            Layout.fillWidth: true
            implicitWidth: input.implicitWidth
            implicitHeight: input.implicitHeight

            ATextField {
                id: input
                anchors.fill: parent
                enabled: false
                echoMode: field.echoMode
                placeholderText: field.placeholder
            }

            MouseArea {
                id: fieldHover
                anchors.fill: parent
                hoverEnabled: true
            }

            ATooltip {
                text: I18n.tr("shell.cloudSync.deferredTip")
                visible: fieldHover.containsMouse
                x: 0
                y: parent.height + Theme.spacingS
            }
        }
    }

    // Disabled ASelect + ATooltip on wrapper hover.
    component DeferredSelect: Item {
        id: selectWrapper

        property var model: []
        property int currentIndex: 0

        implicitWidth: select.implicitWidth
        implicitHeight: select.implicitHeight

        ASelect {
            id: select
            anchors.fill: parent
            enabled: false
            model: selectWrapper.model
            currentIndex: selectWrapper.currentIndex
        }

        MouseArea {
            id: selectHover
            anchors.fill: parent
            hoverEnabled: true
        }

        ATooltip {
            text: I18n.tr("shell.cloudSync.deferredTip")
            visible: selectHover.containsMouse
            x: 0
            y: parent.height + Theme.spacingS
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
                    text: I18n.tr("shell.cloudSync.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "warning"
                    text: I18n.tr("shell.cloudSync.live.partialBadge")
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 560
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.cloudSync.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // ── Persistent partial notice (local FS live, the rest pending) ──
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
                        text: I18n.tr("shell.cloudSync.live.notice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // STORAGE TARGET (S3-compatible / local share)
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.cloudSync.storage.title")
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    // Status row — live target-configuration state from the
                    // bridge; no fabricated sync time.
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        Rectangle {
                            implicitWidth: 10
                            implicitHeight: 10
                            radius: 5
                            color: page.targetConfigured ? Theme.success : Theme.textSecondary
                        }

                        Text {
                            Layout.fillWidth: true
                            text: page.targetConfigured
                                ? I18n.tr("shell.cloudSync.live.stateConfigured")
                                : I18n.tr("shell.cloudSync.live.stateNotConfigured")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: page.targetConfigured ? Theme.textPrimary : Theme.textSecondary
                        }

                        ABadge {
                            variant: "warning"
                            text: I18n.tr("shell.cloudSync.live.partialBadge")
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    // Active provider / target type — upstream routes to the
                    // provider pages; here both targets are inlined below.
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        Text {
                            text: I18n.tr("shell.cloudSync.storage.providerLabel")
                            font.family: Theme.fontBody
                            font.pixelSize: 13
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.cloudSync.storage.providerDescription")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        // ASelect (ComboBox) cannot disable individual items,
                        // so the selector stays enabled with exactly one
                        // selectable option — the local folder target. S3 is
                        // not implemented; the tooltip says so.
                        Item {
                            Layout.fillWidth: true
                            implicitWidth: providerSelect.implicitWidth
                            implicitHeight: providerSelect.implicitHeight

                            ASelect {
                                id: providerSelect
                                anchors.fill: parent
                                model: [I18n.tr("shell.cloudSync.storage.providerLocalFs")]
                                currentIndex: 0
                            }

                            MouseArea {
                                id: providerHover
                                anchors.fill: parent
                                hoverEnabled: true
                            }

                            ATooltip {
                                text: I18n.tr("shell.cloudSync.live.s3PendingTip")
                                visible: providerHover.containsMouse
                                x: 0
                                y: parent.height + Theme.spacingS
                            }
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    SectionCaption {
                        text: I18n.tr("shell.cloudSync.storage.s3Caption")
                        font.pixelSize: 10
                    }

                    DeferredField {
                        label: I18n.tr("shell.cloudSync.storage.endpointLabel")
                        description: I18n.tr("shell.cloudSync.storage.endpointDescription")
                        placeholder: I18n.tr("shell.cloudSync.storage.endpointPlaceholder")
                    }

                    DeferredField {
                        label: I18n.tr("shell.cloudSync.storage.bucketLabel")
                        description: I18n.tr("shell.cloudSync.storage.bucketDescription")
                        placeholder: I18n.tr("shell.cloudSync.storage.bucketPlaceholder")
                    }

                    DeferredField {
                        label: I18n.tr("shell.cloudSync.storage.regionLabel")
                        description: I18n.tr("shell.cloudSync.storage.regionDescription")
                        placeholder: I18n.tr("shell.cloudSync.storage.regionPlaceholder")
                    }

                    DeferredField {
                        label: I18n.tr("shell.cloudSync.storage.accessKeyLabel")
                        description: I18n.tr("shell.cloudSync.storage.accessKeyDescription")
                        placeholder: I18n.tr("shell.cloudSync.storage.accessKeyPlaceholder")
                        echoMode: TextInput.Password
                    }

                    DeferredField {
                        label: I18n.tr("shell.cloudSync.storage.secretKeyLabel")
                        description: I18n.tr("shell.cloudSync.storage.secretKeyDescription")
                        placeholder: I18n.tr("shell.cloudSync.storage.secretKeyPlaceholder")
                        echoMode: TextInput.Password
                    }

                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        label: I18n.tr("shell.cloudSync.storage.pathStyleLabel")
                        description: I18n.tr("shell.cloudSync.storage.pathStyleDescription")
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    SectionCaption {
                        text: I18n.tr("shell.cloudSync.storage.localCaption")
                        font.pixelSize: 10
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        Text {
                            text: I18n.tr("shell.cloudSync.storage.localPathLabel")
                            font.family: Theme.fontBody
                            font.pixelSize: 13
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.cloudSync.storage.localPathDescription")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        ATextField {
                            id: localPathField
                            Layout.fillWidth: true
                            placeholderText: I18n.tr("shell.cloudSync.storage.localPathPlaceholder")
                            onAccepted: page.saveTarget()
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        AButton {
                            variant: AButton.Accent
                            text: I18n.tr("shell.cloudSync.live.save")
                            onClicked: page.saveTarget()
                        }

                        AButton {
                            variant: AButton.Default
                            enabled: !controller.working
                            text: I18n.tr("shell.cloudSync.storage.testConnection")
                            onClicked: page.runProbe()
                        }

                        Item { Layout.fillWidth: true }
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        visible: page.storageStatus.length > 0
                        text: page.storageStatus
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        color: page.storageStatusOk ? Theme.success : Theme.error
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // SYNCHRONIZATION (upstream "Local Sync Settings" card)
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.cloudSync.sync.title")
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        label: I18n.tr("shell.cloudSync.sync.enableLabel")
                        description: I18n.tr("shell.cloudSync.sync.enableDescription")
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    // Sync interval — disabled slider; value shown is the
                    // documented upstream default (settings/sync/interval=30),
                    // not a live setting.
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        RowLayout {
                            Layout.fillWidth: true

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 2

                                Text {
                                    text: I18n.tr("shell.cloudSync.sync.intervalLabel")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 13
                                    font.bold: true
                                    color: Theme.textPrimary
                                }

                                Text {
                                    Layout.fillWidth: true
                                    wrapMode: Text.WordWrap
                                    text: I18n.tr("shell.cloudSync.sync.intervalDescription")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    color: Theme.textSecondary
                                }
                            }

                            Text {
                                text: I18n.tr("shell.cloudSync.sync.intervalValue")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textSecondary
                            }
                        }

                        Item {
                            Layout.fillWidth: true
                            implicitWidth: intervalSlider.implicitWidth
                            implicitHeight: intervalSlider.implicitHeight

                            ASlider {
                                id: intervalSlider
                                anchors.fill: parent
                                enabled: false
                                from: 5
                                to: 120
                                stepSize: 5
                                value: 30
                            }

                            MouseArea {
                                id: intervalHover
                                anchors.fill: parent
                                hoverEnabled: true
                            }

                            ATooltip {
                                text: I18n.tr("shell.cloudSync.deferredTip")
                                visible: intervalHover.containsMouse
                                x: 0
                                y: parent.height + Theme.spacingS
                            }
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    // Conflict strategy — upstream default remote-wins.
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        Text {
                            text: I18n.tr("shell.cloudSync.sync.conflictLabel")
                            font.family: Theme.fontBody
                            font.pixelSize: 13
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.cloudSync.sync.conflictDescription")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        DeferredSelect {
                            Layout.fillWidth: true
                            model: [
                                I18n.tr("shell.cloudSync.sync.conflictLww"),
                                I18n.tr("shell.cloudSync.sync.conflictRemoteWins"),
                                I18n.tr("shell.cloudSync.sync.conflictLocalWins")
                            ]
                            currentIndex: 1
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        label: I18n.tr("shell.cloudSync.sync.selectiveLabel")
                        description: I18n.tr("shell.cloudSync.sync.selectiveDescription")
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // WHAT GETS SYNCED (mirrors upstream selective-sync-panel scope)
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.cloudSync.scope.title")
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    // Required upstream (checked + required in the sync tree).
                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        checked: true
                        label: I18n.tr("shell.cloudSync.scope.coreLabel")
                        description: I18n.tr("shell.cloudSync.scope.coreDescription")
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        label: I18n.tr("shell.cloudSync.scope.avatarLabel")
                        description: I18n.tr("shell.cloudSync.scope.avatarDescription")
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        label: I18n.tr("shell.cloudSync.scope.memoryLabel")
                        description: I18n.tr("shell.cloudSync.scope.memoryDescription")
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        label: I18n.tr("shell.cloudSync.scope.chatLabel")
                        description: I18n.tr("shell.cloudSync.scope.chatDescription")
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // LOCAL MESH SYNC (upstream Electron-gated libp2p section)
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.cloudSync.mesh.title")
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        label: I18n.tr("shell.cloudSync.mesh.enableLabel")
                        description: I18n.tr("shell.cloudSync.mesh.enableDescription")
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        label: I18n.tr("shell.cloudSync.mesh.memoryLabel")
                        description: I18n.tr("shell.cloudSync.mesh.targetDescription")
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        label: I18n.tr("shell.cloudSync.mesh.vaultLabel")
                        description: I18n.tr("shell.cloudSync.mesh.targetDescription")
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    DeferredSwitchRow {
                        Layout.fillWidth: true
                        label: I18n.tr("shell.cloudSync.mesh.companionsLabel")
                        description: I18n.tr("shell.cloudSync.mesh.targetDescription")
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // MANUAL ACTIONS (upstream "Sync Now" trigger panel)
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.cloudSync.actions.title")
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Text {
                                text: I18n.tr("shell.cloudSync.actions.manualTitle")
                                font.family: Theme.fontBody
                                font.pixelSize: 14
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: page.snapshots.length > 0
                                    ? I18n.tr("shell.cloudSync.live.lastSnapshot")
                                        .arg(page.formatDate(page.snapshots[0].createdMs))
                                    : I18n.tr("shell.cloudSync.actions.lastSyncedNever")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }

                        DeferredButton {
                            variant: AButton.Default
                            text: I18n.tr("shell.cloudSync.actions.selectiveSync")
                        }

                        AButton {
                            variant: AButton.Accent
                            enabled: !controller.working
                            text: controller.working
                                ? I18n.tr("shell.cloudSync.live.syncing")
                                : I18n.tr("shell.cloudSync.actions.syncNow")
                            onClicked: page.runSyncNow()
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        visible: page.actionStatus.length > 0
                        text: page.actionStatus
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        color: page.actionStatusOk ? Theme.success : Theme.error
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Text {
                                text: I18n.tr("shell.cloudSync.actions.pruneTitle")
                                font.family: Theme.fontBody
                                font.pixelSize: 14
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.cloudSync.actions.pruneDescription")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }

                        DeferredButton {
                            variant: AButton.Default
                            text: I18n.tr("shell.cloudSync.actions.pruneButton")
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Text {
                                text: I18n.tr("shell.cloudSync.actions.restoreSettingsTitle")
                                font.family: Theme.fontBody
                                font.pixelSize: 14
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.cloudSync.actions.restoreSettingsDescription")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }

                        DeferredButton {
                            variant: AButton.Default
                            text: I18n.tr("shell.cloudSync.actions.restoreSettingsButton")
                        }
                    }

                    ASeparator {
                        Layout.fillWidth: true
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Text {
                                text: I18n.tr("shell.cloudSync.actions.restoreBackupTitle")
                                font.family: Theme.fontBody
                                font.pixelSize: 14
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.cloudSync.actions.restoreBackupDescription")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }

                        DeferredButton {
                            variant: AButton.Danger
                            text: I18n.tr("shell.cloudSync.actions.restoreBackupButton")
                        }
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // SAVED SNAPSHOTS (live, from the target folder)
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.cloudSync.live.snapshotsTitle")
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingS

                    AEmptyState {
                        Layout.fillWidth: true
                        implicitHeight: 140
                        visible: page.snapshots.length === 0
                        icon: "💾"
                        title: I18n.tr("shell.cloudSync.live.snapshotsEmpty")
                        subtitle: I18n.tr("shell.cloudSync.live.snapshotsEmptyHint")
                    }

                    Repeater {
                        model: page.snapshots

                        delegate: ColumnLayout {
                            id: snapshotRow
                            required property var modelData
                            Layout.fillWidth: true
                            spacing: 2

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: Theme.spacingM

                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 2

                                    Text {
                                        Layout.fillWidth: true
                                        elide: Text.ElideRight
                                        text: page.snapshotTitle(snapshotRow.modelData)
                                        font.family: Theme.fontBody
                                        font.pixelSize: 13
                                        font.bold: true
                                        color: Theme.textPrimary
                                    }

                                    Text {
                                        Layout.fillWidth: true
                                        elide: Text.ElideRight
                                        text: snapshotRow.modelData.id
                                            + " · " + page.formatDate(snapshotRow.modelData.createdMs)
                                            + " · " + page.formatBytes(snapshotRow.modelData.totalBytes)
                                            + " · " + I18n.tr("shell.cloudSync.live.fileCount").arg(snapshotRow.modelData.files)
                                        font.family: Theme.fontBody
                                        font.pixelSize: 11
                                        color: Theme.textSecondary
                                    }
                                }

                                AButton {
                                    variant: AButton.Default
                                    enabled: !controller.working
                                    text: I18n.tr("shell.cloudSync.live.verify")
                                    onClicked: page.runVerify(snapshotRow.modelData)
                                }

                                AButton {
                                    variant: AButton.Danger
                                    enabled: !controller.working
                                    text: I18n.tr("shell.cloudSync.live.restore")
                                    onClicked: page.openRestore(snapshotRow.modelData)
                                }
                            }

                            Text {
                                property var result: page.verifyResults[snapshotRow.modelData.id]
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                visible: result !== undefined
                                text: result !== undefined ? result.text : ""
                                font.family: Theme.fontBody
                                font.pixelSize: 11
                                color: result !== undefined && result.ok ? Theme.success : Theme.error
                            }

                            ASeparator {
                                Layout.fillWidth: true
                            }
                        }
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // SYNC CONFLICTS (upstream list, gated on conflicts.length > 0)
            // ═════════════════════════════════════════════════════════════
            SectionCaption {
                text: I18n.tr("shell.cloudSync.conflicts.title")
            }

            ACard {
                Layout.fillWidth: true

                AEmptyState {
                    Layout.fillWidth: true
                    implicitHeight: 180
                    icon: "🛡️"
                    title: I18n.tr("shell.cloudSync.conflicts.emptyTitle")
                    subtitle: I18n.tr("shell.cloudSync.conflicts.emptySubtitle")
                }
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }

    // Restore confirm: shows the dry-run plan (computed by the bridge against
    // the Qt data directory — nothing is written yet). The first confirm
    // keeps require_clean; a DirtyTarget refusal reveals "Overwrite anyway",
    // the only path that passes allow_dirty=true to the bridge.
    AModal {
        id: restoreModal

        title: I18n.tr("shell.cloudSync.live.restoreTitle")

        Text {
            Layout.fillWidth: true
            elide: Text.ElideRight
            text: page.restoreLabelText
            font.family: Theme.fontBody
            font.pixelSize: 14
            font.bold: true
            color: Theme.textPrimary
        }

        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: I18n.tr("shell.cloudSync.live.restoreSubtitle")
            font.family: Theme.fontBody
            font.pixelSize: 12
            color: Theme.textSecondary
        }

        // Plan lines (only when the dry run succeeded).
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2
            visible: page.restorePlan !== null && page.restorePlan.error === undefined

            Text {
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.cloudSync.live.restoreCreate").arg(page.restorePlan ? page.restorePlan.create.length : 0)
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textPrimary
            }

            Text {
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.cloudSync.live.restoreOverwrite").arg(page.restorePlan ? page.restorePlan.overwrite.length : 0)
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textPrimary
            }

            Text {
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.cloudSync.live.restoreUnchanged").arg(page.restorePlan ? page.restorePlan.unchanged.length : 0)
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textSecondary
            }

            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.cloudSync.live.restoreKeep").arg(page.restorePlan ? page.restorePlan.keep.length : 0)
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textSecondary
            }
        }

        // Plan computation failed.
        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            visible: page.restorePlan !== null && page.restorePlan.error !== undefined
            text: I18n.tr("shell.cloudSync.live.restorePlanError") + " " + (page.restorePlan ? page.restorePlan.error : "")
            font.family: Theme.fontBody
            font.pixelSize: 12
            color: Theme.error
        }

        // Non-Dirty failure detail.
        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            visible: page.restoreError.length > 0 && !page.restoreOverwriteVisible
            text: page.restoreError
            font.family: Theme.fontBody
            font.pixelSize: 12
            color: Theme.error
        }

        // DirtyTarget refusal detail + explicit, separate override path.
        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            visible: page.restoreOverwriteVisible
            text: I18n.tr("shell.cloudSync.live.restoreDirtyHint")
            font.family: Theme.fontBody
            font.pixelSize: 12
            font.bold: true
            color: Theme.warning
        }

        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            visible: page.restoreOverwriteVisible
            text: page.restoreError
            font.family: Theme.fontBody
            font.pixelSize: 11
            color: Theme.textSecondary
        }

        RowLayout {
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingS

            AButton {
                variant: AButton.Ghost
                text: I18n.tr("shell.cloudSync.live.cancel")
                onClicked: restoreModal.close()
            }

            AButton {
                variant: AButton.Danger
                visible: !page.restoreOverwriteVisible
                    && page.restorePlan !== null
                    && page.restorePlan.error === undefined
                text: I18n.tr("shell.cloudSync.live.restoreConfirm")
                onClicked: page.confirmRestore(false)
            }

            AButton {
                variant: AButton.Danger
                visible: page.restoreOverwriteVisible
                text: I18n.tr("shell.cloudSync.live.restoreOverwriteAnyway")
                onClicked: page.confirmRestore(true)
            }
        }
    }
}
