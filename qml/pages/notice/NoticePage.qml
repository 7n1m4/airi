// SPDX-License-Identifier: GPL-3.0-or-later
// Notice host — presentational port of
// apps/stage-tamagotchi/src/renderer/pages/notice/index.vue (a
// <RouterView /> for the notice window). Qt has no notice-window host yet,
// so this page is an informative hub listing the notice surface the
// desktop app ships with. No interactive actions are wired.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

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
                    text: I18n.tr("shell.notice.index.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "info"
                    text: I18n.tr("shell.notice.previewBadge")
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 480
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.notice.index.subtitle")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // Notice window host is pending in Qt — keep the surfaces registered but inert.
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
                        text: I18n.tr("shell.notice.index.deferredNotice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            Text {
                text: I18n.tr("shell.notice.index.surfaces")
                font.family: Theme.fontBody
                font.pixelSize: 12
                font.bold: true
                color: Theme.textSecondary
                font.capitalization: Font.AllUppercase
            }

            ACard {
                Layout.fillWidth: true

                ColumnLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingM

                        Text {
                            text: "🖱️"
                            font.pixelSize: 28
                        }

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Text {
                                Layout.fillWidth: true
                                text: I18n.tr("shell.notice.index.fadeOnHoverTitle")
                                font.family: Theme.fontBody
                                font.pixelSize: 15
                                font.bold: true
                                color: Theme.textPrimary
                                elide: Text.ElideRight
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.notice.index.fadeOnHoverSubtitle")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }

                        ABadge {
                            variant: "default"
                            text: I18n.tr("shell.notice.index.routeFadeOnHover")
                        }
                    }
                }
            }

            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.notice.index.footnote")
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textSecondary
            }

            Item {
                Layout.fillHeight: true
                implicitHeight: Theme.spacingL
            }
        }
    }
}
