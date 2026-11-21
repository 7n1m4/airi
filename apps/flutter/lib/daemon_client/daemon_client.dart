// SPDX-License-Identifier: GPL-3.0-or-later

// Thin orchestration layer. The daemon is the ONLY owner of core state; this
// client holds view state (connection status, last health snapshot) and nothing
// else. See docs/design-daemon-client.md decision 1 and
// docs/design-flutter-godot-pivot.md invariant 1.

import 'dart:async';

import '../connection/connection_settings.dart';
import 'direct_websocket_transport.dart';
import 'protocol.dart';
import 'reconnect_policy.dart';
import 'rpc.dart';
import 'transport.dart';

export 'protocol.dart'
    show
        GatewayEventFrame,
        ServerFrame,
        ServerFrameKind,
        encodeAuthFrame,
        encodeModuleAuthFrame,
        kProtocolId;
export 'reconnect_policy.dart' show ReconnectPolicy;
export 'rpc.dart' show CoreStatus, RpcError, RpcReply, RpcRequest;
export 'transport.dart' show DaemonTransport, DaemonTransportFactory, TransportClosed;

enum DaemonConnectionState {
  disconnected,
  connecting,
  authenticating,
  connected,
  reconnecting,
  failed,
}

enum DaemonFailureKind {
  none,
  transport,
  auth,
  timeout,
  rpc,
  protocol,
  notConnected,
}

class DaemonClientException implements Exception {
  const DaemonClientException({
    required this.kind,
    required this.message,
    this.code,
  });

  final DaemonFailureKind kind;
  final String message;
  final String? code;

  @override
  String toString() => 'DaemonClientException(${kind.name}): $message';
}

/// Immutable view state published to the UI after every transition.
class DaemonStatus {
  const DaemonStatus({
    required this.state,
    this.core,
    this.error,
    this.host,
    this.attempt = 0,
  });

  final DaemonConnectionState state;
  final CoreStatus? core;
  final DaemonClientException? error;
  final String? host;
  final int attempt;

  bool get isConnected => state == DaemonConnectionState.connected;
}

/// Connects, authenticates, correlates RPC replies, probes `core.status`, and
/// reconnects with bounded backoff. Transports are injected so every behaviour
/// can be tested with an in-memory fake — no live daemon required.
class DaemonClient {
  DaemonClient({
    DaemonTransportFactory? transportFactory,
    this.reconnectPolicy = const ReconnectPolicy(),
    this.authTimeout = const Duration(seconds: 5),
    this.rpcTimeout = const Duration(seconds: 15),
  }) : _transportFactory = transportFactory ?? (() => DirectWebSocketTransport());

  final DaemonTransportFactory _transportFactory;
  final ReconnectPolicy reconnectPolicy;
  final Duration authTimeout;
  final Duration rpcTimeout;

  DaemonTransport? _transport;
  StreamSubscription<String>? _messageSub;
  StreamSubscription<Object>? _errorSub;
  ConnectionSettings? _settings;
  Timer? _reconnectTimer;
  bool _wantsConnection = false;
  bool _authenticated = false;
  int _nextId = 0;
  int _attempt = 0;
  final Map<int, Completer<RpcReply>> _pending = <int, Completer<RpcReply>>{};
  Completer<void>? _authCompleter;
  final StreamController<DaemonStatus> _status = StreamController<DaemonStatus>.broadcast();

  DaemonStatus _snapshot = const DaemonStatus(state: DaemonConnectionState.disconnected);

  DaemonStatus get snapshot => _snapshot;
  Stream<DaemonStatus> get statusStream => _status.stream;

  /// Optional hook for Wave 0 event frames. No subscription is sent by this
  /// scaffold; see [ServerFrame.event] / `protocol.dart` for the seam.
  void Function(GatewayEventFrame event)? onEvent;

  void _emit({
    DaemonConnectionState? state,
    CoreStatus? core,
    DaemonClientException? error,
    int? attempt,
    bool clearCore = false,
    bool clearError = false,
  }) {
    _snapshot = DaemonStatus(
      state: state ?? _snapshot.state,
      core: clearCore ? null : core ?? _snapshot.core,
      error: clearError ? null : error ?? _snapshot.error,
      // Settings are cleared on disconnect, so the host clears with them.
      host: _settings?.host,
      attempt: attempt ?? _snapshot.attempt,
    );
    if (!_status.isClosed) _status.add(_snapshot);
  }

