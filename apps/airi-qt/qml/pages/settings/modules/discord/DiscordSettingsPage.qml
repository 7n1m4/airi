// SPDX-License-Identifier: GPL-3.0-or-later
// Discord messaging module — send-only REST slice.
// The page is wired to the `DiscordController` bridge
// (crates/airi-qt/src/bridges/discord.rs) and to the app's own config file
// (<profile>/airi/discord.json, or the platform data dir without --profile;
// written atomically, 0600 on unix). Verified: Save & Verify (token check via
// GET /users/@me) and sending the message you type (POST /channels/{id}/messages)
// are live. Receiving messages IS wired as an strictly opt-in, in-memory-only
// "Gateway events (opt-in)" card: the gateway worker starts only from that
// card's Start button (never automatically, never in the background), keeps at
// most 100 events in memory (cleared on Stop / Clear), and never parses or
// dispatches anything — an inbox, not a command processor. Bot commands and
// any automated reaction to messages are NOT wired. Nothing is ever sent
// automatically; every send is the human pressing Send.
// Structural source: packages/stage-pages/src/pages/settings/modules/
// messaging-discord.vue (MessagingDiscord.vue in @proj-airi/stage-ui).
// Everything not listed above stays rendered but disabled with an explanatory
// tooltip; the Access & Routing tab is an inert upstream "demonstration
// purposes only" preview.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import com.airi.airiqt 1.0

