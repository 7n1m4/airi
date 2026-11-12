import type { ElectrobunRpcPort } from '../src/shared'

import { defineEventa, defineInvoke, defineInvokeEventa, defineInvokeHandler } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import { errorEvent } from '../src/contract'
import { createContext as createMainContext } from '../src/main'
import { createContext as createViewContext } from '../src/view'

/**
 * Fake transport pair: two `createRPC`-shaped endpoints wired to each other.
 *
 * The view endpoint only sends requests (outbound) and receives messages
 * (inbound); the main endpoint receives requests and sends messages — the whole
 * Electrobun RPC surface eventa needs. Every packet goes through JSON, because
 * Electrobun serializes before sending.
 */

interface FakeMainRpc extends ElectrobunRpcPort {
  /** The inbound path a real app wires with `extraRequestHandlers`. */
  handleViewFrame: (frame: unknown) => void
}

function createTransportPair(): { main: FakeMainRpc, view: ElectrobunRpcPort } {
  const messageListeners = new Map<string, Set<(payload: unknown) => void>>()

  const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

  const main: FakeMainRpc = {
    // Registered at `defineRPC` time in a real app; each test points it at the
    // adapter it just created.
    handleViewFrame: () => {},
    async request() {
      throw new Error('the main endpoint never makes requests in this adapter')
    },
    send(message, payload) {
      if (message !== 'eventa:emit')
        throw new Error(`unexpected main→view message: ${message}`)
      for (const listener of messageListeners.get(message) ?? [])
        listener(wire(payload))
    },
    addMessageListener() {},
    removeMessageListener() {},
  }

  const view: ElectrobunRpcPort = {
    async request(method, params) {
      if (method !== 'eventa:emit')
        throw new Error(`unexpected view→main request: ${method}`)
      return main.handleViewFrame(wire(params))
    },
    send() {
      throw new Error('the view endpoint never sends messages in this adapter')
    },
    addMessageListener(message, listener) {
      if (!messageListeners.has(message))
        messageListeners.set(message, new Set())
      messageListeners.get(message)!.add(listener)
    },
    removeMessageListener(message, listener) {
      messageListeners.get(message)?.delete(listener)
    },
  }

  return { main, view }
}

