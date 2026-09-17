import type { GameAdapter, TurnPlan } from '../../types/arcade'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveArcadeProfile } from './profiles'
import { useArcadeAgent } from './use-arcade-agent'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('arcade Profiles', () => {
  it('resolves SimCity profile for various SimCity titles', () => {
    expect(resolveArcadeProfile('SimCity (1989)').id).toBe('simcity')
    expect(resolveArcadeProfile('sim city classic').id).toBe('simcity')
    expect(resolveArcadeProfile('SIMCITY 2000').id).toBe('simcity')
  })

  it('resolves 2048 profile for 2048 game', () => {
    expect(resolveArcadeProfile('2048 Puzzle').id).toBe('2048')
  })

  it('resolves generic profile for unknown titles', () => {
    expect(resolveArcadeProfile('Civilization').id).toBe('generic')
    expect(resolveArcadeProfile('Warcraft II').id).toBe('generic')
  })
})

describe('useArcadeAgent', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('initializes with idle state and invisible cursor', () => {
    const agent = useArcadeAgent()
    expect(agent.turnState.value).toBe('idle')
    expect(agent.cursorState.value.visible).toBe(false)
    expect(agent.autoPlay.value).toBe(false)
  })

  it('binds and unbinds game adapters', () => {
    const agent = useArcadeAgent()
    const mockAdapter: GameAdapter = {
      id: 'test-game',
      title: 'Test Game',
      engine: 'jsdos',
      captureFrame: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
      getCanvasElement: vi.fn().mockReturnValue(null),
      executeClick: vi.fn().mockResolvedValue(undefined),
      executeKeyPress: vi.fn().mockResolvedValue(undefined),
      executeTypeText: vi.fn().mockResolvedValue(undefined),
    }

    agent.bindAdapter(mockAdapter)
    expect(agent.activeAdapter.value?.id).toBe('test-game')

    agent.unbindAdapter()
    expect(agent.activeAdapter.value).toBeNull()
  })

  it('executes turn plan actions sequentially through the adapter', async () => {
    const agent = useArcadeAgent()
    const clickSpy = vi.fn().mockResolvedValue(undefined)
    const keySpy = vi.fn().mockResolvedValue(undefined)
    const duckSpy = vi.fn()

    const mockAdapter: GameAdapter = {
      id: 'test-simcity',
      title: 'SimCity',
      engine: 'jsdos',
      captureFrame: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
      getCanvasElement: vi.fn().mockReturnValue(null),
      executeClick: clickSpy,
      executeKeyPress: keySpy,
      executeTypeText: vi.fn().mockResolvedValue(undefined),
      duckAudio: duckSpy,
    }

    agent.bindAdapter(mockAdapter)

    const testPlan: TurnPlan = {
      plan: 'Click tool then press space',
      spoken_commentary: 'Building now!',
      emotion: 'excited',
      actions: [
        { type: 'click', x: 250, y: 350, label: 'Tool' },
        { type: 'key_press', key: 'Space', label: 'Pause' },
      ],
    }

    await agent.executePlan(testPlan)

    expect(duckSpy).toHaveBeenCalledWith(true)
    expect(clickSpy).toHaveBeenCalledWith(250, 350, undefined)
    expect(keySpy).toHaveBeenCalledWith('Space', undefined)
    expect(duckSpy).toHaveBeenCalledWith(false)
    expect(agent.turnState.value).toBe('idle')
  })

  it('handles emergency interrupt correctly', async () => {
    const agent = useArcadeAgent()
    const duckSpy = vi.fn()

    const mockAdapter: GameAdapter = {
      id: 'test-game',
      title: 'Test Game',
      engine: 'jsdos',
      captureFrame: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
      getCanvasElement: vi.fn().mockReturnValue(null),
      executeClick: vi.fn().mockResolvedValue(undefined),
      executeKeyPress: vi.fn().mockResolvedValue(undefined),
      executeTypeText: vi.fn().mockResolvedValue(undefined),
      duckAudio: duckSpy,
    }

    agent.bindAdapter(mockAdapter)
    agent.autoPlay.value = true

    agent.interrupt()

    expect(agent.autoPlay.value).toBe(false)
    expect(agent.cursorState.value.visible).toBe(false)
    expect(duckSpy).toHaveBeenCalledWith(false)
  })

  it('exposes customPromptAddendum ref and defaults to null', () => {
    const agent = useArcadeAgent()
    expect(agent.customPromptAddendum.value).toBeNull()

    agent.customPromptAddendum.value = '## CUSTOM USER STRATEGY:\n- Focus on roads first'
    expect(agent.customPromptAddendum.value).toContain('CUSTOM USER STRATEGY')
  })
})
