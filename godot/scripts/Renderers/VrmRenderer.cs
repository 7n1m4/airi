using System;

namespace AnimaPet.Renderers;

/// <summary>
/// 3D VRM backend placeholder.
///
/// Intended implementation: use the godot-vrm + MToon addons
/// (addons/vrm and addons/Godot-MToon-Shader; pin a Godot-4.7-compatible
/// revision) to load a <c>.vrm</c>, then drive VRM blend shapes. Reproduce the
/// reference smoothing from crates/anima-render/src/vrm/lipsync.rs:24-38 here
/// on the Godot side: clamp RMS to [0,1]; snap the weight up on attack;
/// otherwise decay by dt / 0.120 with a floor at RMS; clamp again. See
/// docs/research-godot-renderer-spike.md §2 for the full comparison.
/// </summary>
public sealed class VrmRenderer : IPetRenderer
{
    /// <inheritdoc/>
    public string BackendId => "vrm.godot-vrm";

    /// <inheritdoc/>
    public void Initialize(CardRenderConfig config) =>
        throw new NotImplementedException(
            "VRM backend is not implemented in the E4-T2 spike. "
            + "Add a Godot-4.7-compatible godot-vrm + MToon addon, then import "
            + "config.AssetPath (*.vrm).");

    /// <inheritdoc/>
    public void SetLipSync(float level) =>
        throw new NotImplementedException(
            "VRM lip-sync mapping is not implemented: apply the anima-render "
            + "attack/decay smoothing and drive the 'aa' VRM blend shape.");

    /// <inheritdoc/>
    public void SetEmotion(string tag, float intensity) =>
        throw new NotImplementedException(
            "VRM emotion mapping is not implemented: resolve the Wave-0 tag "
            + "to a VRM expression preset / animation and apply intensity.");

    /// <inheritdoc/>
    public void Process(double delta) =>
        throw new NotImplementedException(
            "VRM per-frame update is not implemented: advance the ~120 ms "
            + "lip-sync decay with delta seconds.");

    /// <inheritdoc/>
    public void Dispose()
    {
        // Nothing to release until a VRM scene instance is loaded.
    }
}
