using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace AnimaPet.Net;

/// <summary>Lifecycle states for the daemon connection.</summary>
public enum DaemonConnectionState
{
    Disconnected,
    Connecting,
    Authenticated,
    Subscribed,
    Failed,
}

/// <summary>
/// Thin C# WS client for the Rust daemon gateway (<c>crates/anima-channel</c>).
///
/// DESIGN CONTRACT (docs/design-flutter-godot-pivot.md decisions 1, 2, 9;
/// docs/design-daemon-gateway.md threat model):
/// <list type="bullet">
///   <item>Endpoint today is <c>ws://127.0.0.1:6121</c>, loopback by default;
///     the daemon may force <c>wss://</c> with a locally minted CA beyond loopback.</item>
///   <item>The daemon is the single owner of state. This client holds view state
///     only; all writes go through the existing RPC request/reply family.</item>
///   <item>Events flow one way: daemon -&gt; clients. A client opts in with an
///     explicit <c>event.subscribe</c> RPC. There must be no client-to-client dependency.</item>
///   <item>Transport stays JSON text frames over the existing WS; no MessagePack
///     or UDS (parked by decisions 9 and design-daemon-gateway.md).</item>
/// </list>
///
/// <para>
/// Auth handshake (verified against <c>crates/anima-channel/src/session.rs</c>):
/// the first message must be <c>{"type":"auth","authToken":"&lt;token&gt;"}</c>;
/// the daemon replies <c>{"type":"auth","ok":true}</c> on success, or sends a
/// typed <c>error</c> frame + close 1008 on failure. The token is read from
/// the daemon-owned config at
/// <c>&lt;data-dir&gt;/airi-slint/server-channel/config.json</c>
/// (<c>anima-channel/src/config.rs</c>), overridable via
/// <c>AIRI_SERVER_CHANNEL_CONFIG</c>.
/// </para>
/// <para>
/// Event subscription: after auth, the client sends
/// <c>{"type":"rpc","action":"event.subscribe","payload":{"topics":["lip_sync.rms",…]}}</c>;
/// the daemon replies with an <c>event.subscribe</c> RPC result carrying the
/// resulting topic set, then pushes <c>{"type":"event","topic":…,"data":…}</c>
/// frames. See <c>EventTopics.PetTopics</c> for the pet's subscription set.
/// </para>
/// </summary>
public sealed class DaemonClient : IDisposable
{
    /// <summary>Loopback gateway port adopted from the existing daemon config.</summary>
    public const string DefaultEndpoint = "ws://127.0.0.1:6121";

    private const string AuthAction = "auth";
    private const string EventSubscribeAction = "event.subscribe";
    private const string EventUnsubscribeAction = "event.unsubscribe";
    private const string RpcType = "rpc";
    private const string EventType = "event";
    private const string ErrorType = "error";

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly string _endpoint;
    private readonly string _authToken;
    private readonly Lazy<ClientWebSocket> _socket;
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    /// <summary>Current connection state. View state only; never persisted.</summary>
    public DaemonConnectionState State { get; private set; } =
        DaemonConnectionState.Disconnected;

    /// <summary>
    /// Last error observed (e.g. auth rejection, socket failure). Never carries
    /// credentials; safe to log.
    /// </summary>
    public string? LastError { get; private set; }

    /// <summary>
    /// Daemon-resolved endpoint. Default <see cref="DefaultEndpoint"/>; override
    /// for non-loopback (wss) deployments. The daemon reports the active
    /// ws/wss flag via <c>GetGatewayConfig</c>; callers that need it should pass
    /// the resolved URL here rather than hard-coding.
    /// </summary>
    public string Endpoint => _endpoint;

    /// <summary>
    /// Raised for every successfully decoded event. Carries the raw topic plus
    /// the typed payload (one of the <c>*Data</c> records). Subscribers that
    /// only want a subset can filter on <see cref="DaemonEventArgs.Topic"/>.
    /// </summary>
    public event EventHandler<DaemonEventArgs>? EventReceived;

    /// <summary>Raised when <see cref="State"/> changes.</summary>
    public event EventHandler<DaemonConnectionState>? StateChanged;

