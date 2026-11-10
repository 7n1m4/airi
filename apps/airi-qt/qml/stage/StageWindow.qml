// SPDX-License-Identifier: GPL-3.0-or-later
// Stage window: frameless, translucent, always-on-top desktop-pet stage.
// Renders the settings-selected model: `.vrm` via `StageScene`/`View3D`
// (VRM path, unchanged), or a `.json`/`.skel`/`.atlas`/`.zip` bundle via
// `SpineStage`. Selection is by extension of the configured
// `settings/stage-model.modelId`; empty modelId keeps the bundled VRM
// default. Exposes lip-sync/gaze/expression hooks through
// `StageSceneController` on the VRM path.
//
// Flags mirror stage-qt's window (FramelessWindowHint + StaysOnTop + Tool).
// Empty-area drags move the window via `startSystemMove()` (DragHandler).
// Click-through: `Qt.WindowTransparentForInput` is compositor-dependent
// (works on X11, mostly ignored on Wayland), and per-pixel input masks are
// deliberately avoided — the stage stays a plain rectangle; use Settings →
// Stage to toggle it off completely.
//
// Geometry/visibility persist through `StageSettingsController`
// (`settings/stage-window` blob); the stage model selection lives in
// `settings/stage-model` and is polled once a second so model switches from
// the settings page apply live. The window hides instead of destroying
// itself (WindowManager re-raises it).
import QtQuick 2.15
import QtQuick.Window 2.15
import QtQuick3D
import com.airi.airiqt 1.0

