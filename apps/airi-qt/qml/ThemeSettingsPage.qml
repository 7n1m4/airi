// SPDX-License-Identifier: GPL-3.0-or-later
// Theme settings page: accent hue, chroma multiplier and dark mode.
// Live-applies to the Theme singleton and persists via the ThemeBridge
// (settings/theme blob). Keep layout
// RTL-agnostic.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    ThemeBridge {
        id: themeCtrl
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spacingL
        spacing: Theme.spacingM

        Text {
            text: I18n.tr("shell.settings.theme-page.title")
            font.family: Theme.fontTitle
            font.pixelSize: 22
            font.bold: true
            color: Theme.textPrimary
        }

        Text {
            Layout.fillWidth: true
            Layout.maximumWidth: 420
            wrapMode: Text.WordWrap
            text: I18n.tr("shell.settings.theme-page.description")
            font.family: Theme.fontBody
            font.pixelSize: 13
            color: Theme.textSecondary
        }

        ACard {
            Layout.fillWidth: true

            ColumnLayout {
                width: parent ? parent.width : implicitWidth
                spacing: Theme.spacingM

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.settings.theme-page.hue")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                    }

                    ABadge {
                        variant: "accent"
                        text: Math.round(hueSlider.value) + "°"
                    }
                }

                ASlider {
                    id: hueSlider
                    Layout.fillWidth: true
                    from: 0
                    to: 360
                    stepSize: 1
                    value: Theme.hue

                    onMoved: {
                        Theme.setHue(value)
                        themeCtrl.applyHue(value)
                    }
                }

                ASeparator {
                    Layout.fillWidth: true
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.settings.theme-page.chroma")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                    }

                    ABadge {
                        variant: "accent"
                        text: Number(chromaSlider.value).toFixed(2) + "×"
                    }
                }

                ASlider {
                    id: chromaSlider
                    Layout.fillWidth: true
                    from: 0
                    to: 2
                    stepSize: 0.05
                    value: Theme.chromaMultiplier

                    onMoved: {
                        Theme.setChromaMultiplier(value)
                        themeCtrl.applyChroma(value)
                    }
                }

                ASeparator {
                    Layout.fillWidth: true
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.settings.theme-page.dark")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                    }

                    ASwitch {
                        id: darkSwitch
                        checked: Theme.dark

                        onToggled: {
                            Theme.setDark(checked)
                            themeCtrl.applyDark(checked)
                        }
                    }
                }
            }
        }

        AButton {
            variant: AButton.Ghost
            text: I18n.tr("shell.settings.theme-page.reset")

            onClicked: {
                hueSlider.value = 220.44
                chromaSlider.value = 1.0
                darkSwitch.checked = true
                Theme.setHue(220.44)
                Theme.setChromaMultiplier(1.0)
                Theme.setDark(true)
                themeCtrl.applyHue(220.44)
                themeCtrl.applyChroma(1.0)
                themeCtrl.applyDark(true)
            }
        }

        Item {
            Layout.fillHeight: true
        }
    }

    // Re-sync controls with the persisted Theme after possible startup pushes.
    Component.onCompleted: {
        hueSlider.value = Theme.hue
        chromaSlider.value = Theme.chromaMultiplier
        darkSwitch.checked = Theme.dark
    }
}
