using System;

namespace AnimaPet.Renderers;

/// <summary>
/// Backend-agnostic pet renderer contract. Each avatar backend (Live2D via
/// GDCubism, 3D via VRM/MToon) implements this interface behind the per-card
/// plugin boundary described in docs/design-flutter-godot-pivot.md (decision A
/// and invariant 4). The daemon owns no rendering code; the Godot client maps
/// high-level events into these calls.
/// </summary>
public interface IPetRenderer : IDisposable
{
    /// <summary>Stable identifier used in diagnostics, e.g. "live2d.gdcubism".</summary>
    string BackendId { get; }

    /// <summary>Load the model referenced by <paramref name="config"/>.</summary>
    void Initialize(CardRenderConfig config);

    /// <summary>
    /// Feed a speech amplitude level in [0,1] (future `lip_sync.rms` event).
    /// Framing is intentionally NOT decoded here; see Net/DaemonClient.cs.
    /// </summary>
    void SetLipSync(float level);

    /// <summary>
    /// Apply an emotion tag with a normalized intensity (future `emotion.tag`
    /// event). The tag vocabulary is owned by Wave 0; do not hard-code it yet.
    /// </summary>
    void SetEmotion(string tag, float intensity);

    /// <summary>Advance any backend-side smoothing/animation by <paramref name="delta"/> seconds.</summary>
    void Process(double delta);
}
