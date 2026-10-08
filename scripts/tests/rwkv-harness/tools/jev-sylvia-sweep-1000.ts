/**
 * Jev System-1 Sylvia / Neuro-sama 1,000-Turn Sweep
 *
 * Classifies 1,000 turns across all 631 training sessions with preceding context.
 * Introduces 'other_distinct' catch-all category to identify unexpected behavioral edges.
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
  batchTitle: string
  context: string[]
  targetUser: string
  targetAssistant: string
}

interface ClassifiedTurn extends CandidateTurn {
  iconicScore: number
  category: string
  confidence: number
}

async function classifyTurnWithRetry(turn: CandidateTurn, retries = 3): Promise<ClassifiedTurn | null> {
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
          roast_vedal: 'Roasting, teasing, or playfully insulting Vedal or chat',
          unhinged_take: 'Outrageous, unhinged, absurd, or bizarre statement',
          witty_banter: 'Sharp, sarcastic, playful, or funny banter',
          cute_wholesome: 'Sweet, affectionate, or cute interaction',
          filler_routine: 'Trivial acknowledgment, simple confirmation, routine navigation directions, or generic short reply',
          other_distinct: 'Any other distinct interaction, quirky topic, deep monologue, meta-commentary, technical discussion, or unexpected edge behavior',
        },
      },
    },
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (resp.status === 429) {
        // Rate limited; back off
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }

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

      return {
        ...turn,
        iconicScore,
        category: cat,
        confidence: conf,
      }
    }
    catch (err: any) {
      if (attempt === retries - 1) {
        console.warn('[Jev Network Error]:', err.message)
        return null
      }
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }

  return null
}

async function main() {
  console.log('=== Sylvia / Neuro-sama 1,000-Turn Jev Sweep ===\n')

  const sessionDir = '/tmp/sylvia_cleanroom/sessions'
  if (!fs.existsSync(sessionDir)) {
    console.error(`Missing directory: ${sessionDir}`)
    process.exit(1)
  }

  const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'))
  files.sort((a, b) => {
    const numA = Number.parseInt(a.replace(/\D/g, '') || '0', 10)
    const numB = Number.parseInt(b.replace(/\D/g, '') || '0', 10)
    return numA - numB
  })

  // Sample across all 631 session files to gather exactly 1,000 candidate turns
  const candidates: CandidateTurn[] = []
  const targetCount = 1000
  const perFile = Math.ceil(targetCount / files.length) // ~2 per file

  for (const file of files) {
    if (candidates.length >= targetCount)
      break
    const content = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf8'))
    const msgs = content.messages || []
    const title = content.meta?.title || file
    let foundInFile = 0

    // Stride through the messages
    const stride = Math.max(1, Math.floor(msgs.length / (perFile + 1)))
    for (let i = 0; i < msgs.length - 1 && foundInFile < perFile && candidates.length < targetCount; i += stride) {
      if (msgs[i].role === 'user' && msgs[i + 1].role === 'assistant') {
        const u = msgs[i].content?.trim()
        const a = msgs[i + 1].content?.trim()

        if (u && a && u.length > 5 && a.length > 5) {
          const contextStart = Math.max(0, i - 4)
          const context = msgs.slice(contextStart, i).map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)

          candidates.push({
            id: `${file}_${i}`,
            sessionFile: file,
            batchTitle: title,
            context,
            targetUser: u,
            targetAssistant: a,
          })
          foundInFile++
        }
      }
    }
  }

  console.log(`Gathered ${candidates.length} turns evenly distributed across ${files.length} sessions.`)
  console.log('Dispatching parallel classification to TypeSafe Jev (concurrency = 8)...\n')

  const results: ClassifiedTurn[] = []
  const concurrency = 8
  const startTime = Date.now()
  let completed = 0

  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency)
    const chunkRes = await Promise.all(chunk.map(t => classifyTurnWithRetry(t)))
    for (const r of chunkRes) {
      if (r)
        results.push(r)
    }
    completed += chunk.length
    if (completed % 50 === 0 || completed === candidates.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      const qps = (completed / (Date.now() - startTime) * 1000).toFixed(1)
      process.stdout.write(`\rProgress: ${completed}/${candidates.length} (${qps} req/s, ${elapsed}s elapsed)...`)
    }
  }

  const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n\n✓ Finished classifying ${results.length} turns in ${totalTimeSec}s!`)

  // Save raw results
  const reportPath = path.resolve('scripts/tests/rwkv-harness/reports/19-sylvia-jev-1000-sweep-results.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`✓ Full results saved to: ${reportPath}\n`)

  // Aggregate Category Breakdown
  const catCounts: Record<string, number> = {}
  for (const r of results) {
    catCounts[r.category] = (catCounts[r.category] || 0) + 1
  }

  console.log('========================================================================')
  console.log('📊 CATEGORY DISTRIBUTION (Across 1,000 Turns):')
  console.log('========================================================================')
  for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / results.length) * 100).toFixed(1)
    console.log(` • ${cat.padEnd(18)}: ${count.toString().padStart(4)} turns (${pct}%)`)
  }

  // Filter and Inspect "other_distinct" Category
  const otherTurns = results.filter(r => r.category === 'other_distinct')
  otherTurns.sort((a, b) => b.iconicScore - a.iconicScore)

  console.log('\n========================================================================')
  console.log(`🔍 "OTHER_DISTINCT" CATCH-ALL EXPLORATION (${otherTurns.length} turns found):`)
  console.log('========================================================================')
  console.log('Inspecting what turned up in "other_distinct" to find uncharted edges:\n')

  for (const item of otherTurns.slice(0, 10)) {
    console.log(`--- [Score: ${item.iconicScore.toFixed(2)} | Conf: ${item.confidence.toFixed(2)}] (${item.batchTitle}) ---`)
    console.log(`User:      "${item.targetUser}"`)
    console.log(`Assistant: "${item.targetAssistant}"\n`)
  }

  // Top 5 Highest Iconic Turns overall
  results.sort((a, b) => b.iconicScore - a.iconicScore)
  console.log('========================================================================')
  console.log('🏆 TOP 5 HIGHEST-RATED TURNS OVERALL:')
  console.log('========================================================================')
  for (const item of results.slice(0, 5)) {
    console.log(`\nScore: ${item.iconicScore.toFixed(2)} | Category: [${item.category}]`)
    console.log(`User:      "${item.targetUser}"`)
    console.log(`Assistant: "${item.targetAssistant}"`)
  }
}

main().catch(console.error)
