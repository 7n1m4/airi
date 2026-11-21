// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter_test/flutter_test.dart';

import 'package:anima_control/connection/connection_settings.dart';

void main() {
  group('ConnectionSettings URL derivation', () {
    test('default endpoint matches the daemon gateway', () {
      const settings = ConnectionSettings();
      expect(settings.websocketUrl, 'ws://127.0.0.1:6121/ws');
      expect(settings.uri.toString(), 'ws://127.0.0.1:6121/ws');
      expect(settings.isLoopback, isTrue);
    });

    test('fail-closes ws:// to wss:// beyond loopback', () {
      const remote = ConnectionSettings(host: 'pet.example.com', port: 6121);
      expect(remote.isLoopback, isFalse);
      expect(remote.effectiveScheme, 'wss');
      expect(remote.websocketUrl, 'wss://pet.example.com:6121/ws');
    });

    test('keeps explicit wss even on loopback', () {
      const secure = ConnectionSettings(host: 'localhost', scheme: 'wss');
      expect(secure.websocketUrl, 'wss://localhost:6121/ws');
    });

    test('brackets IPv6 hosts', () {
      const v6 = ConnectionSettings(host: '::1');
      expect(v6.isLoopback, isTrue);
      expect(v6.websocketUrl, 'ws://[::1]:6121/ws');
      const bracketed = ConnectionSettings(host: '[::1]');
      expect(bracketed.websocketUrl, 'ws://[::1]:6121/ws');
    });

    test('normalises a path without a leading slash', () {
      const settings = ConnectionSettings(path: 'ws');
      expect(settings.websocketUrl, 'ws://127.0.0.1:6121/ws');
    });

    test('deriveExampleUrl mirrors the Vue derived placeholder', () {
      expect(ConnectionSettings.deriveExampleUrl(), 'ws://127.0.0.1:6121/ws');
      expect(ConnectionSettings.deriveExampleUrl(tls: true), 'wss://127.0.0.1:6121/ws');
    });
  });

  group('ConnectionSettings validation', () {
    test('a fully configured local client is valid', () {
      const settings = ConnectionSettings(authToken: 'token');
      expect(settings.validationErrors(), isEmpty);
      expect(settings.isValid, isTrue);
    });

    test('rejects empty host and token', () {
      const settings = ConnectionSettings(host: '', authToken: '');
      expect(settings.validateHost(), 'Host is required.');
      expect(settings.validateToken(), 'Auth token is required to connect.');
      expect(settings.validationErrors(), hasLength(2));
    });

    test('rejects out-of-range ports', () {
      expect(const ConnectionSettings(port: 0).validatePort(), isNotNull);
      expect(const ConnectionSettings(port: 65536).validatePort(), isNotNull);
      expect(const ConnectionSettings(port: 65535).validatePort(), isNull);
    });

    test('rejects unknown schemes and malformed paths', () {
      expect(const ConnectionSettings(scheme: 'http').validateScheme(), isNotNull);
      expect(const ConnectionSettings(path: '').validatePath(), isNotNull);
    });

    test('copyWith keeps unspecified fields', () {
      const base = ConnectionSettings(host: 'example.com', authToken: 'tok');
      final next = base.copyWith(port: 7000);
      expect(next.host, 'example.com');
      expect(next.authToken, 'tok');
      expect(next.port, 7000);
    });
  });
}
