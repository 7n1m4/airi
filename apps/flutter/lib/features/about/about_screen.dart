// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

/// Static about page. No telemetry, no update checks (window chrome does not
/// move into the daemon per design-flutter-godot-pivot.md §4.1).
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        Card(
          color: AppTheme.surface,
          child: const Padding(
            padding: EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Anima', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                SizedBox(height: 8),
                Text('Control + chat thin client of anima-daemon.'),
                SizedBox(height: 12),
                Text(
                  'The daemon owns all core state. The Godot pet renderer runs '
                  'on demand and outlives this window. The Vue web app remains '
                  'the full-UI behaviour reference.',
                ),
              ],
            ),
          ),
        ),
        const ListTile(
          title: Text('Gateway protocol'),
          subtitle: Text('airi-channel/1 · JSON text frames · WS /ws :6121'),
        ),
        const ListTile(
          title: Text('Design reference'),
          subtitle: Text('docs/design-flutter-godot-pivot.md'),
        ),
      ],
    );
  }
}
