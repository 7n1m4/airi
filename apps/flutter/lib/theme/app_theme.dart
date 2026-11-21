// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter/material.dart';

/// Dark, companion-oriented palette for the control surface.
///
/// NOTE: this is an intentional placeholder. Precise design parity with the
/// Vue web reference (`apps/stage-web`) is deferred to the UI-parity bead
/// (airi-wxp.3.7) alongside i18n/a11y work. Keep this file the single source of
/// colour decisions so that pass can be a local change.
abstract final class AppTheme {
  static const Color seed = Color(0xFF8AB4F8);
  static const Color canvas = Color(0xFF0E1117);
  static const Color surface = Color(0xFF171B24);
  static const Color subtle = Color(0xFF9AA4B2);

  static ThemeData dark() {
    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: seed,
        brightness: Brightness.dark,
      ),
      scaffoldBackgroundColor: canvas,
      visualDensity: VisualDensity.adaptivePlatformDensity,
    );
  }
}
