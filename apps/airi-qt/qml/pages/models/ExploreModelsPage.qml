// SPDX-License-Identifier: GPL-3.0-or-later
// Explore Models page — port of packages/stage-pages/src/pages/settings/models/explore.vue.
// A curated, data-driven catalog of VRM/Live2D/Spine/MMD community archives
// and marketplaces. Data lives in exploreData.js (verbatim port of
// packages/stage-ui/src/constants/marketplaces.ts, MIT). Preview images are
// loaded from their remote URLs; every link opens in the system browser.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0
import "exploreData.js" as Explore

Item {
    id: page

    property string filter: "all"

    readonly property var formats: [
        { id: "all", label: I18n.tr("shell.models.explore.formats.all") },
        { id: "vrm", label: I18n.tr("shell.models.explore.formats.vrm") },
        { id: "live2d", label: I18n.tr("shell.models.explore.formats.live2d") },
        { id: "spine", label: I18n.tr("shell.models.explore.formats.spine") },
        { id: "mmd", label: I18n.tr("shell.models.explore.formats.mmd") },
    ]

    readonly property var spotlightModels: {
        if (page.filter === "all")
            return Explore.SPOTLIGHT_MODELS
        return Explore.SPOTLIGHT_MODELS.filter(function (m) { return m.format === page.filter })
    }

    readonly property var freeArchives: {
        var list = Explore.MODEL_MARKETPLACES
        if (page.filter !== "all")
            list = list.filter(function (m) { return m[page.filter] })
        return list.filter(function (m) { return m.pricing === "free" })
    }

    readonly property var creatorMarketplaces: {
        var list = Explore.MODEL_MARKETPLACES
        if (page.filter !== "all")
            list = list.filter(function (m) { return m[page.filter] })
        return list.filter(function (m) { return m.pricing !== "free" })
    }

    function languagesFor(list) {
        return list.map(function (lang) {
            if (lang === "jp") return "日本語"
            if (lang === "cn") return "中文"
            return "English"
        }).join(" · ")
    }

    function formatBadge(site) {
        var badges = []
        if (site.vrm) badges.push("VRM")
        if (site.live2d) badges.push("Live2D")
        if (site.spine) badges.push("Spine")
        if (site.mmd) badges.push("MMD")
        return badges.join(" · ")
    }

    Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: layout.implicitHeight
        clip: true

        ColumnLayout {
            id: layout
            width: parent.width - 2 * Theme.spacingM
            x: Theme.spacingM
            y: Theme.spacingM
            spacing: Theme.spacingM

            // Hero header
            ACard {
                Layout.fillWidth: true
                ColumnLayout {
                    anchors.fill: parent
                    spacing: Theme.spacingS
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 56
                        spacing: Theme.spacingM
                        Text {
                            text: "🪐"
                            font.pixelSize: 32
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            Text {
                                text: I18n.tr("shell.models.explore.title")
                                color: Theme.textPrimary
                                font.pixelSize: 18
                                font.bold: true
                            }
                            Text {
                                text: I18n.tr("shell.models.explore.description")
                                color: Theme.textSecondary
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }
                        }
                        AButton {
                            text: I18n.tr("shell.models.explore.suggestSite")
                            onClicked: Qt.openUrlExternally("https://github.com/dasilva333/airi/issues")
                        }
                    }
                }
            }

            // Format filter chips
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                Text {
                    text: I18n.tr("shell.models.explore.filterLabel")
                    color: Theme.textSecondary
                    font.pixelSize: 11
                    font.bold: true
                }
                AToggleGroup {
                    model: page.formats.map(function (f) { return f.label })
                    currentIndex: page.formats.findIndex(function (f) { return f.id === page.filter })
                    onToggled: function (index) { page.filter = page.formats[index].id }
                }
                Item { Layout.fillWidth: true }
            }

            // Featured free avatars (spotlight)
            Text {
                text: I18n.tr("shell.models.explore.featuredFree")
                    + " — " + page.spotlightModels.length.toString()
                color: Theme.textSecondary
                font.pixelSize: 11
                font.bold: true
            }

            ListView {
                Layout.fillWidth: true
                Layout.preferredHeight: 190
                orientation: ListView.Horizontal
                spacing: Theme.spacingS
                clip: true
                model: page.spotlightModels

                delegate: Rectangle {
                    id: spotlightCard
                    width: 168
                    height: 182
                    radius: Theme.radiusM
                    color: Theme.surface
                    border.color: Theme.border
                    required property var modelData

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: Theme.spacingS
                        spacing: Theme.spacingS

                        Rectangle {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            radius: Theme.radiusS
                            color: Theme.surfaceHover
                            clip: true
                            Image {
                                anchors.fill: parent
                                source: spotlightCard.modelData.previewUrl
                                fillMode: Image.PreserveAspectCrop
                                asynchronous: true
                                cache: true
                            }
                        }
                        Text {
                            Layout.fillWidth: true
                            text: modelData.name
                            color: Theme.textPrimary
                            font.pixelSize: 12
                            font.bold: true
                            maximumLineCount: 1
                            elide: Text.ElideRight
                        }
                        AButton {
                            Layout.fillWidth: true
                            variant: AButton.Accent
                            text: I18n.tr("shell.models.explore.downloadModel")
                            onClicked: Qt.openUrlExternally(spotlightCard.modelData.downloadUrl)
                        }
                    }
                }
            }

            // Free community archives
            Text {
                text: I18n.tr("shell.models.explore.freeArchives")
                    + " — " + page.freeArchives.length.toString()
                color: Theme.textSecondary
                font.pixelSize: 11
                font.bold: true
            }

            Text {
                visible: page.freeArchives.length === 0
                text: I18n.tr("shell.models.explore.emptyFree")
                color: Theme.textSecondary
                font.pixelSize: 12
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }

            Repeater {
                model: page.freeArchives
                Rectangle {
                    required property var modelData
                    Layout.fillWidth: true
                    implicitHeight: archiveColumn.implicitHeight + 2 * Theme.spacingM
                    radius: Theme.radiusM
                    color: Theme.surface
                    border.color: Theme.border

                    ColumnLayout {
                        id: archiveColumn
                        anchors.fill: parent
                        anchors.margins: Theme.spacingM
                        spacing: Theme.spacingS
                        RowLayout {
                            Layout.fillWidth: true
                            Text {
                                text: modelData.name
                                color: Theme.textPrimary
                                font.pixelSize: 13
                                font.bold: true
                                Layout.fillWidth: true
                                elide: Text.ElideRight
                            }
                            Text {
                                visible: (modelData.notice || "").length > 0
                                text: modelData.notice || ""
                                color: Theme.accent
                                font.pixelSize: 10
                            }
                        }
                        Text {
                            visible: (modelData.description || "").length > 0
                            text: modelData.description || ""
                            color: Theme.textSecondary
                            font.pixelSize: 11
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }
                        Text {
                            text: page.formatBadge(modelData) + " · " + I18n.tr("shell.models.explore.free")
                            color: Theme.accent
                            font.pixelSize: 10
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            Text {
                                text: (modelData.origin || "") + " · " + page.languagesFor(modelData.languages || [])
                                color: Theme.textSecondary
                                font.pixelSize: 10
                                Layout.fillWidth: true
                                elide: Text.ElideRight
                            }
                            AButton {
                                variant: AButton.Ghost
                                text: I18n.tr("shell.models.explore.visit")
                                onClicked: Qt.openUrlExternally(modelData.url)
                            }
                        }
                    }
                }
            }

            // Creator marketplaces
            Text {
                text: I18n.tr("shell.models.explore.creatorMarketplaces")
                    + " — " + page.creatorMarketplaces.length.toString()
                color: Theme.textSecondary
                font.pixelSize: 11
                font.bold: true
            }

            Text {
                visible: page.creatorMarketplaces.length === 0
                text: I18n.tr("shell.models.explore.emptyPaid")
                color: Theme.textSecondary
                font.pixelSize: 12
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }

            Repeater {
                model: page.creatorMarketplaces
                Rectangle {
                    required property var modelData
                    Layout.fillWidth: true
                    implicitHeight: marketColumn.implicitHeight + 2 * Theme.spacingM
                    radius: Theme.radiusM
                    color: Theme.surface
                    border.color: Theme.border

                    ColumnLayout {
                        id: marketColumn
                        anchors.fill: parent
                        anchors.margins: Theme.spacingM
                        spacing: Theme.spacingS
                        RowLayout {
                            Layout.fillWidth: true
                            Text {
                                text: modelData.name
                                color: Theme.textPrimary
                                font.pixelSize: 13
                                font.bold: true
                                Layout.fillWidth: true
                                elide: Text.ElideRight
                            }
                            Text {
                                text: modelData.pricing === "paid"
                                    ? I18n.tr("shell.models.explore.paid")
                                    : I18n.tr("shell.models.explore.mixed")
                                color: Theme.warning
                                font.pixelSize: 10
                            }
                        }
                        Text {
                            visible: (modelData.description || "").length > 0
                            text: modelData.description || ""
                            color: Theme.textSecondary
                            font.pixelSize: 11
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }
                        Text {
                            text: page.formatBadge(modelData)
                            color: Theme.accent
                            font.pixelSize: 10
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            Text {
                                text: (modelData.origin || "") + " · " + page.languagesFor(modelData.languages || [])
                                color: Theme.textSecondary
                                font.pixelSize: 10
                                Layout.fillWidth: true
                                elide: Text.ElideRight
                            }
                            AButton {
                                variant: AButton.Ghost
                                text: I18n.tr("shell.models.explore.visit")
                                onClicked: Qt.openUrlExternally(modelData.url)
                            }
                        }
                    }
                }
            }

            // Suggestion footer
            ACard {
                Layout.fillWidth: true
                ColumnLayout {
                    anchors.fill: parent
                    spacing: Theme.spacingS
                    Text {
                        text: I18n.tr("shell.models.explore.knowRepository")
                        color: Theme.textPrimary
                        font.pixelSize: 13
                        font.bold: true
                    }
                    Text {
                        text: I18n.tr("shell.models.explore.knowRepositoryHint")
                        color: Theme.textSecondary
                        font.pixelSize: 11
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                    AButton {
                        text: I18n.tr("shell.models.explore.submitOnGithub")
                        onClicked: Qt.openUrlExternally("https://github.com/dasilva333/airi/issues")
                    }
                }
            }
        }
    }
}
