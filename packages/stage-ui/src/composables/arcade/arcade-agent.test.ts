import type { GameAdapter, TurnPlan } from '../../types/arcade'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLLM } from '../../stores/llm'
import { useProvidersStore } from '../../stores/providers'
import { resolveArcadeProfile } from './profiles'
import { normalizePlanActions, useArcadeAgent } from './use-arcade-agent'
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
    expect(profile.systemPromptAddendum).toContain('Row 1 (~Y: 206): Bulldozer')
    expect(profile.systemPromptAddendum).toContain('Road ($10)')
    expect(profile.systemPromptAddendum).toContain('Row 2 (~Y: 280): Power Lines')
    expect(profile.systemPromptAddendum).toContain('Row 6 (~Y: 580): Stadium ($3,000) (Recreation) | Power Plant')
    expect(profile.systemPromptAddendum).toContain('Row 7 (~Y: 655): Seaport ($3,000) (Waterfront commerce) | Airport')
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
    expect(clickSpy).toHaveBeenCalledWith(250, 350, 'left')
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

  it('normalizes drag actions with alternative property naming', () => {
    const rawActions = [
      { type: 'drag', startX: 250, startY: 545, endX: 560, endY: 545, label: 'Pave Road' },
      { type: 'drag', from_x: 100, from_y: 200, to_x: 300, to_y: 400 },
      { type: 'click', normX: 88, normY: 230 },
    ]

    const normalized = normalizePlanActions(rawActions)
    expect(normalized[0]).toMatchObject({
      type: 'drag',
      fromX: 250,
      fromY: 545,
      toX: 560,
      toY: 545,
    })
    expect(normalized[1]).toMatchObject({
      type: 'drag',
      fromX: 100,
      fromY: 200,
      toX: 300,
      toY: 400,
    })
    expect(normalized[2]).toMatchObject({
      type: 'click',
      x: 88,
      y: 230,
    })
  })

  it('executes executeDrag on adapter when drag action is dispatched', async () => {
    const agent = useArcadeAgent()
    const dragSpy = vi.fn().mockResolvedValue(undefined)
    const mockAdapter: GameAdapter = {
      id: 'test-game',
      title: 'Test Game',
      engine: 'jsdos',
      captureFrame: vi.fn().mockResolvedValue(null),
      getCanvasElement: vi.fn().mockReturnValue(null),
      executeClick: vi.fn().mockResolvedValue(undefined),
      executeDrag: dragSpy,
      executeKeyPress: vi.fn().mockResolvedValue(undefined),
      executeTypeText: vi.fn().mockResolvedValue(undefined),
    }

    agent.bindAdapter(mockAdapter)

    const testPlan: TurnPlan = {
      plan: 'Drag test plan',
      spoken_commentary: 'Testing drag',
      actions: [
        { type: 'drag', fromX: 250, fromY: 545, toX: 560, toY: 545, label: 'Drag Road' },
      ],
    }

    await agent.executePlan(testPlan)
    expect(dragSpy).toHaveBeenCalledWith(250, 545, 560, 545)
  })

  it('preserves history when adapter id matches and resets when id changes', () => {
    const agent = useArcadeAgent()
    const adapter1: GameAdapter = {
      id: 'simcity',
      title: 'SimCity',
      engine: 'jsdos',
      captureFrame: vi.fn().mockResolvedValue(null),
      getCanvasElement: vi.fn().mockReturnValue(null),
      executeClick: vi.fn().mockResolvedValue(undefined),
      executeKeyPress: vi.fn().mockResolvedValue(undefined),
      executeTypeText: vi.fn().mockResolvedValue(undefined),
    }

    const adapter1Clone: GameAdapter = { ...adapter1 }

    const adapter2: GameAdapter = {
      ...adapter1,
      id: 'game-2048',
      title: '2048',
    }

    agent.bindAdapter(adapter1)
    agent.turnHistory.value.push({
      turnIndex: 1,
      plan: 'Build road',
      spoken: 'Roads first!',
      actionsSummary: 'Click (88, 280)',
      rawResponse: '{"plan":"Build road"}',
      timestamp: Date.now(),
    })
    expect(agent.turnHistory.value.length).toBe(1)

    // Re-binding the same game ID should PRESERVE history
    agent.bindAdapter(adapter1Clone)
    expect(agent.turnHistory.value.length).toBe(1)

    // Binding a different game ID should RESET history
    agent.bindAdapter(adapter2)
    expect(agent.turnHistory.value.length).toBe(0)
  })

  it('constructs structured multi-turn conversation messages across sequential turns', async () => {
    const agent = useArcadeAgent()
    const providersStore = useProvidersStore()
    const llmStore = useLLM()

    const mockProvider = { id: 'test-vlm' }
    vi.spyOn(providersStore, 'getProviderInstance').mockResolvedValue(mockProvider as any)

    const generateSpy = vi.spyOn(llmStore, 'generate').mockImplementation(async (_model, _provider, messages) => {
      const turnNum = (messages as any[]).filter(m => m.role === 'assistant').length + 1
      return {
        text: JSON.stringify({
          spoken_commentary: `Executing turn ${turnNum}`,
          emotion: 'focused',
          plan: `Plan for turn ${turnNum}`,
          actions: [{ type: 'click', x: 100 * turnNum, y: 200 * turnNum }],
        }),
      } as any
    })

    const mockAdapter: GameAdapter = {
      id: 'test-simcity',
      title: 'SimCity (1989)',
      engine: 'jsdos',
      captureFrame: vi.fn().mockResolvedValue('data:image/png;base64,frame-data'),
      getCanvasElement: vi.fn().mockReturnValue(null),
      executeClick: vi.fn().mockResolvedValue(undefined),
      executeKeyPress: vi.fn().mockResolvedValue(undefined),
      executeTypeText: vi.fn().mockResolvedValue(undefined),
    }

    agent.bindAdapter(mockAdapter)

    // Turn 1
    const plan1 = await agent.takeTurn()
    expect(plan1).not.toBeNull()
    expect(generateSpy).toHaveBeenCalledTimes(1)

    const firstCallMessages = generateSpy.mock.calls[0][2] as any[]
    // Turn 1 should have: System message + 1 User message with text and image_url
    expect(firstCallMessages).toHaveLength(2)
    expect(firstCallMessages[0].role).toBe('system')
    expect(firstCallMessages[0].content).toContain('playing \'SimCity (1989)\'')
    expect(firstCallMessages[1].role).toBe('user')
    expect(firstCallMessages[1].content).toEqual([
      { type: 'text', text: expect.stringContaining('Turn 1: Here is our current game screen for \'SimCity (1989)\'') },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,frame-data' } },
    ])

    // Turn 2
    const plan2 = await agent.takeTurn()
    expect(plan2).not.toBeNull()
    expect(generateSpy).toHaveBeenCalledTimes(2)

    const secondCallMessages = generateSpy.mock.calls[1][2] as any[]
    // Turn 2 should have: System + User 1 (text-only) + Assistant 1 (JSON) + User 2 (text + image)
    expect(secondCallMessages).toHaveLength(4)
    expect(secondCallMessages[0].role).toBe('system')
    expect(secondCallMessages[1].role).toBe('user')
    expect(secondCallMessages[1].content).toContain('Turn 1: Here is our game screen for \'SimCity (1989)\'')
    // Previous user message should NOT contain image_url (preventing huge payload bloat)
    expect(typeof secondCallMessages[1].content).toBe('string')
    expect(secondCallMessages[2].role).toBe('assistant')
    expect(secondCallMessages[2].content).toContain('Plan for turn 1')
    expect(secondCallMessages[3].role).toBe('user')
    expect(secondCallMessages[3].content).toEqual([
      { type: 'text', text: expect.stringContaining('Turn 2: Here is the updated game screen after executing your previous moves.') },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,frame-data' } },
    ])
  })
})
