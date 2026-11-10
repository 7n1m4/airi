// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick 2.15
import QtQuick3D 1.15

// MToon custom material (shaded). Qt Quick 3D shaded CustomMaterials take
// GLSL *source* through __fragmentShaderCode (Qt 6.8+); the shader bodies
// live in qml/shaders/mtoon.{frag,vert} and are inlined verbatim below
// (keep them in sync with those files).
CustomMaterial {
    shadingMode: CustomMaterial.Shaded

    __vertexShaderCode: "
void MAIN()
{
}
"

    __fragmentShaderCode: "
void MAIN()
{
    BASE_COLOR = vec4(uBaseColor.rgb, uBaseColor.a);
    SPECULAR_AMOUNT = 0.0;
    DIFFUSE = uShadeColor.rgb * 0.25;
}

void DIRECTIONAL_LIGHT()
{
    float ndl = max(0.0, dot(normalize(NORMAL), TO_LIGHT_DIR));
    float toon = ndl > 0.5 ? 1.0 : 0.35;
    DIFFUSE += uBaseColor.rgb * LIGHT_COLOR * SHADOW_CONTRIB * vec3(toon);
}

void AMBIENT_LIGHT()
{
    DIFFUSE += uShadeColor.rgb * 0.4 * TOTAL_AMBIENT_COLOR;
}
"

    property color uBaseColor: "white"
    property color uShadeColor: Qt.rgba(0.7, 0.7, 0.7, 1.0)
    property real uRimMix: 0.0
    property real uCutoff: 0.0
}
