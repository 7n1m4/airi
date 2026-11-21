// SPDX-License-Identifier: GPL-3.0-or-later

// Conformance test: Dart codec leg of the three-job wire-fixture
// conformance CI (airi-wxp.2.8).
//
// Reads golden JSON fixtures from
//   crates/anima-channel/fixtures/golden/
// and verifies the Dart wire codecs (ServerFrame, GatewayEventFrame,
// CoreStatus, RpcError) parse them without throwing and extract the
// expected envelope fields.
//
// This test intentionally does NOT require typed event payload models
// yet (decision airi-wxp.2.2 / airi-wxp.10 is still open). It checks
// the envelope-level contract: topic string, data object, id passthrough.

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:anima_control/daemon_client/daemon_client.dart';

/// Path to the Rust golden fixtures directory.
final String _fixturesDir = () {
  // Works from repo root (monorepo layout).
  final fromCwd = Directory('crates/anima-channel/fixtures/golden');
  if (fromCwd.existsSync()) return fromCwd.path;
  // Fallback for IDE runners.
  final fromScript = Directory(
    '../crates/anima-channel/fixtures/golden',
  );
  if (fromScript.existsSync()) return fromScript.path;
  fail('golden fixtures directory not found');
}();

String _loadFixture(String name) {
  final file = File('$_fixturesDir/$name.json');
  if (!file.existsSync()) {
    fail('fixture not found: ${file.path}');
  }
  return file.readAsStringSync();
}

void main() {
  group('golden fixture conformance (Dart)', () {
    // ----------------------------------------------------------------
    // Event frames: all event.* fixtures must parse as ServerFrame
    // with kind == event and correct envelope fields.
    // ----------------------------------------------------------------

    final eventFixtures = <String, String>{
      'event.lip_sync_rms.silence': 'lip_sync.rms',
      'event.lip_sync_rms.basic': 'lip_sync.rms',
      'event.lip_sync_rms.peak': 'lip_sync.rms',
      'event.emotion_tag.emotion': 'emotion.tag',
      'event.emotion_tag.motion_no_duration': 'emotion.tag',
      'event.emotion_tag.vfx': 'emotion.tag',
      'event.token_delta.partial': 'token.delta',
      'event.token_delta.final': 'token.delta',
      'event.presence_changed.online': 'presence.changed',
      'event.presence_changed.offline': 'presence.changed',
      'event.status_changed.healthy': 'status.changed',
      'event.status_changed.unhealthy': 'status.changed',
    };

    eventFixtures.forEach((fixtureName, expectedTopic) {
      test('$fixtureName parses as event frame with topic "$expectedTopic"', () {
        final text = _loadFixture(fixtureName);
        final frame = ServerFrame.parse(text);

        expect(frame.kind, ServerFrameKind.event,
            reason: '$fixtureName should parse as event');
        expect(frame.event, isNotNull);
        expect(frame.event!.topic, expectedTopic);
        expect(frame.event!.data, isA<Map<String, dynamic>>());
        expect(frame.event!.data, isNotEmpty);
        // No correlation id in these fixtures.
        expect(frame.event!.id, isNull);
      });
    });

    // ----------------------------------------------------------------
    // Event payload field-level checks (envelope data object)
    // ----------------------------------------------------------------

    test('lip_sync_rms.basic data has required fields', () {
      final frame = ServerFrame.parse(_loadFixture('event.lip_sync_rms.basic'));
      final data = frame.event!.data;
      expect(data['actor_id'], 'character-7');
      expect(data['level'], 0.42);
      expect(data['seq'], 1024);
      expect(data['ts_ms'], 1700000000123);
    });

    test('emotion_tag.emotion data has all fields', () {
      final frame = ServerFrame.parse(_loadFixture('event.emotion_tag.emotion'));
      final data = frame.event!.data;
      expect(data['actor_id'], 'character-7');
      expect(data['tag'], 'happy');
      expect(data['kind'], 'emotion');
      expect(data['intensity'], 0.8);
      expect(data['duration_ms'], 3000);
      expect(data['seq'], 42);
    });

    test('emotion_tag.motion_no_duration omits duration_ms', () {
      final frame = ServerFrame.parse(
          _loadFixture('event.emotion_tag.motion_no_duration'));
      final data = frame.event!.data;
      expect(data.containsKey('duration_ms'), isFalse);
      expect(data['kind'], 'motion');
    });

    test('token_delta.final has final=true', () {
      final frame = ServerFrame.parse(_loadFixture('event.token_delta.final'));
      final data = frame.event!.data;
      expect(data['session_id'], 'sess-abc');
      expect(data['message_id'], 'msg-1');
      expect(data['delta'], ' world');
      expect(data['index'], 1);
      expect(data['final'], isTrue);
    });

    test('status_changed.healthy has camelCase fields', () {
      final frame =
          ServerFrame.parse(_loadFixture('event.status_changed.healthy'));
      final data = frame.event!.data;
      expect(data['core_available'], isTrue);
      expect(data['store_available'], isTrue);
      expect(data['store_health'], 'ok');
      expect(data['seq'], 100);
    });

    // ----------------------------------------------------------------
    // Non-event DTO fixtures: parse with the matching Dart type
    // ----------------------------------------------------------------

    test('core_status.reply parses into CoreStatus', () {
      final text = _loadFixture('core_status.reply');
      final json = jsonDecode(text) as Map<String, dynamic>;
      final status = CoreStatus.fromJson(json);

      expect(status.app, 'airi-daemon');
      expect(status.version, '0.1.0');
      expect(status.coreAvailable, isTrue);
      expect(status.storeAvailable, isTrue);
      expect(status.storeHealth, 'ok');
      expect(status.protocol, 'airi-channel/1');
      expect(status.sessionCount, 10);
      expect(status.messageCount, 42);
      expect(status.isHealthy, isTrue);
    });

    test('rpc.error.invalid_token parses into RpcError', () {
      final text = _loadFixture('rpc.error.invalid_token');
      final json = jsonDecode(text) as Map<String, dynamic>;
      final error = RpcError.fromJson(json);

      expect(error.code, 'invalid_token');
      expect(error.message, 'invalid token');
    });

    test('heartbeat.pong parses as heartbeat frame', () {
      final text = _loadFixture('heartbeat.pong');
      // Heartbeat data is not wrapped in a ServerFrame — it's just the data
      // object. Validate it's valid JSON with expected fields.
      final json = jsonDecode(text) as Map<String, dynamic>;
      expect(json['kind'], 'pong');
      expect(json['message'], '💛');
      expect(json['at'], 1700000000000);
    });

    test('heartbeat.ping omits optional message and at', () {
      final text = _loadFixture('heartbeat.ping');
      final json = jsonDecode(text) as Map<String, dynamic>;
      expect(json['kind'], 'ping');
      expect(json.containsKey('message'), isFalse);
      expect(json.containsKey('at'), isFalse);
    });

    // ----------------------------------------------------------------
    // All fixtures are valid JSON
    // ----------------------------------------------------------------

    test('all golden fixtures are valid JSON objects', () {
      final dir = Directory(_fixturesDir);
      final files = dir
          .listSync()
          .whereType<File>()
          .where((f) => f.path.endsWith('.json'))
          .toList();
      expect(files, isNotEmpty, reason: 'no golden fixtures found');
      for (final file in files) {
        final text = file.readAsStringSync();
        final decoded = jsonDecode(text);
        expect(decoded, isA<Map<String, dynamic>>(),
            reason: '${file.path} is not a JSON object');
      }
    });
  });
}