describe('@proj-airi/electrobun-eventa', () => {
  it('(a) delivers an event emitted on the view at main handlers, and vice versa', async () => {
    const { main, view } = createTransportPair()

    const viewAdapter = createViewContext(view)
    const mainAdapter = createMainContext({ id: 7, rpc: main })
    main.handleViewFrame = frame => mainAdapter.receive(frame)

    const ping = defineEventa<{ text: string }>('test:eventa:ping')
    const pong = defineEventa<{ text: string }>('test:eventa:pong')

    const mainSeen: unknown[] = []
    const viewSeen: unknown[] = []
    mainAdapter.context.on(ping, event => mainSeen.push(event.body))
    viewAdapter.context.on(pong, event => viewSeen.push(event.body))

    viewAdapter.context.emit(ping, { text: 'from-view' })
    await vi.waitFor(() => expect(mainSeen).toEqual([{ text: 'from-view' }]))

    mainAdapter.context.emit(pong, { text: 'from-main' })
    await vi.waitFor(() => expect(viewSeen).toEqual([{ text: 'from-main' }]))

    viewAdapter.dispose()
    mainAdapter.dispose()
  })

  it('(b) resolves an invoke on the side that defines the handler, in both directions', async () => {
    const { main, view } = createTransportPair()

    const viewAdapter = createViewContext(view)
    const mainAdapter = createMainContext({ id: 3, rpc: main })
    main.handleViewFrame = frame => mainAdapter.receive(frame)

    const double = defineInvokeEventa<number, number>('test:invoke:double')
    const greet = defineInvokeEventa<string, string>('test:invoke:greet')

    defineInvokeHandler(mainAdapter.context, double, async value => value * 2)
    defineInvokeHandler(viewAdapter.context, greet, async name => `hi ${name}`)

    await expect(defineInvoke(viewAdapter.context, double)(21)).resolves.toBe(42)
    await expect(defineInvoke(mainAdapter.context, greet)('airi')).resolves.toBe('hi airi')

    viewAdapter.dispose()
    mainAdapter.dispose()
  })

  it('(c) rejects the invoke when a handler throws, and reports a dead transport on the error eventa', async () => {
    const { main, view } = createTransportPair()

    const viewAdapter = createViewContext(view)
    const mainAdapter = createMainContext({ id: 1, rpc: main })
    main.handleViewFrame = frame => mainAdapter.receive(frame)

    const boom = defineInvokeEventa<void, void>('test:invoke:boom')
    defineInvokeHandler(mainAdapter.context, boom, async () => {
      throw new Error('handler exploded')
    })

    // eventa carries the throw back as a receive-error eventa, so the caller
    // rejects with the handler's own error object.
    await expect(defineInvoke(viewAdapter.context, boom)()).rejects.toThrow('handler exploded')

    // A frame that never reaches the wire is reported on the sender's error
    // eventa instead of throwing out of `emit`.
    const errors: unknown[] = []
    const onAdapterError = vi.fn((event: { body?: { error?: unknown } }) => {
      errors.push(event.body?.error)
    })
    const dyingView = createViewContext({
      ...view,
      request: () => {
        throw new Error('transport is gone')
      },
    })
    dyingView.context.on(errorEvent, onAdapterError)

    const ping = defineEventa<number>('test:eventa:dead-transport')
    expect(() => dyingView.context.emit(ping, 1)).not.toThrow()
    await vi.waitFor(() => expect(onAdapterError).toHaveBeenCalled())
    expect((errors[0] as Error).message).toBe('transport is gone')

    dyingView.dispose()
    viewAdapter.dispose()
    mainAdapter.dispose()
  })

  it('(d) dispose() aborts in-flight invokes and unbinds the transport', async () => {
    const { main, view } = createTransportPair()

    const viewAdapter = createViewContext(view)
    const mainAdapter = createMainContext({ id: 9, rpc: main })
    main.handleViewFrame = frame => mainAdapter.receive(frame)

    const never = defineInvokeEventa<void, void>('test:invoke:never')
    defineInvokeHandler(mainAdapter.context, never, () => new Promise<void>(() => {}))

    const pending = defineInvoke(viewAdapter.context, never)()
    const settled = vi.waitFor(() => expect(pending).rejects.toThrow(/view rpc disposed/))

    viewAdapter.dispose()
    await settled
    expect(viewAdapter.context.signal.aborted).toBe(true)

    // The inbound binding is gone: a main→view emit now reaches nobody.
    const seen: unknown[] = []
    viewAdapter.context.on(defineEventa('test:eventa:after-dispose'), event => seen.push(event.body))
    mainAdapter.context.emit(defineEventa<number>('test:eventa:after-dispose'), 1)
    expect(seen).toEqual([])

    mainAdapter.dispose()
  })

  it('(e) onlySameWindow drops events from a different viewId', async () => {
    const { main, view } = createTransportPair()

    const mainAdapter = createMainContext({ id: 11, rpc: main }, { onlySameWindow: true })
    main.handleViewFrame = frame => mainAdapter.receive(frame)

    const ping = defineEventa<string>('test:eventa:windowed')
    const seen: unknown[] = []
    mainAdapter.context.on(ping, event => seen.push(event.body))

    // A frame from another window, as an unscoped main context would forward it:
    // `from` is the sender's own webview id, not this context's.
    mainAdapter.receive({
      id: ping.id,
      type: 'event',
      payload: { id: ping.id, type: 'event', body: 'from-another-view', from: 42 },
    })
    expect(seen).toEqual([])

    // The real view's frames pass the filter.
    // The renderer global a CEF view gets from Electrobun's preload.
    ;(globalThis as { window?: { __electrobunWebviewId?: number } }).window = { __electrobunWebviewId: 11 }
    const mineAdapter = createViewContext(view)
    mineAdapter.context.emit(ping, 'from-this-view')
    await vi.waitFor(() => expect(seen).toEqual(['from-this-view']))

    mineAdapter.dispose()
    mainAdapter.dispose()
  })
})
