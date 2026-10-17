/**
 * Outlier & Distribution Analysis for 1,000 Classified Games
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const RESULTS_FILE = path.join(DATA_DIR, 'classified-1000.json')

/**
 * NOTICE: eslint's no-console only allows `warn`/`error`/`info`. This analysis
 * report is entirely user-facing prose, so all report lines route through
 * `console.info` via a single helper.
 */
function log(...args) {
  console.info(...args)
}

function analyze() {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error(`Results file not found: ${RESULTS_FILE}`)
    process.exit(1)
  }

  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'))
  log(`\n======================================================`)
  log(`ANALYSIS OF ${results.length} CLASSIFIED MS-DOS GAMES`)
  log(`======================================================\n`)

  // 1. Distributions
  const distSystem = {}
  const distPace = {}
  const distVisual = {}

  results.forEach((r) => {
    const s = r.answers?.recommended_system || 'unknown'
    const p = r.answers?.gameplay_pace || 'unknown'
    const v = r.answers?.visual_modality || 'unknown'

    distSystem[s] = (distSystem[s] || 0) + 1
    distPace[p] = (distPace[p] || 0) + 1
    distVisual[v] = (distVisual[v] || 0) + 1
  })

  log('--- 1. Recommended Cognitive Engine ---')
  Object.entries(distSystem).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    const pct = ((v / results.length) * 100).toFixed(1)
    log(`  ${k.padEnd(25)} : ${v.toString().padStart(4)} (${pct}%)`)
  })

  log('\n--- 2. Gameplay Pacing ---')
  Object.entries(distPace).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    const pct = ((v / results.length) * 100).toFixed(1)
    log(`  ${k.padEnd(25)} : ${v.toString().padStart(4)} (${pct}%)`)
  })

  log('\n--- 3. Visual Modality ---')
  Object.entries(distVisual).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    const pct = ((v / results.length) * 100).toFixed(1)
    log(`  ${k.padEnd(25)} : ${v.toString().padStart(4)} (${pct}%)`)
  })

  // 2. Discrepancy & Contradiction Detection
  log('\n--- 4. Semantic Contradiction & Outlier Check ---')

  // Contradiction: system1_reflex (twitch motor keypresses) paired with turn_based pace
  const reflexTurnBased = results.filter(r =>
    r.answers?.recommended_system === 'system1_reflex' && r.answers?.gameplay_pace === 'turn_based',
  )
  log(`  Contradiction (System 1 Reflex + Turn-Based): ${reflexTurnBased.length} items`)
  if (reflexTurnBased.length > 0) {
    log('  Sample contradictions:')
    reflexTurnBased.slice(0, 5).forEach((r) => {
      log(`    - [Rank ${r.rank}] ${r.title} (${r.year})`)
    })
  }

  // Unsupported or Utilities in Top 100 Downloads
  const topUtilities = results.filter(r => r.rank <= 100 && r.answers?.recommended_system === 'unsupported_utility')
  log(`\n  Top 100 Popular Items Classified as Utility/Non-Game: ${topUtilities.length} items`)
  topUtilities.forEach((r) => {
    log(`    - [Rank ${r.rank}] ${r.title} (${r.year}) - ${r.downloads} downloads`)
  })

  // Sample Breakdown of Top 10 Games
  log('\n--- 5. Spot-Check of Top 10 Most Downloaded Titles ---')
  results.slice(0, 10).forEach((r) => {
    log(`  #${r.rank.toString().padStart(2)}: ${r.title.padEnd(35)} -> Engine: ${r.answers?.recommended_system} | Pace: ${r.answers?.gameplay_pace} | Visual: ${r.answers?.visual_modality}`)
  })
}

analyze()
