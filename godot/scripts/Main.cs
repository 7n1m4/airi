using Godot;
using AnimaPet.Net;
using AnimaPet.Renderers;

namespace AnimaPet;

/// <summary>
/// Spike entry scene. Owns exactly one renderer at a time and forwards frame
/// ticks to it. The window stays alive independently of the Flutter control
/// surface; closing Flutter must not tear this process down (pivot invariant 2,
/// docs/design-flutter-godot-pivot.md:132).
/// </summary>
public partial class Main : Node2D
{
    private IPetRenderer? _renderer;
    private readonly DaemonClient _daemon = new();

    // TODO(Wave 0): connect _daemon once the generated C# event-lane bindings
    // exist. Until then this field is exposed only so the wiring point is explicit.
    internal DaemonClient Daemon => _daemon;

    public override void _Ready()
    {
        // Window appearance is configured declaratively in project.godot
        // (borderless, per-pixel transparency, always-on-top). No runtime
        // DisplayServer calls are needed for the spike.
        GD.Print($"[AnimaPet] renderer spike ready; daemon endpoint: {DaemonClient.DefaultEndpoint}");
    }

    /// <summary>Swap the active plugin when a card's backend choice changes.</summary>
    public void LoadCard(CardRenderConfig config)
    {
        _renderer?.Dispose();
        _renderer = PetRendererFactory.Create(config);
        _renderer.Initialize(config);
    }

    public override void _Process(double delta)
    {
        _renderer?.Process(delta);
    }

    public override void _ExitTree()
    {
        _renderer?.Dispose();
        _renderer = null;
    }
}
