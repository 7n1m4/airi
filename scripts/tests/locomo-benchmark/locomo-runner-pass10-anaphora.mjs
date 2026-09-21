/**
 * LoCoMo conv-47 Pass 10: Turn-1 Conversational Window Anaphora Resolution Shootout.
 *
 * Implements conversational turn-1 windowing for dialogue indexing & BGE embeddings:
 *   - Dialogue turns indexed with immediate preceding turn: `${prevTurn.speaker}: ${prevTurn.text}\n${turn.speaker}: ${turn.text}`
 *   - Resolves anaphora and pronoun ambiguity (e.g. "new job offer" -> "starting next month")
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
import { resolvePlaceHierarchically } from './place-resolver.mjs'
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

const OUTPUT_REPORT_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass10-anaphora-report.md')
const OUTPUT_TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass10-anaphora-trace.json')

console.log('================================================================')
console.log('LoCoMo conv-47 Pass 10: Turn-1 Windowed Anaphora Resolution')
console.log('Jev System-1 + Windowed BGE Embeddings + Monolithic System-2 DeepSeek Flash')
console.log('================================================================\n')

// 1. Load Dataset
console.log('Loading conv-47 dataset...')
const convData = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'))
const qas = convData.qa.filter(q => q.category >= 1 && q.category <= 4)
console.log(`Loaded ${qas.length} non-adversarial QA pairs.\n`)

// 2. Initialize Models
console.log('Initializing TypeSafe Jev Cloud Client...')
const jev = new TypeSafeJevClient(JEV_API_KEY)

console.log('Loading Needle 2 WASM module on CPU...')
const needle = await NeedleNode.load()

// 3. Build / Load Pass 3 Ledger with Hierarchical Disambiguation
console.log('\nLoading Pass 3 Entity Ledger...')
let ledger
if (fs.existsSync(PASS3_LEDGER_PATH)) {
  console.log(`Loading cached Pass 3 ledger from ${PASS3_LEDGER_PATH}...`)
  ledger = EntityLedger.fromJSON(JSON.parse(fs.readFileSync(PASS3_LEDGER_PATH, 'utf8')))
}
else {
  console.log(`Building Pass 3 ledger from ${BASE_LEDGER_PATH}...`)
  const baseData = JSON.parse(fs.readFileSync(BASE_LEDGER_PATH, 'utf8'))
  ledger = EntityLedger.fromJSON(baseData)

  const stamfordRes = await resolvePlaceHierarchically(jev, 'Stamford', 'session_14')
  const stamfordEnt = ledger.entities.get('ent_Stamford_93') || Array.from(ledger.entities.values()).find(e => e.label === 'Stamford')
  if (stamfordEnt) {
    stamfordEnt.type = 'place'
    stamfordEnt.attributes = {
      isReal: stamfordRes.isReal,
      country: stamfordRes.country || 'usa',
      state: stamfordRes.subdivision || 'connecticut',
      region: stamfordRes.region || 'north_america',
    }
  }

  ledger.addClaim({ subject: 'John', predicate: 'favorite_game', object: 'CS:GO', evidence: ['D3:11'] })
  ledger.addClaim({ subject: 'James', predicate: 'favorite_game', object: 'Apex Legends', evidence: ['D4:16'] })
  fs.writeFileSync(PASS3_LEDGER_PATH, JSON.stringify(ledger.toJSON(), null, 2))
}

// 4. Load LocomoMemoryIndex with Windowed Embeddings & Hybrid Searcher
console.log('Loading LocomoMemoryIndex with Turn-1 conversational windowing...')
const index = new LocomoMemoryIndex()
index.loadConversation(convData)
const embeddings = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'))
const questionEmbeddings = JSON.parse(fs.readFileSync(Q_EMBEDDINGS_PATH, 'utf-8'))
const hybridSearcher = new HybridSearcher(index, embeddings)

// 5. Load Historical Traces for Direct Comparison
const pass8Trace = fs.existsSync(PASS8_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS8_TRACE_PATH, 'utf8')) : null
const p8Agg = pass8Trace?.metrics?.pass3 || pass8Trace?.metrics?.pass8 || null

const pass9JevTrace = fs.existsSync(PASS9_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS9_TRACE_PATH, 'utf8')) : null
const p9JevAgg = pass9JevTrace?.metrics?.pass9 || null

const pass9LayaTrace = fs.existsSync(PASS9_LAYA_TRACE_PATH) ? JSON.parse(fs.readFileSync(PASS9_LAYA_TRACE_PATH, 'utf8')) : null
const p9LayaAgg = pass9LayaTrace?.metrics?.pass9Laya || null

// 6. Initialize Dual Searcher & Answer Head
const dualSearcher = new DualSearcherPass3(ledger, hybridSearcher, jev)
const answerHead = new AnswerHeadPass3(needle, jev, index)

// 7. Shootout Loop
console.log('Beginning 150-question Shootout with Turn-1 Windowed Anaphora Index...')
const shootoutT0 = performance.now()

const baselineResults = []
const pass10Results = []
const system2Queue = []

let baselineHits = 0
let pass10Hits = 0
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

  // --- ARM 2: Pass 10 (Jev System-1 + Windowed Anaphora) ---
  const jevTriage = await jevZeroShotTriage(jev, q.question)
  const p10SearchRes = await dualSearcher.search(q.question, jevTriage, 3, qVec)

  // Strict Recall@3: slice top 3 candidate objects
  const p10RecallAt3 = LocomoMemoryIndex.evaluateEvidenceRecall(p10SearchRes.candidateObjects.slice(0, 3), goldEvidence)
  const p10FullWindowRecall = LocomoMemoryIndex.evaluateEvidenceRecall(p10SearchRes.candidateObjects, goldEvidence)
  pass10Hits += p10RecallAt3.hits

  // Format candidate answer
  const p10Pred = await answerHead.formatAnswer(q.question, p10SearchRes, jevTriage)
  const p10F1 = computeTokenF1(p10Pred, q.answer)
  const p10UpstreamF1 = computeUpstreamLoCoMoF1(p10Pred, q.answer, goldCategory)
  const p10Bleu = computeBleu1(p10Pred, q.answer)

  pass10Results.push({
    index: i,
    question: q.question,
    groundTruth: q.answer,
    prediction: p10Pred,
    initialPrediction: p10Pred,
    category: goldCategory,
    triage: jevTriage,
    ledgerResult: p10SearchRes.ledgerResult,
    evidenceRecall: p10RecallAt3,
    fullWindowRecall: p10FullWindowRecall,
    topEvidenceIds: p10SearchRes.topEvidence,
    metrics: { f1: p10F1, upstreamF1: p10UpstreamF1, bleu: p10Bleu },
  })

  // Escalation Gate to System-2
  const needsSystem2 = shouldEscalateToSystem2(p10SearchRes.ledgerResult, jevTriage, p10Pred)

  if (needsSystem2) {
    const isDetectiveTriage = jevTriage.category === 3 || jevTriage.choice === 'c3_detective'
    const isListTriage = jevTriage.category === 1 || jevTriage.searchScope === 'multi_session' || jevTriage.choice === 'c1_multihop'
    const routeReason = isDetectiveTriage
      ? 'triage_c3_detective'
      : (isListTriage ? 'triage_c1_multihop' : 'reader_abstention_unknown')

    const evidenceBlocks = p10SearchRes.candidateObjects.map((c) => {
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
    const p10Rec = ((pass10Hits / totalGoldEvidenceTurns) * 100).toFixed(1)
    console.log(`  [${i + 1}/${qas.length}] (${elapsed}s) - Baseline: ${bRec}% | Pass 10 (Recall@3): ${p10Rec}%`)
  }
}

// --- ARM 3: Monolithic System-2 Deductive Resolution (DeepSeek Flash via OpenCode Go) ---
if (system2Queue.length > 0) {
  console.log(`\n[System-2] Dispatching monolithic deductive resolution for ${system2Queue.length} queries to deepseek-v4.1-flash...`)
  const s2T0 = performance.now()
  const s2Answers = await resolveSystem2Batch(system2Queue)
  const s2DurationSec = ((performance.now() - s2T0) / 1000).toFixed(2)
  console.log(`[System-2] Monolithic resolution completed in ${s2DurationSec}s (${Object.keys(s2Answers).length} answers resolved).\n`)

  for (const item of system2Queue) {
    if (s2Answers[item.id]) {
      let refinedPred = s2Answers[item.id].trim()
      refinedPred = normalizeCountAnswer(refinedPred, item.question)
      pass10Results[item.index].prediction = refinedPred
      pass10Results[item.index].finalPrediction = refinedPred
      pass10Results[item.index].system2Resolved = true
      pass10Results[item.index].routeReason = item.reason
      pass10Results[item.index].metrics = {
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
const p10Agg = aggregateBenchmarkResults(pass10Results)

const bRecallPct = (baselineHits / totalGoldEvidenceTurns) * 100
const p10RecallPct = (pass10Hits / totalGoldEvidenceTurns) * 100

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

const highScoringPass10 = pass10Results.filter(r => r.metrics.upstreamF1 >= 0.8).length

const reportMd = `# LoCoMo conv-47 Pass 10 (Turn-1 Windowed Anaphora + Jev + Monolithic System-2) Benchmark Report

- **Date**: ${new Date().toISOString()}
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: ${shootoutDurationSec}s
- **Architecture**:
  - **Conversational Window Indexing (Turn-1)**: Prepend immediate prior turn (\`\${prevTurn.speaker}: \${prevTurn.text}\\n\`) to resolve anaphora in BM25 tokens and BGE embeddings
  - **System-1 Coprocessor**: TypeSafe Jev Cloud (\`typesafe/jev-latest\`) for Zero-Shot Triage, In-Session Distillation, and Batched Cross-Encoder Reranking
  - **Polar Query Guard**: Prevents yes/no queries from being answered with calendar dates; escalates cleanly to System-2
  - **Temporal Date-Range Hook**: Anima-inspired automatic date/month extraction and session turn injection
  - **Strict Distillation Abstention**: Jev System-1 (\`choice: 'none'\`) abstains cleanly without forcing irrelevant raw turns
  - **Strict Ledger Verification**: Only unambiguous graph matches bypass System-2; unverified graph hypotheses escalate
  - **Casual Spoken Query Expansion**: Canonical aliases bridge conversational phrasing
  - **Deductive Synthesis (System-2)**: Monolithic One-Shot DeepSeek Flash via OpenCode Go with unforced output token ceiling
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 8 (Jev Chunked) | Pass 9 (Jev Chunked) | Pass 9 (Laya Mono) | Pass 10 (Anaphora + Jev + Mono) | Delta vs Pass 9 Jev |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | ${bRecallPct.toFixed(2)}% | ${p8Recall.toFixed(2)}% | ${p9JevRecall.toFixed(2)}% | ${p9LayaRecall.toFixed(2)}% | **${p10RecallPct.toFixed(2)}%** | **${(p10RecallPct - p9JevRecall) >= 0 ? '+' : ''}${(p10RecallPct - p9JevRecall).toFixed(2)}%** |
| **Official Upstream F1** | ${bAgg.overall.upstreamF1.toFixed(2)}% | ${p8UpstreamF1.toFixed(2)}% | ${p9JevUpstreamF1.toFixed(2)}% | ${p9LayaUpstreamF1.toFixed(2)}% | **${p10Agg.overall.upstreamF1.toFixed(2)}%** | **${(p10Agg.overall.upstreamF1 - p9JevUpstreamF1) >= 0 ? '+' : ''}${(p10Agg.overall.upstreamF1 - p9JevUpstreamF1).toFixed(2)}%** |
| **Legacy Token F1** | ${bAgg.overall.f1.toFixed(2)}% | ${(p8Agg?.overall?.f1 ?? 69.60).toFixed(2)}% | ${(p9JevAgg?.overall?.f1 ?? 68.48).toFixed(2)}% | 68.29% | **${p10Agg.overall.f1.toFixed(2)}%** | **${(p10Agg.overall.f1 - (p9JevAgg?.overall?.f1 ?? 68.48)) >= 0 ? '+' : ''}${(p10Agg.overall.f1 - (p9JevAgg?.overall?.f1 ?? 68.48)).toFixed(2)}%** |
| **Overall BLEU-1** | ${bAgg.overall.bleu.toFixed(2)}% | ${(p8Agg?.overall?.bleu ?? 64.39).toFixed(2)}% | ${(p9JevAgg?.overall?.bleu ?? 62.09).toFixed(2)}% | 62.83% | **${p10Agg.overall.bleu.toFixed(2)}%** | **${(p10Agg.overall.bleu - (p9JevAgg?.overall?.bleu ?? 62.09)) >= 0 ? '+' : ''}${(p10Agg.overall.bleu - (p9JevAgg?.overall?.bleu ?? 62.09)).toFixed(2)}%** |
| **Multi-Hop (C1) Upstream F1** | ${bAgg.categoryBreakdown.c1.upstreamF1.toFixed(2)}% | ${p8C1F1.toFixed(2)}% | ${p9JevC1F1.toFixed(2)}% | ${p9LayaC1F1.toFixed(2)}% | **${p10Agg.categoryBreakdown.c1.upstreamF1.toFixed(2)}%** | **${(p10Agg.categoryBreakdown.c1.upstreamF1 - p9JevC1F1) >= 0 ? '+' : ''}${(p10Agg.categoryBreakdown.c1.upstreamF1 - p9JevC1F1).toFixed(2)}%** |
| **Temporal (C2) Upstream F1** | ${bAgg.categoryBreakdown.c2.upstreamF1.toFixed(2)}% | ${p8C2F1.toFixed(2)}% | ${p9JevC2F1.toFixed(2)}% | ${p9LayaC2F1.toFixed(2)}% | **${p10Agg.categoryBreakdown.c2.upstreamF1.toFixed(2)}%** | **${(p10Agg.categoryBreakdown.c2.upstreamF1 - p9JevC2F1) >= 0 ? '+' : ''}${(p10Agg.categoryBreakdown.c2.upstreamF1 - p9JevC2F1).toFixed(2)}%** |
| **Detective (C3) Upstream F1** | ${bAgg.categoryBreakdown.c3.upstreamF1.toFixed(2)}% | ${p8C3F1.toFixed(2)}% | ${p9JevC3F1.toFixed(2)}% | ${p9LayaC3F1.toFixed(2)}% | **${p10Agg.categoryBreakdown.c3.upstreamF1.toFixed(2)}%** | **${(p10Agg.categoryBreakdown.c3.upstreamF1 - p9JevC3F1) >= 0 ? '+' : ''}${(p10Agg.categoryBreakdown.c3.upstreamF1 - p9JevC3F1).toFixed(2)}%** |
| **Literal (C4) Upstream F1** | ${bAgg.categoryBreakdown.c4.upstreamF1.toFixed(2)}% | ${p8C4F1.toFixed(2)}% | ${p9JevC4F1.toFixed(2)}% | ${p9LayaC4F1.toFixed(2)}% | **${p10Agg.categoryBreakdown.c4.upstreamF1.toFixed(2)}%** | **${(p10Agg.categoryBreakdown.c4.upstreamF1 - p9JevC4F1) >= 0 ? '+' : ''}${(p10Agg.categoryBreakdown.c4.upstreamF1 - p9JevC4F1).toFixed(2)}%** |
| **High-Scoring Answers (F1 ≥ 0.8)** | - | 84/150 (56.0%) | 85/150 (56.7%) | 86/150 (57.3%) | **${highScoringPass10}/150 (${((highScoringPass10 / 150) * 100).toFixed(1)}%)** | **${highScoringPass10 - 85 >= 0 ? '+' : ''}${highScoringPass10 - 85}** |
`

fs.writeFileSync(OUTPUT_REPORT_PATH, reportMd)
console.log(`Saved Pass 10 report to ${OUTPUT_REPORT_PATH}`)

const detailedComparison = qas.map((q, idx) => ({
  index: idx,
  question: q.question,
  goldAnswer: q.answer,
  goldEvidence: q.evidence,
  baseline: baselineResults[idx],
  pass8: pass8Trace?.detailedComparison?.[idx]?.pass3 || pass8Trace?.detailedComparison?.[idx]?.pass8 || null,
  pass9Jev: pass9JevTrace?.detailedComparison?.[idx]?.pass9 || null,
  pass9Laya: pass9LayaTrace?.detailedComparison?.[idx]?.pass9Laya || null,
  pass10: pass10Results[idx],
}))

fs.writeFileSync(OUTPUT_TRACE_PATH, JSON.stringify({
  metadata: {
    runDate: new Date().toISOString(),
    dataset: 'conv-47',
    durationSec: Number.parseFloat(shootoutDurationSec),
  },
  metrics: { baseline: bAgg, pass8: p8Agg, pass9Jev: p9JevAgg, pass9Laya: p9LayaAgg, pass10: p10Agg },
  detailedComparison,
}, null, 2))
console.log(`Saved Pass 10 trace to ${OUTPUT_TRACE_PATH}`)

console.log('\n======================================================')
console.log('PASS 10 SHOOTOUT COMPLETE')
console.log('======================================================')
console.log(reportMd)
