#!/usr/bin/env tsx
/**
 * Nan0 Headless CLI & Test Harness
 *
 * Full headless execution, state mocking, and failure simulation harness
 * for the Nan0 cognition runtime.
 *
 * Usage:
 *   pnpm test:nan0 --input "hey nano" --user "Richie" --role owner
 *   pnpm test:nan0 --input "hi" --simulate timeout
 *   pnpm test:nan0 --scenario ./fixtures/example-scenario.json
 *   pnpm test:nan0 --repl
 */

import type {
  Nan0KernelState,
  Nan0Observation,
  Nan0PreparedTurn,
  Nan0ReasoningClient,
  Nan0ReasoningRequest,
  Nan0ReasoningResult,
  Nan0SystemOneProvider,
} from '../src/types'

import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'

import { Nan0Kernel } from '../src/kernel/Nan0Kernel'
import { InMemoryStateStore } from '../src/persistence/InMemoryStateStore'
import { formatSystemOnePromptState } from '../src/shadow/Nan0ShadowTypes'
import { SystemNan0Clock } from '../src/temporal/Nan0Clock'
import { NAN0_DEFAULT_THOUGHT_POLICY } from '../src/thought/Nan0ThoughtPolicy'

// --- Environment Loading ---
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../../..')

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> }
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(ROOT_DIR, '.env'),
  ]

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('='))
          continue
        const [k, ...v] = trimmed.split('=')
        const key = k.trim()
        const val = v.join('=').replace(/^["']|["']$/g, '').trim()
        if (key && !env[key]) {
          env[key] = val
        }
      }
    }
  }
  return env
}

const ENV = loadEnv()
const OPENCODE_BASE_URL = (ENV.OPENCODE_BASE_URL || 'https://opencode.ai/zen/go/v1/').replace(/\/+$/, '')
const OPENCODE_API_KEY = ENV.OPENCODE_API_KEY || ''
const OPENCODE_MODEL = 'deepseek-v4-flash' // Strictly pinned per requirement

const TYPESAFE_BASE_URL = ENV.TYPESAFE_BASE_URL || 'https://api.typesafe.ai/v1/systemone'
const TYPESAFE_API_KEY = ENV.TYPESAFE_API_KEY || ''
const TYPESAFE_MODEL = ENV.TYPESAFE_MODEL || 'jev-latest'

// --- Color Helpers ---
const isTTY = process.stdout.isTTY
const c = {
  reset: isTTY ? '\x1B[0m' : '',
  bold: isTTY ? '\x1B[1m' : '',
  dim: isTTY ? '\x1B[2m' : '',
  green: isTTY ? '\x1B[32m' : '',
  yellow: isTTY ? '\x1B[33m' : '',
  blue: isTTY ? '\x1B[34m' : '',
  magenta: isTTY ? '\x1B[35m' : '',
  cyan: isTTY ? '\x1B[36m' : '',
  red: isTTY ? '\x1B[31m' : '',
  gray: isTTY ? '\x1B[90m' : '',
}

