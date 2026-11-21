using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Xunit;
using AnimaPet.Net;

namespace AnimaPet.Tests;

/// <summary>
/// Golden-fixture tests for <see cref="EventPayloadDecoder"/> (D5,
/// <c>docs/decision-client-bindings.md</c>). Each fixture in
/// <c>fixtures/</c> is a JSON object shaped from the Rust-canonical
/// <c>EventPayload</c> variant in <c>crates/anima-channel/src/wire.rs</c>;
/// the decoder must round-trip it into the matching typed record without
/// throwing and with every field preserved.
///
/// These fixtures are hand-authored from the wire shapes (the Rust golden
/// fixtures from airi-wxp.2.8 do not exist yet). When the Rust side lands
/// its fixtures, regenerate these to match.
/// </summary>
public sealed class EventPayloadDecoderTests
{
    private static readonly JsonSerializerOptions PrettyWriter = new() { WriteIndented = true };

    private static string FixtureDir()
    {
        // AppContext.BaseDirectory points at the test bin output dir; the
        // fixtures are copied there by the csproj <None Include> rule.
        var dir = Path.Combine(AppContext.BaseDirectory, "fixtures");
        Assert.True(Directory.Exists(dir), $"fixtures directory not found: {dir}");
        return dir;
    }

    private static JsonElement LoadFixture(string name)
    {
        var path = Path.Combine(FixtureDir(), name + ".json");
        Assert.True(File.Exists(path), $"fixture not found: {path}");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        return doc.RootElement.Clone();
    }

    private static object? DecodeFixture(string name, string topic)
    {
        var data = LoadFixture(name);
        Assert.Equal(JsonValueKind.Object, data.ValueKind);
        return EventPayloadDecoder.Decode(topic, data);
    }

    [Theory]
    [InlineData("lip_sync_rms.silence", EventTopics.LipSyncRms)]
    [InlineData("lip_sync_rms.basic", EventTopics.LipSyncRms)]
    [InlineData("lip_sync_rms.peak", EventTopics.LipSyncRms)]
    public void LipSyncRms_RoundTrips(string fixture, string topic)
    {
        var decoded = Assert.IsType<LipSyncRmsData>(DecodeFixture(fixture, topic));
        var src = LoadFixture(fixture);

        Assert.Equal(src.GetProperty("actor_id").GetString(), decoded.ActorId);
        Assert.Equal(src.GetProperty("level").GetSingle(), decoded.Level);
        Assert.Equal(src.GetProperty("seq").GetUInt64(), decoded.Seq);
        Assert.Equal(src.GetProperty("ts_ms").GetUInt64(), decoded.TsMs);
    }

    [Fact]
    public void EmotionTag_Emotion_WithDuration_RoundTrips()
    {
        var decoded = Assert.IsType<EmotionTagData>(
            DecodeFixture("emotion_tag.emotion", EventTopics.EmotionTag));
        var src = LoadFixture("emotion_tag.emotion");

        Assert.Equal("character-7", decoded.ActorId);
        Assert.Equal("happy", decoded.Tag);
        Assert.Equal(CueKind.Emotion, decoded.Kind);
        Assert.Equal(0.8f, decoded.Intensity, precision: 4);
        Assert.Equal(3000UL, decoded.DurationMs);
        Assert.Equal(42UL, decoded.Seq);
        Assert.Equal(1700000000200UL, decoded.TsMs);
    }

    [Fact]
    public void EmotionTag_Motion_WithoutDuration_RoundTrips()
    {
        var decoded = Assert.IsType<EmotionTagData>(
            DecodeFixture("emotion_tag.motion_no_duration", EventTopics.EmotionTag));
        var src = LoadFixture("emotion_tag.motion_no_duration");

        Assert.Equal("character-7", decoded.ActorId);
        Assert.Equal("wave", decoded.Tag);
        Assert.Equal(CueKind.Motion, decoded.Kind);
        Assert.Equal(0.6f, decoded.Intensity, precision: 4);
        Assert.Null(decoded.DurationMs);
        Assert.Equal(43UL, decoded.Seq);
    }

    [Fact]
    public void EmotionTag_Vfx_RoundTrips()
    {
        var decoded = Assert.IsType<EmotionTagData>(
            DecodeFixture("emotion_tag.vfx", EventTopics.EmotionTag));
        Assert.Equal(CueKind.Vfx, decoded.Kind);
        Assert.Equal("sparkle", decoded.Tag);
        Assert.Equal(1.0f, decoded.Intensity, precision: 4);
        Assert.Equal(1500UL, decoded.DurationMs);
    }

