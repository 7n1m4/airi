<script setup lang="ts">
import type { VoiceProfile } from '../../../../stores/providers/types'

import { createAudioBlob } from '@proj-airi/stage-shared'
import {
  FieldCheckbox,
  FieldInput,
  FieldRange,
  Textarea,
} from '@proj-airi/ui'
import { generateSpeech } from '@xsai/generate-speech'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { applyVoiceProfileEffects } from '../../../../composables/audio/audio-effects'
import { useAudioContext } from '../../../../stores/audio'
import { useSpeechStore } from '../../../../stores/modules/speech'
import { useProvidersStore } from '../../../../stores/providers'

const providersStore = useProvidersStore()
const speechStore = useSpeechStore()
const { audioContext } = useAudioContext()

const { savedVoiceProfiles } = storeToRefs(speechStore)
const { allAudioSpeechProvidersMetadata } = storeToRefs(providersStore)

// Active selected profile
const activeProfileId = ref<string>('')
const activeProfile = computed(() => savedVoiceProfiles.value.find(p => p.id === activeProfileId.value))

// Voice library search filter
const searchQuery = ref('')
const filteredVoiceProfiles = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const list = savedVoiceProfiles.value.filter(p => p.id !== 'voice_profile_auto_preview')
  if (!query)
    return list

  return list.filter((p) => {
    const name = (p.name || '').toLowerCase()
    const provider = (p.baseProvider || '').toLowerCase()
    const voice = (p.baseVoice || '').toLowerCase()
    return name.includes(query) || provider.includes(query) || voice.includes(query)
  })
})

// UI Form State representing the active profile
const form = ref<VoiceProfile>({
  id: '',
  name: '',
  baseProvider: 'speech-noop',
  baseModel: '',
  baseVoice: '',
  effects: {
    pitch: 0,
    rate: 1,
    volume: 100,
    asmr: 0,
    radio: 0,
    robot: 0,
    reverb: 0,
    spatial: 0,
  },
  ust: {
    enabled: true,
    asterisks: 'flatten',
    squareBrackets: 'mute',
    parentheses: 'ignore',
    angleBrackets: 'flatten',
    customBracketEnabled: false,
    customBracketStart: '',
    customBracketEnd: '',
    customBracketAction: 'ignore',
    stripEmojis: true,
    stripSymbols: true,
    tildeReplacement: 'nyan',
    customReplacements: [],
  },
})

// Available options for the form based on selection

const availableModels = ref<any[]>([])
const availableVoices = ref<any[]>([])
const isLoadingModels = ref(false)
const isLoadingVoices = ref(false)

async function loadBaseProviderModelsAndVoices() {
  const providerId = form.value.baseProvider
  if (!providerId || providerId === 'speech-noop') {
    availableModels.value = []
    availableVoices.value = []
    return
  }

  isLoadingModels.value = true
  isLoadingVoices.value = true

  try {
    const models = await providersStore.getModelsForProvider(providerId) || []
    availableModels.value = models

    // Attempt to load and fetch voices for base provider
    const voices = await speechStore.loadVoicesForProvider(providerId) || []
    availableVoices.value = voices
  }
  catch (e) {
    console.error('Failed to load base provider choices:', e)
  }
  finally {
    isLoadingModels.value = false
    isLoadingVoices.value = false
  }
}

watch(() => form.value.baseProvider, () => {
  void loadBaseProviderModelsAndVoices()
})

// Load profile data into form when selected profile changes
watch(activeProfile, (newProfile) => {
  if (newProfile) {
    const loaded = JSON.parse(JSON.stringify(newProfile))

    // Auto-migrate old profiles so the UI lights up
    if (loaded.ust.enabled && !loaded.ust.asterisks && !loaded.ust.squareBrackets) {
      const legacyMode = loaded.ust.mode || 'mute'
      const defaultAction = legacyMode === 'custom' ? 'ignore' : legacyMode

      loaded.ust.asterisks = defaultAction
      loaded.ust.squareBrackets = defaultAction
      loaded.ust.parentheses = defaultAction
      loaded.ust.angleBrackets = defaultAction
      loaded.ust.customBracketEnabled = false
      loaded.ust.customBracketStart = ''
      loaded.ust.customBracketEnd = ''
      loaded.ust.customBracketAction = 'ignore'
      loaded.ust.customReplacements = loaded.ust.customReplacements || []
    }

    form.value = loaded
  }
}, { immediate: true })