Window {
    id: stageWindow
    title: I18n.tr("shell.stage.windowTitle")
    color: "transparent"
    width: 450
    height: 600
    visible: false
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Window | Qt.Tool
    modality: Qt.NonModal

    ShellApp {
        id: shell
    }

    StageSceneController {
        id: controller
    }

    StageSettingsController {
        id: stageSettings
    }

    // --- Scene selection ------------------------------------------------------
    // `.json`/`.skel`/`.atlas`/`.zip` route to the spine renderer; anything
    // else (including `.vrm` and the empty bundled default) stays on VRM.
    property string stageModelId: ""

    function isSpineModelPath(path) {
        var lower = String(path).trim().toLowerCase()
        var dot = lower.lastIndexOf(".")
        if (dot < 0)
            return false
        var ext = lower.substring(dot)
        return ext === ".json" || ext === ".skel" || ext === ".atlas" || ext === ".zip"
    }

    readonly property bool spineMode: isSpineModelPath(stageModelId)

    function applyModelSelection() {
        if (spineMode)
            spineStage.loadModel(stageModelId)
        else
            controller.loadFromSettings()
    }

    // --- Scene -------------------------------------------------------------
    View3D {
        id: view3d
        anchors.fill: parent
        renderMode: View3D.Offscreen
        visible: !stageWindow.spineMode

        StageScene {
            id: scene
        }
    }

    SpineStage {
        id: spineStage
        anchors.fill: parent
        visible: stageWindow.spineMode
    }

    // --- Bounds persistence ---------------------------------------------------
    property bool boundsRestored: false

    function restoreBounds() {
        var b = {}
        try {
            b = JSON.parse(stageSettings.loadBounds())
        } catch (e) {
            console.log("[airi-qt] stage: bounds parse failed:", e)
        }
        if (typeof b.width === "number" && isFinite(b.width) && b.width >= 200)
            stageWindow.width = b.width
        if (typeof b.height === "number" && isFinite(b.height) && b.height >= 200)
            stageWindow.height = b.height
        if (typeof b.x === "number" && typeof b.y === "number" && isFinite(b.x) && isFinite(b.y)) {
            stageWindow.x = b.x
            stageWindow.y = b.y
        }
        if (typeof b.visible === "boolean")
            stageWindow.visible = b.visible
        else
            stageWindow.visible = true
        stageWindow.boundsRestored = true
    }

    function persistBounds() {
        var payload = JSON.stringify({
            x: stageWindow.x,
            y: stageWindow.y,
            width: Math.round(stageWindow.width),
            height: Math.round(stageWindow.height),
            visible: stageWindow.visible
        })
        stageSettings.saveBounds(payload)
    }

    // Debounce drags/resizes; save shortly after they settle.
    Timer {
        id: boundsSaveTimer
        interval: 400
        repeat: false
        onTriggered: persistBounds()
    }
    function saveBoundsDebounced() {
        if (stageWindow.boundsRestored)
            boundsSaveTimer.restart()
    }
    onXChanged: saveBoundsDebounced()
    onYChanged: saveBoundsDebounced()
    onWidthChanged: saveBoundsDebounced()
    onHeightChanged: saveBoundsDebounced()
    onVisibleChanged: {
        if (!stageWindow.boundsRestored)
            return
        boundsSaveTimer.stop()
        persistBounds()
        stageSettings.saveWindowVisible(stageWindow.visible)
    }

    // --- Rendering loop -------------------------------------------------------
    // Interleaved vertex buffers are rewritten by `skinAndMorph` every tick;
    // shells get the updated bytes through `updateVertexData`.
    property var modelObjects: []

    function rebuildModels() {
        for (var i = modelObjects.length - 1; i >= 0; i--) {
            var entry = modelObjects[i]
            if (entry.model)
                entry.model.destroy()
            if (entry.shell)
                entry.shell.destroy()
            if (entry.material)
                entry.material.destroy()
        }
        modelObjects = []
        if (!controller.ready) {
            console.log("[airi-qt] stage: no model (%1)".arg(controller.status))
            return
        }
        var geomComp = Qt.createComponent("com.airi.airiqt", "AiriVrmGeometryShell")
        var modelComp = Qt.createComponent("QtQuick3D", "Model")
        var matComp = Qt.createComponent("com.airi.airiqt", "VrmMtoonMaterial")
        if (geomComp.status !== Component.Ready || modelComp.status !== Component.Ready || matComp.status !== Component.Ready) {
            console.log("[airi-qt] stage: component creation failed:", geomComp.errorString(), modelComp.errorString(), matComp.errorString())
            return
        }
        var created = []
        for (var prim = 0; prim < controller.primitiveCount; prim++) {
            var shell = geomComp.createObject(null)
            shell.setBuffers(controller.vertexData(prim), controller.indexData(prim), controller.vertexStride())
            var matIdx = controller.primitiveMaterial(prim)
            var useMap = matIdx >= 0 && controller.hasMaterialTexture(matIdx)
            var material = matComp.createObject(null, {
                uBaseColor: matIdx >= 0 ? controller.materialBaseColor(matIdx) : "#ffffff",
                uShadeColor: matIdx >= 0 ? controller.materialShadeColor(matIdx) : "#b4b4b4",
                uUseMap: useMap ? 1.0 : 0.0,
                uBaseMapUrl: controller.materialTextureUrl(matIdx)
            })
            var model = modelComp.createObject(scene.modelRoot, {
                geometry: shell,
                materials: [material]
            })
            created.push({ index: prim, model: model, shell: shell, material: material })
            console.log("[airi-qt] stage: primitive %1 -> material %2 (%3 verts)"
                .arg(prim).arg(matIdx).arg(shell ? "ok" : "?"))
        }
        modelObjects = created
    }

    Timer {
        id: frameTimer
        interval: shell.isSmoke() ? 5 : 16
        running: true
        repeat: true
        onTriggered: {
            // skinAndMorph doubles as the smoke-tour tick counter (it
            // increments even with no VRM engine loaded), so it runs
            // unconditionally; the VRM scene is only repainted when ready.
            controller.skinAndMorph(16.0)
            if (!controller.ready)
                return
            for (var i = 0; i < modelObjects.length; i++)
                modelObjects[i].shell.updateVertexData(controller.vertexData(modelObjects[i].index))
        }
    }

    Connections {
        target: controller
        function onModelVersionChanged() {
            rebuildModels()
        }
    }

    // Poll the settings-persisted model selection once a second so model
    // switches from the settings page apply live (cheap: the bridge only
    // reloads when the stored id changed).
    Timer {
        id: settingsPollTimer
        interval: 1000
        running: true
        repeat: true
        onTriggered: {
            // Re-read the persisted model id; reload only when it changed.
            // Spine reloads go through SpineStage; VRM through the bridge.
            stageSettings.loadAll()
            var id = String(stageSettings.modelId).trim()
            if (id !== stageWindow.stageModelId) {
                stageWindow.stageModelId = id
                stageWindow.applyModelSelection()
            }
            var b = {}
            try {
                b = JSON.parse(stageSettings.loadBounds())
            } catch (e) {
                return
            }
            if (typeof b.visible === "boolean" && b.visible !== stageWindow.visible)
                stageWindow.visible = b.visible
        }
    }

    // --- Empty state -----------------------------------------------------------
    AEmptyState {
        anchors.centerIn: parent
        width: parent.width - 2 * Theme.spacingL
        visible: stageWindow.spineMode ? !spineStage.loaded : !controller.ready
        icon: "✦"
        title: I18n.tr("shell.stage.empty-title")
        subtitle: I18n.tr("shell.stage.empty-subtitle")

        AButton {
            text: I18n.tr("shell.stage.openSettings")
            onClicked: WindowManager.openSettings()
        }
    }

    // --- Status chip ------------------------------------------------------------
    Rectangle {
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        anchors.margins: 8
        height: 26
        radius: 13
        color: Qt.rgba(0, 0, 0, 0.55)
        z: 10
        implicitWidth: statusText.implicitWidth + 16

        Text {
            id: statusText
            anchors.centerIn: parent
            text: stageWindow.spineMode
                ? ("spine · model=" + stageWindow.stageModelId + (spineStage.loaded ? "" : " (load failed)"))
                : controller.status + (controller.ready ? " · model=" + controller.modelId : "")
            color: "#ffffff"
            font.pixelSize: 11
            elide: Text.ElideRight
            maximumLineCount: 1
        }
    }

    // --- Close button (top-right) ------------------------------------------------
    Rectangle {
        id: closeButton
        anchors.top: parent.top
        anchors.right: parent.right
        anchors.margins: 8
        width: 30
        height: 30
        radius: 15
        color: closeMouse.containsMouse ? Qt.rgba(0, 0, 0, 0.65) : Qt.rgba(0, 0, 0, 0.35)
        z: 10

        Text {
            anchors.centerIn: parent
            text: "✕"
            color: "#ffffff"
            font.pixelSize: 15
        }

        MouseArea {
            id: closeMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: stageWindow.visible = false
        }
    }

    Shortcut {
        sequences: [StandardKey.Cancel]
        onActivated: stageWindow.visible = false
    }

    // --- Gaze -------------------------------------------------------------------
    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.NoButton
        hoverEnabled: true
        onPositionChanged: function(mouse) {
            controller.lookAt(Qt.point(mouse.x, mouse.y))
        }
        onContainsMouseChanged: {
            if (!containsMouse)
                controller.clearLookAt()
        }
    }

    // --- Drag (empty area) ------------------------------------------------------
    DragHandler {
        id: dragHandler
        target: null
        acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchScreen

        onActiveChanged: {
            if (active)
                stageWindow.startSystemMove()
        }
    }

    Component.onCompleted: {
        restoreBounds()
        controller.setMonitorSize(Screen.width, Screen.height)
        stageSettings.loadAll()
        stageWindow.stageModelId = String(stageSettings.modelId).trim()
        applyModelSelection()
        // In smoke mode log a single deterministic line once the scene had
        // time to tick; `Main.rs` also asserts the tick counter.
        if (shell.isSmoke())
            smokeReportTimer.start()
    }

    Timer {
        id: smokeReportTimer
        interval: 1500
        repeat: false
        onTriggered: {
            if (stageWindow.spineMode)
                console.log("[airi-qt] stage: spine model=%1 loaded=%2"
                    .arg(stageWindow.stageModelId).arg(spineStage.loaded))
            else
                console.log("[airi-qt] stage: scene ticks ok, model=%1"
                    .arg(controller.ready ? controller.modelId : "none"))
        }
    }
}
