// SPDX-License-Identifier: GPL-3.0-or-later
//
// Spine stage: embeds the native spine scene-graph item and drives it
// through the SpineController bridge (idle loop, emotions, poke gesture).
// A demo animation ("idle") plays automatically after loadModel.
//
// Consumers (stage window, P3 lane) are expected to host this component,
// e.g.:
//   SpineStage { anchors.fill: parent }
// The smoke tour wires a hidden instance to exercise the load path headlessly.

import QtQuick 2.15
import com.airi.airiqt 1.0

Item {
    id: root

    /// Path to a spine `.zip` bundle (or a loose directory with entries).
    property string modelPath: ""
    /// User-facing render resolution multiplier (1.0 = native).
    property double renderScale: 1.0
    /// 0 = unthrottled; otherwise frames per second cap.
    property int maxFps: 0
    /// Horizontal pixel offset applied on top of the centered fit.
    property double offsetX: 0.0
    /// Vertical pixel offset applied on top of the centered fit.
    property double offsetY: 0.0

    /// True after a successful loadModel().
    readonly property bool loaded: controller.loaded
    /// True while the idle track is looping.
    readonly property bool playing: controller.playing

    /// Load the bundle and start the idle animation.
    function loadModel(path) {
        modelPath = path;
        const ok = controller.loadModel(path);
        if (ok)
            item.invalidateTextures();
        return ok;
    }

    /// Play an animation; with loop=true it replaces the idle loop on track 0,
    /// otherwise it layers a one-shot on the emotion track (track 1).
    function play(name, loop = true) {
        return controller.play(name, loop);
    }

    /// Trigger the first available `hit_*` animation as a one-shot.
    function poke() {
        return controller.poke();
    }

    SpineController {
        id: controller
        maxFps: root.maxFps
        renderScale: root.renderScale
    }

    // The scene-graph renderer. Constructed eagerly so the smoke tour can
    // exercise the load path without any extra wiring.
    SpineItem {
        id: item
        anchors.fill: parent
        maxFps: controller.maxFps
        renderScale: controller.renderScale
        offsetX: root.offsetX
        offsetY: root.offsetY
    }
}
