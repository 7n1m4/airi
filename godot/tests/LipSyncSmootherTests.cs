using System;
using Xunit;
using AnimaPet.Renderers;

namespace AnimaPet.Tests;

/// <summary>
/// Tests for <see cref="LipSyncSmoother"/> — the Godot-side port of the
/// Rust <c>anima-render</c> lip-sync smoothing
/// (<c>crates/anima-render/src/vrm/lipsync.rs</c>). Mirrors the Rust unit
/// tests so the two implementations can't drift silently.
/// </summary>
public sealed class LipSyncSmootherTests
{
    [Fact]
    public void Silence_DecaysToZero()
    {
        var l = new LipSyncSmoother();
        l.SetRms(1.0f);
        l.Tick(0.016f);
        Assert.True(l.Weight > 0.9f);

        l.SetRms(0.0f);
        for (var i = 0; i < 60; i++)
            l.Tick(0.016f);
        Assert.True(l.Weight < 0.05f);
    }

    [Fact]
    public void Attack_IsFast()
    {
        var l = new LipSyncSmoother();
        l.SetRms(0.8f);
        l.Tick(0.016f);
        Assert.True(l.Weight > 0.7f);
    }

    [Fact]
    public void Rms_IsClampedAboveOne()
    {
        var l = new LipSyncSmoother();
        l.SetRms(5.0f);
        l.Tick(0.016f); // attack applies the clamped rms on the next tick
        Assert.Equal(1.0f, l.Weight);
    }

    [Fact]
    public void Rms_IsClampedBelowZero()
    {
        var l = new LipSyncSmoother();
        l.SetRms(-1.0f);
        l.Tick(0.016f);
        Assert.Equal(0.0f, l.Weight);
    }

    [Fact]
    public void Tick_DoesNotOvershootBelowRmsFloor()
    {
        var l = new LipSyncSmoother();
        l.SetRms(0.5f);
        for (var i = 0; i < 100; i++)
            l.Tick(0.5f);
        Assert.Equal(0.5f, l.Weight);
    }
}