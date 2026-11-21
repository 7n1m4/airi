namespace AnimaPet.Renderers;

/// <summary>Per-card renderer backend selection.</summary>
public enum PetRenderBackend
{
    /// <summary>Live2D, rendered by the GDCubism GDExtension.</summary>
    Live2d,

    /// <summary>VRM 3D avatar, rendered with the godot-vrm + MToon addons.</summary>
    Vrm,
}

/// <summary>
/// Provisional, Godot-local description of which backend a card needs.
/// This is NOT a wire type and NOT the card schema: the daemon remains the
/// single owner of cards, which keep their AIRI carve-out names
/// (<c>extensions.airi</c> / <c>AiriCard</c>). A future Wave-0/1 RPC replaces
/// the hand-built config with generated bindings; nothing here guesses that
/// frame shape.
/// </summary>
/// <param name="Backend">Plugin selected for this card.</param>
/// <param name="AssetPath">Backend-specific model path (e.g. .model3.json or .vrm).</param>
public sealed record CardRenderConfig(PetRenderBackend Backend, string AssetPath);
