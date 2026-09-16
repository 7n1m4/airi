import { describe, expect, it, vi } from 'vitest'

import { Nan0Kernel } from '../kernel/Nan0Kernel'
import { InMemoryStateStore } from '../persistence/InMemoryStateStore'
import { ControllableNan0Clock } from '../temporal/Nan0Clock'
import { CallbackHostBindings } from './CallbackHostBindings'
import { Nan0HostAdapter } from './Nan0HostAdapter'

describe('nan0HostAdapter metabolism lifecycle', () => {
  it('boots and registers before heartbeat start, then stops heartbeat before shutdown', async () => {
    const order: string[] = []
    const kernel = new Nan0Kernel({
      stateStore: new InMemoryStateStore(),
      clock: new ControllableNan0Clock({ wallTime: 1 }),
      reasoningClient: { async generate() { return { text: '' } } },
      createId: () => 'id',
    })
    const originalBoot = kernel.boot.bind(kernel)
    const originalShutdown = kernel.shutdown.bind(kernel)
    kernel.boot = async () => { order.push('kernel.boot'); await originalBoot() }
    kernel.shutdown = async () => { order.push('kernel.shutdown'); await originalShutdown() }
    const heartbeat = {
      start: vi.fn(() => order.push('heartbeat.start')),
      notify: vi.fn(),
      stop: vi.fn(() => order.push('heartbeat.stop')),
      getNextEvaluationAt: () => null,
      get running() { return false },
    }
    const adapter = new Nan0HostAdapter(kernel, new CallbackHostBindings(async () => {}), heartbeat)

    await adapter.start()
    await adapter.start()
    expect(order.slice(0, 2)).toEqual(['kernel.boot', 'heartbeat.start'])
    expect(heartbeat.start).toHaveBeenCalledOnce()
    await adapter.stop()
    expect(order.slice(-2)).toEqual(['heartbeat.stop', 'kernel.shutdown'])
    expect(kernel.isBooted).toBe(false)
  })
})