  /// Validate then open a connection. The first frame sent is always auth.
  Future<void> connect(ConnectionSettings settings) async {
    final errors = settings.validationErrors();
    if (errors.isNotEmpty) {
      throw DaemonClientException(kind: DaemonFailureKind.protocol, message: errors.first);
    }
    _wantsConnection = true;
    _settings = settings;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _attempt = 0;
    await _open();
  }

  Future<void> _open() async {
    final settings = _settings;
    if (settings == null || !_wantsConnection) return;

    _authenticated = false;
    _emit(state: DaemonConnectionState.connecting, clearCore: true, clearError: true, attempt: 0);
    await _teardownTransport();

    final transport = _transportFactory();
    _transport = transport;
    _messageSub = transport.messages.listen(
      _onMessage,
      onError: _onTransportSignal,
      onDone: () => _onTransportSignal(const TransportClosed()),
    );
    _errorSub = transport.errors.listen(_onTransportSignal);

    try {
      await transport.connect(settings.uri);
    } catch (e) {
      _onTransportSignal(DaemonClientException(
        kind: DaemonFailureKind.transport,
        message: 'Could not open WebSocket: $e',
      ));
      return;
    }

    // First message MUST be auth; the gateway closes with 1008 otherwise.
    _emit(state: DaemonConnectionState.authenticating);
    final auth = Completer<void>();
    _authCompleter = auth;
    transport.send(encodeAuthFrame(settings.authToken));

    try {
      await auth.future.timeout(
        authTimeout,
        onTimeout: () => throw DaemonClientException(
          kind: DaemonFailureKind.timeout,
          message: 'Authentication timed out after ${authTimeout.inSeconds}s.',
        ),
      );
    } catch (e) {
      _authCompleter = null;
      if (!_wantsConnection) return;
      final failure = e is DaemonClientException
          ? e
          : DaemonClientException(kind: DaemonFailureKind.protocol, message: 'Authentication failed: $e');
      _emit(state: DaemonConnectionState.failed, error: failure);
      // Auth/config failures are terminal: retrying a bad token is just noise.
      return;
    }

    if (!_wantsConnection) return;
    _authCompleter = null;
    _authenticated = true;
    _emit(state: DaemonConnectionState.connected, clearError: true);

    // Best-effort health probe: a degraded core is surfaced as an error on an
    // otherwise connected snapshot, never as a dropped connection.
    try {
      final core = await probeCoreStatus();
      if (_wantsConnection) _emit(core: core);
    } on DaemonClientException catch (e) {
      if (_wantsConnection) _emit(error: e);
    }
  }

  void _onMessage(String text) {
    final frame = ServerFrame.parse(text);
    switch (frame.kind) {
      case ServerFrameKind.authOk:
      case ServerFrameKind.authenticated:
        if (!_authenticated) _completeAuth();
        break;
      case ServerFrameKind.rpc:
        final reply = frame.reply;
        if (reply != null) _deliver(reply);
        break;
      case ServerFrameKind.error:
        final raw = frame.error;
        final failure = DaemonClientException(
          kind: DaemonFailureKind.rpc,
          message: raw?.message ?? 'Gateway reported an error.',
          code: raw?.code,
        );
        if (!_authenticated) {
          _failAuth(failure);
        } else {
          _emit(error: failure);
        }
        _failAllPending(failure);
        break;
      case ServerFrameKind.event:
        // TODO(airi-wxp.2.2): typed decode + event.subscribe land with Wave 0.
        // No subscription is sent here; the generic envelope is exposed only
        // through the optional `onEvent` hook. No event payloads are modelled.
        final event = frame.event;
        if (event != null) onEvent?.call(event);
        break;
      case ServerFrameKind.pong:
      case ServerFrameKind.heartbeat:
      case ServerFrameKind.unknown:
        break;
    }
  }

  void _completeAuth() {
    final pendingAuth = _authCompleter;
    _authCompleter = null;
    if (pendingAuth != null && !pendingAuth.isCompleted) pendingAuth.complete();
  }

  void _failAuth(Object error) {
    final pendingAuth = _authCompleter;
    _authCompleter = null;
    if (pendingAuth != null && !pendingAuth.isCompleted) pendingAuth.completeError(error);
  }

