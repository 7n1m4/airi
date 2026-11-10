// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick 2.15
import QtQuick3D 1.15
import QtQuick.Window 2.15
import com.airi.stageqt 1.0

// Frameless translucent always-on-top desktop-pet window.
Window {
    id: root
    width: 300
    height: 450
    visible: true
    title: "AIRI — stage-qt"

    // Frameless, always on top, translucent background.
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Window | Qt.Tool
    color: "transparent"
    modality: Qt.NonModal

    // Rust controller.
    StageApp {
        id: stageApp
        onStatusChanged: console.log("[stage-qt] status:", status)
    }

    // Placeholder status chip (removed once the VRM scene is live).
    Rectangle {
        id: statusChip
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.margins: 8
        height: 28
        implicitWidth: statusText.implicitWidth + 16
        radius: 14
        color: Qt.rgba(0, 0, 0, 0.55)
        z: 10

        Text {
            id: statusText
            anchors.centerIn: parent
            text: stageApp.status + (stageApp.ready ? " • model ready" : "")
            color: "white"
            font.pixelSize: 12
        }
    }

    // 3D scene.
    View3D {
        id: view3d
        anchors.fill: parent
        importScene: null
        camera: null
        offscreenFormat: Screen.AlphaBuffer
        renderMode: View3D.Offscreen

        StageScene {}

        // Placeholder status in a Text3D overlay is unnecessary; the
        // status chip above already reflects StageApp state.
    }

    // Caption overlay (stage:caption).
    Caption {
        id: caption
        text: ""
        visible: text.length > 0
    }

    // Empty-area drag moves the OS window.
    DragHandler {
        id: dragHandler
        target: null
        acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchScreen

        onActiveChanged: {
            if (active) {
                root.startSystemMove();
            }
        }
    }

    Component.onCompleted: {
        stageApp.sceneReady();
    }
}
