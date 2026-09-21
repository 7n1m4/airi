/**
 * Isolated Shootout: Single Monolithic Request (121 questions) vs Chunked Batches (10 items / request).
 *
 * Tests how DeepSeek V4.1 Flash behaves when given all 121 LoCoMo questions in a single prompt
 * vs chunked batches:
 *   - Response latency (1 request vs 13 requests)
 *   - Token usage (input, output, total, and prompt savings)
 *   - JSON schema integrity & finish_reason
 *   - Question resolution rate (how many of the 121 are answered vs truncated/omitted)
 *   - Factual accuracy (Token F1 & Official Upstream LoCoMo F1)
 */

import fs from 'node:fs'
import path from 'node:path'

import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { computeTokenF1, computeUpstreamLoCoMoF1 } from './locomo-metrics.mjs'
import { getSystem2Config } from './system2-batch-resolver.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const TRACE_PATH = path.join(ROOT, 'reports/memory-lab/locomo-conv47-pass9-trace.json')
const CONV_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47.json')

// 1. Build Turn/Summary Map
const conv = JSON.parse(fs.readFileSync(CONV_PATH, 'utf8'))
const turnMap = new Map()
for (let i = 1; i <= 31; i++) {
  const s = conv.conversation[`session_${i}`] || []
  const dt = conv.conversation[`session_${i}_date_time`] || 'Unknown'
  for (const t of s) {
    turnMap.set(t.dia_id, { text: t.text, speaker: t.speaker, timestamp: dt })
  }
  const sum = conv.session_summary?.[`session_${i}_summary`]
  if (sum) {
    turnMap.set(`sum_session_${i}_summary`, { text: sum, speaker: 'Summary', timestamp: dt })
  }
}

// 2. Load the 121 escalated questions from Pass 9 trace
const trace = JSON.parse(fs.readFileSync(TRACE_PATH, 'utf8'))
const qas = trace.detailedComparison

const items = []
for (let i = 0; i < qas.length; i++) {
  const it = qas[i]
  const p9 = it.pass9
  // If it was escalated to System-2 or has UNKNOWN initial prediction or category 1/3
  const isEscalated = p9.system2Resolved || p9.initialPrediction === 'UNKNOWN' || p9.category === 1 || p9.category === 3
  if (isEscalated) {
    const evidenceBlocks = (p9.topEvidenceIds || []).map((id) => {
      const turn = turnMap.get(id)
      if (!turn)
        return `[Turn ${id}]\n(turn text unavailable)`
      const speakerPrefix = turn.speaker ? `${turn.speaker}: ` : ''
      return `[Turn ${id} | Date: ${turn.timestamp}]\n${speakerPrefix}${turn.text}`
    }).join('\n\n')

    items.push({
      id: `q_${i}`,
      index: i,
      question: it.question,
      groundTruth: it.goldAnswer,
      category: it.pass9.category,
      evidence: evidenceBlocks,
      pass9Answer: p9.prediction,
      pass9UpstreamF1: p9.metrics?.upstreamF1 ?? 0,
      pass9TokenF1: p9.metrics?.f1 ?? 0,
    })
  }
}

console.log(`================================================================`)
console.log(`DeepSeek Flash Monolithic Batch Isolation Test`)
console.log(`Total Escalated Questions: ${items.length}`)
console.log(`================================================================\n`)

const systemPrompt = `You are a concise factual reading assistant.
Answer each item independently. Ground personal facts strictly in the provided dialogue evidence; use general knowledge only to interpret or deduce unstated implications.
Rules:
1. For single-entity, person, place, game, or attribute questions, output ONLY the minimal factual answer (1 to 4 words). Do NOT include reasoning, evidence citations, parenthetical commentary, or conversational filler.
2. For yes/no questions, answer strictly with "Yes" or "No".
3. For questions asking for a count or number, output the count as an English word (e.g. "two", "three").
4. For questions asking for duration or elapsed time, include the numeric amount and unit (e.g. "six months", "nearly three months").
5. For questions asking for a list of items (e.g. countries, books, games, charities), list ALL supported items separated by commas. Do NOT truncate the list to 1-4 words.
6. NEVER use slashes ('/') between alternative words; use 'or' or commas instead.
7. If the provided evidence is conflicting or genuinely insufficient to answer, return status "insufficient".
Output ONLY a valid JSON object matching this schema:
{
  "answers": {
    "<item_id>": {
      "status": "answered" | "insufficient",
      "answer": "<factual answer string>",
      "usedGeneralKnowledge": boolean
    }
  }
}
Do not include markdown codeblocks or conversational filler.`

