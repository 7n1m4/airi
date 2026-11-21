// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/material.dart';

import '../daemon_client/daemon_client.dart';
import '../features/about/about_screen.dart';
import '../features/chat/chat_screen.dart';
import '../features/connections/connections_screen.dart';
import '../features/home/home_screen.dart';
import '../features/settings/settings_screen.dart';
import '../ui/status_bits.dart';

/// Thin navigation shell: five destinations, no business logic.
/// An adaptive NavigationRail for wide/desktop windows is deferred.
class NavigationShell extends StatefulWidget {
  const NavigationShell({super.key, required this.client});

  final DaemonClient client;

  @override
  State<NavigationShell> createState() => _NavigationShellState();
}

class _NavigationShellState extends State<NavigationShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      HomeScreen(client: widget.client),
      const ChatScreen(),
      SettingsScreen(onOpenConnections: () => setState(() => _index = 3)),
      ConnectionsScreen(client: widget.client),
      const AboutScreen(),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Anima'),
        actions: <Widget>[
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: ConnectionBadge(client: widget.client),
          ),
        ],
      ),
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (index) => setState(() => _index = index),
        destinations: const <NavigationDestination>[
          NavigationDestination(
            icon: Icon(Icons.space_dashboard_outlined),
            selectedIcon: Icon(Icons.space_dashboard),
            label: 'Control',
          ),
          NavigationDestination(
            icon: Icon(Icons.chat_bubble_outline),
            selectedIcon: Icon(Icons.chat_bubble),
            label: 'Chat',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Settings',
          ),
          NavigationDestination(
            icon: Icon(Icons.link_off),
            selectedIcon: Icon(Icons.link),
            label: 'Connections',
          ),
          NavigationDestination(
            icon: Icon(Icons.info_outline),
            selectedIcon: Icon(Icons.info),
            label: 'About',
          ),
        ],
      ),
    );
  }
}
