// SPDX-License-Identifier: GPL-3.0-or-later
// Gemini notice — presentational port of
// apps/stage-tamagotchi/src/renderer/pages/notice/gemini.vue. Upstream
// announces that the character is Gemini-powered and offers to open the
// provider settings when no Google Generative AI key is configured; it
// talks to the notice-window action bridge (windowAction / pageMounted /
// pageUnmounted) and the providers store. Neither exists in the Qt build,
// so the action buttons are visible but disabled and nothing is wired.
// The cosmic sidebar artwork ships as a stage-tamagotchi asset that isn't
// registered in the Qt resource pipeline yet — rendered as a placeholder.
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

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // Cosmic sidebar (38% in upstream) with the graphic placeholder and
        // the "Powered by Gemini" floating badge.
        Rectangle {
            Layout.fillHeight: true
            Layout.preferredWidth: Math.max(180, Math.min(320, page.width * 0.34))
            color: Theme.surface

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Theme.spacingL
                spacing: Theme.spacingM

                Item {
                    Layout.fillWidth: true
                    Layout.fillHeight: true

                    ColumnLayout {
                        anchors.centerIn: parent
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingM

                        Text {
                            Layout.alignment: Qt.AlignHCenter
                            text: "🌌"
                            font.pixelSize: 96
                        }

                        Text {
                            Layout.fillWidth: true
                            horizontalAlignment: Text.AlignHCenter
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.notice.gemini.graphicCaption")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }
                    }
                }

                // Floating badge at the bottom of the sidebar.
                Rectangle {
                    Layout.alignment: Qt.AlignHCenter
                    implicitWidth: badgeRow.implicitWidth + 2 * Theme.spacingM
                    implicitHeight: 30
                    radius: 15
                    color: Theme.surfaceHover
                    border.width: 1
                    border.color: Theme.border

                    RowLayout {
                        id: badgeRow
                        anchors.centerIn: parent
                        spacing: Theme.spacingS

                        Rectangle {
                            implicitWidth: 8
                            implicitHeight: 8
                            radius: 4
                            color: Theme.info
                        }

                        Text {
                            text: I18n.tr("shell.notice.gemini.poweredBy")
                            font.family: Theme.fontBody
                            font.pixelSize: 10
                            font.bold: true
                            color: Theme.textPrimary
                            font.capitalization: Font.AllUppercase
                        }
                    }
                }
            }
        }

        ASeparator {
            orientation: "vertical"
            Layout.fillHeight: true
        }

        // Content column.
        Flickable {
            id: flickable
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentWidth: width
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            contentHeight: column.y + column.implicitHeight + Theme.spacingL

            ColumnLayout {
                id: column
                x: Theme.spacingL
                y: Theme.spacingL
                width: flickable.width - 2 * Theme.spacingL
                spacing: Theme.spacingM

                // System header: thin accent line + uppercase status label.
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingM

                    Rectangle {
                        implicitWidth: 40
                        implicitHeight: 1
                        color: Theme.accent
                    }

                    Text {
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.notice.gemini.header")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        font.bold: true
                        color: Theme.accent
                        font.capitalization: Font.AllUppercase
                    }
                }

                Text {
                    Layout.fillWidth: true
                    Layout.maximumWidth: 560
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.notice.gemini.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 32
                    font.bold: true
                    color: Theme.textPrimary
                }

                Text {
                    Layout.fillWidth: true
                    Layout.maximumWidth: 560
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.notice.gemini.intro")
                    font.family: Theme.fontBody
                    font.pixelSize: 15
                    font.capitalization: Font.MixedCase
                    color: Theme.textSecondary
                }

                Item {
                    Layout.fillHeight: true
                    implicitHeight: Theme.spacingL
                }

                // Feature grid + actions strip.
                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingM

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingL

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: Theme.spacingS

                                RowLayout {
                                    spacing: Theme.spacingS

                                    Text {
                                        text: "👁️"
                                        font.pixelSize: 18
                                    }

                                    Text {
                                        text: I18n.tr("shell.notice.gemini.visionTitle")
                                        font.family: Theme.fontBody
                                        font.pixelSize: 15
                                        font.bold: true
                                        color: Theme.accent
                                    }
                                }

                                Text {
                                    Layout.fillWidth: true
                                    wrapMode: Text.WordWrap
                                    text: I18n.tr("shell.notice.gemini.visionDescription")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 13
                                    color: Theme.textSecondary
                                }
                            }

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: Theme.spacingS

                                RowLayout {
                                    spacing: Theme.spacingS

                                    Text {
                                        text: "🧠"
                                        font.pixelSize: 18
                                    }

                                    Text {
                                        text: I18n.tr("shell.notice.gemini.memoryTitle")
                                        font.family: Theme.fontBody
                                        font.pixelSize: 15
                                        font.bold: true
                                        color: Theme.info
                                    }
                                }

                                Text {
                                    Layout.fillWidth: true
                                    wrapMode: Text.WordWrap
                                    text: I18n.tr("shell.notice.gemini.memoryDescription")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 13
                                    color: Theme.textSecondary
                                }
                            }
                        }

                        ASeparator {
                            Layout.fillWidth: true
                        }

                        // Actions strip. Upstream labels the primary button
                        // "Add Gemini Key" or "Begin Session" depending on a
                        // providers-store key check; without a credential
                        // bridge we show the most conservative label, disabled.
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingM

                            DeferredAction {
                                variant: AButton.Accent
                                text: I18n.tr("shell.notice.gemini.addKey")
                                implicitWidth: 180
                            }

                            Item {
                                Layout.fillWidth: true
                            }

                            ASwitch {
                                id: dontShowAgainSwitch
                                enabled: false
                                checked: false
                            }

                            Text {
                                Layout.maximumWidth: 200
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.notice.gemini.dontShowAgain")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                color: Theme.textSecondary
                            }
                        }
                    }
                }

                Item {
                    Layout.fillHeight: true
                    implicitHeight: Theme.spacingL
                }
            }
        }
    }
}
