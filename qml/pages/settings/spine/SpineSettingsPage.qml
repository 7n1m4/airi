// SPDX-License-Identifier: GPL-3.0-or-later
// Spine settings page: renderer knobs (max FPS, render scale, mix duration,
// animation speed, idle loop) plus model placement on the stage. Persists
// through the SpineSettingsController bridge (settings/spine).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    SpineSettingsController {
        id: spineCtl
    }

    // Select offers 0/30/60/120 by default; an off-list persisted value is
    // appended so the control never misrepresents the stored setting.
    readonly property var fpsValues: [0, 30, 60, 120]

    function fpsModel() {
        var values = page.fpsValues.slice()
        if (values.indexOf(spineCtl.maxFps) < 0) {
            values.push(spineCtl.maxFps)
            values.sort(function (a, b) { return a - b })
        }
        return values
    }

    property string saveError: ""

    function saveSpine() {
        var model = fpsModel()
        var maxFps = model[Math.max(0, maxFpsSelect.currentIndex)]
        var ok = spineCtl.save(maxFps, renderScaleSlider.value, mixDurationSlider.value,
                               animationSpeedSlider.value, idleSwitch.checked,
                               posXSpin.value, posYSpin.value, posScaleSpin.value)
        page.saveError = ok ? "" : I18n.tr("shell.settings.spine.saveError")
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
                text: I18n.tr("shell.settings.spine.title")
                font.family: Theme.fontTitle
                font.pixelSize: 22
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 460
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.settings.spine.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // --- Renderer -------------------------------------------------
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.settings.spine.maxFps")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ASelect {
                            id: maxFpsSelect
                            implicitWidth: 120
                            model: page.fpsModel()
                            currentIndex: Math.max(0, model.indexOf(spineCtl.maxFps))

                            onActivated: page.saveSpine()
                        }
                    }

                    Text {
                        text: I18n.tr("shell.settings.spine.maxFpsHint")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        color: Theme.textSecondary
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.settings.spine.renderScale")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ABadge {
                            variant: "accent"
                            text: Number(renderScaleSlider.value).toFixed(2) + "×"
                        }
                    }

                    ASlider {
                        id: renderScaleSlider
                        Layout.fillWidth: true
                        from: 0.5
                        to: 2.0
                        stepSize: 0.25
                        value: spineCtl.renderScale

                        onMoved: page.saveSpine()
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.settings.spine.mixDuration")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ABadge {
                            variant: "accent"
                            text: Number(mixDurationSlider.value).toFixed(2) + " s"
                        }
                    }

                    ASlider {
                        id: mixDurationSlider
                        Layout.fillWidth: true
                        from: 0.1
                        to: 0.6
                        stepSize: 0.05
                        value: spineCtl.mixDuration

                        onMoved: page.saveSpine()
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.settings.spine.animationSpeed")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                        }

                        ABadge {
                            variant: "accent"
                            text: Number(animationSpeedSlider.value).toFixed(2) + "×"
                        }
                    }

                    ASlider {
                        id: animationSpeedSlider
                        Layout.fillWidth: true
                        from: 0.2
                        to: 2.0
                        stepSize: 0.1
                        value: spineCtl.animationSpeed

                        onMoved: page.saveSpine()
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.settings.spine.idleAnimation")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASwitch {
                            id: idleSwitch
                            checked: spineCtl.idleAnimationEnabled

                            onToggled: page.saveSpine()
                        }
                    }
                }
            }

            // --- Model placement -------------------------------------------
            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.settings.spine.scalePosTitle")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        ColumnLayout {
                            spacing: Theme.spacingS

                            Text {
                                text: I18n.tr("shell.settings.spine.scalePosX")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            AInputNumber {
                                id: posXSpin
                                from: -2000
                                to: 2000
                                stepSize: 1
                                value: spineCtl.scalePosX

                                onValueModified: page.saveSpine()
                            }
                        }

                        ColumnLayout {
                            spacing: Theme.spacingS

                            Text {
                                text: I18n.tr("shell.settings.spine.scalePosY")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            AInputNumber {
                                id: posYSpin
                                from: -2000
                                to: 2000
                                stepSize: 1
                                value: spineCtl.scalePosY

                                onValueModified: page.saveSpine()
                            }
                        }

                        ColumnLayout {
                            spacing: Theme.spacingS

                            Text {
                                text: I18n.tr("shell.settings.spine.scalePosScale")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            AInputNumber {
                                id: posScaleSpin
                                from: 0.1
                                to: 4.0
                                stepSize: 0.05
                                decimals: 2
                                value: spineCtl.scalePosScale

                                onValueModified: page.saveSpine()
                            }
                        }
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

    Component.onCompleted: spineCtl.load()
}
