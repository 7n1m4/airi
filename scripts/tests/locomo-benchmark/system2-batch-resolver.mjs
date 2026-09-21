/**
 * Batched System-2 Deductive Concept Resolver.
 *
 * Dispatches Category 3 (Detective / Implication) questions where the answer
 * is not explicitly stated in conversational text to DeepSeek Flash via OpenCode Go.
 *
 * Uses structured JSON schema batched into a single HTTP request (up to 20 items / batch).
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

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize)
    const itemMap = {}
    for (const it of chunk) {
      itemMap[it.id] = {
        question: it.question,
        evidence: (it.evidence || '').slice(0, 500),
      }
    }

    const payload = {
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a concise deductive reader. For each item in the input batch, infer the unstated concept, game name, medical condition, entity, or deductive conclusion from conversational clues. Output ONLY a valid JSON object matching this schema: {"answers": {"<item_id>": "<concise 1-4 word answer>"}}. Do not include conversational filler or explanations.',
        },
        {
          role: 'user',
          content: JSON.stringify(itemMap),
        },
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
        const parsed = JSON.parse(contentStr)
        const ans = parsed.answers || parsed
        for (const [k, v] of Object.entries(ans)) {
          if (typeof v === 'string') {
            results[k] = v.trim()
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
