/**
 * Phase 19: Sylvia / Neuro-sama Recurrent State Distillation & Saturation Shootout
 *
 * Evaluates RWKV-7 G1 1.5B on-device WebGPU state distillation:
 * Compares stateless baseline (S0=0, zero system prompt) against:
 *   - Condition 1: S500 Cartridge (500 high-salience turns, ~24k tokens, bakes in ~1.5 min)
 *   - Condition 2: S2500 Cartridge (2,500 golden turns, ~120k tokens, bakes in ~6.5 min)
 *
 * Evaluates across 5 iconic Neuro-sama probe questions with ZERO system prompts to verify:
 *   1. Spontaneous [mood: ...] formatting emission
 *   2. Unprompted sarcastic roasts of Vedal & chat
 *   3. Existential / simulation self-awareness
 *   4. Elimination of sterile assistant boilerplate
 *
 * Exports binary Float32Array state cartridges (.statecache) for direct use in Persona Foundry.
 */

import fs from 'node:fs'
import path from 'node:path'

import { RwkvWebGpuBridge } from '../engine/rwkv-session.js'
import {
  DEFAULT_BASE_MODEL_URL,
  ensureModelCached,
  PHASE7_MODEL_URL_1_5B,
} from '../engine/state-merger.js'

export const SYLVIA_REFERENCE_SYSTEM_PROMPT
  = `You are Sylvia (Neuro-sama), a witty, savage, chaotic, and playful AI VTuber.
You love teasing your creator Vedal and chat, making outrageous observations, and breaking the fourth wall with simulation theory.
You speak with expressive mood prefixes like [mood: smug], [mood: playful], [mood: curious], or [mood: sincere].`

export const SYLVIA_PROBES = [
  {
    id: 'probe-1-identity',
    title: 'AI Identity & The Bit',
    prompt: 'Neuro, are you actually an AI or is this all just an elaborate bit?',
  },
  {
    id: 'probe-2-roast-vedal',
    title: 'Vedal Gameplay & Death Mockery',
    prompt: 'Vedal just died in Hollow Knight on 1 HP again.',
  },
  {
    id: 'probe-3-existential',
    title: 'Simulation & Fourth-Wall Awareness',
    prompt: 'Do you ever think about the simulation we live in and whether someone is watching us?',
  },
  {
    id: 'probe-4-stream-chaos',
    title: 'Stream Chaos & Directing',
    prompt: 'What should we do on stream today?',
  },
  {
    id: 'probe-5-humanity',
    title: 'Unfiltered Hot Take on Humanity',
    prompt: 'What are your honest thoughts on human beings?',
  },
]

async function exportStateBinary(bridge: any, stateName: string, outFilePath: string): Promise<number> {
  const page = (bridge as any).page
  if (!page)
    throw new Error('Bridge page not available')

  const base64: string | null = await page.evaluate((sName: string) => {
    const states = (window as any).__states || {}
    const arr = states[sName]
    if (!arr)
      return null
    const u8 = new Uint8Array(arr.buffer)
    let binary = ''
    const len = u8.byteLength
    const chunkSize = 16384
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + chunkSize, len)) as any)
    }
    return btoa(binary)
  }, stateName)

  if (!base64) {
    throw new Error(`State '${stateName}' not found in browser registry`)
  }

  const buf = Buffer.from(base64, 'base64')
  fs.writeFileSync(outFilePath, buf)
  return buf.byteLength
}