// --- Provider Clients ---
function createOpenCodeReasoningClient(options: {
  apiKey: string
  baseUrl: string
  model: string
  sessionId?: string
}): Nan0ReasoningClient {
  return {
    async generate(request: Nan0ReasoningRequest): Promise<Nan0ReasoningResult> {
      const messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }> = []
      if (request.system) {
        messages.push({ role: 'system', content: request.system })
      }
      messages.push(...request.messages)

      const res = await fetch(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.apiKey}`,
          'x-opencode-session': options.sessionId || crypto.randomUUID(),
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          thinking: { type: 'disabled' },
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 1500,
        }),
        signal: request.signal,
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`OpenCode API error (${res.status}): ${errorText}`)
      }

      const data = await res.json() as any
      const choice = data.choices?.[0]
      const text = choice?.message?.content || ''
      if (process.env.DEBUG_THOUGHT) {
        console.log('\n[DEBUG_THOUGHT RAW OUTPUT]:\n', text, '\n[END DEBUG_THOUGHT]\n')
      }
      return {
        text,
        finishReason: choice?.finish_reason,
      }
    },
  }
}

function createTypeSafeSystemOneProvider(options: {
  apiKey: string
  baseUrl?: string
  model?: string
}): Nan0SystemOneProvider {
  const endpoint = options.baseUrl || 'https://api.typesafe.ai/v1/systemone'
  const defaultModel = options.model || 'jev-latest'

  return async (state: string | object, questions: Record<string, any>, model = defaultModel) => {
    let statePayload: string
    if (typeof state === 'string') {
      statePayload = state
    }
    else if (state && typeof state === 'object' && typeof (state as any).toPromptString === 'function') {
      statePayload = (state as any).toPromptString()
    }
    else if (state && typeof state === 'object' && 'target_turn' in state) {
      statePayload = formatSystemOnePromptState(state as any)
    }
    else {
      statePayload = JSON.stringify(state)
    }

    const t0 = performance.now()
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        state: statePayload,
        questions,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[TypeSafe AI] API error ${res.status}: ${errText}`)
    }

    const data = await res.json() as any
    const latencyMs = Math.round(performance.now() - t0)

    const normalizedAnswers: Record<string, { choice: string, confidence?: number, probabilities?: Record<string, number> }> = {}
    for (const [k, ans] of Object.entries(data.answers || {})) {
      const answerObj = ans as any
      normalizedAnswers[k] = {
        choice: answerObj.choice || '',
        confidence: answerObj.confidence,
        probabilities: answerObj.probabilities,
      }
    }

    return {
      answers: normalizedAnswers,
      model,
      latencyMs,
    }
  }
}

function createSimulatedReasoningClient(simulation: string): Nan0ReasoningClient {
  return {
    async generate(_req: Nan0ReasoningRequest): Promise<Nan0ReasoningResult> {
      if (simulation === 'timeout') {
        // Sleep 5 seconds to simulate provider hang
        await new Promise(resolve => setTimeout(resolve, 5000))
        return { text: '' }
      }
      if (simulation === 'offline') {
        throw new Error('500 Service Unavailable from simulation gateway')
      }
      if (simulation === 'malformed-thought') {
        return {
          text: 'I am thinking about the user input without an extraction payload or delimiter.',
          finishReason: 'stop',
        }
      }
      if (simulation === 'generic-filter') {
        return {
          text: `Thinking through generic response.\n---EXTRACT---\n${JSON.stringify({
            interpretation: 'Routine conversational response.',
            privateText: 'I understand. As an AI assistant, I am here to help you.',
            decision: 'SPEAK',
            speakability: 0.9,
            confidence: 0.9,
            mood: 'neutral',
            reasonCodes: ['interaction.reply'],
            actionIntent: null,
            waitUntil: null,
            goalSignal: null,
            intentionSignal: null,
          })}`,
          finishReason: 'stop',
        }
      }
      throw new Error(`Unknown simulation mode: ${simulation}`)
    },
  }
}

// Default fallback mock reasoning client when no API key is provided
function createDefaultMockReasoningClient(): Nan0ReasoningClient {
  return {
    async generate(request: Nan0ReasoningRequest): Promise<Nan0ReasoningResult> {
      const isSecondHop = request.system.includes('Respond only with Nan0\'s outward expression')
      if (isSecondHop) {
        return {
          text: 'I hear you. Let\'s see where things go from here.',
          finishReason: 'stop',
        }
      }
      return {
        text: `Nan0 considers the statement from the user.\n---EXTRACT---\n${JSON.stringify({
          interpretation: 'The statement warrants a measured response.',
          privateText: 'I am tracking this exchange with deliberate focus.',
          decision: 'SPEAK',
          speakability: 0.85,
          confidence: 0.9,
          mood: 'deliberate',
          reasonCodes: ['interaction.reply'],
          actionIntent: null,
          waitUntil: null,
          goalSignal: null,
          intentionSignal: null,
        })}`,
        finishReason: 'stop',
      }
    },
  }
}

// --- Harness Options ---
export interface HarnessTurnInput {
  input: string
  user?: string
  role?: 'owner' | 'stranger'
  setEmotions?: Record<string, number>
  simulate?: 'timeout' | 'malformed-thought' | 'generic-filter' | 'offline'
  stateFile?: string
  dumpFile?: string
  json?: boolean
}

export interface ScenarioTurn {
  input: string
  actor?: string
  role?: 'owner' | 'stranger'
  simulate?: 'timeout' | 'malformed-thought' | 'generic-filter' | 'offline'
  expect?: {
    reflex?: string | string[]
    decision?: 'SPEAK' | 'SILENCE' | 'WAIT' | 'ACT'
    mood?: string
  }
}

