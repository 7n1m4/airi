// SPDX-License-Identifier: GPL-3.0-or-later
// WindowManager singleton: lazy creation of the secondary windows
// (Chat / Settings / About / Stage) and the `--smoke` tour. Re-opening an
// existing window raises it instead of creating a duplicate.
//
// Window flags live on each window (frameless + stays-on-top for the Splash
// and the Control Strip; standard windows for Chat/Settings/About; the
// Stage window is frameless + always-on-top + translucent).
import QtQuick 2.15
import com.airi.airiqt 1.0

pragma Singleton

QtObject {
    id: root

    property Windows windowsBridge: Windows {}

    property var chatWindow: null
    property var settingsWindow: null
    property var aboutWindow: null
    property var stageWindow: null

    function openChat() {
        return openWindow("chatWindow", "shell/ChatWindow.qml", "chat")
    }

    function openSettings() {
        return openWindow("settingsWindow", "shell/SettingsWindow.qml", "settings")
    }

    function openAbout() {
        return openWindow("aboutWindow", "shell/AboutWindow.qml", "about")
    }

    function openStage() {
        return openWindow("stageWindow", "stage/StageWindow.qml", "stage")
    }
    // Toggle Chat: hide when visible, otherwise open/raise. Same handler the
    // Control Strip and the tray "Toggle Chat" item both use.
    function toggleChat() {
        var existing = root.chatWindow
        if (existing && existing.visible) {
            existing.visible = false
            return
        }
        openChat()
    }

    // Toggle Stage window visibility. Returns the new visibility. The
    // persisted stage-window.visible flag is the caller's job (MainShell
    // owns StageSettingsController), mirroring the strip button.
    function toggleStage() {
        var existing = root.stageWindow
        if (existing && existing.visible) {
            existing.visible = false
            return false
        }
        openStage()
        return true
    }

    // Recenter every managed window on the primary screen (current sizes
    // are kept). The Control Strip recenters itself in MainShell.
    function resetPositions() {
        var screens = Qt.application.screens
        var g = (screens && screens.length > 0) ? screens[0].availableGeometry : Qt.rect(0, 0, 1280, 720)
        var targets = [root.chatWindow, root.settingsWindow, root.aboutWindow, root.stageWindow]
        for (var i = 0; i < targets.length; i++) {
            var win = targets[i]
            if (!win)
                continue
            win.x = Math.round(g.x + (g.width - win.width) / 2)
            win.y = Math.round(g.y + (g.height - win.height) / 2)
        }
    }


    // Open every smoke-tour page; the bridge records visits only in smoke mode.
    function smokeTour() {
        openChat()
        openSettings()
        openAbout()
        openStage()
    }

    function quit() {
        Qt.quit()
    }

    function openWindow(prop, url, page) {
        var existing = root[prop]
        if (existing) {
            existing.visible = true
            existing.raise()
            existing.requestActivate()
            windowsBridge.visited(page)
            return existing
        }
        var component = Qt.createComponent(url)
        if (component.status !== Component.Ready) {
            console.log("[airi-qt] WindowManager: failed to create", url, "-", component.errorString())
            return null
        }
        var win = component.createObject(null)
        win.visible = true
        root[prop] = win
        windowsBridge.visited(page)
        return win
    }
}
