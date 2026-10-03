import type { Card } from '@proj-airi/ccc'
import type { MaybeRefOrGetter } from 'vue'

import type { ModelCapabilityItem } from '../libs/character/model-capabilities'
import type { CharacterCueAllowlist } from '../types/card.schema'

import { ref, toValue } from 'vue'

import { useSystemOneStore } from '../stores/modules/system-one'

export const ACT_TOKEN_PATTERN = /<\|ACT:(?:emotion|motion|vfx|actor)=[^>|]+(?:\|>|>)/i

export interface AutonomousCueMeta {
  token: string
  rawKey: string
  sentence: string
  confidence: number
  latencyMs: number
  budgetMs: number
  provenance: 'autonomous_system_one'
}

export type AutonomousCueRunStatus
  = | 'fired'
    | 'none'
    | 'skipped-prefixed'
    | 'unmapped'
    | 'budget-dropped'
    | 'disabled'
    | 'unconfigured'
    | 'error'

export interface AutonomousCueRunRecord {
  sentence: string
  token: string
  rawKey: string | null
  confidence: number
  latencyMs: number
  budgetMs: number
  status: AutonomousCueRunStatus
  error?: string
}

export interface AutonomousCueContext {
  activeCard?: MaybeRefOrGetter<Card | null | undefined>
  activeModelId?: MaybeRefOrGetter<string | null | undefined>
  expressionCapabilities?: MaybeRefOrGetter<ModelCapabilityItem[] | undefined>
  motionCapabilities?: MaybeRefOrGetter<ModelCapabilityItem[] | undefined>
  actuateEmotion?: (rawKey: string, meta: AutonomousCueMeta) => void
  actuateMotion?: (rawKey: string, meta: AutonomousCueMeta) => void
}

/**
 * Checks if a sentence stride already carries an explicit ACT marker.
 */
export function containsExplicitActToken(text: string): boolean {
  return ACT_TOKEN_PATTERN.test(text)
}

/**
 * Normalizes sentence stride text for lookup and clean classification.
 */
export function normalizeSentenceText(text: string): string {
  return text.replace(ACT_TOKEN_PATTERN, '').trim()
}

/**
 * Calculates theoretical spoken duration budget (90% of duration at target WPM).
 * Used to avoid firing late cues after speech has ended.
 */
export function calculateWpmBudgetMs(sentence: string, wpm = 150): number {
  const words = sentence.trim().split(/\s+/).filter(Boolean).length
  if (words === 0) {
    return 1000
  }
  return Math.max(500, Math.round((words / wpm) * 60_000 * 0.9))
}

/**
 * Slices streaming text deltas into complete sentences on [.?!] boundaries,
 * preserving incomplete fragments in an internal buffer.
 */
