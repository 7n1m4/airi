// SPDX-License-Identifier: GPL-3.0-or-later
// Providers settings page: master/detail over the static registry of 44
// providers plus the port-native `llama-cpp-local` row (45), rendered as data via `ProviderSettingsController` (see
// docs/port-manifest/providers.md). Left: searchable provider list. Right:
// the generic detail form built from each provider's CredentialSchema fields.
// No per-provider QML exists — adding a provider to `airi_llm::PROVIDER_DEFS`
// is all it takes.
import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15
import com.airi.airiqt 1.0

Item {
    id: page

    ProviderSettingsController {
        id: controller
    }

    // Drain async bridge results onto the Qt thread.
    Timer {
        interval: 50
        running: true
        repeat: true
        onTriggered: controller.drainEvents()
    }

    property var providers: []
    property string currentId: ""
    property string filterText: ""

    readonly property var visibleProviders: {
        var needle = page.filterText.trim().toLowerCase()
        if (needle.length === 0)
            return page.providers
        return page.providers.filter(function (p) {
            return p.label.toLowerCase().indexOf(needle) >= 0
                || p.id.toLowerCase().indexOf(needle) >= 0
        })
    }

    readonly property var currentProvider: {
        for (var i = 0; i < page.providers.length; ++i) {
            if (page.providers[i].id === page.currentId)
                return page.providers[i]
        }
        return null
    }

    function refresh() {
        var raw = controller.listProviders()
        var parsed = []
        try {
            parsed = JSON.parse(raw)
        } catch (e) {
            console.log("[airi-qt] providers: failed to parse provider list:", e)
        }
        page.providers = parsed
        var stillThere = false
        for (var i = 0; i < parsed.length; ++i) {
            if (parsed[i].id === page.currentId) {
                stillThere = true
                break
            }
        }
        if (!stillThere)
            page.currentId = parsed.length > 0 ? parsed[0].id : ""
    }

    Component.onCompleted: refresh()

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // Left column: search + list.
        ColumnLayout {
            Layout.preferredWidth: 232
            Layout.fillHeight: true
            Layout.margins: Theme.spacingM
            spacing: Theme.spacingS

            ATextField {
                Layout.fillWidth: true
                placeholderText: I18n.tr("shell.providers.search")
                text: page.filterText
                onTextChanged: page.filterText = text
            }

            ListView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true
                spacing: 2
                model: page.visibleProviders
                ScrollBar.vertical: ScrollBar {}

                delegate: ProviderRow {
                    provider: modelData
                    width: ListView.view ? ListView.view.width : implicitWidth
                    active: page.currentId === modelData.id
                    onActivated: function (id) { page.currentId = id }
                }
            }

            Text {
                visible: page.visibleProviders.length === 0
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                text: I18n.tr("shell.providers.search-empty")
                font.family: Theme.fontBody
                font.pixelSize: 12
                color: Theme.textSecondary
            }
        }

        ASeparator {
            orientation: "vertical"
            Layout.fillHeight: true
        }

        // Right column: detail form.
        ProviderDetail {
            Layout.fillWidth: true
            Layout.fillHeight: true
            provider: page.currentProvider
            controller: controller
            onRefreshRequested: page.refresh()
        }
    }
}
