// SPDX-License-Identifier: GPL-3.0-or-later
// The Control Strip: compact always-on-top pill (vertical by default) with
// icon buttons. Frameless; drag by the handle. Layout skeleton ported from
// packages/stage-ui ControlStrip.vue — popover contents are out of scope.
//
// Buttons: avatar, mic, chat, stage, captions (CC), settings, about, theme,
// language, collapse/expand, quit. Windows are opened through the
// WindowManager singleton; strings come from I18n; all colors/spacing from
// Theme. The stage/captions buttons are driven by the persisted
// settings/control-strip enabledButtons map (ids 'stage'/'caption').
import QtQuick 2.15
import QtQuick.Window 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Window {
    id: strip
    width: 56
    minimumWidth: 56
    maximumWidth: 56
    height: collapsed
        ? handleHeight + 2 * Theme.spacingS
        : contentColumn.implicitHeight + 2 * Theme.spacingS
    color: Theme.surface
    title: I18n.tr("shell.app.name")

    property bool collapsed: false
    property bool micOn: false
    property string lastChatStatus: "idle"
    property bool stageStripVisible: true
    property bool captionStripVisible: true
    readonly property int handleHeight: 22

    ShellApp {
        id: shell
    }

    Windows {
        id: windowsBridge
    }

    ThemeBridge {
        id: themeBridge
    }
    StageSettingsController {
        id: stageCtl
    }

    // Desktop integration: drains tray/hotkey actions and the mic-toggle
    // flag from the DesktopController bridge (33 ms pump, same pattern as
    // the providers bridge).
    DesktopController {
        id: desktopController
    }

    // Status watcher for reply-ready notifications. This instance only
    // tracks `status` transitions via pumpEvents(); the transcript lives
    // in the ChatWindow's own controller.
    ChatController {
        id: chatWatchController
    }

    AudioDeviceSettingsController {
        id: audioDeviceCtl
    }

    // Client for the opt-in airi-daemon awareness service (session bus).
    // Used by the tray "toggle-awareness" action to pause/resume all
    // observers; the Awareness settings page polls it once a second.
    DaemonController {
        id: daemonCtl
    }

    // Themed icon button used only inside the strip.
    component StripButton: Item {
        id: wrapper
        property string icon: "❓"
        property string tip: ""
        property bool active: false

        signal clicked()

        implicitWidth: 40
        implicitHeight: 34
        width: implicitWidth
        height: implicitHeight

        AButton {
            id: button
            anchors.fill: parent
            text: wrapper.icon
            variant: wrapper.active ? AButton.Accent : AButton.Ghost
            leftPadding: 0
            rightPadding: 0
            font.pixelSize: 17

            onClicked: wrapper.clicked()
        }

        ATooltip {
            text: wrapper.tip
            visible: button.hovered
        }
    }

    Rectangle {
        anchors.fill: parent
        anchors.margins: 2
        radius: Theme.radiusL
        color: Theme.surface
        border.width: 1
        border.color: Theme.border
    }

    Column {
        id: contentColumn
        anchors.horizontalCenter: parent.horizontalCenter
        y: Theme.spacingS
        width: parent.width - 2 * Theme.spacingS
        spacing: Theme.spacingS

        // Drag handle (vertical pill grip).
        Item {
            id: dragHandle
            width: parent.width
            height: strip.handleHeight

            Text {
                anchors.centerIn: parent
                text: "⠿"
                font.pixelSize: 16
                color: handleMouse.pressed ? Theme.accent : Theme.textSecondary
            }

            MouseArea {
                id: handleMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.SizeAllCursor
                onPressed: Window.window ? Window.window.startSystemMove() : {}
            }

            ATooltip {
                text: I18n.tr("shell.strip.tooltips.collapse")
                visible: handleMouse.containsMouse
            }
        }

        // Avatar placeholder chip.
        Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            width: 34
            height: 34
            radius: width / 2
            color: Theme.accent
            visible: !strip.collapsed

            Text {
                anchors.centerIn: parent
                text: "A"
                color: Theme.accentContrast
                font.family: Theme.fontTitle
                font.pixelSize: 16
                font.bold: true
            }
        }

        StripButton {
            id: micButton
            anchors.horizontalCenter: parent.horizontalCenter
            icon: strip.micOn ? "🎤" : "🎙️"
            tip: I18n.tr("shell.strip.tooltips.mic")
            active: strip.micOn
            visible: !strip.collapsed
            onClicked: strip.micOn = !strip.micOn
        }

        StripButton {
            id: chatButton
            anchors.horizontalCenter: parent.horizontalCenter
            icon: "💬"
            tip: I18n.tr("shell.strip.tooltips.chat")
            visible: !strip.collapsed
            onClicked: WindowManager.openChat()
        }

        StripButton {
            id: stageButton
            anchors.horizontalCenter: parent.horizontalCenter
            icon: "🎭"
            tip: I18n.tr("shell.strip.tooltips.stage")
            active: stageCtl.stageVisible
            visible: !strip.collapsed && strip.stageStripVisible
            onClicked: strip.toggleStageStrip()
        }


        StripButton {
            id: captionsButton
            anchors.horizontalCenter: parent.horizontalCenter
            icon: "CC"
            tip: I18n.tr("shell.strip.tooltips.caption")
            active: stageCtl.captionsEnabled
            visible: !strip.collapsed && strip.captionStripVisible
            onClicked: {
                let next = !stageCtl.captionsEnabled
                stageCtl.saveCaptions(next, stageCtl.captionsFontSize, stageCtl.captionsOpacity, stageCtl.captionsDocking)
            }
        }

        StripButton {
            id: settingsButton
            anchors.horizontalCenter: parent.horizontalCenter
            icon: "⚙️"
            tip: I18n.tr("shell.strip.tooltips.settings")
            visible: !strip.collapsed
            onClicked: WindowManager.openSettings()
        }

        StripButton {
            id: aboutButton
            anchors.horizontalCenter: parent.horizontalCenter
            icon: "ℹ️"
            tip: I18n.tr("shell.strip.tooltips.about")
            visible: !strip.collapsed
            onClicked: WindowManager.openAbout()
        }

        StripButton {
            id: themeButton
            anchors.horizontalCenter: parent.horizontalCenter
            icon: Theme.dark ? "☀️" : "🌙"
            tip: I18n.tr("shell.strip.tooltips.theme")
            visible: !strip.collapsed
            onClicked: {
                var d = !Theme.dark
                Theme.setDark(d)
                themeBridge.applyDark(d)
            }
        }

        StripButton {
            id: languageButton
            anchors.horizontalCenter: parent.horizontalCenter
            icon: "🌐"
            tip: I18n.tr("shell.strip.tooltips.language")
            visible: !strip.collapsed
            onClicked: I18n.cycleLocale()
        }

        StripButton {
            id: collapseButton
            anchors.horizontalCenter: parent.horizontalCenter
            icon: strip.collapsed ? "⟩" : "⟨"
            tip: I18n.tr(strip.collapsed ? "shell.strip.tooltips.expand" : "shell.strip.tooltips.collapse")
            onClicked: strip.collapsed = !strip.collapsed
        }

        StripButton {
            id: quitButton
            anchors.horizontalCenter: parent.horizontalCenter
            icon: "⏻"
            tip: I18n.tr("shell.strip.tooltips.quit")
            visible: !strip.collapsed
            onClicked: WindowManager.quit()
        }
    }

    // Extract of the strip stage button handler so the tray "Toggle Stage"
    // action runs the exact same code path (persist + open/hide).
    function toggleStageStrip() {
        let next = !stageCtl.stageVisible
        stageCtl.saveWindowVisible(next)
        if (next) {
            if (typeof WindowManager.openStage === "function") {
                WindowManager.openStage()
            } else {
                console.log("[airi-qt] shell: WindowManager.openStage() not available yet (pre-merge); persisted stage-window.visible =", next)
            }
        } else {
            let stageWindow = WindowManager.stageWindow
            if (stageWindow) {
                stageWindow.visible = false
            } else {
                console.log("[airi-qt] shell: WindowManager.stageWindow not available yet (pre-merge); persisted stage-window.visible =", next)
            }
        }
    }

    // Global mic-toggle hotkey handler: flip settings/audio-device.inputEnabled
    // and persist. Re-read the store first so toggles from other windows count.
    function toggleMic() {
        audioDeviceCtl.reloadFromStore()
        const next = !audioDeviceCtl.inputEnabled
        const ok = audioDeviceCtl.save(audioDeviceCtl.selectedInputDevice, audioDeviceCtl.selectedOutputDevice, next)
        console.log("[airi-qt] hotkey: mic toggle -> inputEnabled =", next, ok ? "(persisted)" : "(persist FAILED)")
        if (ok)
            strip.micOn = next
    }

    // Recenter the strip and every managed window on the primary screen.
    function resetPositions() {
        var screens = Qt.application.screens
        var g = (screens && screens.length > 0) ? screens[0].availableGeometry : Qt.rect(0, 0, 1280, 720)
        strip.x = Math.round(g.x + (g.width - strip.width) / 2)
        strip.y = Math.round(g.y + (g.height - strip.height) / 2)
        WindowManager.resetPositions()
        console.log("[airi-qt] desktop: window positions reset", JSON.stringify({ x: g.x, y: g.y, width: g.width, height: g.height }))
    }

    // Route one desktop action (tray menu or DesktopController invokable) to
    // the same handlers the Control Strip uses.
    function dispatchDesktopAction(code) {
        switch (code) {
        case "toggle-chat":
            WindowManager.toggleChat()
            break
        case "toggle-stage":
            strip.toggleStageStrip()
            break
        case "toggle-awareness":
            daemonCtl.togglePause()
            break
        case "reset-positions":
            strip.resetPositions()
            break
        case "open-settings":
            WindowManager.openSettings()
            break
        case "open-about":
            WindowManager.openAbout()
            break
        case "quit":
            WindowManager.quit()
            break
        default:
            console.log("[airi-qt] desktop: unknown action", code)
        }
    }

    // Desktop integration pump (33 ms): drain tray/hotkey actions and the
    // mic-toggle flag from the DesktopController bridge, then watch the chat
    // status for reply-finished transitions (chat window hidden -> notify).
    Timer {
        interval: 33
        repeat: true
        running: true
        onTriggered: {
            if (desktopController.consumeMicToggle())
                strip.toggleMic()
            var code = desktopController.pollDesktopAction()
            while (code.length > 0) {
                strip.dispatchDesktopAction(code)
                code = desktopController.pollDesktopAction()
            }
            chatWatchController.pumpEvents()
            var chatStatus = chatWatchController.status
            if ((strip.lastChatStatus === "streaming" || strip.lastChatStatus === "waiting-on-tool")
                    && chatStatus === "idle") {
                var chatWin = WindowManager.chatWindow
                if ((!chatWin || !chatWin.visible) && !shell.isSmoke())
                    desktopController.notify(I18n.tr("shell.app.name"), I18n.tr("shell.notify.replyReady"))
            }
            strip.lastChatStatus = chatStatus
        }
    }

    Component.onCompleted: {
        stageCtl.loadAll()
        strip.stageStripVisible = stageCtl.stripButtonEnabled("stage")
        strip.captionStripVisible = stageCtl.stripButtonEnabled("caption")
    }

    onVisibleChanged: {
        if (visible)
            windowsBridge.visited("control-strip")
    }
}
