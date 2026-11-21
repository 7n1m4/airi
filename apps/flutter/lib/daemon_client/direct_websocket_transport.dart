// SPDX-License-Identifier: GPL-3.0-or-later

import 'dart:async';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'transport.dart';

/// Local/LAN WebSocket transport: `ws://127.0.0.1:6121/ws` on loopback,
/// `wss://…` beyond loopback (the daemon forces TLS for non-loopback binds).
///
/// TODO(airi-wxp.3.5): remote mobile transports are a SEAM, not hard-wired here.
/// Planned implementations of [DaemonTransport]:
///   * libp2p (peer identity replaces/augments the shared token),
///   * Cloudflare Tunnel (HTTPS/WSS tunnel to the desktop daemon),
///   * tunnel + libp2p.
/// A Termux-hosted daemon is another valid endpoint for this same interface.
/// There is deliberately NO embedded `flutter_rust_bridge` core and NO local
/// mobile daemon — the UI stays thin in every topology for battery life.
class DirectWebSocketTransport implements DaemonTransport {
  DirectWebSocketTransport();

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  final StreamController<String> _messages = StreamController<String>.broadcast();
  final StreamController<Object> _errors = StreamController<Object>.broadcast();
  bool _connected = false;

  @override
  Stream<String> get messages => _messages.stream;

  @override
  Stream<Object> get errors => _errors.stream;

  @override
  bool get isConnected => _connected;

  @override
  Future<void> connect(Uri endpoint) async {
    await close();
    final channel = WebSocketChannel.connect(endpoint);
    _channel = channel;
    // web_socket_channel queues sends until the handshake completes, so the
    // first auth frame can be written immediately after this call.
    _connected = true;
    _subscription = channel.stream.listen(
      (event) {
        if (!_connected) _connected = true;
        if (event is String) {
          if (!_messages.isClosed) _messages.add(event);
        } else {
          _errors.add('Binary frame ignored: the gateway speaks JSON text frames only.');
        }
      },
      onError: (Object error) {
        _connected = false;
        if (!_errors.isClosed) _errors.add(error);
      },
      onDone: () {
        _connected = false;
        if (!_errors.isClosed) _errors.add(const TransportClosed());
      },
    );
  }

  @override
  void send(String frame) {
    final channel = _channel;
    if (channel == null || !_connected) {
      throw StateError('DirectWebSocketTransport.send called while not connected.');
    }
    channel.sink.add(frame);
  }

  @override
  Future<void> close() async {
    await _subscription?.cancel();
    _subscription = null;
    _connected = false;
    await _channel?.sink.close();
    _channel = null;
  }

  @override
  void dispose() {
    close(); // ignore returned future: disposal is terminal
    _messages.close();
    _errors.close();
  }
}