const itemMap = {}
for (const it of items) {
  itemMap[it.id] = {
    question: it.question,
    evidence: (it.evidence || '').slice(0, 6000),
  }
}

const payload = {
  model: 'deepseek-v4.1-flash',
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(itemMap) },
  ],
  temperature: 0.1,
}

const { apiKey, baseUrl } = getSystem2Config()
if (!apiKey) {
  console.error('ERROR: OPENCODE_GO_API_KEY not found!')
  process.exit(1)
}

console.log(`[Monolithic] Dispatching ALL ${items.length} questions in ONE single HTTP request...`)
console.log(`[Monolithic] Payload user content length: ${JSON.stringify(itemMap).length} characters (~${Math.round(JSON.stringify(itemMap).length / 3.8)} tokens)`)

const t0 = performance.now()
const sessionId = `locomo-mono-${Date.now()}`

try {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'x-opencode-session': sessionId,
    },
    body: JSON.stringify(payload),
  })

  const durationSec = ((performance.now() - t0) / 1000).toFixed(2)

  if (!res.ok) {
    const errText = await res.text()
    console.error(`[Monolithic] API returned status ${res.status}: ${errText}`)
    process.exit(1)
  }

  const data = await res.json()
  console.log(`[Monolithic] Request completed in ${durationSec}s!`)
  console.log(`[Monolithic] Finish Reason:`, data.choices?.[0]?.finish_reason)
  console.log(`[Monolithic] Usage Telemetry:`, data.usage || '(no usage reported by gateway)')

  const contentStr = data.choices?.[0]?.message?.content || ''
  console.log(`[Monolithic] Response length: ${contentStr.length} characters`)

  let parsed = {}
  try {
    parsed = JSON.parse(contentStr)
  }
  catch (e) {
    console.warn(`[Monolithic] Direct JSON.parse failed due to token truncation (${e.message}). Extracting completed answer blocks via regex...`)
    const rawOutPath = path.join(ROOT, 'reports/memory-lab/deepseek-mono-raw-output.json')
    fs.writeFileSync(rawOutPath, contentStr)
    console.log(`[Monolithic] Saved raw truncated output to ${rawOutPath}`)

    // Extract every completed "<id>": { ... } block
    const answersObj = {}
    const blockRegex = /"(q_\d+)":\s*(\{[^{}]*\})/g
    let match
    while ((match = blockRegex.exec(contentStr)) !== null) {
      try {
        answersObj[match[1]] = JSON.parse(match[2])
      }
      catch {}
    }
    parsed = { answers: answersObj }
  }

  const answers = parsed.answers || parsed
  const returnedIds = Object.keys(answers)
  console.log(`[Monolithic] Parsed completed answers count: ${returnedIds.length} / ${items.length}`)

  // Evaluate Accuracy of Monolithic batch vs Pass 9 chunked batch
  let monoUpstreamF1Sum = 0
  let monoTokenF1Sum = 0
  let pass9UpstreamF1Sum = 0
  let pass9TokenF1Sum = 0
  let answeredCount = 0
  let insufficientCount = 0
  let missingCount = 0

  const monoDiffs = []

  for (const it of items) {
    const val = answers[it.id]
    let monoPred = 'UNKNOWN'
    if (val && typeof val === 'object') {
      if (val.status === 'insufficient') {
        insufficientCount++
        monoPred = 'UNKNOWN'
      }
      else if (val.answer && typeof val.answer === 'string') {
        monoPred = val.answer.trim()
        answeredCount++
      }
    }
    else if (typeof val === 'string' && val.trim().length > 0) {
      monoPred = val.trim()
      answeredCount++
    }
    else {
      missingCount++
    }

    const mUpstreamF1 = computeUpstreamLoCoMoF1(monoPred, it.groundTruth, it.category)
    const mTokenF1 = computeTokenF1(monoPred, it.groundTruth)

    monoUpstreamF1Sum += mUpstreamF1
    monoTokenF1Sum += mTokenF1
    pass9UpstreamF1Sum += it.pass9UpstreamF1
    pass9TokenF1Sum += it.pass9TokenF1

    if (Math.abs(mUpstreamF1 - it.pass9UpstreamF1) > 0.05) {
      monoDiffs.push({
        id: it.id,
        cat: it.category,
        question: it.question,
        gold: it.groundTruth,
        chunkedPred: it.pass9Answer,
        chunkedF1: it.pass9UpstreamF1.toFixed(2),
        monoPred,
        monoF1: mUpstreamF1.toFixed(2),
        delta: (mUpstreamF1 - it.pass9UpstreamF1).toFixed(2),
      })
    }
  }

  const avgMonoUpstreamF1 = (monoUpstreamF1Sum / items.length) * 100
  const avgChunkedUpstreamF1 = (pass9UpstreamF1Sum / items.length) * 100

  console.log(`\n================================================================`)
  console.log(`ISOLATED BATCH EXPERIMENT RESULTS (121 Questions)`)
  console.log(`================================================================`)
  console.log(`HTTP Requests Sent:      1 (Monolithic) vs 13 (Chunked)`)
  console.log(`Total Wall-Clock Time:   ${durationSec}s (Monolithic) vs 182.18s (Chunked)`)
  console.log(`Speedup Factor:          ${(182.18 / Number.parseFloat(durationSec)).toFixed(1)}x faster!`)
  console.log(`Questions Resolved:      ${answeredCount} answered, ${insufficientCount} insufficient, ${missingCount} missing`)
  console.log(`Monolithic Upstream F1:  ${avgMonoUpstreamF1.toFixed(2)}%`)
  console.log(`Chunked Upstream F1:     ${avgChunkedUpstreamF1.toFixed(2)}%`)
  console.log(`Upstream F1 Delta:       ${(avgMonoUpstreamF1 - avgChunkedUpstreamF1) >= 0 ? '+' : ''}${(avgMonoUpstreamF1 - avgChunkedUpstreamF1).toFixed(2)}%`)
  console.log(`================================================================\n`)

  if (monoDiffs.length > 0) {
    console.log(`Sample Question Differences (Monolithic vs Chunked):`)
    monoDiffs.slice(0, 10).forEach((d) => {
      console.log(`- [${d.id} | C${d.cat}] (${d.delta >= 0 ? '+' : ''}${d.delta}) "${d.question}"`)
      console.log(`    Gold:    "${d.gold}"`)
      console.log(`    Chunked: "${d.chunkedPred}" (F1: ${d.chunkedF1})`)
      console.log(`    Mono:    "${d.monoPred}" (F1: ${d.monoF1})`)
    })
  }

  // Save isolated test output
  const reportPath = path.join(ROOT, 'reports/memory-lab/batch-size-isolation-experiment.json')
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    monolithic: {
      durationSec: Number.parseFloat(durationSec),
      finishReason: data.choices?.[0]?.finish_reason,
      usage: data.usage,
      answeredCount,
      insufficientCount,
      missingCount,
      avgUpstreamF1: avgMonoUpstreamF1,
    },
    chunked: {
      durationSec: 182.18,
      requests: 13,
      avgUpstreamF1: avgChunkedUpstreamF1,
    },
    diffs: monoDiffs,
  }, null, 2))
  console.log(`Saved detailed experiment log to ${reportPath}`)
}
catch (err) {
  console.error(`[Monolithic] Execution failed:`, err)
}
