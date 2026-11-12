// SPDX-License-Identifier: GPL-3.0-or-later
// Live2D settings page: one card per persisted behavior plus a deferred-
// renderer notice. The Live2dSettings section is independent of the Spine
// pipeline, so edits are saved and take effect once the Live2D renderer
// ships. Persists through the Live2dSettingsController bridge (settings/live2d).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    Live2dSettingsController {
        id: live2dCtl
    }

    // Select offers 0/30/60/120 by default; an off-list persisted value is
    // appended so the control never misrepresents the stored setting.
    readonly property var fpsValues: [0, 30, 60, 120]

    function fpsModel() {
        var values = page.fpsValues.slice()
        if (values.indexOf(live2dCtl.live2dMaxFps) < 0) {
            values.push(live2dCtl.live2dMaxFps)
            values.sort(function (a, b) { return a - b })
        }
        return values
    }

    property string saveError: ""

    function saveLive2d() {
        var model = fpsModel()
        var maxFps = model[Math.max(0, maxFpsSelect.currentIndex)]
        var ok = live2dCtl.save(disableFocusSwitch.checked, followSpeedSlider.value,
                                idleSwitch.checked, autoBlinkSwitch.checked,
                                forceAutoBlinkSwitch.checked, shadowSwitch.checked, maxFps)
        page.saveError = ok ? "" : I18n.tr("shell.settings.live2d.saveError")
    }

    Flickable {
        id: flickable
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.y + column.implicitHeight + Theme.spacingL
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        ColumnLayout {
            id: column
            x: Theme.spacingL
            y: Theme.spacingL
            width: flickable.width - 2 * Theme.spacingL
            spacing: Theme.spacingM

            Text {
                text: I18n.tr("shell.settings.live2d.title")
                font.family: Theme.fontTitle
                font.pixelSize: 22
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 460
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.settings.live2d.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // --- Deferred renderer notice ----------------------------------
            ACard {
                Layout.fillWidth: true
                borderColor: Theme.warning

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: "⚠"
                        font.pixelSize: 20
                        color: Theme.warning
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.settings.live2d.deferredNotice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // --- Disable focus ----------------------------------------------
            ACard {
                Layout.fillWidth: true

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.settings.live2d.disableFocus")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                        wrapMode: Text.WordWrap
                    }

                    ASwitch {
                        id: disableFocusSwitch
                        checked: live2dCtl.live2dDisableFocus

                        onToggled: page.saveLive2d()
                    }
                }
            }

            // --- Idle animation ----------------------------------------------
            ACard {
                Layout.fillWidth: true

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.settings.live2d.idleAnimation")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                        wrapMode: Text.WordWrap
                    }

                    ASwitch {
                        id: idleSwitch
                        checked: live2dCtl.live2dIdleAnimationEnabled

                        onToggled: page.saveLive2d()
                    }
                }
            }

            // --- Auto blink ---------------------------------------------------
            ACard {
                Layout.fillWidth: true

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.settings.live2d.autoBlink")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                        wrapMode: Text.WordWrap
                    }

                    ASwitch {
                        id: autoBlinkSwitch
                        checked: live2dCtl.live2dAutoBlinkEnabled

                        onToggled: page.saveLive2d()
                    }
                }
            }

            // --- Force auto blink ---------------------------------------------
            ACard {
                Layout.fillWidth: true

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.settings.live2d.forceAutoBlink")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                        wrapMode: Text.WordWrap
                    }

                    ASwitch {
                        id: forceAutoBlinkSwitch
                        checked: live2dCtl.live2dForceAutoBlinkEnabled

                        onToggled: page.saveLive2d()
                    }
                }
            }

            // --- Shadow --------------------------------------------------------
            ACard {
                Layout.fillWidth: true

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.settings.live2d.shadow")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                        wrapMode: Text.WordWrap
                    }

                    ASwitch {
                        id: shadowSwitch
                        checked: live2dCtl.live2dShadowEnabled

                        onToggled: page.saveLive2d()
                    }
                }
            }

            // --- Follow speed -------------------------------------------------
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.settings.live2d.followSpeed")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ABadge {
                            variant: "accent"
                            text: Number(followSpeedSlider.value).toFixed(2)
                        }
                    }

                    ASlider {
                        id: followSpeedSlider
                        Layout.fillWidth: true
                        from: 0.0
                        to: 1.0
                        stepSize: 0.05
                        value: live2dCtl.live2dFollowSpeed

                        onMoved: page.saveLive2d()
                    }
                }
            }

            // --- Max FPS -------------------------------------------------------
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.settings.live2d.maxFps")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ASelect {
                            id: maxFpsSelect
                            implicitWidth: 120
                            model: page.fpsModel()
                            currentIndex: Math.max(0, model.indexOf(live2dCtl.live2dMaxFps))

                            onActivated: page.saveLive2d()
                        }
                    }

                    Text {
                        text: I18n.tr("shell.settings.live2d.maxFpsHint")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        color: Theme.textSecondary
                    }
                }
            }

            Text {
                Layout.fillWidth: true
                visible: page.saveError.length > 0
                text: page.saveError
                font.family: Theme.fontBody
                font.pixelSize: 12
                wrapMode: Text.WordWrap
                color: Theme.error
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }

    Component.onCompleted: live2dCtl.load()
}
