/**
 * LoCoMo conv-47 Pass 11 (TypeSafe Jev + Hardened Temporal/Graph/Rerank Boundaries + Response Validation).
 *
 * Implements:
 *   - Fix A: Reranker snippet context preservation (retains turn - 1 antecedent)
 *   - Fix B: Candidate pool budgeting reserving slots for Anima date-hook candidates
 *   - Fix C: Hardened temporal event binding (date-fns "day after tomorrow", topic overlap verification)
 *   - Fix D: Hardened graph verification (fail closed on unbound third-party subjects like Mira)
 *   - Response Validation: finish_reason inspection, selective retry for missing/unresolved IDs
 *   - TypeSafe Jev Cloud System-1 Coprocessor (Zero-Shot Triage + Distillation + Cross-Encoder Reranking)
 *   - Monolithic One-Shot System-2 Deductive Resolution (DeepSeek Flash via OpenCode Go)
 */

import fs from 'node:fs'
import path from 'node:path'

import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { AnswerHeadPass3, normalizeCountAnswer, shouldEscalateToSystem2 } from './answer-head-pass3.mjs'
import { DualSearcherPass3 } from './dual-searcher-pass3.mjs'
import { EntityLedger } from './entity-ledger.mjs'
import { HybridSearcher } from './hybrid-searcher.mjs'
import { TypeSafeJevClient } from './jev-client.mjs'
import { jevZeroShotTriage } from './jev-triage.mjs'
import { LocomoMemoryIndex } from './locomo-index.mjs'
import {
  aggregateBenchmarkResults,
  computeBleu1,
  computeTokenF1,
  computeUpstreamLoCoMoF1,
} from './locomo-metrics.mjs'
import { NeedleNode } from './needle-node.mjs'
import { resolveSystem2Batch } from './system2-batch-resolver.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')

// Load environment variables
const envPath = path.join(ROOT, '.env')
let JEV_API_KEY = process.env.TYPESAFE_API_KEY
if (!JEV_API_KEY && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  const match = envContent.match(/TYPESAFE_API_KEY=(.+)/)
  if (match)
    JEV_API_KEY = match[1].trim()
}
if (!JEV_API_KEY) {
  throw new Error('TYPESAFE_API_KEY missing in process.env or .env file')
}

const DATASET_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47.json')
const EMBEDDINGS_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-embeddings-windowed.json')
const Q_EMBEDDINGS_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-question-embeddings.json')
const BASE_LEDGER_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-ledger.json')
const PASS3_LEDGER_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-ledger-pass3.json')
const PASS8_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass8-trace.json')
const PASS9_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass9-trace.json')
const PASS9_LAYA_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass9-laya-trace.json')
const PASS10_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass10-anaphora-trace.json')

const OUTPUT_REPORT_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass11-jev-report.md')
const OUTPUT_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass11-jev-trace.json')

console.log('================================================================')
console.log('LoCoMo conv-47 Pass 11 (Jev Cloud): Peer-Review Hardening Shootout')
console.log('31 Sessions | 689 Turns | 150 Questions | Fixes A/B/C/D + Response Validation')
console.log('================================================================\n')

// 1. Load Dataset
console.log('Loading conv-47 dataset...')
const convData = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'))
const qas = convData.qa.filter(q => q.category >= 1 && q.category <= 4)
console.log(`Loaded ${qas.length} non-adversarial QA pairs.\n`)

// 2. Initialize Models (Jev Client + Needle 2 WASM)
console.log('Initializing TypeSafe Jev Cloud Client...')
const jev = new TypeSafeJevClient(JEV_API_KEY)

console.log('Loading Needle 2 WASM module on CPU...')
const needle = await NeedleNode.load()

