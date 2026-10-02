import type { ChatProvider } from '@xsai-ext/providers/utils'

import { useLive2d } from '@proj-airi/stage-ui-live2d/stores'
import { useMmd } from '@proj-airi/stage-ui-mmd'
import { useSpine } from '@proj-airi/stage-ui-spine'
import { useModelStore } from '@proj-airi/stage-ui-three'
import { storeToRefs } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import { toast } from 'vue-sonner'

import * as v from 'valibot'

import { useDisplayModelsStore } from '../stores/display-models'
import { useLLM } from '../stores/llm'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useProvidersStore } from '../stores/providers'
import { useSettingsControlStrip } from '../stores/settings/control-strip'

export interface ExpressionInputItem {
  key: string
  currentLabel: string
  isCustomRenamed: boolean
  isFavorite?: boolean
  category?: string
}

export interface CuratedExpressionItem {
  rawKey: string
  label: string
  actToken: string
  category: string
  shouldSkip: boolean
  skipReason?: string
}

export interface CurationResult {
  items: CuratedExpressionItem[]
}

export const CuratedExpressionItemSchema = v.object({
  rawKey: v.string(),
  label: v.string(),
  actToken: v.string(),
  category: v.string(),
  shouldSkip: v.boolean(),
  skipReason: v.optional(v.string()),
})

export const CurationResponseSchema = v.object({
  items: v.array(CuratedExpressionItemSchema),
})

