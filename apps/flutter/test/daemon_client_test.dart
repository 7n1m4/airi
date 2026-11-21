// SPDX-License-Identifier: GPL-3.0-or-later

// End-to-end handshake tests with an in-memory fake transport. No socket, no
// daemon, no Flutter binding required.

import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:anima_control/connection/connection_settings.dart';
import 'package:anima_control/daemon_client/daemon_client.dart';

Future<void> _pump() => Future<void>.delayed(Duration.zero);

final Map<String, dynamic> _healthyCore = <String, dynamic>{
  'app': 'anima-daemon',
  'version': '0.1.0',
  'coreAvailable': true,
  'storeAvailable': true,
  'storeHealth': 'ok',
  'protocol': 'airi-channel/1',
  'sessionCount': 3,
  'messageCount': 12,
};

class FakeTransport implements DaemonTransport {
  final StreamController<String> _messages = StreamController<String>.broadcast();
  final StreamController<Object> _errors = StreamController<Object>.broadcast();
  final List<String> sent = <String>[];
  bool connected = false;

  @override
  Stream<String> get messages => _messages.stream;

  @override
  Stream<Object> get errors => _errors.stream;

  @override
  bool get isConnected => connected;

  @override
  Future<void> connect(Uri endpoint) async {
    connected = true;
  }

  @override
  void send(String frame) => sent.add(frame);

  @override
  Future<void> close() async {
    connected = false;
  }

  @override
  void dispose() {
    _messages.close();
    _errors.close();
  }

  void receive(String frame) => _messages.add(frame);
}

void main() {
  test('auth is the first frame, then core.status is probed', () async {
    final fake = FakeTransport();
    final client = DaemonClient(
      transportFactory: () => fake,
      authTimeout: const Duration(seconds: 2),
      rpcTimeout: const Duration(seconds: 2),
    );
    addTearDown(client.dispose);

    final connecting = client.connect(const ConnectionSettings(authToken: 'tok'));
    await _pump();

    expect(fake.sent, hasLength(1));
    expect(jsonDecode(fake.sent.first), <String, dynamic>{
      'type': 'auth',
      'authToken': 'tok',
    });
    expect(client.snapshot.state, DaemonConnectionState.authenticating);

    fake.receive('{"type":"auth","ok":true}');
    await _pump();

    expect(fake.sent, hasLength(2));
    final probe = jsonDecode(fake.sent[1]) as Map<String, dynamic>;
    expect(probe['type'], 'rpc');
    expect(probe['action'], 'core.status');
    expect(probe['id'], isA<int>());

    fake.receive(jsonEncode(<String, dynamic>{
      'type': 'rpc',
      'action': 'core.status',
      'ok': true,
      'data': _healthyCore,
      'id': probe['id'],
    }));
    await connecting;

    expect(client.snapshot.state, DaemonConnectionState.connected);
    expect(client.snapshot.core?.app, 'anima-daemon');
    expect(client.snapshot.core?.isHealthy, isTrue);
  });

  test('auth rejection yields a terminal failed state with a clear reason', () async {
    final fake = FakeTransport();
    final client = DaemonClient(
      transportFactory: () => fake,
      authTimeout: const Duration(seconds: 2),
      rpcTimeout: const Duration(seconds: 2),
    );
    addTearDown(client.dispose);

    final connecting = client.connect(const ConnectionSettings(authToken: 'bad'));
    await _pump();
    fake.receive(
      '{"type":"error","error":{"code":"invalid_token","message":"invalid token"}}',
    );
    await connecting;

    expect(client.snapshot.state, DaemonConnectionState.failed);
    expect(client.snapshot.error?.code, 'invalid_token');
    expect(fake.sent, hasLength(1)); // no RPC attempted before auth succeeds
  });

  test('disconnect is explicit and does not reconnect', () async {
    final fake = FakeTransport();
    final client = DaemonClient(
      transportFactory: () => fake,
      authTimeout: const Duration(seconds: 2),
      rpcTimeout: const Duration(seconds: 2),
    );
    addTearDown(client.dispose);

    final connecting = client.connect(const ConnectionSettings(authToken: 'tok'));
    await _pump();
    fake.receive('{"type":"auth","ok":true}');
    await _pump();
    final probe = jsonDecode(fake.sent[1]) as Map<String, dynamic>;
    fake.receive(jsonEncode(<String, dynamic>{
      'type': 'rpc',
      'action': 'core.status',
      'ok': true,
      'data': _healthyCore,
      'id': probe['id'],
    }));
    await connecting;

    await client.disconnect();
    await _pump();

    expect(client.snapshot.state, DaemonConnectionState.disconnected);
    expect(client.snapshot.core, isNull);
    expect(fake.connected, isFalse);
    expect(
      client.call('runtime.ping'),
      throwsA(isA<DaemonClientException>().having(
        (e) => e.kind,
        'kind',
        DaemonFailureKind.notConnected,
      )),
    );
  });

  test('event frames reach the hook but no subscription is sent', () async {
    final fake = FakeTransport();
    final client = DaemonClient(
      transportFactory: () => fake,
      authTimeout: const Duration(seconds: 2),
      rpcTimeout: const Duration(seconds: 2),
    );
    addTearDown(client.dispose);

    GatewayEventFrame? seen;
    client.onEvent = (event) => seen = event;

    final connecting = client.connect(const ConnectionSettings(authToken: 'tok'));
    await _pump();
    fake.receive('{"type":"auth","ok":true}');
    await _pump();
    final probe = jsonDecode(fake.sent[1]) as Map<String, dynamic>;
    fake.receive(jsonEncode(<String, dynamic>{
      'type': 'rpc',
      'action': 'core.status',
      'ok': true,
      'data': _healthyCore,
      'id': probe['id'],
    }));
    await connecting;

    fake.receive(
      '{"type":"event","topic":"status.changed","data":{"store_health":"ok"}}',
    );
    await _pump();

    expect(seen?.topic, 'status.changed');
    expect(fake.sent.any((frame) => frame.contains('event.subscribe')), isFalse);
  });
}
