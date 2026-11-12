// SPDX-License-Identifier: GPL-3.0-or-later
// Stage settings page: stage window open/close + position reset, model
// selection/import, captions configuration with an embedded live preview,
// and control-strip stage/captions toggles. Persists through the
// StageSettingsController bridge (settings/stage-model, settings/captions,
// settings/stage-window, settings/control-strip#enabledButtons).
//
// WindowManager.openStage() is provided by the stage-window lane (post-merge);
// until it exists the toggles still persist settings/stage-window.visible.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Dialogs
import com.airi.airiqt 1.0

Item {
    id: page

    StageSettingsController {
        id: stageCtl
    }

    readonly property var dockValues: ["top", "bottom", "head", "none"]

    property var modelNames: []
    property string saveError: ""
    property string previewCaption: ""
    property bool boundsResetNotice: false

    function basename(path) {
        var parts = path.split(/[\\/]/)
        return parts[parts.length - 1]
    }

    function refreshModels() {
        page.modelNames = stageCtl.listModels()
        var stored = stageCtl.modelId
        var storedBase = stored.length > 0 ? page.basename(stored) : ""
        var idx = page.modelNames.indexOf(storedBase)
        modelSelect.currentIndex = idx
    }

    function selectModel(name) {
        var full = stageCtl.resolveModelPath(name)
        if (full.length === 0) {
            page.saveError = I18n.tr("shell.stage.saveError")
            return
        }
        if (stageCtl.saveModel(full)) {
            page.saveError = ""
        } else {
            page.saveError = I18n.tr("shell.stage.saveError")
        }
    }

    // Convert a file:// URL from a FileDialog to a local filesystem path.
    function localPath(url) {
        var s = url.toString()
        if (s.indexOf("file://") !== 0)
            return s
        s = decodeURIComponent(s.substring(7))
        // Windows: file:///C:/path -> /C:/path
        if (s.length >= 3 && s.charAt(0) === "/" && s.charAt(2) === ":")
            s = s.substring(1)
        return s
    }

    function modelPicked() {
        var src = page.localPath(modelFileDialog.selectedFile)
        if (src.length === 0)
            return
        if (stageCtl.saveModel(src))
            page.saveError = ""
        else
            page.saveError = I18n.tr("shell.stage.saveError")
        page.refreshModels()
    }

    function importPicked() {
        var src = page.localPath(importFileDialog.selectedFile)
        if (src.length === 0)
            return
        var dest = stageCtl.importModel(src)
        if (dest.length === 0) {
            page.saveError = I18n.tr("shell.stage.saveError")
            return
        }
        stageCtl.saveModel(dest)
        page.saveError = ""
        page.refreshModels()
    }

    function saveCaptions() {
        var docking = page.dockValues[Math.max(0, captionsDockingSelect.currentIndex)]
        var ok = stageCtl.saveCaptions(captionsSwitch.checked, fontSizeSlider.value, opacitySlider.value, docking)
        page.saveError = ok ? "" : I18n.tr("shell.stage.saveError")
    }

    function setStageWindowVisible(visible) {
        stageCtl.saveWindowVisible(visible)
        if (visible) {
            if (typeof WindowManager.openStage === "function") {
                WindowManager.openStage()
            } else {
                console.log("[airi-qt] stage settings: WindowManager.openStage() not available yet (pre-merge); persisted stage-window.visible =", visible)
            }
        } else {
            let stageWindow = WindowManager.stageWindow
            if (stageWindow) {
                stageWindow.visible = false
            } else {
                console.log("[airi-qt] stage settings: WindowManager.stageWindow not available yet (pre-merge); persisted stage-window.visible =", visible)
            }
        }
    }

    Timer {
        id: previewTimer
        interval: 4000
        onTriggered: page.previewCaption = ""
    }

    Timer {
        id: noticeTimer
        interval: 4000
        onTriggered: page.boundsResetNotice = false
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

            Text {
                text: I18n.tr("shell.settings.nav.stage")
                font.family: Theme.fontTitle
                font.pixelSize: 22
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 460
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.stage.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // --- Stage window -------------------------------------------
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.stage.windowTitle")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.stage.openStageWindow")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASwitch {
                            id: stageWindowSwitch
                            checked: stageCtl.stageVisible

                            onToggled: page.setStageWindowVisible(checked)
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        AButton {
                            variant: AButton.Ghost
                            text: I18n.tr("shell.stage.resetPosition")

                            onClicked: {
                                stageCtl.resetBounds()
                                page.boundsResetNotice = true
                                noticeTimer.restart()
                            }
                        }

                        Text {
                            Layout.fillWidth: true
                            visible: page.boundsResetNotice
                            text: I18n.tr("shell.stage.boundsResetNotice")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            wrapMode: Text.WordWrap
                            color: Theme.success
                        }
                    }
                }
            }

            // --- Model ---------------------------------------------------
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.stage.modelSection.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.stage.modelSection.hint")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    AEmptyState {
                        Layout.fillWidth: true
                        visible: page.modelNames.length === 0
                        icon: "🎭"
                        title: I18n.tr("shell.stage.modelListEmpty")
                        subtitle: I18n.tr("shell.stage.modelSection.hint")
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        visible: page.modelNames.length > 0

                        ASelect {
                            id: modelSelect
                            Layout.fillWidth: true
                            model: page.modelNames

                            onActivated: page.selectModel(page.modelNames[currentIndex])
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        text: stageCtl.modelId.length > 0 ? stageCtl.modelId : I18n.tr("shell.stage.modelNone")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        elide: Text.ElideMiddle
                        color: Theme.textSecondary
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingS

                        AButton {
                            variant: AButton.Default
                            text: I18n.tr("shell.stage.browseModel")

                            onClicked: modelFileDialog.open()
                        }

                        AButton {
                            variant: AButton.Accent
                            text: I18n.tr("shell.stage.importModel")

                            onClicked: importFileDialog.open()
                        }
                    }
                }
            }

            // --- Captions --------------------------------------------------
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.stage.captions.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.stage.captions.enabled")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ASwitch {
                            id: captionsSwitch
                            checked: stageCtl.captionsEnabled

                            onToggled: page.saveCaptions()
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.stage.captions.fontSize")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ABadge {
                            variant: "accent"
                            text: Math.round(fontSizeSlider.value) + "%"
                        }
                    }

                    ASlider {
                        id: fontSizeSlider
                        Layout.fillWidth: true
                        from: 50
                        to: 200
                        stepSize: 5
                        value: stageCtl.captionsFontSize

                        onMoved: page.saveCaptions()
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.stage.captions.opacity")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ABadge {
                            variant: "accent"
                            text: Math.round(opacitySlider.value) + "%"
                        }
                    }

                    ASlider {
                        id: opacitySlider
                        Layout.fillWidth: true
                        from: 0
                        to: 100
                        stepSize: 5
                        value: stageCtl.captionsOpacity

                        onMoved: page.saveCaptions()
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.stage.captions.docking")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ASelect {
                            id: captionsDockingSelect
                            implicitWidth: 160
                            model: [
                                I18n.tr("shell.stage.captions.top"),
                                I18n.tr("shell.stage.captions.bottom"),
                                I18n.tr("shell.stage.captions.head"),
                                I18n.tr("shell.stage.captions.none"),
                            ]

                            Component.onCompleted: {
                                var docking = stageCtl.captionsDocking
                                var idx = page.dockValues.indexOf(docking)
                                currentIndex = idx >= 0 ? idx : 3
                            }

                            onActivated: page.saveCaptions()
                        }
                    }

                    // Embedded preview: the real CaptionOverlay docked inside a
                    // fixed-height stand-in for the stage window.
                    Rectangle {
                        Layout.fillWidth: true
                        height: 220
                        radius: Theme.radiusM
                        color: Theme.bg
                        border.width: 1
                        border.color: Theme.border
                        clip: true

                        Text {
                            anchors.centerIn: parent
                            visible: page.previewCaption.length === 0
                            text: "🎭"
                            font.pixelSize: 64
                            opacity: 0.6
                        }

                        CaptionOverlay {
                            dock: page.dockValues[Math.max(0, captionsDockingSelect.currentIndex)]
                            captionText: page.previewCaption
                            speaker: "AIRI"
                            fontSizeFactor: fontSizeSlider.value / 100
                            opacity: opacitySlider.value / 100
                        }
                    }

                    AButton {
                        variant: AButton.Ghost
                        text: I18n.tr("shell.stage.captions.preview")

                        onClicked: {
                            page.previewCaption = I18n.tr("shell.stage.captions.previewSample")
                            previewTimer.restart()
                        }
                    }
                }
            }

            // --- Control strip -------------------------------------------
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.stage.stripSection.title")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.stage.stripSection.hint")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.stage.stripSection.stage")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ASwitch {
                            id: stripStageSwitch
                            checked: true

                            onToggled: stageCtl.saveStripButtonEnabled("stage", checked)
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.stage.stripSection.caption")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ASwitch {
                            id: stripCaptionSwitch
                            checked: true

                            onToggled: stageCtl.saveStripButtonEnabled("caption", checked)
                        }
                    }
                }
            }

            Text {
                Layout.fillWidth: true
                visible: page.saveError.length > 0
                text: page.saveError
                font.family: Theme.fontBody
                font.pixelSize: 12
                wrapMode: Text.WordWrap
                color: Theme.error
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }

    // Native file dialogs (QtQuick.Dialogs). Model id may point anywhere;
    // imports are copied into the models dir by the bridge.
    FileDialog {
        id: modelFileDialog
        title: I18n.tr("shell.stage.browseModel")
        fileMode: FileDialog.OpenFile
        nameFilters: ["VRM models (*.vrm)"]

        onAccepted: page.modelPicked()
    }

    FileDialog {
        id: importFileDialog
        title: I18n.tr("shell.stage.importModel")
        fileMode: FileDialog.OpenFile
        nameFilters: ["Models (*.vrm *.spine *.zip)", "All files (*)"]

        onAccepted: page.importPicked()
    }

    Component.onCompleted: {
        stageCtl.loadAll()
        refreshModels()
        stripStageSwitch.checked = stageCtl.stripButtonEnabled("stage")
        stripCaptionSwitch.checked = stageCtl.stripButtonEnabled("caption")
    }
}
