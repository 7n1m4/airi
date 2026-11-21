// SPDX-License-Identifier: GPL-3.0-or-later

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Xunit;
using AnimaPet.Net;

namespace AnimaConformanceTests;

/// <summary>
/// C# conformance test (airi-wxp.2.8): reads golden JSON fixtures from
/// <c>crates/anima-channel/fixtures/golden/</c> and validates the
/// hand-written C# wire codec (<see cref="EventPayloadDecoder"/>) against
/// them. Each event fixture is a <c>GatewayServerFrame</c> JSON with
/// <c>type=event</c>, <c>topic</c>, and <c>data</c>; the decoder must
/// round-trip <c>data</c> into the matching typed record.
///
/// This is the C# leg of the three-job conformance CI.
/// </summary>
public sealed class GoldenFixtureConformanceTests
{
    private static string GoldenDir()
    {
        // The csproj copies fixtures/golden/**/*.json to the output dir
        // under a "golden/" subfolder.
        var dir = Path.Combine(AppContext.BaseDirectory, "golden");
        if (Directory.Exists(dir)) return dir;
        // Fallback: walk up from the test assembly to find the source dir.
        var probe = AppContext.BaseDirectory;
        while (probe != null && Directory.Exists(probe))
        {
            var candidate = Path.Combine(probe, "crates", "anima-channel", "fixtures", "golden");
            if (Directory.Exists(candidate)) return candidate;
            probe = Directory.GetParent(probe)?.FullName;
        }
        Assert.Fail($"golden fixtures directory not found (looked in {dir} and ancestors)");
        return string.Empty; // unreachable
    }

    private static JsonElement LoadFixture(string name)
    {
        var path = Path.Combine(GoldenDir(), name + ".json");
        Assert.True(File.Exists(path), $"fixture not found: {path}");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        return doc.RootElement.Clone();
    }

    /// <summary>Extract the <c>data</c> object from an event frame fixture.</summary>
    private static JsonElement LoadEventData(string name)
    {
        var root = LoadFixture(name);
        Assert.Equal("event", root.GetProperty("type").GetString());
        Assert.True(root.TryGetProperty("data", out var data),
            $"{name}: missing 'data' property");
        return data;
    }

    // ----------------------------------------------------------------
    // Event payload round-trip tests
    // ----------------------------------------------------------------

    [Theory]
    [InlineData("event.lip_sync_rms.silence", EventTopics.LipSyncRms)]
    [InlineData("event.lip_sync_rms.basic", EventTopics.LipSyncRms)]
    [InlineData("event.lip_sync_rms.peak", EventTopics.LipSyncRms)]
    public void LipSyncRms_RoundTrips(string fixture, string topic)
    {
        var data = LoadEventData(fixture);
        var decoded = Assert.IsType<LipSyncRmsData>(EventPayloadDecoder.Decode(topic, data));

        Assert.Equal(data.GetProperty("actor_id").GetString(), decoded.ActorId);
        Assert.Equal(data.GetProperty("level").GetSingle(), decoded.Level);
        Assert.Equal(data.GetProperty("seq").GetUInt64(), decoded.Seq);
        Assert.Equal(data.GetProperty("ts_ms").GetUInt64(), decoded.TsMs);
    }

    [Theory]
    [InlineData("event.emotion_tag.emotion", "happy", CueKind.Emotion)]
    [InlineData("event.emotion_tag.motion_no_duration", "wave", CueKind.Motion)]
    [InlineData("event.emotion_tag.vfx", "sparkle", CueKind.Vfx)]
    public void EmotionTag_RoundTrips(string fixture, string expectedTag, CueKind expectedKind)
    {
        var data = LoadEventData(fixture);
        var decoded = Assert.IsType<EmotionTagData>(EventPayloadDecoder.Decode(EventTopics.EmotionTag, data));

        Assert.Equal(data.GetProperty("actor_id").GetString(), decoded.ActorId);
        Assert.Equal(expectedTag, decoded.Tag);
        Assert.Equal(expectedKind, decoded.Kind);
        Assert.Equal(data.GetProperty("intensity").GetSingle(), decoded.Intensity, precision: 4);
        Assert.Equal(data.GetProperty("seq").GetUInt64(), decoded.Seq);
        Assert.Equal(data.GetProperty("ts_ms").GetUInt64(), decoded.TsMs);
    }

    [Fact]
    public void EmotionTag_WithDuration_RoundTrips()
    {
        var data = LoadEventData("event.emotion_tag.emotion");
        var decoded = Assert.IsType<EmotionTagData>(EventPayloadDecoder.Decode(EventTopics.EmotionTag, data));
        Assert.Equal(3000UL, decoded.DurationMs);
    }

