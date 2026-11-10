// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick 2.15
import QtQuick3D 1.15
import QtQuick3D.Helpers 1.15

// Stage scene: View3D + camera + lights + a placeholder cube for step 1.
// VRM models are added by StageApp (Rust) as `Model` nodes bound to
// `VrmGeometry` instances in later steps.
Node {
    id: sceneRoot

    PerspectiveCamera {
        id: cam
        position: Qt.vector3d(0, 100, 400)
        lookAt: Qt.vector3d(0, 80, 0)
    }

    DirectionalLight {
        position: Qt.vector3d(100, 200, 100)
        brightness: 1.0
    }

    Model {
        id: placeholderCube
        source: "#Cube"
        scale: Qt.vector3d(100, 100, 100)
        position: Qt.vector3d(0, 100, 0)
        materials: [
            PrincipledMaterial {
                baseColor: "coral"
                roughness: 0.6
            }
        ]
    }

    // (Later: VRM root Node + skin joint tree instantiated from Rust.)
}
