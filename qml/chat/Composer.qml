// SPDX-License-Identifier: GPL-3.0-or-later
// Composer: multi-line input (Enter sends, Shift/Alt+Enter newlines),
// Send/Stop button, provider/model label.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

ColumnLayout {
    id: composer

    required property var controller

    spacing: Theme.spacingS

    function sendCurrent() {
        const text = input.text.trim()
        if (text.length === 0 || composer.controller.streaming)
            return
        composer.controller.send(text)
        input.text = ""
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingS

        ATextArea {
            id: input
            Layout.fillWidth: true
            implicitHeight: 64
            placeholderText: I18n.tr("shell.chat.input-placeholder")

            Keys.onPressed: function(event) {
                if (event.key !== Qt.Key_Return && event.key !== Qt.Key_Enter)
                    return
                if (event.modifiers & Qt.ShiftModifier || event.modifiers & Qt.AltModifier)
                    return // newline
                if (composer.controller.streaming)
                    return // focus stays; user stops with the button
                composer.sendCurrent()
                event.accepted = true
            }
        }

        ColumnLayout {
            spacing: Theme.spacingS

            AButton {
                text: composer.controller.streaming
                    ? I18n.tr("shell.chat.stop")
                    : I18n.tr("shell.chat.send")
                variant: composer.controller.streaming ? AButton.Danger : AButton.Accent
                onClicked: {
                    if (composer.controller.streaming)
                        composer.controller.stop()
                    else
                        composer.sendCurrent()
                }
            }
        }
    }

    RowLayout {
        Layout.fillWidth: true

        Text {
            text: composer.controller.providerLabel.length > 0
                ? composer.controller.providerLabel
                : I18n.tr("shell.chat.provider-unconfigured")
            font.family: Theme.fontBody
            font.pixelSize: 11
            color: composer.controller.providerLabel.length > 0
                ? Theme.textSecondary : Theme.warning
            elide: Text.ElideRight
            Layout.fillWidth: true
        }

        ABadge {
            visible: composer.controller.streaming
            text: I18n.tr("shell.chat.streaming")
            variant: "accent"
        }
    }
}
