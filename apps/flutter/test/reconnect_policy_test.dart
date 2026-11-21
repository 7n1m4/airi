// SPDX-License-Identifier: GPL-3.0-or-later

import 'package:flutter_test/flutter_test.dart';

import 'package:anima_control/daemon_client/daemon_client.dart';

void main() {
  test('backoff doubles and caps', () {
    const policy = ReconnectPolicy(
      initialDelay: Duration(seconds: 1),
      multiplier: 2,
      maxDelay: Duration(seconds: 4),
      maxAttempts: 6,
    );
    expect(policy.delayForAttempt(1), const Duration(seconds: 1));
    expect(policy.delayForAttempt(2), const Duration(seconds: 2));
    expect(policy.delayForAttempt(3), const Duration(seconds: 4));
    expect(policy.delayForAttempt(4), const Duration(seconds: 4));
    expect(policy.delayForAttempt(5), const Duration(seconds: 4));
  });

  test('retry budget is bounded', () {
    const policy = ReconnectPolicy(maxAttempts: 2);
    expect(policy.shouldAttempt(1), isTrue);
    expect(policy.shouldAttempt(2), isTrue);
    expect(policy.shouldAttempt(3), isFalse);
    expect(policy.shouldAttempt(0), isFalse);
  });
}
