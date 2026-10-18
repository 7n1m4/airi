import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Client } from './client'

const { MockWebSocket } = vi.hoisted(() => {
  class MockWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readyState = MockWebSocket.CONNECTING
    onopen: ((e?: unknown) => void) | null = null
    onclose: ((e?: unknown) => void) | null = null
    onerror: ((e?: unknown) => void) | null = null
    onmessage: ((e: { data: unknown }) => void) | null = null
    sent: unknown[] = []
    close = vi.fn(function (this: MockWebSocket) { this.readyState = MockWebSocket.CLOSED; this.onclose?.() })
    send = vi.fn(function (this: MockWebSocket, data: unknown) { this.sent.push(data) })
    ping = vi.fn()
    pong = vi.fn()
    constructor(_url: string) {
      const self = this
      queueMicrotask(() => {
        self.readyState = MockWebSocket.OPEN
        self.onopen?.()
      })
      ;(MockWebSocket as unknown as { instances: unknown[] }).instances.push(self)
    }
  }
  ;(MockWebSocket as unknown as { instances: unknown[] }).instances = []
  return { MockWebSocket }
})

vi.mock('@moeru/std', () => ({
  sleep: vi.fn(async () => {}),
}))

vi.mock('crossws/websocket', () => ({
  default: MockWebSocket,
}))

describe('client', () => {
  beforeEach(() => {
    ;(MockWebSocket as unknown as { instances: unknown[] }).instances = []
  })

  it('constructs and connects', async () => {
    const c = new Client({ name: 'test', autoConnect: false })
    const p = c.connect()
    await p
    const instances = (MockWebSocket as unknown as { instances: unknown[] }).instances
    expect(instances.length).toBe(1)
  })

  it('handles message dispatch', async () => {
    const onAny = vi.fn()
    const cb = vi.fn()
    const c = new Client({ name: 'test', autoConnect: false, onAnyMessage: onAny })
    c.onEvent('module:authenticated' as never, cb)
    const p = c.connect()
    await p
    const instances = (MockWebSocket as unknown as { instances: unknown[] }).instances
    const ws = instances[0] as { onmessage?: (e: { data: unknown }) => void }
    const msg = { type: 'module:authenticated', data: { authenticated: true } }
    ws.onmessage?.({ data: JSON.stringify(msg) })
    await Promise.resolve()
    expect(cb).toHaveBeenCalled()
    expect(onAny).toHaveBeenCalled()
  })

  it('send and close', async () => {
    const c = new Client({ name: 'test', autoConnect: false })
    const p = c.connect()
    await p
    c.send({ type: 'x' } as never)
    c.sendRaw('raw')
    c.close()
  })

  it('updateToken', async () => {
    const c = new Client({ name: 'test', autoConnect: false, token: 't' })
    c.updateToken('t2')
    c.updateToken('t2')
    c.getToken()
  })

  it('offEvent', () => {
    const c = new Client({ name: 'test', autoConnect: false })
    const cb = vi.fn()
    c.onEvent('error' as never, cb)
    c.offEvent('error' as never, cb)
    c.offEvent('error' as never)
  })

  it('handle empty/invalid messages', async () => {
    const onError = vi.fn()
    const c = new Client({ name: 'test', autoConnect: false, onError })
    const p = c.connect()
    await p
    const instances = (MockWebSocket as unknown as { instances: unknown[] }).instances
    const ws = instances[0] as { onmessage?: (e: { data: unknown }) => void }
    ws.onmessage?.({ data: 'not json' })
    await Promise.resolve()
    ws.onmessage?.({ data: JSON.stringify({}) })
    await Promise.resolve()
    ws.onmessage?.({ data: JSON.stringify(null) })
    await Promise.resolve()
  })
})
