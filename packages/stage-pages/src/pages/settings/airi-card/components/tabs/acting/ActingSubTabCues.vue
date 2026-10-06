<script setup lang="ts">
import type { CharacterCueAllowlist } from '@proj-airi/stage-ui/types/card.schema'

import { extractTokensFromPrompt } from '@proj-airi/stage-ui/composables'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

interface Props {
  actingModelEmotionOptions: string[]
  actingModelMotionOptions: string[]
  selectedDisplayModelId?: string
  isLive2d?: boolean
  insertModelEmotion?: (name: string) => void
  insertModelMotion?: (name: string) => void
  insertModelVfx?: (name: string) => void
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'sparkle-click', fieldId: string): void
}>()

const selectedActingModelExpressionPrompt = defineModel<string>('selectedActingModelExpressionPrompt', { required: true })
const selectedActingCueAllowlist = defineModel<CharacterCueAllowlist | undefined>('selectedActingCueAllowlist')
const autoCuesEnabled = defineModel<boolean>('autoCuesEnabled', { default: false })
const autoCueExpressions = defineModel<boolean>('autoCueExpressions', { default: true })
const autoCueMotions = defineModel<boolean>('autoCueMotions', { default: false })

const router = useRouter()

function openEmotionCalibration() {
  const modelId = props.selectedDisplayModelId
  router.push({
    path: '/settings/models/emotions',
    query: modelId ? { model: modelId } : {},
  })
}

const allowlistEmotionsCount = computed(() => {
  return Object.keys(selectedActingCueAllowlist.value?.emotions || {}).length
})

const allowlistMotionsCount = computed(() => {
  return Object.keys(selectedActingCueAllowlist.value?.motions || {}).length
})

const hasCalibratedAllowlist = computed(() => {
  return allowlistEmotionsCount.value > 0 || allowlistMotionsCount.value > 0
})

function syncPromptFromAllowlist() {
  const allowlist = selectedActingCueAllowlist.value
  const emotions = allowlist?.emotions ? Object.keys(allowlist.emotions) : []
  const motions = allowlist?.motions ? Object.keys(allowlist.motions) : []

  if (emotions.length === 0 && motions.length === 0) {
    const usableEmotions = props.actingModelEmotionOptions
    const usableMotions = props.actingModelMotionOptions
    if (usableEmotions.length === 0 && usableMotions.length === 0)
      return

    let prompt = `## Character Acting & Expression Directives\nInstruct the character to place <|ACT:...|> tokens inline sparingly (1-2 per turn) at natural emotional peaks.\n`
    if (usableEmotions.length > 0) {
      prompt += `\n### Available Emotions\nUse <|ACT:emotion="NAME"|> with: ${usableEmotions.join(', ')}.\n`
    }
    if (usableMotions.length > 0) {
      prompt += `\n### Available Motions\nUse <|ACT:motion="NAME"|> with: ${usableMotions.join(', ')}.\n`
    }
    selectedActingModelExpressionPrompt.value = prompt.trim()
    toast.success('Generated directives template from model capabilities & allowlist')
    return
  }

  let prompt = `## Character Acting & Expression Directives\nInstruct the character to place <|ACT:...|> tokens inline sparingly (1-2 per turn) at natural emotional peaks.\n`
  if (emotions.length > 0) {
    prompt += `\n### Calibrated Emotion Tokens\nUse <|ACT:emotion="NAME"|> where NAME is one of:\n`
    for (const token of emotions) {
      const details = allowlist!.emotions![token]
      prompt += `- "${token}" (${details.label || token})\n`
    }
  }
  if (motions.length > 0) {
    prompt += `\n### Calibrated Motion Tokens\nUse <|ACT:motion="NAME"|> where NAME is one of:\n`
    for (const token of motions) {
      const details = allowlist!.motions![token]
      prompt += `- "${token}" (${details.label || token})\n`
    }
  }
  selectedActingModelExpressionPrompt.value = prompt.trim()
  toast.success('Generated directives template from calibrated allowlist')
}

