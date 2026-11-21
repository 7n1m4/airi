using System;

namespace AnimaPet.Renderers;

/// <summary>Selects the renderer plugin for a card (per-card plugin boundary).</summary>
public static class PetRendererFactory
{
    /// <summary>Create the backend named by <paramref name="config"/>.</summary>
    public static IPetRenderer Create(CardRenderConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);

        if (string.IsNullOrWhiteSpace(config.AssetPath))
            throw new ArgumentException("A model asset path is required.", nameof(config));

        return config.Backend switch
        {
            PetRenderBackend.Live2d => new Live2dRenderer(),
            PetRenderBackend.Vrm => new VrmRenderer(),
            _ => throw new ArgumentOutOfRangeException(
                nameof(config), config.Backend, "Unknown pet renderer backend."),
        };
    }
}