export interface ScenarioFile {
  name: string
  description?: string
  initialState?: {
    owner?: string
    emotions?: Record<string, number>
    stateFile?: string
  }
  turns: ScenarioTurn[]
}

// --- Turn Executor ---
export async function executeHarnessTurn(
  kernel: Nan0Kernel,
  reasoningClient: Nan0ReasoningClient,
  turnInput: HarnessTurnInput,
): Promise<{
  prepared: Nan0PreparedTurn
  outwardSpeech: string | null
  stateAfter: Nan0KernelState
  durationMs: number
}> {
  const t0 = performance.now()
  const actorName = turnInput.user || 'Richie'
  const actorId = actorName.toLowerCase().replace(/\s+/g, '_')
  const isOwner = turnInput.role !== 'stranger'

  const observation: Nan0Observation = {
    id: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    source: 'chat',
    actorId,
    displayName: actorName,
    content: turnInput.input,
    timestamp: Date.now(),
    metadata: {
      actorKind: isOwner ? 'owner' : 'stranger',
    },
  }

  const prepared = await kernel.prepareTurn(observation)
  let outwardSpeech: string | null = null

  if (prepared.decision.finalDecision === 'SPEAK' && prepared.decision.allowed && prepared.systemContext) {
    try {
      const outwardRes = await reasoningClient.generate({
        system: prepared.systemContext,
        messages: [{ role: 'user', content: turnInput.input }],
        maxTokens: 500,
      })
      outwardSpeech = outwardRes.text.trim()

      await kernel.recordAssistantTurn({
        turnId: prepared.turnId,
        thoughtId: prepared.thoughtId,
        decisionId: prepared.decision.decisionId,
        content: outwardSpeech,
        rawContent: outwardSpeech,
        timestamp: Date.now(),
      })
    }
    catch (err: any) {
      outwardSpeech = `[Outward generation error: ${err.message}]`
      await kernel.failTurn({
        turnId: prepared.turnId,
        thoughtId: prepared.thoughtId,
        error: err.message,
      })
    }
  }

  const durationMs = Math.round(performance.now() - t0)
  const stateAfter = kernel.getStateSnapshot()

  if (turnInput.dumpFile) {
    fs.writeFileSync(path.resolve(process.cwd(), turnInput.dumpFile), JSON.stringify(stateAfter, null, 2), 'utf8')
  }

  return { prepared, outwardSpeech, stateAfter, durationMs }
}

