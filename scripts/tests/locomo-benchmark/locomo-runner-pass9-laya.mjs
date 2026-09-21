/**
 * LoCoMo conv-47 Pass 9 (Laya ONNX Coprocessor + Monolithic System-2 Resolution).
 *
 * Swaps TypeSafe Jev for Local Convai Laya ONNX running on CPU via @receptron/laya:
 *   - Laya System-1 Zero-Shot Turn Triage (C1 Multi-Hop, C2 Temporal, C3 Detective, C4 Literal)
 *   - Polar Query Guard & Anima Temporal Date-Range Hooks
 *   - In-Session Distillation via Laya System-1 choice evaluation with strict abstention
 *   - Batched Candidate Cross-Encoder Reranking via Laya System-1 scoring
 *   - Monolithic One-Shot System-2 Deductive Resolution (DeepSeek Flash without request-level truncation)
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
const EMBEDDINGS_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-embeddings.json')
const Q_EMBEDDINGS_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-question-embeddings.json')
const BASE_LEDGER_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-ledger.json')
const PASS3_LEDGER_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-ledger-pass3.json')
const PASS8_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass8-trace.json')
const PASS9_JEV_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass9-trace.json')
const OUTPUT_REPORT_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass9-laya-report.md')
const OUTPUT_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass9-laya-trace.json')

console.log('================================================================')
console.log('LoCoMo conv-47 Pass 9: Laya ONNX Coprocessor + Monolithic System-2 Shootout')
console.log('31 Sessions | 689 Turns | 150 Questions | Baseline vs Jev (Pass 9) vs Laya (Pass 9)')
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

// 4. Load LocomoMemoryIndex & Hybrid Searcher
console.log('Initializing in-memory Vector/BM25 Index...')
const index = new LocomoMemoryIndex()
index.loadConversation(convData)
const embeddings = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'))
const questionEmbeddings = JSON.parse(fs.readFileSync(Q_EMBEDDINGS_PATH, 'utf-8'))
const hybridSearcher = new HybridSearcher(index, embeddings)

// 5. Initialize Dual Searcher and Answer Head with Laya Adapter
const dualSearcher = new DualSearcherPass3(ledger, hybridSearcher, layaAdapter)
const answerHead = new AnswerHeadPass3(needle, layaAdapter, index)

// Load Pass 8 and Pass 9 traces for comparison
const pass8Trace = fs.existsSync(PASS8_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS8_TRACE_PATH, 'utf8')) : null
const p8Agg = pass8Trace?.metrics?.pass3 || pass8Trace?.metrics?.pass8 || null
const p8Recall = p8Agg?.overall?.evidenceRecall ?? 66.50
const p8UpstreamF1 = p8Agg?.overall?.upstreamF1 ?? 70.20
const p8Bleu = p8Agg?.overall?.bleu ?? 64.39
const p8C1F1 = p8Agg?.categoryBreakdown?.c1?.upstreamF1 ?? 65.42
const p8C2F1 = p8Agg?.categoryBreakdown?.c2?.upstreamF1 ?? 60.14
const p8C3F1 = p8Agg?.categoryBreakdown?.c3?.upstreamF1 ?? 44.62
const p8C4F1 = p8Agg?.categoryBreakdown?.c4?.upstreamF1 ?? 79.49

const pass9JevTrace = fs.existsSync(PASS9_JEV_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS9_JEV_TRACE_PATH, 'utf8')) : null
const p9JevAgg = pass9JevTrace?.metrics?.pass9 || null

// 7. Run 150-Question Shootout
console.log('Beginning 150-question Shootout with Local Laya ONNX...')
const baselineResults = []
const layaResults = []
const system2Queue = []

let totalGoldEvidenceTurns = 0
let baselineHits = 0
let layaHits = 0

const shootoutT0 = performance.now()

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

  // --- ARM 2: Pass 9 (Laya ONNX Coprocessor) ---
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

  layaResults.push({
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

  // Dual-Process Escalation Gate
  const needsSystem2 = shouldEscalateToSystem2(layaSearchRes.ledgerResult, layaTriage, layaPred)

  if (needsSystem2) {
    const isDetectiveTriage = layaTriage.category === 3 || layaTriage.choice === 'c3_detective'
    const isListTriage = layaTriage.category === 1 || layaTriage.searchScope === 'multi_session' || layaTriage.choice === 'c1_multihop'
    const routeReason = isDetectiveTriage
      ? 'triage_c3_detective'
      : (isListTriage ? 'triage_c1_multihop' : 'reader_abstention_unknown')

    const evidenceBlocks = (layaSearchRes.candidateObjects || []).map((c) => {
      const turnId = c.refDiaId || c.id || 'dialogue'
      const dateStr = c.timestamp || 'Unknown date'
      const speakerPrefix = c.speaker ? `${c.speaker}: ` : ''
      const body = c.text || c.rawText || ''
      return `[Turn ${turnId} | Date: ${dateStr}]\n${speakerPrefix}${body}`
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
    const lRec = ((layaHits / totalGoldEvidenceTurns) * 100).toFixed(1)
    console.log(`  [${i + 1}/${qas.length}] (${elapsed}s) - Baseline: ${bRec}% | Laya (Recall@3): ${lRec}%`)
  }
}

// 8. Monolithic System-2 Deductive Resolution (Unforced Output Ceiling, One-Shot)
if (system2Queue.length > 0) {
  console.log(`\n[System-2] Dispatching MONOLITHIC deductive resolution for ALL ${system2Queue.length} queries to deepseek-v4.1-flash in 1 request...`)
  const s2T0 = performance.now()
  // Uses monolithic batching (batchSize: system2Queue.length)
  const s2Answers = await resolveSystem2Batch(system2Queue, { batchSize: system2Queue.length })
  const s2DurationSec = ((performance.now() - s2T0) / 1000).toFixed(2)
  console.log(`[System-2] Monolithic resolution completed in ${s2DurationSec}s (${Object.keys(s2Answers).length} answers resolved).\n`)

  for (const item of system2Queue) {
    if (s2Answers[item.id]) {
      let refinedPred = s2Answers[item.id].trim()
      refinedPred = normalizeCountAnswer(refinedPred, item.question)
      layaResults[item.index].prediction = refinedPred
      layaResults[item.index].finalPrediction = refinedPred
      layaResults[item.index].system2Resolved = true
      layaResults[item.index].routeReason = item.reason
      layaResults[item.index].metrics = {
        f1: computeTokenF1(refinedPred, qas[item.index].answer),
        upstreamF1: computeUpstreamLoCoMoF1(refinedPred, qas[item.index].answer, qas[item.index].category),
        bleu: computeBleu1(refinedPred, qas[item.index].answer),
      }
    }
  }
}

const shootoutDurationSec = ((performance.now() - shootoutT0) / 1000).toFixed(2)
console.log(`\nShootout completed in ${shootoutDurationSec}s.\n`)

// 9. Aggregate Metrics
const bAgg = aggregateBenchmarkResults(baselineResults)
const lAgg = aggregateBenchmarkResults(layaResults)

const bRecallPct = (baselineHits / totalGoldEvidenceTurns) * 100
const lRecallPct = (layaHits / totalGoldEvidenceTurns) * 100

const highScoringLaya = layaResults.filter(r => r.metrics.upstreamF1 >= 0.8).length

// 10. Generate Comparative Markdown Report
const reportMd = `# LoCoMo conv-47 Pass 9 (Laya ONNX Coprocessor + Monolithic System-2) Benchmark Report

- **Date**: ${new Date().toISOString()}
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: ${shootoutDurationSec}s
- **Architecture**:
  - **System-1 Coprocessor**: Local Convai Laya ONNX running on CPU (@receptron/laya)
  - **Polar Query Guard**: Prevents yes/no queries from being answered with calendar dates
  - **Temporal Date-Range Hook**: Anima-inspired automatic date/month extraction and session turn injection
  - **Strict Distillation Abstention**: Laya System-1 (\`choice: 'none'\`) abstains cleanly without forcing irrelevant raw turns
  - **Strict Ledger Verification**: Only unambiguous graph matches bypass System-2; unverified graph hypotheses escalate
  - **Casual Spoken Query Expansion**: Canonical aliases bridge conversational phrasing
  - **Deductive Synthesis (System-2)**: Monolithic One-Shot DeepSeek Flash via OpenCode Go with unforced output token ceiling
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 8 (Jev Chunked) | Pass 9 (Jev Chunked) | Pass 9 (Laya Monolithic) | Laya vs Pass 9 Jev Delta |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | ${bRecallPct.toFixed(2)}% | ${p8Recall.toFixed(2)}% | ${(p9JevAgg?.overall?.evidenceRecall ?? 67.49).toFixed(2)}% | **${lRecallPct.toFixed(2)}%** | **${(lRecallPct - (p9JevAgg?.overall?.evidenceRecall ?? 67.49)) >= 0 ? '+' : ''}${(lRecallPct - (p9JevAgg?.overall?.evidenceRecall ?? 67.49)).toFixed(2)}%** |
| **Official Upstream F1** | ${bAgg.overall.upstreamF1.toFixed(2)}% | ${p8UpstreamF1.toFixed(2)}% | ${(p9JevAgg?.overall?.upstreamF1 ?? 69.29).toFixed(2)}% | **${lAgg.overall.upstreamF1.toFixed(2)}%** | **${(lAgg.overall.upstreamF1 - (p9JevAgg?.overall?.upstreamF1 ?? 69.29)) >= 0 ? '+' : ''}${(lAgg.overall.upstreamF1 - (p9JevAgg?.overall?.upstreamF1 ?? 69.29)).toFixed(2)}%** |
| **Legacy Token F1** | ${bAgg.overall.f1.toFixed(2)}% | ${(p8Agg?.overall?.f1 ?? 69.60).toFixed(2)}% | ${(p9JevAgg?.overall?.f1 ?? 68.48).toFixed(2)}% | **${lAgg.overall.f1.toFixed(2)}%** | **${(lAgg.overall.f1 - (p9JevAgg?.overall?.f1 ?? 68.48)) >= 0 ? '+' : ''}${(lAgg.overall.f1 - (p9JevAgg?.overall?.f1 ?? 68.48)).toFixed(2)}%** |
| **Overall BLEU-1** | ${bAgg.overall.bleu.toFixed(2)}% | ${p8Bleu.toFixed(2)}% | ${(p9JevAgg?.overall?.bleu ?? 62.09).toFixed(2)}% | **${lAgg.overall.bleu.toFixed(2)}%** | **${(lAgg.overall.bleu - (p9JevAgg?.overall?.bleu ?? 62.09)) >= 0 ? '+' : ''}${(lAgg.overall.bleu - (p9JevAgg?.overall?.bleu ?? 62.09)).toFixed(2)}%** |
| **Multi-Hop (C1) Upstream F1** | ${bAgg.categoryBreakdown.c1.upstreamF1.toFixed(2)}% | ${p8C1F1.toFixed(2)}% | ${(p9JevAgg?.categoryBreakdown?.c1?.upstreamF1 ?? 67.80).toFixed(2)}% | **${lAgg.categoryBreakdown.c1.upstreamF1.toFixed(2)}%** | **${(lAgg.categoryBreakdown.c1.upstreamF1 - (p9JevAgg?.categoryBreakdown?.c1?.upstreamF1 ?? 67.80)) >= 0 ? '+' : ''}${(lAgg.categoryBreakdown.c1.upstreamF1 - (p9JevAgg?.categoryBreakdown?.c1?.upstreamF1 ?? 67.80)).toFixed(2)}%** |
| **Temporal (C2) Upstream F1** | ${bAgg.categoryBreakdown.c2.upstreamF1.toFixed(2)}% | ${p8C2F1.toFixed(2)}% | ${(p9JevAgg?.categoryBreakdown?.c2?.upstreamF1 ?? 57.53).toFixed(2)}% | **${lAgg.categoryBreakdown.c2.upstreamF1.toFixed(2)}%** | **${(lAgg.categoryBreakdown.c2.upstreamF1 - (p9JevAgg?.categoryBreakdown?.c2?.upstreamF1 ?? 57.53)) >= 0 ? '+' : ''}${(lAgg.categoryBreakdown.c2.upstreamF1 - (p9JevAgg?.categoryBreakdown?.c2?.upstreamF1 ?? 57.53)).toFixed(2)}%** |
| **Detective (C3) Upstream F1** | ${bAgg.categoryBreakdown.c3.upstreamF1.toFixed(2)}% | ${p8C3F1.toFixed(2)}% | ${(p9JevAgg?.categoryBreakdown?.c3?.upstreamF1 ?? 44.62).toFixed(2)}% | **${lAgg.categoryBreakdown.c3.upstreamF1.toFixed(2)}%** | **${(lAgg.categoryBreakdown.c3.upstreamF1 - (p9JevAgg?.categoryBreakdown?.c3?.upstreamF1 ?? 44.62)) >= 0 ? '+' : ''}${(lAgg.categoryBreakdown.c3.upstreamF1 - (p9JevAgg?.categoryBreakdown?.c3?.upstreamF1 ?? 44.62)).toFixed(2)}%** |
| **Literal (C4) Upstream F1** | ${bAgg.categoryBreakdown.c4.upstreamF1.toFixed(2)}% | ${p8C4F1.toFixed(2)}% | ${(p9JevAgg?.categoryBreakdown?.c4?.upstreamF1 ?? 78.34).toFixed(2)}% | **${lAgg.categoryBreakdown.c4.upstreamF1.toFixed(2)}%** | **${(lAgg.categoryBreakdown.c4.upstreamF1 - (p9JevAgg?.categoryBreakdown?.c4?.upstreamF1 ?? 78.34)) >= 0 ? '+' : ''}${(lAgg.categoryBreakdown.c4.upstreamF1 - (p9JevAgg?.categoryBreakdown?.c4?.upstreamF1 ?? 78.34)).toFixed(2)}%** |
| **High-Scoring Answers (F1 ≥ 0.8)** | - | 84/150 (56.0%) | 85/150 (56.7%) | **${highScoringLaya}/150 (${((highScoringLaya / 150) * 100).toFixed(1)}%)** | **${highScoringLaya - 85 >= 0 ? '+' : ''}${highScoringLaya - 85}** |
`

fs.writeFileSync(OUTPUT_REPORT_PATH, reportMd)
console.log(`Saved Pass 9 Laya report to ${OUTPUT_REPORT_PATH}`)

const detailedComparison = qas.map((q, idx) => ({
  index: idx,
  question: q.question,
  goldAnswer: q.answer,
  goldEvidence: q.evidence,
  baseline: baselineResults[idx],
  pass8: pass8Trace?.detailedComparison?.[idx]?.pass3 || null,
  pass9Jev: pass9JevTrace?.detailedComparison?.[idx]?.pass9 || null,
  pass9Laya: layaResults[idx],
}))

fs.writeFileSync(OUTPUT_TRACE_PATH, JSON.stringify({
  metadata: {
    runDate: new Date().toISOString(),
    coprocessor: 'laya_onnx_cpu',
    dataset: 'conv-47',
    durationSec: Number.parseFloat(shootoutDurationSec),
  },
  metrics: { baseline: bAgg, pass8: p8Agg, pass9Jev: p9JevAgg, pass9Laya: lAgg },
  detailedComparison,
}, null, 2))
console.log(`Saved Pass 9 Laya trace to ${OUTPUT_TRACE_PATH}`)

console.log('\n======================================================')
console.log('PASS 9 LAYA SHOOTOUT COMPLETE')
console.log('======================================================')
console.log(reportMd)

await layaAdapter.close()
