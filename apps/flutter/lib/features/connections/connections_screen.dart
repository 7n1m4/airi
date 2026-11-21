// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/material.dart';

import '../../connection/connection_settings_screen.dart';
import '../../daemon_client/daemon_client.dart';
import '../../theme/app_theme.dart';

/// Connections tab: live status plus the gateway form.
class ConnectionsScreen extends StatelessWidget {
  const ConnectionsScreen({super.key, required this.client});

  final DaemonClient client;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        StreamBuilder<DaemonStatus>(
          stream: client.statusStream,
          initialData: client.snapshot,
          builder: (context, snapshot) {
            final status = snapshot.data ?? client.snapshot;
            return Card(
              color: AppTheme.surface,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Gateway status', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Text(status.state.name),
                    if (status.host != null) Text(status.host!),
                    if (status.error != null) ...<Widget>[
                      const SizedBox(height: 8),
                      Text(
                        status.error.toString(),
                        style: TextStyle(color: Theme.of(context).colorScheme.error),
                      ),
                    ],
                  ],
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 12),
        ConnectionSettingsScreen(
          onConnect: client.connect,
          onDisconnect: client.disconnect,
        ),
      ],
    );
  }
}
