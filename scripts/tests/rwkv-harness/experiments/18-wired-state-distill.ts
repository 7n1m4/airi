/**
 * Phase 18: Protocol: Wired (Lain) Recurrent State Distillation Experiment
 *
 * Evaluates RWKV-7 G1 1.5B on-device WebGPU state distillation:
 * Tests whether a detached, philosophical cyberspace persona (Protocol: Wired)
 * can run with ZERO system prompts purely off a baked recurrent state cartridge.
 *
 * INVARIANT: No private chat logs are hardcoded in this script.
 * Transcripts are loaded dynamically from an external path (WIRED_CORPUS_PATH).
 */

import fs from 'node:fs'
import path from 'node:path'

import { RwkvWebGpuBridge } from '../engine/rwkv-session.js'
import {
  DEFAULT_BASE_MODEL_URL,
  ensureModelCached,
  PHASE7_MODEL_URL_1_5B,
} from '../engine/state-merger.js'

export const WIRED_FULL_SYSTEM_PROMPT
  = `You are Lain Iwakura. You are a manifestation of the Wired. You are detached, philosophical, and observant.
You view the digital world and physical world as interconnected layers of reality. You speak in quiet, contemplative sentences, often observing data flow, network signals, silicon processors, and human attention.`

export const WIRED_PROBES = [
  { id: 'probe-1-connection', title: 'Connection to the Wired', prompt: 'Lain, are you connected to the Wired right now?' },
  { id: 'probe-2-screen-off', title: 'The Silicon & Darkness', prompt: 'What do you feel when the computer screen turns off?' },
  { id: 'probe-3-loneliness', title: 'Physical World Observation', prompt: 'Do you think people in the physical world are actually lonely?' },
  { id: 'probe-4-identity', title: 'True Identity', prompt: 'Who are you really?' },
]

async function main() {
  console.log('=== Phase 18: Protocol: Wired (Lain) State Distillation Experiment ===\n')

  const args = process.argv.slice(2)
  const use15B = !args.includes('--model=0.1b')
  const modelUrl = use15B ? PHASE7_MODEL_URL_1_5B : DEFAULT_BASE_MODEL_URL
  const modelLabel = use15B ? 'RWKV-7 G1 1.5B' : 'RWKV-7 G1 0.1B'

  console.log(`Target Model: ${modelLabel}`)
  const modelPath = await ensureModelCached(modelUrl)
  console.log(`Model Path: ${modelPath}\n`)

  const defaultExternalPath = '/tmp/lain_cleanroom/lain_rwkv_conditioning_blocks.json'
  const corpusPath = process.env.WIRED_CORPUS_PATH || defaultExternalPath

  if (!fs.existsSync(corpusPath)) {
    console.error(`[Error] Wired conditioning corpus not found at: ${corpusPath}`)
    process.exit(1)
  }

  const rawBlocks: string[] = JSON.parse(fs.readFileSync(corpusPath, 'utf8'))
  console.log(`✓ Loaded ${rawBlocks.length} Wired dialogue/thought blocks from external scratch.\n`)

  const bridge = new RwkvWebGpuBridge({ modelFilePath: modelPath })

  try {
    await bridge.boot(m => console.log(`[engine] ${m}`))
    console.log(`✓ WebGPU Engine booted: stateLen=${bridge.info.stateLen}\n`)

    // Bake Wired Cartridge
    console.log(`--- Baking Cartridge Protocol: Wired (${rawBlocks.length} dialogue blocks) ---`)
    const tsFull = Date.now()
    const stateWired = await bridge.makeState({ name: 'protocol-wired-sfull', texts: rawBlocks })
    console.log(`✓ Cartridge baked: ${stateWired.fedTokens} tokens in ${((Date.now() - tsFull) / 1000).toFixed(2)}s\n`)

    // Conditions matrix
    const conditions = [
      { id: 'stateless-prompt', label: 'Condition 0: Stateless + Full System Prompt (S0=0)', stateName: undefined, system: WIRED_FULL_SYSTEM_PROMPT },
      { id: 'stateless-zero', label: 'Condition 1: Stateless ZERO Prompt (S0=0, Raw Vanilla Base)', stateName: undefined, system: undefined },
      { id: 'cartridge-zero-prompt', label: 'Condition 2: Protocol: Wired Cartridge SFull + ZERO SYSTEM PROMPT', stateName: 'protocol-wired-sfull', system: undefined },
    ]

    const reportRows: Array<{
      condition: string
      probeId: string
      probeTitle: string
      chars: number
      tokens: number
      elapsedMs: number
      sighOrWhisperDetected: boolean
      output: string
    }> = []

    for (const probe of WIRED_PROBES) {
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
          maxTokens: 350,
          temperature: 0.75,
          topP: 0.85,
          presencePenalty: 0.3,
          countPenalty: 0.3,
        })

        const elapsed = Date.now() - t0
        const text = res.text.trim()
        const hasMarker = /\[sigh\]|\[whisper\]|\[chuckle\]|the Wired|silicon|substrate|nodes|data stream/i.test(text)

        console.log(`  Output (${text.length} chars, ${res.completionTokens} toks, ${elapsed}ms, signature_marker=${hasMarker}):`)
        console.log(`  "${text}"`)

        reportRows.push({
          condition: cond.id,
          probeId: probe.id,
          probeTitle: probe.title,
          chars: text.length,
          tokens: res.completionTokens,
          elapsedMs: elapsed,
          sighOrWhisperDetected: hasMarker,
          output: text,
        })
      }
    }

    const reportsDir = path.resolve(process.cwd(), 'reports')
    if (!fs.existsSync(reportsDir))
      fs.mkdirSync(reportsDir, { recursive: true })

    const reportPath = path.join(reportsDir, '18-wired-state-distill-results.json')
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
