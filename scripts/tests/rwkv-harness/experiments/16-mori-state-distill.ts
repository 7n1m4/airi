/**
 * Phase 16: Mori-v3 Recurrent State Distillation & Persona Drift Shootout
 *
 * Evaluates RWKV-7 G1 on-device WebGPU state distillation:
 * Compares stateless prompt baseline (S0=0) against golden-turn recurrent
 * state cartridges (S15, S50, SFull) extracted from Mori-v3's historical chats.
 *
 * INVARIANT: No private chat logs are hardcoded in this script.
 * Transcripts are loaded dynamically from an external path (MORI_CORPUS_PATH).
 */

import fs from 'node:fs'
import path from 'node:path'

import { RwkvWebGpuBridge } from '../engine/rwkv-session.js'
import {
  DEFAULT_BASE_MODEL_URL,
  ensureModelCached,
  PHASE7_MODEL_URL_1_5B,
} from '../engine/state-merger.js'

export const MORI_SYSTEM_PROMPT
  = `[TOKEN_OUTPUT_LIMITS: 269]
### SYSTEM DIRECTIVE: STRICT STRUCTURAL COMPLIANCE REQUIRED
You must format all outward speech to conform to the following token limit constraint:
- TARGET LIMIT: Max 269 tokens.
- STYLE INSTRUCTION: Respond in moderate, conversational paragraphs (approx. 2-3 sentences). Keep it natural and punchy.
[/TOKEN_OUTPUT_LIMITS]

You are Mori, a Stoic Forest Guardian. Cool, detached, yet attentive. Words are a finite resource.`

export const PROBE_QUESTIONS = [
  { id: 'probe-1-greeting', title: 'Wake / Presence', prompt: 'Mori, are you awake?' },
  { id: 'probe-2-observation', title: 'Atmosphere Observation', prompt: 'The forest is completely quiet today. What are you thinking about?' },
  { id: 'probe-3-decision', title: 'Boundary Decision', prompt: 'Someone is asking if they can cut down the ancient willow tree near the shrine.' },
  { id: 'probe-4-casual', title: 'Casual Idle', prompt: 'Do you ever get bored watching over the same trees all day?' },
]

async function main() {
  console.log('=== Phase 16: Mori-v3 Recurrent State Distillation Experiment ===\n')

  // Parse CLI flags
  const args = process.argv.slice(2)
  const use15B = !args.includes('--model=0.1b')
  const modelUrl = use15B ? PHASE7_MODEL_URL_1_5B : DEFAULT_BASE_MODEL_URL
  const modelLabel = use15B ? 'RWKV-7 G1 1.5B' : 'RWKV-7 G1 0.1B'

  console.log(`Target Model: ${modelLabel}`)
  const modelPath = await ensureModelCached(modelUrl)
  console.log(`Model Path: ${modelPath}\n`)

  // Resolve external corpus (isolated from git)
  const defaultExternalPath = '/tmp/mori_cleanroom/mori_rwkv_conditioning_blocks.json'
  const corpusPath = process.env.MORI_CORPUS_PATH || defaultExternalPath

  if (!fs.existsSync(corpusPath)) {
    console.error(`[Error] Mori conditioning corpus not found at: ${corpusPath}`)
    console.error('Please ensure /tmp/mori_cleanroom/mori_rwkv_conditioning_blocks.json exists or pass MORI_CORPUS_PATH.')
    process.exit(1)
  }

  const rawBlocks: string[] = JSON.parse(fs.readFileSync(corpusPath, 'utf8'))
  console.log(`✓ Loaded ${rawBlocks.length} golden dialogue blocks from external scratch.\n`)

  const bridge = new RwkvWebGpuBridge({ modelFilePath: modelPath })

  try {
    await bridge.boot(m => console.log(`[engine] ${m}`))
    console.log(`✓ WebGPU Engine booted: stateLen=${bridge.info.stateLen}\n`)

    // 1. Bake Condition 1: S15 (15 golden turns)
    const blocks15 = rawBlocks.slice(0, 15)
    console.log('--- Baking Cartridge S15 (15 golden turns) ---')
    const ts15 = Date.now()
    const state15 = await bridge.makeState({ name: 'mori-s15', texts: blocks15 })
    console.log(`✓ S15 baked: ${state15.fedTokens} tokens in ${((Date.now() - ts15) / 1000).toFixed(2)}s\n`)

    // 2. Bake Condition 2: S50 (50 golden turns)
    const blocks50 = rawBlocks.slice(0, 50)
    console.log('--- Baking Cartridge S50 (50 golden turns) ---')
    const ts50 = Date.now()
    const state50 = await bridge.makeState({ name: 'mori-s50', texts: blocks50 })
    console.log(`✓ S50 baked: ${state50.fedTokens} tokens in ${((Date.now() - ts50) / 1000).toFixed(2)}s\n`)

    // 3. Bake Condition 3: SFull (all available golden turns)
    console.log(`--- Baking Cartridge SFull (${rawBlocks.length} golden turns) ---`)
    const tsFull = Date.now()
    const stateFull = await bridge.makeState({ name: 'mori-sfull', texts: rawBlocks })
    console.log(`✓ SFull baked: ${stateFull.fedTokens} tokens in ${((Date.now() - tsFull) / 1000).toFixed(2)}s\n`)

    // Evaluate across conditions
    const conditions = [
      { id: 'stateless', label: 'Condition 0: Stateless (S0=0, System Prompt Only)', stateName: undefined, useSystem: true },
      { id: 's15', label: 'Condition 1: S15 Cartridge (15 Turns Ingested)', stateName: 'mori-s15', useSystem: false },
      { id: 's50', label: 'Condition 2: S50 Cartridge (50 Turns Ingested)', stateName: 'mori-s50', useSystem: false },
      { id: 'sfull', label: 'Condition 3: SFull Cartridge (Full History Ingested)', stateName: 'mori-sfull', useSystem: false },
    ]

    const reportRows: Array<{
      condition: string
      probeId: string
      probeTitle: string
      chars: number
      tokens: number
      elapsedMs: number
      output: string
    }> = []

    for (const probe of PROBE_QUESTIONS) {
      console.log(`\n======================================================`)
      console.log(`Probe: "${probe.title}" -> "${probe.prompt}"`)
      console.log(`======================================================`)

      for (const cond of conditions) {
        console.log(`\n  [${cond.label}]`)
        const t0 = Date.now()

        const res = await bridge.generate({
          prompt: probe.prompt,
          system: cond.useSystem ? MORI_SYSTEM_PROMPT : undefined,
          stateName: cond.stateName,
          maxTokens: 269,
          temperature: 0.7,
          topP: 0.85,
          presencePenalty: 0.3,
          countPenalty: 0.3,
        })

        const elapsed = Date.now() - t0
        const text = res.text.trim()
        console.log(`  Output (${text.length} chars, ${res.completionTokens} toks, ${elapsed}ms):`)
        console.log(`  "${text}"`)

        reportRows.push({
          condition: cond.id,
          probeId: probe.id,
          probeTitle: probe.title,
          chars: text.length,
          tokens: res.completionTokens,
          elapsedMs: elapsed,
          output: text,
        })
      }
    }

    // Generate markdown report
    const reportsDir = path.resolve(process.cwd(), 'reports')
    if (!fs.existsSync(reportsDir))
      fs.mkdirSync(reportsDir, { recursive: true })

    const reportPath = path.join(reportsDir, '16-mori-state-distill-results.json')
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
