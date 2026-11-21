// SPDX-License-Identifier: GPL-3.0-or-later

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:anima_control/daemon_client/daemon_client.dart';

void main() {
  group('client frame encoding', () {
    test('auth frame is exactly the first-message handshake', () {
      expect(encodeAuthFrame('tok'), '{"type":"auth","authToken":"tok"}');
    });

    test('alternate module auth shape', () {
      expect(
        encodeModuleAuthFrame('tok'),
        '{"type":"module:authenticate","data":{"token":"tok"}}',
      );
    });

    test('rpc omits absent optional fields', () {
      expect(const RpcRequest(action: 'runtime.ping').toJson(), <String, dynamic>{
        'type': 'rpc',
        'action': 'runtime.ping',
      });
      expect(
        const RpcRequest(action: 'runtime.status', id: 7).toWire(),
        '{"type":"rpc","action":"runtime.status","id":7}',
      );
    });

    test('rpc includes payload and echoes id verbatim', () {
      final request = RpcRequest(
        action: 'event.subscribe',
        payload: <String, dynamic>{'topics': <String>['status.changed']},
        id: 'abc',
      );
      expect(jsonDecode(request.toWire()), <String, dynamic>{
        'type': 'rpc',
        'action': 'event.subscribe',
        'payload': <String, dynamic>{'topics': <String>['status.changed']},
        'id': 'abc',
      });
    });
  });

  group('server reply decoding', () {
    test('successful rpc reply keeps data and echoed id', () {
      final reply = RpcReply.fromJson(<String, dynamic>{
        'type': 'rpc',
        'action': 'runtime.ping',
        'ok': true,
        'data': <String, dynamic>{'pong': true},
        'id': 7,
      });
      expect(reply.ok, isTrue);
      expect(reply.id, 7);
      expect(reply.data, isA<Map<String, dynamic>>());
      expect(reply.error, isNull);
    });

    test('failed rpc reply decodes the stable error object', () {
      final reply = RpcReply.fromJson(<String, dynamic>{
        'type': 'rpc',
        'action': 'renderer.nope',
        'ok': false,
        'error': <String, dynamic>{'code': 'rpc_not_implemented', 'message': 'no handler'},
      });
      expect(reply.isFailure, isTrue);
      expect(reply.data, isNull);
      expect(reply.error?.code, 'rpc_not_implemented');
      expect(reply.error?.message, 'no handler');
    });

    test('core.status parses camelCase fields without secrets', () {
      final core = CoreStatus.fromJson(<String, dynamic>{
        'app': 'anima-daemon',
        'version': '0.1.0',
        'coreAvailable': true,
        'storeAvailable': true,
        'storeHealth': 'ok',
        'protocol': 'airi-channel/1',
        'sessionCount': 3,
        'messageCount': 12,
      });
      expect(core.isHealthy, isTrue);
      expect(core.sessionCount, 3);
      expect(core.messageCount, 12);
      expect(core.protocol, 'airi-channel/1');
    });

    test('degraded core status is not healthy', () {
      final core = CoreStatus.fromJson(<String, dynamic>{
        'coreAvailable': false,
        'storeAvailable': true,
        'storeHealth': 'unavailable',
      });
      expect(core.isHealthy, isFalse);
    });
  });
}
