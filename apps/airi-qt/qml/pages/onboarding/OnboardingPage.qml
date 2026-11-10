// SPDX-License-Identifier: GPL-3.0-or-later
// Onboarding (V2) wizard host — presentational port of
// apps/stage-tamagotchi/src/renderer/pages/onboarding.vue, which wraps the
// OnboardingV2 step machine (localStorage `onboarding/v2-state` + the live
// `useOnboardingStore`). No Qt bridge exists for the first-run store yet,
// so this page renders a static wizard: steps advance locally for preview
// purposes only, and every terminal action (skip / finish / close) stays
// visible but disabled. Not wired to real first-run state.
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

    property int currentStep: 0

    readonly property var steps: [
        { icon: "👋", label: I18n.tr("shell.onboarding.v2.steps.welcome.label"), subtitle: I18n.tr("shell.onboarding.v2.steps.welcome.subtitle") },
        { icon: "🧭", label: I18n.tr("shell.onboarding.v2.steps.triage.label"), subtitle: I18n.tr("shell.onboarding.v2.steps.triage.subtitle") },
        { icon: "👂", label: I18n.tr("shell.onboarding.v2.steps.hearing.label"), subtitle: I18n.tr("shell.onboarding.v2.steps.hearing.subtitle") },
        { icon: "🧠", label: I18n.tr("shell.onboarding.v2.steps.consciousness.label"), subtitle: I18n.tr("shell.onboarding.v2.steps.consciousness.subtitle") },
        { icon: "🙋", label: I18n.tr("shell.onboarding.v2.steps.profile.label"), subtitle: I18n.tr("shell.onboarding.v2.steps.profile.subtitle") },
        { icon: "🎭", label: I18n.tr("shell.onboarding.v2.steps.persona.label"), subtitle: I18n.tr("shell.onboarding.v2.steps.persona.subtitle") },
        { icon: "🧍", label: I18n.tr("shell.onboarding.v2.steps.vessel.label"), subtitle: I18n.tr("shell.onboarding.v2.steps.vessel.subtitle") },
        { icon: "🗣️", label: I18n.tr("shell.onboarding.v2.steps.speech.label"), subtitle: I18n.tr("shell.onboarding.v2.steps.speech.subtitle") },
        { icon: "🚀", label: I18n.tr("shell.onboarding.v2.steps.calibration.label"), subtitle: I18n.tr("shell.onboarding.v2.steps.calibration.subtitle") }
    ]

    readonly property int stepCount: steps.length
    readonly property var currentStepData: steps.length > 0 ? steps[Math.max(0, Math.min(currentStep, stepCount - 1))] : null

    // Disabled control + hover tooltip (the Live2D "deferred" idiom).
    // Used for every action that has no Qt backing yet.
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

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                Text {
                    Layout.fillWidth: true
                    text: I18n.tr("shell.onboarding.v2.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "info"
                    text: I18n.tr("shell.onboarding.v2.previewBadge")
                }
            }

            // First-run wiring is pending; keep the wizard presentational.
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
                        text: I18n.tr("shell.onboarding.deferredNotice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // Step progress rail — clickable to preview steps locally.
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                Repeater {
                    model: page.stepCount

                    delegate: Rectangle {
                        required property int index

                        Layout.fillWidth: true
                        height: 6
                        radius: 3
                        color: index <= page.currentStep ? Theme.accent : Theme.surfacePressed

                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: page.currentStep = index
                        }
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                Text {
                    Layout.fillWidth: true
                    text: page.currentStepData ? page.currentStepData.label : ""
                    font.family: Theme.fontBody
                    font.pixelSize: 13
                    font.bold: true
                    color: Theme.textSecondary
                    elide: Text.ElideRight
                }

                Text {
                    text: (page.currentStep + 1) + " / " + page.stepCount
                    font.family: Theme.fontBody
                    font.pixelSize: 13
                    color: Theme.textSecondary
                }
            }

            // Active step content.
            ACard {
                Layout.fillWidth: true
                implicitHeight: 220

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: page.currentStepData ? page.currentStepData.icon : ""
                        font.pixelSize: 48
                    }

                    Text {
                        text: page.currentStepData ? page.currentStepData.label : ""
                        font.family: Theme.fontTitle
                        font.pixelSize: 20
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: page.currentStepData ? page.currentStepData.subtitle : ""
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textSecondary
                    }
                }
            }

            // Wizard footer: local navigation is live; terminal actions are deferred.
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                AButton {
                    variant: AButton.Ghost
                    text: I18n.tr("shell.onboarding.back")
                    enabled: page.currentStep > 0
                    onClicked: page.currentStep = Math.max(0, page.currentStep - 1)
                }

                Item {
                    Layout.fillWidth: true
                }

                DeferredAction {
                    variant: AButton.Ghost
                    text: I18n.tr("shell.onboarding.v2.skip")
                }

                AButton {
                    visible: page.currentStep < page.stepCount - 1
                    variant: AButton.Accent
                    text: I18n.tr("shell.onboarding.v2.next")
                    onClicked: page.currentStep = Math.min(page.stepCount - 1, page.currentStep + 1)
                }

                DeferredAction {
                    visible: page.currentStep === page.stepCount - 1
                    variant: AButton.Accent
                    text: I18n.tr("shell.onboarding.v2.finish")
                }
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }
}