    /// <param name="authToken">
    /// Shared gateway auth token. When <c>null</c>, the client reads it from
    /// the daemon-owned <c>server-channel/config.json</c> (same path the
    /// daemon uses; see <see cref="LoadTokenFromDaemonConfig"/>).
    /// </param>
    /// <param name="endpoint">
    /// WS URL. Default <see cref="DefaultEndpoint"/>; pass <c>wss://…</c> for
    /// non-loopback.
    /// </param>
    public DaemonClient(string? authToken = null, string endpoint = DefaultEndpoint)
    {
        _endpoint = endpoint ?? throw new ArgumentNullException(nameof(endpoint));
        _authToken = authToken ?? LoadTokenFromDaemonConfig();
        _socket = new Lazy<ClientWebSocket>(CreateSocket);
    }

    private static ClientWebSocket CreateSocket() => new();

    private ClientWebSocket Socket => _socket.Value;

    /// <summary>
    /// Open the WS at <see cref="Endpoint"/>, send the auth frame, and wait
    /// for the auth reply. Sets <see cref="State"/> to
    /// <see cref="DaemonConnectionState.Authenticated"/> on success, or
    /// <see cref="DaemonConnectionState.Failed"/> on any error (auth rejection,
    /// socket failure). Never retries — the caller decides whether to reconnect.
    /// </summary>
    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (State is DaemonConnectionState.Authenticated or DaemonConnectionState.Subscribed)
            return;

