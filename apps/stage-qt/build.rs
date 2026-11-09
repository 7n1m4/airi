// SPDX-License-Identifier: GPL-3.0-or-later

use cxx_qt_build::{CxxQtBuilder, QmlModule};

fn main() {
    // NOTE: Qt Quick 3D shaded CustomMaterials take GLSL *source* via
    // `__fragmentShaderCode` (revision 1544, Qt 6.8+), not pre-baked .qsb
    // files. The mtoon shader sources live in `qml/shaders/*.frag|*.vert`
    // and are inlined into `qml/VrmMtoonMaterial.qml` verbatim.
    CxxQtBuilder::new_qml_module(
        QmlModule::new("com.airi.stageqt")
            .qml_file("qml/Main.qml")
            .qml_file("qml/StageScene.qml")
            .qml_file("qml/Caption.qml")
            .qml_file("qml/VrmMtoonMaterial.qml"),
    )
    .qt_module("Gui")
    .qt_module("Qml")
    .qt_module("Quick")
    .qt_module("Quick3D")
    .qt_module("Network")
    .files(["src/cxxqt_object.rs"])
    .cpp_files(["src/cpp/stage_qt_bridge.cpp", "src/cpp/stage_qt_bridge.h"])
    .build();
}
