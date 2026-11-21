// SPDX-License-Identifier: GPL-3.0-or-later

// Hand-written for the small, stable auth/rpc subset ONLY. Typed event payloads
// are deliberately NOT modelled here: they arrive with the Wave 0 event lane and
// the binding decision (beads airi-wxp.2.2 / airi-wxp.10, still OPEN). Shapes
// below are copied from crates/anima-channel/src/wire.rs; do not invent new ones.

import 'dart:convert';

/// Client→server `rpc` frame.
///
/// Wire shape: `{"type":"rpc","action":…,"payload"?:{…},"id"?:…}`.
/// Optional fields are omitted rather than sent as `null`, matching the Rust
/// `skip_serializing_if = "Option::is_none"` behaviour.
class RpcRequest {
  const RpcRequest({required this.action, this.payload, this.id});

  final String action;
  final Map<String, dynamic>? payload;

  /// Any JSON value; the gateway echoes it verbatim in the reply.
  final Object? id;

  Map<String, dynamic> toJson() {
    final frame = <String, dynamic>{'type': 'rpc', 'action': action};
    if (payload != null) frame['payload'] = payload;
    if (id != null) frame['id'] = id;
    return frame;
  }

  String toWire() => jsonEncode(toJson());
}

/// Stable code + sanitized message carried by `rpc` error replies and `error`
/// frames (`RpcErrorObject` in wire.rs).
class RpcError {
  const RpcError({required this.code, required this.message});

  final String code;
  final String message;

  factory RpcError.fromJson(Map<String, dynamic> json) {
    return RpcError(
      code: json['code'] as String? ?? '',
      message: json['message'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{'code': code, 'message': message};
}

/// Server→client `rpc` reply frame payload.
class RpcReply {
  const RpcReply({
    required this.action,
    required this.ok,
    this.data,
    this.error,
    this.id,
  });

  final String action;
  final bool ok;
  final Object? data;
  final RpcError? error;
  final Object? id;

  bool get isFailure => !ok;

  factory RpcReply.fromJson(Map<String, dynamic> json) {
    final rawError = json['error'];
    return RpcReply(
      action: json['action'] as String? ?? '',
      ok: json['ok'] as bool? ?? false,
      data: json['data'],
      error: rawError is Map<String, dynamic> ? RpcError.fromJson(rawError) : null,
      id: json['id'],
    );
  }
}

/// Sanitized health snapshot from `core.status`.
///
/// The daemon guarantees this carries no tokens, keys, prompts, paths or raw
/// memory (wire.rs `CoreStatusReply`); never widen it with secret-bearing fields.
class CoreStatus {
  const CoreStatus({
    required this.app,
    required this.version,
    required this.coreAvailable,
    required this.storeAvailable,
    required this.storeHealth,
    required this.protocol,
    required this.sessionCount,
    required this.messageCount,
  });

  final String app;
  final String version;
  final bool coreAvailable;
  final bool storeAvailable;
  final String storeHealth;
  final String protocol;
  final int sessionCount;
  final int messageCount;

  bool get isHealthy => coreAvailable && storeAvailable && storeHealth == 'ok';

  factory CoreStatus.fromJson(Map<String, dynamic> json) {
    return CoreStatus(
      app: json['app'] as String? ?? '',
      version: json['version'] as String? ?? '',
      coreAvailable: json['coreAvailable'] as bool? ?? false,
      storeAvailable: json['storeAvailable'] as bool? ?? false,
      storeHealth: json['storeHealth'] as String? ?? 'unavailable',
      protocol: json['protocol'] as String? ?? '',
      sessionCount: (json['sessionCount'] as num?)?.toInt() ?? 0,
      messageCount: (json['messageCount'] as num?)?.toInt() ?? 0,
    );
  }
}
