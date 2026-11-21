// SPDX-License-Identifier: GPL-3.0-or-later

// Low-level JSON frame codec for the protocol spoken by anima-channel.
// Shapes are reused from crates/anima-channel/src/wire.rs; protocol id remains
// the literal carve-out `airi-channel/1` (do not rename to `anima-*`).

import 'dart:convert';

import 'rpc.dart';

/// Literal protocol identifier from `dispatch::PROTOCOL` (wire version 1).
const String kProtocolId = 'airi-channel/1';

/// Gateway WS path (`crates/anima-channel/src/client.rs:27`).
const String kDefaultWsPath = '/ws';

const int kDefaultPort = 6121;

/// First frame on every connection MUST be an auth frame. Anything else before
/// auth is rejected by the gateway (close 1008).
String encodeAuthFrame(String token) => jsonEncode(<String, dynamic>{
      'type': 'auth',
      'authToken': token,
    });

/// Alternate handshake shape used by the server-runtime mirror.
String encodeModuleAuthFrame(String token) => jsonEncode(<String, dynamic>{
      'type': 'module:authenticate',
      'data': <String, dynamic>{'token': token},
    });

String encodePingFrame() => jsonEncode(<String, dynamic>{'type': 'ping'});

enum ServerFrameKind {
  authOk, // {"type":"auth","ok":true}
  authenticated, // {"type":"module:authenticated","data":{"authenticated":true}}
  pong,
  heartbeat,
  rpc,
  error,
  event, // Wave 0 server-initiated lane; post-auth only.
  unknown,
}

/// Generic view of a Wave 0 `event` frame.
///
/// TODO(airi-wxp.2.2 / airi-wxp.10): once the event lane and the binding
/// strategy land, replace this with typed payloads (generated bindings OR
/// hand-written typed models checked against Rust golden fixtures — decision
/// airi-wxp.10 is still open). This scaffold sends NO `event.subscribe` RPC and
/// models NO event payload shapes — it only exposes the topic/data/id envelope
/// to a caller-provided hook.
class GatewayEventFrame {
  const GatewayEventFrame({
    required this.topic,
    required this.data,
    this.id,
  });

  final String topic;
  final Map<String, dynamic> data;
  final Object? id;

  factory GatewayEventFrame.fromJson(Map<String, dynamic> json) {
    final rawData = json['data'];
    return GatewayEventFrame(
      topic: json['topic'] as String? ?? '',
      data: rawData is Map<String, dynamic> ? rawData : const <String, dynamic>{},
      id: json['id'],
    );
  }
}

/// Decoded server text frame. Parsing is total: malformed frames become
/// [ServerFrameKind.unknown] with a [parseError] instead of throwing.
class ServerFrame {
  const ServerFrame({
    required this.kind,
    this.raw = const <String, dynamic>{},
    this.reply,
    this.error,
    this.event,
    this.parseError,
  });

  final ServerFrameKind kind;
  final Map<String, dynamic> raw;
  final RpcReply? reply;
  final RpcError? error;
  final GatewayEventFrame? event;
  final String? parseError;

  static ServerFrame parse(String text) {
    Object? decoded;
    try {
      decoded = jsonDecode(text);
    } catch (e) {
      return ServerFrame(kind: ServerFrameKind.unknown, parseError: 'invalid JSON: $e');
    }
    if (decoded is! Map<String, dynamic>) {
      return const ServerFrame(kind: ServerFrameKind.unknown, parseError: 'frame is not a JSON object');
    }

    switch (decoded['type']) {
      case 'auth':
        return ServerFrame(kind: ServerFrameKind.authOk, raw: decoded);
      case 'module:authenticated':
        return ServerFrame(kind: ServerFrameKind.authenticated, raw: decoded);
      case 'pong':
        return ServerFrame(kind: ServerFrameKind.pong, raw: decoded);
      case 'transport:connection:heartbeat':
        return ServerFrame(kind: ServerFrameKind.heartbeat, raw: decoded);
      case 'rpc':
        return ServerFrame(kind: ServerFrameKind.rpc, raw: decoded, reply: RpcReply.fromJson(decoded));
      case 'error':
        final rawError = decoded['error'];
        return ServerFrame(
          kind: ServerFrameKind.error,
          raw: decoded,
          error: rawError is Map<String, dynamic> ? RpcError.fromJson(rawError) : null,
        );
      case 'event':
        return ServerFrame(
          kind: ServerFrameKind.event,
          raw: decoded,
          event: GatewayEventFrame.fromJson(decoded),
        );
      default:
        return ServerFrame(
          kind: ServerFrameKind.unknown,
          raw: decoded,
          parseError: 'unknown frame type: ${decoded['type']}',
        );
    }
  }
}
