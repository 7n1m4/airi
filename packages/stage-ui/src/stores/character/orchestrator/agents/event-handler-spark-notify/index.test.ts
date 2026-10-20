import type { WebSocketEventOf } from '@proj-airi/server-sdk'

import type { SparkNotifyAgentDeps } from './index'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupAgentSparkNotifyHandler, sparkCommandSchema } from './index'

type StreamOpts = Parameters<SparkNotifyAgentDeps['stream']>[3]

function makeEvent(overrides: { data?: Record<string, unknown>, source?: unknown } = {}): WebSocketEventOf<'spark:notify'> {
  return {
    data: { id: 'evt-1', urgency: 'normal', ...overrides.data },
    source: overrides.source ?? { name: 'mod' },
  } as unknown as WebSocketEventOf<'spark:notify'>
}

describe('sparkCommandSchema', () => {
  it('validates minimal commands', () => {
    const r = sparkCommandSchema.safeParse({ commands: [{ destinations: ['a'], interrupt: null, priority: null, intent: null, ack: 'ok', guidance: null }] })
    expect(r.success).toBe(true)
  })
})

describe('setupAgentSparkNotifyHandler', () => {
  let deps: SparkNotifyAgentDeps
  beforeEach(() => {
    deps = {
      stream: vi.fn(async (_m, _p, _msgs, opts: StreamOpts) => {
        await opts.onStreamEvent!({ type: 'text-delta', text: 'hi' })
        await opts.onStreamEvent!({ type: 'finish' })
      }) as unknown as SparkNotifyAgentDeps['stream'],
      getActiveProvider: vi.fn(() => 'p'),
      getActiveModel: vi.fn(() => 'm'),
      getProviderInstance: vi.fn(async () => ({})) as unknown as SparkNotifyAgentDeps['getProviderInstance'],
      onReactionDelta: vi.fn(),
      onReactionEnd: vi.fn(),
      getSystemPrompt: vi.fn(() => 'sys'),
      getProcessing: vi.fn(() => false),
      setProcessing: vi.fn(),
      getPending: vi.fn(() => []),
      setPending: vi.fn(),
    }
  })

  it('returns undefined when missing provider/model', async () => {
    deps.getActiveProvider = vi.fn(() => undefined)
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const res = await handle(makeEvent())
    expect(res).toBeUndefined()
  })

  it('queues when pending and not immediate', async () => {
    deps.getPending = vi.fn(() => [makeEvent()])
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const ev = makeEvent({ data: { urgency: 'normal' } })
    const res = await handle(ev)
    expect(res).toBeUndefined()
    expect(deps.setPending).toHaveBeenCalled()
  })

  it('queues when processing', async () => {
    deps.getProcessing = vi.fn(() => true)
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const ev = makeEvent({ data: { urgency: 'immediate' } })
    const res = await handle(ev)
    expect(res).toBeUndefined()
    expect(deps.setPending).toHaveBeenCalled()
  })

  it('runs agent and returns commands (none)', async () => {
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const ev = makeEvent({ data: { urgency: 'immediate', id: 'e1' } })
    const res = await handle(ev)
    expect(res).toEqual({ commands: [] })
    expect(deps.onReactionDelta).toHaveBeenCalled()
    expect(deps.onReactionEnd).toHaveBeenCalled()
  })

  it('noResponse tool path', async () => {
    deps.stream = vi.fn(async (_m, _p, _msgs, opts: StreamOpts) => {
      const noRespTool = opts.tools![0]
      await noRespTool.execute({})
      await opts.onStreamEvent!({ type: 'text-delta', text: 'ignored' })
      await opts.onStreamEvent!({ type: 'finish' })
    }) as unknown as SparkNotifyAgentDeps['stream']
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const ev = makeEvent({ data: { urgency: 'immediate', id: 'e2' } })
    await handle(ev)
    expect(deps.onReactionDelta).not.toHaveBeenCalledWith('e2', 'ignored')
    expect(deps.onReactionEnd).toHaveBeenCalledWith('e2', '')
  })

  it('error stream event throws', async () => {
    deps.stream = vi.fn(async (_m, _p, _msgs, opts: StreamOpts) => {
      await opts.onStreamEvent!({ type: 'error', error: new Error('boom') })
    }) as unknown as SparkNotifyAgentDeps['stream']
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const ev = makeEvent({ data: { urgency: 'immediate', id: 'e3' } })
    await expect(handle(ev)).rejects.toThrow('boom')
  })

  it('command tool creates command and filters destinations', async () => {
    deps.stream = vi.fn(async (_m, _p, _msgs, opts: StreamOpts) => {
      const cmdTool = opts.tools![1]
      await cmdTool.execute({ commands: [{ destinations: ['a'], interrupt: 'false', priority: 'high', intent: 'plan', ack: 'ack', guidance: null }] })
      await opts.onStreamEvent!({ type: 'finish' })
    }) as unknown as SparkNotifyAgentDeps['stream']
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const ev = makeEvent({ data: { urgency: 'immediate', id: 'e4' } })
    const res = await handle(ev)
    expect(res?.commands?.length).toBe(1)
    expect(res?.commands?.[0].destinations).toEqual(['a'])
  })

  it('command tool invalid params returns error string', async () => {
    deps.stream = vi.fn(async (_m, _p, _msgs, opts: StreamOpts) => {
      const cmdTool = opts.tools![1]
      const r = await cmdTool.execute({ commands: [{ destinations: [] }] })
      expect(String(r)).toContain('Error')
      await opts.onStreamEvent!({ type: 'finish' })
    }) as unknown as SparkNotifyAgentDeps['stream']
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const ev = makeEvent({ data: { urgency: 'immediate', id: 'e5' } })
    await handle(ev)
  })

  it('command tool maps guidance persona and options', async () => {
    deps.stream = vi.fn(async (_m, _p, _msgs, opts: StreamOpts) => {
      const cmdTool = opts.tools![1]
      await cmdTool.execute({ commands: [{
        destinations: ['a', 'b'],
        interrupt: 'soft',
        priority: null,
        intent: null,
        ack: '',
        guidance: {
          type: 'instruction',
          persona: [{ strength: 'high', traits: 'bravery' }],
          options: [{
            label: 'opt',
            steps: ['s1'],
            rationale: 'r',
            possibleOutcome: ['o'],
            risk: 'low',
            fallback: ['f'],
            triggers: ['t'],
          }],
        },
      }] })
      await opts.onStreamEvent!({ type: 'finish' })
    }) as unknown as SparkNotifyAgentDeps['stream']
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const ev = makeEvent({ data: { urgency: 'immediate', id: 'e7' } })
    const res = await handle(ev)
    expect(res?.commands?.[0].guidance?.persona).toEqual({ bravery: 'high' })
    expect(res?.commands?.[0].guidance?.options[0].possibleOutcome).toEqual(['o'])
    expect(res?.commands?.[0].guidance?.options[0].fallback).toEqual(['f'])
    expect(res?.commands?.[0].guidance?.options[0].triggers).toEqual(['t'])
    expect(res?.commands?.[0].priority).toBe('normal')
    expect(res?.commands?.[0].intent).toBe('action')
    expect(res?.commands?.[0].ack).toBeUndefined()
    expect(res?.commands?.[0].interrupt).toBe('soft')
  })

  it('command tool maps empty guidance fields', async () => {
    deps.stream = vi.fn(async (_m, _p, _msgs, opts: StreamOpts) => {
      const cmdTool = opts.tools![1]
      await cmdTool.execute({ commands: [{
        destinations: ['a'],
        interrupt: 'force',
        priority: 'low',
        intent: 'context',
        ack: 'ack',
        guidance: {
          type: 'proposal',
          persona: null,
          options: [{
            label: 'opt2',
            steps: [],
            rationale: null,
            possibleOutcome: [],
            risk: 'none',
            fallback: [],
            triggers: [],
          }],
        },
      }] })
      await opts.onStreamEvent!({ type: 'finish' })
    }) as unknown as SparkNotifyAgentDeps['stream']
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const ev = makeEvent({ data: { urgency: 'immediate', id: 'e8' } })
    const res = await handle(ev)
    expect(res?.commands?.[0].guidance?.persona).toBeUndefined()
    expect(res?.commands?.[0].guidance?.options[0].possibleOutcome).toBeUndefined()
    expect(res?.commands?.[0].guidance?.options[0].fallback).toBeUndefined()
    expect(res?.commands?.[0].guidance?.options[0].triggers).toBeUndefined()
    expect(res?.commands?.[0].interrupt).toBe('force')
  })

  it('filters commands with empty destinations', async () => {
    deps.stream = vi.fn(async (_m, _p, _msgs, opts: StreamOpts) => {
      const cmdTool = opts.tools![1]
      await cmdTool.execute({ commands: [{ destinations: [], interrupt: null, priority: null, intent: null, ack: '', guidance: null }] })
      await opts.onStreamEvent!({ type: 'finish' })
    }) as unknown as SparkNotifyAgentDeps['stream']
    const { handle } = setupAgentSparkNotifyHandler(deps)
    const ev = makeEvent({ data: { urgency: 'immediate', id: 'e6' } })
    const res = await handle(ev)
    expect(res?.commands).toEqual([])
  })
})
