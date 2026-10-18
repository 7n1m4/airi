import { describe, it, vi } from 'vitest'

import { runUntilSignal } from './process'

describe('runUntilSignal', () => {
  it('runs', () => {
    vi.useFakeTimers()
    runUntilSignal()
    vi.advanceTimersByTime(20)
    vi.useRealTimers()
  })
})
