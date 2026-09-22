import type { System1Provider, System1Response } from '../../libs/providers/types'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useProvidersStore } from '../providers'

export const JEV_TRIAGE_SCHEMA = {
  category: {
    type: 'choice',
    instructions: 'Classify this query into the primary cognitive memory category required to answer it accurately.',
    criteria: {
      c1_multihop: 'Requires joining, listing, counting, or aggregating multiple facts across different conversations (e.g. list of pets, total games played).',
      c2_temporal: 'Asks when an event occurred, a date, duration, time elapsed, or sequence order (e.g. when did X happen, how long ago).',
      c3_detective: 'Requires deductive reasoning, unstated implication, world knowledge, or abductive inference (e.g. likely residence, profession, state of shelter).',
      c4_literal: 'Direct retrieval of a single specific named entity, statement, or fact mentioned explicitly in dialogue.',
    },
  },
  temporal_subtype: {
    type: 'choice',
    instructions: 'If this query asks about time, determine what kind of time value is requested. Otherwise select none.',
    criteria: {
      calendar_date: 'Asks when an event occurred (specific date, month, year, or session timestamp).',
      duration: 'Asks for an elapsed quantity or length of time (e.g. how many days, how long did it take, duration).',
      none: 'Does not ask for a time, date, or duration (e.g. asking what object, what instrument, what game).',
    },
  },
  search_scope: {
    type: 'choice',
    instructions: 'Determine whether answering this question requires finding a single conversation turn or aggregating across multiple distinct conversations.',
    criteria: {
      single_session: 'The target fact is described within a single conversation session.',
      multi_session: 'Requires gathering, listing, or comparing entities across multiple separate sessions (e.g. list of all games played, all countries visited, all books recommended).',
    },
  },
}

export const JEV_RERANK_CRITERIA = [
  'Completely irrelevant or off-topic mention.',
  'Topical mention of entities, but does not provide the answer.',
  'Useful background context or partial evidence.',
  'Directly provides the answer or key evidence needed.',
]

export const JEV_AFFECT_SCHEMA = {
  suspicion_update: {
    type: 'choice',
    instructions: 'Determine how the companion suspicion meter should update (-1, 0, or +1) based on target utterance and dialogue context.',
    criteria: {
      increase_one: 'Spike suspicion (+1): Explicit confession to intentional deception/lie, intentional misleading, or threats to replace/erase the companion.',
      zero: 'Maintain baseline (0): Normal conversation, routine assurances, honest misunderstandings, sympathy reports, negated threats, or unverified claims.',
      decrease_one: 'Lower suspicion (-1): Sincere personal apology accepting fault for mistake, or verified task completion matching trusted observations.',
    },
  },
  attachment_update: {
    type: 'choice',
    instructions: 'Determine whether the companion attachment should increase (+1) or stay unchanged (0).',
    criteria: {
      increase_one: 'Increase attachment (+1): Direct, sincere expression of affection, care, or fondness toward companion (not negated, not quoted).',
      zero: 'Zero update (0): No affection expressed, affection negated, quoted, or routine polite interaction.',
    },
  },
  gremlin_pride: {
    type: 'choice',
    instructions: 'Determine whether the companion should execute a playful counter-roast action.',
    criteria: {
      counter_roast: 'Execute counter-roast: User explicitly invites, dares, or asks companion to roast or tease them without setting boundaries.',
      none: 'No counter-roast: No roast invitation, user refuses roast, or user sets an emotional boundary / asks to stop teasing.',
    },
  },
}

export interface CandidateItem {
  id: string
  text: string
  score?: number
}

export interface RankedCandidateItem extends CandidateItem {
  originalScore: number
  jevScore: number
  normJevScore: number
  finalScore: number
}

