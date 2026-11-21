// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/widgets.dart';

import 'app.dart';
import 'daemon_client/daemon_client.dart';

void main() {
  // One daemon client for the whole app. It holds view state only; all core
  // state lives in anima-daemon, so closing this window never stops the pet.
  runApp(AnimaApp(client: DaemonClient()));
}
