// SPDX-License-Identifier: GPL-3.0-or-later
// MToon fragment: flat toon lighting (two-step ramp) + rim + alpha cutout.
//
// Shaded CustomMaterial (Qt 6.8+ GLSL source via __fragmentShaderCode):
// MAIN() only declares material parameters; DIFFUSE is only valid inside
// the light kernels (AMBIENT_LIGHT / DIRECTIONAL_LIGHT / ...). The light
// kernels receive BASE_COLOR, so the texture sample happens once in MAIN.
// uBaseMap is always bound (white 1x1 fallback for textureless materials);
// uUseMap selects between flat color and texture.

void MAIN()
{
    vec4 baseMap = texture(uBaseMap, UV0);
    BASE_COLOR = vec4(mix(uBaseColor.rgb, baseMap.rgb, uUseMap), uBaseColor.a);
    SPECULAR_AMOUNT = 0.0;
    ROUGHNESS = 1.0;
}

void DIRECTIONAL_LIGHT()
{
    float ndl = max(0.0, dot(normalize(NORMAL), TO_LIGHT_DIR));
    float toon = ndl > 0.5 ? 1.0 : 0.35;
    DIFFUSE += BASE_COLOR.rgb * LIGHT_COLOR * SHADOW_CONTRIB * vec3(toon);
}

void AMBIENT_LIGHT()
{
    // Shade floor so the shadowed side never goes fully black.
    DIFFUSE += uShadeColor.rgb * 0.25 + uShadeColor.rgb * 0.4 * TOTAL_AMBIENT_COLOR;
}