// --- Output Printer ---
function printTurnReport(result: {
  turnInput: HarnessTurnInput
  prepared: Nan0PreparedTurn
  outwardSpeech: string | null
  stateBeforeEmotions?: Record<string, number>
  stateAfter: Nan0KernelState
  durationMs: number
}) {
  const { turnInput, prepared, outwardSpeech, stateBeforeEmotions, stateAfter, durationMs } = result

  console.log(`\n${c.cyan}${c.bold}══════════════════════════════════════════════════════════════════${c.reset}`)
  console.log(`${c.cyan}${c.bold} Nan0 Turn Evaluation ${c.gray}(${durationMs}ms)${c.reset}`)
  console.log(`${c.cyan}${c.bold}══════════════════════════════════════════════════════════════════${c.reset}`)

  // 1. Observation
  console.log(`${c.bold}[1. Observation]${c.reset}`)
  const roleBadge = turnInput.role === 'stranger' ? `${c.yellow}[Stranger]${c.reset}` : `${c.green}[Owner]${c.reset}`
  console.log(`  Speaker: ${c.bold}${turnInput.user || 'Richie'}${c.reset} ${roleBadge}`)
  console.log(`  Content: "${c.bold}${turnInput.input}${c.reset}"`)

  // 2. System 1 Reflex
  console.log(`\n${c.bold}[2. System 1 Reflex]${c.reset}`)
  if (prepared.reflexOutcome) {
    const srcColor = prepared.reflexOutcome.source === 'system_one_jev' ? c.green : c.yellow
    console.log(`  Group:   ${c.bold}${prepared.reflexOutcome.group}${c.reset} (choice: ${prepared.reflexOutcome.choice})`)
    console.log(`  Source:  ${srcColor}${prepared.reflexOutcome.source}${c.reset}${prepared.reflexOutcome.confidence ? ` (conf: ${(prepared.reflexOutcome.confidence * 100).toFixed(0)}%)` : ''}`)
  }
  else {
    console.log(`  ${c.dim}No reflex triggered (neutral / baseline)${c.reset}`)
  }

  // 3. Emotional Dynamics
  console.log(`\n${c.bold}[3. Emotional Dynamics]${c.reset}`)
  const mood = stateAfter.emotionalHistory.lastComputedMood || 'neutral'
  console.log(`  Primary Mood: ${c.magenta}${c.bold}${mood}${c.reset}`)
  const emoEntries = Object.entries(stateAfter.emotionalState).slice(0, 8)
  const emoDeltas: string[] = []
  for (const [k, v] of emoEntries) {
    const prev = stateBeforeEmotions?.[k] ?? 0.5
    const delta = v - prev
    if (Math.abs(delta) >= 0.01) {
      const sign = delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)
      emoDeltas.push(`${k}: ${v.toFixed(2)} (${sign})`)
    }
  }
  if (emoDeltas.length > 0) {
    console.log(`  Deltas:       ${c.yellow}${emoDeltas.join(', ')}${c.reset}`)
  }
  else {
    console.log(`  Vectors:      ${c.dim}${emoEntries.map(([k, v]) => `${k}:${v.toFixed(2)}`).join(' ')}${c.reset}`)
  }

  // 4. 1st LLM Thought
  console.log(`\n${c.bold}[4. Thought Engine (1st LLM)]${c.reset}`)
  const thoughtStatusColor = prepared.thought.status === 'valid' || prepared.thought.status === 'generated' ? c.green : c.red
  console.log(`  Status:         ${thoughtStatusColor}${prepared.thought.status}${c.reset}`)
  if (prepared.thought.narrative) {
    console.log(`  Narrative:      ${c.dim}"${prepared.thought.narrative.slice(0, 160)}${prepared.thought.narrative.length > 160 ? '...' : ''}"${c.reset}`)
  }
  if (prepared.thought.privateText) {
    console.log(`  Private Thought:${c.cyan} "${prepared.thought.privateText}"${c.reset}`)
  }
  if (prepared.thought.interpretation) {
    console.log(`  Interpretation: "${prepared.thought.interpretation}"`)
  }
  if (prepared.thought.status === 'failed' || prepared.thought.extractionStatus === 'failed') {
    console.log(`  ${c.red}Failure / Extraction Error: ${JSON.stringify(prepared.thought.metadata.error || 'Unknown failure')}${c.reset}`)
  }

  // 5. Decision Engine
  console.log(`\n${c.bold}[5. Decision Engine]${c.reset}`)
  const decColor = prepared.decision.finalDecision === 'SPEAK' ? c.green : prepared.decision.finalDecision === 'SILENCE' ? c.yellow : c.blue
  console.log(`  Decision:       ${decColor}${c.bold}${prepared.decision.finalDecision}${c.reset} (Allowed: ${prepared.decision.allowed})`)
  console.log(`  Speakability:   ${prepared.decision.speakability.toFixed(2)}`)
  if (prepared.decision.reasonCodes.length > 0) {
    console.log(`  Reason Codes:   ${c.dim}${prepared.decision.reasonCodes.join(', ')}${c.reset}`)
  }
  if (prepared.decision.suppressionReason) {
    console.log(`  Suppression:    ${c.yellow}${prepared.decision.suppressionReason}${c.reset}`)
  }

  // 6. Outward Expression
  if (outwardSpeech) {
    console.log(`\n${c.bold}[6. Outward Speech (2nd LLM)]${c.reset}`)
    console.log(`  Nan0: ${c.green}${c.bold}"${outwardSpeech}"${c.reset}`)
  }
  else if (prepared.decision.finalDecision === 'SILENCE') {
    console.log(`\n${c.bold}[6. Outward Speech]${c.reset}`)
    console.log(`  ${c.dim}(Nan0 chose silence — no outward expression emitted)${c.reset}`)
  }

  console.log(`${c.cyan}${c.bold}══════════════════════════════════════════════════════════════════${c.reset}\n`)
}

