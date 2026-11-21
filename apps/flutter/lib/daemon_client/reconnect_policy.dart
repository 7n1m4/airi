// SPDX-License-Identifier: GPL-3.0-or-later

/// Pure exponential-backoff schedule used when a previously authenticated
/// transport drops. No timers, no I/O — unit-testable in isolation.
class ReconnectPolicy {
  const ReconnectPolicy({
    this.initialDelay = const Duration(seconds: 1),
    this.multiplier = 2,
    this.maxDelay = const Duration(seconds: 30),
    this.maxAttempts = 5,
  }) : assert(multiplier >= 1, 'multiplier must be >= 1');

  final Duration initialDelay;
  final double multiplier;
  final Duration maxDelay;
  final int maxAttempts;

  /// Delay before attempt [attempt] (1-based). Capped at [maxDelay].
  Duration delayForAttempt(int attempt) {
    if (attempt <= 1) return initialDelay;
    final factor = multiplier == 1 ? 1.0 : _pow(multiplier, attempt - 1);
    final micros = initialDelay.inMicroseconds * factor;
    if (micros >= maxDelay.inMicroseconds) return maxDelay;
    return Duration(microseconds: micros.round());
  }

  /// False once the bounded retry budget is exhausted.
  bool shouldAttempt(int attempt) => attempt >= 1 && attempt <= maxAttempts;

  static double _pow(double base, int exponent) {
    var result = 1.0;
    for (var i = 0; i < exponent; i++) {
      result *= base;
    }
    return result;
  }
}
