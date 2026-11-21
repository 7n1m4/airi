// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/material.dart';

import 'connection_settings.dart';

/// Gateway connection form. Mirrors the behaviour of the Vue reference
/// `ConnectionSettings.vue`: a derived `ws://` placeholder, a password-masked
/// token, and fail-closed TLS for non-loopback hosts.
class ConnectionSettingsScreen extends StatefulWidget {
  const ConnectionSettingsScreen({
    super.key,
    required this.onConnect,
    required this.onDisconnect,
  });

  final Future<void> Function(ConnectionSettings settings) onConnect;
  final Future<void> Function() onDisconnect;

  @override
  State<ConnectionSettingsScreen> createState() => _ConnectionSettingsScreenState();
}

class _ConnectionSettingsScreenState extends State<ConnectionSettingsScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _host =
      TextEditingController(text: ConnectionSettings.defaultHost);
  late final TextEditingController _port =
      TextEditingController(text: '${ConnectionSettings.defaultPort}');
  late final TextEditingController _token = TextEditingController();
  String _scheme = ConnectionSettings.defaultScheme;
  bool _busy = false;
  String? _connectError;

  @override
  void initState() {
    super.initState();
    // Keep the derived-endpoint helper live while the user types, like Vue's
    // computed `derivedExample`.
    _host.addListener(_refresh);
    _port.addListener(_refresh);
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _host.removeListener(_refresh);
    _port.removeListener(_refresh);
    _host.dispose();
    _port.dispose();
    _token.dispose();
    super.dispose();
  }

  ConnectionSettings _settings() {
    return ConnectionSettings(
      host: _host.text.trim(),
      port: int.tryParse(_port.text.trim()) ?? -1,
      scheme: _scheme,
      authToken: _token.text.trim(),
    );
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _connectError = null;
    });
    try {
      await widget.onConnect(_settings());
    } catch (e) {
      if (mounted) setState(() => _connectError = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _disconnect() async {
    setState(() {
      _busy = true;
      _connectError = null;
    });
    try {
      await widget.onDisconnect();
    } catch (e) {
      if (mounted) setState(() => _connectError = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = _settings();
    final forcedTls = settings.scheme == 'ws' && !settings.isLoopback;

    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text('Connection settings', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          TextFormField(
            controller: _host,
            decoration: InputDecoration(
              labelText: 'Host',
              helperText: 'Endpoint: ${settings.websocketUrl}',
              border: const OutlineInputBorder(),
            ),
            validator: (_) => settings.validateHost(),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _port,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Port',
              helperText: 'Gateway default: 6121',
              border: OutlineInputBorder(),
            ),
            validator: (_) {
              if (int.tryParse(_port.text.trim()) == null) return 'Enter a numeric port.';
              return settings.validatePort();
            },
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _scheme,
            decoration: const InputDecoration(labelText: 'Scheme', border: OutlineInputBorder()),
            items: const <DropdownMenuItem<String>>[
              DropdownMenuItem<String>(value: 'ws', child: Text('ws:// (loopback only)')),
              DropdownMenuItem<String>(value: 'wss', child: Text('wss:// (TLS)')),
            ],
            onChanged: (value) => setState(() => _scheme = value ?? 'ws'),
          ),
          if (forcedTls)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Non-loopback ws:// is fail-closed to wss:// — the daemon forces '
                'TLS beyond loopback.',
                style: TextStyle(color: Theme.of(context).colorScheme.tertiary),
              ),
            ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _token,
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'Auth token',
              helperText: 'First frame sent is {"type":"auth","authToken":…}',
              border: OutlineInputBorder(),
            ),
            validator: (_) => settings.validateToken(),
          ),
          const SizedBox(height: 12),
          Row(
            children: <Widget>[
              const Icon(Icons.lock_outline, size: 16),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Token is held in memory for this session only. Secure storage '
                  '(Keychain / Keystore) is intentionally deferred; never commit '
                  'tokens to source control.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ),
          if (_connectError != null) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              _connectError!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 16),
          Row(
            children: <Widget>[
              Expanded(
                child: FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Connect'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy ? null : _disconnect,
                  child: const Text('Disconnect'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
