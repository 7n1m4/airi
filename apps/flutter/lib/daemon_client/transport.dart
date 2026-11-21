// SPDX-License-Identifier: GPL-3.0-or-later

import 'dart:async';

/// Sentinels delivered on [DaemonTransport.errors] so the client can react to a
/// clean stream end without each transport inventing its own signal.
class TransportClosed {
  const TransportClosed();
}

/// Minimal data-plane contract between the daemon client and a byte/frame pipe.
///
/// Implementations carry JSON text frames only. Auth, RPC correlation and
/// reconnect live in `DaemonClient`, not here — transports are interchangeable.
abstract class DaemonTransport {
  Stream<String> get messages;
  Stream<Object> get errors;

  /// True once the pipe can accept frames (before any message necessarily arrives).
  bool get isConnected;

  Future<void> connect(Uri endpoint);

  void send(String frame);

  Future<void> close();

  /// Release stream controllers / resources. Called on client disposal only.
  void dispose();
}

/// Injection point for tests and for future remote transports.
typedef DaemonTransportFactory = DaemonTransport Function();
