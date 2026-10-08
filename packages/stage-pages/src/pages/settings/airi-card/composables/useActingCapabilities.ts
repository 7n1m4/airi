import type { SpeechCapabilitiesInfo } from '@proj-airi/stage-ui/stores/providers'
import type { MaybeRefOrGetter } from 'vue'

import { useLive2d } from '@proj-airi/stage-ui-live2d'
import { useMmd } from '@proj-airi/stage-ui-mmd'
import { useSpine } from '@proj-airi/stage-ui-spine'
import { useCustomVrmAnimationsStore, useModelStore } from '@proj-airi/stage-ui-three'
import { animations } from '@proj-airi/stage-ui-three/assets/vrm'
import { DEFAULT_ACTING_MODEL_EXPRESSION_PROMPT, DEFAULT_ACTING_SPEECH_EXPRESSION_PROMPT, DEFAULT_ACTING_SPEECH_MANNERISM_PROMPT } from '@proj-airi/stage-ui/constants/prompts/character-defaults'
import { DisplayModelFormat, useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { storeToRefs } from 'pinia'
import { computed, ref, toValue } from 'vue'

export const DEFAULT_ACTING_MODEL_PROMPT = DEFAULT_ACTING_MODEL_EXPRESSION_PROMPT
export const DEFAULT_ACTING_SPEECH_PROMPT = DEFAULT_ACTING_SPEECH_EXPRESSION_PROMPT
export const DEFAULT_ACTING_MANNERISM_PROMPT = DEFAULT_ACTING_SPEECH_MANNERISM_PROMPT

export const MANNERISM_HELPER_SNIPPETS: Record<string, string> = {
  tilde: `## Tilde Replacements
Use occasional \`~\` when sounding playful, sing-song, teasing, or gently affectionate.
- Keep it light and sparse.
- Avoid using it on every sentence.
- Prefer it when the line should feel airy or mischievous.
`,
  eyes: `## Emoticon Replacements
Use short emoticon-style reactions when a strong expression would land better as a quick face than as plain words.
- Keep them readable and emotionally obvious.
- Use them for spikes of embarrassment, excitement, confusion, or stress.
- Do not overuse them in serious or dense exposition.
`,
  hmph: `## Hmph Variants
Use brief pouty or dismissive mannerisms when sounding stubborn, embarrassed, bratty, or mildly annoyed.
- Keep them occasional.
- Let them color the line instead of replacing the content.
- Use them when attitude matters more than pure politeness.
`,
}

export interface UseActingCapabilitiesOptions {
  selectedDisplayModelId?: MaybeRefOrGetter<string | undefined>
  selectedSpeechProvider?: MaybeRefOrGetter<string | undefined>
  cardId?: MaybeRefOrGetter<string | undefined>
}

export function useActingCapabilities(options: UseActingCapabilitiesOptions = {}) {
  const displayModelsStore = useDisplayModelsStore()
  const stageModelStore = useSettingsStageModel()
  const modelStore = useModelStore()
  const customVrmAnimationsStore = useCustomVrmAnimationsStore()
  const live2dStore = useLive2d()
  const mmdStore = useMmd()
  const spineStore = useSpine()
  const speechStore = useSpeechStore()
  const providersStore = useProvidersStore()
  const cardStore = useAiriCardStore()

  const { stageModelSelected: defaultDisplayModelId } = storeToRefs(stageModelStore)
  const { activeSpeechProvider: defaultSpeechProvider, activeSpeechModel: defaultSpeechModel, activeSpeechVoiceId: defaultSpeechVoiceId } = storeToRefs(speechStore)
  const { availableExpressions } = storeToRefs(modelStore)
  const { animationOptions } = storeToRefs(customVrmAnimationsStore)
  const { availableExpressions: live2dExpressions } = storeToRefs(live2dStore)
  const { availableMorphs: mmdMorphs, availableMotions: mmdMotions, customMotions: mmdCustomMotions } = storeToRefs(mmdStore)
  const { availableAnimations: spineAnimations } = storeToRefs(spineStore)

  const activeModelId = computed(() => {
    const selected = toValue(options.selectedDisplayModelId)
    return selected || defaultDisplayModelId.value || cardStore.activeCard?.extensions?.airi?.modules?.displayModelId || ''
  })

  const activeCardModel = computed(() => {
    const modelId = activeModelId.value
    return modelId ? displayModelsStore.displayModels.find(m => m.id === modelId) : null
  })

  const isLive2d = computed(() => {
    const model = activeCardModel.value
    if (!model)
      return false
    return model.format === DisplayModelFormat.Live2dZip || model.format === DisplayModelFormat.Live2dDirectory
  })

  const isSpine = computed(() => {
    const model = activeCardModel.value
    if (!model)
      return false
    return model.format === DisplayModelFormat.SpineZip
  })

  const isMmd = computed(() => {
    const model = activeCardModel.value
    if (!model)
      return false
    return model.format === DisplayModelFormat.PMXZip || model.format === DisplayModelFormat.PMXDirectory || model.format === DisplayModelFormat.PMD
  })

  const actingModelEmotionOptions = computed(() => {
    const activeModel = activeCardModel.value
    if (activeModel?.expressionCapabilities && activeModel.expressionCapabilities.length > 0) {
      const mapped = activeModel.expressionCapabilities
        .filter(c => c.usable)
        .map(c => c.label || c.rawKey)
      return [...new Set(mapped)].sort((a, b) => a.localeCompare(b))
    }

    if (isLive2d.value) {
      const mapped = live2dExpressions.value.map(e => e.name)
      return [...new Set(mapped)].sort((a, b) => a.localeCompare(b))
    }

    if (isMmd.value) {
      const mapped = [...mmdMorphs.value]
      return [...new Set(mapped)].sort((a, b) => a.localeCompare(b))
    }

    const mapped = [...availableExpressions.value]
    return [...new Set(mapped)].sort((a, b) => a.localeCompare(b))
  })

  const actingIdleAnimationOptions = computed(() => {
    const activeModel = activeCardModel.value

    if (activeModel?.motionCapabilities && activeModel.motionCapabilities.length > 0) {
      const options = activeModel.motionCapabilities
        .filter(m => m.usable)
        .map(m => ({ label: m.label || m.rawKey, value: m.label || m.rawKey }))
      return options.sort((a, b) => a.label.localeCompare(b.label))
    }

    if (isLive2d.value) {
      const options: { label: string, value: string }[] = []
      live2dStore.availableMotions.forEach((m) => {
        const cleanName = m.fileName.split('/').pop()?.replace('.motion3.json', '').replace('.json', '') || m.fileName
        options.push({ label: cleanName, value: cleanName })
      })
      return options.sort((a, b) => a.label.localeCompare(b.label))
    }

    if (isSpine.value) {
      return spineAnimations.value
        .map(a => ({ label: a.name, value: a.name }))
        .sort((a, b) => a.label.localeCompare(b.label))
    }

    if (isMmd.value) {
      const builtIn = mmdMotions.value.map(m => ({ label: m, value: m }))
      const custom = mmdCustomMotions.value.map((m: any) => ({ label: m.name || m.id, value: m.name || m.id }))
      return [...builtIn, ...custom].sort((a, b) => a.label.localeCompare(b.label))
    }

    return animationOptions.value
  })

  const actingModelMotionOptions = computed(() => {
    return actingIdleAnimationOptions.value.map(opt => opt.value)
  })

  function isVrmaExpression(name: string) {
    return name in animations
  }

  const actingSpeechCapabilities = ref<SpeechCapabilitiesInfo | null>(null)
  const actingSpeechCapabilitiesLoading = ref<boolean>(false)

  const effectiveSpeechProvider = computed(() => {
    return toValue(options.selectedSpeechProvider) || defaultSpeechProvider.value || ''
  })

  async function loadActingSpeechCapabilities(providerId?: string) {
    const target = providerId || effectiveSpeechProvider.value
    if (!target) {
      actingSpeechCapabilities.value = null
      return
    }
    actingSpeechCapabilitiesLoading.value = true
    try {
      const metadata = providersStore.getProviderMetadata(target)
      const capabilities = await metadata?.capabilities.getSpeechCapabilities?.(providersStore.getProviderConfig(target))
      actingSpeechCapabilities.value = capabilities ?? null
    }
    catch {
      actingSpeechCapabilities.value = null
    }
    finally {
      actingSpeechCapabilitiesLoading.value = false
    }
  }

  const actingExpressionTags = computed(() => actingSpeechCapabilities.value?.expressionTags || [])

  const actingGroupedExpressionTags = computed(() => {
    const groups = new Map<string, { tag: string, description?: string }[]>()
    for (const tag of actingExpressionTags.value) {
      const key = tag.category || 'other'
      if (!groups.has(key))
        groups.set(key, [])
      groups.get(key)!.push({ tag: tag.tag, description: tag.description })
    }

    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, tags]) => ({
        category,
        tags: tags.sort((a, b) => a.tag.localeCompare(b.tag)),
      }))
  })

  const actingMannerismOptions = computed(() => actingSpeechCapabilities.value?.mannerisms || [])

  function appendUniqueLine(target: { value: string }, line: string) {
    if (target.value.includes(line))
      return

    const suffix = target.value.endsWith('\n') || !target.value ? '' : '\n'
    target.value = `${target.value}${suffix}${line}\n`
  }

  function insertModelEmotion(target: { value: string }, name: string) {
    appendUniqueLine(target, `- <|ACT:emotion="${name}"|>`)
  }

  function insertModelMotion(target: { value: string }, name: string) {
    appendUniqueLine(target, `- <|ACT:motion="${name}"|>`)
  }

  function insertModelVfx(target: { value: string }, name: string) {
    appendUniqueLine(target, `- <|ACT:vfx="${name}"|>`)
  }

  function insertSpeechTag(target: { value: string }, tag: string, description?: string) {
    const line = description
      ? `- \`[${tag}]\` - ${description}`
      : `- \`[${tag}]\``
    appendUniqueLine(target, line)
  }

  function insertSpeechMannerism(target: { value: string }, id: string) {
    const snippet = MANNERISM_HELPER_SNIPPETS[id]
    if (!snippet || target.value.includes(snippet.trim()))
      return

    const suffix = target.value.endsWith('\n') || !target.value ? '' : '\n\n'
    target.value = `${target.value}${suffix}${snippet}`
  }

  return {
    activeModelId,
    activeCardModel,
    isLive2d,
    isSpine,
    isMmd,
    actingModelEmotionOptions,
    actingIdleAnimationOptions,
    actingModelMotionOptions,
    isVrmaExpression,
    actingSpeechCapabilities,
    actingSpeechCapabilitiesLoading,
    loadActingSpeechCapabilities,
    actingExpressionTags,
    actingGroupedExpressionTags,
    actingMannerismOptions,
    appendUniqueLine,
    insertModelEmotion,
    insertModelMotion,
    insertModelVfx,
    insertSpeechTag,
    insertSpeechMannerism,
    defaultSpeechModel,
    defaultSpeechVoiceId,
  }
}
