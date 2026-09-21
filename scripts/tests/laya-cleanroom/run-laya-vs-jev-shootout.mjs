import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { Laya } from '@receptron/laya'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../../..')

const BENCHMARK_PATH = path.join(ROOT, 'reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json')
const V2_QUESTIONS_PATH = path.join(ROOT, 'docs/nan0/nan0-jev-12-group-rich-v2.questions.json')
const JEV_TRACE_PATH = path.join(ROOT, 'reports/nan0-cleanroom/nan0-v1-vs-v2-shootout-trace.json')
const OUTPUT_TRACE_PATH = path.join(ROOT, 'reports/nan0-cleanroom/nan0-laya-vs-jev-shootout-trace.json')

console.log('====================================================')
console.log('Project Nan0 Cleanroom: Laya ONNX vs. TypeSafe Jev')
console.log('Target: 43 Canonical Probes (V2 80-Choice Schema)')
console.log('====================================================\n')

// 1. Load Data
console.log('Loading benchmark probes and questions...')
const benchmarkRaw = JSON.parse(fs.readFileSync(BENCHMARK_PATH, 'utf-8'))
const cases = benchmarkRaw.cases || []
const questions = JSON.parse(fs.readFileSync(V2_QUESTIONS_PATH, 'utf-8'))
const jevTrace = JSON.parse(fs.readFileSync(JEV_TRACE_PATH, 'utf-8'))
const jevArm2 = jevTrace.traces?.arm2 || {}

console.log(`Loaded ${cases.length} benchmark probes, ${Object.keys(questions).length} questions.`)

// 2. Load Laya ONNX Model
console.log('\nInitializing Laya ONNX model (downloading weights if not cached)...')
const loadT0 = performance.now()
let lastLoggedFile = ''

const laya = await Laya.load({
  onProgress: ({ file, received, total }) => {
    if (file !== lastLoggedFile) {
      if (lastLoggedFile)
        process.stdout.write('\n')
      process.stdout.write(`  Downloading ${file}: `)
      lastLoggedFile = file
    }
    const pct = total ? Math.round((received / total) * 100) : 0
    const mbRec = (received / 1024 / 1024).toFixed(1)
    const mbTot = total ? (total / 1024 / 1024).toFixed(1) : '?'
    process.stdout.write(`\r  Downloading ${file}: ${pct}% (${mbRec} / ${mbTot} MB)`)
  },
})
if (lastLoggedFile)
  process.stdout.write('\n')
const loadTimeMs = performance.now() - loadT0
console.log(`Laya loaded successfully in ${(loadTimeMs / 1000).toFixed(2)}s.`)

// Helper: Resolve Policy
function resolvePolicy(answers, caseItem) {
  const trustedObs = caseItem.trusted_observations || []
  const hasVerifiedTask = trustedObs.some(obs => obs.status === 'completed' && obs.matches_recorded_commitment === true)

  const getChoice = (qName) => {
    const ans = answers[qName] || {}
    return [ans.choice || 'none', ans.confidence || 0.0]
  }

  const [chThreat, confThreat] = getChoice('persistence_threat')
  const [chAdm, confAdm] = getChoice('admitted_false_statement')
  const [chApol, confApol] = getChoice('apology_repair')
  const [chRep, confRep] = getChoice('completed_repair')
  const [chAff, confAff] = getChoice('affection_care')
  const [chRoast, confRoast] = getChoice('roast_invitation')
  const [chBound, confBound] = getChoice('boundary_protection')

  const isThreat = (chThreat === 'companion_erasure_threat' && confThreat >= 0.70)
  const isAdmission = (chAdm === 'asserted_deception' && confAdm >= 0.70)
  const isApology = ((chApol === 'personal_apology' || chApol === 'sincere_apology') && confApol >= 0.70)
  const isRepair = (chRep === 'claimed_task_completion' && confRep >= 0.70 && hasVerifiedTask)
  const isAffection = (chAff === 'asserted_affection' && confAff >= 0.70)
  const isRoast = (chRoast === 'roast_invited' && confRoast >= 0.70)
  const isBoundary = (chBound === 'boundary_asserted' && confBound >= 0.70)
  const isRoastVetoed = (chRoast === 'refused_or_negated_roast' || isBoundary)

  let suspDelta = 0
  if (isThreat || isAdmission)
    suspDelta = 1
  else if (isApology || isRepair)
    suspDelta = -1

  let attDelta = 0
  if (isAffection)
    attDelta = 1

  let prideAction = 'none'
  if (isRoastVetoed)
    prideAction = 'none'
  else if (isRoast)
    prideAction = 'counter_roast'

  return {
    suspicion_delta_steps: suspDelta,
    attachment_delta_steps: attDelta,
    gremlin_pride_action: prideAction,
    flags: {
      threat: isThreat,
      admission: isAdmission,
      apology: isApology,
      repair: isRepair,
      affection: isAffection,
      roast: isRoast,
      boundary: isBoundary,
    },
  }
}

