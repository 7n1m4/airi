#!/usr/bin/env node
/**
 * Soak gate: fail on native-memory growth slope, not absolute RSS.
 *
 * Full soak runbook (macOS):
 *   1. Run the app under load for >= 4h at the production tick rate, with
 *      rapid window-switch bursts injected (worst case = full-frame OCR path).
 *   2. Live-track native pressure alongside:
 *        python3 scripts/monitor-airi-memory.py --log airi-memory.log
 *      (footprint + vmmap Tag 14 Blink canvas / Tag 16 ArrayBuffers / JS VM).
 *   3. Snapshot vmmap at start and end:
 *        /usr/bin/vmmap -summary <pid> > vmmap-start.txt
 *        /usr/bin/vmmap -summary <pid> > vmmap-end.txt
 *      and record swapfile count: ls /var/vm/swapfile* | wc -l
 *   4. Gate the app log (contains [MEM-PROBE] lines with JS Heap + RSS):
 *        node scripts/soak-memory-gate.mjs --log airi.log --duration-hours 4
 *
 * Exit codes: 0 PASS, 1 FAIL (slope over budget), 2 insufficient data.
 *
 * Usage:
 *   node scripts/soak-memory-gate.mjs --log airi.log --duration-hours 4
 *   node scripts/soak-memory-gate.mjs --log airi.log --duration-hours 4 \
 *     --rss-budget-mb-per-hour 200 --heap-budget-mb-per-hour 100
 */

import { readFileSync } from 'node:fs'

function parseArgs(argv) {
  const args = {
    log: null,
    durationHours: 0,
    rssBudget: 200,
    heapBudget: 100,
  }
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    const next = argv[i + 1]
    if (flag === '--log')
      args.log = next
    else if (flag === '--duration-hours')
      args.durationHours = Number(next)
    else if (flag === '--rss-budget-mb-per-hour')
      args.rssBudget = Number(next)
    else if (flag === '--heap-budget-mb-per-hour')
      args.heapBudget = Number(next)
    else continue
    i++
  }
  return args
}

// Matches: [MEM-PROBE] ... JS Heap: 123.4 MB / ... [RSS: 1500 MB] [Pressure: elevated]
const PROBE_RE = /\[MEM-PROBE\].*?JS Heap:\s*([\d.]+)\s*MB(?:.*?RSS:\s*([\d.]+)\s*MB)?(?:.*?Pressure:\s*(\w+))?/

function main() {
  const args = parseArgs(process.argv)
  if (!args.log || !(args.durationHours > 0)) {
    console.error('Usage: node scripts/soak-memory-gate.mjs --log <airi.log> --duration-hours <h> [--rss-budget-mb-per-hour N] [--heap-budget-mb-per-hour N]')
    process.exit(2)
  }

  let text
  try {
    text = readFileSync(args.log, 'utf8')
  }
  catch (err) {
    console.error(`Cannot read log file: ${args.log} (${err.message})`)
    process.exit(2)
  }

  const heap = []
  const rss = []
  let criticalCount = 0
  for (const line of text.split('\n')) {
    const m = line.match(PROBE_RE)
    if (!m)
      continue
    heap.push(Number(m[1]))
    if (m[2] !== undefined)
      rss.push(Number(m[2]))
    if (m[3] === 'critical')
      criticalCount++
  }

  if (heap.length < 2) {
    console.error(`Insufficient data: found ${heap.length} [MEM-PROBE] lines (need >= 2).`)
    process.exit(2)
  }

  const slope = (series) => {
    if (series.length < 2)
      return null
    return (series[series.length - 1] - series[0]) / args.durationHours
  }
  const heapSlope = slope(heap)
  const rssSlope = slope(rss)

  const heapStr = `${heap[0].toFixed(1)} -> ${heap[heap.length - 1].toFixed(1)} MB (${heapSlope >= 0 ? '+' : ''}${heapSlope.toFixed(1)}/h, budget ${args.heapBudget}/h)`
  const rssStr = rssSlope === null
    ? 'no RSS samples (renderer without process.memoryUsage; gate on heap only)'
    : `${rss[0].toFixed(0)} -> ${rss[rss.length - 1].toFixed(0)} MB (${rssSlope >= 0 ? '+' : ''}${rssSlope.toFixed(1)}/h, budget ${args.rssBudget}/h)`
  console.log(`Samples: ${heap.length} probes over ${args.durationHours}h | critical-pressure probes: ${criticalCount}`)
  console.log(`JS Heap slope: ${heapStr}`)
  console.log(`RSS slope:     ${rssStr}`)

  const failures = []
  if (heapSlope > args.heapBudget)
    failures.push(`JS heap slope ${heapSlope.toFixed(1)}/h over budget ${args.heapBudget}/h`)
  if (rssSlope !== null && rssSlope > args.rssBudget)
    failures.push(`RSS slope ${rssSlope.toFixed(1)}/h over budget ${args.rssBudget}/h`)
  if (criticalCount > 0)
    failures.push(`${criticalCount} probe(s) hit critical pressure (degraded paths engaged; investigate before release)`)

  if (failures.length > 0) {
    console.error('FAIL:')
    for (const f of failures) console.error(`  - ${f}`)
    console.error('Next: compare vmmap-start/end Tag 14/16 deltas + swapfile count (see header runbook).')
    process.exit(1)
  }
  console.log('PASS: slopes within budget, no critical-pressure probes.')
}

main()
