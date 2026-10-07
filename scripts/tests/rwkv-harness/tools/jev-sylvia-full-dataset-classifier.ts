/**
 * Jev System-1 Sylvia / Neuro-sama Full Dataset Classifier (62,000 Turns)
 *
 * Exhaustively classifies, scores, and categorizes every single turn in the
 * 631 Sylvia sessions archive using TypeSafe Jev System-1 (~$0.40 total).
 *
 * Features:
 *   - Deduplication: Reads prior sweep reports and skips already-classified turns.
 *   - Resume Safety: Streams results incrementally to JSONL so it can resume after any interrupt.
 *   - Rate-Limit Backoff: Exponential backoff on HTTP 429.
 *   - Live Metrics: Reports completed count, QPS, elapsed time, ETA, and live cost in USD.
 *   - Final Export: Compiles full annotated JSON + JSONL ready to share back with the dataset curator.
 */

import fs from 'node:fs'
import path from 'node:path'

function resolveApiKey(): string {
  if (process.env.OPENROUTER_API_KEY)
    return process.env.OPENROUTER_API_KEY
  const credPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../credentials.json')
  if (fs.existsSync(credPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'))
      if (creds.openrouter?.apiKey)
        return creds.openrouter.apiKey
    }
    catch {}
  }
  throw new Error('Missing OPENROUTER_API_KEY environment variable or credentials.json configuration.')
}

const API_KEY = resolveApiKey()
const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions'

interface CandidateTurn {
  id: string
  sessionFile: string
  batchTitle: string
  turnIndex: number
  context: string[]
  targetUser: string
  targetAssistant: string
}

interface ClassifiedTurn extends CandidateTurn {
  iconicScore: number
  category: string
  confidence: number
}

async function classifyTurnWithRetry(turn: CandidateTurn, retries = 5): Promise<ClassifiedTurn | null> {
  const contextStr = turn.context.join('\n')
  const state = `Context:\n${contextStr}\n\nUser: ${turn.targetUser}\nTarget Line:\n${turn.targetAssistant}`

  const body = {
    state,
    model: 'typesafe/jev-1.13',
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
          'HTTP-Referer': 'https://github.com/dasilva333/airi',
          'X-Title': 'AIRI System 1 Coprocessor',
        },
        body: JSON.stringify(body),
      })

      if (resp.status === 429) {
        const delay = 1000 * 1.5 ** attempt + Math.random() * 500
        await new Promise(r => setTimeout(r, delay))
        continue
      }

      if (!resp.ok) {
        const errText = await resp.text()
        console.warn(`\n[Jev Error HTTP ${resp.status}]:`, errText)
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
        console.warn('\n[Jev Network Error]:', err.message)
        return null
      }
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }

  return null
}

