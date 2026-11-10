// SPDX-License-Identifier: GPL-3.0-or-later
// About window: app name, version, license note, source and credit.
// Version is a constant kept in sync with crates/airi-qt/Cargo.toml.
import QtQuick 2.15
import QtQuick.Window 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Window {
    id: aboutWindow
    width: 670
    height: 730
    minimumWidth: 420
    minimumHeight: 480
    title: I18n.tr("shell.about.title")
    color: Theme.bg

    // Version comes from the crate manifest via the update bridge.
    readonly property string appVersion: updateCtl.currentVersion

    property string updateResult: ""
    property string updateUrl: ""

    UpdateController {
        id: updateCtl
    }

    Column {
        anchors.centerIn: parent
        width: Math.min(parent.width - 2 * Theme.spacingL, 460)
        spacing: Theme.spacingL

        Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            width: 88
            height: 88
            radius: width / 2
            color: Theme.accent

            Text {
                anchors.centerIn: parent
                text: "A"
                color: Theme.accentContrast
                font.family: Theme.fontTitle
                font.pixelSize: 40
                font.bold: true
            }
        }

        Column {
            width: parent.width
            spacing: Theme.spacingS

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: I18n.tr("shell.about.app-name")
                font.family: Theme.fontTitle
                font.pixelSize: 34
                font.bold: true
                color: Theme.textPrimary
            }

            Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: I18n.tr("shell.about.tagline")
                font.family: Theme.fontBody
                font.pixelSize: 13
                wrapMode: Text.WordWrap
                color: Theme.textSecondary
            }
        }

        ACard {
            width: parent.width

            ColumnLayout {
                width: parent ? parent.width : implicitWidth
                spacing: Theme.spacingS

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.app.version-label")
                        font.family: Theme.fontBody
                        font.pixelSize: 14
                        color: Theme.textPrimary
                    }

                    ABadge {
                        text: aboutWindow.appVersion
                        variant: "default"
                    }
                }

                ASeparator {
                    Layout.fillWidth: true
                }

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.about.body")
                    font.family: Theme.fontBody
                    font.pixelSize: 13
                    color: Theme.textSecondary
                }

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.about.license")
                    font.family: Theme.fontBody
                    font.pixelSize: 12
                    color: Theme.textSecondary
                }

                ASeparator {
                    Layout.fillWidth: true
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        text: I18n.tr("shell.about.source-label")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.textPrimary
                    }

                    Text {
                        id: sourceLink
                        text: "github.com/moeru-ai/airi"
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        font.underline: true
                        color: Theme.accent

                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: Qt.openUrlExternally(I18n.tr("shell.about.source-url"))
                        }
                    }
                }

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: I18n.tr("shell.about.credit")
                    font.family: Theme.fontBody
                    font.pixelSize: 12
                    color: Theme.textSecondary
                }

                ASeparator {
                    Layout.fillWidth: true
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingS

                    AButton {
                        variant: AButton.Ghost
                        text: I18n.tr("shell.about.check-update")

                        onClicked: {
                            var res = updateCtl.checkUpdate()
                            if (res === "up-to-date") {
                                aboutWindow.updateResult = I18n.tr("shell.about.update-up-to-date")
                                aboutWindow.updateUrl = ""
                            } else if (res.indexOf("update-available:") === 0) {
                                var parts = res.substring("update-available:".length).trim().split(/\s+/)
                                aboutWindow.updateResult = I18n.tr("shell.about.update-available") + " " + parts[0]
                                aboutWindow.updateUrl = parts.length > 1 ? parts[1] : ""
                            } else {
                                aboutWindow.updateResult = res
                                aboutWindow.updateUrl = ""
                            }
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        visible: aboutWindow.updateResult.length > 0
                        text: aboutWindow.updateResult
                        font.family: Theme.fontBody
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }
                }

                Text {
                    Layout.fillWidth: true
                    visible: aboutWindow.updateUrl.length > 0
                    text: aboutWindow.updateUrl
                    font.family: Theme.fontBody
                    font.pixelSize: 12
                    font.underline: true
                    wrapMode: Text.WordWrap
                    color: Theme.accent

                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Qt.openUrlExternally(aboutWindow.updateUrl)
                    }
                }
            }
        }
    }
}
