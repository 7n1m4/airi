// SPDX-License-Identifier: GPL-3.0-or-later
// Cloud Sync module — UI-complete scaffold.
// Structural port of packages/stage-pages/src/pages/settings/modules/cloud-sync.vue
// (sync-engine store surface + provider pages settings/providers/cloud/s3.vue and
// local-fs.vue for the credential fields). There is NO Rust sync engine in the Qt
// build: no S3/local-FS client, no IndexedDB snapshot pipeline, no conflict
// contraction guard, no libp2p mesh. Every mutating control is rendered but
// disabled with an explanatory tooltip; the page says so persistently in the
// banner up top. Nothing here is persisted, and no status is fabricated — the
// only honest values are "Not wired" and "never" (last sync).
// The Qt shell has no sync-provider sub-pages, so the credential fields upstream
// keeps under /settings/providers/cloud/* are inlined into the Storage Target
// card here; the "Configure" route upstream is intentionally omitted.
// Dialogs (Selective Sync scope, Prune Unlinked Models) are intentionally not
// ported — they would be dead UI.
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
                    text: I18n.tr("shell.cloudSync.notWiredBadge")
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
                        text: I18n.tr("shell.cloudSync.deferredNotice")
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

                    // Status row — "Not wired" state; no fabricated sync time.
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
                            text: I18n.tr("shell.cloudSync.storage.notWiredState")
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
                            text: I18n.tr("shell.cloudSync.notWiredBadge")
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

                        DeferredSelect {
                            Layout.fillWidth: true
                            model: [
                                I18n.tr("shell.cloudSync.storage.providerS3"),
                                I18n.tr("shell.cloudSync.storage.providerLocalFs")
                            ]
                            currentIndex: 0
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

                    DeferredField {
                        label: I18n.tr("shell.cloudSync.storage.localPathLabel")
                        description: I18n.tr("shell.cloudSync.storage.localPathDescription")
                        placeholder: I18n.tr("shell.cloudSync.storage.localPathPlaceholder")
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        DeferredButton {
                            variant: AButton.Accent
                            text: I18n.tr("shell.cloudSync.storage.testConnection")
                        }

                        Item { Layout.fillWidth: true }
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
                                text: I18n.tr("shell.cloudSync.actions.lastSyncedNever")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }

                        DeferredButton {
                            variant: AButton.Default
                            text: I18n.tr("shell.cloudSync.actions.selectiveSync")
                        }

                        DeferredButton {
                            variant: AButton.Accent
                            text: I18n.tr("shell.cloudSync.actions.syncNow")
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
}
