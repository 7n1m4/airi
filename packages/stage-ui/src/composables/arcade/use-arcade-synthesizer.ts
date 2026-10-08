import type {
  AcquiredGameKnowledge,
  ArcadeProvisioningConfig,
  CalibrationTelemetryTrace,
  CatalogGame,
  GameplayPace,
  MiniProgramAction,
  MiniProgramDefinition,
} from '../../types/arcade'

import { ref } from 'vue'

import { diffUtils } from './utils/diff-utils'

export interface StrategySpec {
  summary: string
  tactics: string[]
  hazardRules: string[]
  pacing: GameplayPace
}

export interface SandboxTestResult {
  status: 'idle' | 'running' | 'completed' | 'error'
  ticksExecuted: number
  actionsEmitted: Array<{ tick: number, action: MiniProgramAction, latencyMs: number }>
  error?: string
  durationMs: number
  avgLatencyMs: number
}

export function useArcadeSynthesizer() {
  const isSynthesizing = ref(false)
  const isTesting = ref(false)
  const lastTestResult = ref<SandboxTestResult | null>(null)

  function synthesizeStrategy(
    game: CatalogGame,
    config: ArcadeProvisioningConfig,
    trace: CalibrationTelemetryTrace,
  ): StrategySpec {
    const title = (game.title || '').toLowerCase()
    const arch = trace.identifiedArchitecture
    const entropy = trace.motionEntropy
    const persona = config.companionPersona

    let summary = ''
    const tactics: string[] = []
    const hazardRules: string[] = []
    let pacing: GameplayPace = game.classification?.gameplay_pace || 'real_time_fast'

    // Formulate persona-driven strategy narrative
    if (persona === 'hype_coach') {
      summary = `High-energy push! We registered ${trace.keyEvents.length} active inputs with ${entropy.toFixed(2)} motion entropy. We're going for aggressive momentum and clutch reaction timing!`
    }
    else if (persona === 'strategic_advisor') {
      summary = `Calculated operational plan formulated. System identified a ${arch.replace(/_/g, ' ')} environment with ${entropy.toFixed(2)} motion variance. We prioritize deterministic positioning and conservative risk boundaries.`
    }
    else if (persona === 'zen_co_pilot') {
      summary = `Smooth, mindful gameplay pattern identified. With steady motion entropy (${entropy.toFixed(2)}), we focus on calm rhythm, predictable pathing, and avoiding sudden overcorrections.`
    }
    else {
      // Snarky backseater
      summary = `Oh, so that's how you play! You mashed ${trace.keyEvents.length} keys in 15 seconds. Let me handle the reflexes so we don't crash into the first wall like last time!`
    }

    // Architecture & Game-specific Tactics
    if (title.includes('2048')) {
      pacing = 'turn_based'
      tactics.push('Corner-Anchor Doctrine: Strictly keep the highest value tile in the bottom-left corner.')
      tactics.push('Prioritize Down and Left movements; avoid pressing Up unless no other moves exist.')
      tactics.push('Maintain a descending snake gradient along the bottom row.')
      hazardRules.push('NEVER press Up when the bottom row is filled with descending tiles.')
      hazardRules.push('If trapped with no Left/Down moves, execute Right before Up to preserve bottom row.')
    }
    else if (title.includes('nibbles') || title.includes('snake')) {
      pacing = 'real_time_fast'
      tactics.push('Perimeter sweep: Maintain clockwise outer perimeter sweeps to maximize internal turning buffer.')
      tactics.push('Serpentine compaction: Compact snake body in parallel rows across the screen center.')
      hazardRules.push('Immediate 180° reverse-input lockout (never register opposite direction).')
      hazardRules.push('Boundary warning: trigger pivot turn at least 2 tiles before screen perimeter.')
    }
    else if (arch === 'fixed_single_screen') {
      pacing = 'real_time_fast'
      tactics.push('Screen-boundary spatial awareness: monitor player anchor within fixed coordinate plane.')
      tactics.push('Deterministic reaction cycle: evaluate state every 16ms without camera tracking lag.')
      hazardRules.push('Detect static obstacle boundaries from pixel diff clusters.')
      hazardRules.push('Enforce immediate obstacle avoidance when approaching zero-entropy barrier coordinates.')
    }
    else if (arch === 'first_person_or_3d') {
      pacing = 'real_time_intense'
      tactics.push('Circle-strafing rotation: Keep crosshair centered while moving perpendicular to targets.')
      tactics.push('Doorway choke-point control: Backpedal through narrow corridors to group enemies.')
      hazardRules.push('Avoid standing still when motion entropy drops below 0.1 while in combat.')
      hazardRules.push('Monitor screen edges for flash deltas indicative of incoming damage.')
    }
    else {
      // Platformer / Scrolling
      pacing = 'real_time_fast'
      tactics.push('Advance-and-check: Move forward in controlled bursts to allow camera buffer to reveal hazards.')
      tactics.push('Apex jump timing: Reserve double-jumps for the peak of vertical momentum.')
      hazardRules.push('Ledge-drop detection: verify platform ground plane before horizontal commits.')
      hazardRules.push('Enemy projectile velocity check: evade when high-contrast sprite approaches.')
    }

    return {
      summary,
      tactics,
      hazardRules,
      pacing,
    }
  }

  function synthesizeMiniProgram(
    game: CatalogGame,
    trace: CalibrationTelemetryTrace,
  ): MiniProgramDefinition | null {
    const title = (game.title || '').toLowerCase()
    const arch = trace.identifiedArchitecture

    // Only synthesize executable mini-programs for deterministic fixed screen or arcade games
    const isCandidate = arch === 'fixed_single_screen'
      || title.includes('2048')
      || title.includes('nibbles')
      || title.includes('snake')
      || title.includes('pacman')
      || title.includes('pac-man')
      || title.includes('digger')

    if (!isCandidate) {
      return null
    }

    let code = ''
    let keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

    if (title.includes('2048')) {
      keys = ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']
      code = `/**
 * AIRI Dynamic Game State Extractor: 2048 Retro Canvas
 * Strategy: Spatial Tile & Cluster Extraction
 */
function extractGameState(prevGrid, currGrid, diff) {
  const added = (diff && diff.added) || [];
  const removed = (diff && diff.removed) || [];

  return {
    controllableEntity: { x: 0, y: 0, heading: 'CORNER_ANCHOR' },
    changedPixelsCount: added.length + removed.length,
    isGameOver: added.length === 0 && removed.length === 0 && (diff && diff.t > 15000),
    timestamp: diff ? diff.t : Date.now()
  };
}

function evaluateGameState(prevFrame, currFrame, telemetry) {
  const tick = telemetry ? telemetry.tick : 0;
  const cycle = tick % 4;
  if (cycle === 0) return 'left';
  if (cycle === 1) return 'down';
  if (cycle === 2) return 'left';
  return 'down';
}`
    }
    else {
      // Generic single-screen state extractor based on 80x40 grid deltas
      code = `/**
 * AIRI Dynamic Game State Extractor: ${game.title}
 * Screen Architecture: ${arch}
 * Resolution: ${trace.resolution?.cols || 80}x${trace.resolution?.rows || 40}
 * Standard Perceptual Primitives: diffUtils
 */
function extractGameState(prevGrid, currGrid, diff, diffUtils) {
  const added = (diff && diff.added) || [];
  const clusters = diffUtils ? diffUtils.getClusters(added) : [];
  const player = diffUtils ? diffUtils.correlateInput(clusters, (diff && diff.keys) || []) : (clusters[0] || null);
  const threats = clusters.filter(c => c !== player && c.size >= 2);
  const targets = clusters.filter(c => c !== player && c.size === 1);
  const isGameOver = diffUtils ? diffUtils.detectLossBurst(diff, 35) : (added.length > 40);

  return {
    controllableEntity: player ? { x: player.x, y: player.y, heading: player.heading || 'STATIONARY' } : null,
    threats: threats.map(t => ({ x: t.x, y: t.y, size: t.size })),
    targets: targets.map(tgt => ({ x: tgt.x, y: tgt.y })),
    changedPixelsCount: added.length,
    isGameOver,
    timestamp: diff ? diff.t : Date.now()
  };
}

function evaluateGameState(prevFrame, currFrame, telemetry, diffUtils) {
  const state = extractGameState(null, null, currFrame, diffUtils);
  if (state.isGameOver) return 'none';
  const heading = state.controllableEntity ? state.controllableEntity.heading : 'UNKNOWN';
  if (heading === 'RIGHT') return 'down';
  if (heading === 'DOWN') return 'left';
  if (heading === 'LEFT') return 'up';
  if (heading === 'UP') return 'right';
  return 'space';
}`
    }

    return {
      id: `mp_${game.identifier}_${Date.now()}`,
      gameId: game.identifier,
      version: 1,
      code,
      inputSpec: {
        keys,
        intervalMs: 16, // 60Hz
      },
    }
  }

  async function runSandboxTest(code: string, ticks: number = 60): Promise<SandboxTestResult> {
    isTesting.value = true
    const startTime = performance.now()
    const actionsEmitted: Array<{ tick: number, action: MiniProgramAction, latencyMs: number }> = []

    try {
      // Evaluate sandboxed extractor and evaluate functions
      // eslint-disable-next-line no-new-func
      const runner = new Function('prevGrid', 'currGrid', 'diff', 'diffUtils', `
        ${code}
        if (typeof extractGameState === 'function') {
          return extractGameState(prevGrid, currGrid, diff, diffUtils);
        }
        if (typeof evaluateGameState === 'function') {
          return evaluateGameState(prevGrid, currGrid, diff, diffUtils);
        }
        return { status: 'ok' };
      `)

      let ticksExecuted = 0
      for (let i = 0; i < ticks; i++) {
        const tickStart = performance.now()
        // Simulate a moving pixel cluster in 80x40 coordinates
        const mockDiff = {
          t: i * 16,
          added: [[(10 + i) % 80, 20], [(11 + i) % 80, 20]] as Array<[number, number]>,
          removed: [[(9 + i) % 80, 20]] as Array<[number, number]>,
        }

        const state = runner(null, null, mockDiff, diffUtils)
        const latencyMs = Number((performance.now() - tickStart).toFixed(3))

        if (state) {
          actionsEmitted.push({
            tick: i,
            action: (state.controllableEntity?.heading?.toLowerCase() as MiniProgramAction) || 'up',
            latencyMs,
          })
        }

        ticksExecuted++

        if (i % 15 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }

      const durationMs = Number((performance.now() - startTime).toFixed(1))
      const avgLatencyMs = actionsEmitted.length > 0
        ? Number((actionsEmitted.reduce((acc, a) => acc + a.latencyMs, 0) / actionsEmitted.length).toFixed(3))
        : 0.05

      const result: SandboxTestResult = {
        status: 'completed',
        ticksExecuted,
        actionsEmitted,
        durationMs,
        avgLatencyMs,
      }

      console.group('%c[Arcade Studio] 🧪 Sandbox Test Execution (60 Ticks)...', 'color: #06b6d4; font-weight: bold;')
      console.info('Sandbox Test Input Code:\n', code)
      console.info('Sandbox Test Result:', result)
      console.groupEnd()

      lastTestResult.value = result
      return result
    }
    catch (err: any) {
      const result: SandboxTestResult = {
        status: 'error',
        ticksExecuted: actionsEmitted.length,
        actionsEmitted,
        error: err.message || String(err),
        durationMs: Number((performance.now() - startTime).toFixed(1)),
        avgLatencyMs: 0,
      }
      console.error('[Arcade Studio] ❌ Sandbox Test Execution Failed:', result)
      lastTestResult.value = result
      return result
    }
    finally {
      isTesting.value = false
    }
  }

  function buildAcquiredKnowledge(
    game: CatalogGame,
    config: ArcadeProvisioningConfig,
    trace: CalibrationTelemetryTrace,
    strategy: StrategySpec,
    miniProgram?: MiniProgramDefinition | null,
  ): AcquiredGameKnowledge {
    const knowledge: AcquiredGameKnowledge = {
      gameId: game.identifier,
      gameTitle: game.title,
      acquiredAt: Date.now(),
      lastPlayedAt: Date.now(),
      motionArchitecture: trace.identifiedArchitecture,
      recommendedSystem: game.classification?.recommended_system || 'system1_reflex',
      gameplayPace: strategy.pacing,
      primaryGenre: game.classification?.primary_genre,
      primaryController: game.classification?.primary_controller,
      persona: config.companionPersona,
      system1Engine: config.system1Engine,
      system2Model: config.system2Model,
      strategySummary: strategy.summary,
      rulesAddendum: strategy.tactics.join('\n') + (strategy.hazardRules.length > 0 ? `\n\nHazard Avoidance:\n${strategy.hazardRules.join('\n')}` : ''),
      miniProgram: miniProgram || undefined,
      calibrationTrace: trace,
      playCount: 1,
    }

    // Verbose Developer & User Console Logging for Game Knowledge Synthesis
    console.group('%c[Arcade Studio] 🧠 Synthesizing Game Intelligence...', 'color: #38bdf8; font-weight: bold; font-size: 13px;')
    console.group('%c📥 INPUT SPEC & TELEMETRY', 'color: #a855f7; font-weight: bold;')
    console.info('Catalog Game:', {
      identifier: game.identifier,
      title: game.title,
      year: game.year,
      classification: game.classification,
    })
    console.info('Provisioning Configuration:', {
      companionPersona: config.companionPersona,
      system1Engine: config.system1Engine,
      system2Model: config.system2Model,
    })
    console.info('15s Calibration Telemetry Trace:', {
      identifiedArchitecture: trace.identifiedArchitecture,
      motionEntropy: Number(trace.motionEntropy.toFixed(3)),
      framesCaptured: trace.framesCaptured,
      durationMs: trace.durationMs,
      totalKeyEvents: trace.keyEvents.length,
      keyEventsSample: trace.keyEvents.slice(0, 15),
      demonstrationFrames: trace.frames ? { total: trace.frames.length, sample: trace.frames.slice(0, 8) } : 'none',
    })
    console.groupEnd()

    console.group('%c📤 OUTPUT STRATEGY & REFLEX PROGRAM', 'color: #10b981; font-weight: bold;')
    console.info('Strategy Specification:', {
      summary: strategy.summary,
      pacing: strategy.pacing,
      tactics: strategy.tactics,
      hazardRules: strategy.hazardRules,
    })
    if (miniProgram) {
      console.info('Reflex Mini-Program:', {
        id: miniProgram.id,
        gameId: miniProgram.gameId,
        keys: miniProgram.inputSpec.keys,
        intervalMs: miniProgram.inputSpec.intervalMs,
        code: miniProgram.code,
      })
    }
    else {
      console.info('Reflex Mini-Program: None (Continuous VLM Architecture)')
    }
    console.groupEnd()

    console.group('%c💾 FINAL ACQUIRED KNOWLEDGE PAYLOAD (IndexedDB)', 'color: #f59e0b; font-weight: bold;')
    console.info('AcquiredGameKnowledge:', knowledge)
    console.groupEnd()
    console.groupEnd()

    return knowledge
  }

  return {
    isSynthesizing,
    isTesting,
    lastTestResult,
    synthesizeStrategy,
    synthesizeMiniProgram,
    runSandboxTest,
    buildAcquiredKnowledge,
  }
}
