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
