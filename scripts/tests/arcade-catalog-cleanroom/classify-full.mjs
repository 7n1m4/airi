/**
 * Full Catalog Triage: Classify all 8,924 MS-DOS Games using TypeSafe Jev System-1
 * Endpoint: https://api.typesafe.ai/v1/systemone
 * Model: jev-latest
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const DATA_DIR = path.join(__dirname, 'data')
const INPUT_FILE = path.join(DATA_DIR, 'catalog-full.json')
const OUTPUT_FILE = path.join(DATA_DIR, 'classified-full.json')
const METRICS_FILE = path.join(DATA_DIR, 'run-metrics.json')

function getApiKey() {
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) {
    throw new Error('.env file not found in repository root!')
  }
  const content = fs.readFileSync(envPath, 'utf8')
  const match = content.match(/TYPESAFE_API_KEY=(.+)/)
  if (!match) {
    throw new Error('TYPESAFE_API_KEY not found in .env!')
  }
  return match[1].trim()
}

const API_KEY = getApiKey()
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const MODEL = 'jev-latest'
const CONCURRENCY = 8

const QUESTIONS = {
  recommended_system: {
    type: 'choice',
    instructions: 'Which cognitive engine should AIRI use to play or assist with this retro game?',
    criteria: {
      system1_reflex: 'Real-time action, fast reflex arcade, platformer, shooter, snake, fighting, or racing game requiring immediate 10 Hz motor keypresses to survive.',
      system2_strategy: 'Turn-based strategy, puzzle, card/board game, city/business simulation, or point-and-click graphical adventure requiring deliberative multi-step visual planning.',
      system2_narrative: 'Interactive fiction text adventure or RPG dialog parser navigated primarily via typing natural language sentences.',
      unsupported_utility: 'Non-game software, operating system disk, shareware catalog menu, hardware driver compilation, or benchmark tool.',
    },
  },
  screen_motion_architecture: {
    type: 'choice',
    instructions: 'How does the game display move and frame the playfield?',
    criteria: {
      fixed_single_screen: 'The entire real-time playing field fits on one static non-scrolling screen; character and obstacles move, but camera never pans (e.g. Snake, Pac-Man, Pong, Tetris, Space Invaders).',
      flip_screen_rooms: 'Game world is divided into distinct static rooms; camera cuts/jumps to next screen when reaching the boundary (e.g. Prince of Persia, Pitfall).',
      smooth_scrolling_camera: 'Camera continuously pans and scrolls horizontally or vertically across a larger 2D world (e.g. Commander Keen, Jazz Jackrabbit, Digger).',
      first_person_or_3d: '3D raycasted, vector, or polygonal world with continuous 3D rotation and perspective translation (e.g. Doom, Wolfenstein 3D).',
      static_ui_or_turn_based: 'Static desktop GUI, turn-based strategy map, board game, or text parser terminal without continuous real-time camera physics (e.g. SimCity, Civilization, Zork, Minesweeper).',
    },
  },
  gameplay_pace: {
    type: 'choice',
    instructions: 'What is the physical time cadence of this game?',
    criteria: {
      realtime_twitch: 'Game progresses continuously at high speed; hesitation results in immediate death or damage.',
      realtime_relaxed: 'Real-time clock runs, but game allows pausing or slow pacing without instant death.',
      turn_based: 'Game waits indefinitely for player input before advancing time.',
    },
  },
  primary_genre: {
    type: 'choice',
    instructions: 'What is the primary video game genre?',
    criteria: {
      action_arcade: 'Fast classic arcade, snake, maze, or dodging game.',
      platformer: '2D side-scrolling platform running and jumping.',
      fps_shooter: 'First-person shooter or space flight shooter.',
      strategy_simulation: 'City builder, military grand strategy, management sim, or god game.',
      rpg_dungeon: 'Role-playing game with character stats, inventory, and dungeons.',
      adventure_puzzle: 'Point-and-click graphic adventure, mystery, or spatial puzzle.',
      sports_racing: 'Sports contest, racing driving, or vehicular competition.',
      utility_other: 'Non-game utility or catalog disk.',
    },
  },
  primary_controller: {
    type: 'choice',
    instructions: 'What primary input hardware interface does this game require?',
    criteria: {
      gamepad_or_arrows: 'Directional arrows / WASD plus 1-2 action buttons (Space/Ctrl/Enter).',
      mouse_pointer: 'Mouse cursor aiming, clicking, or dragging across visual UI buttons.',
      text_keyboard_typing: 'Typing natural text words, verb commands, or numeric prompts.',
      complex_sim_keypad: 'Complex flight sim keyboard with dozens of cockpit hotkeys.',
    },
  },
  companion_role: {
    type: 'choice',
    instructions: 'What persona tone should AIRI adopt while watching or playing this game?',
    criteria: {
      hype_cheerleader: 'Energetic, gasping, screaming at near-misses, celebrating frantic clutch saves.',
      strategic_adviser: 'Thoughtful, calculating, debating city budgets or long-term territorial plans.',
      detective_partner: 'Observant, analyzing dialog clues, inventory items, and storyline puzzles.',
      laidback_observer: 'Relaxed retro commentary and chill casual banter.',
    },
  },
}

let totalInputTokens = 0
let totalOutputTokens = 0

async function classifyWithRetry(game, maxRetries = 3) {
  const cleanDesc = game.description
    ? game.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 600)
    : 'No description available'

  const state = `Game Title: ${game.title} (${game.year || 'Unknown Year'})\nMetadata: ${cleanDesc}`

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          state,
          questions: QUESTIONS,
        }),
      })

      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          await new Promise(r => setTimeout(r, attempt * 1000))
          continue
        }
        const errText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errText}`)
      }

      const json = await res.json()
      if (json.usage) {
        totalInputTokens += json.usage.input_tokens || 0
        totalOutputTokens += json.usage.output_tokens || 0
      }

      return {
        rank: game.rank,
        identifier: game.identifier,
        title: game.title,
        year: game.year,
        downloads: game.downloads,
        answers: {
          recommended_system: json.answers?.recommended_system?.choice || 'unknown',
          screen_motion_architecture: json.answers?.screen_motion_architecture?.choice || 'unknown',
          gameplay_pace: json.answers?.gameplay_pace?.choice || 'unknown',
          primary_genre: json.answers?.primary_genre?.choice || 'unknown',
          primary_controller: json.answers?.primary_controller?.choice || 'unknown',
          companion_role: json.answers?.companion_role?.choice || 'unknown',
        },
      }
    }
    catch (err) {
      if (attempt === maxRetries)
        throw err
      await new Promise(r => setTimeout(r, attempt * 500))
    }
  }
}

async function main() {
  console.log('=== TypeSafe Jev: Complete 8,924 MS-DOS Catalog Batch Triage ===')
  console.log(`Model: ${MODEL} | Concurrency: ${CONCURRENCY} | Price: $42 / Billion tokens`)

  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file ${INPUT_FILE} not found! Run fetch-full.mjs first.`)
  }

  const catalog = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'))
  console.log(`Loaded ${catalog.length} games from ${INPUT_FILE}`)

  let results = []
  const processedIds = new Set()
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'))
      results.forEach(r => processedIds.add(r.identifier))
      console.log(`Resuming from checkpoint: ${processedIds.size} already classified.`)
    }
    catch {
      results = []
    }
  }

  const queue = catalog.filter(g => !processedIds.has(g.identifier))
  console.log(`Games remaining to classify: ${queue.length}\n`)

  let completed = processedIds.size
  const total = catalog.length
  const startTime = Date.now()

  let cursor = 0
  async function worker(workerId) {
    while (cursor < queue.length) {
      const idx = cursor++
      const game = queue[idx]
      try {
        const classified = await classifyWithRetry(game)
        results.push(classified)
        completed++

        if (completed % 25 === 0 || completed === total) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          const rate = (completed / (elapsed || 1)).toFixed(1)
          const etaSec = Math.round((total - completed) / (Number.parseFloat(rate) || 1))
          const costSoFar = (((totalInputTokens + totalOutputTokens) * 42) / 1_000_000_000).toFixed(4)
          process.stdout.write(`\r[Progress] ${completed}/${total} (${((completed / total) * 100).toFixed(1)}%) | ${rate} g/s | ETA: ${etaSec}s | Cost: $${costSoFar}`)
        }

        // Checkpoint every 200 games
        if (completed % 200 === 0) {
          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf8')
        }
      }
      catch (err) {
        console.error(`\nWorker ${workerId} error on "${game.title}":`, err.message)
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1))
  await Promise.all(workers)

  results.sort((a, b) => a.rank - b.rank)
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf8')

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
  const totalTokens = totalInputTokens + totalOutputTokens
  const finalCost = ((totalTokens * 42) / 1_000_000_000).toFixed(4)

  const metrics = {
    totalGames: results.length,
    elapsedSeconds: Number.parseFloat(totalTime),
    ratePerSecond: Number.parseFloat((results.length / Number.parseFloat(totalTime)).toFixed(2)),
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalCostUSD: Number.parseFloat(finalCost),
  }

  fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), 'utf8')

  console.log(`\n\n======================================================`)
  console.log(`CATALOG TRIAGE COMPLETE!`)
  console.log(`Classified:     ${results.length} games`)
  console.log(`Total Time:     ${totalTime}s (${(totalTime / 60).toFixed(2)} min)`)
  console.log(`Throughput:     ${metrics.ratePerSecond} games/sec`)
  console.log(`Total Tokens:   ${totalTokens.toLocaleString()}`)
  console.log(`Final API Cost: $${finalCost} USD`)
  console.log(`======================================================\n`)
}

main().catch((err) => {
  console.error('\nFatal error during full classification:', err)
  process.exit(1)
})