        SetState(DaemonConnectionState.Connecting);
        try
        {
            await Socket.ConnectAsync(new Uri(_endpoint), cancellationToken)
                .ConfigureAwait(false);

            // First message MUST be auth (session.rs handle_auth).
            var authFrame = new
            {
                type = AuthAction,
                authToken = _authToken,
            };
            await SendJsonAsync(authFrame, cancellationToken).ConfigureAwait(false);

            var reply = await ReceiveJsonAsync(cancellationToken).ConfigureAwait(false);
            if (reply.ValueKind != JsonValueKind.Object)
                throw new InvalidOperationException("auth reply was not a JSON object");

            var type = reply.GetProperty("type").GetString();
            var ok = reply.TryGetProperty("ok", out var okEl) && okEl.ValueKind == JsonValueKind.True;
            if (type == AuthAction && ok)
            {
                SetState(DaemonConnectionState.Authenticated);
                return;
            }

            // Auth failed — surface the daemon's error frame if present.
            var reason = TryGetErrorMessage(reply) ?? "authentication rejected";
            LastError = reason;
            SetState(DaemonConnectionState.Failed);
            throw new InvalidOperationException($"daemon auth failed: {reason}");
        }
        catch (Exception ex)
        {
            LastError = ex.Message;
            SetState(DaemonConnectionState.Failed);
            // Best-effort close so the daemon reaps the half-open session.
            try { await Socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "auth failed", CancellationToken.None).ConfigureAwait(false); }
            catch { /* ignore */ }
            throw;
        }
    }

    /// <summary>
    /// Opt in to <paramref name="topics"/> via the <c>event.subscribe</c> RPC.
    /// Default is <see cref="DaemonConnectionState.Authenticated"/> (no events);
    /// this moves it to <see cref="DaemonConnectionState.Subscribed"/>. The
    /// daemon's reply carries the resulting topic set; the pet uses
    /// <see cref="EventTopics.PetTopics"/> so the renderer reacts to
    /// lip_sync.rms, emotion.tag, presence.changed, status.changed.
    /// </summary>
    public async Task SubscribeAsync(
        string[]? topics = null,
        CancellationToken cancellationToken = default)
    {
        if (State is not (DaemonConnectionState.Authenticated or DaemonConnectionState.Subscribed))
            throw new InvalidOperationException("not connected; call ConnectAsync first");

        topics ??= EventTopics.PetTopics;
        var payload = new { topics };
        await SendRpcAsync(EventSubscribeAction, payload, cancellationToken)
            .ConfigureAwait(false);
        SetState(DaemonConnectionState.Subscribed);
    }

    /// <summary>
    /// Opt out of <paramref name="topics"/> via the <c>event.unsubscribe</c> RPC.
    /// The pet keeps running; it just stops receiving the listed events.
    /// </summary>
    public async Task UnsubscribeAsync(
        string[] topics,
        CancellationToken cancellationToken = default)
    {
        if (State is not (DaemonConnectionState.Authenticated or DaemonConnectionState.Subscribed))
            throw new InvalidOperationException("not connected; call ConnectAsync first");

        var payload = new { topics };
        await SendRpcAsync(EventUnsubscribeAction, payload, cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Receive and decode one event frame, raise <see cref="EventReceived"/>,
    /// and return. Blocks until a frame arrives. Returns <c>false</c> when the
    /// socket is closed. Non-event frames (RPC replies, pings) are skipped —
    /// call <see cref="SubscribeAsync"/> / RPC methods from a separate flow.
    /// </summary>
    public async Task<bool> ReceiveOneAsync(CancellationToken cancellationToken = default)
    {
        var frame = await ReceiveJsonAsync(cancellationToken).ConfigureAwait(false);
        if (frame.ValueKind != JsonValueKind.Object)
            return true; // non-object frame; ignore

        var type = frame.GetProperty("type").GetString();
        if (type != EventType)
            return true; // RPC reply, pong, etc. — not an event

        var topic = frame.GetProperty("topic").GetString() ?? string.Empty;
        JsonElement data = default;
        if (frame.TryGetProperty("data", out var dataEl))
            data = dataEl;

        var decoded = EventPayloadDecoder.Decode(topic, data);
        var args = new DaemonEventArgs(topic, decoded, TryGetId(frame));
        EventReceived?.Invoke(this, args);
        return true;
    }

    /// <summary>
    /// Receive and decode events until <paramref name="cancellationToken"/> is
    /// cancelled or the socket closes. Convenience pump for Godot's
    /// <c>_Process</c> integration (call from a background task).
    /// </summary>
    public async Task PumpAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            while (State is DaemonConnectionState.Authenticated or DaemonConnectionState.Subscribed
                   && !cancellationToken.IsCancellationRequested)
            {
                if (!await ReceiveOneAsync(cancellationToken).ConfigureAwait(false))
                    break;
            }
        }
        catch (OperationCanceledException) { /* normal shutdown */ }
        catch (WebSocketException ex)
        {
            LastError = ex.Message;
            SetState(DaemonConnectionState.Disconnected);
        }
        catch (Exception ex)
        {
            LastError = ex.Message;
            SetState(DaemonConnectionState.Failed);
        }
    }

    /// <summary>Graceful close and state reset.</summary>
    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        if (State is DaemonConnectionState.Disconnected or DaemonConnectionState.Failed)
            return;

        try
        {
            if (Socket.State == WebSocketState.Open)
                await Socket.CloseAsync(
                    WebSocketCloseStatus.NormalClosure, "client shutdown", cancellationToken)
                    .ConfigureAwait(false);
        }
        finally
        {
            SetState(DaemonConnectionState.Disconnected);
        }
    }

    private async Task SendRpcAsync(
        string action,
        object? payload,
        CancellationToken cancellationToken)
    {
        var frame = new
        {
            type = RpcType,
            action,
            payload,
            id = (object?)null,
        };
        await SendJsonAsync(frame, cancellationToken).ConfigureAwait(false);

        // The subscribe/unsubscribe reply is a normal RPC reply; drain one
        // frame so a follow-up receive loop doesn't see a stale reply.
        var reply = await ReceiveJsonAsync(cancellationToken).ConfigureAwait(false);
        if (reply.ValueKind == JsonValueKind.Object)
        {
            var type = reply.GetProperty("type").GetString();
            if (type == ErrorType)
            {
                var reason = TryGetErrorMessage(reply) ?? "rpc error";
                LastError = reason;
                SetState(DaemonConnectionState.Failed);
                throw new InvalidOperationException($"{action} failed: {reason}");
            }
            // RPC success replies (type == "rpc", ok == true) are accepted;
            // the resulting topic set is the daemon's source of truth.
        }
    }

    private async Task SendJsonAsync(object value, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(value, Json);
        var bytes = Encoding.UTF8.GetBytes(json);
        await _sendLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await Socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, cancellationToken)
                .ConfigureAwait(false);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private async Task<JsonElement> ReceiveJsonAsync(CancellationToken cancellationToken)
    {
        // Daemon frames are small (human-cadence, KBs); a single buffer
        // suffices. If a frame ever exceeds it, drain the remainder.
        var buffer = new byte[8192];
        using var ms = new System.IO.MemoryStream();
        while (true)
        {
            var result = await Socket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                await Socket.CloseAsync(WebSocketCloseStatus.NormalClosure, string.Empty, CancellationToken.None)
                    .ConfigureAwait(false);
                SetState(DaemonConnectionState.Disconnected);
                return default;
            }
            ms.Write(buffer, 0, result.Count);
            if (result.EndOfMessage)
                break;
        }

        var json = Encoding.UTF8.GetString(ms.ToArray());
        if (string.IsNullOrWhiteSpace(json))
            return default;

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static string? TryGetErrorMessage(JsonElement reply)
    {
        if (reply.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.Object)
        {
            if (err.TryGetProperty("message", out var msg) && msg.ValueKind == JsonValueKind.String)
                return msg.GetString();
            if (err.TryGetProperty("code", out var code) && code.ValueKind == JsonValueKind.String)
                return code.GetString();
        }
        return null;
    }

    private static JsonElement? TryGetId(JsonElement frame)
    {
        if (frame.TryGetProperty("id", out var id) && id.ValueKind != JsonValueKind.Null)
            return id.Clone();
        return null;
    }

    private void SetState(DaemonConnectionState next)
    {
        if (State == next)
            return;
        State = next;
        StateChanged?.Invoke(this, next);
    }

    /// <summary>
    /// Read the shared gateway auth token from the daemon-owned config at
    /// <c>&lt;data-dir&gt;/airi-slint/server-channel/config.json</c>.
    /// Honors <c>AIRI_SERVER_CHANNEL_CONFIG</c> (the daemon's override env var)
    /// and <c>XDG_DATA_HOME</c>. Mirrors <c>anima-channel/src/config.rs</c>
    /// <c>default_config_path</c>. Never logged, never sent anywhere but the
    /// daemon's first auth frame.
    /// </summary>
    public static string LoadTokenFromDaemonConfig()
    {
        var path = Environment.GetEnvironmentVariable("AIRI_SERVER_CHANNEL_CONFIG");
        if (string.IsNullOrWhiteSpace(path))
        {
            var dataHome = Environment.GetEnvironmentVariable("XDG_DATA_HOME");
            if (string.IsNullOrWhiteSpace(dataHome))
            {
                // Linux default; macOS/Windows would need their own resolution.
                var home = Environment.GetEnvironmentVariable("HOME");
                dataHome = string.IsNullOrWhiteSpace(home)
                    ? null
                    : System.IO.Path.Combine(home!, ".local", "share");
            }
            if (string.IsNullOrEmpty(dataHome))
                throw new InvalidOperationException(
                    "cannot locate daemon config: set AIRI_SERVER_CHANNEL_CONFIG or pass authToken explicitly");
            path = System.IO.Path.Combine(dataHome, "airi-slint", "server-channel", "config.json");
        }

        if (!System.IO.File.Exists(path))
            throw new FileNotFoundException(
                $"daemon config not found at {path}; pass authToken explicitly or start the daemon", path);

        var json = System.IO.File.ReadAllText(path);
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.TryGetProperty("authToken", out var tok)
            && tok.ValueKind == JsonValueKind.String)
        {
            var token = tok.GetString();
            if (!string.IsNullOrWhiteSpace(token))
                return token!;
        }
        throw new InvalidOperationException(
            $"daemon config at {path} has no authToken; pass authToken explicitly");
    }

    public void Dispose()
    {
        _sendLock.Dispose();
        if (_socket.IsValueCreated)
            Socket.Dispose();
    }
}