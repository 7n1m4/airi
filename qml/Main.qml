// SPDX-License-Identifier: GPL-3.0-or-later
// Entry bootstrap. Owns the Splash (shown at startup) and the Control Strip
// (hidden until the Splash finishes). In `--smoke` mode the Splash milestones
// run fast and the smoke tour then opens the Chat/Settings/About windows.
//
// The bootstrap root must be visible: on Wayland/Hyprland sibling top-level
// windows cannot map while the root is hidden, so it stays a 1x1 transparent
// surface.
import QtQuick 2.15
import QtQuick.Window 2.15
import com.airi.airiqt 1.0

Window {
    id: root
    width: 1
    height: 1
    visible: true
    color: "transparent"
    title: "airi-qt"

    ThemeBridge {
        id: themeBridge
    }

    ShellApp {
        id: shell
        title: "AIRI"
        subtitle: "AI companion desktop shell"
        Component.onCompleted: shell.ready()
    }

    MainShell {
        id: strip
        visible: false
    }

    Splash {
        id: splash
        onFinished: {
            strip.visible = true
            strip.raise()
            strip.requestActivate()
            splash.close()
            if (shell.isSmoke())
                WindowManager.smokeTour()
        }
    }

    // GUI-thread gateway dispatch (wave ⑫). Opt-in via "allowActions": true in
    // <profile>/server-channel/config.json; off by default. See
    // docs/phase-notes/p12-lane-gui-thread-dispatch.md.
    GatewayPumpController {
        id: gatewayPump
    }

    Timer {
        interval: 50
        repeat: true
        running: true
        onTriggered: gatewayPump.pumpRequests()
    }

    // Route GUI verbs from the gateway to the same handlers the Control Strip uses.
    Connections {
        target: gatewayPump
        function onRequestWindowAction(id, method, payloadJson) {
            var ok = true
            var result = ({})
            try {
                var p = JSON.parse(payloadJson)
                if (method === "renderer.window.raise") {
                    var which = p.which
                    switch (which) {
                    case "chat":     WindowManager.openChat();     break
                    case "settings": WindowManager.openSettings(); break
                    case "about":    WindowManager.openAbout();    break
                    case "stage":    WindowManager.openStage();    break
                    default:         ok = false; result = { error: "unknown window: " + which }
                    }
                    if (ok)
                        result = { raised: which }   // open* raises if the window exists
                } else if (method === "renderer.stage.visibility") {
                    var visible
                    if (p.visible === true || p.visible === false) {
                        var stage = WindowManager.stageWindow
                        if (stage) {
                            stage.visible = p.visible
                            visible = p.visible
                        } else if (p.visible) {
                            WindowManager.openStage()   // no stage window yet → opening it *is* visible=true
                            visible = true
                        } else {
                            visible = false             // nothing to hide
                        }
                    } else {
                        visible = WindowManager.toggleStage()   // returns the new visibility
                    }
                    result = { visible: visible }
                } else {
                    ok = false
                    result = { error: "unknown gateway verb: " + method }
                }
            } catch (e) {
                ok = false
                result = { error: String(e) }
            }
            gatewayPump.completeWindowAction(id, ok, JSON.stringify(result))
        }
    }

    Component.onCompleted: {
        // Push persisted theme values into the QML Theme singleton before
        // the first frame is shown.
        Theme.hue = themeBridge.hue
        Theme.chromaMultiplier = themeBridge.chroma
        Theme.dark = themeBridge.dark
        console.log("[airi-qt] entry: theme applied (dark=%1, hue=%2)"
            .arg(Theme.dark).arg(Theme.hue))
    }
}
