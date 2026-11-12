// SPDX-License-Identifier: GPL-3.0-or-later
// MMD settings page: idle loop toggle and render scale. Persists through the
// MmdSettingsController bridge (settings/mmd).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    MmdSettingsController {
        id: mmdCtl
    }

    property string saveError: ""

    function saveMmd() {
        var ok = mmdCtl.save(idleSwitch.checked, renderScaleSlider.value)
        page.saveError = ok ? "" : I18n.tr("shell.settings.mmd.saveError")
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
                text: I18n.tr("shell.settings.mmd.title")
                font.family: Theme.fontTitle
                font.pixelSize: 22
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 460
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.settings.mmd.description")
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
                            text: I18n.tr("shell.settings.mmd.idleAnimation")
                            font.family: Theme.fontBody
                            font.pixelSize: 14
                            color: Theme.textPrimary
                            wrapMode: Text.WordWrap
                        }

                        ASwitch {
                            id: idleSwitch
                            checked: mmdCtl.mmdIdleAnimationEnabled

                            onToggled: page.saveMmd()
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        Text {
                            Layout.fillWidth: true
                            text: I18n.tr("shell.settings.mmd.renderScale")
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
                        value: mmdCtl.mmdRenderScale

                        onMoved: page.saveMmd()
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.settings.mmd.physicsNote")
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

    Component.onCompleted: mmdCtl.load()
}
