// SPDX-License-Identifier: GPL-3.0-or-later
// Onboarding (V3) wizard host — presentational port of
// apps/stage-tamagotchi/src/renderer/pages/onboarding-v3.vue plus the
// static StepWelcome hero it renders. The upstream page wraps the
// OnboardingV3 sliding-stepper wizard (useOnboardingStore + draft store);
// no Qt bridge exists for the first-run store yet, so this page renders a
// static welcome screen. All wizard actions stay visible but disabled.
// Not wired to real first-run state.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    // Emitted by the deferred actions once first-run wiring lands.
    // Currently unused: all terminal buttons are disabled (see below).
    signal closeRequested()
    signal finishRequested()
    signal skipRequested()
    signal quickStartRequested()
    signal guidedSetupRequested()

    // Static V3 step rail: the 18 steps from ONBOARDING_V3_STEPS.
    readonly property int stepCount: 18

    // Disabled control + hover tooltip (the Live2D "deferred" idiom).
    component DeferredAction: Item {
        id: deferred

        property string text: ""
        property int variant: AButton.Default
        property string tip: I18n.tr("shell.onboarding.deferredTip")

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

    // Small status pill (emoji + label), same idea as the V3 feature chips.
    component FeaturePill: Rectangle {
        id: pill

        property string icon: ""
        property string label: ""

        implicitWidth: pillRow.implicitWidth + 2 * Theme.spacingL
        implicitHeight: 42
        radius: implicitHeight / 2
        color: Theme.surfaceHover
        border.width: 1
        border.color: Theme.border

        RowLayout {
            id: pillRow
            anchors.centerIn: parent
            spacing: Theme.spacingS

            Text {
                text: pill.icon
                font.pixelSize: 15
            }

            Text {
                text: pill.label
                font.family: Theme.fontBody
                font.pixelSize: 13
                font.bold: true
                color: Theme.textPrimary
                elide: Text.ElideRight
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // Edgeless header bar: brand, stepper dots, status + close.
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 56
            color: Theme.surface

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: Theme.spacingM
                anchors.rightMargin: Theme.spacingM
                spacing: Theme.spacingM

                Text {
                    text: "🛡️"
                    font.pixelSize: 15
                }

                Text {
                    text: I18n.tr("shell.onboarding.v3.brand")
                    font.family: Theme.fontBody
                    font.pixelSize: 12
                    font.bold: true
                    color: Theme.accent
                    elide: Text.ElideRight
                    Layout.maximumWidth: 220
                }

                Item {
                    Layout.fillWidth: true
                }

                // Sliding stepper renders all 18 V3 steps as static dots; the
                // welcome step is active. Not interactive (no draft store).
                RowLayout {
                    spacing: Theme.spacingS

                    Repeater {
                        model: page.stepCount

                        delegate: Rectangle {
                            required property int index

                            width: index === 0 ? 22 : 8
                            height: 8
                            radius: 4
                            color: index === 0 ? Theme.accent : Theme.surfacePressed
                        }
                    }
                }

                Item {
                    Layout.fillWidth: true
                }

                ABadge {
                    variant: "success"
                    text: I18n.tr("shell.onboarding.v3.stageReady")
                }

                DeferredAction {
                    variant: AButton.Ghost
                    text: "✕"
                    implicitWidth: 36
                    tip: I18n.tr("shell.onboarding.deferredTip")
                }
            }
        }

        ASeparator {
            Layout.fillWidth: true
        }

        // Main workspace: static welcome hero (the only V3 step that exists
        // as static content; the remaining 17 steps need the draft store).
        Flickable {
            id: flickable
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentWidth: width
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            contentHeight: center.height + 2 * Theme.spacingL

            Item {
                id: center
                anchors.horizontalCenter: parent.horizontalCenter
                width: Math.min(flickable.width - 2 * Theme.spacingL, 720)
                height: hero.implicitHeight
                y: Math.max(Theme.spacingL, (flickable.height - height) / 2)

                ColumnLayout {
                    id: hero
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.verticalCenter: parent.verticalCenter
                    width: parent.width
                    spacing: Theme.spacingM

                    // Brand tile.
                    Rectangle {
                        Layout.alignment: Qt.AlignHCenter
                        implicitWidth: 104
                        implicitHeight: 104
                        radius: 26
                        color: Theme.surfaceHover
                        border.width: 1
                        border.color: Theme.border

                        Text {
                            anchors.centerIn: parent
                            text: "🪄"
                            font.pixelSize: 48
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        Layout.topMargin: Theme.spacingS
                        text: I18n.tr("shell.onboarding.v3.heroTitle")
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.WordWrap
                        font.family: Theme.fontTitle
                        font.pixelSize: 36
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    Text {
                        Layout.fillWidth: true
                        Layout.maximumWidth: 560
                        Layout.alignment: Qt.AlignHCenter
                        text: I18n.tr("shell.onboarding.v3.heroSubtitle")
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.WordWrap
                        font.family: Theme.fontBody
                        font.pixelSize: 17
                        color: Theme.textSecondary
                    }

                    // Companion greeting card.
                    ACard {
                        Layout.fillWidth: true
                        Layout.topMargin: Theme.spacingS

                        RowLayout {
                            width: parent ? parent.width : implicitWidth
                            spacing: Theme.spacingM

                            Rectangle {
                                implicitWidth: 48
                                implicitHeight: 48
                                radius: 24
                                color: Theme.surfaceHover
                                border.width: 1
                                border.color: Theme.border

                                Text {
                                    anchors.centerIn: parent
                                    text: "🐱"
                                    font.pixelSize: 26
                                }
                            }

                            ASeparator {
                                orientation: "vertical"
                                Layout.fillHeight: true
                            }

                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.onboarding.v3.companionQuote")
                                wrapMode: Text.WordWrap
                                font.family: Theme.fontBody
                                font.pixelSize: 15
                                color: Theme.textPrimary
                            }
                        }
                    }

                    // Feature pills.
                    RowLayout {
                        Layout.alignment: Qt.AlignHCenter
                        spacing: Theme.spacingS

                        FeaturePill {
                            icon: "⚡"
                            label: I18n.tr("shell.onboarding.v3.pillWebgpu")
                        }

                        FeaturePill {
                            icon: "🛡️"
                            label: I18n.tr("shell.onboarding.v3.pillOffline")
                        }

                        FeaturePill {
                            icon: "✨"
                            label: I18n.tr("shell.onboarding.v3.pillSouls")
                        }
                    }

                    // Actions (all deferred — no first-run store in Qt yet).
                    RowLayout {
                        Layout.alignment: Qt.AlignHCenter
                        Layout.topMargin: Theme.spacingM
                        spacing: Theme.spacingM

                        DeferredAction {
                            variant: AButton.Accent
                            text: I18n.tr("shell.onboarding.v3.quickStart")
                            implicitWidth: 180
                        }

                        DeferredAction {
                            variant: AButton.Default
                            text: I18n.tr("shell.onboarding.v3.guidedSetup")
                            implicitWidth: 160
                        }
                    }

                    DeferredAction {
                        Layout.alignment: Qt.AlignHCenter
                        variant: AButton.Ghost
                        text: I18n.tr("shell.onboarding.v3.setupLater")
                    }

                    ACard {
                        Layout.fillWidth: true
                        Layout.topMargin: Theme.spacingS
                        borderColor: Theme.warning

                        RowLayout {
                            width: parent ? parent.width : implicitWidth
                            spacing: Theme.spacingM

                            Text {
                                text: "⚠"
                                font.pixelSize: 18
                                color: Theme.warning
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.onboarding.deferredNotice")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.warning
                            }
                        }
                    }
                }
            }
        }
    }
}
