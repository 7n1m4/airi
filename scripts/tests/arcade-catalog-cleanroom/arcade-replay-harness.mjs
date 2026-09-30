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

for (let i = 0; i < framesToProcess.length; i++) {
  const frame = framesToProcess[i]
  const t0 = performance.now()

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
    player: player ? { x: player.x, y: player.y, heading: player.heading, size: player.size } : null,
    threats: threats.map(t => ({ x: t.x, y: t.y, heading: t.heading, size: t.size })),
    targets: targets.map(tgt => ({ x: tgt.x, y: tgt.y })),
    isGameOver: isLoss,
    computeMs: Math.round(frameTimeMs * 100) / 100,
  }
  stateHistory.push(semanticState)
  prevClusters = trackedClusters

  // Optional ASCII Render for key turning frames or loss frames
  if (shouldRender && (frame.keys?.length > 0 || isLoss || i % 25 === 0)) {
    renderAsciiGrid(frame, semanticState)
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
  await runSynthesisTest(traceData)
}

// 6. Optional System-1 Reflex Evaluation (TypeSafe Jev)
if (shouldQueryJev) {
  await runJevReflexTest(stateHistory)
}

console.log('\n✅ Cleanroom Replay Complete.')

// --- ASCII Grid Renderer ---
function renderAsciiGrid(frame, state) {
  const cols = 40 // Downsampled width for terminal display
  const rows = 15 // Downsampled height for terminal display
  const grid = Array.from({ length: rows }, () => new Array(cols).fill('.'))

  // Render player
  if (state.player) {
    const px = Math.min(cols - 1, Math.max(0, Math.floor(state.player.x * (cols / 80))))
    const py = Math.min(rows - 1, Math.max(0, Math.floor(state.player.y * (rows / 40))))
    grid[py][px] = 'P'
  }

  // Render threats
  for (const th of state.threats) {
    const tx = Math.min(cols - 1, Math.max(0, Math.floor(th.x * (cols / 80))))
    const ty = Math.min(rows - 1, Math.max(0, Math.floor(th.y * (rows / 40))))
    grid[ty][tx] = 'E'
  }

  // Render targets
  for (const tgt of state.targets) {
    const tgx = Math.min(cols - 1, Math.max(0, Math.floor(tgt.x * (cols / 80))))
    const tgy = Math.min(rows - 1, Math.max(0, Math.floor(tgt.y * (rows / 40))))
    grid[tgy][tgx] = 'T'
  }

  console.log(`\nFrame #${state.frameIndex} [t=${state.t}ms] Keys: [${state.keys.join(', ')}] Heading: ${state.player?.heading || 'NONE'} Loss: ${state.isGameOver ? '💥 CRASH' : 'NO'}`)
  console.log(`┌${'─'.repeat(cols)}┐`)
  for (const row of grid) {
    console.log(`│${row.join('')}│`)
  }
  console.log(`└${'─'.repeat(cols)}┘`)
}