// 3. Load Entity Ledger
console.log('\nLoading Pass 3 Entity Ledger...')
let ledger
if (fs.existsSync(PASS3_LEDGER_PATH)) {
  console.log(`Loading cached Pass 3 ledger from ${PASS3_LEDGER_PATH}...`)
  ledger = EntityLedger.fromJSON(JSON.parse(fs.readFileSync(PASS3_LEDGER_PATH, 'utf8')))
}
else if (fs.existsSync(BASE_LEDGER_PATH)) {
  console.log(`Loading baseline ledger from ${BASE_LEDGER_PATH}...`)
  ledger = EntityLedger.fromJSON(JSON.parse(fs.readFileSync(BASE_LEDGER_PATH, 'utf8')))
}
else {
  throw new Error('Ledger not found')
}
console.log(`Entity Ledger loaded with ${ledger.claims.size} claims.\n`)

// 4. Load LocomoMemoryIndex & Hybrid Searcher with Windowed Embeddings
console.log('Initializing in-memory Vector/BM25 Index with Turn-1 Windowed Documents...')
const index = new LocomoMemoryIndex()
index.loadConversation(convData)
const embeddings = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'))
const questionEmbeddings = JSON.parse(fs.readFileSync(Q_EMBEDDINGS_PATH, 'utf-8'))
const hybridSearcher = new HybridSearcher(index, embeddings)

// 5. Load Previous Traces for Comparison
const pass8Trace = fs.existsSync(PASS8_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS8_TRACE_PATH, 'utf8')) : null
const p8Agg = pass8Trace?.metrics?.pass3 || pass8Trace?.metrics?.pass8 || null

const pass9JevTrace = fs.existsSync(PASS9_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS9_TRACE_PATH, 'utf8')) : null
const p9JevAgg = pass9JevTrace?.metrics?.pass9 || null

const pass9LayaTrace = fs.existsSync(PASS9_LAYA_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS9_LAYA_TRACE_PATH, 'utf8')) : null
const p9LayaAgg = pass9LayaTrace?.metrics?.pass9Laya || null

const pass10Trace = fs.existsSync(PASS10_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS10_TRACE_PATH, 'utf8')) : null
const p10Agg = pass10Trace?.metrics?.pass10 || null

// 6. Initialize Dual Searcher & Answer Head
const dualSearcher = new DualSearcherPass3(ledger, hybridSearcher, jev)
const answerHead = new AnswerHeadPass3(needle, jev, index)

// 7. Shootout Loop
console.log('Beginning 150-question Shootout with Pass 11 Hardened Boundaries...')
const shootoutT0 = performance.now()

const baselineResults = []
const pass11Results = []
const system2Queue = []

let baselineHits = 0
let pass11Hits = 0
let totalGoldEvidenceTurns = 0

