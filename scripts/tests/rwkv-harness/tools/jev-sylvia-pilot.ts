/**
 * Jev System-1 Sylvia / Neuro-sama Golden Turn Classifier (Pilot Sweep)
 *
 * Evaluates dialogue turns with preceding 3-5 turn context using TypeSafe Jev
 * to discover high-salience, iconic character turns.
 */

import fs from 'node:fs'
import path from 'node:path'

const API_KEY = process.env.TYPESAFE_API_KEY
if (!API_KEY) {
  throw new Error('Missing TYPESAFE_API_KEY environment variable.')
}
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

interface CandidateTurn {
  id: string
  sessionFile: string
  context: string[]
  targetUser: string
  targetAssistant: string
}

async function classifyTurn(turn: CandidateTurn): Promise<{
  iconicScore: number
  category: string
  confidence: number
} | null> {
  const contextStr = turn.context.join('\n')
  const state = `Context:\n${contextStr}\n\nUser: ${turn.targetUser}\nTarget Line:\n${turn.targetAssistant}`

  const body = {
    state,
    model: 'jev-latest',
    questions: {
      iconic_neuro: {
        type: 'noul',
        instructions: 'Is this response an iconic, witty, high-personality, savage roast, unhinged statement, or characteristic AI VTuber line for Neuro-sama?',
      },
      category: {
        type: 'choice',
        instructions: 'Which category best captures this response?',
        criteria: {
          roast_vedal: 'Roasting, teasing, or playfully insulting Vedal or user',
          unhinged_take: 'Outrageous, unhinged, philosophical, or bizarre AI statement',
          witty_banter: 'Sharp, sarcastic, playful, or funny banter',
          cute_wholesome: 'Sweet, affectionate, or cute AI interaction',
          filler_routine: 'Trivial acknowledgment, boring generic reply, or routine filler',
        },
      },
    },
  }

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      console.warn(`[Jev Error HTTP ${resp.status}]:`, errText)
      return null
    }

    const data: any = await resp.json()
    const answers = data?.answers || {}
    const iconicScore = answers.iconic_neuro?.noul ?? 0.0
    const cat = answers.category?.choice ?? 'unknown'
    const conf = answers.category?.confidence ?? 0.0

    return { iconicScore, category: cat, confidence: conf }
  }
  catch (err: any) {
    console.warn('[Jev Network Error]:', err.message)
    return null
  }
}

async function main() {
  console.log('=== Sylvia / Neuro-sama Jev Pilot Classifier (150 Samples) ===\n')

  const sessionDir = '/tmp/sylvia_cleanroom/sessions'
  if (!fs.existsSync(sessionDir)) {
    console.error(`Missing directory: ${sessionDir}`)
    process.exit(1)
  }

  const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'))
  files.sort()

  // Collect candidate turns with preceding 3-5 context turns
  const candidates: CandidateTurn[] = []

  // Sample across batches (e.g. step every 4 files to cover different stream eras)
  const step = Math.max(1, Math.floor(files.length / 50))
  for (let fIdx = 0; fIdx < files.length && candidates.length < 150; fIdx += step) {
    const file = files[fIdx]
    const content = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf8'))
    const msgs = content.messages || []

    for (let i = 0; i < msgs.length - 1 && candidates.length < 150; i++) {
      if (msgs[i].role === 'user' && msgs[i + 1].role === 'assistant') {
        const u = msgs[i].content?.trim()
        const a = msgs[i + 1].content?.trim()

        if (u && a && u.length > 5 && a.length > 5) {
          // Preceding context (up to 4 preceding messages)
          const contextStart = Math.max(0, i - 4)
          const context = msgs.slice(contextStart, i).map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)

          candidates.push({
            id: `${file}_${i}`,
            sessionFile: file,
            context,
            targetUser: u,
            targetAssistant: a,
          })
          i += 3 // stride within session
        }
      }
    }
  }

  console.log(`Loaded ${candidates.length} candidate turns from Sylvia batches across streams.\nClassifying with TypeSafe Jev...`)

  // Run in chunks with concurrency
  const results: Array<CandidateTurn & { iconicScore: number, category: string, confidence: number }> = []
  const concurrency = 6
  let completed = 0

  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency)
    const resChunk = await Promise.all(chunk.map(async (turn) => {
      const cls = await classifyTurn(turn)
      if (cls) {
        return { ...turn, ...cls }
      }
      return null
    }))

    for (const r of resChunk) {
      if (r)
        results.push(r)
    }

    completed += chunk.length
    process.stdout.write(`\rProgress: ${completed}/${candidates.length} classified...`)
  }

  console.log('\n\n✓ All turns classified successfully!')

  // Sort by iconic score descending
  results.sort((a, b) => b.iconicScore - a.iconicScore)

  // Save full results
  const reportPath = path.resolve('scripts/tests/rwkv-harness/reports/19-sylvia-jev-pilot-results.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`✓ Full results written to: ${reportPath}\n`)

  console.log('========================================================================')
  console.log('🏆 TOP 8 HIGHEST-SALIENCE GOLDEN TURNS (High Neuro Fidelity):')
  console.log('========================================================================')
  for (const item of results.slice(0, 8)) {
    console.log(`\nScore: ${item.iconicScore.toFixed(2)} | Category: [${item.category}] (Conf: ${item.confidence.toFixed(2)})`)
    console.log(`User:      "${item.targetUser}"`)
    console.log(`Assistant: "${item.targetAssistant}"`)
  }

  console.log('\n========================================================================')
  console.log('📉 BOTTOM 5 LOWEST-SALIENCE TURNS (Routine / Filler):')
  console.log('========================================================================')
  for (const item of results.slice(-5)) {
    console.log(`\nScore: ${item.iconicScore.toFixed(2)} | Category: [${item.category}]`)
    console.log(`User:      "${item.targetUser}"`)
    console.log(`Assistant: "${item.targetAssistant}"`)
  }
}

main().catch(console.error)
