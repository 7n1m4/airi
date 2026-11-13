import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useModsServerChannelStore } from './channel-server'

// Fake Client that never authenticates — drives the 5s auth-timeout safety path.
vi.mock('@proj-airi/server-sdk', () => {
  class FakeClient {
    constructor(public options: any) {}
    close() {}
    updateToken() {}
    getToken() { return '' }
    onEvent() {}
    offEvent() {}
    send() {}
  }
  return {
    Client: FakeClient,
    WebSocketEventSource: { StageWeb: 'stage-web', StageTamagotchi: 'stage-tamagotchi', StageCapacitor: 'stage-capacitor' },
  }
})

describe('useModsServerChannelStore initialize', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears initializing and marks unreachable after the auth timeout, and initialize() can be called again', async () => {
    const store = useModsServerChannelStore()

    const first = store.initialize()
    await vi.advanceTimersByTimeAsync(5000)
    await first

    expect(store.status).toBe('unreachable')
    expect(store.connected).toBe(false)

    // The timed-out attempt must not wedge initialize() into returning a stale promise.
    const second = store.initialize()
    await vi.advanceTimersByTimeAsync(5000)
    await second

    expect(store.status).toBe('unreachable')
    expect(store.connected).toBe(false)
  })
})
