/**
 * Full Analysis & Executive Report for Complete 8,924 MS-DOS Catalog
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const RESULTS_FILE = path.join(DATA_DIR, 'classified-full.json')
const METRICS_FILE = path.join(DATA_DIR, 'run-metrics.json')

function analyze() {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error(`Results file not found: ${RESULTS_FILE}`)
    process.exit(1)
  }

  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'))
  const metrics = fs.existsSync(METRICS_FILE) ? JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8')) : {}

  console.info(`\n========================================================================`)
  console.info(`PROJECT AIRI: COMPLETE MS-DOS PRESERVATION CATALOG TRIAGE REPORT`)
  console.info(`========================================================================`)
  console.info(`Total Classified:   ${results.length.toLocaleString()} games`)
  if (metrics.totalCostUSD !== undefined) {
    console.info(`Total Wall Time:    ${metrics.elapsedSeconds}s (${(metrics.elapsedSeconds / 60).toFixed(2)} min)`)
    console.info(`Throughput:         ${metrics.ratePerSecond} games/second`)
    console.info(`Total Tokens:       ${metrics.totalTokens.toLocaleString()}`)
    console.info(`Final API Cost:     $${metrics.totalCostUSD.toFixed(4)} USD`)
  }
  console.info(`========================================================================\n`)

  function printFacet(title, key) {
    const counts = {}
    results.forEach((r) => {
      const val = r.answers?.[key] || 'unknown'
      counts[val] = (counts[val] || 0) + 1
    })

    console.info(`--- ${title} ---`)
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      const pct = ((v / results.length) * 100).toFixed(1)
      console.info(`  ${k.padEnd(28)} : ${v.toString().padStart(5)} (${pct.padStart(5)}%)`)
    })
    console.info('')
  }

  printFacet('1. RECOMMENDED COGNITIVE ENGINE', 'recommended_system')
  printFacet('2. SCREEN MOTION ARCHITECTURE (TECHNOLOGY TIER)', 'screen_motion_architecture')
  printFacet('3. GAMEPLAY PACING', 'gameplay_pace')
  printFacet('4. PRIMARY GENRE', 'primary_genre')
  printFacet('5. PRIMARY CONTROLLER INTERFACE', 'primary_controller')
  printFacet('6. COMPANION BACKSEAT PERSONA', 'companion_role')

  // Highlights: Tier 1 Fixed Single Screen Games (Pure Pixel Diff Candidates)
  const tier1Games = results.filter(r => r.answers?.screen_motion_architecture === 'fixed_single_screen')
  console.info(`--- TIER 1 CANDIDATES (Fixed Single Screen -> Pixel Diffing): ${tier1Games.length} Games ---`)
  console.info(`Top 10 Most Downloaded Tier 1 Titles:`)
  tier1Games.slice(0, 10).forEach((r) => {
    console.info(`  - [Rank #${r.rank.toString().padStart(4)}] ${r.title.padEnd(35)} (${r.downloads.toLocaleString()} dl) -> Genre: ${r.answers.primary_genre}`)
  })
}

analyze()
