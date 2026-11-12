// SPDX-License-Identifier: GPL-3.0-or-later
// Fade on Hover notice — presentational port of
// apps/stage-tamagotchi/src/renderer/pages/notice/fade-on-hover.vue.
// Upstream is a full-bleed video notice driven by the notice-window action
// bridge (windowAction / pageMounted / pageUnmounted) and the controls-island
// store. Neither exists in the Qt build, so the video is replaced by a static
// preview placeholder and every action stays visible but disabled.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    // Emitted by the deferred actions once the notice host lands.
    // Currently unused: all terminal buttons are disabled (see below).
    signal confirmRequested()
    signal closeRequested()

    // Disabled control + hover tooltip (the Live2D "deferred" idiom).
    component DeferredAction: Item {
        id: deferred

        property string text: ""
        property int variant: AButton.Default
        property string tip: I18n.tr("shell.notice.deferredTip")

        implicitWidth: button.implicitWidth
        implicitHeight: button.implicitHeight

        AButton {
            id: button
            anchors.fill: parent
            enabled: false
            text: deferred.text
            variant: deferred.variant
        }

        ATooltip {
            text: deferred.tip
            visible: hoverArea.containsMouse
            x: 0
            y: parent.height + Theme.spacingS
        }

        MouseArea {
            id: hoverArea
            anchors.fill: parent
            hoverEnabled: true
        }
    }

    Rectangle {
        anchors.fill: parent
        color: Theme.bg
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spacingL
        spacing: Theme.spacingM

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingM

            ABadge {
                variant: "info"
                text: I18n.tr("shell.notice.fadeOnHover.badge")
            }
        }

        // Headline panel (upstream keeps it over a blurred video backdrop).
        ACard {
            Layout.fillWidth: true
            Layout.maximumWidth: 480

            RowLayout {
                width: parent ? parent.width : implicitWidth
                spacing: Theme.spacingM

                Text {
                    text: "🫥"
                    font.pixelSize: 32
                }

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.notice.fadeOnHover.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 26
                    font.bold: true
                    color: Theme.textPrimary
                }
            }
        }

        // Tutorial preview placeholder — the upstream video assets
        // (tutorial-fade-on-hover.{dark,light}.mp4) are not bundled yet.
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 160
            radius: Theme.radiusL
            color: Theme.surfaceHover
            border.width: 1
            border.color: Theme.border

            ColumnLayout {
                anchors.centerIn: parent
                width: Math.min(parent ? parent.width - 2 * Theme.spacingL : 320, 420)
                spacing: Theme.spacingS

                Text {
                    Layout.alignment: Qt.AlignHCenter
                    text: "▶"
                    font.pixelSize: 48
                    color: Theme.textSecondary
                }

                Text {
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.notice.fadeOnHover.previewTitle")
                    font.family: Theme.fontBody
                    font.pixelSize: 14
                    font.bold: true
                    color: Theme.textPrimary
                }

                Text {
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.notice.fadeOnHover.previewNote")
                    font.family: Theme.fontBody
                    font.pixelSize: 12
                    color: Theme.textSecondary
                }
            }
        }

        // Description panel (upstream expands this on hover; hover-expand is
        // deferred together with the rest of the notice interactions).
        ACard {
            Layout.fillWidth: true

            ColumnLayout {
                width: parent ? parent.width : implicitWidth
                spacing: Theme.spacingS

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.notice.fadeOnHover.intro")
                    font.family: Theme.fontBody
                    font.pixelSize: 13
                    color: Theme.textPrimary
                }

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.notice.fadeOnHover.opacityLine")
                    font.family: Theme.fontBody
                    font.pixelSize: 13
                    color: Theme.textSecondary
                }

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.notice.fadeOnHover.toggleLine")
                    font.family: Theme.fontBody
                    font.pixelSize: 13
                    color: Theme.textSecondary
                }

                RowLayout {
                    Layout.fillWidth: true
                    Layout.topMargin: Theme.spacingS
                    spacing: Theme.spacingM

                    DeferredAction {
                        variant: AButton.Accent
                        text: I18n.tr("shell.notice.fadeOnHover.confirm")
                        implicitWidth: 140
                    }

                    Item {
                        Layout.fillWidth: true
                    }

                    ASwitch {
                        enabled: false
                        checked: false
                    }

                    Text {
                        text: I18n.tr("shell.notice.fadeOnHover.dontShowAgain")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.textSecondary
                        elide: Text.ElideRight
                    }
                }
            }
        }
    }
}