// Initialize list
onMounted(async () => {
  const firstReal = savedVoiceProfiles.value.find(p => p.id !== 'voice_profile_auto_preview')
  if (firstReal && !activeProfileId.value) {
    activeProfileId.value = firstReal.id
  }
  else if (!firstReal) {
    createNewProfile()
  }
})

// Actions
function createNewProfile() {
  const id = `voice_profile_${Date.now()}`
  const newProfile: VoiceProfile = {
    id,
    name: 'New Custom Voice',
    baseProvider: 'speech-noop',
    baseModel: '',
    baseVoice: '',
    effects: {
      pitch: 0,
      rate: 1,
      volume: 100,
      asmr: 0,
      radio: 0,
      robot: 0,
      reverb: 0,
      spatial: 0,
    },
    ust: {
      enabled: true,
      asterisks: 'flatten',
      squareBrackets: 'mute',
      parentheses: 'ignore',
      angleBrackets: 'flatten',
      customBracketEnabled: false,
      customBracketStart: '',
      customBracketEnd: '',
      customBracketAction: 'ignore',
      stripEmojis: true,
      stripSymbols: true,
      tildeReplacement: 'nyan',
      customReplacements: [],
    },
  }
  speechStore.saveVoiceProfile(newProfile)
  activeProfileId.value = id
}

function addCustomReplacement() {
  if (!form.value.ust.customReplacements) {
    form.value.ust.customReplacements = []
  }
  form.value.ust.customReplacements.push({
    id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'text',
    pattern: '',
    replacement: '',
    caseSensitive: false,
    wholeWord: false,
  })
  saveProfile()
}

function removeCustomReplacement(index: number) {
  if (form.value.ust.customReplacements) {
    form.value.ust.customReplacements.splice(index, 1)
    saveProfile()
  }
}

function saveProfile() {
  if (!form.value.id)
    return
  speechStore.saveVoiceProfile(JSON.parse(JSON.stringify(form.value)))
}

function deleteProfile(id: string) {
  speechStore.deleteVoiceProfile(id)
  const remaining = savedVoiceProfiles.value.filter(p => p.id !== 'voice_profile_auto_preview')
  if (activeProfileId.value === id) {
    activeProfileId.value = remaining[0]?.id || ''
  }
  if (remaining.length === 0) {
    createNewProfile()
  }
}

function duplicateProfile(profile: VoiceProfile) {
  const duplicated: VoiceProfile = JSON.parse(JSON.stringify(profile))
  duplicated.id = `voice_profile_${Date.now()}`
  duplicated.name = `${profile.name} (Copy)`
  speechStore.saveVoiceProfile(duplicated)
  activeProfileId.value = duplicated.id
}

// Playground Logic
const testText = ref('Hello, I am testing my new custom voice in the Audio Studio playground!')
const isGenerating = ref(false)
const audioUrl = ref('')
let currentPlayNode: AudioBufferSourceNode | null = null
let currentEffectsCleanup: (() => void) | undefined

async function playTestVoice() {
  if (!testText.value.trim() || isGenerating.value)
    return

  isGenerating.value = true

  try {
    stopTestAudio()

    const providerId = form.value.baseProvider
    const model = form.value.baseModel
    const voiceId = form.value.baseVoice

    if (providerId === 'speech-noop' || !model || !voiceId) {
      console.warn('Sandbox requires provider, model, and voice options to be set')
      isGenerating.value = false
      return
    }

    const provider = await providersStore.getProviderInstance(providerId) as any
    const providerConfig = providersStore.getProviderConfig(providerId)

    // Apply the UST text stripping rules configured in our form to the text
    const transformedText = speechStore.transformTextForSpeech(testText.value, 'virtual-audio-studio')

    const response = await generateSpeech({
      ...provider.speech(model, providerConfig),
      input: transformedText,
      voice: voiceId,
    })

    if (!response || response.byteLength === 0) {
      isGenerating.value = false
      return
    }

    // Set downloadable audio source URL
    audioUrl.value = URL.createObjectURL(createAudioBlob(response))

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    const audioBuffer = await audioContext.decodeAudioData(response.slice(0)) // Slice to clone since decodeAudioData detaches the buffer
    const source = audioContext.createBufferSource()
    source.buffer = audioBuffer
    currentPlayNode = source

    // Connect Xvan's Web Audio API effect nodes
    const effectsResult = applyVoiceProfileEffects(audioContext, source, form.value.effects)
    currentEffectsCleanup = effectsResult.cleanup

    effectsResult.lastNode.connect(audioContext.destination)

    source.start(0)

    source.onended = () => {
      stopTestAudio(false) // Don't clear audioUrl when natural end happens so user can still download/use native controls
    }
  }
  catch (error) {
    console.error('Playground generation error:', error)
  }
  finally {
    isGenerating.value = false
  }
}

