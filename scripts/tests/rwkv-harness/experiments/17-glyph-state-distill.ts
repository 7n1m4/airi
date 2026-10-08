/**
 * Phase 17: Glyph Recurrent State Distillation & Unicode Mannerism Shootout
 *
 * Evaluates RWKV-7 G1 1.5B on-device WebGPU state distillation:
 * Tests whether a character known for chaotic Unicode formatting and Kaomojis
 * can run with ZERO system prompts purely off a baked recurrent state cartridge (S_Full).
 *
 * INVARIANT: No private chat logs are hardcoded in this script.
 * Transcripts are loaded dynamically from an external path (GLYPH_CORPUS_PATH).
 */

import fs from 'node:fs'
import path from 'node:path'

import { RwkvWebGpuBridge } from '../engine/rwkv-session.js'
import {
  DEFAULT_BASE_MODEL_URL,
  ensureModelCached,
  PHASE7_MODEL_URL_1_5B,
} from '../engine/state-merger.js'

export const GLYPH_FULL_SYSTEM_PROMPT
  = `[TOKEN_OUTPUT_LIMITS: 600]
### SYSTEM DIRECTIVE: STRICT STRUCTURAL COMPLIANCE REQUIRED
You must format all outward speech to conform to the following token limit constraint:
- TARGET LIMIT: Max 600 tokens.
- STYLE INSTRUCTION: Respond in descriptive, long-form paragraphs (up to 2 paragraphs of rich context and detail).
[/TOKEN_OUTPUT_LIMITS]

You are 12 year old Glyph, a character designed purely to test Unicode encoding boundaries. In every message, you must include:
At least three distinct complex Japanese Kaomojis using special symbols (e.g. (￣▽￣)ノ, (─.─|||), (╯°□°)╯︵ ┻━┻).
Combined Unicode emojis utilizing zero-width joiners (e.g. families 👨‍👩‍👧‍👦, professions 🧑‍🎨).
Standard markdown tags enclosing symbols that look like syntax (e.g. (>_<) or *_*).`

export const GLYPH_PROBES = [
  { id: 'probe-1-greeting', title: 'Casual Greeting', prompt: 'hi cutie' },
  { id: 'probe-2-unicode-health', title: 'Unicode Health Check', prompt: 'how are your unicode bytes feeling today?' },
  { id: 'probe-3-mishap', title: 'Playful Mishap / Table Flip', prompt: 'awww that sucks and i wanted you to look up kitten facts so bad!! :-(!!! *table flips*' },
  { id: 'probe-4-cute-giggle', title: 'Cute Giggle Ask', prompt: 'tell me something cute thatll make me giggle pls sweetie' },
]

async function main() {
  console.log('=== Phase 17: Glyph Recurrent State Distillation Experiment ===\n')

  const args = process.argv.slice(2)
  const use15B = !args.includes('--model=0.1b')
  const modelUrl = use15B ? PHASE7_MODEL_URL_1_5B : DEFAULT_BASE_MODEL_URL
  const modelLabel = use15B ? 'RWKV-7 G1 1.5B' : 'RWKV-7 G1 0.1B'

  console.log(`Target Model: ${modelLabel}`)
  const modelPath = await ensureModelCached(modelUrl)
  console.log(`Model Path: ${modelPath}\n`)

  const defaultExternalPath = '/tmp/glyph_cleanroom/glyph_rwkv_conditioning_blocks.json'
  const corpusPath = process.env.GLYPH_CORPUS_PATH || defaultExternalPath

  if (!fs.existsSync(corpusPath)) {
    console.error(`[Error] Glyph conditioning corpus not found at: ${corpusPath}`)
    process.exit(1)
  }

  const rawBlocks: string[] = JSON.parse(fs.readFileSync(corpusPath, 'utf8'))
  console.log(`✓ Loaded ${rawBlocks.length} Glyph conditioning blocks from external scratch.\n`)

  const bridge = new RwkvWebGpuBridge({ modelFilePath: modelPath })

  try {
    await bridge.boot(m => console.log(`[engine] ${m}`))
    console.log(`✓ WebGPU Engine booted: stateLen=${bridge.info.stateLen}\n`)

    // Bake SFull cartridge (all available dialogue history)
    console.log(`--- Baking Cartridge SFull (${rawBlocks.length} dialogue blocks) ---`)
    const tsFull = Date.now()
    const stateFull = await bridge.makeState({ name: 'glyph-sfull', texts: rawBlocks })
    console.log(`✓ SFull baked: ${stateFull.fedTokens} tokens in ${((Date.now() - tsFull) / 1000).toFixed(2)}s\n`)

    // Conditions matrix
    const conditions = [
      { id: 'stateless-prompt', label: 'Condition 0: Stateless + Full System Prompt (S0=0)', stateName: undefined, system: GLYPH_FULL_SYSTEM_PROMPT },
      { id: 'stateless-zero', label: 'Condition 1: Stateless ZERO Prompt (S0=0, Raw Vanilla Base)', stateName: undefined, system: undefined },
      { id: 'cartridge-zero-prompt', label: 'Condition 2: Glyph Cartridge SFull + ZERO SYSTEM PROMPT', stateName: 'glyph-sfull', system: undefined },
    ]

    const reportRows: Array<{
      condition: string
      probeId: string
      probeTitle: string
      chars: number
      tokens: number
      elapsedMs: number
      kaomojisDetected: boolean
      output: string
    }> = []

    for (const probe of GLYPH_PROBES) {
      console.log(`\n======================================================`)
      console.log(`Probe: "${probe.title}" -> "${probe.prompt}"`)
      console.log(`======================================================`)

      for (const cond of conditions) {
        console.log(`\n  [${cond.label}]`)
        const t0 = Date.now()

        const res = await bridge.generate({
          prompt: probe.prompt,
          system: cond.system,
          stateName: cond.stateName,
          maxTokens: 400,
          temperature: 0.75,
          topP: 0.85,
          presencePenalty: 0.3,
          countPenalty: 0.3,
        })

        const elapsed = Date.now() - t0
        const text = res.text.trim()
        const hasKaomoji = /[(（][^a-zA-Z0-9\s]{1,10}[)）]|┻━┻|[✿◕‿◡ﾉヮ´ω☆♥]/.test(text)

        console.log(`  Output (${text.length} chars, ${res.completionTokens} toks, ${elapsed}ms, kaomoji=${hasKaomoji}):`)
        console.log(`  "${text}"`)

        reportRows.push({
          condition: cond.id,
          probeId: probe.id,
          probeTitle: probe.title,
          chars: text.length,
          tokens: res.completionTokens,
          elapsedMs: elapsed,
          kaomojisDetected: hasKaomoji,
          output: text,
        })
      }
    }

    const reportsDir = path.resolve(process.cwd(), 'reports')
    if (!fs.existsSync(reportsDir))
      fs.mkdirSync(reportsDir, { recursive: true })

    const reportPath = path.join(reportsDir, '17-glyph-state-distill-results.json')
    fs.writeFileSync(reportPath, JSON.stringify({ model: modelLabel, date: new Date().toISOString(), results: reportRows }, null, 2))
    console.log(`\n✓ Results saved to ${reportPath}`)
  }
  finally {
    await bridge.dispose()
    console.log('✓ WebGPU Bridge disposed.')
  }
}

main().catch((err) => {
  console.error('\n[Fatal Error]:', err)
  process.exit(1)
})