export function useExpressionCuration() {
  const llmStore = useLLM()
  const consciousnessStore = useConsciousnessStore()
  const providersStore = useProvidersStore()
  const displayModelsStore = useDisplayModelsStore()
  const airiCardStore = useAiriCardStore()
  const controlStripStore = useSettingsControlStrip()

  const live2dStore = useLive2d()
  const mmdStore = useMmd()
  const spineStore = useSpine()
  const modelStore = useModelStore()

  const { activeCard, activeCardId } = storeToRefs(airiCardStore)
  const { stageEnabled, stageMateEnabled } = storeToRefs(controlStripStore)

  const isCurating = ref(false)
  const isGeneratingPrompt = ref(false)
  const curationError = ref<string | null>(null)
  const curationResult = ref<CurationResult | null>(null)

  const isStageOpen = computed(() => Boolean(stageEnabled.value || stageMateEnabled.value))

  async function curateExpressions(
    _modelId: string,
    modelFormat: string,
    items: ExpressionInputItem[],
    options?: {
      characterName?: string
      personality?: string
      description?: string
      scenario?: string
      /** Step-scoped override: when set, this provider/model is used instead of the global consciousness active pair. */
      providerId?: string
      model?: string
    },
  ): Promise<CurationResult | null> {
    const providerId = options?.providerId || consciousnessStore.activeProvider
    const model = options?.model || consciousnessStore.activeModel

    if (!providerId || !model) {
      curationError.value = 'No active LLM provider or model configured. Please check your Consciousness settings.'
      toast.error(curationError.value)
      return null
    }

    isCurating.value = true
    curationError.value = null

    try {
      const provider = await providersStore.getProviderInstance<ChatProvider>(providerId)
      if (!provider) {
        throw new Error(`Failed to instantiate LLM provider: ${providerId}`)
      }

      const charName = options?.characterName || activeCard.value?.name || 'Character'
      const charPersonality = options?.personality || activeCard.value?.personality || ''
      const charDescription = options?.description || activeCard.value?.description || ''
      const charScenario = options?.scenario || (activeCard.value as any)?.scenario || ''

      const systemInstruction = `You are an expert anime avatar director and emotional acting coach for AI companions.
Your task is to analyze a list of raw 3D/2D model blendshapes and curate them for emotional acting with the <|ACT:emotion="..."|> token system.

Directives:
1. Translate foreign (Japanese Kanji/Kana, Chinese) or cryptic technical names into natural, expressive English display labels (e.g., "ジト目" -> "Half-closed Scorn", "星星眼" -> "Star Sparkle Eyes", "11.怒り" -> "Angry Pout").
2. Generate concise, lowercase slug ACT action tokens (e.g., "smug_scorn", "star_eyes", "angry_pout") that will be emitted in dialogue as <|ACT:emotion="..."|>.
3. Categorize each valid emotion into one of: 'happy', 'angry', 'sad', 'surprised', 'smug', 'blush', 'special', 'relaxed', or 'other'.
4. REJECTION GATE ("The Out"): If an item is clearly non-emotional procedural tracking noise (e.g. eye-look directions like "0.up", "1.down", partial eye/mouth bones like "10.中", speech mouth shapes, or basic tracking shapes), set "shouldSkip: true" and give a brief "skipReason".
5. If the user already provided a custom renamed label, PRESERVE and respect their intent.
6. Contextualize the emotion names and ACT tokens to fit the character persona provided below.
7. The persona context below describes the CHARACTER being built. Never confuse it with the human user operating the software — appearance tags, wardrobe, and physical descriptions refer to the character's avatar and story, not the user.

Character Persona Context (the CHARACTER being built — never the user):
- Name: ${charName}
${charPersonality ? `- Personality: ${charPersonality}` : ''}
${charDescription ? `- Description: ${charDescription}` : ''}
${charScenario ? `- Scenario: ${charScenario}` : ''}
- Avatar Model Format: ${modelFormat.toUpperCase()}`

      const userPrompt = `Here is the candidate list of expressions to curate:
${JSON.stringify(items, null, 2)}

Return a structured JSON object containing the curated items array.`

      const res = await llmStore.generateObject<CurationResult>(
        model,
        provider,
        {
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt },
          ],
          schema: CurationResponseSchema,
        },
      )

      if (!res || !Array.isArray(res.items)) {
        throw new Error('LLM returned invalid response format.')
      }

      curationResult.value = res
      return res
    }
    catch (err: any) {
      console.error('[useExpressionCuration] Curation failed:', err)
      curationError.value = err?.message || 'Failed to curate expressions with LLM.'
      toast.error(`AI Curation Error: ${curationError.value}`)
      return null
    }
    finally {
      isCurating.value = false
    }
  }

  /**
   * Dedicated 2nd LLM pass to draft comprehensive acting directives based on the final curated tokens.
   */
  async function generateActingPrompt(
    characterContext: {
      name?: string
      personality?: string
      description?: string
      scenario?: string
      systemPrompt?: string
    },
    activeItems: CuratedExpressionItem[],
  ): Promise<string> {
    const providerId = consciousnessStore.activeProvider
    const model = consciousnessStore.activeModel

    const validTokens = activeItems
      .filter(i => !i.shouldSkip && i.actToken && i.actToken.trim())
      .map(i => i.actToken.trim())

    if (validTokens.length === 0) {
      return generateDefaultActingPrompt([])
    }

    // Group tokens by category for rich structured prompting
    const categories: Record<string, string[]> = {}
    for (const item of activeItems) {
      if (item.shouldSkip || !item.actToken)
        continue
      const cat = item.category || 'other'
      if (!categories[cat])
        categories[cat] = []
      categories[cat].push(item.actToken)
    }

    const categorizedTokenText = Object.entries(categories)
      .map(([cat, tokens]) => `- ${cat.toUpperCase()}: ${tokens.map(t => `<|ACT:emotion="${t}"|>`).join(', ')}`)
      .join('\n')

    // Structured whitelist: the machine truth behind the tokens (token → raw
    // morph + display label). The model reasons over this, not over any
    // previously rendered prose (which would be circular).
    const whitelistText = activeItems
      .filter(i => !i.shouldSkip && i.actToken && i.actToken.trim())
      .map(i => `- "${i.actToken.trim()}" fires morph "${i.rawKey}" ("${i.label || i.rawKey}")`)
      .join('\n')

    if (!providerId || !model) {
      return generateDefaultActingPrompt(validTokens)
    }

    isGeneratingPrompt.value = true
    try {
      const provider = await providersStore.getProviderInstance<ChatProvider>(providerId)
      if (!provider) {
        throw new Error(`Failed to instantiate LLM provider: ${providerId}`)
      }

      const charName = characterContext.name || activeCard.value?.name || 'Character'
      const charPersonality = characterContext.personality || activeCard.value?.personality || ''
      const charDescription = characterContext.description || activeCard.value?.description || ''
      const charScenario = characterContext.scenario || activeCard.value?.scenario || ''
      const charSystemPrompt = characterContext.systemPrompt || ''

      const systemInstruction = `You are an expert AI actor manager. Help the user write a detailed directive instructing the character actor how to inject <|ACT:emotion="expression_name"|> tokens into their dialogue responses.
- You MUST instruct the character to use the exact expression cues listed in the Acting Context.
- You MUST instruct the character to strictly use the official Short Format syntax with quoted values and equal signs: \`<|ACT:emotion="expression_name"|>\`.
- Instruct the character to place these tokens sparingly at natural emotional peaks in their dialogue (never overuse—insert only 1-2 per response).
- Teach the character which expressions match their default demeanor versus rare emotional shifts, tailored to their personality (${charName}).
- When a Character Voice section is provided, match its register, diction, and restraint: a dry sardonic voice uses cues sparingly and wryly, an effusive voice more freely. Persona judgment (e.g. telling a grunge character to use a happy cue only rarely) belongs in the directives.
- Always end the instruction block with a clear, in-character usage dialogue example showing where the tokens should be placed in dialogue (e.g., "Dialogue before cue <|ACT:emotion=\\"token_name\\"|> dialogue after cue.").
- Output ONLY the raw directive text. Do not wrap in conversational meta-commentary, introductory remarks, or markdown code fences unless formatting directives.`

      const userPrompt = `Character Profile:
- Name: ${charName}
${charPersonality ? `- Personality: ${charPersonality}` : ''}
${charDescription ? `- Description: ${charDescription}` : ''}
${charScenario ? `- Scenario: ${charScenario}` : ''}
${charSystemPrompt ? `\nCharacter Voice (system prompt — match this register):\n${charSystemPrompt}` : ''}

Complete Curated Expression Tokens (${validTokens.length} total):
${categorizedTokenText}

Verified Whitelist (token → avatar morph — reason over this, not over any prior prose):
${whitelistText}

Please draft the comprehensive Acting Directive instructing ${charName} how to use these exact tokens in character.`

      const response = await llmStore.generate(model, provider, [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt },
      ])

      const generatedText = response.text?.trim()
      if (generatedText) {
        return generatedText
      }
      return generateDefaultActingPrompt(validTokens)
    }
    catch (err) {
      console.error('[useExpressionCuration] generateActingPrompt failed:', err)
      return generateDefaultActingPrompt(validTokens)
    }
    finally {
      isGeneratingPrompt.value = false
    }
  }

  /**
   * Triggers a live test preview of a blendshape or expression on stage.
   */
  function previewOnStage(modelType: string, rawKey: string) {
    if (!isStageOpen.value) {
      toast.info(`Stage window is closed. (Preview: ${rawKey})`)
      return
    }

    try {
      if (modelType === 'live2d') {
        live2dStore.triggerEmotion(rawKey, 1.0)
      }
      else if (modelType === 'vrm') {
        modelStore.triggerEmotion(rawKey, 1.0)
        if (stageMateEnabled.value && typeof window !== 'undefined' && (window as any).electron) {
          import('@proj-airi/electron-vueuse').then(({ useElectronEventaInvoke }) => {
            import('@proj-airi/stage-shared').then(({ electronStageMateTriggerExpression }) => {
              const triggerExpr = useElectronEventaInvoke(electronStageMateTriggerExpression)
              triggerExpr({ name: rawKey, weight: 1.0, durationMs: 2500 })
            })
          }).catch(() => {})
        }
      }
      else if (modelType === 'mmd') {
        mmdStore.previewExpression = rawKey
        setTimeout(() => {
          if (mmdStore.previewExpression === rawKey) {
            mmdStore.previewExpression = null
          }
        }, 2000)
      }
      else if (modelType === 'spine') {
        const match = rawKey.match(/^(.+?)\s*\[(.+?)\]$/)
        if (match) {
          spineStore.selectVariantAndSkin(match[1].trim(), match[2].trim())
        }
        else {
          spineStore.selectVariantAndSkin(rawKey, 'default')
        }
      }
      toast.success(`Previewing: ${rawKey}`)
    }
    catch (err) {
      console.error('[useExpressionCuration] Preview failed:', err)
    }
  }

  /**
   * Persists curated results into displayModelsStore and airiCardStore.
   */
  async function applyCuration(
    modelId: string,
    items: CuratedExpressionItem[],
    options: {
      autoHideSkipped: boolean
      updateCardPrompt: boolean
      suggestedPrompt?: string
    },
  ): Promise<boolean> {
    try {
      const model = await displayModelsStore.getDisplayModel(modelId)
      if (!model) {
        throw new Error(`Model ${modelId} not found in database.`)
      }

      const newEmotionMappings = { ...model.emotionMappings }
      const newHiddenExpressions = new Set(model.hiddenExpressions || [])

      const validActTokens: string[] = []

      for (const item of items) {
        if (item.shouldSkip) {
          if (options.autoHideSkipped) {
            newHiddenExpressions.add(item.rawKey)
          }
        }
        else {
          if (item.label && item.label.trim()) {
            newEmotionMappings[item.rawKey] = item.label.trim()
          }
          if (item.actToken && item.actToken.trim()) {
            validActTokens.push(item.actToken.trim())
          }
          // Make sure included ones are unhidden
          newHiddenExpressions.delete(item.rawKey)
        }
      }

      // Update model record
      await displayModelsStore.updateDisplayModelMappings(modelId, {
        emotionMappings: newEmotionMappings,
        hiddenExpressions: Array.from(newHiddenExpressions),
      })

      // Update active card acting instructions if requested
      if (options.updateCardPrompt && activeCard.value && activeCardId.value) {
        const actingPrompt = options.suggestedPrompt || generateDefaultActingPrompt(validActTokens)
        const updatedCard = JSON.parse(JSON.stringify(toRaw(activeCard.value)))

        if (!updatedCard.extensions)
          updatedCard.extensions = {}
        if (!updatedCard.extensions.airi)
          updatedCard.extensions.airi = {}
        if (!updatedCard.extensions.airi.acting) {
          updatedCard.extensions.airi.acting = {
            modelExpressionPrompt: '',
            speechExpressionPrompt: '',
            speechMannerismPrompt: '',
          }
        }

        updatedCard.extensions.airi.acting.modelExpressionPrompt = actingPrompt
        await airiCardStore.updateCard(activeCardId.value, updatedCard)
      }

      toast.success('Curated expressions and acting directives saved!')
      return true
    }
    catch (err: any) {
      console.error('[useExpressionCuration] Failed to apply curation:', err)
      toast.error(`Save failed: ${err?.message || 'Unknown error'}`)
      return false
    }
  }

  function generateDefaultActingPrompt(tokens: string[]): string {
    const tokenList = tokens.map(t => `<|ACT:emotion="${t}"|>`).join(', ')
    // The example reuses a configured token (never a hardcoded one): citing an
    // unmapped emotion here would teach the model it is available.
    const exampleToken = tokens[0] || 'expression_name'
    return `Inject physical emotion cues sparingly using the official Short Format at key emotional moments:
- Available expression cues: ${tokenList || 'None'}
- Example: "Hey, how are you? <|ACT:emotion="${exampleToken}"|>"
- Place cues naturally at emotional peaks (1-2 per turn).`
  }

  return {
    isCurating,
    isGeneratingPrompt,
    curationError,
    curationResult,
    curateExpressions,
    generateActingPrompt,
    previewOnStage,
    applyCuration,
    generateDefaultActingPrompt,
  }
}
