using System;
using System.Globalization;
using System.Text.Json;

namespace AnimaPet.Net;

/// <summary>
/// Decodes the <c>data</c> object of an <c>event</c> frame into the typed
/// payload records declared in <see cref="LipSyncRmsData"/> etc.
///
/// The shapes mirror the Rust-canonical `EventPayload` variants in
/// `crates/anima-channel/src/wire.rs` exactly (field names included):
/// <list type="bullet">
///   <item><c>lip_sync.rms</c>  → <c>{actor_id, level, seq, ts_ms}</c></item>
///   <item><c>emotion.tag</c>   → <c>{actor_id, tag, kind, intensity, duration_ms?, seq, ts_ms}</c></item>
///   <item><c>presence.changed</c> → <c>{subject, state, seq, ts_ms}</c></item>
///   <item><c>status.changed</c> → <c>{coreAvailable, storeAvailable, storeHealth, seq, ts_ms}</c></item>
///   <item><c>token.delta</c>   → <c>{session_id, message_id, delta, index, final, seq, ts_ms}</c></item>
/// </list>
///
/// D5 (`docs/decision-client-bindings.md`) makes this a hand-written thin codec
/// validated against Rust-generated golden fixtures; unknown/absent fields
/// degrade to defaults so a new optional wire field never crashes the pet.
/// </summary>
internal static class EventPayloadDecoder
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>Decode <paramref name="dataElement"/> for the given topic.</summary>
    /// <returns>The typed payload, or <c>null</c> if <paramref name="topic"/> is unknown.</returns>
    public static object? Decode(string topic, JsonElement dataElement)
    {
        if (dataElement.ValueKind != JsonValueKind.Object)
            return null;

        return topic switch
        {
            EventTopics.LipSyncRms => DecodeLipSync(dataElement),
            EventTopics.EmotionTag => DecodeEmotion(dataElement),
            EventTopics.PresenceChanged => DecodePresence(dataElement),
            EventTopics.StatusChanged => DecodeStatus(dataElement),
            EventTopics.TokenDelta => DecodeToken(dataElement),
            _ => null,
        };
    }

    private static LipSyncRmsData DecodeLipSync(JsonElement e) => new(
        ActorId: Str(e, "actor_id"),
        Level: Num(e, "level"),
        Seq: UInt(e, "seq"),
        TsMs: UInt(e, "ts_ms"));

    private static EmotionTagData DecodeEmotion(JsonElement e)
    {
        var kind = Str(e, "kind")?.ToLowerInvariant() switch
        {
            "motion" => CueKind.Motion,
            "vfx" => CueKind.Vfx,
            _ => CueKind.Emotion,
        };
        ulong? duration = e.TryGetProperty("duration_ms", out var d) &&
                          d.ValueKind == JsonValueKind.Number
            ? d.GetUInt64()
            : null;
        return new EmotionTagData(
            ActorId: Str(e, "actor_id"),
            Tag: Str(e, "tag"),
            Kind: kind,
            Intensity: Num(e, "intensity"),
            DurationMs: duration,
            Seq: UInt(e, "seq"),
            TsMs: UInt(e, "ts_ms"));
    }

    private static PresenceChangedData DecodePresence(JsonElement e) => new(
        Subject: Str(e, "subject"),
        State: Str(e, "state"),
        Seq: UInt(e, "seq"),
        TsMs: UInt(e, "ts_ms"));

    private static StatusChangedData DecodeStatus(JsonElement e) => new(
        CoreAvailable: Bool(e, "coreAvailable"),
        StoreAvailable: Bool(e, "storeAvailable"),
        StoreHealth: Str(e, "storeHealth"),
        Seq: UInt(e, "seq"),
        TsMs: UInt(e, "ts_ms"));

    private static TokenDeltaData DecodeToken(JsonElement e) => new(
        SessionId: Str(e, "session_id"),
        MessageId: Str(e, "message_id"),
        Delta: Str(e, "delta"),
        Index: UInt(e, "index"),
        Final: Bool(e, "final"),
        Seq: UInt(e, "seq"),
        TsMs: UInt(e, "ts_ms"));

    private static string Str(JsonElement e, string name)
    {
        if (e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
            return v.GetString() ?? string.Empty;
        return string.Empty;
    }

    private static float Num(JsonElement e, string name)
    {
        if (e.TryGetProperty(name, out var v))
        {
            switch (v.ValueKind)
            {
                case JsonValueKind.Number:
                    return v.TryGetSingle(out var f) ? f : 0f;
                case JsonValueKind.String:
                    return float.TryParse(v.GetString(), NumberStyles.Float,
                        CultureInfo.InvariantCulture, out var parsed) ? parsed : 0f;
                default:
                    return 0f;
            }
        }
        return 0f;
    }

    private static ulong UInt(JsonElement e, string name)
    {
        if (e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number)
            return v.TryGetUInt64(out var u) ? u : 0UL;
        return 0UL;
    }

    private static bool Bool(JsonElement e, string name)
    {
        if (e.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False)
            return v.GetBoolean();
        return false;
    }
}