Item {
    id: page

    property int activeTab: 0

    // ── Live send-only REST state ─────────────────────────────────────────
    property string verifyStatus: ""
    property bool verifyOk: true
    property string sendResult: ""
    property bool sendOk: true
    property bool gatewayVisible: false
    property bool gatewayOk: false
    property string gatewayUrl: ""
    property int gatewayShards: 0
    property int gatewayRemaining: 0
    property string gatewayError: ""

    // ── Live gateway (opt-in, receive-only) state ─────────────────────────
    property bool gatewayRunning: false
    property string gatewayStatusLine: "stopped"
    property string gatewayLastError: ""
    property var gatewayEvents: []

    DiscordController {
        id: controller
    }

    DiscordGatewayController {
        id: gatewayController
    }

    Connections {
        target: controller
        function onConfigChanged() { page.syncFromController() }
    }

    Connections {
        target: gatewayController
        function onStateChanged() { page.syncGateway() }
    }

    Timer {
        id: gatewayPoll
        interval: 1000
        repeat: true
        running: page.gatewayRunning
        onTriggered: gatewayController.refresh()
    }

    Component.onCompleted: {
        page.syncFromController()
        page.syncGateway()
    }

    function syncFromController() {
        tokenField.text = ""
        channelField.text = controller.channelId
        if (!controller.configured) {
            page.verifyStatus = ""
            page.sendResult = ""
            page.gatewayVisible = false
        }
    }

    function parseBridgeJson(raw) {
        try {
            return JSON.parse(raw)
        } catch (e) {
            return { error: "unexpected bridge response" }
        }
    }

    function syncGateway() {
        page.gatewayRunning = gatewayController.running
        page.gatewayStatusLine = gatewayController.statusLine
        page.gatewayLastError = gatewayController.error
        var parsed = []
        try {
            parsed = JSON.parse(gatewayController.eventsJson)
        } catch (e) {
            console.log("[airi-qt] discord gateway: failed to parse eventsJson:", e)
        }
        page.gatewayEvents = parsed
    }

    function gatewayBadgeVariant() {
        if (page.gatewayRunning)
            return "success"
        if (page.gatewayStatusLine.indexOf("error") === 0)
            return "error"
        return "default"
    }

    function gatewayBadgeText() {
        if (page.gatewayRunning)
            return I18n.tr("shell.discord.live.gateway.statusRunning")
        if (page.gatewayStatusLine.indexOf("error") === 0)
            return I18n.tr("shell.discord.live.gateway.statusError")
        return I18n.tr("shell.discord.live.gateway.statusStopped")
    }

    function runSaveAndVerify() {
        var result = page.parseBridgeJson(controller.saveConfig(tokenField.text, channelField.text))
        page.verifyOk = !!(result && result.ok)
        page.verifyStatus = page.verifyOk
            ? I18n.tr("shell.discord.live.verifyOk").replace("%1", result.username).replace("%2", result.id)
            : (result && result.error ? result.error : "unexpected bridge response")
        tokenField.text = ""
        page.sendResult = ""
    }

    function runFetchGatewayInfo() {
        var result = page.parseBridgeJson(controller.gatewayInfo())
        page.gatewayVisible = true
        page.gatewayOk = !!(result && result.ok)
        if (page.gatewayOk) {
            page.gatewayUrl = result.url
            page.gatewayShards = result.shards
            page.gatewayRemaining = result.remaining
            page.gatewayError = ""
        } else {
            page.gatewayUrl = ""
            page.gatewayError = result && result.error ? result.error : "unexpected bridge response"
        }
    }

    function runSendTestMessage() {
        var content = messageField.text.trim()
        if (content.length === 0)
            return
        var result = page.parseBridgeJson(controller.sendTestMessage(messageField.text))
        page.sendOk = !!(result && result.ok)
        page.sendResult = page.sendOk
            ? I18n.tr("shell.discord.live.sentOk").replace("%1", result.id)
            : (result && result.error ? result.error : "unexpected bridge response")
    }

    function doClearConfig() {
        controller.clearConfig()
        // The token is gone — make sure the receive path is not left listening.
        gatewayController.stop()
        gatewayController.clearEvents()
        tokenField.text = ""
        channelField.text = ""
        messageField.text = ""
        page.verifyStatus = ""
        page.sendResult = ""
        page.gatewayVisible = false
        page.syncGateway()
    }

    AModal {
        id: clearConfirm

        title: I18n.tr("shell.discord.live.clearConfirmTitle")

        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: I18n.tr("shell.discord.live.clearConfirmBody")
            font.family: Theme.fontBody
            font.pixelSize: 12
            color: Theme.textPrimary
        }

        RowLayout {
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingS

            AButton {
                variant: AButton.Ghost
                text: I18n.tr("shell.discord.live.clearConfirmCancel")
                onClicked: clearConfirm.close()
            }

            AButton {
                variant: AButton.Danger
                text: I18n.tr("shell.discord.live.clearConfirmConfirm")
                onClicked: {
                    clearConfirm.close()
                    page.doClearConfig()
                }
            }
        }
    }

    // ── Deferred-control idioms (the honest "not wired" pattern) ─────────
    // Disabled ASwitch + ATooltip on wrapper hover.
    component DeferredSwitchRow: Item {
        id: row
        property string label: ""
        property string description: ""

        implicitWidth: content.implicitWidth
        implicitHeight: content.implicitHeight

        RowLayout {
            id: content
            width: parent.width
            spacing: Theme.spacingM

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: row.label
                    font.family: Theme.fontBody
                    font.pixelSize: 14
                    color: Theme.textPrimary
                }

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: row.description
                    font.family: Theme.fontBody
                    font.pixelSize: 12
                    color: Theme.textSecondary
                }
            }

            ASwitch {
                enabled: false
                checked: false
            }
        }

        MouseArea {
            id: hoverArea
            anchors.fill: parent
            hoverEnabled: true
        }

        ATooltip {
            text: I18n.tr("shell.discord.deferredTip")
            visible: hoverArea.containsMouse
            x: 0
            y: row.height + Theme.spacingS
        }
    }

    // Disabled AButton + ATooltip on wrapper hover.
    component DeferredButton: Item {
        id: deferred
        property string text: ""
        property int variant: AButton.Default
        property string tip: I18n.tr("shell.discord.deferredTip")

        implicitWidth: button.implicitWidth
        implicitHeight: button.implicitHeight

        AButton {
            id: button
            anchors.fill: parent
            enabled: false
            text: deferred.text
            variant: deferred.variant
        }

        MouseArea {
            id: hoverArea
            anchors.fill: parent
            hoverEnabled: true
        }

        ATooltip {
            text: deferred.tip
            visible: hoverArea.containsMouse
            x: 0
            y: deferred.height + Theme.spacingS
        }
    }

    // Disabled routing-mode option card + ATooltip on wrapper hover.
    component FallbackOption: Item {
        id: option
        property string title: ""
        property string description: ""
        property bool isDefault: false

        implicitHeight: content.implicitHeight + 2 * Theme.spacingM

        Rectangle {
            anchors.fill: parent
            radius: Theme.radiusM
            opacity: 0.55
            color: Theme.surfaceHover
            border.width: 1
            border.color: Theme.border
        }

        ColumnLayout {
            id: content
            anchors.fill: parent
            anchors.margins: Theme.spacingM
            spacing: Theme.spacingS

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingS

                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: option.title
                    font.family: Theme.fontBody
                    font.pixelSize: 12
                    font.bold: true
                    color: Theme.textPrimary
                }

                ABadge {
                    visible: option.isDefault
                    variant: "default"
                    text: I18n.tr("shell.discord.acl.defaultBadge")
                }
            }

            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: option.description
                font.family: Theme.fontBody
                font.pixelSize: 10
                color: Theme.textSecondary
            }
        }

        MouseArea {
            id: hoverArea
            anchors.fill: parent
            hoverEnabled: true
        }

        ATooltip {
            text: I18n.tr("shell.discord.deferredTip")
            visible: hoverArea.containsMouse
            x: 0
            y: option.height + Theme.spacingS
        }
    }

    // Caption-style section header (Vue `.mc-section-header h3`).
    component SectionCaption: Text {
        font.family: Theme.fontBody
        font.pixelSize: 12
        font.bold: true
        font.capitalization: Font.AllUppercase
        color: Theme.textSecondary
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

            // ── Header ───────────────────────────────────────────────────
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingM

                Text {
                    Layout.fillWidth: true
                    text: I18n.tr("shell.discord.title")
                    font.family: Theme.fontTitle
                    font.pixelSize: 22
                    font.bold: true
                    color: Theme.textPrimary
                    elide: Text.ElideRight
                }

                ABadge {
                    variant: "warning"
                    text: I18n.tr("shell.discord.live.badge")
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 460
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.discord.description")
                font.family: Theme.fontBody
                font.pixelSize: 13
                color: Theme.textSecondary
            }

            // ── Persistent deferred notice (Live2D-deferred style) ────────
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
                        text: I18n.tr("shell.discord.live.banner")
                        font.family: Theme.fontBody
                        font.pixelSize: 13
                        color: Theme.warning
                    }
                }
            }

            // ── Tabs: Bot Connection | Access & Routing ───────────────────
            AToggleGroup {
                Layout.fillWidth: true
                model: [I18n.tr("shell.discord.tabs.bot"), I18n.tr("shell.discord.tabs.acl")]
                currentIndex: page.activeTab

                onToggled: function (index) { page.activeTab = index }
            }

            // ═════════════════════════════════════════════════════════════
            // TAB 1: BOT CONNECTION
            // ═════════════════════════════════════════════════════════════
            ColumnLayout {
                Layout.fillWidth: true
                visible: page.activeTab === 0
                spacing: Theme.spacingM

                SectionCaption {
                    text: I18n.tr("shell.discord.connectivity.title")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingM

                        // Status row — reflects the bridge's lastStatus qproperty.
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Rectangle {
                                implicitWidth: 10
                                implicitHeight: 10
                                radius: 5
                                color: controller.lastStatus === "verified"
                                    ? Theme.success
                                    : (controller.lastStatus === "error" ? Theme.error : Theme.textSecondary)
                            }

                            Text {
                                Layout.fillWidth: true
                                text: controller.lastStatus === "verified"
                                    ? I18n.tr("shell.discord.live.statusVerified")
                                    : (controller.lastStatus === "error"
                                        ? I18n.tr("shell.discord.live.statusError")
                                        : I18n.tr("shell.discord.live.statusUnconfigured"))
                                font.family: Theme.fontBody
                                font.pixelSize: 14
                                color: controller.lastStatus === "verified"
                                    ? Theme.success
                                    : (controller.lastStatus === "error" ? Theme.error : Theme.textSecondary)
                            }

                            ABadge {
                                variant: controller.lastStatus === "verified" ? "success" : "warning"
                                text: I18n.tr("shell.discord.live.badge")
                            }
                        }

                        // Bot token — password echo; write-only, required on every save.
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Text {
                                text: I18n.tr("shell.discord.connectivity.tokenLabel")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.discord.connectivity.tokenDescription")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            // Write-only field: the stored token is never shown;
                            // saving requires the token to be pasted again.
                            ATextField {
                                id: tokenField
                                Layout.fillWidth: true
                                enabled: !controller.working
                                echoMode: TextInput.Password
                                placeholderText: controller.configured
                                    ? I18n.tr("shell.discord.live.tokenPlaceholderReplace")
                                    : I18n.tr("shell.discord.connectivity.tokenPlaceholder")
                            }
                        }

                        // Channel ID — where the test message goes. Not secret.
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Text {
                                text: I18n.tr("shell.discord.live.channelIdLabel")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.discord.live.channelIdDescription")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            ATextField {
                                id: channelField
                                Layout.fillWidth: true
                                enabled: !controller.working
                                placeholderText: I18n.tr("shell.discord.live.channelIdPlaceholder")
                            }
                        }

                        // Config location — the file's folder, never the token.
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Text {
                                text: I18n.tr("shell.discord.live.configPathLabel")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            Text {
                                Layout.fillWidth: true
                                text: controller.configDir
                                font.family: Theme.fontBody
                                font.pixelSize: 11
                                wrapMode: Text.WrapAnywhere
                                color: Theme.textSecondary
                            }
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.discord.live.configPathHint")
                            font.family: Theme.fontBody
                            font.pixelSize: 10
                            color: Theme.textSecondary
                        }

                        // Save & Verify — persists atomically (0600), then verifies once.
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Item { Layout.fillWidth: true }

                            AButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.discord.live.saveAndVerify")
                                enabled: !controller.working
                                onClicked: page.runSaveAndVerify()
                            }
                        }

                        Text {
                            visible: page.verifyStatus.length > 0
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: page.verifyStatus
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: page.verifyOk ? Theme.success : Theme.error
                        }

                        // Already configured — small summary row + clear action.
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS
                            visible: controller.configured

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: controller.botName !== ""
                                    ? I18n.tr("shell.discord.live.configuredAs")
                                        .replace("%1", controller.botName)
                                        .replace("%2", controller.botId)
                                    : I18n.tr("shell.discord.live.configuredUnverified")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            AButton {
                                variant: AButton.Danger
                                text: I18n.tr("shell.discord.live.clearToken")
                                enabled: !controller.working
                                onClicked: clearConfirm.open()
                            }
                        }

                        // Owner username — owner resolution needs the gateway too.
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Text {
                                text: I18n.tr("shell.discord.connectivity.ownerLabel")
                                font.family: Theme.fontBody
                                font.pixelSize: 13
                                font.bold: true
                                color: Theme.textPrimary
                            }

                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.discord.connectivity.ownerDescription")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }

                            Item {
                                Layout.fillWidth: true
                                implicitWidth: ownerField.implicitWidth
                                implicitHeight: ownerField.implicitHeight

                                ATextField {
                                    id: ownerField
                                    anchors.fill: parent
                                    enabled: false
                                    placeholderText: I18n.tr("shell.discord.connectivity.ownerPlaceholder")
                                }

                                MouseArea {
                                    id: ownerHover
                                    anchors.fill: parent
                                    hoverEnabled: true
                                }

                                ATooltip {
                                    text: I18n.tr("shell.discord.deferredTip")
                                    visible: ownerHover.containsMouse
                                    x: 0
                                    y: parent.height + Theme.spacingS
                                }
                            }

                            Text {
                                text: I18n.tr("shell.discord.connectivity.ownerIdPending")
                                font.family: Theme.fontBody
                                font.pixelSize: 10
                                color: Theme.textSecondary
                            }
                        }

                        // Connect / Disconnect — disabled; no gateway to own.
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            DeferredButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.discord.connectivity.connect")
                            }

                            DeferredButton {
                                variant: AButton.Danger
                                text: I18n.tr("shell.discord.connectivity.disconnect")
                            }
                        }
                    }
                }

                // Verify connection — display-only gateway info; receiving is NOT enabled.
                SectionCaption {
                    text: I18n.tr("shell.discord.live.verifySectionTitle")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.discord.live.gatewayDisplayOnly")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Item { Layout.fillWidth: true }

                            AButton {
                                variant: AButton.Default
                                text: I18n.tr("shell.discord.live.fetchGatewayInfo")
                                enabled: controller.configured && !controller.working
                                onClicked: page.runFetchGatewayInfo()
                            }
                        }

                        // Hidden until the first fetch. Plain facts, directly from GET /gateway/bot.
                        ColumnLayout {
                            Layout.fillWidth: true
                            visible: page.gatewayVisible
                            spacing: Theme.spacingS

                            ASeparator {
                                Layout.fillWidth: true
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                visible: page.gatewayOk
                                spacing: Theme.spacingS

                                Text {
                                    text: I18n.tr("shell.discord.live.gatewayUrlLabel")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    color: Theme.textSecondary
                                }

                                Text {
                                    Layout.fillWidth: true
                                    text: page.gatewayUrl
                                    font.family: Theme.fontBody
                                    font.pixelSize: 11
                                    wrapMode: Text.WrapAnywhere
                                    color: Theme.textPrimary
                                }
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                visible: page.gatewayOk
                                spacing: Theme.spacingS

                                Text {
                                    text: I18n.tr("shell.discord.live.gatewayShardsLabel")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    color: Theme.textSecondary
                                }

                                Text {
                                    text: page.gatewayShards
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    color: Theme.textPrimary
                                }
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                visible: page.gatewayOk
                                spacing: Theme.spacingS

                                Text {
                                    text: I18n.tr("shell.discord.live.gatewayRemainingLabel")
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    color: Theme.textSecondary
                                }

                                Text {
                                    text: page.gatewayRemaining
                                    font.family: Theme.fontBody
                                    font.pixelSize: 12
                                    color: Theme.textPrimary
                                }
                            }

                            Text {
                                visible: !page.gatewayOk
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: page.gatewayError
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.error
                            }
                        }
                    }
                }

                // Send a test message — exactly what the user typed, once, on click.
                SectionCaption {
                    text: I18n.tr("shell.discord.live.sendTitle")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.discord.live.sendDescription")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        ATextField {
                            id: messageField
                            Layout.fillWidth: true
                            enabled: controller.configured && !controller.working
                            placeholderText: I18n.tr("shell.discord.live.sendPlaceholder")
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Item { Layout.fillWidth: true }

                            AButton {
                                variant: AButton.Accent
                                text: I18n.tr("shell.discord.live.send")
                                enabled: controller.configured && !controller.working && messageField.text.trim().length > 0
                                onClicked: page.runSendTestMessage()
                            }
                        }

                        Text {
                            visible: page.sendResult.length > 0
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: page.sendResult
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: page.sendOk ? Theme.success : Theme.error
                        }
                    }
                }

                // Gateway events (opt-in) — receive-only, in-memory, human-started.
                SectionCaption {
                    text: I18n.tr("shell.discord.live.gateway.title")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.discord.live.gateway.description")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        // Status row — badge + statusLine + human-driven Start/Stop.
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            ABadge {
                                variant: page.gatewayBadgeVariant()
                                text: page.gatewayBadgeText()
                            }

                            Text {
                                Layout.fillWidth: true
                                text: page.gatewayStatusLine
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                elide: Text.ElideRight
                                color: page.gatewayStatusLine.indexOf("error") === 0
                                    ? Theme.error
                                    : Theme.textSecondary
                            }

                            AButton {
                                visible: !page.gatewayRunning
                                variant: AButton.Accent
                                text: I18n.tr("shell.discord.live.gateway.start")
                                enabled: controller.configured
                                onClicked: gatewayController.start()
                            }

                            AButton {
                                visible: page.gatewayRunning
                                variant: AButton.Default
                                text: I18n.tr("shell.discord.live.gateway.stop")
                                onClicked: gatewayController.stop()
                            }
                        }

                        Text {
                            visible: !controller.configured && !page.gatewayRunning
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.discord.live.gateway.needToken")
                            font.family: Theme.fontBody
                            font.pixelSize: 10
                            color: Theme.textSecondary
                        }

                        Text {
                            visible: page.gatewayLastError.length > 0
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: page.gatewayLastError
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.error
                        }

                        // Events — in-memory inbox, newest first, capped at 100.
                        ListView {
                            id: gatewayEventsList
                            Layout.fillWidth: true
                            visible: page.gatewayEvents.length > 0
                            implicitHeight: Math.min(360, gatewayEventsList.count * 88 + Theme.spacingS)
                            clip: true
                            model: page.gatewayEvents
                            spacing: Theme.spacingS

                            delegate: RowLayout {
                                id: eventRow
                                required property var modelData
                                width: ListView.view.width
                                spacing: Theme.spacingS

                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 2

                                    RowLayout {
                                        Layout.fillWidth: true
                                        spacing: Theme.spacingS

                                        Text {
                                            text: "@" + eventRow.modelData.authorName
                                            font.family: Theme.fontBody
                                            font.pixelSize: 12
                                            font.bold: true
                                            elide: Text.ElideRight
                                            color: Theme.textPrimary
                                        }

                                        Text {
                                            text: "(#" + eventRow.modelData.channelId + ")"
                                            font.family: Theme.fontBody
                                            font.pixelSize: 11
                                            elide: Text.ElideRight
                                            color: Theme.textSecondary
                                        }

                                        ABadge {
                                            visible: eventRow.modelData.authorBot === true
                                            variant: "info"
                                            text: I18n.tr("shell.discord.live.gateway.botBadge")
                                        }

                                        Item { Layout.fillWidth: true }

                                        Text {
                                            text: {
                                                var ms = eventRow.modelData.receivedMs
                                                var date = ms ? new Date(ms) : null
                                                if (date !== null && !isNaN(date.getTime()))
                                                    return Qt.formatDateTime(date, "yyyy-MM-dd HH:mm")
                                                return eventRow.modelData.timestamp ? eventRow.modelData.timestamp : ""
                                            }
                                            font.family: Theme.fontBody
                                            font.pixelSize: 10
                                            color: Theme.textSecondary
                                        }
                                    }

                                    Text {
                                        Layout.fillWidth: true
                                        text: eventRow.modelData.content
                                        font.family: Theme.fontBody
                                        font.pixelSize: 12
                                        wrapMode: Text.WordWrap
                                        elide: Text.ElideRight
                                        maximumLineCount: 3
                                        color: Theme.textPrimary
                                    }
                                }
                            }
                        }

                        AEmptyState {
                            Layout.fillWidth: true
                            visible: page.gatewayEvents.length === 0
                            icon: "📭"
                            title: I18n.tr("shell.discord.live.gateway.emptyTitle")
                            subtitle: I18n.tr("shell.discord.live.gateway.emptySubtitle")
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            Item { Layout.fillWidth: true }

                            AButton {
                                variant: AButton.Danger
                                text: I18n.tr("shell.discord.live.gateway.clearEvents")
                                enabled: page.gatewayEvents.length > 0
                                onClicked: gatewayController.clearEvents()
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.discord.controls.title")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingM

                        DeferredSwitchRow {
                            Layout.fillWidth: true
                            label: I18n.tr("shell.discord.controls.vision")
                            description: I18n.tr("shell.discord.controls.visionDescription")
                        }

                        ASeparator {
                            Layout.fillWidth: true
                        }

                        DeferredSwitchRow {
                            Layout.fillWidth: true
                            label: I18n.tr("shell.discord.controls.dms")
                            description: I18n.tr("shell.discord.controls.dmsDescription")
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.discord.presence.title")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        AEmptyState {
                            Layout.fillWidth: true
                            icon: "🌐"
                            title: I18n.tr("shell.discord.presence.emptyTitle")
                            subtitle: I18n.tr("shell.discord.presence.emptySubtitle")
                        }

                        Item {
                            Layout.alignment: Qt.AlignHCenter
                            implicitWidth: presenceBadge.implicitWidth
                            implicitHeight: presenceBadge.implicitHeight

                            ABadge {
                                id: presenceBadge
                                variant: "warning"
                                text: I18n.tr("shell.discord.presence.bridgeBadge")
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.discord.debug.title")
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingS

                    DeferredButton {
                        text: I18n.tr("shell.discord.debug.forceSync")
                    }

                    DeferredButton {
                        text: I18n.tr("shell.discord.debug.simulate")
                    }

                    DeferredButton {
                        text: I18n.tr("shell.discord.debug.restart")
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.discord.devConsole.title")
                }

                ACard {
                    Layout.fillWidth: true

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingM

                        RowLayout {
                            Layout.fillWidth: true

                            Item { Layout.fillWidth: true }

                            DeferredButton {
                                text: I18n.tr("shell.discord.devConsole.clearLog")
                            }
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: consoleEmpty.implicitHeight + 2 * Theme.spacingL
                            radius: Theme.radiusM
                            color: Theme.bg
                            border.width: 1
                            border.color: Theme.border

                            Text {
                                id: consoleEmpty
                                anchors.centerIn: parent
                                width: parent.width - 2 * Theme.spacingL
                                horizontalAlignment: Text.AlignHCenter
                                wrapMode: Text.WordWrap
                                text: I18n.tr("shell.discord.devConsole.empty")
                                font.family: Theme.fontBody
                                font.pixelSize: 12
                                color: Theme.textSecondary
                            }
                        }
                    }
                }
            }

            // ═════════════════════════════════════════════════════════════
            // TAB 2: ACCESS & ROUTING — upstream demo preview, inert here
            // ═════════════════════════════════════════════════════════════
            ColumnLayout {
                Layout.fillWidth: true
                visible: page.activeTab === 1
                spacing: Theme.spacingM

                // Preview banner (link-free; external links are unavailable).
                ACard {
                    Layout.fillWidth: true
                    borderColor: Theme.warning

                    ColumnLayout {
                        width: parent ? parent.width : implicitWidth
                        spacing: Theme.spacingS

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingS

                            ABadge {
                                variant: "warning"
                                text: I18n.tr("shell.discord.acl.demoBadge")
                            }

                            ABadge {
                                variant: "default"
                                text: I18n.tr("shell.discord.acl.previewBadge")
                            }
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.discord.acl.previewTitle")
                            font.family: Theme.fontBody
                            font.pixelSize: 13
                            font.bold: true
                            color: Theme.textPrimary
                        }

                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            text: I18n.tr("shell.discord.acl.previewBody")
                            font.family: Theme.fontBody
                            font.pixelSize: 12
                            color: Theme.textSecondary
                        }

                        RowLayout {
                            Layout.fillWidth: true

                            Item { Layout.fillWidth: true }

                            DeferredButton {
                                text: I18n.tr("shell.discord.acl.linkLabel")
                                tip: I18n.tr("shell.discord.acl.linkTip")
                            }
                        }
                    }
                }

                SectionCaption {
                    text: I18n.tr("shell.discord.acl.fallbackTitle")
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingS

                    FallbackOption {
                        Layout.fillWidth: true
                        isDefault: true
                        title: I18n.tr("shell.discord.acl.fallbackIgnoreTitle")
                        description: I18n.tr("shell.discord.acl.fallbackIgnoreBody")
                    }

                    FallbackOption {
                        Layout.fillWidth: true
                        title: I18n.tr("shell.discord.acl.fallbackSharedTitle")
                        description: I18n.tr("shell.discord.acl.fallbackSharedBody")
                    }

                    FallbackOption {
                        Layout.fillWidth: true
                        title: I18n.tr("shell.discord.acl.fallbackAutoCreateTitle")
                        description: I18n.tr("shell.discord.acl.fallbackAutoCreateBody")
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingS

                    SectionCaption {
                        Layout.fillWidth: true
                        text: I18n.tr("shell.discord.acl.matrixTitle")
                    }

                    DeferredButton {
                        text: I18n.tr("shell.discord.acl.addMapping")
                    }
                }

                ACard {
                    Layout.fillWidth: true

                    AEmptyState {
                        Layout.fillWidth: true
                        icon: "🗺️"
                        title: I18n.tr("shell.discord.acl.matrixEmptyTitle")
                        subtitle: I18n.tr("shell.discord.acl.matrixEmptySubtitle")
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