function syncAllowlistFromPrompt() {
  const promptText = selectedActingModelExpressionPrompt.value || ''
  if (!promptText.trim()) {
    toast.warning('Acting Directives text is empty', {
      description: 'Please write or paste your acting directives in the text area below before syncing.',
    })
    return
  }

  const candidatePool = [
    ...props.actingModelEmotionOptions,
    'happy',
    'sad',
    'angry',
    'surprised',
    'thinking',
    'question',
    'neutral',
    'smile',
    'blush',
    'pout',
    'wink',
    'shy',
    'gloomy',
    'crying',
    'shocked_eyes',
    'cat_mouth',
    'heart',
    'heartbroken',
    'music',
    'sleepy',
    'star_eyes',
    'sweating',
  ]
  const uniqueCandidates = Array.from(new Set(candidatePool.filter(Boolean)))

  const matchedTokens = extractTokensFromPrompt(promptText, uniqueCandidates)
  if (matchedTokens.length === 0) {
    toast.warning('No matching emotion cues found in Directives', {
      description: 'None of the expressions from your active model or canonical list were found in the directives text.',
    })
    return
  }

  const currentAllowlist = selectedActingCueAllowlist.value || { version: 1 }
  const emotions: Record<string, { rawKey: string, label: string }> = {
    ...currentAllowlist.emotions,
  }

  for (const token of matchedTokens) {
    emotions[token] = {
      rawKey: token,
      label: token,
    }
  }

  selectedActingCueAllowlist.value = {
    ...currentAllowlist,
    version: 1,
    emotions,
  }

  const preview = matchedTokens.slice(0, 6).join(', ')
  const suffix = matchedTokens.length > 6 ? ` (+${matchedTokens.length - 6} more)` : ''
  toast.success(`Synced ${matchedTokens.length} emotion cue${matchedTokens.length === 1 ? '' : 's'} from Directives`, {
    description: `Added to Allowlist: ${preview}${suffix}`,
  })
}

const ELEMENTAL_VFX_OPTIONS = [
  { key: 'fire', label: '🔥 Fire Boost', token: '<|ACT:vfx="fire"|>', desc: 'Molten cinder fracture ground decal, bone-tethered ascending flame tongues & rising ember sparks.' },
  { key: 'electric', label: '⚡ Electric Boost', token: '<|ACT:vfx="electric"|>', desc: 'Concentric high-voltage discharge ground ring, biological Fresnel rim & crackling arc sparks.' },
  { key: 'magic', label: '✨ Magic Boost', token: '<|ACT:vfx="magic"|>', desc: 'Rotating arcane rune seal, ascending double-helical ribbons & floating starlight motes.' },
  { key: 'verdant', label: '🍃 Verdant Boost', token: '<|ACT:vfx="verdant"|>', desc: 'Sacred 8-fold lotus blossom mandala, creeping vine field & drifting bio-spores.' },
]