export function createSentenceStrideBuffer() {
  let buffer = ''
  const sentenceRegex = /[^.?!]+[.?!]+["']?/g

  function feed(delta: string): string[] {
    buffer += delta
    const complete: string[] = []
    let match: RegExpExecArray | null
    let lastEnd = 0

    // Reset lastIndex for stateful global regex
    sentenceRegex.lastIndex = 0
    while ((match = sentenceRegex.exec(buffer)) !== null) {
      const sentence = match[0].trim()
      if (sentence) {
        complete.push(sentence)
      }
      lastEnd = sentenceRegex.lastIndex
    }

    buffer = buffer.slice(lastEnd)
    return complete
  }

  function flush(): string[] {
    const remaining = buffer.trim()
    buffer = ''
    if (remaining.length > 0) {
      return [remaining]
    }
    return []
  }

  function getPendingBuffer(): string {
    return buffer
  }

  function reset() {
    buffer = ''
  }

  return {
    feed,
    flush,
    getPendingBuffer,
    reset,
  }
}

/**
 * Splits a full block of text into individual sentence strides.
 */
export function splitSentences(text: string): string[] {
  const buffer = createSentenceStrideBuffer()
  const sentences = buffer.feed(text)
  const remainder = buffer.flush()
  return [...sentences, ...remainder]
}

/**
 * Resolves an authored or decided cue token to a physical rig rawKey.
 * Checks cueAllowlist first, then falls back to model capabilities by label or rawKey.
 */
export function resolveCueToken(
  token: string,
  options: {
    allowlist?: CharacterCueAllowlist
    capabilities?: ModelCapabilityItem[]
    rigExpressions?: string[]
  } = {},
): { rawKey: string, label?: string } | null {
  if (!token || token.toLowerCase() === 'none') {
    return null
  }

  const { allowlist, capabilities = [], rigExpressions = [] } = options

  // 1. Allowlist Emotions lookup
  if (allowlist?.emotions?.[token]) {
    const hit = allowlist.emotions[token]
    if (rigExpressions.length > 0) {
      const rigHit = rigExpressions.find(r => r === hit.rawKey || r.toLowerCase() === hit.rawKey.toLowerCase())
      if (rigHit) {
        return { rawKey: rigHit, label: hit.label }
      }
    }
    return { rawKey: hit.rawKey, label: hit.label }
  }

  // 2. Allowlist Motions lookup
  if (allowlist?.motions?.[token]) {
    const hit = allowlist.motions[token]
    if (rigExpressions.length > 0) {
      const rigHit = rigExpressions.find(r => r === hit.rawKey || r.toLowerCase() === hit.rawKey.toLowerCase())
      if (rigHit) {
        return { rawKey: rigHit, label: hit.label }
      }
    }
    return { rawKey: hit.rawKey, label: hit.label }
  }

  // 3. Rig expressions direct match
  if (rigExpressions.length > 0) {
    const hit = rigExpressions.find(r => r === token || r.toLowerCase() === token.toLowerCase())
    if (hit) {
      return { rawKey: hit, label: hit }
    }
  }

  // 3. Model capabilities fallback: match by label
  for (const cap of capabilities) {
    if (cap.usable !== false && cap.label && cap.label.toLowerCase() === token.toLowerCase()) {
      return { rawKey: cap.rawKey, label: cap.label }
    }
  }

  // 4. Model capabilities fallback: match by rawKey
  for (const cap of capabilities) {
    if (cap.usable !== false && cap.rawKey.toLowerCase() === token.toLowerCase()) {
      return { rawKey: cap.rawKey, label: cap.label }
    }
  }

  return null
}

/**
 * Extracts candidate emotion option names from the character's allowlist or model capabilities.
 */
export function resolveAllowedEmotionOptions(
  allowlist?: CharacterCueAllowlist,
  capabilities?: ModelCapabilityItem[],
): { options: string[], isFallback: boolean } {
  if (allowlist?.emotions && Object.keys(allowlist.emotions).length > 0) {
    return {
      options: ['none', ...Object.keys(allowlist.emotions)],
      isFallback: false,
    }
  }

  const usableCaps = (capabilities || []).filter(c => c.usable !== false)
  if (usableCaps.length > 0) {
    const names = usableCaps.map(c => c.label || c.rawKey)
    return {
      options: ['none', ...Array.from(new Set(names))],
      isFallback: false,
    }
  }

  // Fallback canonical cues when model has zero stored capabilities
  return {
    options: ['none', 'happy', 'sad', 'angry', 'surprised', 'thinking', 'neutral'],
    isFallback: true,
  }
}

/**
 * Builds persona context string from the active character card.
 */
export function buildPersonaContext(card?: Card | null): { name: string, block: string } {
  const name = (card as any)?.nickname || card?.name || 'Character'
  const personality = (card as any)?.personality || ''
  const description = (card as any)?.description || ''
  const directives = (card as any)?.extensions?.airi?.acting?.modelExpressionPrompt || ''

  const block = [
    personality ? `Personality: ${personality}` : '',
    description ? `Description: ${description}` : '',
    directives ? `Acting directives: ${directives}` : '',
  ].filter(Boolean).join('\n')

  return { name, block }
}

/**
 * Composable providing the autonomous sentence-stride cue evaluation and actuation pipeline.
 */
export function useAutonomousCues(context: AutonomousCueContext = {}) {
  const systemOneStore = useSystemOneStore()

  const strideBuffer = createSentenceStrideBuffer()
  const activeRuns = ref<AutonomousCueRunRecord[]>([])
  const isEvaluating = ref(false)
  let explicitActPending = false

  function markExplicitActSeen() {
    explicitActPending = true
  }

  /**
   * Evaluates a single sentence stride through System 1.
   */
  async function evaluateSentenceStride(
    rawSentence: string,
    options: { force?: boolean } = {},
  ): Promise<AutonomousCueRunRecord> {
    const cleanSentence = normalizeSentenceText(rawSentence)
    const budgetMs = calculateWpmBudgetMs(cleanSentence)

    // Check pre-prefixed: skip if already contains explicit ACT tag or one was seen on the stream
    const hasExplicit = containsExplicitActToken(rawSentence) || explicitActPending
    explicitActPending = false

    if (hasExplicit) {
      const record: AutonomousCueRunRecord = {
        sentence: cleanSentence,
        token: '',
        rawKey: null,
        confidence: 0,
        latencyMs: 0,
        budgetMs,
        status: 'skipped-prefixed',
      }
      activeRuns.value.push(record)
      return record
    }

    const card = toValue(context.activeCard)
    const actingConfig = (card as any)?.extensions?.airi?.acting
    const autoCuesEnabled = actingConfig?.autoCuesEnabled ?? false

    // Gate on autoCuesEnabled (unless force option is passed)
    if (!autoCuesEnabled && !options.force) {
      const record: AutonomousCueRunRecord = {
        sentence: cleanSentence,
        token: '',
        rawKey: null,
        confidence: 0,
        latencyMs: 0,
        budgetMs,
        status: 'disabled',
      }
      activeRuns.value.push(record)
      return record
    }

    // Gate on systemOneStore.configured
    if (!systemOneStore.configured) {
      const record: AutonomousCueRunRecord = {
        sentence: cleanSentence,
        token: '',
        rawKey: null,
        confidence: 0,
        latencyMs: 0,
        budgetMs,
        status: 'unconfigured',
      }
      activeRuns.value.push(record)
      return record
    }

    const allowlist: CharacterCueAllowlist | undefined = actingConfig?.cueAllowlist || actingConfig?.compiledWhitelist
    const caps = toValue(context.expressionCapabilities) || []
    const { options: emotionOptions } = resolveAllowedEmotionOptions(
      allowlist,
      caps,
    )

    const { name, block } = buildPersonaContext(card)
    const state = `Line for ${name}:\n${block}\nLine: "${cleanSentence}"`

    const questions: Record<string, any> = {
      emotion: {
        type: 'choice',
        instructions: `Select the avatar emotion cue from ${name}'s allowed cues that best matches this line. Select none if no cue fits.`,
        criteria: Object.fromEntries(
          emotionOptions.map(opt => [opt, opt === 'none' ? 'No cue fits this line.' : `Emotion cue: ${opt}.`]),
        ),
      },
    }

    isEvaluating.value = true
    const t0 = performance.now()

    try {
      const res = await systemOneStore.execute(state, questions)
      const latencyMs = Math.round(performance.now() - t0)

      const answer = (res.answers as any)?.emotion || {}
      const token = answer.choice || 'none'
      const confidence = typeof answer.confidence === 'number' ? answer.confidence : 0

      // Budget check: dropped if latency exceeded 90% spoken duration
      if (latencyMs > budgetMs) {
        const record: AutonomousCueRunRecord = {
          sentence: cleanSentence,
          token,
          rawKey: null,
          confidence,
          latencyMs,
          budgetMs,
          status: 'budget-dropped',
        }
        activeRuns.value.push(record)
        return record
      }

      // If System 1 picked 'none', no actuation
      if (token === 'none') {
        const record: AutonomousCueRunRecord = {
          sentence: cleanSentence,
          token: 'none',
          rawKey: null,
          confidence,
          latencyMs,
          budgetMs,
          status: 'none',
        }
        activeRuns.value.push(record)
        return record
      }

      // Resolve token to physical rig rawKey
      const resolved = resolveCueToken(token, {
        allowlist,
        capabilities: caps,
      })

      if (!resolved?.rawKey) {
        const record: AutonomousCueRunRecord = {
          sentence: cleanSentence,
          token,
          rawKey: null,
          confidence,
          latencyMs,
          budgetMs,
          status: 'unmapped',
        }
        activeRuns.value.push(record)
        return record
      }

      // Trigger actuation (evaporates: in-memory callback only, never persisted)
      const meta: AutonomousCueMeta = {
        token,
        rawKey: resolved.rawKey,
        sentence: cleanSentence,
        confidence,
        latencyMs,
        budgetMs,
        provenance: 'autonomous_system_one',
      }

      context.actuateEmotion?.(resolved.rawKey, meta)

      const record: AutonomousCueRunRecord = {
        sentence: cleanSentence,
        token,
        rawKey: resolved.rawKey,
        confidence,
        latencyMs,
        budgetMs,
        status: 'fired',
      }
      activeRuns.value.push(record)
      return record
    }
    catch (err: any) {
      const latencyMs = Math.round(performance.now() - t0)
      const record: AutonomousCueRunRecord = {
        sentence: cleanSentence,
        token: '',
        rawKey: null,
        confidence: 0,
        latencyMs,
        budgetMs,
        status: 'error',
        error: err?.message || String(err),
      }
      activeRuns.value.push(record)
      return record
    }
    finally {
      isEvaluating.value = false
    }
  }

  /**
   * Ingests a streaming text delta, evaluates completed sentences, and yields results.
   */
  async function feedDelta(delta: string): Promise<AutonomousCueRunRecord[]> {
    const sentences = strideBuffer.feed(delta)
    const records: AutonomousCueRunRecord[] = []
    for (const sentence of sentences) {
      records.push(await evaluateSentenceStride(sentence))
    }
    return records
  }

  /**
   * Flushes any remaining incomplete sentence fragment at stream completion.
   */
  async function flush(): Promise<AutonomousCueRunRecord[]> {
    const sentences = strideBuffer.flush()
    const records: AutonomousCueRunRecord[] = []
    for (const sentence of sentences) {
      records.push(await evaluateSentenceStride(sentence))
    }
    return records
  }

  function reset() {
    strideBuffer.reset()
    activeRuns.value = []
    isEvaluating.value = false
    explicitActPending = false
  }

  return {
    strideBuffer,
    activeRuns,
    isEvaluating,
    feedDelta,
    flush,
    reset,
    markExplicitActSeen,
    evaluateSentenceStride,
  }
}