  void _deliver(RpcReply reply) {
    final id = reply.id;
    if (id is! int) return;
    final completer = _pending.remove(id);
    if (completer != null && !completer.isCompleted) completer.complete(reply);
  }

  void _failAllPending(Object error) {
    for (final completer in _pending.values) {
      if (!completer.isCompleted) completer.completeError(error);
    }
    _pending.clear();
  }

  void _onTransportSignal(Object signal) {
    final failure = signal is DaemonClientException
        ? signal
        : DaemonClientException(
            kind: DaemonFailureKind.transport,
            message: signal is TransportClosed
                ? 'Gateway connection closed.'
                : 'Transport error: $signal',
          );

    if (!_authenticated) {
      _failAuth(failure);
      if (_wantsConnection) _emit(state: DaemonConnectionState.failed, error: failure);
      return;
    }

    _failAllPending(failure);
    _authenticated = false;
    if (!_wantsConnection) {
      _emit(state: DaemonConnectionState.disconnected, clearError: true);
      return;
    }
    _emit(state: DaemonConnectionState.reconnecting, error: failure);
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    if (!_wantsConnection) return;
    final next = _attempt + 1;
    if (!reconnectPolicy.shouldAttempt(next)) {
      _emit(state: DaemonConnectionState.failed, attempt: _attempt);
      return;
    }
    _attempt = next;
    final delay = reconnectPolicy.delayForAttempt(next);
    _emit(state: DaemonConnectionState.reconnecting, attempt: next);
    _reconnectTimer = Timer(delay, () {
      _reconnectTimer = null;
      if (_wantsConnection) unawaited(_open());
    });
  }

  /// Typed RPC with id correlation and a per-call timeout.
  Future<RpcReply> call(String action, {Map<String, dynamic>? payload}) async {
    final transport = _transport;
    if (transport == null || !_authenticated || _snapshot.state != DaemonConnectionState.connected) {
      throw const DaemonClientException(
        kind: DaemonFailureKind.notConnected,
        message: 'Not connected to the daemon.',
      );
    }
    final id = ++_nextId;
    final completer = Completer<RpcReply>();
    _pending[id] = completer;
    transport.send(RpcRequest(action: action, payload: payload, id: id).toWire());
    try {
      return await completer.future.timeout(
        rpcTimeout,
        onTimeout: () => throw DaemonClientException(
          kind: DaemonFailureKind.timeout,
          message: 'RPC "$action" timed out after ${rpcTimeout.inSeconds}s.',
        ),
      );
    } finally {
      _pending.remove(id);
    }
  }

  /// Read-only health probe. Never writes daemon state.
  Future<CoreStatus> probeCoreStatus() async {
    final reply = await call('core.status');
    if (!reply.ok) {
      final error = reply.error;
      throw DaemonClientException(
        kind: DaemonFailureKind.rpc,
        message: error?.message ?? 'core.status failed.',
        code: error?.code,
      );
    }
    final data = reply.data;
    if (data is! Map<String, dynamic>) {
      throw const DaemonClientException(
        kind: DaemonFailureKind.protocol,
        message: 'core.status reply did not contain an object payload.',
      );
    }
    return CoreStatus.fromJson(data);
  }

  /// Explicit shutdown: no reconnect is scheduled.
  Future<void> disconnect() async {
    _wantsConnection = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _authenticated = false;
    _failAuth(const DaemonClientException(kind: DaemonFailureKind.notConnected, message: 'Disconnected.'));
    _failAllPending(const DaemonClientException(kind: DaemonFailureKind.notConnected, message: 'Disconnected.'));
    await _teardownTransport();
    _settings = null;
    _emit(state: DaemonConnectionState.disconnected, clearCore: true, clearError: true, attempt: 0);
  }

  Future<void> _teardownTransport() async {
    await _messageSub?.cancel();
    _messageSub = null;
    await _errorSub?.cancel();
    _errorSub = null;
    final transport = _transport;
    _transport = null;
    if (transport != null) await transport.close();
  }

  void dispose() {
    _wantsConnection = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _failAllPending(const DaemonClientException(kind: DaemonFailureKind.notConnected, message: 'Client disposed.'));
    final transport = _transport;
    _teardownTransport().whenComplete(() => transport?.dispose());
    _status.close();
  }
}