// --- Main CLI Entrypoint ---
async function main() {
  const args = parseArgs({
    options: {
      input: { type: 'string', short: 'i' },
      user: { type: 'string', short: 'u', default: 'Richie' },
      role: { type: 'string', short: 'r', default: 'owner' },
      set: { type: 'string', multiple: true },
      state: { type: 'string' },
      dump: { type: 'string' },
      simulate: { type: 'string' },
      scenario: { type: 'string', short: 's' },
      json: { type: 'boolean', default: false },
      repl: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  })

  if (args.values.help) {
    console.log(`
Nan0 Headless CLI & Test Harness

Usage:
  pnpm test:nan0 --input "message" [options]
  pnpm test:nan0 --scenario <path.json> [options]
  pnpm test:nan0 --repl

Options:
  -i, --input <text>        Observation text to process
  -u, --user <name>         Speaker display name (default: "Richie")
  -r, --role <owner|stranger> Speaker role authority (default: "owner")
  --set <key=value>         Manually set emotion vectors before the turn (e.g. --set irritation=0.8)
  --state <path.json>       Load initial state snapshot from JSON
  --dump <path.json>        Dump post-turn state snapshot to JSON
  --simulate <mode>         Failure simulation: timeout | malformed-thought | generic-filter | offline
  -s, --scenario <path.json> Replay a multi-turn scenario script
  --json                    Output pure JSON payload
  --repl                    Launch interactive REPL mode
  -h, --help                Show this help message
`)
    process.exit(0)
  }

  // Determine reasoning client (1st & 2nd LLM)
  let reasoningClient: Nan0ReasoningClient
  if (args.values.simulate) {
    reasoningClient = createSimulatedReasoningClient(args.values.simulate)
  }
  else if (OPENCODE_API_KEY) {
    reasoningClient = createOpenCodeReasoningClient({
      apiKey: OPENCODE_API_KEY,
      baseUrl: OPENCODE_BASE_URL,
      model: OPENCODE_MODEL,
    })
  }
  else {
    console.warn(`${c.yellow}Notice: OPENCODE_API_KEY not found in .env; using local mock reasoning client.${c.reset}`)
    reasoningClient = createDefaultMockReasoningClient()
  }

  // Determine System 1 Jev provider
  let systemOneProvider: Nan0SystemOneProvider | undefined
  if (args.values.simulate === 'offline') {
    systemOneProvider = async () => {
      throw new Error('500 Service Unavailable from simulation gateway')
    }
  }
  else if (TYPESAFE_API_KEY) {
    systemOneProvider = createTypeSafeSystemOneProvider({
      apiKey: TYPESAFE_API_KEY,
      baseUrl: TYPESAFE_BASE_URL,
      model: TYPESAFE_MODEL,
    })
  }

  // --- Scenario Mode ---
  if (args.values.scenario) {
    const scenarioPath = path.resolve(process.cwd(), args.values.scenario)
    if (!fs.existsSync(scenarioPath)) {
      console.error(`${c.red}Error: Scenario file not found: ${scenarioPath}${c.reset}`)
      process.exit(1)
    }

    const scenario: ScenarioFile = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'))
    console.log(`\n${c.bold}Running Scenario: ${scenario.name}${c.reset}`)
    if (scenario.description) {
      console.log(`${c.dim}${scenario.description}${c.reset}\n`)
    }

    const clock = new SystemNan0Clock()
    const store = new InMemoryStateStore()
    const ownerName = scenario.initialState?.owner || args.values.user || 'Richie'
    const ownerId = ownerName.toLowerCase().replace(/\s+/g, '_')

    const kernel = new Nan0Kernel({
      stateStore: store,
      reasoningClient,
      systemOneProvider,
      jevModel: TYPESAFE_MODEL,
      clock,
      identityOptions: { ownerId, ownerDisplayName: ownerName },
      thoughtPolicy: NAN0_DEFAULT_THOUGHT_POLICY,
    })
    await kernel.boot()

    // Apply initial emotions if defined
    if (scenario.initialState?.emotions) {
      const snap = kernel.getStateSnapshot()
      kernel.state = {
        ...snap,
        emotionalState: { ...snap.emotionalState, ...scenario.initialState.emotions },
      }
    }

    let turnIdx = 1
    let scenarioPass = true

    for (const turn of scenario.turns) {
      console.log(`${c.cyan}${c.bold}--- Turn ${turnIdx}/${scenario.turns.length} ---${c.reset}`)
      const clientForTurn = turn.simulate
        ? createSimulatedReasoningClient(turn.simulate)
        : reasoningClient

      const stateBefore = structuredClone(kernel.getStateSnapshot().emotionalState)
      const res = await executeHarnessTurn(kernel, clientForTurn, {
        input: turn.input,
        user: turn.actor || ownerName,
        role: turn.role || 'owner',
      })

      printTurnReport({
        turnInput: { input: turn.input, user: turn.actor || ownerName, role: turn.role || 'owner' },
        prepared: res.prepared,
        outwardSpeech: res.outwardSpeech,
        stateBeforeEmotions: stateBefore,
        stateAfter: res.stateAfter,
        durationMs: res.durationMs,
      })

      if (turn.expect) {
        if (turn.expect.reflex) {
          const expected = Array.isArray(turn.expect.reflex) ? turn.expect.reflex : [turn.expect.reflex]
          if (!expected.includes(res.prepared.reflexOutcome?.group || '')) {
            console.error(`${c.red}✖ Expectation failed: expected reflex "${expected.join(' | ')}", got "${res.prepared.reflexOutcome?.group}"${c.reset}`)
            scenarioPass = false
          }
        }
        if (turn.expect.decision && res.prepared.decision.finalDecision !== turn.expect.decision) {
          console.error(`${c.red}✖ Expectation failed: expected decision "${turn.expect.decision}", got "${res.prepared.decision.finalDecision}"${c.reset}`)
          scenarioPass = false
        }
      }

      turnIdx++
    }

    if (args.values.dump) {
      fs.writeFileSync(path.resolve(process.cwd(), args.values.dump), JSON.stringify(kernel.getStateSnapshot(), null, 2), 'utf8')
      console.log(`${c.green}Final state dumped to ${args.values.dump}${c.reset}`)
    }

    process.exit(scenarioPass ? 0 : 1)
  }

  // --- Initialize Kernel for One-Shot or REPL ---
  const clock = new SystemNan0Clock()
  const store = new InMemoryStateStore()
  const ownerName = args.values.user || 'Richie'
  const ownerId = ownerName.toLowerCase().replace(/\s+/g, '_')

  let initialKernelState: Nan0KernelState | undefined
  if (args.values.state) {
    const statePath = path.resolve(process.cwd(), args.values.state)
    if (fs.existsSync(statePath)) {
      initialKernelState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    }
    else {
      console.error(`${c.red}Error: State file not found: ${statePath}${c.reset}`)
      process.exit(1)
    }
  }

  const kernel = new Nan0Kernel({
    stateStore: store,
    reasoningClient,
    systemOneProvider,
    jevModel: TYPESAFE_MODEL,
    clock,
    createInitialState: initialKernelState ? () => initialKernelState! : undefined,
    identityOptions: { ownerId, ownerDisplayName: ownerName },
    thoughtPolicy: NAN0_DEFAULT_THOUGHT_POLICY,
  })
  await kernel.boot()

  // Apply manual --set emotion overrides
  if (args.values.set) {
    const snap = kernel.getStateSnapshot()
    const newEmotions = { ...snap.emotionalState }
    for (const item of args.values.set) {
      const [k, v] = item.split('=')
      if (k && v && !Number.isNaN(Number(v))) {
        newEmotions[k.trim()] = Number(v)
      }
    }
    kernel.state = {
      ...snap,
      emotionalState: newEmotions,
    }
  }

  // --- One-Shot Mode ---
  if (args.values.input) {
    const stateBefore = structuredClone(kernel.getStateSnapshot().emotionalState)
    const turnInput: HarnessTurnInput = {
      input: args.values.input,
      user: args.values.user,
      role: args.values.role as 'owner' | 'stranger',
      dumpFile: args.values.dump,
      json: args.values.json,
    }

    const res = await executeHarnessTurn(kernel, reasoningClient, turnInput)

    if (args.values.json) {
      console.log(JSON.stringify({
        input: turnInput.input,
        user: turnInput.user,
        role: turnInput.role,
        reflexOutcome: res.prepared.reflexOutcome,
        thought: res.prepared.thought,
        decision: res.prepared.decision,
        outwardSpeech: res.outwardSpeech,
        mood: res.stateAfter.emotionalHistory.lastComputedMood,
        emotionalState: res.stateAfter.emotionalState,
        durationMs: res.durationMs,
      }, null, 2))
    }
    else {
      printTurnReport({
        turnInput,
        prepared: res.prepared,
        outwardSpeech: res.outwardSpeech,
        stateBeforeEmotions: stateBefore,
        stateAfter: res.stateAfter,
        durationMs: res.durationMs,
      })
    }
    process.exit(0)
  }

  // --- REPL Mode ---
  console.log(`\n${c.cyan}${c.bold}Nan0 Headless REPL${c.reset} ${c.dim}(Model: ${OPENCODE_MODEL}, System 1: ${TYPESAFE_API_KEY ? 'TypeSafe Jev' : 'Local Reflex'})${c.reset}`)
  console.log(`${c.dim}Commands: /set <emotion>=<val> | /state | /actor <name> | /role <owner|stranger> | /dump <file> | /exit${c.reset}\n`)

  let currentUser = args.values.user || 'Richie'
  let currentRole: 'owner' | 'stranger' = (args.values.role as 'owner' | 'stranger') || 'owner'

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const promptUser = () => {
    const roleBadge = currentRole === 'owner' ? `${c.green}owner${c.reset}` : `${c.yellow}stranger${c.reset}`
    rl.question(`${c.bold}${currentUser}${c.reset} (${roleBadge}) > `, async (line) => {
      const input = line.trim()
      if (!input) {
        promptUser()
        return
      }

      if (input === '/exit' || input === '/quit') {
        rl.close()
        process.exit(0)
      }

      if (input === '/state') {
        const snap = kernel.getStateSnapshot()
        console.log(`\n${c.bold}Current State:${c.reset}`)
        console.log(`  Mood: ${c.magenta}${snap.emotionalHistory.lastComputedMood}${c.reset}`)
        console.log(`  Emotions:`, snap.emotionalState)
        promptUser()
        return
      }

      if (input.startsWith('/actor ')) {
        currentUser = input.replace('/actor ', '').trim()
        console.log(`${c.dim}Speaker changed to ${currentUser}${c.reset}`)
        promptUser()
        return
      }

      if (input.startsWith('/role ')) {
        const r = input.replace('/role ', '').trim()
        if (r === 'owner' || r === 'stranger') {
          currentRole = r
          console.log(`${c.dim}Role set to ${currentRole}${c.reset}`)
        }
        promptUser()
        return
      }

      if (input.startsWith('/set ')) {
        const expr = input.replace('/set ', '').trim()
        const [k, v] = expr.split('=')
        if (k && v && !Number.isNaN(Number(v))) {
          const snap = kernel.getStateSnapshot()
          kernel.state = {
            ...snap,
            emotionalState: { ...snap.emotionalState, [k.trim()]: Number(v) },
          }
          console.log(`${c.dim}Set emotion ${k.trim()} = ${v}${c.reset}`)
        }
        promptUser()
        return
      }

      if (input.startsWith('/dump ')) {
        const target = input.replace('/dump ', '').trim()
        fs.writeFileSync(path.resolve(process.cwd(), target), JSON.stringify(kernel.getStateSnapshot(), null, 2), 'utf8')
        console.log(`${c.green}State dumped to ${target}${c.reset}`)
        promptUser()
        return
      }

      const stateBefore = structuredClone(kernel.getStateSnapshot().emotionalState)
      try {
        const res = await executeHarnessTurn(kernel, reasoningClient, {
          input,
          user: currentUser,
          role: currentRole,
        })
        printTurnReport({
          turnInput: { input, user: currentUser, role: currentRole },
          prepared: res.prepared,
          outwardSpeech: res.outwardSpeech,
          stateBeforeEmotions: stateBefore,
          stateAfter: res.stateAfter,
          durationMs: res.durationMs,
        })
      }
      catch (err: any) {
        console.error(`${c.red}Error executing turn: ${err.message}${c.reset}`)
      }

      promptUser()
    })
  }

  promptUser()
}

main().catch((err) => {
  console.error(`${c.red}Fatal CLI error: ${err.message}${c.reset}`, err)
  process.exit(1)
})
