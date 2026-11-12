// SPDX-License-Identifier: GPL-3.0-or-later
// Hairline separator; `orientation` is "horizontal" (default) or "vertical".
import QtQuick 2.15
import com.airi.airiqt 1.0

Rectangle {
    id: control

    property string orientation: "horizontal"

    implicitWidth: orientation === "vertical" ? 1 : 100
    implicitHeight: orientation === "vertical" ? 100 : 1
    color: Theme.border
}
