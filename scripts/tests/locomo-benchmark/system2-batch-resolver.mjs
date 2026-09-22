/**
 * Batched System-2 Deductive Concept Resolver.
 *
 * Dispatches Category 3 (Detective / Implication) questions where the answer
 * is not explicitly stated in conversational text to DeepSeek Flash via OpenCode Go.
 *
 * Features:
 *   - Strict ID validation (rejects unrequested or cross-chunk IDs).
 *   - Typed contract: { id, status, answer, usedGeneralKnowledge }.
 *   - Verbatim evidence grounding: interprets dialogue evidence using world knowledge.
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')

/**
 * Loads OpenCode Go credentials safely from environment or .env.
 */
export function getSystem2Config() {
  let apiKey = process.env.OPENCODE_GO_API_KEY
  let baseUrl = process.env.OPENCODE_GO_BASE_URL || 'https://opencode.ai/zen/go/v1'

  const envPath = path.join(ROOT, '.env')
  if ((!apiKey || !baseUrl) && fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8')
    const kMatch = content.match(/OPENCODE_GO_API_KEY=(.+)/)
    const bMatch = content.match(/OPENCODE_GO_BASE_URL=(.+)/)
    if (kMatch && !apiKey)
      apiKey = kMatch[1].trim()
    if (bMatch && !baseUrl)
      baseUrl = bMatch[1].trim()
  }

  return { apiKey, baseUrl }
}

/**
 * Resolves a batch of deductive / unstated questions using DeepSeek Flash via OpenCode Go.
 *
 * @param {Array<{ id: string, question: string, evidence: string }>} items
 * @param {object} [opts]
 * @param {number} [opts.batchSize=15]
 * @param {string} [opts.model='deepseek-v4.1-flash']
 * @returns {Promise<Record<string, string>>} Map of item id -> concise answer string
 */
export async function resolveSystem2Batch(items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return {}
  }

  const { apiKey, baseUrl } = getSystem2Config()
  if (!apiKey) {
    console.warn('[System2Resolver] OPENCODE_GO_API_KEY not found; skipping System-2 deductive pass.')
    return {}
  }

  const model = opts.model || 'deepseek-v4.1-flash'
  // ARCHITECTURAL NOTICE (AIRI Production Porting):
  // 1. One-Shot Default: Ingesting the full deductive queue in a single prompt enables cross-question global
  //    reasoning and cuts network round-trips/latency in half (~94s vs ~182s on conv-47).
  // 2. Unforced Ceiling: Do NOT hardcode arbitrary max_tokens / output parameters in the request payload;
  //    allow the underlying provider configuration (e.g. opencode.json limit.output or provider profile)
  //    to define the output ceiling naturally.
  // 3. Configurable Chunking: Chunking should remain a configurable parameter in AIRI (via Settings > Cognition
  //    or System-2 Dispatch). While one-shotting succeeds on current benchmarks (~126 questions / ~24K completion tokens),
  //    larger datasets (+20% volume) or providers with stricter per-request token caps will require chunking
  //    to avoid hitting provider output truncation boundaries.
  const batchSize = opts.batchSize || items.length
  const timeoutMs = opts.timeoutMs || 300_000 // 5 minutes timeout per user directive
  const results = {}

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

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize)
    const validChunkIds = new Set(chunk.map(it => it.id))
    const resolvedIds = new Set()
    const insufficientIds = new Set()
    let pendingItems = [...chunk]

    let attempts = 0
    while (attempts < 3 && pendingItems.length > 0) {
      attempts++
      try {
        const itemMap = {}
        for (const it of pendingItems) {
          itemMap[it.id] = {
            question: it.question,
            evidence: (it.evidence || '').slice(0, 6000),
          }
        }

        const payload = {
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(itemMap) },
          ],
          temperature: 0.1,
        }

        const sessionId = `locomo-system2-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'x-opencode-session': sessionId,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        })

        if (!res.ok) {
          const errText = await res.text()
          console.warn(`[System2Resolver] API error ${res.status} (attempt ${attempts}): ${errText}`)
          if (attempts < 3) {
            await new Promise(r => setTimeout(r, 2000))
            continue
          }
          break
        }

        const data = await res.json()
        const choice = data.choices?.[0]
        const finishReason = choice?.finish_reason
        const contentStr = choice?.message?.content

        if (finishReason === 'length') {
          console.warn(`[System2Resolver] Provider output truncated (finish_reason: length) on attempt ${attempts}.`)
        }

        if (opts.telemetry && Array.isArray(opts.telemetry)) {
          opts.telemetry.push({
            sessionId,
            finishReason,
            usage: data.usage,
            pendingCount: pendingItems.length,
            attempt: attempts,
          })
        }

        if (contentStr) {
          let parsed = {}
          try {
            parsed = JSON.parse(contentStr)
          }
          catch {
            // Attempt to extract JSON substring if wrapped in markdown or truncated
            const jsonMatch = contentStr.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              try {
                parsed = JSON.parse(jsonMatch[0])
              }
              catch {
                // If JSON is malformed due to truncation, attempt partial item extraction
                const itemRegex = /"([^"]+)":\s*\{\s*"status":\s*"([^"]+)",\s*"answer":\s*"([^"]+)"/g
                let match
                while ((match = itemRegex.exec(contentStr)) !== null) {
                  parsed[match[1]] = { status: match[2], answer: match[3] }
                }
              }
            }
          }

          const answers = parsed.answers || parsed

          for (const [id, val] of Object.entries(answers)) {
            // Reject cross-chunk or unrequested IDs
            if (!validChunkIds.has(id))
              continue

            if (val && typeof val === 'object') {
              if (val.status === 'answered' && typeof val.answer === 'string' && val.answer.trim().length > 0) {
                results[id] = val.answer.trim()
                resolvedIds.add(id)
              }
              else if (val.status === 'insufficient') {
                insufficientIds.add(id)
              }
            }
            else if (typeof val === 'string' && val.trim().length > 0) {
              const lower = val.trim().toLowerCase()
              if (lower === 'insufficient') {
                insufficientIds.add(id)
              }
              else if (lower !== 'unknown' && !lower.startsWith('error:')) {
                results[id] = val.trim()
                resolvedIds.add(id)
              }
            }
          }
        }

        // Check for missing/unresolved items
        const nextPending = pendingItems.filter(it => !resolvedIds.has(it.id) && !insufficientIds.has(it.id))
        if (nextPending.length === 0) {
          // All items in this chunk successfully resolved or determined insufficient
          break
        }

        if (attempts < 3) {
          console.warn(`[System2Resolver] ${nextPending.length}/${pendingItems.length} items unresolved on attempt ${attempts} (finish_reason: ${finishReason || 'unknown'}). Retrying unresolved items...`)
          pendingItems = nextPending
          await new Promise(r => setTimeout(r, 2000))
        }
        else {
          console.warn(`[System2Resolver] ${nextPending.length} items remain unresolved after ${attempts} attempts.`)
        }
      }
      catch (err) {
        if (attempts >= 3) {
          console.warn(`[System2Resolver] Error during batch resolution after ${attempts} attempts: ${err.message}`)
        }
        else {
          console.warn(`[System2Resolver] Attempt ${attempts} failed (${err.message}), retrying in 2s...`)
          await new Promise(r => setTimeout(r, 2000))
        }
      }
    }
  }

  return results
}
