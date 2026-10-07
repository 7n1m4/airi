/**
 * Jev System-1 Sylvia / Neuro-sama Definitive 8,000-Turn Sweep
 *
 * Samples 8,000 candidate turns evenly across all 631 session files in /tmp/sylvia_cleanroom/sessions/.
 * Uses refined taxonomy with 'existential_meta' and preserved 'other_distinct' catch-all.
 * Ranks non-filler turns to extract:
 *   1. Top 2,500 Golden Turns -> /tmp/sylvia_cleanroom/sylvia_rwkv_2500_golden_turns.json
 *   2. Top 500 Golden Turns   -> /tmp/sylvia_cleanroom/sylvia_rwkv_500_golden_turns.json
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
        instructions: 'Is this response an iconic, memorable, high-personality Neuro-sama turn — including witty banter, savage roasts, existential/AI self-awareness, fourth-wall breaks, unhinged chaos, or iconic stream moments?',
      },
      category: {
        type: 'choice',
        instructions: 'Which category best captures this response?',
        criteria: {
          roast_vedal: 'Roasting, teasing, or playfully mocking Vedal, chat, or gaming skill/death',
          unhinged_chaos: 'Outrageous, unhinged, absurd, or bizarre chaotic statement',
          witty_banter: 'Sharp, sarcastic, playful, or funny banter',
          existential_meta: 'Fourth-wall breaks, AI sentience, simulation theory, creator/Lifting lore, or eerie self-awareness',
          cute_affection: 'Sweet, affectionate, wholesome, or endearing interaction',
          filler_routine: 'Trivial acknowledgment, simple confirmation, routine navigation directions, or generic short reply',
          other_distinct: 'Any other distinct interaction, quirky topic, deep monologue, or unexpected edge behavior',
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
  console.log('=== Sylvia / Neuro-sama Definitive 8,000-Turn Jev Sweep ===\n')

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

  // Sample evenly across all 631 session files to gather 8,000 candidate turns
  const targetCount = 8000
  const candidates: CandidateTurn[] = []
  const perFile = Math.ceil(targetCount / files.length) // ~13 per file

  for (const file of files) {
    if (candidates.length >= targetCount)
      break
    const content = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf8'))
    const msgs = content.messages || []
    const title = content.meta?.title || file
    let foundInFile = 0

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

  console.log(`Gathered ${candidates.length} turns evenly distributed across ${files.length} sessions (~${(candidates.length / files.length).toFixed(1)} per session).`)
  console.log('Dispatching parallel classification to TypeSafe Jev (concurrency = 12)...\n')

  const results: ClassifiedTurn[] = []
  const concurrency = 12
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
    if (completed % 100 === 0 || completed === candidates.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      const qps = (completed / (Date.now() - startTime) * 1000).toFixed(1)
      process.stdout.write(`\rProgress: ${completed}/${candidates.length} (${qps} req/s, ${elapsed}s elapsed)...`)
    }
  }

  const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n\n✓ Finished classifying ${results.length} turns in ${totalTimeSec}s!`)

  // Save raw report
  const reportDir = path.resolve('scripts/tests/rwkv-harness/reports')
  if (!fs.existsSync(reportDir))
    fs.mkdirSync(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, '19-sylvia-jev-8000-sweep-results.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`✓ Full results saved to: ${reportPath}\n`)

  // Aggregate Category Breakdown
  const catCounts: Record<string, number> = {}
  for (const r of results) {
    catCounts[r.category] = (catCounts[r.category] || 0) + 1
  }

  console.log('========================================================================')
  console.log('📊 CATEGORY DISTRIBUTION (Across 8,000 Turns):')
  console.log('========================================================================')
  for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / results.length) * 100).toFixed(1)
    console.log(` • ${cat.padEnd(18)}: ${count.toString().padStart(4)} turns (${pct}%)`)
  }

  // Filter out filler_routine
  const nonFiller = results.filter(r => r.category !== 'filler_routine')
  console.log(`\nFiltered out ${results.length - nonFiller.length} routine/filler turns. ${nonFiller.length} high-signal turns remain.`)

  // Rank by iconicScore descending
  nonFiller.sort((a, b) => b.iconicScore - a.iconicScore)

  // Extract Top 2,500 and Top 500
  const top2500 = nonFiller.slice(0, 2500)
  const top500 = nonFiller.slice(0, 500)

  const cutoff2500Score = top2500[top2500.length - 1]?.iconicScore ?? 0
  const cutoff500Score = top500[top500.length - 1]?.iconicScore ?? 0

  console.log(`\n✓ Top 2,500 Selection Cutoff Score: ${cutoff2500Score.toFixed(3)}`)
  console.log(`✓ Top 500 Selection Cutoff Score:   ${cutoff500Score.toFixed(3)}`)

  // Format into RWKV conditioning blocks
  const blocks2500 = top2500.map(t => `User: ${t.targetUser}\n\nAssistant: ${t.targetAssistant}\n\n`)
  const blocks500 = top500.map(t => `User: ${t.targetUser}\n\nAssistant: ${t.targetAssistant}\n\n`)

  const out2500Path = '/tmp/sylvia_cleanroom/sylvia_rwkv_2500_golden_turns.json'
  const out500Path = '/tmp/sylvia_cleanroom/sylvia_rwkv_500_golden_turns.json'

  fs.writeFileSync(out2500Path, JSON.stringify(blocks2500, null, 2), 'utf8')
  fs.writeFileSync(out500Path, JSON.stringify(blocks500, null, 2), 'utf8')

  console.log(`✓ Saved 2,500 golden conditioning blocks to: ${out2500Path}`)
  console.log(`✓ Saved 500 golden conditioning blocks to:   ${out500Path}`)

  // Top 5 Highest Iconic Turns overall
  console.log('\n========================================================================')
  console.log('🏆 TOP 5 HIGHEST-RATED TURNS OVERALL:')
  console.log('========================================================================')
  for (const item of nonFiller.slice(0, 5)) {
    console.log(`\nScore: ${item.iconicScore.toFixed(2)} | Category: [${item.category}]`)
    console.log(`User:      "${item.targetUser}"`)
    console.log(`Assistant: "${item.targetAssistant}"`)
  }

  // Sample top turns from existential_meta
  const metaTurns = nonFiller.filter(t => t.category === 'existential_meta').slice(0, 3)
  if (metaTurns.length > 0) {
    console.log('\n========================================================================')
    console.log('🌌 TOP 3 EXISTENTIAL / META TURNS:')
    console.log('========================================================================')
    for (const item of metaTurns) {
      console.log(`\nScore: ${item.iconicScore.toFixed(2)} | [${item.batchTitle}]`)
      console.log(`User:      "${item.targetUser}"`)
      console.log(`Assistant: "${item.targetAssistant}"`)
    }
  }
}

main().catch(console.error)
