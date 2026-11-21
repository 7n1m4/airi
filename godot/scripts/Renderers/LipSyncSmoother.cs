using System;

namespace AnimaPet.Renderers;

/// <summary>
/// Lip-sync driver: speech <c>rms</c> → vowel morph weight.
///
/// Port of <c>crates/anima-render/src/vrm/lipsync.rs</c> (fast attack,
/// exponential decay ~120 ms, clamped [0,1]). Pure managed code with no Godot
/// dependency so the smoothing can be unit-tested off-engine; the VRM/Live2D
/// backends feed the resulting weight into their morph/expression params.
/// </summary>
public sealed class LipSyncSmoother
{
    /// <summary>Decay time constant in seconds (~120 ms, matches the Rust sidecar).</summary>
    public const float DecaySeconds = 0.120f;

    private float _weight;
    private float _rms;

    /// <summary>Current smoothed <c>aa</c> weight in [0,1].</summary>
    public float Weight => _weight;

    /// <summary>Feed a new RMS sample (clamped to [0,1]).</summary>
    public void SetRms(float rms)
    {
        _rms = Math.Clamp(rms, 0f, 1f);
    }

    /// <summary>
    /// Advance by <paramref name="deltaSeconds"/> and return the new weight.
    /// Attack snaps up toward the latest RMS; decay falls by
    /// <c>dt / 0.120</c> toward it, never overshooting below the RMS floor.
    /// </summary>
    public float Tick(float deltaSeconds)
    {
        if (deltaSeconds < 0f)
            throw new ArgumentOutOfRangeException(nameof(deltaSeconds),
                "deltaSeconds must be non-negative.");

        if (_rms > _weight)
        {
            _weight = _rms;
        }
        else
        {
            _weight = Math.Max(_weight - deltaSeconds / DecaySeconds, _rms);
        }

        _weight = Math.Clamp(_weight, 0f, 1f);
        return _weight;
    }
}