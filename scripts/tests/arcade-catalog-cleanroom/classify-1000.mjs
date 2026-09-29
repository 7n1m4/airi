/**
 * Classify Top 1,000 MS-DOS Games using TypeSafe Jev System-1
 * Endpoint: https://api.typesafe.ai/v1/systemone
 * Model: jev-latest
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const DATA_DIR = path.join(__dirname, 'data')
const INPUT_FILE = path.join(DATA_DIR, 'catalog-1000.json')
const OUTPUT_FILE = path.join(DATA_DIR, 'classified-1000.json')

// Read API Key securely from ROOT/.env
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
const CONCURRENCY = 6

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
  gameplay_pace: {
    type: 'choice',
    instructions: 'What is the physical time cadence of this game?',
    criteria: {
      realtime_twitch: 'Game progresses continuously at high speed; hesitation results in immediate death or damage.',
      realtime_relaxed: 'Real-time clock runs, but game allows pausing or slow pacing without instant death.',
      turn_based: 'Game waits indefinitely for player input before advancing time.',
    },
  },
  visual_modality: {
    type: 'choice',
    instructions: 'What is the primary visual presentation architecture?',
    criteria: {
      'cga_text_or_grid': 'ASCII/ANSI text mode, discrete grid cells, simple monochrome/CGA blocks, or spreadsheet UI.',
      '2d_raster_sprites': '2D side-scrolling or top-down raster pixel sprites and animations.',
      '3d_or_raycast': 'First-person 3D raycasting, vector wireframes, or pseudo-3D perspective.',
    },
  },
}

async function classifyGame(game) {
  const cleanDesc = game.description
    ? game.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 600)
    : 'No description available'

  const state = `Game Title: ${game.title} (${game.year || 'Unknown Year'})\nMetadata: ${cleanDesc}`

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
    const errText = await res.text()
    throw new Error(`HTTP ${res.status}: ${errText}`)
  }

  const json = await res.json()
  return {
    rank: game.rank,
    identifier: game.identifier,
    title: game.title,
    year: game.year,
    downloads: game.downloads,
    answers: {
      recommended_system: json.answers?.recommended_system?.choice || 'unknown',
      gameplay_pace: json.answers?.gameplay_pace?.choice || 'unknown',
      visual_modality: json.answers?.visual_modality?.choice || 'unknown',
    },
  }
}

async function main() {
  console.log('=== TypeSafe Jev: 1,000 MS-DOS Games Batch Triage ===')
  console.log(`Model: ${MODEL} | Concurrency: ${CONCURRENCY}`)

  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file ${INPUT_FILE} not found! Run fetch-catalog.mjs first.`)
  }

  const catalog = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'))
  console.log(`Loaded ${catalog.length} games from ${INPUT_FILE}`)

  // Load existing checkpoint if present
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
  console.log(`Games remaining to classify: ${queue.length}`)

  let completed = processedIds.size
  const total = catalog.length
  const startTime = Date.now()

  // Concurrency pool
  let cursor = 0
  async function worker(workerId) {
    while (cursor < queue.length) {
      const idx = cursor++
      const game = queue[idx]
      try {
        const classified = await classifyGame(game)
        results.push(classified)
        completed++

        if (completed % 10 === 0 || completed === total) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          const rate = (completed / (elapsed || 1)).toFixed(1)
          process.stdout.write(`\r[Progress] ${completed}/${total} (${((completed / total) * 100).toFixed(1)}%) | ${rate} games/s | Elapsed: ${elapsed}s`)
        }

        // Checkpoint every 50 games
        if (completed % 50 === 0) {
          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf8')
        }
      }
      catch (err) {
        console.error(`\nWorker ${workerId} failed on "${game.title}" (${game.identifier}):`, err.message)
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1))
  await Promise.all(workers)

  // Sort by original rank
  results.sort((a, b) => a.rank - b.rank)
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf8')

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n\nClassified all ${results.length} games in ${totalTime}s!`)
  console.log(`Saved results to: ${OUTPUT_FILE}`)
}

main().catch((err) => {
  console.error('\nFatal classification error:', err)
  process.exit(1)
})
