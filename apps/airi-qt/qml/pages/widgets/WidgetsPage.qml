// SPDX-License-Identifier: GPL-3.0-or-later
// Widgets — presentational port of
// apps/stage-tamagotchi/src/renderer/pages/widgets.vue. Upstream is a
// frameless host window fed by the widgets fetch/render/update/remove/clear
// Eventa bridge plus a QML/Vue component registry (weather, map, artistry,
// comfy, sticker) with a generic JSON-dump fallback. None of that exists in
// the Qt build yet, so this page renders the catalog with static preview
// data and every action stays visible but disabled.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    // Emitted by the deferred actions once the widgets host lands.
    // Currently unused: all widget actions are disabled (see below).
    signal closeRequested()
    signal removeWidgetRequested(string widgetId)

    property int selected: 0

    readonly property var catalog: [
        { icon: "⛅", name: I18n.tr("shell.widgets.kinds.weather.name"), description: I18n.tr("shell.widgets.kinds.weather.description"), props: ["city", "unit", "status"] },
        { icon: "🗺️", name: I18n.tr("shell.widgets.kinds.map.name"), description: I18n.tr("shell.widgets.kinds.map.description"), props: ["latitude", "longitude", "zoom"] },
        { icon: "🎨", name: I18n.tr("shell.widgets.kinds.artistry.name"), description: I18n.tr("shell.widgets.kinds.artistry.description"), props: ["prompt", "imageUrl", "progress", "status"] },
        { icon: "🎨", name: I18n.tr("shell.widgets.kinds.comfy.name"), description: I18n.tr("shell.widgets.kinds.comfy.description"), props: ["prompt", "imageUrl", "progress", "status"] },
        { icon: "🏷️", name: I18n.tr("shell.widgets.kinds.sticker.name"), description: I18n.tr("shell.widgets.kinds.sticker.description"), props: ["stickerId", "alt"] },
        { icon: "📦", name: I18n.tr("shell.widgets.kinds.generic.name"), description: I18n.tr("shell.widgets.kinds.generic.description"), props: ["componentProps (passthrough)"] }
    ]

    readonly property var selectedEntry: catalog.length > 0 ? catalog[Math.max(0, Math.min(selected, catalog.length - 1))] : null

    // Disabled control + hover tooltip (the Live2D "deferred" idiom).
    component DeferredAction: Item {
        id: deferred

        property string text: ""
        property int variant: AButton.Default
        property string tip: I18n.tr("shell.widgets.deferredTip")

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

            // Header: decorative drag handle, title, close (deferred).
            Item {
                Layout.fillWidth: true
                Layout.preferredHeight: 14

                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.verticalCenter: parent.verticalCenter
                    width: 36
                    height: 6
                    radius: 3
                    color: Theme.border
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                Text {
                    Layout.fillWidth: true
                    text: I18n.tr("shell.widgets.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "info"
                    text: I18n.tr("shell.widgets.previewBadge")
                }

                DeferredAction {
                    variant: AButton.Ghost
                    text: "✕"
                    implicitWidth: 36
                }
            }

            // Widgets bridge is pending in Qt.
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
                        text: I18n.tr("shell.widgets.deferredNotice")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // Missing-id state: what upstream shows when the host is opened
            // without a widget id.
            ACard {
                Layout.fillWidth: true
                borderColor: Theme.info

                RowLayout {
                    width: parent ? parent.width : implicitWidth
                    spacing: Theme.spacingM

                    Text {
                        text: "❓"
                        font.pixelSize: 18
                        color: Theme.info
                    }

                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: I18n.tr("shell.widgets.missingId")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.textSecondary
                    }
                }
            }

            Text {
                text: I18n.tr("shell.widgets.catalogTitle")
                font.family: Theme.fontBody
                font.pixelSize: 12
                font.bold: true
                color: Theme.textSecondary
                font.capitalization: Font.AllUppercase
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                // Component list (local selection only — nothing is fetched).
                ColumnLayout {
                    Layout.preferredWidth: 220
                    spacing: 2

                    Repeater {
                        model: page.catalog

                        delegate: AListItem {
                            required property int index
                            required property var modelData

                            Layout.fillWidth: true
                            icon: modelData.icon
                            title: modelData.name
                            active: index === page.selected
                            onClicked: page.selected = index
                        }
                    }
                }

                ASeparator {
                    orientation: "vertical"
                    Layout.fillHeight: true
                }

                // Detail pane for the selected catalog entry.
                ACard {
                    Layout.fillWidth: true
                    Layout.fillHeight: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        RowLayout {
                            spacing: Theme.spacingM

                            Text {
                                text: page.selectedEntry ? page.selectedEntry.icon : ""
                                font.pixelSize: 36
                            }

                            Text {
                                text: page.selectedEntry ? page.selectedEntry.name : ""
                                font.family: Theme.fontTitle
                                font.pixelSize: 18
                                font.bold: true
                                color: Theme.textPrimary
                                elide: Text.ElideRight
                            }
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: page.selectedEntry ? page.selectedEntry.description : ""
                            font.family: Theme.fontBody
                            font.pixelSize: 13
                            color: Theme.textSecondary
                        }

                        ASeparator {
                            Layout.fillWidth: true
                        }

                        Text {
                            text: I18n.tr("shell.widgets.samplePropsCaption")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            font.bold: true
                            color: Theme.textSecondary
                            font.capitalization: Font.AllUppercase
                        }

                        Repeater {
                            model: page.selectedEntry ? page.selectedEntry.props : []

                            delegate: RowLayout {
                                required property string modelData

                                spacing: Theme.spacingS

                                Text {
                                    text: "•"
                                    font.pixelSize: 13
                                    color: Theme.accent
                                }

                                Text {
                                    text: modelData
                                    font.family: Theme.fontBody
                                    font.pixelSize: 13
                                    color: Theme.textPrimary
                                }
                            }
                        }

                        Item {
                            Layout.fillHeight: true
                            implicitHeight: Theme.spacingL
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingM

                            ABadge {
                                variant: "default"
                                text: I18n.tr("shell.widgets.previewBadge")
                            }

                            Item {
                                Layout.fillWidth: true
                            }

                            DeferredAction {
                                variant: AButton.Default
                                text: I18n.tr("shell.widgets.refresh")
                            }

                            DeferredAction {
                                variant: AButton.Ghost
                                text: I18n.tr("shell.widgets.closeWidget")
                            }
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