for (let i = 0; i < qas.length; i++) {
  const q = qas[i]
  const goldCategory = q.category
  const goldEvidence = q.evidence || []
  const qVec = questionEmbeddings[q.question] || null

  totalGoldEvidenceTurns += goldEvidence.length

  // --- ARM 1: Baseline (BM25 + Regex) ---
  const rawHits = index.searchBM25(q.question, 15)
  const bTop3 = rawHits.slice(0, 3)
  const bRecall = LocomoMemoryIndex.evaluateEvidenceRecall(bTop3, goldEvidence)
  baselineHits += bRecall.hits
  const bPred = bTop3[0]?.text || ''
  baselineResults.push({
    index: i,
    question: q.question,
    groundTruth: q.answer,
    prediction: bPred,
    category: goldCategory,
    evidenceRecall: bRecall,
    topEvidenceIds: bTop3.map(c => c.id),
    metrics: { f1: computeTokenF1(bPred, q.answer), bleu: computeBleu1(bPred, q.answer) },
  })

  // --- ARM 2: Pass 11 (Jev System-1 + Hardened Boundaries) ---
  const jevTriage = await jevZeroShotTriage(jev, q.question)
  const p11SearchRes = await dualSearcher.search(q.question, jevTriage, 3, qVec)

  // Strict Recall@3: slice top 3 candidate objects
  const p11RecallAt3 = LocomoMemoryIndex.evaluateEvidenceRecall(p11SearchRes.candidateObjects.slice(0, 3), goldEvidence)
  const p11FullWindowRecall = LocomoMemoryIndex.evaluateEvidenceRecall(p11SearchRes.candidateObjects, goldEvidence)
  pass11Hits += p11RecallAt3.hits

  // Format candidate answer
  const p11Pred = await answerHead.formatAnswer(q.question, p11SearchRes, jevTriage)
  const p11F1 = computeTokenF1(p11Pred, q.answer)
  const p11UpstreamF1 = computeUpstreamLoCoMoF1(p11Pred, q.answer, goldCategory)
  const p11Bleu = computeBleu1(p11Pred, q.answer)

  pass11Results.push({
    index: i,
    question: q.question,
    groundTruth: q.answer,
    prediction: p11Pred,
    initialPrediction: p11Pred,
    category: goldCategory,
    triage: jevTriage,
    ledgerResult: p11SearchRes.ledgerResult,
    evidenceRecall: p11RecallAt3,
    fullWindowRecall: p11FullWindowRecall,
    topEvidenceIds: p11SearchRes.topEvidence,
    metrics: { f1: p11F1, upstreamF1: p11UpstreamF1, bleu: p11Bleu },
  })

  // Escalation Gate to System-2
  const needsSystem2 = shouldEscalateToSystem2(p11SearchRes.ledgerResult, jevTriage, p11Pred)

  if (needsSystem2) {
    const isDetectiveTriage = jevTriage.category === 3 || jevTriage.choice === 'c3_detective'
    const isListTriage = jevTriage.category === 1 || jevTriage.searchScope === 'multi_session' || jevTriage.choice === 'c1_multihop'
    const routeReason = isDetectiveTriage
      ? 'triage_c3_detective'
      : (isListTriage ? 'triage_c1_multihop' : 'reader_abstention_unknown')

    const evidenceBlocks = p11SearchRes.candidateObjects.map((c) => {
      const turnId = c.refDiaId || c.id || 'dialogue'
      const dateStr = c.timestamp || 'Unknown date'
      const body = c.text || c.rawText || ''
      return `[Turn ${turnId} | Date: ${dateStr}]\n${body}`
    }).join('\n\n')

    system2Queue.push({
      id: `q_${i}`,
      index: i,
      question: q.question,
      evidence: evidenceBlocks,
      reason: routeReason,
    })
  }

  if ((i + 1) % 25 === 0 || i === qas.length - 1) {
    const elapsed = ((performance.now() - shootoutT0) / 1000).toFixed(1)
    const bRec = ((baselineHits / totalGoldEvidenceTurns) * 100).toFixed(1)
    const p11Rec = ((pass11Hits / totalGoldEvidenceTurns) * 100).toFixed(1)
    console.log(`  [${i + 1}/${qas.length}] (${elapsed}s) - Baseline: ${bRec}% | Pass 11 (Recall@3): ${p11Rec}%`)
  }
}

// --- ARM 3: Monolithic System-2 Deductive Resolution with Response Validation ---
const s2Telemetry = []
if (system2Queue.length > 0) {
  console.log(`\n[System-2] Dispatching monolithic deductive resolution for ${system2Queue.length} queries to deepseek-v4.1-flash...`)
  const s2T0 = performance.now()
  const s2Answers = await resolveSystem2Batch(system2Queue, { telemetry: s2Telemetry })
  const s2DurationSec = ((performance.now() - s2T0) / 1000).toFixed(2)
  console.log(`[System-2] Monolithic resolution completed in ${s2DurationSec}s (${Object.keys(s2Answers).length} answers resolved).\n`)

  for (const item of system2Queue) {
    if (s2Answers[item.id]) {
      let refinedPred = s2Answers[item.id].trim()
      refinedPred = normalizeCountAnswer(refinedPred, item.question)
      pass11Results[item.index].prediction = refinedPred
      pass11Results[item.index].finalPrediction = refinedPred
      pass11Results[item.index].system2Resolved = true
      pass11Results[item.index].routeReason = item.reason
      pass11Results[item.index].metrics = {
        f1: computeTokenF1(refinedPred, qas[item.index].answer),
        upstreamF1: computeUpstreamLoCoMoF1(refinedPred, qas[item.index].answer, qas[item.index].category),
        bleu: computeBleu1(refinedPred, qas[item.index].answer),
      }
    }
  }
}