// --- System-2 Synthesis Routine ---
async function runSynthesisTest(trace) {
  console.log('\n===============================================================')
  console.log('🧠 Testing System-2 Extractor Synthesis (OpenCode Go)')
  console.log('===============================================================')

  const apiKey = env.OPENCODE_GO_API_KEY
  const baseUrl = env.OPENCODE_GO_BASE_URL || 'https://opencode.ai/zen/go/v1'

  if (!apiKey) {
    console.warn('⚠️  OPENCODE_GO_API_KEY not found in .env, skipping live synthesis test.')
    return
  }

  const sampleFrames = trace.frames.slice(0, 30).map(f => ({
    t: f.t,
    keys: f.keys,
    addedCount: f.added?.length || 0,
    removedCount: f.removed?.length || 0,
  }))

  const prompt = `You are AIRI's Autonomous Gaming Subsystem.
Synthesize a pure JavaScript state extractor function for this retro game:
Game: "${trace.game}"

The runtime provides standard deterministic \`diffUtils\` primitives:
- \`diffUtils.getClusters(points)\`: returns Array<{ x, y, size, bbox }>
- \`diffUtils.trackTrajectories(prevClusters, currClusters)\`: returns clusters with dx, dy, heading
- \`diffUtils.correlateInput(clusters, keys)\`: returns controllable player cluster or null
- \`diffUtils.detectLossBurst(diff)\`: returns boolean true on game over
- \`diffUtils.euclidean(p1, p2)\`: returns distance number

Write complete, fully-executable JavaScript with NO placeholder ellipses (...) or incomplete statements.
Output ONLY the code block:
\`\`\`javascript
function extractGameState(prevGrid, currGrid, diff, diffUtils) {
  const added = (diff && diff.added) || [];
  const clusters = diffUtils.getClusters(added);
  const player = diffUtils.correlateInput(clusters, (diff && diff.keys) || []);
  const threats = clusters.filter(c => c !== player && c.size >= 2);
  const targets = clusters.filter(c => c !== player && c.size === 1);
  const isGameOver = diffUtils.detectLossBurst(diff);
  return {
    player: player ? { x: player.x, y: player.y, heading: player.heading || 'STATIONARY' } : null,
    threats: threats.map(t => ({ x: t.x, y: t.y, size: t.size })),
    targets: targets.map(tgt => ({ x: tgt.x, y: tgt.y })),
    isGameOver
  };
}
\`\`\``

  console.log('Sending request to OpenCode Go...')
  const t0 = performance.now()
  try {
    const synthModel = getArg('--model', 'space-bunny-free')

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'x-opencode-session': crypto.randomUUID(),
      },
      body: JSON.stringify({
        model: synthModel,
        messages: [
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 2500,
      }),
      signal: AbortSignal.timeout(45000),
    })

    if (!res.ok) {
      console.error(`❌ Synthesis API returned HTTP ${res.status}: ${await res.text()}`)
      return
    }

    const data = await res.json()
    const msg = data.choices?.[0]?.message || {}
    const fullText = `${msg.content || ''}\n${msg.reasoning_content || ''}`.trim()
    const codeBlocks = [...fullText.matchAll(/```(?:javascript|js)?\s*([\s\S]*?)```/g)].map(m => m[1].trim())
    let rawCode = codeBlocks.find(b => b.includes('function extractGameState'))
    if (!rawCode) {
      const fnMatch = fullText.match(/function\s+extractGameState\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)
      if (fnMatch)
        rawCode = fnMatch[0]
    }

    if (rawCode) {
      console.log('\n📝 Synthesized Extractor Code:')
      console.log('--------------------------------------------------')
      console.log(rawCode)
      console.log('--------------------------------------------------')

      console.log('\n🧪 Testing Synthesized Function in Cleanroom Sandbox...')
      try {
        const fn = new Function('diffUtils', `${rawCode}; return extractGameState;`)(diffUtils)
        let successCount = 0
        let lossCaught = false

        for (let i = 0; i < trace.frames.length; i++) {
          const f = trace.frames[i]
          const res = fn(null, null, f, diffUtils)
          if (res && (res.player || res.controllableEntity || res.isGameOver !== undefined)) {
            successCount++
          }
          if (res && res.isGameOver)
            lossCaught = true
        }

        console.log(`✅ Sandbox Execution: ${successCount} / ${trace.frames.length} frames evaluated cleanly!`)
        console.log(`💥 Game-Over Event Caught: ${lossCaught ? 'YES' : 'NO'}`)
        console.log(`  Sample State at Frame #10:`, fn(null, null, trace.frames[10], diffUtils))
      }
      catch (execErr) {
        console.error(`⚠️ Sandbox execution error:`, execErr.message)
      }
    }
    else {
      console.log('⚠️ Could not extract function from response text. Full response:')
      console.log(`${fullText.slice(0, 300)}...`)
    }
  }
  catch (err) {
    console.error('❌ Synthesis failed:', err.message)
  }
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