async function main() {
  console.log('========================================================================')
  console.log('🚀 SYLVIA / NEURO-SAMA FULL DATASET JEV SYSTEM-1 CLASSIFIER (62k TURNS)')
  console.log('========================================================================\n')

  const sessionDir = '/tmp/sylvia_cleanroom/sessions'
  if (!fs.existsSync(sessionDir)) {
    console.error(`Missing directory: ${sessionDir}`)
    process.exit(1)
  }

  const outputDir = '/tmp/sylvia_cleanroom/dataset_classified'
  if (!fs.existsSync(outputDir))
    fs.mkdirSync(outputDir, { recursive: true })

  const jsonlPath = path.join(outputDir, 'sylvia_full_classified_stream.jsonl')
  const finalJsonPath = path.join(outputDir, 'sylvia_full_classified_dataset.json')

  // 1. Load any previously classified IDs to skip duplicates
  const existingMap = new Map<string, ClassifiedTurn>()

  // Check JSONL cache first
  if (fs.existsSync(jsonlPath)) {
    const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const item: ClassifiedTurn = JSON.parse(line)
        if (item.id)
          existingMap.set(item.id, item)
      }
      catch {}
    }
    console.log(`✓ Loaded ${existingMap.size} turns from existing progress JSONL`)
  }

  // Also import earlier sweep report if present
  const sweep8kPath = path.resolve('scripts/tests/rwkv-harness/reports/19-sylvia-jev-8000-sweep-results.json')
  if (fs.existsSync(sweep8kPath)) {
    try {
      const pastSweep: ClassifiedTurn[] = JSON.parse(fs.readFileSync(sweep8kPath, 'utf8'))
      for (const item of pastSweep) {
        if (!existingMap.has(item.id)) {
          existingMap.set(item.id, item)
          fs.appendFileSync(jsonlPath, `${JSON.stringify(item)}\n`, 'utf8')
        }
      }
      console.log(`✓ Imported previous 8k sweep results. Total cached: ${existingMap.size}`)
    }
    catch {}
  }

  // 2. Discover all turns across all 631 session files
  const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'))
  files.sort((a, b) => {
    const numA = Number.parseInt(a.replace(/\D/g, '') || '0', 10)
    const numB = Number.parseInt(b.replace(/\D/g, '') || '0', 10)
    return numA - numB
  })

  console.log(`Scanning ${files.length} session files for eligible user/assistant pairs...`)

  const queue: CandidateTurn[] = []

  for (const file of files) {
    const content = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf8'))
    const msgs = content.messages || []
    const title = content.meta?.title || file

    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].role === 'user' && msgs[i + 1].role === 'assistant') {
        const u = msgs[i].content?.trim()
        const a = msgs[i + 1].content?.trim()

        if (u && a && u.length >= 3 && a.length >= 3) {
          const id = `${file}_${i}`
          if (!existingMap.has(id)) {
            const contextStart = Math.max(0, i - 4)
            const context = msgs.slice(contextStart, i).map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)

            queue.push({
              id,
              sessionFile: file,
              batchTitle: title,
              turnIndex: i,
              context,
              targetUser: u,
              targetAssistant: a,
            })
          }
        }
      }
    }
  }

  console.log(`Found total remaining turns to classify: ${queue.length}`)
  console.log(`Already classified & skipped:           ${existingMap.size}`)
  console.log(`Total dataset turns:                     ${queue.length + existingMap.size}\n`)

  if (queue.length === 0) {
    console.log('✓ All turns have already been classified! Compiling final dataset...')
    compileFinalDataset(Array.from(existingMap.values()), finalJsonPath)
    return
  }

  // 3. Dispatch parallel classification
  const concurrency = 14
  console.log(`Dispatching parallel workers (concurrency = ${concurrency})...`)

  const jsonlStream = fs.createWriteStream(jsonlPath, { flags: 'a', encoding: 'utf8' })
  const startTime = Date.now()
  let completedThisRun = 0
  const totalToRun = queue.length

  for (let i = 0; i < queue.length; i += concurrency) {
    const chunk = queue.slice(i, i + concurrency)
    const chunkRes = await Promise.all(chunk.map(t => classifyTurnWithRetry(t)))

    for (const r of chunkRes) {
      if (r) {
        existingMap.set(r.id, r)
        jsonlStream.write(`${JSON.stringify(r)}\n`)
      }
    }

    completedThisRun += chunk.length
    if (completedThisRun % 50 === 0 || completedThisRun === totalToRun) {
      const elapsedSec = (Date.now() - startTime) / 1000
      const qps = (completedThisRun / elapsedSec)
      const remainingItems = totalToRun - completedThisRun
      const etaMin = (remainingItems / (qps || 1) / 60).toFixed(1)
      const totalTokensEst = (existingMap.size * 170)
      const costUsd = (totalTokensEst / 1_000_000_000 * 42).toFixed(3)

      process.stdout.write(
        `\rProgress: ${completedThisRun}/${totalToRun} (${((completedThisRun / totalToRun) * 100).toFixed(1)}%) `
        + `| QPS: ${qps.toFixed(1)} | ETA: ${etaMin}m | Total Classified: ${existingMap.size} | Est Cost: $${costUsd}`,
      )
    }
  }

  jsonlStream.end()
  const totalElapsedMin = ((Date.now() - startTime) / 1000 / 60).toFixed(2)
  console.log(`\n\n✓ Classification sweep completed in ${totalElapsedMin} minutes!`)

  // 4. Compile final artifacts
  compileFinalDataset(Array.from(existingMap.values()), finalJsonPath)
}

function compileFinalDataset(allResults: ClassifiedTurn[], finalJsonPath: string) {
  console.log(`\nCompiling master dataset for ${allResults.length} turns...`)

  // Category counts
  const catCounts: Record<string, number> = {}
  for (const r of allResults) {
    catCounts[r.category] = (catCounts[r.category] || 0) + 1
  }

  console.log('========================================================================')
  console.log('📊 COMPLETE DATASET CATEGORY DISTRIBUTION:')
  console.log('========================================================================')
  for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / allResults.length) * 100).toFixed(1)
    console.log(` • ${cat.padEnd(18)}: ${count.toString().padStart(6)} turns (${pct}%)`)
  }

  // Filter out filler_routine
  const nonFiller = allResults.filter(r => r.category !== 'filler_routine')
  nonFiller.sort((a, b) => b.iconicScore - a.iconicScore)

  console.log(`\n✓ Non-filler golden turns available: ${nonFiller.length} (${((nonFiller.length / allResults.length) * 100).toFixed(1)}%)`)

  // Export clean master JSON
  fs.writeFileSync(finalJsonPath, JSON.stringify(allResults, null, 2), 'utf8')
  console.log(`✓ Master dataset saved: ${finalJsonPath} (${(fs.statSync(finalJsonPath).size / 1024 / 1024).toFixed(2)} MB)`)

  // Export curated golden tiers for RWKV state cartridges
  const cleanroomDir = '/tmp/sylvia_cleanroom'
  const tiers = [
    { name: 'sylvia_rwkv_500_golden_turns.json', count: 500 },
    { name: 'sylvia_rwkv_2500_golden_turns.json', count: 2500 },
    { name: 'sylvia_rwkv_5000_golden_turns.json', count: 5000 },
    { name: 'sylvia_rwkv_10000_golden_turns.json', count: 10000 },
  ]

  for (const tier of tiers) {
    if (nonFiller.length >= tier.count) {
      const blocks = nonFiller.slice(0, tier.count).map(t => `User: ${t.targetUser}\n\nAssistant: ${t.targetAssistant}\n\n`)
      const tierPath = path.join(cleanroomDir, tier.name)
      fs.writeFileSync(tierPath, JSON.stringify(blocks, null, 2), 'utf8')
      console.log(`✓ Exported ${tier.count} golden pack to: ${tierPath}`)
    }
  }

  console.log('\n========================================================================')
  console.log('🎉 Full dataset classification and export complete!')
  console.log('========================================================================\n')
}

main().catch(console.error)
