import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useStartupResourcesStore } from './startup-resources'

const MILESTONES = ['core-services', 'sync-engine', 'character-card', 'stage-actor'] as const

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useStartupResourcesStore', () => {
  it('starts empty with zero progress and not ready', () => {
    const store = useStartupResourcesStore()
    expect(store.resources).toEqual([])
    expect(store.progress).toBe(0)
    expect(store.ready).toBe(false)
    expect(store.failed).toBeUndefined()
  })

  it('registers milestones as queued', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    expect(store.resources.map(r => r.status)).toEqual(['queued', 'queued', 'queued', 'queued'])
    expect(store.progress).toBe(0)
    expect(store.ready).toBe(false)
  })

  it('rejects double registration', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    expect(() => store.register(MILESTONES)).toThrow('Startup resources are already registered')
  })

  it('requires loading before completing', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    store.complete('core-services')
    expect(store.resources[0].status).toBe('queued')
    store.start('core-services')
    expect(store.resources[0].status).toBe('loading')
    store.complete('core-services')
    expect(store.resources[0].status).toBe('ready')
  })

  it('computes progress arithmetically across four milestones', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    for (const [index, id] of MILESTONES.entries()) {
      store.start(id)
      store.complete(id)
      expect(store.progress).toBe(Math.round(((index + 1) / MILESTONES.length) * 100))
    }
    expect(store.progress).toBe(100)
    expect(store.ready).toBe(true)
  })

  it('counts skipped stage-actor as finished for text-only companions', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    for (const id of ['core-services', 'sync-engine', 'character-card'] as const) {
      store.start(id)
      store.complete(id)
    }
    expect(store.progress).toBe(75)
    expect(store.ready).toBe(false)
    store.skip('stage-actor')
    expect(store.resources[3].status).toBe('skipped')
    expect(store.progress).toBe(100)
    expect(store.ready).toBe(true)
  })

  it('skips from loading as well as queued', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    store.start('stage-actor')
    store.skip('stage-actor')
    expect(store.resources[3].status).toBe('skipped')
  })

  it('marks failure with error message and blocks ready', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    store.start('sync-engine')
    store.fail('sync-engine', new Error('IndexedDB unavailable'))
    expect(store.resources[1].status).toBe('failed')
    expect(store.failed?.id).toBe('sync-engine')
    expect(store.failed?.error).toBe('IndexedDB unavailable')
    expect(store.ready).toBe(false)
    expect(store.progress).toBe(0)
  })

  it('stringifies non-Error failure reasons', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    store.fail('core-services', 'timeout')
    expect(store.failed?.error).toBe('timeout')
  })

  it('ignores transitions for unknown ids', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    store.start('unknown')
    store.complete('unknown')
    store.skip('unknown')
    store.fail('unknown', 'boom')
    expect(store.resources.every(r => r.status === 'queued')).toBe(true)
    expect(store.failed).toBeUndefined()
  })

  it('rejects registration with duplicate ids', () => {
    const store = useStartupResourcesStore()
    expect(() => store.register(['dup', 'dup'])).toThrow('Startup resource IDs must be unique')
  })

  it('recovers from failed state via skip (continue without avatar path)', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    for (const id of ['core-services', 'sync-engine', 'character-card'] as const) {
      store.start(id)
      store.complete(id)
    }
    store.start('stage-actor')
    store.fail('stage-actor', new Error('Shader compilation failed'))

    expect(store.failed?.id).toBe('stage-actor')
    expect(store.ready).toBe(false)
    expect(store.progress).toBe(75)

    // User chooses "Continue without avatar"
    store.skip('stage-actor')

    expect(store.resources[3].status).toBe('skipped')
    expect(store.resources[3].error).toBeUndefined()
    expect(store.failed).toBeUndefined()
    expect(store.progress).toBe(100)
    expect(store.ready).toBe(true)
  })

  it('restarts a failed resource on retry', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    store.start('core-services')
    store.fail('core-services', new Error('IPC timeout'))

    expect(store.failed?.id).toBe('core-services')

    // Retry action restarts the milestone
    store.start('core-services')
    expect(store.resources[0].status).toBe('loading')
    expect(store.resources[0].error).toBeUndefined()
    expect(store.failed).toBeUndefined()

    store.complete('core-services')
    expect(store.resources[0].status).toBe('ready')
  })

  it('executes async run helper and completes on success', async () => {
    const store = useStartupResourcesStore()
    store.register(['task-a'])

    let executed = false
    await store.run('task-a', async () => {
      executed = true
    })

    expect(executed).toBe(true)
    expect(store.resources[0].status).toBe('ready')
    expect(store.ready).toBe(true)
  })

  it('executes async run helper and records failure on rejection', async () => {
    const store = useStartupResourcesStore()
    store.register(['task-b'])

    await expect(store.run('task-b', async () => {
      throw new Error('Network failure')
    })).rejects.toThrow('Network failure')

    expect(store.resources[0].status).toBe('failed')
    expect(store.failed?.error).toBe('Network failure')
    expect(store.ready).toBe(false)
  })

  it('resets to empty for reuse', () => {
    const store = useStartupResourcesStore()
    store.register(MILESTONES)
    store.start('core-services')
    store.complete('core-services')
    store.reset()
    expect(store.resources).toEqual([])
    expect(store.progress).toBe(0)
    expect(store.ready).toBe(false)
  })
})
