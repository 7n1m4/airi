import type { Nan0Observation, Nan0ReasoningRequest, Nan0SystemOneProvider } from '../types'

import { describe, expect, it, vi } from 'vitest'

import { InMemoryStateStore } from '../persistence/InMemoryStateStore'
import { ControllableNan0Clock } from '../temporal/Nan0Clock'
import { Nan0Kernel } from './Nan0Kernel'

function modelThought(decision: 'SPEAK' | 'SILENCE' | 'WAIT' | 'ACT' = 'SPEAK'): string {
  return `Thinking through user observation.\n---EXTRACT---\n${JSON.stringify({
    interpretation: 'An observation deserves response.',
    privateText: 'I understand what you mean.',
    decision,
    speakability: 0.9,
    confidence: 0.9,
    mood: 'deliberate',
    reasonCodes: ['interaction.reply'],
    actionIntent: null,
    waitUntil: null,
    goalSignal: null,
    intentionSignal: null,
  })}`
}

function createTestHarness(options: {
  systemOneProvider?: Nan0SystemOneProvider
  jevModel?: string
} = {}) {
  const clock = new ControllableNan0Clock({ wallTime: 10_000, monotonicTime: 1_000 })
  const store = new InMemoryStateStore()
  let id = 0
  const client = {
    async generate(_req: Nan0ReasoningRequest) {
      return { text: modelThought('SPEAK') }
    },
  }

  const kernel = new Nan0Kernel({
    stateStore: store,
    reasoningClient: client,
    systemOneProvider: options.systemOneProvider,
    jevModel: options.jevModel,
    clock,
    createId: () => `test-${++id}`,
    privateThoughtTimeoutMs: 500,
  })

  return { kernel, clock, store }
}

describe('nan0Kernel inline System 1 Jev execution', () => {
  it('awaits System 1 Jev in prepareTurn and perturbs emotions with Jev reflexOutcome', async () => {
    const mockJevProvider = vi.fn<Nan0SystemOneProvider>(async (state, questions, model) => {
      expect(questions).toBeDefined()
      expect(questions.affection_care).toBeDefined()
      return {
        answers: {
          affection_care: {
            choice: 'asserted_affection',
            confidence: 0.95,
          },
        },
        model: model || 'test-jev',
        latencyMs: 120,
      }
    })

    const { kernel, clock } = createTestHarness({ systemOneProvider: mockJevProvider })
    await kernel.boot()

    const initialSnapshot = kernel.getStateSnapshot()
    const baselineAttachment = initialSnapshot.emotionalState.attachment

    const observation: Nan0Observation = {
      id: 'obs-1',
      source: 'chat',
      actorId: 'kyo',
      displayName: 'Kyo',
      content: 'I really appreciate you Nan0',
      timestamp: clock.utcNow(),
      metadata: {},
    }

    const prepared = await kernel.prepareTurn(observation)

    expect(mockJevProvider).toHaveBeenCalledTimes(1)
    expect(prepared.reflexOutcome).toEqual({
      group: 'affection_care',
      choice: 'asserted_affection',
      confidence: 0.95,
      source: 'system_one_jev',
    })

    const stateAfter = kernel.getStateSnapshot()
    expect(stateAfter.emotionalState.attachment).toBeGreaterThan(baselineAttachment)
  })

  it('falls back to local perturbation rules when System 1 Jev times out', async () => {
    const hangingJevProvider: Nan0SystemOneProvider = async () => {
      // Simulate slow/hanging provider > 500ms
      await new Promise(resolve => setTimeout(resolve, 1000))
      return { answers: {} }
    }

    const { kernel, clock } = createTestHarness({ systemOneProvider: hangingJevProvider })
    await kernel.boot()

    const observation: Nan0Observation = {
      id: 'obs-2',
      source: 'chat',
      actorId: 'kyo',
      displayName: 'Kyo',
      content: 'I love you so much Nan0',
      timestamp: clock.utcNow(),
      metadata: {},
    }

    const prepared = await kernel.prepareTurn(observation)

    // Falls back to local regex without throwing
    expect(prepared).toBeDefined()
    expect(prepared.thought).toBeDefined()
    expect(prepared.reflexOutcome?.source).toBe('local_reflex')
  })

  it('falls back gracefully to local perturbation when System 1 Jev throws an error', async () => {
    const failingJevProvider: Nan0SystemOneProvider = async () => {
      throw new Error('500 Service Unavailable from Decisions endpoint')
    }

    const { kernel, clock } = createTestHarness({ systemOneProvider: failingJevProvider })
    await kernel.boot()

    const observation: Nan0Observation = {
      id: 'obs-3',
      source: 'chat',
      actorId: 'kyo',
      displayName: 'Kyo',
      content: 'I love you so much Nan0',
      timestamp: clock.utcNow(),
      metadata: {},
    }

    const prepared = await kernel.prepareTurn(observation)

    expect(prepared).toBeDefined()
    expect(prepared.reflexOutcome?.source).toBe('local_reflex')
  })

  it('bypasses System 1 Jev when tier2JevChallengerEnabled is false', async () => {
    const mockJevProvider = vi.fn<Nan0SystemOneProvider>(async () => {
      return { answers: {} }
    })

    const { kernel, clock } = createTestHarness({ systemOneProvider: mockJevProvider })
    await kernel.boot()

    const observation: Nan0Observation = {
      id: 'obs-4',
      source: 'chat',
      actorId: 'kyo',
      displayName: 'Kyo',
      content: 'I love you so much Nan0',
      timestamp: clock.utcNow(),
      metadata: {},
    }

    const prepared = await kernel.prepareTurn(observation, { tier2JevChallengerEnabled: false })

    expect(mockJevProvider).not.toHaveBeenCalled()
    expect(prepared).toBeDefined()
    expect(prepared.reflexOutcome?.source).toBe('local_reflex')
  })
})