    [Fact]
    public void EmotionTag_WithoutDuration_HasNull()
    {
        var data = LoadEventData("event.emotion_tag.motion_no_duration");
        var decoded = Assert.IsType<EmotionTagData>(EventPayloadDecoder.Decode(EventTopics.EmotionTag, data));
        Assert.Null(decoded.DurationMs);
    }

    [Theory]
    [InlineData("event.token_delta.partial", "Hello", false)]
    [InlineData("event.token_delta.final", " world", true)]
    public void TokenDelta_RoundTrips(string fixture, string expectedDelta, bool expectedFinal)
    {
        var data = LoadEventData(fixture);
        var decoded = Assert.IsType<TokenDeltaData>(EventPayloadDecoder.Decode(EventTopics.TokenDelta, data));

        Assert.Equal(data.GetProperty("session_id").GetString(), decoded.SessionId);
        Assert.Equal(data.GetProperty("message_id").GetString(), decoded.MessageId);
        Assert.Equal(expectedDelta, decoded.Delta);
        Assert.Equal(data.GetProperty("index").GetUInt64(), decoded.Index);
        Assert.Equal(expectedFinal, decoded.Final);
        Assert.Equal(data.GetProperty("seq").GetUInt64(), decoded.Seq);
        Assert.Equal(data.GetProperty("ts_ms").GetUInt64(), decoded.TsMs);
    }

    [Theory]
    [InlineData("event.presence_changed.online", "online")]
    [InlineData("event.presence_changed.offline", "offline")]
    public void PresenceChanged_RoundTrips(string fixture, string expectedState)
    {
        var data = LoadEventData(fixture);
        var decoded = Assert.IsType<PresenceChangedData>(EventPayloadDecoder.Decode(EventTopics.PresenceChanged, data));

        Assert.Equal(data.GetProperty("subject").GetString(), decoded.Subject);
        Assert.Equal(expectedState, decoded.State);
        Assert.Equal(data.GetProperty("seq").GetUInt64(), decoded.Seq);
        Assert.Equal(data.GetProperty("ts_ms").GetUInt64(), decoded.TsMs);
    }

    [Theory]
    [InlineData("event.status_changed.healthy", true, true, "ok")]
    [InlineData("event.status_changed.unhealthy", false, false, "unavailable")]
    public void StatusChanged_RoundTrips(string fixture, bool expectedCore, bool expectedStore, string expectedHealth)
    {
        var data = LoadEventData(fixture);
        var decoded = Assert.IsType<StatusChangedData>(EventPayloadDecoder.Decode(EventTopics.StatusChanged, data));

        Assert.Equal(expectedCore, decoded.CoreAvailable);
        Assert.Equal(expectedStore, decoded.StoreAvailable);
        Assert.Equal(expectedHealth, decoded.StoreHealth);
        Assert.Equal(data.GetProperty("seq").GetUInt64(), decoded.Seq);
        Assert.Equal(data.GetProperty("ts_ms").GetUInt64(), decoded.TsMs);
    }

    // ----------------------------------------------------------------
    // Event topic string validation
    // ----------------------------------------------------------------

    [Theory]
    [InlineData("event.lip_sync_rms.silence", "lip_sync.rms")]
    [InlineData("event.emotion_tag.emotion", "emotion.tag")]
    [InlineData("event.token_delta.partial", "token.delta")]
    [InlineData("event.presence_changed.online", "presence.changed")]
    [InlineData("event.status_changed.healthy", "status.changed")]
    public void EventFrame_HasCorrectTopic(string fixture, string expectedTopic)
    {
        var root = LoadFixture(fixture);
        Assert.Equal("event", root.GetProperty("type").GetString());
        Assert.Equal(expectedTopic, root.GetProperty("topic").GetString());
    }

    // ----------------------------------------------------------------
    // Cross-cutting: all golden fixtures are valid JSON objects
    // ----------------------------------------------------------------

    [Fact]
    public void AllGoldenFixtures_AreValidJsonObjects()
    {
        var dir = GoldenDir();
        var files = Directory.EnumerateFiles(dir, "*.json");
        var count = 0;
        foreach (var path in files)
        {
            var text = File.ReadAllText(path);
            using var doc = JsonDocument.Parse(text);
            Assert.Equal(JsonValueKind.Object, doc.RootElement.ValueKind);
            count++;
        }
        Assert.True(count > 0, "no golden fixtures found");
    }
}