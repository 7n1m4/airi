// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter_test/flutter_test.dart';

import 'package:anima_control/daemon_client/daemon_client.dart';

void main() {
  test('parses auth and rpc server frames', () {
    final auth = ServerFrame.parse('{"type":"auth","ok":true}');
    expect(auth.kind, ServerFrameKind.authOk);

    final rpc = ServerFrame.parse(
      '{"type":"rpc","action":"core.status","ok":true,"data":{"app":"anima-daemon"},"id":1}',
    );
    expect(rpc.kind, ServerFrameKind.rpc);
    expect(rpc.reply?.action, 'core.status');
    expect(rpc.reply?.id, 1);
  });

  test('parses error frames', () {
    final frame = ServerFrame.parse(
      '{"type":"error","error":{"code":"invalid_token","message":"invalid token"}}',
    );
    expect(frame.kind, ServerFrameKind.error);
    expect(frame.error?.code, 'invalid_token');
  });

  test('parses Wave 0 event frames as a generic envelope only', () {
    final frame = ServerFrame.parse(
      '{"type":"event","topic":"status.changed","data":{"core_available":true},"id":"turn-1"}',
    );
    expect(frame.kind, ServerFrameKind.event);
    expect(frame.event?.topic, 'status.changed');
    expect(frame.event?.data['core_available'], isTrue);
    expect(frame.event?.id, 'turn-1');
  });

  test('malformed and unknown frames never throw', () {
    expect(ServerFrame.parse('not json').kind, ServerFrameKind.unknown);
    expect(ServerFrame.parse('[]').kind, ServerFrameKind.unknown);
    final unknown = ServerFrame.parse('{"type":"something.new"}');
    expect(unknown.kind, ServerFrameKind.unknown);
    expect(unknown.parseError, contains('something.new'));
  });

  test('protocol id remains the literal wire carve-out', () {
    expect(kProtocolId, 'airi-channel/1');
  });
}