const shootoutDurationSec = ((performance.now() - shootoutT0) / 1000).toFixed(2)
console.log(`\nShootout completed in ${shootoutDurationSec}s.\n`)

// 8. Aggregate Metrics
const bAgg = aggregateBenchmarkResults(baselineResults)
const p11Agg = aggregateBenchmarkResults(pass11Results)

const bRecallPct = (baselineHits / totalGoldEvidenceTurns) * 100
const p11RecallPct = (pass11Hits / totalGoldEvidenceTurns) * 100

const p8Recall = p8Agg?.overall?.evidenceRecall ?? 66.50
const p8UpstreamF1 = p8Agg?.overall?.upstreamF1 ?? 70.20
const p8C1F1 = p8Agg?.categoryBreakdown?.c1?.upstreamF1 ?? 65.42
const p8C2F1 = p8Agg?.categoryBreakdown?.c2?.upstreamF1 ?? 60.14
const p8C3F1 = p8Agg?.categoryBreakdown?.c3?.upstreamF1 ?? 44.62
const p8C4F1 = p8Agg?.categoryBreakdown?.c4?.upstreamF1 ?? 79.49

const p9JevRecall = p9JevAgg?.overall?.evidenceRecall ?? 67.49
const p9JevUpstreamF1 = p9JevAgg?.overall?.upstreamF1 ?? 69.29
const p9JevC1F1 = p9JevAgg?.categoryBreakdown?.c1?.upstreamF1 ?? 67.80
const p9JevC2F1 = p9JevAgg?.categoryBreakdown?.c2?.upstreamF1 ?? 57.53
const p9JevC3F1 = p9JevAgg?.categoryBreakdown?.c3?.upstreamF1 ?? 44.62
const p9JevC4F1 = p9JevAgg?.categoryBreakdown?.c4?.upstreamF1 ?? 78.34

const p9LayaRecall = 41.38
const p9LayaUpstreamF1 = 69.12
const p9LayaC1F1 = 77.24
const p9LayaC2F1 = 62.19
const p9LayaC3F1 = 44.62
const p9LayaC4F1 = 73.85

const p10Recall = p10Agg?.overall?.evidenceRecall ?? 65.52
const p10UpstreamF1 = p10Agg?.overall?.upstreamF1 ?? 74.23
const p10C1F1 = p10Agg?.categoryBreakdown?.c1?.upstreamF1 ?? 81.07
const p10C2F1 = p10Agg?.categoryBreakdown?.c2?.upstreamF1 ?? 62.64
const p10C3F1 = p10Agg?.categoryBreakdown?.c3?.upstreamF1 ?? 52.31
const p10C4F1 = p10Agg?.categoryBreakdown?.c4?.upstreamF1 ?? 80.76

const highScoringPass11 = pass11Results.filter(r => r.metrics.upstreamF1 >= 0.8).length

