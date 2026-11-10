// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick 2.15
import QtQuick3D

// Stage scene: View3D content — camera + lights + the model root node.
// Per-primitive `Model`s (with `AiriVrmGeometryShell` geometries and
// `VrmMtoonMaterial` materials) are created dynamically by the stage window
// (qml/stage/StageWindow.qml) into `modelRoot`.
//
// Units are meters (VRM); a ~1.6 m avatar stands at the origin.
Node {
    id: sceneRoot

    property alias modelRoot: modelRoot

    PerspectiveCamera {
        id: cam
        position: Qt.vector3d(0, 1.3, 2.2)
        fieldOfView: 42
        clipNear: 0.05
        clipFar: 20.0
        Component.onCompleted: cam.lookAt(Qt.vector3d(0, 0.9, 0))
    }

    // Key light: cool white from the front-top-right.
    DirectionalLight {
        position: Qt.vector3d(1.5, 2.5, 2.0)
        brightness: 2.4
        color: "#ffffff"
        ambientColor: Qt.rgba(0.18, 0.18, 0.2, 1.0)
    }
    // Fill light: softer from the left.
    DirectionalLight {
        position: Qt.vector3d(-1.5, 1.2, 1.5)
        brightness: 0.8
        color: "#dfe8ff"
        ambientColor: Qt.rgba(0.08, 0.08, 0.1, 1.0)
    }
    // Rim light: warm backlight for silhouette separation.
    DirectionalLight {
        position: Qt.vector3d(0.0, 1.8, -2.2)
        brightness: 1.1
        color: "#ffe9d8"
        ambientColor: Qt.rgba(0.05, 0.05, 0.05, 1.0)
    }

    // VRM 0.x models face -Z in this pipeline; rotate 180° so the stage
    // camera (at +Z) sees the face.
    Node {
        id: modelRoot
        eulerRotation: Qt.vector3d(0, 180, 0)
    }
}
