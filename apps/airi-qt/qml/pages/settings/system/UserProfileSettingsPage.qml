// SPDX-License-Identifier: GPL-3.0-or-later
// User profile settings page: display name, description, system prompt
// override and voice profile id.
// Persists through the UserProfileSettingsController bridge (settings/user-profile).
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    UserProfileSettingsController {
        id: profileCtl
    }

    property string saveError: ""

    function save() {
        var ok = profileCtl.save(nameField.text, descriptionArea.text, promptArea.text, voiceProfileField.text)
        page.saveError = ok ? "" : I18n.tr("shell.profile.saveError")
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
                text: I18n.tr("shell.settings.nav.profile")
                font.family: Theme.fontTitle
                font.pixelSize: 22
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 460
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.profile.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.profile.identitySection")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.profile.name")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                    }

                    ATextField {
                        id: nameField
                        Layout.fillWidth: true
                        text: profileCtl.name
                        placeholderText: I18n.tr("shell.profile.namePlaceholder")
                        onAccepted: page.save()
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.profile.descriptionLabel")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                    }

                    ATextArea {
                        id: descriptionArea
                        Layout.fillWidth: true
                        text: profileCtl.description
                        placeholderText: I18n.tr("shell.profile.descriptionPlaceholder")
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.profile.voiceProfileId")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                    }

                    ATextField {
                        id: voiceProfileField
                        Layout.fillWidth: true
                        text: profileCtl.voiceProfileId
                        placeholderText: I18n.tr("shell.profile.voiceProfileIdPlaceholder")
                        onAccepted: page.save()
                    }
                }
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: I18n.tr("shell.profile.promptSection")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        font.bold: true
                        color: Theme.textPrimary
                    }

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.profile.promptHint")
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    ATextArea {
                        id: promptArea
                        Layout.fillWidth: true
                        implicitHeight: 180
                        text: profileCtl.prompt
                        placeholderText: I18n.tr("shell.profile.promptPlaceholder")
                    }
                }
            }

            AButton {
                variant: AButton.Accent
                text: I18n.tr("shell.profile.save")
                onClicked: page.save()
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

    Component.onCompleted: profileCtl.load()
}
