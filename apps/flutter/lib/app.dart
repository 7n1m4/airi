// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/material.dart';

import 'daemon_client/daemon_client.dart';
import 'navigation/navigation_shell.dart';
import 'theme/app_theme.dart';

class AnimaApp extends StatelessWidget {
  const AnimaApp({super.key, required this.client});

  final DaemonClient client;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Anima',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark(),
      home: NavigationShell(client: client),
    );
  }
}