const reportMd = `# LoCoMo conv-47 Pass 11 Jev Benchmark Report

- **Date**: ${new Date().toISOString()}
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: ${shootoutDurationSec}s
- **Architecture**:
  - **Conversational Window Indexing (Turn-1)**: Prepend immediate prior turn (\`\${prevTurn.speaker}: \${prevTurn.text}\\n\`)
  - **System-1 Coprocessor**: TypeSafe Jev Cloud (\`typesafe/jev-latest\`)
  - **Fix A (Reranker Snippet Context)**: Retains preceding turn context through reranking cross-encoder
  - **Fix B (Date Hook Pool Budgeting)**: Guarantees injected candidates reach the reranking pool
  - **Fix C (Temporal Event Binding)**: Supports "day after tomorrow" and requires content token overlap before accepting dates/durations
  - **Fix D (Graph Fail-Closed)**: Unbound third-party subjects fail closed and escalate to System-2
  - **Response Validation**: finish_reason inspection, selective retries for missing IDs, rejected malformed statuses
  - **Deductive Synthesis (System-2)**: Monolithic One-Shot DeepSeek Flash via OpenCode Go

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 8 (Jev Chunked) | Pass 9 (Jev Chunked) | Pass 9 (Laya Mono) | Pass 10 (Jev Mono) | Pass 11 (Jev Mono Hardened) | Delta vs Pass 10 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | ${bRecallPct.toFixed(2)}% | ${p8Recall.toFixed(2)}% | ${p9JevRecall.toFixed(2)}% | ${p9LayaRecall.toFixed(2)}% | ${p10Recall.toFixed(2)}% | **${p11RecallPct.toFixed(2)}%** | **${(p11RecallPct - p10Recall) >= 0 ? '+' : ''}${(p11RecallPct - p10Recall).toFixed(2)}%** |
| **Official Upstream F1** | ${bAgg.overall.upstreamF1.toFixed(2)}% | ${p8UpstreamF1.toFixed(2)}% | ${p9JevUpstreamF1.toFixed(2)}% | ${p9LayaUpstreamF1.toFixed(2)}% | ${p10UpstreamF1.toFixed(2)}% | **${p11Agg.overall.upstreamF1.toFixed(2)}%** | **${(p11Agg.overall.upstreamF1 - p10UpstreamF1) >= 0 ? '+' : ''}${(p11Agg.overall.upstreamF1 - p10UpstreamF1).toFixed(2)}%** |
| **Legacy Token F1** | ${bAgg.overall.f1.toFixed(2)}% | ${(p8Agg?.overall?.f1 ?? 69.60).toFixed(2)}% | ${(p9JevAgg?.overall?.f1 ?? 68.48).toFixed(2)}% | 68.29% | ${(p10Agg?.overall?.f1 ?? 74.37).toFixed(2)}% | **${p11Agg.overall.f1.toFixed(2)}%** | **${(p11Agg.overall.f1 - (p10Agg?.overall?.f1 ?? 74.37)) >= 0 ? '+' : ''}${(p11Agg.overall.f1 - (p10Agg?.overall?.f1 ?? 74.37)).toFixed(2)}%** |
| **Overall BLEU-1** | ${bAgg.overall.bleu.toFixed(2)}% | ${(p8Agg?.overall?.bleu ?? 64.39).toFixed(2)}% | ${(p9JevAgg?.overall?.bleu ?? 62.09).toFixed(2)}% | 62.83% | ${(p10Agg?.overall?.bleu ?? 69.09).toFixed(2)}% | **${p11Agg.overall.bleu.toFixed(2)}%** | **${(p11Agg.overall.bleu - (p10Agg?.overall?.bleu ?? 69.09)) >= 0 ? '+' : ''}${(p11Agg.overall.bleu - (p10Agg?.overall?.bleu ?? 69.09)).toFixed(2)}%** |
| **Multi-Hop (C1) Upstream F1** | ${bAgg.categoryBreakdown.c1.upstreamF1.toFixed(2)}% | ${p8C1F1.toFixed(2)}% | ${p9JevC1F1.toFixed(2)}% | ${p9LayaC1F1.toFixed(2)}% | ${p10C1F1.toFixed(2)}% | **${p11Agg.categoryBreakdown.c1.upstreamF1.toFixed(2)}%** | **${(p11Agg.categoryBreakdown.c1.upstreamF1 - p10C1F1) >= 0 ? '+' : ''}${(p11Agg.categoryBreakdown.c1.upstreamF1 - p10C1F1).toFixed(2)}%** |
| **Temporal (C2) Upstream F1** | ${bAgg.categoryBreakdown.c2.upstreamF1.toFixed(2)}% | ${p8C2F1.toFixed(2)}% | ${p9JevC2F1.toFixed(2)}% | ${p9LayaC2F1.toFixed(2)}% | ${p10C2F1.toFixed(2)}% | **${p11Agg.categoryBreakdown.c2.upstreamF1.toFixed(2)}%** | **${(p11Agg.categoryBreakdown.c2.upstreamF1 - p10C2F1) >= 0 ? '+' : ''}${(p11Agg.categoryBreakdown.c2.upstreamF1 - p10C2F1).toFixed(2)}%** |
| **Detective (C3) Upstream F1** | ${bAgg.categoryBreakdown.c3.upstreamF1.toFixed(2)}% | ${p8C3F1.toFixed(2)}% | ${p9JevC3F1.toFixed(2)}% | ${p9LayaC3F1.toFixed(2)}% | ${p10C3F1.toFixed(2)}% | **${p11Agg.categoryBreakdown.c3.upstreamF1.toFixed(2)}%** | **${(p11Agg.categoryBreakdown.c3.upstreamF1 - p10C3F1) >= 0 ? '+' : ''}${(p11Agg.categoryBreakdown.c3.upstreamF1 - p10C3F1).toFixed(2)}%** |
| **Literal (C4) Upstream F1** | ${bAgg.categoryBreakdown.c4.upstreamF1.toFixed(2)}% | ${p8C4F1.toFixed(2)}% | ${p9JevC4F1.toFixed(2)}% | ${p9LayaC4F1.toFixed(2)}% | ${p10C4F1.toFixed(2)}% | **${p11Agg.categoryBreakdown.c4.upstreamF1.toFixed(2)}%** | **${(p11Agg.categoryBreakdown.c4.upstreamF1 - p10C4F1) >= 0 ? '+' : ''}${(p11Agg.categoryBreakdown.c4.upstreamF1 - p10C4F1).toFixed(2)}%** |
| **High-Scoring Answers (F1 ≥ 0.8)** | - | 84/150 (56.0%) | 85/150 (56.7%) | 86/150 (57.3%) | 92/150 (61.3%) | **${highScoringPass11}/150 (${((highScoringPass11 / 150) * 100).toFixed(1)}%)** | **${highScoringPass11 - 92 >= 0 ? '+' : ''}${highScoringPass11 - 92}** |
`

