using System;
using System.Threading;
using System.Threading.Tasks;
using Godot;
using AnimaPet.Net;
using AnimaPet.Renderers;

namespace AnimaPet;

/// <summary>
/// Spike entry scene. Owns exactly one renderer at a time, connects to the
/// Rust daemon gateway, subscribes to pet event topics, and routes decoded
/// daemon events into the active renderer. The window stays alive
/// independently of the Flutter control surface; closing Flutter must not tear
/// this process down (pivot invariant 2,
/// docs/design-flutter-godot-pivot.md:132).
///
/// <para>
/// The daemon is the single owner of state. This scene holds view state only:
/// it forwards <c>lip_sync.rms</c> → <see cref="IPetRenderer.SetLipSync"/> and
/// <c>emotion.tag</c> → <see cref="IPetRenderer.SetEmotion"/>; it does not
/// persist or reinterpret those events.
/// </para>
/// </summary>
public partial class Main : Node2D
{
    private IPetRenderer? _renderer;
    private DaemonClient? _daemon;
    private CancellationTokenSource? _pumpCts;

    public override void _Ready()
    {
        // Window appearance is configured declaratively in project.godot
        // (borderless, per-pixel transparency, always-on-top). No runtime
        // DisplayServer calls are needed for the spike.
        GD.Print($"[AnimaPet] renderer spike ready; daemon endpoint: {DaemonClient.DefaultEndpoint}");

        // Start the daemon connection. The auth token is read from the
        // daemon-owned server-channel/config.json (same path the daemon
        // uses); pass an explicit token to DaemonClient if that file is
        // unavailable (e.g. a non-Linux host before the daemon has run).
        _ = ConnectToDaemonAsync();
    }

    private async Task ConnectToDaemonAsync()
    {
        try
        {
            _daemon = new DaemonClient();
            _daemon.EventReceived += OnDaemonEvent;
            await _daemon.ConnectAsync().ConfigureAwait(true);
            await _daemon.SubscribeAsync(EventTopics.PetTopics).ConfigureAwait(true);
            GD.Print($"[AnimaPet] daemon connected; subscribed to {string.Join(", ", EventTopics.PetTopics)}");

            // Pump events on Godot's main thread. Godot object access from
            // background threads is unsafe; the pump yields back to the main
            // loop via ConfigureAwait(true).
            _pumpCts = new CancellationTokenSource();
            _ = _daemon.PumpAsync(_pumpCts.Token);
        }
        catch (Exception ex)
        {
            // The daemon may not be running yet; log and keep the window alive
            // so the user sees the pet even before the core is up.
            GD.PrintErr($"[AnimaPet] daemon connection failed: {ex.Message}");
        }
    }

    private void OnDaemonEvent(object? sender, DaemonEventArgs e)
    {
        // Renderer calls must stay on the main thread. The pump's
        // ConfigureAwait(true) ensures this handler runs there.
        if (_renderer is null)
            return;

        switch (e.Data)
        {
            case LipSyncRmsData lip:
                _renderer.SetLipSync(lip.Level);
                break;
            case EmotionTagData emotion when emotion.Kind == CueKind.Emotion:
                _renderer.SetEmotion(emotion.Tag, emotion.Intensity);
                break;
            // presence.changed and status.changed are informational for the
            // pet; a future card-switch or offline slouch could react here.
        }
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
        _pumpCts?.Cancel();
        if (_daemon is not null)
        {
            _daemon.EventReceived -= OnDaemonEvent;
            _ = _daemon.DisconnectAsync();
            _daemon.Dispose();
            _daemon = null;
        }
        _renderer?.Dispose();
        _renderer = null;
    }
}