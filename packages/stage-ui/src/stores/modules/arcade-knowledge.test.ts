import type { AcquiredGameKnowledge } from '../../types/arcade'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useArcadeKnowledgeStore } from './arcade-knowledge'

// In-memory mock storage for localforage
const mockDb = new Map<string, any>()

vi.mock('localforage', () => ({
  default: {
    createInstance: vi.fn(() => ({
      iterate: vi.fn(async (cb: (value: any, key: string) => void) => {
        for (const [key, value] of mockDb.entries()) {
          cb(value, key)
        }
      }),
      getItem: vi.fn(async (key: string) => mockDb.get(key) || null),
      setItem: vi.fn(async (key: string, value: any) => {
        mockDb.set(key, value)
        return value
      }),
      removeItem: vi.fn(async (key: string) => {
        mockDb.delete(key)
      }),
      clear: vi.fn(async () => {
        mockDb.clear()
      }),
    })),
  },
}))

describe('arcade knowledge store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockDb.clear()
  })

  const sampleKnowledge: AcquiredGameKnowledge = {
    gameId: 'qbasic_nibbles',
    gameTitle: 'Nibbles',
    acquiredAt: 1727600000000,
    lastPlayedAt: 1727600000000,
    motionArchitecture: 'fixed_single_screen',
    recommendedSystem: 'system1_reflex',
    gameplayPace: 'real_time_fast',
    persona: 'hype_coach',
    system1Engine: 'laya_local',
    strategySummary: 'Snake eating numbers on a 20x20 grid without hitting borders.',
    playCount: 1,
    highScore: 120,
    miniProgram: {
      id: 'mp-nibbles-1',
      gameId: 'qbasic_nibbles',
      version: 1,
      code: 'function evaluateGameState() { return "up"; }',
      inputSpec: { keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], intervalMs: 60 },
    },
  }

  it('initializes empty and loads persisted knowledge', async () => {
    mockDb.set('qbasic_nibbles', sampleKnowledge)
    const store = useArcadeKnowledgeStore()

    expect(store.isInitialized).toBe(false)
    await store.initialize()
    expect(store.isInitialized).toBe(true)
    expect(store.acquiredCount).toBe(1)
    expect(store.hasKnowledge('qbasic_nibbles')).toBe(true)
    expect(store.getKnowledge('qbasic_nibbles')?.gameTitle).toBe('Nibbles')
  })

  it('saves new knowledge profile into reactive state and indexeddb', async () => {
    const store = useArcadeKnowledgeStore()
    await store.initialize()

    await store.saveKnowledge(sampleKnowledge)
    expect(store.hasKnowledge('qbasic_nibbles')).toBe(true)
    expect(mockDb.has('qbasic_nibbles')).toBe(true)
    expect(store.acquiredCount).toBe(1)
  })

  it('records play sessions and updates high scores', async () => {
    const store = useArcadeKnowledgeStore()
    await store.initialize()
    await store.saveKnowledge(sampleKnowledge)

    const initialPlayedAt = store.getKnowledge('qbasic_nibbles')!.lastPlayedAt
    await store.recordSession('qbasic_nibbles', { score: 250 })

    const updated = store.getKnowledge('qbasic_nibbles')!
    expect(updated.playCount).toBe(2)
    expect(updated.highScore).toBe(250)
    expect(updated.lastPlayedAt).toBeGreaterThanOrEqual(initialPlayedAt)
  })

  it('deletes knowledge profile', async () => {
    const store = useArcadeKnowledgeStore()
    await store.initialize()
    await store.saveKnowledge(sampleKnowledge)
    expect(store.hasKnowledge('qbasic_nibbles')).toBe(true)

    await store.deleteKnowledge('qbasic_nibbles')
    expect(store.hasKnowledge('qbasic_nibbles')).toBe(false)
    expect(mockDb.has('qbasic_nibbles')).toBe(false)
    expect(store.acquiredCount).toBe(0)
  })

  it('exports and imports knowledge json', async () => {
    const store = useArcadeKnowledgeStore()
    await store.initialize()
    await store.saveKnowledge(sampleKnowledge)

    const exported = store.exportKnowledgeJson('qbasic_nibbles')
    expect(exported).toBeTruthy()
    expect(exported).toContain('Snake eating numbers')

    await store.deleteKnowledge('qbasic_nibbles')
    expect(store.hasKnowledge('qbasic_nibbles')).toBe(false)

    const imported = await store.importKnowledgeJson(exported!)
    expect(imported.gameId).toBe('qbasic_nibbles')
    expect(store.hasKnowledge('qbasic_nibbles')).toBe(true)
  })
})
