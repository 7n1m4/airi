using System;

namespace AnimaPet.Renderers;

/// <summary>
/// Live2D backend placeholder.
///
/// Intended implementation: wrap the GDCubism GDExtension
/// (https://github.com/MizunagiKB/gd_cubism, Godot 4.3+, MIT wrapper but
/// Live2D Open + Proprietary Core license terms apply), load the card's
/// <c>.model3.json</c>, and map <c>lip_sync.rms</c> / <c>emotion.tag</c> events
/// into Cubism parameters and expression motions. Licensing constraints and
/// platform support are documented in docs/research-godot-renderer-spike.md §1.
/// </summary>
public sealed class Live2dRenderer : IPetRenderer
{
    /// <inheritdoc/>
    public string BackendId => "live2d.gdcubism";

    /// <inheritdoc/>
    public void Initialize(CardRenderConfig config) =>
        throw new NotImplementedException(
            "GDCubism Live2D backend is not implemented in the E4-T2 spike. "
            + "Add the GDCubism GDExtension, then load config.AssetPath (*.model3.json) "
            + "into a GDCubismUserModel.");

    /// <inheritdoc/>
    public void SetLipSync(float level) =>
        throw new NotImplementedException(
            "Live2D lip-sync mapping is not implemented: drive a Cubism lip-sync "
            + "parameter group from the smoothed level.");

    /// <inheritdoc/>
    public void SetEmotion(string tag, float intensity) =>
        throw new NotImplementedException(
            "Live2D emotion mapping is not implemented: resolve the Wave-0 tag "
            + "to a Cubism expression/motion and apply intensity.");

    /// <inheritdoc/>
    public void Process(double delta) =>
        throw new NotImplementedException(
            "Live2D per-frame update is not implemented (parameter smoothing / motion tick).");

    /// <inheritdoc/>
    public void Dispose()
    {
        // Nothing to release until a GDCubismUserModel is instantiated.
    }
}
