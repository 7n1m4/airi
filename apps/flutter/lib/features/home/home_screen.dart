// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/material.dart';

import '../../daemon_client/daemon_client.dart';
import '../../theme/app_theme.dart';

/// Control/Home. Displays view state only — it never writes daemon state.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.client});

  final DaemonClient client;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DaemonStatus>(
      stream: client.statusStream,
      initialData: client.snapshot,
      builder: (context, snapshot) {
        final status = snapshot.data ?? client.snapshot;
        final core = status.core;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Card(
              color: AppTheme.surface,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Control surface', style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: 8),
                    const Text(
                      'Anima keeps its state in the long-lived daemon. This window is a '
                      'thin control/chat client: closing it does not stop the agent or '
                      'the Godot pet.',
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              color: AppTheme.surface,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Daemon health', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 12),
                    _Row(label: 'Gateway host', value: status.host ?? '—'),
                    _Row(label: 'Attempt', value: status.attempt == 0 ? '—' : '${status.attempt}'),
                    if (core != null) ...<Widget>[
                      const Divider(height: 20),
                      _Row(label: 'App', value: '${core.app} ${core.version}'),
                      _Row(label: 'Protocol', value: core.protocol),
                      _Row(label: 'Core', value: core.coreAvailable ? 'available' : 'unavailable'),
                      _Row(label: 'Store', value: '${core.storeHealth} (${core.storeAvailable ? 'up' : 'down'})'),
                      _Row(label: 'Sessions', value: '${core.sessionCount}'),
                      _Row(label: 'Messages', value: '${core.messageCount}'),
                    ] else
                      const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Text('No core.status snapshot yet. Connect from the Connections tab.'),
                      ),
                    if (status.error != null) ...<Widget>[
                      const SizedBox(height: 12),
                      Text(
                        status.error.toString(),
                        style: TextStyle(color: Theme.of(context).colorScheme.error),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[Text(label), Text(value)],
      ),
    );
  }
}
