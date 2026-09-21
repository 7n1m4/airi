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
  const batchSize = opts.batchSize || 15
  const results = {}

  const systemPrompt = `You are a concise deductive reader.
Answer each item independently. Use dialogue evidence for personal facts. Use general knowledge only to interpret those facts.
Enforce the requested entity type, medium (e.g. board game vs video game), actor, and time scope.
Do not turn an unsupported summary assertion into evidence. If support is insufficient or conflicting, return status "insufficient".
Give the shortest sufficient answer, preserving qualifications.
Output ONLY a valid JSON object matching this schema:
{
  "answers": {
    "<item_id>": {
      "status": "answered" | "insufficient",
      "answer": "<concise answer string>",
      "usedGeneralKnowledge": boolean
    }
  }
}
Do not include markdown codeblocks or conversational filler.`

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize)
    const validChunkIds = new Set(chunk.map(it => it.id))

    const itemMap = {}
    for (const it of chunk) {
      itemMap[it.id] = {
        question: it.question,
        evidence: (it.evidence || '').slice(0, 800),
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

    try {
      const sessionId = `locomo-system2-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'x-opencode-session': sessionId,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.warn(`[System2Resolver] API error ${res.status}: ${errText}`)
        continue
      }

      const data = await res.json()
      const contentStr = data.choices?.[0]?.message?.content
      if (contentStr) {
        let parsed = {}
        try {
          parsed = JSON.parse(contentStr)
        }
        catch {
          // Attempt to extract JSON substring if wrapped in markdown
          const jsonMatch = contentStr.match(/\{[\s\S]*\}/)
          if (jsonMatch)
            parsed = JSON.parse(jsonMatch[0])
        }

        const answers = parsed.answers || parsed

        for (const [id, val] of Object.entries(answers)) {
          // Reject cross-chunk or unrequested IDs
          if (!validChunkIds.has(id))
            continue

          if (typeof val === 'string' && val.trim().length > 0) {
            results[id] = val.trim()
          }
          else if (val && typeof val === 'object') {
            if (val.status !== 'insufficient' && typeof val.answer === 'string' && val.answer.trim().length > 0) {
              results[id] = val.answer.trim()
            }
          }
        }
      }
    }
    catch (err) {
      console.warn(`[System2Resolver] Error during batch resolution: ${err.message}`)
    }
  }

  return results
}
