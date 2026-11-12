// SPDX-License-Identifier: GPL-3.0-or-later
// Settings window chrome: left nav + content stack.
// Nav: Providers (catalog page), Theme (working page), About (opens About window),
// Stage (pet window / model / captions / strip toggles).
import QtQuick 2.15
import QtQuick.Window 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Window {
    id: settingsWindow
    width: 600
    height: 800
    minimumWidth: 520
    minimumHeight: 560
    title: I18n.tr("shell.settings.title")
    color: Theme.bg

    property int navIndex: 0

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // Left navigation.
        Rectangle {
            Layout.preferredWidth: 180
            Layout.fillHeight: true
            color: Theme.surface

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Theme.spacingS
                spacing: Theme.spacingS

                Text {
                    Layout.fillWidth: true
                    Layout.margins: Theme.spacingS
                    text: I18n.tr("settings.settings.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 15
                    font.bold: true
                    color: Theme.textSecondary
                    elide: Text.ElideRight
                }

                AListItem {
                    Layout.fillWidth: true
                    icon: "🔌"
                    title: I18n.tr("shell.settings.nav.providers")
                    active: settingsWindow.navIndex === 0
                    onClicked: settingsWindow.navIndex = 0
                }

                AListItem {
                    Layout.fillWidth: true
                    icon: "🎨"
                    title: I18n.tr("shell.settings.nav.theme")
                    active: settingsWindow.navIndex === 1
                    onClicked: settingsWindow.navIndex = 1
                }

                AListItem {
                    Layout.fillWidth: true
                    icon: "ℹ️"
                    title: I18n.tr("shell.settings.nav.about")
                    active: settingsWindow.navIndex === 2
                    onClicked: settingsWindow.navIndex = 2
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🎭"
                    title: I18n.tr("shell.settings.nav.stage")
                    active: settingsWindow.navIndex === 3
                    onClicked: settingsWindow.navIndex = 3
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🌀"
                    title: I18n.tr("shell.settings.nav.spine")
                    active: settingsWindow.navIndex === 4
                    onClicked: settingsWindow.navIndex = 4
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🔩"
                    title: I18n.tr("shell.settings.nav.mmd")
                    active: settingsWindow.navIndex === 5
                    onClicked: settingsWindow.navIndex = 5
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🖌️"
                    title: I18n.tr("shell.settings.nav.live2d")
                    active: settingsWindow.navIndex === 6
                    onClicked: settingsWindow.navIndex = 6
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🧩"
                    title: I18n.tr("shell.settings.nav.general")
                    active: settingsWindow.navIndex === 7
                    onClicked: settingsWindow.navIndex = 7
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🖊️"
                    title: I18n.tr("shell.settings.nav.chat")
                    active: settingsWindow.navIndex === 8
                    onClicked: settingsWindow.navIndex = 8
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🔊"
                    title: I18n.tr("shell.settings.nav.voice")
                    active: settingsWindow.navIndex === 9
                    onClicked: settingsWindow.navIndex = 9
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "👤"
                    title: I18n.tr("shell.settings.nav.profile")
                    active: settingsWindow.navIndex === 10
                    onClicked: settingsWindow.navIndex = 10
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🃏"
                    title: I18n.tr("shell.settings.nav.cards")
                    active: settingsWindow.navIndex === 11 || settingsWindow.navIndex === 12
                    onClicked: settingsWindow.navIndex = 11
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🧭"
                    title: I18n.tr("shell.settings.nav.explore")
                    active: settingsWindow.navIndex === 13
                    onClicked: settingsWindow.navIndex = 13
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🗄️"
                    title: I18n.tr("shell.settings.nav.data")
                    active: settingsWindow.navIndex === 14
                    onClicked: settingsWindow.navIndex = 14
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "✨"
                    title: I18n.tr("shell.settings.nav.onboardingV3")
                    active: settingsWindow.navIndex === 15
                    onClicked: settingsWindow.navIndex = 15
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "📣"
                    title: I18n.tr("shell.settings.nav.notice")
                    active: settingsWindow.navIndex === 16
                    onClicked: settingsWindow.navIndex = 16
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "👁️"
                    title: I18n.tr("shell.settings.nav.fadeOnHover")
                    active: settingsWindow.navIndex === 17
                    onClicked: settingsWindow.navIndex = 17
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🧩"
                    title: I18n.tr("shell.settings.nav.widgets")
                    active: settingsWindow.navIndex === 18
                    onClicked: settingsWindow.navIndex = 18
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🔌"
                    title: I18n.tr("shell.settings.nav.mcp")
                    active: settingsWindow.navIndex === 19
                    onClicked: settingsWindow.navIndex = 19
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "💬"
                    title: I18n.tr("shell.settings.nav.discord")
                    active: settingsWindow.navIndex === 20
                    onClicked: settingsWindow.navIndex = 20
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "☁️"
                    title: I18n.tr("shell.settings.nav.cloudSync")
                    active: settingsWindow.navIndex === 21
                    onClicked: settingsWindow.navIndex = 21
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🛠️"
                    title: I18n.tr("shell.settings.nav.pluginHost")
                    active: settingsWindow.navIndex === 22
                    onClicked: settingsWindow.navIndex = 22
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "📷"
                    title: I18n.tr("shell.settings.nav.screenCapture")
                    active: settingsWindow.navIndex === 23
                    onClicked: settingsWindow.navIndex = 23
                }
                AListItem {
                    Layout.fillWidth: true
                    icon: "🤵"
                    title: I18n.tr("shell.settings.nav.acpAgents")
                    active: settingsWindow.navIndex === 24
                    onClicked: settingsWindow.navIndex = 24
                }

                Item {
                    Layout.fillHeight: true
                }
            }
        }

        ASeparator {
            orientation: "vertical"
            Layout.fillHeight: true
        }

        // Content stack.
        StackLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: settingsWindow.navIndex

            // Providers — registry-driven catalog page.
            ProvidersPage {
            }

            // Theme — working page (hue / chroma / dark mode, persisted).
            ThemeSettingsPage {
                id: themePage
            }

            // About — inline placeholder that opens the About window.
            Item {
                ColumnLayout {
                    anchors.centerIn: parent
                    spacing: Theme.spacingM

                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        text: I18n.tr("shell.about.app-name")
                        font.family: Theme.fontTitle
                        font.pixelSize: 40
                        font.bold: true
                        color: Theme.accent
                    }

                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        Layout.maximumWidth: 360
                        horizontalAlignment: Text.AlignHCenter
                        text: I18n.tr("shell.about.tagline")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    AButton {
                        Layout.alignment: Qt.AlignHCenter
                        variant: AButton.Accent
                        text: I18n.tr("shell.settings.nav.about")
                        onClicked: WindowManager.openAbout()
                    }
                }
            }
            // Stage — pet window, model, captions and strip toggles.
            StageSettingsPage {
            }
            // Spine — model runtime options.
            SpineSettingsPage {
            }
            // MMD — model runtime options.
            MmdSettingsPage {
            }
            // Live2D — model runtime options.
            Live2dSettingsPage {
            }
            // General — app-wide behavior.
            GeneralSettingsPage {
            }
            // Chat — input and message handling.
            ChatSettingsPage {
            }
            // Voice — audio input/output devices.
            AudioDeviceSettingsPage {
            }
            // Profile — user identity and voice profile.
            UserProfileSettingsPage {
            }
            // Cards — card library over <profile>/cards/*.png|*.json.
            CardLibraryPage {
                id: cardLibraryPage
                onEditCard: function (id) {
                    cardEditorPage.cardId = id
                    settingsWindow.navIndex = 12
                }
                onCreateCard: {
                    cardEditorPage.cardId = ""
                    settingsWindow.navIndex = 12
                }
            }
            // Card editor — not in the nav; switched from the library.
            CardEditorPage {
                id: cardEditorPage
                cardId: ""
                onSaved: settingsWindow.navIndex = 11
                onCancelled: settingsWindow.navIndex = 11
            }
            // Explore — curated external model catalog.
            ExploreModelsPage {
            }
            // Data — export/import/vault status (UI-only until wave ④).
            DataSettingsPage {
            }
            // Onboarding v3 — presentational first-run wizard.
            OnboardingV3Page {
            }
            // Notice — hub of one-off notice surfaces.
            NoticePage {
            }
            // Notice — Fade on Hover tutorial surface.
            FadeOnHoverNoticePage {
            }
            // Widgets — static catalog of known widget components.
            WidgetsPage {
            }
            // MCP — servers & tools (scaffold; bridge pending).
            McpSettingsPage {
            }
            // Discord — gateway (scaffold; bridge pending).
            DiscordSettingsPage {
            }
            // Cloud Sync — BYOS backup (scaffold; sync engine pending).
            CloudSyncSettingsPage {
            }
            // Plugin Host — devtools scaffold (host not wired).
            PluginHostPage {
            }
            // Screen Capture — wired to the CaptureController bridge.
            ScreenCapturePage {
            }
            // ACP Agents — wired to the AcpController bridge (HITL permissions).
            AcpAgentsPage {
            }
        }
    }
}