    [Theory]
    [InlineData("presence_changed.online", "online")]
    [InlineData("presence_changed.offline", "offline")]
    public void PresenceChanged_RoundTrips(string fixture, string expectedState)
    {
        var decoded = Assert.IsType<PresenceChangedData>(
            DecodeFixture(fixture, EventTopics.PresenceChanged));
        var src = LoadFixture(fixture);

        Assert.Equal("user-42", decoded.Subject);
        Assert.Equal(expectedState, decoded.State);
        Assert.Equal(src.GetProperty("seq").GetUInt64(), decoded.Seq);
        Assert.Equal(src.GetProperty("ts_ms").GetUInt64(), decoded.TsMs);
    }

    [Fact]
    public void StatusChanged_Healthy_RoundTrips()
    {
        var decoded = Assert.IsType<StatusChangedData>(
            DecodeFixture("status_changed.healthy", EventTopics.StatusChanged));
        var src = LoadFixture("status_changed.healthy");

        Assert.True(decoded.CoreAvailable);
        Assert.True(decoded.StoreAvailable);
        Assert.Equal("ok", decoded.StoreHealth);
        Assert.Equal(src.GetProperty("seq").GetUInt64(), decoded.Seq);
        Assert.Equal(src.GetProperty("ts_ms").GetUInt64(), decoded.TsMs);
    }

    [Fact]
    public void StatusChanged_Unhealthy_RoundTrips()
    {
        var decoded = Assert.IsType<StatusChangedData>(
            DecodeFixture("status_changed.unhealthy", EventTopics.StatusChanged));
        Assert.False(decoded.CoreAvailable);
        Assert.False(decoded.StoreAvailable);
        Assert.Equal("unavailable", decoded.StoreHealth);
    }

    [Theory]
    [InlineData("token_delta.partial")]
    [InlineData("token_delta.final")]
    public void TokenDelta_RoundTrips(string fixture)
    {
        var decoded = Assert.IsType<TokenDeltaData>(
            DecodeFixture(fixture, EventTopics.TokenDelta));
        var src = LoadFixture(fixture);

        Assert.Equal(src.GetProperty("session_id").GetString(), decoded.SessionId);
        Assert.Equal(src.GetProperty("message_id").GetString(), decoded.MessageId);
        Assert.Equal(src.GetProperty("delta").GetString(), decoded.Delta);
        Assert.Equal(src.GetProperty("index").GetUInt64(), decoded.Index);
        Assert.Equal(src.GetProperty("final").GetBoolean(), decoded.Final);
        Assert.Equal(src.GetProperty("seq").GetUInt64(), decoded.Seq);
        Assert.Equal(src.GetProperty("ts_ms").GetUInt64(), decoded.TsMs);
    }

    [Fact]
    public void UnknownTopic_ReturnsNull()
    {
        var data = JsonDocument.Parse("{}").RootElement;
        Assert.Null(EventPayloadDecoder.Decode("does.not.exist", data));
    }

    [Fact]
    public void NonObjectData_ReturnsNull()
    {
        var data = JsonDocument.Parse("[1,2,3]").RootElement;
        Assert.Null(EventPayloadDecoder.Decode(EventTopics.LipSyncRms, data));
    }

    [Fact]
    public void MissingFields_DegradeToDefaults()
    {
        // A frame missing optional/required fields must not throw; fields
        // absent from the wire degrade to defaults so a new field never
        // crashes the pet.
        var data = JsonDocument.Parse("{}").RootElement;
        var decoded = Assert.IsType<LipSyncRmsData>(
            EventPayloadDecoder.Decode(EventTopics.LipSyncRms, data));
        Assert.Equal(string.Empty, decoded.ActorId);
        Assert.Equal(0f, decoded.Level);
        Assert.Equal(0UL, decoded.Seq);
    }

    [Fact]
    public void UnknownEmotionKind_DegradesToEmotion()
    {
        var data = JsonDocument.Parse(
            """{"actor_id":"a","tag":"t","kind":"future-kind","intensity":0.5}""")
            .RootElement;
        var decoded = Assert.IsType<EmotionTagData>(
            EventPayloadDecoder.Decode(EventTopics.EmotionTag, data));
        Assert.Equal(CueKind.Emotion, decoded.Kind);
    }

    [Fact]
    public void StringLevel_IsParsedAsFloat()
    {
        // Defensive: some producers may send numeric strings.
        var data = JsonDocument.Parse(
            """{"actor_id":"a","level":"0.5","seq":1,"ts_ms":2}""")
            .RootElement;
        var decoded = Assert.IsType<LipSyncRmsData>(
            EventPayloadDecoder.Decode(EventTopics.LipSyncRms, data));
        Assert.Equal(0.5f, decoded.Level, precision: 4);
    }

    [Fact]
    public void EveryFixture_IsValidJson()
    {
        foreach (var path in Directory.EnumerateFiles(FixtureDir(), "*.json"))
        {
            var json = File.ReadAllText(path);
            using var doc = JsonDocument.Parse(json);
            Assert.Equal(JsonValueKind.Object, doc.RootElement.ValueKind);
        }
    }
}