function onInsertVfx(vfxKey: string) {
  if (props.insertModelVfx) {
    props.insertModelVfx(vfxKey)
  }
  else {
    const line = `- <|ACT:vfx="${vfxKey}"|>`
    if (selectedActingModelExpressionPrompt.value?.includes(line))
      return
    const suffix = selectedActingModelExpressionPrompt.value?.endsWith('\n') || !selectedActingModelExpressionPrompt.value ? '' : '\n'
    selectedActingModelExpressionPrompt.value = `${selectedActingModelExpressionPrompt.value || ''}${suffix}${line}\n`
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between border-b border-neutral-100 pb-4 dark:border-neutral-800">
      <div class="flex flex-col gap-0.5">
        <div class="flex items-center gap-2">
          <div class="i-solar:smile-circle-bold-duotone text-lg text-primary-500" />
          <h4 class="text-sm text-neutral-800 font-semibold dark:text-neutral-100">
            Avatar Cues & Kinetic Performance
          </h4>
        </div>
        <p class="pl-6 text-xs text-neutral-500 dark:text-neutral-400">
          Configure avatar gestures, ACT tokens, autonomous System-1 cues, and expressive directives.
        </p>
      </div>
    </div>

    <div class="flex flex-col gap-6">
      <!-- Autonomous Cues (System-1 Interceptor) Section -->
      <div class="border border-neutral-200 rounded-xl bg-neutral-50/50 p-4 dark:border-neutral-700/70 dark:bg-neutral-950/30">
        <div class="flex items-start justify-between gap-4">
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <div class="i-solar:bolt-circle-bold-duotone text-lg text-primary-500" />
              <span class="text-sm text-neutral-800 font-semibold dark:text-neutral-100">
                Autonomous Cues (System-1 Interceptor)
              </span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-medium"
                :class="[
                  autoCuesEnabled
                    ? 'bg-primary-100 text-primary-800 dark:bg-primary-950/60 dark:text-primary-300'
                    : 'bg-neutral-200/70 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
                ]"
              >
                {{ autoCuesEnabled ? 'Active' : 'Disabled' }}
              </span>
            </div>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              Automatically makes your character more expressive by evaluating dialogue sentiment in real time, using their personality and acting directives to choose matching cues.
            </p>
          </div>

          <!-- Master Switch Toggle -->
          <label class="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              v-model="autoCuesEnabled"
              type="checkbox"
              class="peer sr-only"
            >
            <div class="h-6 w-11 rounded-full bg-neutral-200 transition-colors after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-neutral-300 dark:border-neutral-600 after:rounded-full after:bg-white dark:bg-neutral-700 peer-checked:bg-primary-500 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:peer-focus:ring-primary-800" />
          </label>
        </div>

        <!-- Auto-Cues Details -->
        <div class="mt-4 flex flex-col gap-4 border-t border-neutral-200/60 pt-4 dark:border-neutral-800/60">
          <!-- Context Chips Read by Classifier -->
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] text-neutral-500 font-medium tracking-wider uppercase dark:text-neutral-400">
              Character Details Considered
            </span>
            <div class="flex flex-wrap items-center gap-2">
              <span class="inline-flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-white px-2.5 py-1 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                <span class="i-solar:user-speak-bold-duotone text-primary-500" />
                Personality
              </span>
              <span class="inline-flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-white px-2.5 py-1 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                <span class="i-solar:document-text-bold-duotone text-primary-500" />
                Description
              </span>
              <span class="inline-flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-white px-2.5 py-1 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                <span class="i-solar:mask-happly-bold-duotone text-primary-500" />
                Acting Directives
              </span>
            </div>
          </div>

          <!-- Granular Modality Checkboxes -->
          <div class="flex flex-wrap items-center gap-6">
            <label class="flex cursor-pointer items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
              <input
                v-model="autoCueExpressions"
                type="checkbox"
                :disabled="!autoCuesEnabled"
                class="rounded text-primary-500 disabled:opacity-40 focus:ring-primary-400"
              >
              <span>Auto-cue Expressions</span>
            </label>

            <label class="flex cursor-pointer items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
              <input
                v-model="autoCueMotions"
                type="checkbox"
                :disabled="!autoCuesEnabled"
                class="rounded text-primary-500 disabled:opacity-40 focus:ring-primary-400"
              >
              <span>Auto-cue Motions (Coming Soon)</span>
            </label>
          </div>

          <!-- Allowlist Status & Calibration Link -->
          <div class="flex items-center justify-between border border-neutral-200/80 rounded-lg bg-white/80 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
            <div class="flex items-center gap-3">
              <div
                class="h-8 w-8 flex items-center justify-center rounded-lg text-sm"
                :class="[
                  hasCalibratedAllowlist
                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                    : 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
                ]"
              >
                <div :class="[hasCalibratedAllowlist ? 'i-solar:check-circle-bold-duotone' : 'i-solar:shield-warning-bold-duotone']" />
              </div>
              <div class="flex flex-col">
                <span class="text-xs text-neutral-800 font-medium dark:text-neutral-200">
                  {{ hasCalibratedAllowlist ? 'Calibrated Cue Allowlist' : 'No Allowlist Calibrated' }}
                </span>
                <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
                  {{ hasCalibratedAllowlist ? `${allowlistEmotionsCount} expressions · ${allowlistMotionsCount} motions allowed` : 'Calibrate your model in Emotion Studio to map physical rig blendshapes to semantic cues' }}
                </span>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-white px-3 py-1.5 text-xs text-neutral-700 font-medium shadow-sm transition dark:border-neutral-700 dark:bg-neutral-800 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-700"
                title="Scan prompt directives above for known cues and populate the allowlist"
                @click="syncAllowlistFromPrompt"
              >
                <div class="i-solar:magic-stick-3-bold-duotone text-primary-500" />
                <span>Sync from Directives</span>
              </button>
              <button
                type="button"
                class="flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-white px-3 py-1.5 text-xs text-neutral-700 font-medium shadow-sm transition dark:border-neutral-700 dark:bg-neutral-800 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-700"
                @click="openEmotionCalibration"
              >
                <div class="i-solar:tuning-square-2-bold-duotone text-primary-500" />
                <span>{{ hasCalibratedAllowlist ? 'Recalibrate in Studio' : 'Launch Emotion Studio' }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ACT / Model Expressions Prompt -->
      <div class="border border-neutral-200 rounded-xl p-4 dark:border-neutral-700">
        <div class="max-w-full">
          <label class="flex flex-col gap-4">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="flex items-center gap-1 text-sm font-medium">
                  ACT Directives & Cue Capabilities
                </div>
                <div class="text-xs text-neutral-500 dark:text-neutral-400">
                  Teach AIRI how to emit ACT tokens for avatar emotions, outfits, and kinetic motion cues.
                </div>
              </div>
              <button
                type="button"
                class="flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-neutral-50 px-2.5 py-1 text-xs text-neutral-700 shadow-sm transition dark:border-neutral-700 hover:border-primary-300 dark:bg-neutral-800 dark:text-neutral-300 hover:text-primary-600 dark:hover:text-primary-400"
                title="Format prompt instructions using calibrated allowlist or usable model capabilities"
                @click="syncPromptFromAllowlist"
              >
                <div class="i-solar:refresh-circle-bold-duotone text-primary-500" />
                <span>Sync with Capabilities</span>
              </button>
            </div>
            <div class="relative w-full">
              <textarea
                v-model="selectedActingModelExpressionPrompt"
                rows="6"
                placeholder="ACT Cue Directives & Instructions"
                class="focus:primary-300 dark:focus:primary-400/50 text-disabled:neutral-400 dark:text-disabled:neutral-600 cursor-disabled:not-allowed w-full border-2 border-neutral-100 rounded-lg border-solid bg-neutral-50 py-1.5 pl-2 pr-9 text-sm shadow-sm outline-none transition-all duration-200 ease-in-out dark:border-neutral-900 dark:bg-neutral-950 focus:bg-neutral-50 dark:focus:bg-neutral-900"
              />
              <button
                type="button"
                style="position: absolute; top: 8px; right: 8px; z-index: 50; display: flex; height: 32px; width: 32px; align-items: center; justify-content: center; border-radius: 8px; border: none; cursor: pointer; background: transparent;"
                class="text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-primary-500 dark:hover:bg-neutral-800 dark:hover:text-primary-400"
                title="Optimize with AI"
                @click.prevent="emit('sparkle-click', 'actingModelExpression')"
              >
                <span class="i-ph:sparkle animate-pulse text-lg" style="display: inline-block; width: 1.2em; height: 1.2em;" />
              </button>
            </div>
          </label>
        </div>

        <div class="mt-4 flex flex-col gap-4">
          <!-- Quick Capability Reference Notice -->
          <div class="text-[11px] text-neutral-400 font-medium">
            Click any cue below to insert into prompt directives:
          </div>
          <!-- Emotions & Outfits Section -->
          <div class="flex flex-col gap-2">
            <div class="text-xs text-neutral-600 font-medium dark:text-neutral-300">
              🎨 Emotion & Outfit Cues <span v-if="actingModelEmotionOptions.length">({{ actingModelEmotionOptions.length }})</span>
            </div>
            <div v-if="actingModelEmotionOptions.length" class="flex flex-wrap gap-2">
              <button
                v-for="name in actingModelEmotionOptions"
                :key="name"
                type="button"
                class="flex items-center gap-1 border border-neutral-200 rounded-full px-3 py-1 text-xs text-neutral-600 transition-colors dark:border-neutral-700 hover:border-primary-400 dark:text-neutral-300 hover:text-primary-500"
                @click="props.insertModelEmotion ? props.insertModelEmotion(name) : null"
              >
                <div class="i-solar:palette-bold-duotone text-[10px]" />
                {{ name }}
              </button>
            </div>
            <div v-else class="text-xs text-neutral-400 italic">
              No emotion/outfit variants surfaced for this model.
            </div>
          </div>

          <!-- Motions & Animations Section -->
          <div class="flex flex-col gap-2">
            <div class="text-xs text-neutral-600 font-medium dark:text-neutral-300">
              🏃 Kinetic Motion Cues <span v-if="actingModelMotionOptions.length">({{ actingModelMotionOptions.length }})</span>
            </div>
            <div v-if="actingModelMotionOptions.length" class="flex flex-wrap gap-2">
              <button
                v-for="name in actingModelMotionOptions"
                :key="name"
                type="button"
                class="flex items-center gap-1 border border-primary-200/50 rounded-full bg-primary-50/50 px-3 py-1 text-xs text-primary-700 transition-colors dark:border-primary-900/40 hover:border-primary-400 dark:bg-primary-900/20 dark:text-primary-300 hover:text-primary-500"
                @click="props.insertModelMotion ? props.insertModelMotion(name) : null"
              >
                <div class="i-solar:running-bold-duotone text-[10px]" />
                {{ name }}
              </button>
            </div>
            <div v-else class="text-xs text-neutral-400 italic">
              No motion cues surfaced for this model.
            </div>
          </div>

          <!-- Elemental VFX & Auras Section -->
          <div v-if="!isLive2d" class="flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs text-neutral-600 font-medium dark:text-neutral-300">
              <div class="flex items-center gap-1.5">
                <div class="i-solar:fire-bold-duotone text-orange-500" />
                <span>✨ Elemental VFX & Auras (3D / VRM / MMD)</span>
              </div>
              <span class="text-[10px] text-neutral-400 font-normal">Kinetic Auras & Ground Decals</span>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="vfx in ELEMENTAL_VFX_OPTIONS"
                :key="vfx.key"
                type="button"
                class="flex cursor-pointer items-center gap-1.5 border border-orange-200/50 rounded-full bg-orange-50/40 px-3 py-1 text-xs text-orange-800 transition-colors dark:border-orange-900/40 hover:border-orange-400 dark:bg-orange-950/20 dark:text-orange-300 hover:text-orange-600"
                :title="vfx.desc"
                @click="onInsertVfx(vfx.key)"
              >
                <span>{{ vfx.label }}</span>
                <span class="text-[10px] font-mono opacity-70">{{ vfx.token }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
