import type {
  ArcadeProvisioningConfig,
  CalibrationTelemetryTrace,
  CatalogGame,
} from '../../types/arcade'

import { describe, expect, it } from 'vitest'

import { useArcadeSynthesizer } from './use-arcade-synthesizer'

describe('useArcadeSynthesizer', () => {
  const mockGameNibbles: CatalogGame = {
    identifier: 'NibblesQbasic',
    title: 'NIBBLES QBASIC',
    classification: {
      recommended_system: 'system1_reflex',
      screen_motion_architecture: 'fixed_single_screen',
      gameplay_pace: 'real_time_fast',
      companion_role: 'hype_coach',
    },
  }

  const mockGame2048: CatalogGame = {
    identifier: '2048',
    title: '2048 Retro Canvas',
    classification: {
      recommended_system: 'system1_reflex',
      screen_motion_architecture: 'fixed_single_screen',
      gameplay_pace: 'turn_based',
      companion_role: 'zen_co_pilot',
    },
  }

  const mockConfig: ArcadeProvisioningConfig = {
    system1Engine: 'laya_local',
    system2Model: 'gemini-2.5-flash',
    companionPersona: 'hype_coach',
  }

  const mockTrace: CalibrationTelemetryTrace = {
    timestamp: Date.now(),
    durationMs: 15000,
    framesCaptured: 150,
    keyEvents: [
      { key: 'ArrowRight', timestamp: 100, type: 'down' },
      { key: 'ArrowDown', timestamp: 500, type: 'down' },
      { key: 'ArrowLeft', timestamp: 900, type: 'down' },
    ],
    motionEntropy: 0.42,
    identifiedArchitecture: 'fixed_single_screen',
  }

  it('synthesizes strategic specification based on persona and game profile', () => {
    const synthesizer = useArcadeSynthesizer()
    const strategy = synthesizer.synthesizeStrategy(mockGameNibbles, mockConfig, mockTrace)

    expect(strategy.summary).toContain('High-energy push')
    expect(strategy.tactics.length).toBeGreaterThan(0)
    expect(strategy.hazardRules.length).toBeGreaterThan(0)
    expect(strategy.pacing).toBe('real_time_fast')
  })

  it('generates 2048 corner-anchoring strategy for 2048 title', () => {
    const synthesizer = useArcadeSynthesizer()
    const strategy = synthesizer.synthesizeStrategy(mockGame2048, { ...mockConfig, companionPersona: 'zen_co_pilot' }, mockTrace)

    expect(strategy.tactics.some(t => t.includes('Corner-Anchor Doctrine'))).toBe(true)
    expect(strategy.hazardRules.some(r => r.includes('NEVER press Up'))).toBe(true)
  })

  it('synthesizes executable mini-program code for fixed_single_screen games', () => {
    const synthesizer = useArcadeSynthesizer()
    const mp = synthesizer.synthesizeMiniProgram(mockGameNibbles, mockTrace)

    expect(mp).not.toBeNull()
    expect(mp?.code).toContain('function evaluateGameState')
    expect(mp?.inputSpec.intervalMs).toBe(16)
  })

  it('runs 60 ticks in sandbox and returns execution metrics with 0 exceptions', async () => {
    const synthesizer = useArcadeSynthesizer()
    const mp = synthesizer.synthesizeMiniProgram(mockGameNibbles, mockTrace)
    expect(mp).not.toBeNull()

    const result = await synthesizer.runSandboxTest(mp!.code, 60)
    expect(result.status).toBe('completed')
    expect(result.ticksExecuted).toBe(60)
    expect(result.durationMs).toBeGreaterThan(0)
    expect(result.avgLatencyMs).toBeGreaterThanOrEqual(0)
  })

  it('builds a complete AcquiredGameKnowledge payload', () => {
    const synthesizer = useArcadeSynthesizer()
    const strategy = synthesizer.synthesizeStrategy(mockGameNibbles, mockConfig, mockTrace)
    const mp = synthesizer.synthesizeMiniProgram(mockGameNibbles, mockTrace)
    const knowledge = synthesizer.buildAcquiredKnowledge(mockGameNibbles, mockConfig, mockTrace, strategy, mp)

    expect(knowledge.gameId).toBe('NibblesQbasic')
    expect(knowledge.persona).toBe('hype_coach')
    expect(knowledge.miniProgram).toBeDefined()
    expect(knowledge.strategySummary).toBe(strategy.summary)
  })
})