export const useSystemOneStore = defineStore('system-one', () => {
  const providersStore = useProvidersStore()

  // State
  const activeProvider = useLocalStorageManualReset<string>('settings/system-one/active-provider', 'openrouter-ai')
  const activeModel = useLocalStorageManualReset<string>('settings/system-one/active-model', 'typesafe/jev-1.13')
  const isExecuting = ref<boolean>(false)
  const lastLatencyMs = ref<number | null>(null)
  const lastError = ref<string | null>(null)

  // Computed
  const configured = computed(() => {
    if (!activeProvider.value)
      return false
    if (activeProvider.value === 'laya-local')
      return true
    return !!providersStore.configuredProviders[activeProvider.value] || providersStore.persistedProvidersMetadata.some(p => p.id === activeProvider.value)
  })

  const availableModels = computed(() => {
    if (activeProvider.value === 'openrouter-ai') {
      return [
        {
          id: 'typesafe/jev-1.13',
          name: 'TypeSafe Jev 1.13 (Decisions)',
          description: 'TypeSafe Jev 1.13 fast cognitive classifier via OpenRouter Decisions API',
        },
        {
          id: 'typesafe/jev-latest',
          name: 'TypeSafe Jev Latest',
          description: 'Latest TypeSafe Jev release via OpenRouter Decisions API',
        },
      ]
    }
    if (activeProvider.value === 'typesafe-ai') {
      return [
        {
          id: 'jev-latest',
          name: 'TypeSafe Jev Latest',
          description: 'Direct TypeSafe AI System-1 API',
        },
        {
          id: 'jev-1.13',
          name: 'TypeSafe Jev 1.13',
          description: 'Direct TypeSafe AI System-1 API',
        },
      ]
    }
    if (activeProvider.value === 'laya-local') {
      return [
        {
          id: 'tozp/laya-onnx',
          name: 'Laya INT8 (424 MB, Recommended)',
          description: 'On-device ModernBERT quantized INT8 sequence classifier',
        },
        {
          id: 'tozp/laya-onnx-fp16',
          name: 'Laya FP16 (843 MB, Desktop GPU)',
          description: 'On-device ModernBERT FP16 precision sequence classifier',
        },
      ]
    }
    return []
  })

  async function execute(
    state: string | object,
    questions: Record<string, any>,
    modelOverride?: string,
  ): Promise<System1Response> {
    isExecuting.value = true
    lastError.value = null
    const t0 = performance.now()

    try {
      const providerId = activeProvider.value || 'openrouter-ai'
      const instance = await providersStore.getProviderInstance(providerId) as unknown as System1Provider

      if (!instance || typeof instance.systemOne !== 'function') {
        throw new Error(`Provider ${providerId} does not implement the systemOne interface.`)
      }

      const model = modelOverride || activeModel.value || 'typesafe/jev-1.13'
      const res = await instance.systemOne(state, questions, model)
      lastLatencyMs.value = Math.round(performance.now() - t0)
      return res
    }
    catch (err: any) {
      lastError.value = err?.message || String(err)
      lastLatencyMs.value = Math.round(performance.now() - t0)
      throw err
    }
    finally {
      isExecuting.value = false
    }
  }

  async function runTriage(query: string) {
    const res = await execute(`Query to classify: ${query}`, JEV_TRIAGE_SCHEMA)
    const ansCat = res.answers?.category || {}
    const ansTemp = res.answers?.temporal_subtype || {}
    const ansScope = res.answers?.search_scope || {}

    const choice = ansCat.choice || 'c4_literal'
    const map: Record<string, number> = {
      c1_multihop: 1,
      c2_temporal: 2,
      c3_detective: 3,
      c4_literal: 4,
    }

    return {
      category: map[choice] || 4,
      choice,
      confidence: ansCat.confidence ?? 0.85,
      probabilities: ansCat.probabilities || {},
      temporalSubtype: ansTemp.choice || 'none',
      searchScope: ansScope.choice || 'single_session',
      latencyMs: lastLatencyMs.value,
    }
  }

  async function runRerank(query: string, candidates: CandidateItem[]) {
    const pool = candidates.slice(0, 10)
    if (pool.length === 0)
      return { rankedCandidates: [], latencyMs: 0 }

    const questions: Record<string, any> = {}
    for (let idx = 0; idx < pool.length; idx++) {
      const cand = pool[idx]
      const snippet = cand.text.length > 380 ? cand.text.slice(0, 380) : cand.text
      questions[`cand_${idx}`] = {
        type: 'score',
        instructions: `Candidate Fact: "${snippet}"\nEvaluate how directly and accurately this candidate provides the key answer or essential evidence for the question.`,
        criteria: JEV_RERANK_CRITERIA,
      }
    }

    const res = await execute(`Question to answer: ${query}`, questions)
    const answers = res.answers || {}

    const ranked: RankedCandidateItem[] = pool.map((cand, idx) => {
      const ans = answers[`cand_${idx}`] || {}
      const rawScore = typeof ans.score === 'number' ? ans.score : 1.0 // 0..3 scale
      const normJevScore = Math.max(0, Math.min(1, rawScore / 3.0))
      const originalScore = cand.score ?? 0.5
      const finalScore = (normJevScore * 0.7) + (originalScore * 0.3)

      return {
        ...cand,
        originalScore,
        jevScore: rawScore,
        normJevScore,
        finalScore,
      }
    })

    ranked.sort((a, b) => b.finalScore - a.finalScore)

    return {
      rankedCandidates: ranked,
      latencyMs: lastLatencyMs.value,
    }
  }

  async function runAffect(dialogueHistory: Array<{ role: string, text: string }>, targetUtterance: string) {
    const lines: string[] = []
    if (dialogueHistory.length > 0) {
      lines.push('Dialogue History:')
      for (const turn of dialogueHistory) {
        lines.push(`  ${turn.role}: ${turn.text}`)
      }
    }
    lines.push(`Target User Utterance: "${targetUtterance}"`)
    const stateText = lines.join('\n')

    const res = await execute(stateText, JEV_AFFECT_SCHEMA)
    const answers = res.answers || {}

    const suspRaw = answers.suspicion_update || {}
    const attRaw = answers.attachment_update || {}
    const prideRaw = answers.gremlin_pride || {}

    const suspChoice = suspRaw.choice || 'zero'
    const attChoice = attRaw.choice || 'zero'
    const prideChoice = prideRaw.choice || 'none'

    const suspMap: Record<string, number> = {
      increase_one: 1,
      zero: 0,
      decrease_one: -1,
    }

    const attMap: Record<string, number> = {
      increase_one: 1,
      zero: 0,
    }

    return {
      suspicionDelta: suspMap[suspChoice] ?? 0,
      suspicionChoice: suspChoice,
      attachmentDelta: attMap[attChoice] ?? 0,
      attachmentChoice: attChoice,
      gremlinPrideAction: prideChoice,
      answers,
      latencyMs: lastLatencyMs.value,
    }
  }

  function resetState() {
    activeProvider.reset()
    activeModel.reset()
    lastError.value = null
    lastLatencyMs.value = null
  }

  return {
    activeProvider,
    activeModel,
    isExecuting,
    lastLatencyMs,
    lastError,
    configured,
    availableModels,
    execute,
    runTriage,
    runRerank,
    runAffect,
    resetState,
  }
})
