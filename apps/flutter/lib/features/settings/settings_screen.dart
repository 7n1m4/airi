// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/material.dart';

/// Placeholder settings surface. Real control surfaces (providers, memory,
/// cards, sessions) are bead airi-wxp.3.2 and are owned by daemon RPC verbs —
/// never by a local Dart store writer.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, required this.onOpenConnections});

  final VoidCallback onOpenConnections;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        ListTile(
          leading: const Icon(Icons.link),
          title: const Text('Connection'),
          subtitle: const Text('Host, port, scheme and auth token'),
          onTap: onOpenConnections,
        ),
        const Divider(),
        const ListTile(
          leading: Icon(Icons.extension_outlined),
          title: Text('Providers'),
          subtitle: Text('Deferred · airi-wxp.3.2'),
          enabled: false,
        ),
        const ListTile(
          leading: Icon(Icons.psychology_outlined),
          title: Text('Memory'),
          subtitle: Text('Deferred · airi-wxp.3.2'),
          enabled: false,
        ),
        const ListTile(
          leading: Icon(Icons.person_outline),
          title: Text('Cards'),
          subtitle: Text('Deferred · airi-wxp.3.2'),
          enabled: false,
        ),
        const ListTile(
          leading: Icon(Icons.forum_outlined),
          title: Text('Sessions'),
          subtitle: Text('Deferred · airi-wxp.3.2'),
          enabled: false,
        ),
      ],
    );
  }
}
