using System;
using System.Globalization;
using System.Text.Json;

namespace AnimaPet.Net;

/// <summary>
/// Wire names of the server-initiated event topics (Wave 0, `anima-channel`
/// `EventTopic` in `crates/anima-channel/src/wire.rs`). Clients send these
/// strings verbatim in `event.subscribe` / `event.unsubscribe` RPCs; the
/// gateway echoes the same strings on the `event` frame.
/// </summary>
public static class EventTopics
{
    /// <summary>One RMS amplitude sample for a speaking actor (~15–40 Hz).</summary>
    public const string LipSyncRms = "lip_sync.rms";

    /// <summary>A discrete emotion label for an actor.</summary>
    public const string EmotionTag = "emotion.tag";

    /// <summary>One streamed assistant token (or the final marker) for a turn.</summary>
    public const string TokenDelta = "token.delta";

    /// <summary>A presence/connectivity transition.</summary>
    public const string PresenceChanged = "presence.changed";

    /// <summary>Coarse, secret-free core health change.</summary>
    public const string StatusChanged = "status.changed";

    /// <summary>
    /// Topics the pet renderer needs. Kept here so <c>DaemonClient</c> and the
    /// entry scene agree on one list; callers may subscribe to a superset.
    /// </summary>
    public static readonly string[] PetTopics =
    {
        LipSyncRms,
        EmotionTag,
        PresenceChanged,
        StatusChanged,
    };

    /// <summary>True when <paramref name="topic"/> is one of the five known names.</summary>
    public static bool IsKnown(string topic) =>
        topic is LipSyncRms or EmotionTag or TokenDelta or PresenceChanged or StatusChanged;
}

/// <summary>Broad class of an <c>emotion.tag</c> cue (wire `CueKind`).</summary>
public enum CueKind
{
    /// <summary>Facial expression / emotion key (the common case).</summary>
    Emotion,

    /// <summary>Body motion cue — not a facial morph.</summary>
    Motion,

    /// <summary>Visual effect cue — not a facial morph.</summary>
    Vfx,
}

/// <summary>
/// Typed payload of a <c>lip_sync.rms</c> event (`LipSyncRmsData`).
/// Note the wire field is <c>level</c>, not <c>rms</c>.
/// </summary>
public readonly record struct LipSyncRmsData(
    string ActorId,
    float Level,
    ulong Seq,
    ulong TsMs);

/// <summary>
/// Typed payload of an <c>emotion.tag</c> event (`EmotionTagData`).
/// </summary>
public readonly record struct EmotionTagData(
    string ActorId,
    string Tag,
    CueKind Kind,
    float Intensity,
    ulong? DurationMs,
    ulong Seq,
    ulong TsMs);

/// <summary>Typed payload of a <c>presence.changed</c> event.</summary>
public readonly record struct PresenceChangedData(
    string Subject,
    string State,
    ulong Seq,
    ulong TsMs);

/// <summary>Typed payload of a <c>status.changed</c> event.</summary>
public readonly record struct StatusChangedData(
    bool CoreAvailable,
    bool StoreAvailable,
    string StoreHealth,
    ulong Seq,
    ulong TsMs);

/// <summary>
/// Typed payload of a <c>token.delta</c> event. The pet renderer does not
/// consume tokens, but the client decodes the topic so the connection tolerates
/// it rather than dropping the frame.
/// </summary>
public readonly record struct TokenDeltaData(
    string SessionId,
    string MessageId,
    string Delta,
    ulong Index,
    bool Final,
    ulong Seq,
    ulong TsMs);

/// <summary>
/// Dispatches decoded event payloads. Every method is optional — implement only
/// the events you care about and leave the rest as no-ops.
/// </summary>
public interface IDaemonEventSink
{
    /// <summary>A <c>lip_sync.rms</c> sample arrived.</summary>
    void OnLipSync(LipSyncRmsData data) { }

    /// <summary>An <c>emotion.tag</c> cue arrived.</summary>
    void OnEmotion(EmotionTagData data) { }

    /// <summary>A <c>presence.changed</c> transition arrived.</summary>
    void OnPresence(PresenceChangedData data) { }

    /// <summary>A <c>status.changed</c> health update arrived.</summary>
    void OnStatus(StatusChangedData data) { }

    /// <summary>A <c>token.delta</c> streamed token arrived (renderer ignores).</summary>
    void OnToken(TokenDeltaData data) { }
}

/// <summary>
/// Raised for every successfully decoded event, after the sink callback. Carries
/// the raw topic plus the parsed payload object so subscribers that only want a
/// subset can filter without re-parsing.
/// </summary>
public sealed class DaemonEventArgs : EventArgs
{
    /// <summary>Wire topic name, e.g. <c>lip_sync.rms</c>.</summary>
    public string Topic { get; }

    /// <summary>Decoded payload (one of the typed records above).</summary>
    public object? Data { get; }

    /// <summary>Optional producer correlation id, echoed verbatim from the wire.</summary>
    public JsonElement? Id { get; }

    public DaemonEventArgs(string topic, object? data, JsonElement? id)
    {
        Topic = topic;
        Data = data;
        Id = id;
    }
}