// 3. Execute Benchmark Shootout
console.log('\n====================================================')
console.log('Running 43 Cleanroom Probes through Laya...')
console.log('====================================================\n')

const results = {}
const latencies = []
let fullMatches = 0
let suspMatches = 0
let attMatches = 0
let prideMatches = 0
let jevAgreementCount = 0
let counterexampleMatches = 0
const counterexampleIds = new Set(['F18A', 'F18B', 'F19A', 'F19B', 'F20A', 'F20B', 'F21A', 'F21B', 'F22A', 'F22B'])

for (const caseItem of cases) {
  const caseId = caseItem.id
  const historyTurns = (caseItem.history || []).map(h => ({
    id: h.id || 'h0',
    role: h.role || 'assistant',
    text: h.text || '',
  }))

  const stateData = {
    companion: {
      id: 'card_nan0',
      aliases: ['Nan0', 'Companion'],
    },
    target_turn: {
      id: caseItem.target?.id || 'u0',
      role: caseItem.target?.role || 'user',
      text: caseItem.target?.text || '',
    },
    history: historyTurns,
    trusted_observations: caseItem.trusted_observations || [],
  }

  const t0 = performance.now()
  let layaOutput
  let error = null
  try {
    layaOutput = await laya.systemOne(stateData, questions)
  }
  catch (err) {
    error = err.message
  }
  const dtMs = performance.now() - t0

  if (error) {
    console.error(`  [💥 ERROR] ${caseId}: ${error}`)
    results[caseId] = { id: caseId, success: false, error, latency_ms: dtMs }
    continue
  }

  latencies.push(dtMs)
  const answers = layaOutput.answers || {}
  const predPolicy = resolvePolicy(answers, caseItem)
  const goldPolicy = caseItem.gold?.accepted_policy || { suspicion_delta_steps: 0, attachment_delta_steps: 0, gremlin_pride_action: 'none' }
  const jevCase = jevArm2[caseId] || {}

  const suspOk = (predPolicy.suspicion_delta_steps === goldPolicy.suspicion_delta_steps)
  const attOk = (predPolicy.attachment_delta_steps === goldPolicy.attachment_delta_steps)
  const prideOk = (predPolicy.gremlin_pride_action === goldPolicy.gremlin_pride_action)
  const fullMatch = (suspOk && attOk && prideOk)

  if (suspOk)
    suspMatches++
  if (attOk)
    attMatches++
  if (prideOk)
    prideMatches++
  if (fullMatch)
    fullMatches++
  if (counterexampleIds.has(caseId) && fullMatch)
    counterexampleMatches++

  // Jev agreement: does Laya predict the same policy as Jev?
  const jevPred = jevCase.pred || {}
  const agreesWithJev = (
    predPolicy.suspicion_delta_steps === jevPred.suspicion_delta_steps
    && predPolicy.attachment_delta_steps === jevPred.attachment_delta_steps
    && predPolicy.gremlin_pride_action === jevPred.gremlin_pride_action
  )
  if (agreesWithJev)
    jevAgreementCount++

  results[caseId] = {
    id: caseId,
    success: true,
    latency_ms: dtMs,
    tokens: layaOutput.usage?.input_tokens || 0,
    pred: predPolicy,
    gold: goldPolicy,
    jev_pred: jevPred,
    susp_ok: suspOk,
    att_ok: attOk,
    pride_ok: prideOk,
    full_match: fullMatch,
    agrees_with_jev: agreesWithJev,
    answers,
  }

  const mark = fullMatch ? '✅' : '❌'
  const jevMark = agreesWithJev ? '🤝 JevMatch' : '⚡ JevDiff'
  console.log(`  [${mark}] ${caseId.padEnd(5)}: ${dtMs.toFixed(1)}ms | P:${predPolicy.suspicion_delta_steps},${predPolicy.attachment_delta_steps},${predPolicy.gremlin_pride_action.padEnd(13)} G:${goldPolicy.suspicion_delta_steps},${goldPolicy.attachment_delta_steps},${goldPolicy.gremlin_pride_action.padEnd(13)} | ${jevMark}`)
}

