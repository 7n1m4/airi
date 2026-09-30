#!/usr/bin/env node
/**
 * AIRI Arcade Cleanroom: Headless Trace Replay & Extractor Benchmark Harness
 *
 * Usage:
 *   node scripts/tests/arcade-catalog-cleanroom/arcade-replay-harness.mjs [options]
 *
 * Options:
 *   --trace <path>      Path to trace JSON (default: personal_airi/game_frames.json)
 *   --render            Render ASCII visualization of active entities
 *   --max-frames <n>    Limit replay to first N frames
 *   --synthesize        Call System-2 LLM (OpenCode Go) to synthesize extractGameState
 *   --jev               Query System-1 (TypeSafe Jev) for reflex decision verification
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import diffUtils from './diff-utils.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../../..')

// 1. Parse CLI arguments
const args = process.argv.slice(2)
function getArg(flag, defaultValue = null) {
  const idx = args.indexOf(flag)
  if (idx !== -1 && idx + 1 < args.length)
    return args[idx + 1]
  return defaultValue
}
const shouldRender = args.includes('--render')
const shouldSynthesize = args.includes('--synthesize')
const shouldQueryJev = args.includes('--jev')
const maxFrames = Number.parseInt(getArg('--max-frames', '0'), 10)
const defaultTracePath = fs.existsSync(path.join(ROOT, 'personal_airi/game_frames.json'))
  ? path.join(ROOT, 'personal_airi/game_frames.json')
  : path.join(ROOT, '../personal_airi/game_frames.json')
const tracePath = getArg('--trace', defaultTracePath)

// 2. Read Environment Variables
function getEnvConfig() {
  const envPath = path.join(ROOT, '.env')
  const config = {}
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (match) {
        config[match[1]] = match[2].trim()
      }
    }
  }
  return config
}
const env = getEnvConfig()

console.log('===============================================================')
console.log('🕹️  AIRI Arcade Cleanroom: Headless Replay & Extractor Harness')
console.log('===============================================================\n')

// 3. Load Trace File
if (!fs.existsSync(tracePath)) {
  console.error(`❌ Trace file not found: ${tracePath}`)
  process.exit(1)
}

console.log(`📂 Loading trace: ${path.relative(ROOT, tracePath)}...`)
const traceData = JSON.parse(fs.readFileSync(tracePath, 'utf8'))
const gameTitle = traceData.game || 'Retro Arcade'
const frames = traceData.frames || []
console.log(`🎮 Game: ${gameTitle}`)
console.log(`⏱️ Duration: ${traceData.durationMs || 0}ms | Total Frames: ${frames.length}`)

const framesToProcess = maxFrames > 0 ? frames.slice(0, maxFrames) : frames

// 4. Trace Replay Loop with diffUtils
console.log(`\n🚀 Executing Replay Loop (${framesToProcess.length} frames)...`)
const startTime = performance.now()

let prevClusters = []
let playerTrackedCount = 0
let detectedLossFrame = null
const stateHistory = []

// Initialize accumulated 80x40 game arena grid
let accumulatedGrid = Array.from({ length: 40 }, () => new Array(80).fill('0'))
if (frames[0] && frames[0].fullGrid) {
  accumulatedGrid = frames[0].fullGrid.map(row => row.split(''))
}

for (let i = 0; i < framesToProcess.length; i++) {
  const frame = framesToProcess[i]
  const t0 = performance.now()

  // Maintain accumulated active board state
  if (frame.fullGrid) {
    accumulatedGrid = frame.fullGrid.map(row => row.split(''))
  }
  else {
    if (frame.removed) {
      for (const [x, y] of frame.removed) {
        if (y >= 0 && y < 40 && x >= 0 && x < 80)
          accumulatedGrid[y][x] = '0'
      }
    }
    if (frame.added) {
      for (const [x, y] of frame.added) {
        if (y >= 0 && y < 40 && x >= 0 && x < 80)
          accumulatedGrid[y][x] = '1'
      }
    }
  }

  // Tier 1: Platform Perceptual Primitives
  const addedPoints = frame.added || []
  const clusters = diffUtils.getClusters(addedPoints, 2.5)
  const trackedClusters = diffUtils.trackTrajectories(prevClusters, clusters, 8)
  const player = diffUtils.correlateInput(trackedClusters, frame.keys || [])
  const isLoss = diffUtils.detectLossBurst(frame, 35)

  const frameTimeMs = performance.now() - t0

  if (player)
    playerTrackedCount++
  if (isLoss && detectedLossFrame === null && i > 5) {
    detectedLossFrame = i
  }

  // Synthesize semantic state
  const threats = trackedClusters.filter(c => c !== player && c.size >= 2)
  const targets = trackedClusters.filter(c => c !== player && c.size === 1)

  const semanticState = {
    frameIndex: i,
    t: frame.t,
    keys: frame.keys || [],
    player: player ? { x: player.x, y: player.y, dx: player.dx, dy: player.dy, heading: player.heading, size: player.size } : null,
    threats: threats.map(t => ({ x: t.x, y: t.y, heading: t.heading, size: t.size })),
    targets: targets.map(tgt => ({ x: tgt.x, y: tgt.y })),
    isGameOver: isLoss,
    computeMs: Math.round(frameTimeMs * 100) / 100,
  }
  stateHistory.push(semanticState)
  prevClusters = trackedClusters

  // Optional ASCII Render for key turning frames or loss frames
  if (shouldRender && (frame.keys?.length > 0 || isLoss || i % 25 === 0)) {
    renderAsciiGrid(frame, semanticState, accumulatedGrid)
  }
}

const totalTimeMs = performance.now() - startTime
const avgFrameMs = (totalTimeMs / framesToProcess.length).toFixed(3)

console.log('\n--- Replay Benchmark Results ---')
console.log(`⚡ Processed: ${framesToProcess.length} frames in ${totalTimeMs.toFixed(1)}ms (avg: ${avgFrameMs}ms / frame)`)
console.log(`🎯 Player Tracking Continuity: ${Math.round((playerTrackedCount / framesToProcess.length) * 100)}%`)
if (detectedLossFrame !== null) {
  console.log(`💥 Game-Over / Loss Event Detected at Frame #${detectedLossFrame} (t=${framesToProcess[detectedLossFrame].t}ms)`)
}
else {
  console.log('ℹ️  No Game-Over burst detected during this segment.')
}

// 5. Optional System-2 Extractor Synthesis (OpenCode Go)
if (shouldSynthesize) {
  await runAgenticSynthesisLoop(traceData)
}

if (shouldQueryJev) {
  await runJevReflexTest(stateHistory)
}

// --- ASCII Grid Renderer ---
function renderAsciiGrid(frame, state, grid80x40) {
  const arrows = {
    UP: '▲',
    DOWN: '▼',
    LEFT: '◀',
    RIGHT: '▶',
    STATIONARY: '●',
  }
  const headingArrow = arrows[state.player?.heading || 'STATIONARY'] || '●'

  console.log(`\nFrame #${state.frameIndex} [t=${state.t}ms] | Keys: [${state.keys.join(', ')}] | Heading: ${state.player?.heading || 'NONE'} ${headingArrow} | Loss: ${state.isGameOver ? '💥 CRASH' : 'NO'}`)
  console.log(`┌${'─'.repeat(80)}┐`)

  // Render 80x20 half-block terminal lines (packs 80x40 perfectly)
  for (let y = 0; y < 40; y += 2) {
    let line = ''
    for (let x = 0; x < 80; x++) {
      const isPlayerHead = state.player && Math.round(state.player.x) === x && (Math.round(state.player.y) === y || Math.round(state.player.y) === y + 1)
      const isTarget = state.targets.some(t => Math.round(t.x) === x && (Math.round(t.y) === y || Math.round(t.y) === y + 1))

      if (isPlayerHead) {
        line += headingArrow
      }
      else if (isTarget) {
        line += '★'
      }
      else {
        const top = grid80x40[y] ? grid80x40[y][x] === '1' : false
        const bottom = grid80x40[y + 1] ? grid80x40[y + 1][x] === '1' : false

        if (top && bottom)
          line += '█'
        else if (top)
          line += '▀'
        else if (bottom)
          line += '▄'
        else
          line += ' '
      }
    }
    console.log(`│${line}│`)
  }
  console.log(`└${'─'.repeat(80)}┘`)
  if (state.player) {
    console.log(`📍 Player Head: (${state.player.x}, ${state.player.y}) | Vector: (${state.player.dx || 0}, ${state.player.dy || 0}) | Active Clusters: ${state.threats.length + 1}`)
  }
}

// --- System-2 Agentic Reflexion Synthesis Routine ---
async function runAgenticSynthesisLoop(trace) {
  console.log('\n===============================================================')
  console.log('🧠 System-2 Agentic Synthesis Loop (Test-Time Reflexion)')
  console.log('===============================================================')

  const apiKey = env.OPENCODE_GO_API_KEY
  const baseUrl = env.OPENCODE_GO_BASE_URL || 'https://opencode.ai/zen/go/v1'

  if (!apiKey) {
    console.warn('⚠️  OPENCODE_GO_API_KEY not found in .env, skipping live synthesis loop.')
    return
  }

  const synthModel = getArg('--model', 'deepseek-v4-flash')
  const maxTurns = Number.parseInt(getArg('--turns', '5'), 10)
  const sessionId = crypto.randomUUID()

  console.log(`🤖 Model: ${synthModel} | Max Turns: ${maxTurns} | Session: ${sessionId}`)

  const initialPrompt = `You are AIRI's Autonomous Gaming Subsystem.
Synthesize a pure JavaScript state extractor and evaluator for this retro game:
Game: "${trace.game || 'Nibbles QBasic'}"
Screen Architecture: fixed_single_screen
Resolution: 80x40

The runtime provides standard deterministic \`diffUtils\` primitives:
- \`diffUtils.getClusters(points, distanceThreshold=2.5)\`: returns Array<{ x, y, size, bbox, pixels }> (Note: single-frame clusters default to heading: 'STATIONARY')
- \`diffUtils.trackTrajectories(prevClusters, currClusters, maxMatchDistance=8)\`: returns tracked clusters with dx, dy, and dynamic heading ('UP'|'DOWN'|'LEFT'|'RIGHT'|'STATIONARY')
- \`diffUtils.correlateInput(clusters, keys)\`: returns controllable player cluster or null
- \`diffUtils.detectLossBurst(diff, burstThreshold=35)\`: returns boolean true on death/loss burst
- \`diffUtils.euclidean(p1, p2)\`: returns distance number

You MUST implement two top-level functions in pure JavaScript:

1. \`extractGameState(prevGrid, currGrid, diff, diffUtils)\`:
   - Extracts semantic state:
     {
       controllableEntity: { x, y, heading: 'UP'|'DOWN'|'LEFT'|'RIGHT'|'STATIONARY' } | null,
       threats: Array<{ x, y, size }>,
       targets: Array<{ x, y }>,
       isGameOver: boolean
     }
   - IMPORTANT FOR HEADING: diffUtils.getClusters() only groups spatial coordinates within the current frame. To give controllableEntity a dynamic heading, compute the motion vector (e.g. by comparing diff.added head centroid vs diff.removed tail centroid, or correlating consecutive positions).
   - IMPORTANT FOR LOSS: Ignore or filter initial startup/intro frames (e.g. if diff.t < 2000) so clearing intro screens is not mistaken for a game-over crash.

2. \`evaluateGameState(prevFrame, currFrame, telemetry, diffUtils)\`:
   - Calls extractGameState(null, null, currFrame, diffUtils).
   - Returns a directional key action string based on entity heading or target coordinates (e.g. 'up', 'down', 'left', 'right', or 'space').

Output complete, valid, executable JavaScript with NO ellipses (...) or placeholder pseudo-code.
Output ONLY the code block in \`\`\`javascript ... \`\`\`.`

  const messages = [
    { role: 'user', content: initialPrompt },
  ]

  let isVerified = false
  let verifiedCode = null

  for (let turn = 1; turn <= maxTurns; turn++) {
    console.log(`\n--------------------------------------------------`)
    console.log(`🔄 Turn ${turn} / ${maxTurns}: Requesting Code Synthesis from ${synthModel}...`)
    console.log(`--------------------------------------------------`)

    const t0 = performance.now()
    let rawContent = ''
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'x-opencode-session': sessionId,
        },
        body: JSON.stringify({
          model: synthModel,
          messages,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(240000),
      })

      if (!res.ok) {
        console.error(`❌ Synthesis API returned HTTP ${res.status}: ${await res.text()}`)
        return
      }

      const data = await res.json()
      const msg = data.choices?.[0]?.message || {}
      rawContent = msg.content || ''
    }
    catch (err) {
      console.error(`❌ Synthesis request failed: ${err.message}`)
      return
    }

    const elapsed = Math.round(performance.now() - t0)
    console.log(`⚡ Model responded in ${elapsed}ms`)

    // Extract code block strictly from msg.content
    let candidateCode = ''
    if (rawContent) {
      const codeBlocks = [...rawContent.matchAll(/```(?:javascript|js)?\s*([\s\S]*?)```/g)].map(m => m[1].trim())
      candidateCode = codeBlocks.find(b => b.includes('extractGameState')) || ''
      if (!candidateCode) {
        const fnMatch = rawContent.match(/function\s+extractGameState[\s\S]*?(?:function\s+evaluateGameState[\s\S]*?\}|\})/)
        if (fnMatch)
          candidateCode = fnMatch[0]
      }
    }

    if (!candidateCode) {
      console.warn('⚠️ No code block found in response.')
      messages.push({ role: 'assistant', content: rawContent })
      messages.push({ role: 'user', content: 'Sandbox error: No JavaScript code block containing extractGameState was found. Please output your solution inside a ```javascript ... ``` code block.' })
      continue
    }

    console.log(`\n📝 Candidate Code (Turn ${turn}):`)
    console.log(candidateCode.slice(0, 350) + (candidateCode.length > 350 ? '\n... (truncated)' : ''))

    // Run Sandbox Judge against actual recorded frames
    console.log('\n⚖️  Running Automated Sandbox Judge against recorded frames...')
    const testFrames = trace.frames.slice(0, 200)
    const judgeResult = runSandboxJudge(candidateCode, testFrames, diffUtils)

    console.log('Judge Report:')
    console.log(`  1. Runtime Safety: ${judgeResult.safety.passed ? '✅ PASS' : `❌ FAIL: ${judgeResult.safety.reason}`}`)
    console.log(`  2. Dynamic Heading: ${judgeResult.heading.passed ? '✅ PASS' : `❌ FAIL: ${judgeResult.heading.reason}`}`)
    console.log(`  3. Action Diversity: ${judgeResult.actions.passed ? '✅ PASS' : `❌ FAIL: ${judgeResult.actions.reason}`}`)
    console.log(`  4. Game-Over Consistency: ${judgeResult.loss.passed ? '✅ PASS' : `❌ FAIL: ${judgeResult.loss.reason}`}`)

    if (judgeResult.passed) {
      console.log(`\n🎉 ALL 4 SANDBOX JUDGE CRITERIA PASSED on Turn ${turn}!`)
      console.log('✨ Verified mini-program synthesized successfully!')
      isVerified = true
      verifiedCode = candidateCode
      break
    }

    // Build diagnostic feedback for next turn
    const failures = []
    if (!judgeResult.safety.passed)
      failures.push(`Runtime Safety: ${judgeResult.safety.reason}`)
    if (!judgeResult.heading.passed)
      failures.push(`Dynamic Heading: ${judgeResult.heading.reason}`)
    if (!judgeResult.actions.passed)
      failures.push(`Action Diversity: ${judgeResult.actions.reason}`)
    if (!judgeResult.loss.passed)
      failures.push(`Game-Over Consistency: ${judgeResult.loss.reason}`)

    const critique = `Automated Sandbox Judge Test on Turn ${turn} FAILED with ${failures.length} issue(s):
${failures.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Please review these empirical failures, fix your logic, and output the updated complete code inside a \`\`\`javascript block.`

    console.log(`\n💬 Sending Critique Feedback to Agent for Turn ${turn + 1}...`)
    messages.push({ role: 'assistant', content: rawContent })
    messages.push({ role: 'user', content: critique })
  }

  if (isVerified) {
    console.log('\n===============================================================')
    console.log('🏆 AGENTIC SYNTHESIS COMPLETE: VERIFIED CODE')
    console.log('===============================================================')
    console.log(verifiedCode)
  }
  else {
    console.log('\n⚠️ Reached maximum turns without passing all judge criteria.')
  }
}

// --- Automated Sandbox Judge ---
function runSandboxJudge(code, frames, diffUtils) {
  const result = {
    passed: false,
    safety: { passed: true, reason: '' },
    heading: { passed: true, reason: '' },
    actions: { passed: true, reason: '' },
    loss: { passed: true, reason: '' },
  }

  // 1. Runtime Safety (compilation)
  let extractFn = null
  let evaluateFn = null
  try {
    const wrapped = `
      ${code}
      return {
        extractGameState: typeof extractGameState !== 'undefined' ? extractGameState : null,
        evaluateGameState: typeof evaluateGameState !== 'undefined' ? evaluateGameState : null,
      };
    `
    const factory = new Function('diffUtils', wrapped)
    const exports = factory(diffUtils)
    extractFn = exports.extractGameState
    evaluateFn = exports.evaluateGameState
    if (!extractFn) {
      result.safety = { passed: false, reason: 'extractGameState function was not defined.' }
      return result
    }
  }
  catch (compErr) {
    result.safety = { passed: false, reason: `Syntax or compilation error: ${compErr.message}` }
    return result
  }

  // Frame execution
  const frameStates = []
  const frameActions = []
  let execErrors = 0
  let sampleError = ''
  let prevFrame = null

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    try {
      const state = extractFn(null, null, frame, diffUtils)
      frameStates.push({ i, frame, state })
      if (evaluateFn) {
        const action = evaluateFn(prevFrame, frame, {}, diffUtils)
        frameActions.push(action)
      }
    }
    catch (err) {
      execErrors++
      if (!sampleError)
        sampleError = `Frame #${i}: ${err.message}`
    }
    prevFrame = frame
  }

  if (execErrors > 0) {
    result.safety = { passed: false, reason: `${execErrors} runtime exceptions thrown (e.g. ${sampleError})` }
  }

  // 2. Dynamic Heading
  const headings = frameStates
    .map(s => s.state?.controllableEntity?.heading || s.state?.player?.heading)
    .filter(Boolean)
  const uniqueHeadings = new Set(headings)

  if (headings.length >= 5) {
    if (uniqueHeadings.size <= 1) {
      const onlyHeading = [...uniqueHeadings][0]
      result.heading = {
        passed: false,
        reason: `Heading is permanently stuck on '${onlyHeading}' across all ${headings.length} frames. diffUtils.getClusters() does not provide velocity. Compute heading from diff deltas (added vs removed) or trackTrajectories.`,
      }
    }
    else if (uniqueHeadings.has('STATIONARY') && uniqueHeadings.size === 1) {
      result.heading = {
        passed: false,
        reason: `Heading is 100% 'STATIONARY'. You must calculate directional headings (UP, DOWN, LEFT, RIGHT).`,
      }
    }
  }

  // 3. Action Diversity
  if (evaluateFn) {
    const validActions = frameActions.filter(a => a && a !== 'none')
    const uniqueActions = new Set(validActions)
    if (validActions.length >= 5 && uniqueActions.size <= 1) {
      const onlyAction = [...uniqueActions][0]
      result.actions = {
        passed: false,
        reason: `evaluateGameState output only a single action ('${onlyAction}') across all ${validActions.length} frames. It must dynamically steer based on heading or targets.`,
      }
    }
  }

  // 4. Game-Over Consistency
  const lossFrames = frameStates.filter(s => Boolean(s.state?.isGameOver)).map(s => s.i)
  if (lossFrames.includes(0) || lossFrames.includes(1)) {
    result.loss = {
      passed: false,
      reason: `isGameOver triggered immediately on initial startup/intro frame #${lossFrames[0]}. Intro screen clears must not be mistaken for game over.`,
    }
  }
  else if (lossFrames.length > 0) {
    const firstLoss = lossFrames[0]
    const flapped = frameStates.find(s => s.i > firstLoss && !s.state?.isGameOver)
    if (flapped) {
      result.loss = {
        passed: false,
        reason: `isGameOver flapped: triggered at frame #${firstLoss}, but reverted to false at frame #${flapped.i}. Once game over occurs, it must remain true.`,
      }
    }
  }

  result.passed = result.safety.passed && result.heading.passed && result.actions.passed && result.loss.passed
  return result
}

// --- System-1 Jev Reflex Routine ---
async function runJevReflexTest(history) {
  console.log('\n===============================================================')
  console.log('⚡ Testing System-1 Fast Reflex Loop (TypeSafe Jev)')
  console.log('===============================================================')

  const apiKey = env.TYPESAFE_API_KEY
  if (!apiKey) {
    console.warn('⚠️  TYPESAFE_API_KEY not found in .env, skipping Jev test.')
    return
  }

  // Pick an active moving frame
  const sample = history.find(s => s.player && s.player.heading !== 'STATIONARY') || history[10]
  if (!sample) {
    console.warn('No active frame found to test Jev.')
    return
  }

  console.log(`Evaluating reflex decision for Frame #${sample.frameIndex} (Heading: ${sample.player?.heading}, Targets: ${sample.targets.length})`)

  const payload = {
    game: 'Nibbles',
    player: sample.player,
    nearestTarget: sample.targets[0] || null,
    threats: sample.threats.slice(0, 3),
  }

  const t0 = performance.now()
  try {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        state: JSON.stringify(payload),
        questions: {
          motor_action: {
            type: 'choice',
            instructions: 'Select next motor key to navigate towards target and avoid collision.',
            criteria: {
              UP: 'Navigate upwards',
              DOWN: 'Navigate downwards',
              LEFT: 'Navigate left',
              RIGHT: 'Navigate right',
              MAINTAIN: 'Maintain current heading',
            },
          },
        },
        model: 'jev-latest',
      }),
    })

    if (!res.ok) {
      console.error(`❌ Jev API returned HTTP ${res.status}: ${await res.text()}`)
      return
    }

    const data = await res.json()
    const elapsed = Math.round(performance.now() - t0)
    console.log(`⚡ Jev reflex resolved in ${elapsed}ms:`)
    console.log('Response:', JSON.stringify(data.answers || data, null, 2))
  }
  catch (err) {
    console.error('❌ Jev evaluation failed:', err.message)
  }
}
