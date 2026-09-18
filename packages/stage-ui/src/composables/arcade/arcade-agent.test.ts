import type { GameAdapter, TurnPlan } from '../../types/arcade'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveArcadeProfile } from './profiles'
import { useArcadeAgent } from './use-arcade-agent'
import { burnCoordinateGridToCanvas, drawCoordinateGrid } from './utils/grid-overlay'

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

  it('contains calibrated tool palette coordinates for SimCity DOS', () => {
    const profile = resolveArcadeProfile('SimCity')
    expect(profile.systemPromptAddendum).toContain('Row 1 (~Y: 230): Bulldozer')
    expect(profile.systemPromptAddendum).toContain('Row 7 (~Y: 630): Airport')
    expect(profile.systemPromptAddendum).toContain('Column 1 (Left, ~X: 52)')
    expect(profile.systemPromptAddendum).toContain('Column 2 (Right, ~X: 88)')
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

  it('supports replaying a plan multiple times and keeps currentTurnPlan updated', async () => {
    const agent = useArcadeAgent()
    const clickSpy = vi.fn().mockResolvedValue(undefined)
    const mockAdapter: GameAdapter = {
      id: 'test-game',
      title: 'Test Game',
      engine: 'jsdos',
      captureFrame: vi.fn().mockResolvedValue(null),
      getCanvasElement: vi.fn().mockReturnValue(null),
      executeClick: clickSpy,
      executeKeyPress: vi.fn().mockResolvedValue(undefined),
      executeTypeText: vi.fn().mockResolvedValue(undefined),
    }

    agent.bindAdapter(mockAdapter)

    const testPlan: TurnPlan = {
      plan: 'Replayable test plan',
      spoken_commentary: 'Testing replay',
      actions: [
        { type: 'click', x: 100, y: 200 },
      ],
      executed: true,
    }

    await agent.executePlan(testPlan)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(agent.currentTurnPlan.value).toStrictEqual(testPlan)

    // Replay
    await agent.executePlan(testPlan)
    expect(clickSpy).toHaveBeenCalledTimes(2)
  })

  it('draws 100-interval coordinate grid onto canvas context without error', () => {
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      arc: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D

    drawCoordinateGrid(mockCtx, 1000, 1000)
    expect(mockCtx.save).toHaveBeenCalled()
    expect(mockCtx.restore).toHaveBeenCalled()
    expect(mockCtx.strokeRect).toHaveBeenCalledWith(0, 0, 1000, 1000)
    expect(mockCtx.fillText).toHaveBeenCalledWith('500,500', expect.any(Number), expect.any(Number))
    expect(mockCtx.fillText).toHaveBeenCalledWith('100', expect.any(Number), expect.any(Number))
  })

  it('burnCoordinateGridToCanvas handles environment safely without document', () => {
    const mockCanvas = { width: 640, height: 480 } as HTMLCanvasElement
    const res = burnCoordinateGridToCanvas(mockCanvas)
    expect(res).toBeNull()
  })
})
