// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/material.dart';

import '../daemon_client/daemon_client.dart';

/// Small read-only status pill shared by the app bar and the dashboard.
class ConnectionBadge extends StatelessWidget {
  const ConnectionBadge({super.key, required this.client});

  final DaemonClient client;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DaemonStatus>(
      stream: client.statusStream,
      initialData: client.snapshot,
      builder: (context, snapshot) {
        final status = snapshot.data ?? client.snapshot;
        final color = _colorFor(status.state);
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.circle, size: 10, color: color),
            const SizedBox(width: 6),
            Text(_labelFor(status.state), style: Theme.of(context).textTheme.labelMedium),
          ],
        );
      },
    );
  }

  static Color _colorFor(DaemonConnectionState state) {
    switch (state) {
      case DaemonConnectionState.connected:
        return Colors.greenAccent;
      case DaemonConnectionState.connecting:
      case DaemonConnectionState.authenticating:
      case DaemonConnectionState.reconnecting:
        return Colors.amberAccent;
      case DaemonConnectionState.failed:
        return Colors.redAccent;
      case DaemonConnectionState.disconnected:
        return Colors.grey;
    }
  }

  static String _labelFor(DaemonConnectionState state) {
    switch (state) {
      case DaemonConnectionState.connected:
        return 'Connected';
      case DaemonConnectionState.connecting:
        return 'Connecting';
      case DaemonConnectionState.authenticating:
        return 'Authenticating';
      case DaemonConnectionState.reconnecting:
        return 'Reconnecting';
      case DaemonConnectionState.failed:
        return 'Failed';
      case DaemonConnectionState.disconnected:
        return 'Disconnected';
    }
  }
}