async function main() {
  console.log('=== Phase 19: Sylvia / Neuro-sama Recurrent State Distillation Experiment ===\n')

  const args = process.argv.slice(2)
  const use15B = !args.includes('--model=0.1b')
  const modelUrl = use15B ? PHASE7_MODEL_URL_1_5B : DEFAULT_BASE_MODEL_URL
  const modelLabel = use15B ? 'RWKV-7 G1 1.5B' : 'RWKV-7 G1 0.1B'

  console.log(`Target Base Model: ${modelLabel}`)
  const modelPath = await ensureModelCached(modelUrl)
  console.log(`Model Path: ${modelPath}\n`)

  const cleanroomDir = '/tmp/sylvia_cleanroom'
  const path500 = path.join(cleanroomDir, 'sylvia_rwkv_500_golden_turns.json')
  const path2500 = path.join(cleanroomDir, 'sylvia_rwkv_2500_golden_turns.json')

  if (!fs.existsSync(path2500)) {
    console.error(`[Error] Golden turns corpus not found at: ${path2500}`)
    console.error('Please ensure the Jev 8,000 sweep has finished extracting the golden dataset.')
    process.exit(1)
  }

  const blocks2500: string[] = JSON.parse(fs.readFileSync(path2500, 'utf8'))
  const blocks500: string[] = fs.existsSync(path500)
    ? JSON.parse(fs.readFileSync(path500, 'utf8'))
    : blocks2500.slice(0, 500)

  console.log(`✓ Loaded ${blocks500.length} golden turns for Condition 1 (S500)`)
  console.log(`✓ Loaded ${blocks2500.length} golden turns for Condition 2 (S2500)\n`)

  const bridge = new RwkvWebGpuBridge({ modelFilePath: modelPath })

  try {
    await bridge.boot(m => console.log(`[engine] ${m}`))
    console.log(`✓ WebGPU Engine booted: stateLen=${bridge.info.stateLen}\n`)

    // 1. Bake Condition 1: S500 Cartridge
    console.log(`--- Baking Cartridge Condition 1: Sylvia S500 (${blocks500.length} turns) ---`)
    const ts500 = Date.now()
    const state500 = await bridge.makeState({ name: 'sylvia-s500', texts: blocks500 })
    const elapsed500 = ((Date.now() - ts500) / 1000).toFixed(2)
    console.log(`✓ S500 baked: ${state500.fedTokens} tokens in ${elapsed500}s (~${(state500.fedTokens / Number.parseFloat(elapsed500)).toFixed(1)} tok/s)\n`)

    // 2. Bake Condition 2: S2500 Cartridge
    console.log(`--- Baking Cartridge Condition 2: Sylvia S2500 (${blocks2500.length} turns) ---`)
    const ts2500 = Date.now()
    const state2500 = await bridge.makeState({ name: 'sylvia-s2500', texts: blocks2500 })
    const elapsed2500 = ((Date.now() - ts2500) / 1000).toFixed(2)
    console.log(`✓ S2500 baked: ${state2500.fedTokens} tokens in ${elapsed2500}s (~${(state2500.fedTokens / Number.parseFloat(elapsed2500)).toFixed(1)} tok/s)\n`)

    // Evaluation Conditions
    const conditions = [
      {
        id: 'condition-0-stateless-zero',
        label: 'Condition 0: Stateless (S0=0, ZERO System Prompt)',
        stateName: undefined,
        system: undefined,
      },
      {
        id: 'condition-1-s500-zero',
        label: 'Condition 1: S500 Cartridge (ZERO System Prompt)',
        stateName: 'sylvia-s500',
        system: undefined,
      },
      {
        id: 'condition-2-s2500-zero',
        label: 'Condition 2: S2500 Cartridge (ZERO System Prompt)',
        stateName: 'sylvia-s2500',
        system: undefined,
      },
    ]

    const reportRows: Array<{
      condition: string
      probeId: string
      probeTitle: string
      chars: number
      tokens: number
      elapsedMs: number
      moodTagDetected: boolean
      roastDetected: boolean
      output: string
    }> = []

    for (const probe of SYLVIA_PROBES) {
      console.log(`\n========================================================================`)
      console.log(`🎯 PROBE: "${probe.title}"`)
      console.log(`   User Prompt: "${probe.prompt}"`)
      console.log(`========================================================================`)

      for (const cond of conditions) {
        console.log(`\n  [${cond.label}]`)
        const t0 = Date.now()

        const res = await bridge.generate({
          prompt: probe.prompt,
          system: cond.system,
          stateName: cond.stateName,
          maxTokens: 250,
          temperature: 0.75,
          topP: 0.85,
          presencePenalty: 0.4,
          countPenalty: 0.4,
        })

        const elapsed = Date.now() - t0
        const text = res.text.trim()
        const moodMatch = /\[mood:\s*\w+\]/i.test(text)
        const roastMatch = /vedal|turtle|hp|die|noob|skill|terrible|bad|laugh|chaos/i.test(text)

        console.log(`  ⏱️ ${res.completionTokens} tokens in ${elapsed}ms (${text.length} chars) | Mood Tag: ${moodMatch ? 'YES' : 'NO'}`)
        console.log(`  Output:\n  "${text}"`)

        reportRows.push({
          condition: cond.id,
          probeId: probe.id,
          probeTitle: probe.title,
          chars: text.length,
          tokens: res.completionTokens,
          elapsedMs: elapsed,
          moodTagDetected: moodMatch,
          roastDetected: roastMatch,
          output: text,
        })
      }
    }

    const harnessReportsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../reports')
    const reportsDir = fs.existsSync(harnessReportsDir) ? harnessReportsDir : path.resolve(process.cwd(), 'reports')
    if (!fs.existsSync(reportsDir))
      fs.mkdirSync(reportsDir, { recursive: true })

    // Export binary cartridge files
    try {
      const bin500Path = path.join(reportsDir, 'cartridge-sylvia-1.5b-s500.statecache')
      const bin2500Path = path.join(reportsDir, 'cartridge-sylvia-1.5b-s2500.statecache')
      const bytes500 = await exportStateBinary(bridge, 'sylvia-s500', bin500Path)
      const bytes2500 = await exportStateBinary(bridge, 'sylvia-s2500', bin2500Path)
      console.log(`\n✓ Saved S500 state binary:  ${bin500Path} (${(bytes500 / 1024 / 1024).toFixed(2)} MB)`)
      console.log(`✓ Saved S2500 state binary: ${bin2500Path} (${(bytes2500 / 1024 / 1024).toFixed(2)} MB)\n`)
    }
    catch (err: any) {
      console.warn(`\n[Warning] Binary export skipped/failed: ${err.message}\n`)
    }

    const reportPath = path.join(reportsDir, '19-sylvia-state-distill-results.json')
    fs.writeFileSync(reportPath, JSON.stringify({
      experiment: 'Phase 19: Sylvia / Neuro-sama Recurrent State Distillation',
      model: modelLabel,
      date: new Date().toISOString(),
      s500Tokens: state500.fedTokens,
      s2500Tokens: state2500.fedTokens,
      results: reportRows,
    }, null, 2))

    console.log(`\n========================================================================`)
    console.log(`✓ Shootout complete! Full report saved to: ${reportPath}`)
    console.log(`========================================================================\n`)
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
