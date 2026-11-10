// SPDX-License-Identifier: GPL-3.0-or-later
// MToon fragment: flat toon lighting (two-step ramp) + rim + alpha cutout.
//
// Shaded CustomMaterial: we only write MAIN() and override the light kernels
// to get a hard two-step toon band instead of a smooth falloff.
//
// NOTE: Qt Quick 3D shaded CustomMaterials normally embed GLSL SOURCE
// strings via __fragmentShaderCode. We compile these to .qsb with
// `qsb --glsl "100 es"` at build time (build.rs) and reference the
// resulting qsb URLs from VrmMtoonMaterial.qml; the compiled pack contains
// the QShader variant Qt Quick 3D expects.

void MAIN()
{
    // Base and shade colors come from uBaseColor/uShadeColor uniforms.
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
