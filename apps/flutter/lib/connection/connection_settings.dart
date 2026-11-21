// SPDX-License-Identifier: GPL-3.0-or-later

/// Pure value object describing how to reach an `anima-daemon` gateway.
///
/// This mirrors the derivation rules of the Vue reference
/// `resolveWebSocketUrl` (`packages/stage-ui/src/stores/mods/api/channel-server.ts`)
/// and the settings form `ConnectionSettings.vue`: an empty/derived endpoint
/// uses the daemon-mirrored gateway settings, and a non-loopback `ws://` URL is
/// fail-closed to `wss://` because the daemon forces TLS beyond loopback.
///
/// No Flutter imports: fully unit-testable without a daemon.
class ConnectionSettings {
  const ConnectionSettings({
    this.host = defaultHost,
    this.port = defaultPort,
    this.scheme = defaultScheme,
    this.path = defaultPath,
    this.authToken = '',
  });

  static const String defaultHost = '127.0.0.1';
  static const int defaultPort = 6121;
  static const String defaultScheme = 'ws';
  static const String defaultPath = '/ws';

  final String host;
  final int port;

  /// `ws` or `wss`. A non-loopback `ws` is upgraded to `wss` when building the URL.
  final String scheme;

  /// Gateway WS path. The Rust client uses `/ws` (`crates/anima-channel/src/client.rs:27`).
  final String path;

  /// Shared gateway token. Held in memory only — secure persistence is deferred.
  final String authToken;

  ConnectionSettings copyWith({
    String? host,
    int? port,
    String? scheme,
    String? path,
    String? authToken,
  }) {
    return ConnectionSettings(
      host: host ?? this.host,
      port: port ?? this.port,
      scheme: scheme ?? this.scheme,
      path: path ?? this.path,
      authToken: authToken ?? this.authToken,
    );
  }

  /// Loopback hosts are the only ones allowed plaintext `ws://` by the daemon.
  bool get isLoopback {
    final h = _unwrapHost(host);
    return h == 'localhost' || h == '127.0.0.1' || h == '::1';
  }

  /// Scheme actually used for the connection. Fail-closed beyond loopback.
  String get effectiveScheme => scheme == 'ws' && !isLoopback ? 'wss' : scheme;

  /// Endpoint sent to the WebSocket transport.
  Uri get uri => Uri.parse(websocketUrl);

  /// Deterministic URL string (no `Uri` host-normalisation surprises with IPv6).
  String get websocketUrl {
    final raw = host.trim();
    final normalized = raw.contains(':') && !(raw.startsWith('[') && raw.endsWith(']')) ? '[$raw]' : raw;
    final normalizedPath = path.startsWith('/') ? path : '/$path';
    return '$effectiveScheme://$normalized:$port$normalizedPath';
  }

  String? validateHost() {
    final raw = host.trim();
    if (raw.isEmpty) return 'Host is required.';
    final h = _unwrapHost(raw);
    final hostname = RegExp(r'^[A-Z0-9.-]+$', caseSensitive: false);
    final ipv6 = RegExp(r'^[0-9A-F:]+$', caseSensitive: false);
    if (hostname.hasMatch(h) || ipv6.hasMatch(h)) return null;
    return 'Use a hostname, IPv4 address, or IPv6 address.';
  }

  String? validatePort() {
    if (port < 1 || port > 65535) return 'Port must be between 1 and 65535.';
    return null;
  }

  String? validateScheme() {
    if (scheme == 'ws' || scheme == 'wss') return null;
    return 'Scheme must be ws or wss.';
  }

  String? validatePath() {
    if (path.isEmpty) return 'Path is required (the gateway serves /ws).';
    if (!path.startsWith('/')) return 'Path must start with "/".';
    return null;
  }

  String? validateToken() {
    if (authToken.trim().isEmpty) return 'Auth token is required to connect.';
    return null;
  }

  /// Every field error, in display order. Empty means the settings are connectable.
  List<String> validationErrors() => [
        validateHost(),
        validatePort(),
        validateScheme(),
        validatePath(),
        validateToken(),
      ].whereType<String>().toList(growable: false);

  bool get isValid => validationErrors().isEmpty;

  /// Derive the placeholder shown before the user configures anything — the
  /// Flutter equivalent of the Vue `derivedExample` computed value.
  static String deriveExampleUrl({
    String host = defaultHost,
    int port = defaultPort,
    bool tls = false,
  }) {
    return ConnectionSettings(
      host: host,
      port: port,
      scheme: tls ? 'wss' : 'ws',
    ).websocketUrl;
  }

  static String _unwrapHost(String value) {
    if (value.startsWith('[') && value.endsWith(']')) {
      return value.substring(1, value.length - 1);
    }
    return value;
  }
}
