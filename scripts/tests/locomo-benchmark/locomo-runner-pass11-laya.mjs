/**
 * LoCoMo conv-47 Pass 11 (Local Laya ONNX Coprocessor + Turn-1 Windowed Anaphora + Hardened Boundaries).
 *
 * Runs Local Convai Laya ONNX on CPU with:
 *   - Turn-1 Windowed Anaphora Index & Embeddings
 *   - Fix A: Reranker snippet context preservation
 *   - Fix B: Candidate pool budgeting reserving slots for Anima date-hook candidates
 *   - Fix C: Hardened temporal event binding (date-fns "day after tomorrow", topic overlap verification)
 *   - Fix D: Hardened graph verification (fail closed on unbound third-party subjects like Mira)
 *   - Response Validation: finish_reason inspection, selective retry for missing/unresolved IDs
 *   - Local Laya System-1 Coprocessor (Zero-Shot Triage + Distillation + Cross-Encoder Reranking)
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
import { jevZeroShotTriage } from './jev-triage.mjs'
import { LocomoMemoryIndex } from './locomo-index.mjs'
import {
  aggregateBenchmarkResults,
  computeBleu1,
  computeTokenF1,
  computeUpstreamLoCoMoF1,
} from './locomo-metrics.mjs'
import { NeedleNode } from './needle-node.mjs'
import { createSystemOneCoprocessor } from './system1-adapter.mjs'
import { resolveSystem2Batch } from './system2-batch-resolver.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')

const DATASET_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47.json')
const EMBEDDINGS_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-embeddings-windowed.json')
const Q_EMBEDDINGS_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-question-embeddings.json')
const BASE_LEDGER_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-ledger.json')
const PASS3_LEDGER_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-ledger-pass3.json')
const PASS8_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass8-trace.json')
const PASS9_JEV_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass9-trace.json')
const PASS9_LAYA_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass9-laya-trace.json')
const PASS10_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass10-anaphora-trace.json')
const PASS11_JEV_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass11-jev-trace.json')

const OUTPUT_REPORT_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass11-laya-report.md')
const OUTPUT_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass11-laya-trace.json')

console.log('================================================================')
console.log('LoCoMo conv-47 Pass 11 (Laya ONNX): Peer-Review Hardening Shootout')
console.log('31 Sessions | 689 Turns | 150 Questions | Fixes A/B/C/D + Response Validation')
console.log('================================================================\n')

// 1. Load Dataset
console.log('Loading conv-47 dataset...')
const convData = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'))
const qas = convData.qa.filter(q => q.category >= 1 && q.category <= 4)
console.log(`Loaded ${qas.length} non-adversarial QA pairs.\n`)

// 2. Initialize Models (Laya ONNX on CPU + Needle 2 WASM)
console.log('Initializing Local Laya ONNX Coprocessor on CPU...')
const layaT0 = performance.now()
const layaAdapter = await createSystemOneCoprocessor('laya', { executionProviders: ['cpu'] })
console.log(`Laya ONNX loaded in ${((performance.now() - layaT0) / 1000).toFixed(2)}s.`)

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

// 5. Initialize Dual Searcher and Answer Head with Laya Adapter
const dualSearcher = new DualSearcherPass3(ledger, hybridSearcher, layaAdapter)
const answerHead = new AnswerHeadPass3(needle, layaAdapter, index)

// Load Previous Traces for Comparison
const pass8Trace = fs.existsSync(PASS8_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS8_TRACE_PATH, 'utf8')) : null
const p8Agg = pass8Trace?.metrics?.pass3 || pass8Trace?.metrics?.pass8 || null

const pass9JevTrace = fs.existsSync(PASS9_JEV_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS9_JEV_TRACE_PATH, 'utf8')) : null
const p9JevAgg = pass9JevTrace?.metrics?.pass9 || null

const pass9LayaTrace = fs.existsSync(PASS9_LAYA_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS9_LAYA_TRACE_PATH, 'utf8')) : null
const p9LayaAgg = pass9LayaTrace?.metrics?.pass9Laya || null

const pass10Trace = fs.existsSync(PASS10_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS10_TRACE_PATH, 'utf8')) : null
const p10Agg = pass10Trace?.metrics?.pass10 || null

const pass11JevTrace = fs.existsSync(PASS11_JEV_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS11_JEV_TRACE_PATH, 'utf8')) : null
const p11JevAgg = pass11JevTrace?.metrics?.pass11Jev || null

// 7. Shootout Loop
console.log('Beginning 150-question Shootout with Local Laya ONNX...')
const shootoutT0 = performance.now()

const baselineResults = []
const pass11LayaResults = []
const system2Queue = []

let totalGoldEvidenceTurns = 0
let baselineHits = 0
let layaHits = 0

for (let i = 0; i < qas.length; i++) {
  const q = qas[i]
  const qVec = questionEmbeddings[q.question] || null
  const goldEv = q.evidence || []
  const goldCategory = q.category

  totalGoldEvidenceTurns += goldEv.length

  // --- ARM 1: Baseline (BM25 + Regex) ---
  const rawHits = index.searchBM25(q.question, 15)
  const bTop3 = rawHits.slice(0, 3)
  const bRecall = LocomoMemoryIndex.evaluateEvidenceRecall(bTop3, goldEv)
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

  // --- ARM 2: Pass 11 (Laya ONNX Coprocessor + Hardened Boundaries) ---
  // A. Zero-shot Triage via Laya ONNX
  const layaTriage = await jevZeroShotTriage(layaAdapter, q.question)

  // B. Dual Searcher: Graph Traversal + BGE/BM25 Hybrid + Date Hook + Batched Laya Reranking
  const layaSearchRes = await dualSearcher.search(q.question, layaTriage, 3, qVec)
  // Strict Recall@3 contract: slice candidates strictly to 3
  const layaRecallAt3 = LocomoMemoryIndex.evaluateEvidenceRecall(layaSearchRes.candidateObjects.slice(0, 3), goldEv)
  const layaFullWindowRecall = LocomoMemoryIndex.evaluateEvidenceRecall(layaSearchRes.candidateObjects, goldEv)
  layaHits += layaRecallAt3.hits

  // Answer Head Formatting
  const layaPred = await answerHead.formatAnswer(q.question, layaSearchRes, layaTriage)
  const layaF1 = computeTokenF1(layaPred, q.answer)
  const layaUpstreamF1 = computeUpstreamLoCoMoF1(layaPred, q.answer, goldCategory)
  const layaBleu = computeBleu1(layaPred, q.answer)

  pass11LayaResults.push({
    index: i,
    question: q.question,
    groundTruth: q.answer,
    prediction: layaPred,
    initialPrediction: layaPred,
    category: goldCategory,
    triage: layaTriage,
    ledgerResult: layaSearchRes.ledgerResult,
    evidenceRecall: layaRecallAt3,
    fullWindowRecall: layaFullWindowRecall,
    topEvidenceIds: layaSearchRes.topEvidence,
    metrics: { f1: layaF1, upstreamF1: layaUpstreamF1, bleu: layaBleu },
  })

  // Escalation Gate to System-2
  const needsSystem2 = shouldEscalateToSystem2(layaSearchRes.ledgerResult, layaTriage, layaPred)

  if (needsSystem2) {
    const isDetectiveTriage = layaTriage.category === 3 || layaTriage.choice === 'c3_detective'
    const isListTriage = layaTriage.category === 1 || layaTriage.searchScope === 'multi_session' || layaTriage.choice === 'c1_multihop'
    const routeReason = isDetectiveTriage
      ? 'triage_c3_detective'
      : (isListTriage ? 'triage_c1_multihop' : 'reader_abstention_unknown')

    const evidenceBlocks = layaSearchRes.candidateObjects.map((c) => {
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

  if ((i + 1) % 15 === 0 || i === qas.length - 1) {
    const elapsed = ((performance.now() - shootoutT0) / 1000).toFixed(1)
    const bRec = ((baselineHits / totalGoldEvidenceTurns) * 100).toFixed(1)
    const lRec = ((layaHits / totalGoldEvidenceTurns) * 100).toFixed(1)
    console.log(`  [${i + 1}/${qas.length}] (${elapsed}s) - Baseline: ${bRec}% | Pass 11 Laya (Recall@3): ${lRec}%`)
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
      pass11LayaResults[item.index].prediction = refinedPred
      pass11LayaResults[item.index].finalPrediction = refinedPred
      pass11LayaResults[item.index].system2Resolved = true
      pass11LayaResults[item.index].routeReason = item.reason
      pass11LayaResults[item.index].metrics = {
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
const p11LayaAgg = aggregateBenchmarkResults(pass11LayaResults)

const bRecallPct = (baselineHits / totalGoldEvidenceTurns) * 100
const p11LayaRecallPct = (layaHits / totalGoldEvidenceTurns) * 100

const p9LayaRecall = p9LayaAgg?.overall?.evidenceRecall ?? 41.38
const p9LayaUpstreamF1 = p9LayaAgg?.overall?.upstreamF1 ?? 69.12
const p9LayaC1F1 = p9LayaAgg?.categoryBreakdown?.c1?.upstreamF1 ?? 77.24
const p9LayaC2F1 = p9LayaAgg?.categoryBreakdown?.c2?.upstreamF1 ?? 62.19
const p9LayaC3F1 = p9LayaAgg?.categoryBreakdown?.c3?.upstreamF1 ?? 44.62
const p9LayaC4F1 = p9LayaAgg?.categoryBreakdown?.c4?.upstreamF1 ?? 73.85

const p10UpstreamF1 = p10Agg?.overall?.upstreamF1 ?? 74.23

const highScoringLaya = pass11LayaResults.filter(r => r.metrics.upstreamF1 >= 0.8).length

const reportMd = `# LoCoMo conv-47 Pass 11 Laya Benchmark Report

- **Date**: ${new Date().toISOString()}
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: ${shootoutDurationSec}s
- **Architecture**:
  - **Conversational Window Indexing (Turn-1)**: Prepend immediate prior turn (\`\${prevTurn.speaker}: \${prevTurn.text}\\n\`)
  - **System-1 Coprocessor**: Local Convai Laya ONNX on CPU
  - **Fix A (Reranker Snippet Context)**: Retains preceding turn context through reranking cross-encoder
  - **Fix B (Date Hook Pool Budgeting)**: Guarantees injected candidates reach the reranking pool
  - **Fix C (Temporal Event Binding)**: Supports "day after tomorrow" and requires content token overlap before accepting dates/durations
  - **Fix D (Graph Fail-Closed)**: Unbound third-party subjects fail closed and escalate to System-2
  - **Response Validation**: finish_reason inspection, selective retries for missing IDs, rejected malformed statuses
  - **Deductive Synthesis (System-2)**: Monolithic One-Shot DeepSeek Flash via OpenCode Go

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 9 (Laya Mono) | Pass 10 (Jev Mono) | Pass 11 (Jev Mono) | Pass 11 (Laya Mono Hardened) | Delta vs Pass 9 Laya | Delta vs Pass 11 Jev |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | ${bRecallPct.toFixed(2)}% | ${p9LayaRecall.toFixed(2)}% | ${(p10Agg?.overall?.evidenceRecall ?? 65.52).toFixed(2)}% | ${(p11JevAgg?.overall?.evidenceRecall ?? 0).toFixed(2)}% | **${p11LayaRecallPct.toFixed(2)}%** | **${(p11LayaRecallPct - p9LayaRecall) >= 0 ? '+' : ''}${(p11LayaRecallPct - p9LayaRecall).toFixed(2)}%** | - |
| **Official Upstream F1** | ${bAgg.overall.upstreamF1.toFixed(2)}% | ${p9LayaUpstreamF1.toFixed(2)}% | ${p10UpstreamF1.toFixed(2)}% | ${(p11JevAgg?.overall?.upstreamF1 ?? 0).toFixed(2)}% | **${p11LayaAgg.overall.upstreamF1.toFixed(2)}%** | **${(p11LayaAgg.overall.upstreamF1 - p9LayaUpstreamF1) >= 0 ? '+' : ''}${(p11LayaAgg.overall.upstreamF1 - p9LayaUpstreamF1).toFixed(2)}%** | **${(p11LayaAgg.overall.upstreamF1 - (p11JevAgg?.overall?.upstreamF1 ?? 0)) >= 0 ? '+' : ''}${(p11LayaAgg.overall.upstreamF1 - (p11JevAgg?.overall?.upstreamF1 ?? 0)).toFixed(2)}%** |
| **Legacy Token F1** | ${bAgg.overall.f1.toFixed(2)}% | 68.29% | ${(p10Agg?.overall?.f1 ?? 74.37).toFixed(2)}% | ${(p11JevAgg?.overall?.f1 ?? 0).toFixed(2)}% | **${p11LayaAgg.overall.f1.toFixed(2)}%** | **${(p11LayaAgg.overall.f1 - 68.29) >= 0 ? '+' : ''}${(p11LayaAgg.overall.f1 - 68.29).toFixed(2)}%** | - |
| **Overall BLEU-1** | ${bAgg.overall.bleu.toFixed(2)}% | 62.83% | ${(p10Agg?.overall?.bleu ?? 69.09).toFixed(2)}% | ${(p11JevAgg?.overall?.bleu ?? 0).toFixed(2)}% | **${p11LayaAgg.overall.bleu.toFixed(2)}%** | **${(p11LayaAgg.overall.bleu - 62.83) >= 0 ? '+' : ''}${(p11LayaAgg.overall.bleu - 62.83).toFixed(2)}%** | - |
| **Multi-Hop (C1) Upstream F1** | ${bAgg.categoryBreakdown.c1.upstreamF1.toFixed(2)}% | ${p9LayaC1F1.toFixed(2)}% | ${(p10Agg?.categoryBreakdown?.c1?.upstreamF1 ?? 81.07).toFixed(2)}% | ${(p11JevAgg?.categoryBreakdown?.c1?.upstreamF1 ?? 0).toFixed(2)}% | **${p11LayaAgg.categoryBreakdown.c1.upstreamF1.toFixed(2)}%** | **${(p11LayaAgg.categoryBreakdown.c1.upstreamF1 - p9LayaC1F1) >= 0 ? '+' : ''}${(p11LayaAgg.categoryBreakdown.c1.upstreamF1 - p9LayaC1F1).toFixed(2)}%** | - |
| **Temporal (C2) Upstream F1** | ${bAgg.categoryBreakdown.c2.upstreamF1.toFixed(2)}% | ${p9LayaC2F1.toFixed(2)}% | ${(p10Agg?.categoryBreakdown?.c2?.upstreamF1 ?? 62.64).toFixed(2)}% | ${(p11JevAgg?.categoryBreakdown?.c2?.upstreamF1 ?? 0).toFixed(2)}% | **${p11LayaAgg.categoryBreakdown.c2.upstreamF1.toFixed(2)}%** | **${(p11LayaAgg.categoryBreakdown.c2.upstreamF1 - p9LayaC2F1) >= 0 ? '+' : ''}${(p11LayaAgg.categoryBreakdown.c2.upstreamF1 - p9LayaC2F1).toFixed(2)}%** | - |
| **Detective (C3) Upstream F1** | ${bAgg.categoryBreakdown.c3.upstreamF1.toFixed(2)}% | ${p9LayaC3F1.toFixed(2)}% | ${(p10Agg?.categoryBreakdown?.c3?.upstreamF1 ?? 52.31).toFixed(2)}% | ${(p11JevAgg?.categoryBreakdown?.c3?.upstreamF1 ?? 0).toFixed(2)}% | **${p11LayaAgg.categoryBreakdown.c3.upstreamF1.toFixed(2)}%** | **${(p11LayaAgg.categoryBreakdown.c3.upstreamF1 - p9LayaC3F1) >= 0 ? '+' : ''}${(p11LayaAgg.categoryBreakdown.c3.upstreamF1 - p9LayaC3F1).toFixed(2)}%** | - |
| **Literal (C4) Upstream F1** | ${bAgg.categoryBreakdown.c4.upstreamF1.toFixed(2)}% | ${p9LayaC4F1.toFixed(2)}% | ${(p10Agg?.categoryBreakdown?.c4?.upstreamF1 ?? 80.76).toFixed(2)}% | ${(p11JevAgg?.categoryBreakdown?.c4?.upstreamF1 ?? 0).toFixed(2)}% | **${p11LayaAgg.categoryBreakdown.c4.upstreamF1.toFixed(2)}%** | **${(p11LayaAgg.categoryBreakdown.c4.upstreamF1 - p9LayaC4F1) >= 0 ? '+' : ''}${(p11LayaAgg.categoryBreakdown.c4.upstreamF1 - p9LayaC4F1).toFixed(2)}%** | - |
| **High-Scoring Answers (F1 ≥ 0.8)** | - | 86/150 (57.3%) | 92/150 (61.3%) | - | **${highScoringLaya}/150 (${((highScoringLaya / 150) * 100).toFixed(1)}%)** | **${highScoringLaya - 86 >= 0 ? '+' : ''}${highScoringLaya - 86}** | - |
`

fs.writeFileSync(OUTPUT_REPORT_PATH, reportMd)
console.log(`Saved Pass 11 Laya report to ${OUTPUT_REPORT_PATH}`)

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
  pass11Jev: pass11JevTrace?.detailedComparison?.[idx]?.pass11Jev || null,
  pass11Laya: pass11LayaResults[idx],
}))

fs.writeFileSync(OUTPUT_TRACE_PATH, JSON.stringify({
  metadata: {
    runDate: new Date().toISOString(),
    dataset: 'conv-47',
    durationSec: Number.parseFloat(shootoutDurationSec),
    telemetry: s2Telemetry,
  },
  metrics: { baseline: bAgg, pass8: p8Agg, pass9Jev: p9JevAgg, pass9Laya: p9LayaAgg, pass10: p10Agg, pass11Jev: p11JevAgg, pass11Laya: p11LayaAgg },
  detailedComparison,
}, null, 2))
console.log(`Saved Pass 11 Laya trace to ${OUTPUT_TRACE_PATH}`)

console.log('\n======================================================')
console.log('PASS 11 LAYA SHOOTOUT COMPLETE')
console.log('======================================================')
console.log(reportMd)