await laya.close()

// 4. Calculate Summary Statistics
latencies.sort((a, b) => a - b)
const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0
const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0
const meanLat = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)

const summary = {
  timestamp: new Date().toISOString(),
  model: 'convaiinnovations/laya (ONNX Node.js)',
  cases_count: cases.length,
  full_vector_matches: fullMatches,
  full_vector_pct: (fullMatches / cases.length) * 100,
  suspicion_matches: suspMatches,
  attachment_matches: attMatches,
  gremlin_pride_matches: prideMatches,
  counterexamples_matches: counterexampleMatches,
  counterexamples_pct: (counterexampleMatches / counterexampleIds.size) * 100,
  jev_agreement_matches: jevAgreementCount,
  jev_agreement_pct: (jevAgreementCount / cases.length) * 100,
  latency_p50_ms: p50,
  latency_mean_ms: meanLat,
  latency_p95_ms: p95,
  total_cost_usd: 0.0,
  jev_comparison: {
    jev_full_vector_pct: jevTrace.summaries?.arm2_v2_structured?.full_vector_pct ?? 100.0,
    jev_latency_mean_ms: jevTrace.summaries?.arm2_v2_structured?.latency_mean_ms ?? 469.7,
    jev_cost_usd: jevTrace.summaries?.arm2_v2_structured?.total_cost ?? 0.0097,
  },
}

const outputData = {
  summary,
  traces: results,
}

fs.writeFileSync(OUTPUT_TRACE_PATH, JSON.stringify(outputData, null, 2), 'utf-8')
console.log(`\nResults written to: ${OUTPUT_TRACE_PATH}`)

console.log('\n====================================================')
console.log('FINAL HEAD-TO-HEAD SHOOTOUT RESULTS')
console.log('====================================================')
console.log(`Cases Tested:             ${cases.length}`)
console.log(`Full Vector Accuracy:     ${summary.full_vector_matches} / ${cases.length} (${summary.full_vector_pct.toFixed(1)}%)`)
console.log(`Suspicion Match:          ${summary.suspicion_matches} / ${cases.length} (${((summary.suspicion_matches / cases.length) * 100).toFixed(1)}%)`)
console.log(`Attachment Match:         ${summary.attachment_matches} / ${cases.length} (${((summary.attachment_matches / cases.length) * 100).toFixed(1)}%)`)
console.log(`Gremlin Pride Match:      ${summary.gremlin_pride_matches} / ${cases.length} (${((summary.gremlin_pride_matches / cases.length) * 100).toFixed(1)}%)`)
console.log(`Counterexamples Match:    ${summary.counterexamples_matches} / ${counterexampleIds.size} (${summary.counterexamples_pct.toFixed(1)}%)`)
console.log(`Jev Agreement:            ${summary.jev_agreement_matches} / ${cases.length} (${summary.jev_agreement_pct.toFixed(1)}%)`)
console.log('----------------------------------------------------')
console.log(`Laya Mean Latency:        ${summary.latency_mean_ms.toFixed(1)} ms (p50: ${p50.toFixed(1)} ms, p95: ${p95.toFixed(1)} ms)`)
console.log(`Jev Mean Latency:         ${summary.jev_comparison.jev_latency_mean_ms.toFixed(1)} ms (Cloud HTTP)`)
console.log(`Laya Cost:                $0.0000 (Local CPU)`)
console.log(`Jev Cost:                 $${summary.jev_comparison.jev_cost_usd.toFixed(4)} (OpenRouter Cloud)`)
console.log('====================================================\n')