fs.writeFileSync(OUTPUT_REPORT_PATH, reportMd)
console.log(`Saved Pass 11 Jev report to ${OUTPUT_REPORT_PATH}`)

const detailedComparison = qas.map((q, idx) => ({
  index: idx,
  question: q.question,
  goldAnswer: q.answer,
  goldEvidence: q.evidence,
  baseline: baselineResults[idx],
  pass8: pass8Trace?.detailedComparison?.[idx]?.pass3 || pass8Trace?.detailedComparison?.[idx]?.pass8 || null,
  pass9Jev: pass9JevTrace?.detailedComparison?.[idx]?.pass9 || null,
  pass9Laya: pass9LayaTrace?.detailedComparison?.[idx]?.pass9Laya || null,
  pass10: pass10Trace?.detailedComparison?.[idx]?.pass10 || null,
  pass11Jev: pass11Results[idx],
}))

fs.writeFileSync(OUTPUT_TRACE_PATH, JSON.stringify({
  metadata: {
    runDate: new Date().toISOString(),
    dataset: 'conv-47',
    durationSec: Number.parseFloat(shootoutDurationSec),
    telemetry: s2Telemetry,
  },
  metrics: { baseline: bAgg, pass8: p8Agg, pass9Jev: p9JevAgg, pass9Laya: p9LayaAgg, pass10: p10Agg, pass11Jev: p11Agg },
  detailedComparison,
}, null, 2))
console.log(`Saved Pass 11 Jev trace to ${OUTPUT_TRACE_PATH}`)

console.log('\n======================================================')
console.log('PASS 11 JEV SHOOTOUT COMPLETE')
console.log('======================================================')
console.log(reportMd)
