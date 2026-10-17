/**
 * Evaluates Question Triage on LoCoMo conv-47 (150 QA pairs):
 * Heuristic Regex Baseline vs. Laya Zero-Shot System-1 Classifier.
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { Laya } from '@receptron/laya'

import { heuristicRegexTriage, layaZeroShotTriage } from './laya-triage.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../../..')

const DATASET_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47.json')
const convData = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'))
const qas = convData.qa.filter(q => q.category >= 1 && q.category <= 4)

console.info('================================================================')
console.info('LoCoMo conv-47 Triage Evaluation (150 Questions)')
console.info('Heuristic Regex Baseline vs. Laya Zero-Shot ONNX System-1')
console.info('================================================================\n')

console.info(`Loaded ${qas.length} non-adversarial QA pairs from conv-47.`)

// 1. Initialize Laya
console.info('Loading Laya ONNX model from cache...')
const layaT0 = performance.now()
const laya = await Laya.load()
console.info(`Laya loaded in ${((performance.now() - layaT0) / 1000).toFixed(2)}s.\n`)

// 2. Evaluate
const results = []
let regexCorrect = 0
let layaCorrect = 0
let totalLayaTimeMs = 0

const catStats = {
  1: { name: 'Multi-Hop (C1)', count: 0, regexHits: 0, layaHits: 0 },
  2: { name: 'Temporal (C2)', count: 0, regexHits: 0, layaHits: 0 },
  3: { name: 'Detective (C3)', count: 0, regexHits: 0, layaHits: 0 },
  4: { name: 'Literal (C4)', count: 0, regexHits: 0, layaHits: 0 },
}

console.info('Running triage evaluation on 150 questions...')
const evalT0 = performance.now()

for (let i = 0; i < qas.length; i++) {
  const q = qas[i]
  const goldCat = q.category
  catStats[goldCat].count++

  // Heuristic Regex
  const regexRes = heuristicRegexTriage(q.question)
  const isRegexMatch = regexRes.category === goldCat
  if (isRegexMatch) {
    regexCorrect++
    catStats[goldCat].regexHits++
  }

  // Laya Zero-Shot
  const layaRes = await layaZeroShotTriage(laya, q.question)
  totalLayaTimeMs += layaRes.latencyMs
  const isLayaMatch = layaRes.category === goldCat
  if (isLayaMatch) {
    layaCorrect++
    catStats[goldCat].layaHits++
  }

  results.push({
    index: i,
    question: q.question,
    goldCategory: goldCat,
    regex: { category: regexRes.category, method: regexRes.method, match: isRegexMatch },
    laya: { category: layaRes.category, choice: layaRes.choice, confidence: layaRes.confidence, match: isLayaMatch, latencyMs: layaRes.latencyMs },
  })

  if ((i + 1) % 25 === 0 || i === qas.length - 1) {
    const elapsed = ((performance.now() - evalT0) / 1000).toFixed(1)
    console.info(`  [${i + 1}/${qas.length}] (${elapsed}s) - Regex: ${((regexCorrect / (i + 1)) * 100).toFixed(1)}% | Laya: ${((layaCorrect / (i + 1)) * 100).toFixed(1)}%`)
  }
}

const totalTimeSec = ((performance.now() - evalT0) / 1000).toFixed(2)
const avgLayaMs = (totalLayaTimeMs / qas.length).toFixed(1)

console.info('\n================================================================')
console.info('TRIAGE EVALUATION SCORECARD')
console.info('================================================================')
console.info(`Total Evaluated: ${qas.length} questions in ${totalTimeSec}s`)
console.info(`Average Laya Inference: ${avgLayaMs} ms / question (Local ONNX, $0.00)\n`)

console.info('Category Breakdown:')
console.info('----------------------------------------------------------------')
console.info('Category                  | Count | Heuristic Regex | Laya System-1')
console.info('----------------------------------------------------------------')
for (const stats of Object.values(catStats)) {
  const regPct = stats.count > 0 ? ((stats.regexHits / stats.count) * 100).toFixed(1) : '0.0'
  const layaPct = stats.count > 0 ? ((stats.layaHits / stats.count) * 100).toFixed(1) : '0.0'
  const padName = stats.name.padEnd(25)
  const padCount = String(stats.count).padStart(5)
  const padReg = `${stats.regexHits}/${stats.count} (${regPct}%)`.padStart(15)
  const padLaya = `${stats.layaHits}/${stats.count} (${layaPct}%)`.padStart(15)
  console.info(`${padName} | ${padCount} | ${padReg} | ${padLaya}`)
}
console.info('----------------------------------------------------------------')
const overallRegPct = ((regexCorrect / qas.length) * 100).toFixed(1)
const overallLayaPct = ((layaCorrect / qas.length) * 100).toFixed(1)
console.info(`OVERALL ACCURACY          |   150 | ${String(regexCorrect).padStart(3)}/150 (${overallRegPct}%) | ${String(layaCorrect).padStart(3)}/150 (${overallLayaPct}%)`)
console.info('================================================================\n')

// Save detailed trace
const tracePath = path.join(ROOT, 'reports/memory-lab/locomo-conv47-triage-trace.json')
fs.writeFileSync(tracePath, JSON.stringify({
  summary: {
    totalQuestions: qas.length,
    overallRegexAccuracy: Number(overallRegPct),
    overallLayaAccuracy: Number(overallLayaPct),
    avgLayaLatencyMs: Number(avgLayaMs),
    categoryBreakdown: catStats,
  },
  results,
}, null, 2))

console.info(`Detailed trace saved to: ${tracePath}`)