function stopTestAudio(clearUrl = true) {
  if (currentPlayNode) {
    try {
      currentPlayNode.stop()
    }
    catch {}
    currentPlayNode = null
  }
  if (currentEffectsCleanup) {
    currentEffectsCleanup()
    currentEffectsCleanup = undefined
  }
  if (clearUrl && audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value)
    audioUrl.value = ''
  }
}

onUnmounted(() => {
  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value)
  }
})
</script>

<template>
  <div flex="~ col lg:row gap-6" class="w-full text-sm">
    <!-- Profile List Sidebar -->
    <div class="min-w-[240px] flex flex-col gap-4 rounded-2xl bg-neutral-100/50 p-4 lg:w-[30%] dark:bg-neutral-900/30">
      <div flex="~ row items-center justify-between">
        <h3 class="text-base text-neutral-500 font-bold dark:text-neutral-400">
          Voice Library
        </h3>
        <button
          class="flex items-center gap-1 border border-neutral-300 rounded-lg bg-neutral-200/50 px-2 py-1 text-xs text-neutral-700 font-medium dark:border-neutral-800 dark:bg-neutral-800/40 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
          @click="createNewProfile"
        >
          <div i-solar:add-circle-bold-duotone />
          <span>New Profile</span>
        </button>
      </div>

      <!-- Search Filter Input -->
      <div class="relative flex items-center">
        <div class="i-solar:magnifer-linear pointer-events-none absolute left-3 text-xs text-neutral-400 dark:text-neutral-500" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Filter voice profiles..."
          class="w-full border border-neutral-200/80 rounded-xl bg-white/80 py-1.5 pl-8 pr-7 text-xs text-neutral-800 outline-none transition-colors dark:border-neutral-800/80 focus:border-primary-500 dark:bg-neutral-900/80 dark:text-neutral-200 dark:focus:border-primary-500"
        >
        <button
          v-if="searchQuery"
          class="absolute right-2.5 rounded p-0.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
          title="Clear search"
          @click="searchQuery = ''"
        >
          <div class="i-solar:close-circle-bold text-xs" />
        </button>
      </div>

      <div class="max-h-[350px] flex flex-col gap-2 overflow-y-auto lg:max-h-[500px]">
        <div
          v-for="profile in filteredVoiceProfiles"
          :key="profile.id"
          class="group flex cursor-pointer items-center justify-between border rounded-xl p-3 transition-all duration-200"
          :class="[
            activeProfileId === profile.id
              ? 'border-primary-500/50 bg-primary-500/10 text-primary-600 dark:text-primary-400'
              : 'border-neutral-200/70 bg-white/70 dark:border-neutral-800/60 dark:bg-neutral-900/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/40',
          ]"
          @click="activeProfileId = profile.id"
        >
          <div flex="~ col gap-0.5">
            <span class="font-semibold">{{ profile.name }}</span>
            <span class="text-xs opacity-60">{{ profile.baseProvider !== 'speech-noop' ? `${profile.baseProvider} / ${profile.baseVoice}` : 'Not bound' }}</span>
          </div>

          <div class="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              class="rounded p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700/60"
              @click.stop="duplicateProfile(profile)"
            >
              <div i-solar:copy-bold-duotone class="text-sm text-neutral-400 dark:text-neutral-500" />
            </button>
            <button
              class="rounded p-1 hover:bg-red-500/10"
              @click.stop="deleteProfile(profile.id)"
            >
              <div i-solar:trash-bin-trash-bold-duotone class="text-sm text-red-500" />
            </button>
          </div>
        </div>

        <div v-if="filteredVoiceProfiles.length === 0" class="py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
          No voice profiles found matching "{{ searchQuery }}"
        </div>
      </div>
    </div>

    <!-- Configuration Panels -->
    <div flex="~ col gap-6" class="flex-1">
      <!-- Base Settings Card -->
      <div class="flex flex-col gap-6 rounded-2xl bg-neutral-100/50 p-6 dark:bg-neutral-900/30">
        <div>
          <h3 class="text-base text-neutral-500 font-bold dark:text-neutral-400">
            Voice Settings Profile
          </h3>
          <p class="text-xs text-neutral-400 dark:text-neutral-500">
            Link this profile to a base provider engine and define custom name
          </p>
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FieldInput
            v-model="form.name"
            label="Profile Name"
            description="Give your virtual voice profile a recognizable name"
            placeholder="e.g. Neuro Ashley"
            @update:model-value="saveProfile"
          />

          <div class="flex flex-col gap-1.5">
            <label class="text-sm text-neutral-500 font-medium dark:text-neutral-400">Base Provider</label>
            <select
              v-model="form.baseProvider"
              class="w-full border border-neutral-300 rounded-xl bg-white px-3 py-2 text-sm outline-none dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-900"
              @change="saveProfile"
            >
              <option value="speech-noop">
                None (No-op)
              </option>
              <option
                v-for="provider in allAudioSpeechProvidersMetadata.filter(p => p.id !== 'virtual-audio-studio' && p.id !== 'speech-noop')"
                :key="provider.id"
                :value="provider.id"
              >
                {{ provider.name }}
              </option>
            </select>
          </div>

          <div v-if="form.baseProvider !== 'speech-noop'" class="flex flex-col gap-1.5">
            <label class="text-sm text-neutral-500 font-medium dark:text-neutral-400">Model</label>
            <div v-if="isLoadingModels" class="animate-pulse text-xs text-neutral-400">
              Loading models...
            </div>
            <select
              v-else
              v-model="form.baseModel"
              class="w-full border border-neutral-300 rounded-xl bg-white px-3 py-2 text-sm outline-none dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-900"
              @change="saveProfile"
            >
              <option value="">
                Select a model
              </option>
              <option
                v-for="model in availableModels"
                :key="model.id"
                :value="model.id"
              >
                {{ model.name || model.id }}
              </option>
            </select>
          </div>

          <div v-if="form.baseProvider !== 'speech-noop'" class="flex flex-col gap-1.5">
            <label class="text-sm text-neutral-500 font-medium dark:text-neutral-400">Voice</label>
            <div v-if="isLoadingVoices" class="animate-pulse text-xs text-neutral-400">
              Loading voices...
            </div>
            <template v-else>
              <!-- Dropdown when the provider can list voices -->
              <select
                v-if="availableVoices.length > 0"
                v-model="form.baseVoice"
                class="w-full border border-neutral-300 rounded-xl bg-white px-3 py-2 text-sm outline-none dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-900"
                @change="saveProfile"
              >
                <option value="">
                  Select a voice
                </option>
                <option
                  v-for="voice in availableVoices"
                  :key="voice.id"
                  :value="voice.id"
                >
                  {{ voice.name || voice.id }}
                </option>
              </select>
              <!-- Free-text fallback when voice list couldn't be fetched -->
              <input
                v-else
                v-model="form.baseVoice"
                type="text"
                placeholder="Enter voice name manually (e.g. Abigail)"
                class="w-full border border-neutral-300 rounded-xl bg-white px-3 py-2 text-sm outline-none dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-900"
                @change="saveProfile"
              >
            </template>
          </div>
        </div>
      </div>

      <!-- Effects Sliders Panel -->
      <div class="flex flex-col gap-6 rounded-2xl bg-neutral-100/50 p-6 dark:bg-neutral-900/30">
        <div>
          <h3 class="text-base text-neutral-500 font-bold dark:text-neutral-400">
            Audio Transformation Effects (DSP)
          </h3>
          <p class="text-xs text-neutral-400 dark:text-neutral-500">
            Adjust Web Audio API synthesis effects in real time
          </p>
        </div>

        <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
          <FieldRange
            v-model="form.effects.pitch"
            label="Pitch Tuning"
            description="Scales sample pitch via playback rate"
            :min="-100"
            :max="100"
            :step="1"
            :format-value="val => `${val}%`"
            @update:model-value="saveProfile"
          />

          <FieldRange
            v-model="form.effects.rate"
            label="Speech Speed"
            description="Adjust general speech rate multiplier"
            :min="0.5"
            :max="2.5"
            :step="0.05"
            :format-value="val => `${val}x`"
            @update:model-value="saveProfile"
          />

          <FieldRange
            v-model="form.effects.asmr"
            label="ASMR Intimacy / Softness"
            description="Dampens high sibilants and adds voice compression"
            :min="0"
            :max="100"
            :step="1"
            :format-value="val => `${val}%`"
            @update:model-value="saveProfile"
          />

          <FieldRange
            v-model="form.effects.radio"
            label="Retro Radio Filter"
            description="Applies telephone bandpass frequency cuts"
            :min="0"
            :max="100"
            :step="1"
            :format-value="val => `${val}%`"
            @update:model-value="saveProfile"
          />

          <FieldRange
            v-model="form.effects.robot"
            label="Robotic Comb Delay"
            description="Feedback metallic echo droid ring modulation"
            :min="0"
            :max="100"
            :step="1"
            :format-value="val => `${val}%`"
            @update:model-value="saveProfile"
          />

          <FieldRange
            v-model="form.effects.reverb"
            label="Cathedral Reverb / Space Echo"
            description="350ms multi-tap delay acoustics decay"
            :min="0"
            :max="100"
            :step="1"
            :format-value="val => `${val}%`"
            @update:model-value="saveProfile"
          />

          <FieldRange
            v-model="form.effects.spatial"
            label="Stereo Panning"
            description="Shift voice placement left to right"
            :min="-100"
            :max="100"
            :step="1"
            :format-value="val => val === 0 ? 'Center' : val < 0 ? `Left ${Math.abs(val)}%` : `Right ${val}%`"
            @update:model-value="saveProfile"
          />
        </div>
      </div>

      <!-- UST Settings Panel -->
      <div class="flex flex-col gap-6 rounded-2xl bg-neutral-100/50 p-6 dark:bg-neutral-900/30">
        <div flex="~ row items-center justify-between">
          <div>
            <h3 class="text-base text-neutral-500 font-bold dark:text-neutral-400">
              Universal Speech Transformer
            </h3>
            <p class="text-xs text-neutral-400 dark:text-neutral-500">
              Granular per-profile text stripping filters
            </p>
          </div>
          <FieldCheckbox
            v-model="form.ust.enabled"
            hide-description
            @update:model-value="saveProfile"
          />
        </div>

        <div v-if="form.ust.enabled" class="flex flex-col gap-6">
          <!-- Option A: Bracket-by-Bracket Action Mapper -->
          <div class="flex flex-col gap-3">
            <div class="text-sm text-neutral-600 font-semibold dark:text-neutral-300">
              Bracket Rules
            </div>
            <div class="grid grid-cols-1 gap-4 border border-neutral-200/60 rounded-xl bg-white p-4 dark:border-neutral-800/60 dark:bg-neutral-900/60">
              <!-- Asterisks -->
              <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div class="flex flex-col">
                  <span class="text-xs text-neutral-700 font-bold dark:text-neutral-300">Asterisks (*...*)</span>
                  <span class="text-[10px] text-neutral-400">Used for italics, actions, or emotes</span>
                </div>
                <div class="flex gap-1.5">
                  <button
                    v-for="act in (['mute', 'flatten', 'ignore'] as const)"
                    :key="act"
                    type="button"
                    class="border rounded-lg px-2.5 py-1 text-[10px] font-semibold capitalize transition-all"
                    :class="[
                      form.ust.asterisks === act
                        ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                        : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800',
                    ]"
                    @click="form.ust.asterisks = act; saveProfile()"
                  >
                    {{ act }}
                  </button>
                </div>
              </div>

              <!-- Square Brackets -->
              <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div class="flex flex-col">
                  <span class="text-xs text-neutral-700 font-bold dark:text-neutral-300">Square Brackets ([...])</span>
                  <span class="text-[10px] text-neutral-400">Used for emotions, states, or labels</span>
                </div>
                <div class="flex gap-1.5">
                  <button
                    v-for="act in (['mute', 'flatten', 'ignore', 'token'] as const)"
                    :key="act"
                    type="button"
                    class="border rounded-lg px-2.5 py-1 text-[10px] font-semibold capitalize transition-all"
                    :class="[
                      form.ust.squareBrackets === act
                        ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                        : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800',
                    ]"
                    @click="form.ust.squareBrackets = act; saveProfile()"
                  >
                    {{ act === 'token' ? 'Convert to Token' : act }}
                  </button>
                </div>
              </div>

              <!-- Parentheses -->
              <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div class="flex flex-col">
                  <span class="text-xs text-neutral-700 font-bold dark:text-neutral-300">Parentheses ((...))</span>
                  <span class="text-[10px] text-neutral-400">Used for whispers or background info</span>
                </div>
                <div class="flex gap-1.5">
                  <button
                    v-for="act in (['mute', 'flatten', 'ignore'] as const)"
                    :key="act"
                    type="button"
                    class="border rounded-lg px-2.5 py-1 text-[10px] font-semibold capitalize transition-all"
                    :class="[
                      form.ust.parentheses === act
                        ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                        : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800',
                    ]"
                    @click="form.ust.parentheses = act; saveProfile()"
                  >
                    {{ act }}
                  </button>
                </div>
              </div>

              <!-- Angle Brackets -->
              <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div class="flex flex-col">
                  <span class="text-xs text-neutral-700 font-bold dark:text-neutral-300">Angle Brackets (&lt;...&gt;)</span>
                  <span class="text-[10px] text-neutral-400">Used for speech indicators or tags</span>
                </div>
                <div class="flex gap-1.5">
                  <button
                    v-for="act in (['mute', 'flatten', 'ignore'] as const)"
                    :key="act"
                    type="button"
                    class="border rounded-lg px-2.5 py-1 text-[10px] font-semibold capitalize transition-all"
                    :class="[
                      form.ust.angleBrackets === act
                        ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                        : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800',
                    ]"
                    @click="form.ust.angleBrackets = act; saveProfile()"
                  >
                    {{ act }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Custom Bracket Definition -->
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="text-xs text-neutral-700 font-bold dark:text-neutral-300">Enable Custom Bracket</span>
              <FieldCheckbox
                v-model="form.ust.customBracketEnabled"
                hide-description
                @update:model-value="saveProfile"
              />
            </div>
            <div v-if="form.ust.customBracketEnabled" class="grid grid-cols-3 gap-3 border border-neutral-200/60 rounded-xl bg-white p-4 dark:border-neutral-800/60 dark:bg-neutral-900/60">
              <FieldInput
                v-model="form.ust.customBracketStart"
                label="Start Symbol"
                placeholder="e.g. {"
                @update:model-value="saveProfile"
              />
              <FieldInput
                v-model="form.ust.customBracketEnd"
                label="End Symbol"
                placeholder="e.g. }"
                @update:model-value="saveProfile"
              />
              <div class="flex flex-col gap-1.5">
                <label class="text-xs text-neutral-500 font-semibold">Action</label>
                <select
                  v-model="form.ust.customBracketAction"
                  class="w-full border border-neutral-200 rounded-xl bg-white px-3 py-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-900 focus:outline-none"
                  @change="saveProfile"
                >
                  <option value="mute">
                    Mute
                  </option>
                  <option value="flatten">
                    Flatten
                  </option>
                  <option value="ignore">
                    Ignore
                  </option>
                </select>
              </div>
            </div>
          </div>

          <!-- Emoji, Symbol & Tilde Replacements -->
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FieldCheckbox
              v-model="form.ust.stripEmojis"
              label="Strip Emojis"
              description="Wipes Unicode pictographs so TTS does not create pauses"
              @update:model-value="saveProfile"
            />

            <FieldCheckbox
              v-model="form.ust.stripSymbols"
              label="Strip Symbols & Kaomoji"
              description="Wipes non-alphanumeric symbols and kaomoji (Extreme Cleaning)"
              @update:model-value="saveProfile"
            />

            <FieldInput
              v-model="form.ust.tildeReplacement"
              label="Tilde (~) Replacement String"
              description="Word to read when tildes are spoken (e.g. 'nyan'). Leave blank to strip."
              placeholder="e.g. nyan"
              @update:model-value="saveProfile"
            />
          </div>

          <!-- Custom Replacement Rules Builder -->
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between border-t border-neutral-200/50 pt-4 dark:border-neutral-800/50">
              <span class="text-sm text-neutral-600 font-semibold dark:text-neutral-300">Custom Replacement Rules</span>
              <button
                type="button"
                class="flex items-center gap-1 border border-primary-500 rounded-lg bg-primary-500/10 px-2 py-1 text-xs text-primary-600 font-semibold hover:bg-primary-500/20 dark:text-primary-400"
                @click="addCustomReplacement"
              >
                <span class="text-xs">+ Add Rule</span>
              </button>
            </div>

            <div v-if="form.ust.customReplacements && form.ust.customReplacements.length > 0" class="flex flex-col gap-3">
              <div
                v-for="(rule, index) in form.ust.customReplacements"
                :key="rule.id"
                class="flex flex-col gap-3 border border-neutral-200/60 rounded-xl bg-white p-4 dark:border-neutral-800/60 dark:bg-neutral-900/60"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="flex gap-1.5">
                    <button
                      type="button"
                      class="border rounded-lg px-2 py-0.5 text-[10px] font-semibold transition-all"
                      :class="[
                        rule.type === 'text'
                          ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                          : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800',
                      ]"
                      @click="rule.type = 'text'; saveProfile()"
                    >
                      Plain Text
                    </button>
                    <button
                      type="button"
                      class="border rounded-lg px-2 py-0.5 text-[10px] font-semibold transition-all"
                      :class="[
                        rule.type === 'regex'
                          ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                          : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800',
                      ]"
                      @click="rule.type = 'regex'; saveProfile()"
                    >
                      Regex Match
                    </button>
                  </div>

                  <button
                    type="button"
                    class="text-[10px] text-red-500 font-bold hover:underline"
                    @click="removeCustomReplacement(index)"
                  >
                    Remove
                  </button>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <FieldInput
                    v-model="rule.pattern"
                    label="Search Pattern"
                    :placeholder="rule.type === 'regex' ? 'e.g. /nya/i' : 'e.g. Nya'"
                    @update:model-value="saveProfile"
                  />
                  <FieldInput
                    v-model="rule.replacement"
                    label="Replacement"
                    placeholder="e.g. meow"
                    @update:model-value="saveProfile"
                  />
                </div>

                <div v-if="rule.type === 'text'" class="flex items-center gap-4">
                  <FieldCheckbox
                    v-model="rule.caseSensitive"
                    label="Case Sensitive"
                    hide-description
                    @update:model-value="saveProfile"
                  />
                  <FieldCheckbox
                    v-model="rule.wholeWord"
                    label="Whole Word Only"
                    hide-description
                    @update:model-value="saveProfile"
                  />
                </div>
              </div>
            </div>
            <p v-else class="py-2 text-center text-xs text-neutral-400 italic">
              No custom replacement rules defined yet.
            </p>
          </div>
        </div>
      </div>

      <!-- Dynamic Test Playground -->
      <div class="flex flex-col gap-4 border border-primary-500/20 rounded-2xl bg-primary-500/5 p-6">
        <div>
          <h3 class="text-base text-primary-600 font-bold dark:text-primary-400">
            Audio Studio Sandbox Playground
          </h3>
          <p class="text-xs text-neutral-400 dark:text-neutral-500">
            Synthesize and listen to your custom effects stack immediately
          </p>
        </div>

        <Textarea
          v-model="testText"
          h-20
          w-full
          placeholder="Enter some text here to test your effects..."
        />

        <div flex="~ row gap-3">
          <button
            class="flex items-center gap-2 border border-primary-500 rounded-xl bg-primary-500 px-4 py-2 text-sm text-white font-semibold transition-opacity"
            :disabled="isGenerating || form.baseProvider === 'speech-noop' || !form.baseVoice"
            :class="{ 'opacity-50 cursor-not-allowed': isGenerating || form.baseProvider === 'speech-noop' || !form.baseVoice }"
            @click="playTestVoice"
          >
            <div v-if="isGenerating" class="mr-1 animate-spin">
              <div i-solar:spinner-line-duotone class="text-base" />
            </div>
            <div v-else i-solar:play-circle-bold class="text-base" />
            <span>{{ isGenerating ? 'Generating Audio...' : 'Test Custom voice' }}</span>
          </button>

          <button
            class="flex items-center gap-2 border border-neutral-300 rounded-xl bg-transparent px-4 py-2 text-sm text-neutral-500 transition-colors dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            @click="stopTestAudio(true)"
          >
            <div i-solar:stop-circle-bold class="text-base" />
            <span>Stop Playback</span>
          </button>
        </div>

        <div v-if="audioUrl" class="mt-2 flex flex-col gap-2">
          <span class="text-xs text-neutral-400 font-medium dark:text-neutral-500">Generated Sample File (Raw TTS):</span>
          <audio :src="audioUrl" controls class="w-full border border-neutral-200 rounded-lg bg-white/50 p-1 dark:border-neutral-800 dark:bg-neutral-900/50" />
        </div>
      </div>
    </div>
  </div>
</template>
