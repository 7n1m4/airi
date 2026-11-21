using System;
using System.Threading;
using System.Threading.Tasks;

namespace AnimaPet.Net;

/// <summary>Lifecycle states for the future daemon connection.</summary>
public enum DaemonConnectionState
{
    Disconnected,
    Connecting,
    Authenticated,
    Subscribed,
    Failed,
}

/// <summary>
/// Thin C# WS client skeleton for the Rust daemon gateway.
///
/// DESIGN CONTRACT (docs/design-flutter-godot-pivot.md decisions 1, 2, 9):
/// <list type="bullet">
///   <item>Endpoint today is <c>ws://127.0.0.1:6121</c>, loopback by default;
///     the daemon may force <c>wss://</c> with a locally minted CA beyond loopback.</item>
///   <item>The daemon is the single owner of state. This client holds view state
///     only; all writes go through the existing RPC request/reply family.</item>
///   <item>Events flow one way: daemon -&gt; clients. A client opts in with an
///     explicit subscribe RPC. There must be no client-to-client dependency.</item>
///   <item>Transport stays JSON text frames over the existing WS; no MessagePack
///     or UDS (parked by decisions 9 and design-daemon-gateway.md).</item>
/// </list>
///
/// TODO(Wave 0): every protocol-dependent operation below is deliberately a
/// stub. The server-to-client event lane and its typed vocabulary are being
/// added in crates/anima-channel by a different work stream. Do NOT guess the
/// auth frame, subscribe verb, or event envelope here; replace these stubs with
/// generated bindings once they land, and add the matching drift check.
/// </summary>
public sealed class DaemonClient
{
    /// <summary>Loopback gateway port adopted from the existing daemon config.</summary>
    public const string DefaultEndpoint = "ws://127.0.0.1:6121";

    private readonly string _endpoint;

    /// <summary>Current connection state. View state only; never persisted.</summary>
    public DaemonConnectionState State { get; private set; } = DaemonConnectionState.Disconnected;

    public DaemonClient(string endpoint = DefaultEndpoint)
    {
        _endpoint = endpoint;
    }

    /// <summary>
    /// TODO(Wave 0) — authentication handshake.
    /// Open the WS at <see cref="_endpoint"/>, then send the first-message auth
    /// frame using the token obtained from the daemon's local config/control
    /// plane. A failed auth must close the socket (1008) and set
    /// <see cref="DaemonConnectionState.Failed"/>; never retry with a guessed
    /// frame shape. Token acquisition and TLS trust path are also Wave-0 work.
    /// </summary>
    public Task ConnectAsync(CancellationToken cancellationToken = default) =>
        throw new NotImplementedException(
            "Daemon WS auth handshake is pending Wave 0 event-lane bindings. "
            + "Do not hand-write the frame shape.");

    /// <summary>
    /// TODO(Wave 0) — subscribe RPC.
    /// Opt in per subject (character/actor id) after authentication. Default is
    /// no events, so unsubscribed sessions are unaffected. Only event kinds
    /// defined by the Wave-0 vocabulary may be requested.
    /// </summary>
    public Task SubscribeAsync(CancellationToken cancellationToken = default) =>
        throw new NotImplementedException(
            "Daemon subscribe RPC is pending Wave 0 event-lane bindings. "
            + "No event vocabulary is hard-coded in this spike.");

    /// <summary>
    /// TODO(Wave 0) — raw event dispatch seam.
    /// The string is an opaque, verbatim event payload; this spike does not
    /// parse it. Once generated bindings land, decode here and dispatch typed
    /// callbacks (<c>lip_sync.rms</c>, <c>emotion.tag</c>, ...) to the active
    /// <c>IPetRenderer</c>. High-rate events are coalesced/drop-oldest by the
    /// daemon; do not buffer them unboundedly on the client.
    /// </summary>
    public event Action<string>? RawEventReceived;

    /// <summary>TODO(Wave 0) — graceful close and state reset.</summary>
    public Task DisconnectAsync(CancellationToken cancellationToken = default) =>
        throw new NotImplementedException(
            "Daemon WS disconnect is pending Wave 0 event-lane bindings.");
}
