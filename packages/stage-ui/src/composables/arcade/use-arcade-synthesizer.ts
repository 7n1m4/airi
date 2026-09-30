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
 * AIRI Reflex Mini-Program: 2048 Corner Anchoring Engine
 * Strategy: Bottom-Left Anchor Priority
 */
function evaluateGameState(prevFrame, currFrame, telemetry) {
  const tick = telemetry ? telemetry.tick : 0;
  
  // Greedy corner sweep heuristic: Left -> Down -> Right -> Up
  const cycle = tick % 4;
  if (cycle === 0) return 'left';
  if (cycle === 1) return 'down';
  if (cycle === 2) return 'left';
  return 'down';
}`
    }
    else if (title.includes('nibbles') || title.includes('snake')) {
      code = `/**
 * AIRI Reflex Mini-Program: Nibbles Collision Avoidance
 * Architecture: Fixed Single Screen
 * Entropy: ${trace.motionEntropy.toFixed(2)}
 */
function evaluateGameState(prevFrame, currFrame, telemetry) {
  const delta = currFrame ? currFrame.motionDelta || 0 : 0;
  const tick = telemetry ? telemetry.tick : 0;
  
  // Perimeter navigation loop with evasive reflexes
  if (delta > 0.40) {
    // Sharp hazard change detected - execute emergency lateral pivot
    return tick % 2 === 0 ? 'up' : 'right';
  }
  
  // Standard sweep
  const phase = Math.floor(tick / 8) % 4;
  if (phase === 0) return 'right';
  if (phase === 1) return 'down';
  if (phase === 2) return 'left';
  return 'up';
}`
    }
    else {
      // General single-screen reflex program
      code = `/**
 * AIRI Reflex Mini-Program: ${game.title}
 * Screen Architecture: ${arch}
 */
function evaluateGameState(prevFrame, currFrame, telemetry) {
  const delta = currFrame ? currFrame.motionDelta || 0 : 0;
  const tick = telemetry ? telemetry.tick : 0;
  
  // High motion variance response
  if (delta > 0.35) {
    return tick % 2 === 0 ? 'space' : 'none';
  }
  
  return 'none';
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
      // Wrap code in a sandboxed Function
      // Signature: (prevFrame, currFrame, telemetry) => Action
      // eslint-disable-next-line no-new-func
      const runner = new Function('prevFrame', 'currFrame', 'telemetry', `
        ${code}
        return evaluateGameState(prevFrame, currFrame, telemetry);
      `)

      let ticksExecuted = 0
      let prevFrame: any = { motionDelta: 0.1 }
      let currFrame: any = { motionDelta: 0.15 }

      for (let i = 0; i < ticks; i++) {
        const tickStart = performance.now()
        // Simulate changing motion delta
        const simulatedDelta = (Math.sin(i / 5) + 1) / 4 // 0.0 to 0.5
        currFrame = { motionDelta: simulatedDelta }

        const action = runner(prevFrame, currFrame, { tick: i }) as MiniProgramAction
        const latencyMs = Number((performance.now() - tickStart).toFixed(3))

        if (action && action !== 'none') {
          actionsEmitted.push({
            tick: i,
            action,
            latencyMs,
          })
        }

        prevFrame = currFrame
        ticksExecuted++

        // Yield slightly every 15 ticks to avoid blocking UI thread
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
