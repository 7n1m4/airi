// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

/// Placeholder chat surface. Streaming is deliberately NOT implemented here:
/// `token.delta` arrives with the Wave 0 event lane, and the streaming UI is
/// bead airi-wxp.3.3. The disabled composer sketches the eventual shape only.
class ChatScreen extends StatelessWidget {
  const ChatScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              Card(
                color: AppTheme.surface,
                child: const Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'Chat streaming is deferred. The daemon will emit token.delta '
                    'events once the Wave 0 event lane lands; this surface will '
                    'subscribe and render them then (bead airi-wxp.3.3).',
                  ),
                ),
              ),
            ],
          ),
        ),
        const SafeArea(
          child: Padding(
            padding: EdgeInsets.all(12),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    enabled: false,
                    decoration: InputDecoration(hintText: 'Chat input — deferred'),
                  ),
                ),
                SizedBox(width: 8),
                IconButton(onPressed: null, icon: Icon(Icons.send), tooltip: 'Send — deferred'),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
