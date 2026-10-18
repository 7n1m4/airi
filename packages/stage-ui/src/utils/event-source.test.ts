import { describe, expect, it } from 'vitest'

import { getEventSourceKey } from './event-source'

type EventSourceKeyInput = Parameters<typeof getEventSourceKey>[0]

describe('getEventSourceKey', () => {
  it('uses eventMetadata source with instance id', () => {
    const event = {
      eventMetadata: { source: { id: 'inst-1', kind: 'plugin', plugin: { id: 'plugin-a', name: 'Plugin A' } } },
    } as unknown as EventSourceKeyInput
    expect(getEventSourceKey(event)).toBe('plugin-a:inst-1')
  })

  it('uses eventMetadata source without instance id', () => {
    const event = {
      eventMetadata: { source: { id: '', kind: 'plugin', plugin: { id: 'plugin-a', name: 'Plugin A' } } },
    } as unknown as EventSourceKeyInput
    expect(getEventSourceKey(event)).toBe('plugin-a')
  })

  it('falls back to metadata source', () => {
    const event = {
      metadata: { source: { id: 'inst-2', kind: 'plugin', plugin: { id: 'plugin-b', name: 'Plugin B' } } },
    } as unknown as EventSourceKeyInput
    expect(getEventSourceKey(event)).toBe('plugin-b:inst-2')
  })

  it('falls back to source string', () => {
    const event = { source: 'src-1' } as unknown as EventSourceKeyInput
    expect(getEventSourceKey(event)).toBe('src-1')
  })

  it('falls back to contextId stripping system: prefix', () => {
    const event = { contextId: 'system:abc' } as unknown as EventSourceKeyInput
    expect(getEventSourceKey(event)).toBe('abc')
  })

  it('returns contextId unchanged when no system: prefix', () => {
    const event = { contextId: 'ctx-1' } as unknown as EventSourceKeyInput
    expect(getEventSourceKey(event)).toBe('ctx-1')
  })

  it('uses custom fallback', () => {
    const event = {} as unknown as EventSourceKeyInput
    expect(getEventSourceKey(event, 'fallback-x')).toBe('fallback-x')
  })

  it('uses default fallback unknown', () => {
    const event = {} as unknown as EventSourceKeyInput
    expect(getEventSourceKey(event)).toBe('unknown')
  })

  it('prefers eventMetadata over metadata', () => {
    const event = {
      eventMetadata: { source: { id: 'e', kind: 'plugin', plugin: { id: 'p-e', name: 'E' } } },
      metadata: { source: { id: 'm', kind: 'plugin', plugin: { id: 'p-m', name: 'M' } } },
      source: 'src',
      contextId: 'system:ctx',
    } as unknown as EventSourceKeyInput
    expect(getEventSourceKey(event)).toBe('p-e:e')
  })

  it('skips eventMetadata when plugin missing', () => {
    const event = {
      eventMetadata: { source: { id: 'x', kind: 'plugin' } },
      source: 'src',
    } as unknown as EventSourceKeyInput
    expect(getEventSourceKey(event)).toBe('src')
  })
})
