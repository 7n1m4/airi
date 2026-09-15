<script setup lang="ts">
import type { VoiceInfo } from '@proj-airi/stage-ui/stores/providers'
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import {
  ProcessLifecycleCard,
  SpeechPlayground,
  SpeechProviderSettings,
} from '@proj-airi/stage-ui/components'
import { useProcessSpawner } from '@proj-airi/stage-ui/composables'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { FieldRange, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

export interface AudioServerVoice {
  id: string
  name: string
  description?: string
  type?: string
  preview_url?: string
  has_transcript?: boolean
  reference_text?: string
  model_compatibility?: string[]
  has_audio?: boolean
}

interface SpeechExpressionTag {
  tag: string
  category?: string
  description?: string
  example?: string
}

const { t } = useI18n()
const speechStore = useSpeechStore()
const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore)

const providerId = 'airi-audio-server'
const defaultModel = 'omnivoice-tts'
const defaultBaseUrl = 'http://127.0.0.1:8095/v1/'

const defaultVoiceSettings = {
  speed: 1.0,
}

// Speed slider ref
const speed = ref<number>(
  (providers.value[providerId] as any)?.voiceSettings?.speed
  || (providers.value[providerId] as any)?.speed
  || defaultVoiceSettings.speed,
)

// Active Model
const model = computed<string>({
  get: () => (providers.value[providerId]?.model as string) || defaultModel,
  set: (value: string) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].model = value
  },
})

// Active Voice
const voice = computed<string>({
  get: () => (providers.value[providerId]?.voice as string) || '',
  set: (value: string) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].voice = value
  },
})

// Discovered runtime state
const isCheckingHealth = ref(false)
const serverOnline = ref<boolean | null>(null)
const serverError = ref('')
const discoveredModels = ref<Array<{ id: string, name: string, description?: string }>>([])
const discoveredVoices = ref<Array<{ id: string, name: string, description?: string, type?: string, previewURL?: string }>>([])
const expressionTags = ref<SpeechExpressionTag[]>([])

// Voice Curation State
const voicesList = ref<AudioServerVoice[]>([])
const searchQuery = ref('')
const selectedFilter = ref<'all' | 'verified' | 'needs_transcript' | 'cloned'>('all')

// Audio Preview Player
const activePreviewVoiceId = ref<string | null>(null)
const previewAudio = ref<HTMLAudioElement | null>(null)
const previewObjectUrl = ref<string | null>(null)
const isPreviewLoading = ref(false)

// Upload & Clone Voice Modal State
const isUploadModalOpen = ref(false)
const uploadFileInputRef = ref<HTMLInputElement | null>(null)
const isDraggingAudio = ref(false)
const isUploading = ref(false)
const uploadError = ref('')
const uploadForm = ref({
  name: '',
  referenceText: '',
  file: null as File | null,
})

// Edit Transcript Modal State
const isEditTranscriptModalOpen = ref(false)
const editingVoice = ref<AudioServerVoice | null>(null)
const editingTranscriptText = ref('')
const isSavingTranscript = ref(false)
const editTranscriptError = ref('')

// Delete Confirmation Modal State
const isDeleteModalOpen = ref(false)
const voiceToDelete = ref<AudioServerVoice | null>(null)
const isDeletingVoice = ref(false)

const baseUrl = computed<string>(() => {
  const url = (providers.value[providerId]?.baseUrl as string) || defaultBaseUrl
  return url.endsWith('/') ? url : `${url}/`
})

function getAuthHeaders(): Record<string, string> {
  const apiKey = (providers.value[providerId]?.apiKey as string)?.trim()
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

// Quick Start copy helper
const copiedStep = ref<number | null>(null)
function copyCommand(cmd: string, stepIndex: number) {
  if (typeof navigator !== 'undefined') {
    navigator.clipboard.writeText(cmd)
    copiedStep.value = stepIndex
    setTimeout(() => {
      if (copiedStep.value === stepIndex)
        copiedStep.value = null
    }, 2000)
  }
}

// --- AIRI Audio Server Process Spawner & Lifecycle ---
const audioSpawner = useProcessSpawner({
  storageKeyPrefix: 'settings/providers/airi-audio-server',
  defaultSpawnCommand: (providers.value[providerId]?.spawnCommand as string) || '',
  defaultStopCommand: (providers.value[providerId]?.stopCommand as string) || '',
  defaultAutoSpawn: Boolean(providers.value[providerId]?.autoSpawnOnLaunch),
  spawnSuccessDelayMs: 1500,
  stopSuccessDelayMs: 1000,
  onSpawnSuccess: checkServerStatus,
  onStopSuccess: checkServerStatus,
})

async function checkServerStatus() {
  isCheckingHealth.value = true
  serverError.value = ''
  try {
    const rawUrl = baseUrl.value
    const rootUrl = rawUrl.replace(/\/v1\/?$/, '/')

    // 1. Health / Models check
    const modelsRes = await fetch(`${rawUrl}models`, { headers: getAuthHeaders() }).catch(() => null)
    const healthRes = await fetch(`${rootUrl}health`, { headers: getAuthHeaders() }).catch(() => null)

    if ((modelsRes && modelsRes.ok) || (healthRes && healthRes.ok)) {
      serverOnline.value = true
    }
    else {
      serverOnline.value = false
      serverError.value = 'Server did not respond on configured port. Is airi-audio-server running?'
    }

    // 2. Query models
    if (modelsRes && modelsRes.ok) {
      const data = await modelsRes.json()
      const list = Array.isArray(data?.data) ? data.data : []
      if (list.length > 0) {
        discoveredModels.value = list.map((m: any) => ({
          id: m.id,
          name: m.name || m.display_name || m.id,
          description: m.description,
        }))
      }
    }

    // 3. Query voices with rich zero-shot metadata
    const voicesRes = await fetch(`${rawUrl}voices`, { headers: getAuthHeaders() }).catch(() => null)
    if (voicesRes && voicesRes.ok) {
      const data = await voicesRes.json()
      const list = Array.isArray(data?.voices) ? data.voices : []
      voicesList.value = list.map((v: any) => ({
        id: v.voice_id || v.id || v.name,
        name: v.name || v.voice_id || v.id,
        description: v.description || (v.type === 'cloned' ? 'Cloned reference voice' : 'Built-in voice'),
        type: v.type || 'system',
        preview_url: v.preview_url || v.preview_audio_url || (v.has_audio ? `${baseUrl.value}voices/${v.id || v.voice_id}/audio` : undefined),
        has_transcript: v.has_transcript ?? !!(v.reference_text && v.reference_text.trim()),
        reference_text: v.reference_text || '',
        model_compatibility: Array.isArray(v.model_compatibility) ? v.model_compatibility : [],
        has_audio: v.has_audio ?? true,
      }))

      discoveredVoices.value = voicesList.value.map(v => ({
        id: v.id,
        name: v.name,
        description: v.description,
        type: v.type,
        previewURL: v.preview_url,
      }))

      if (!voice.value && discoveredVoices.value.length > 0) {
        voice.value = discoveredVoices.value[0].id
      }
    }

    // 4. Query capabilities (paralinguistic tags)
    const capEndpoints = [
      `${rawUrl}capabilities`,
      `${rootUrl}capabilities`,
      `${rootUrl}chatterbox/capabilities`,
    ]
    for (const endpoint of capEndpoints) {
      try {
        const capRes = await fetch(endpoint, { headers: getAuthHeaders() })
        if (capRes.ok) {
          const capData = await capRes.json()
          const tags = capData?.speech?.expressionTags || capData?.expressionTags
          if (Array.isArray(tags) && tags.length > 0) {
            expressionTags.value = tags
            break
          }
          if (Array.isArray(capData?.tags) && capData.tags.length > 0) {
            expressionTags.value = capData.tags.map((t: string) => ({ tag: t }))
            break
          }
        }
      }
      catch {}
    }
  }
  catch (err) {
    serverOnline.value = false
    serverError.value = (err as Error).message
  }
  finally {
    isCheckingHealth.value = false
  }
}

// Fallback Voice Catalog
const fallbackVoices: VoiceInfo[] = [
  { id: 'omnivoice-default', name: 'OmniVoice Default (Female Warm)', provider: providerId, languages: [{ code: 'en-US', title: 'English' }] },
  { id: 'female-calm', name: 'Female Calm', provider: providerId, languages: [{ code: 'en-US', title: 'English' }] },
  { id: 'male-deep', name: 'Male Deep', provider: providerId, languages: [{ code: 'en-US', title: 'English' }] },
  { id: 'anime-girl', name: 'Anime Girl (Energetic)', provider: providerId, languages: [{ code: 'en-US', title: 'English' }] },
  { id: 'chatterbox-default', name: 'Chatterbox Default', provider: providerId, languages: [{ code: 'en-US', title: 'English' }] },
]

const availableVoices = computed<VoiceInfo[]>(() => {
  if (discoveredVoices.value.length > 0) {
    return discoveredVoices.value.map(v => ({
      id: v.id,
      name: v.name,
      provider: providerId,
      languages: [{ code: 'en-US', title: 'English' }],
      description: v.description,
      previewURL: v.previewURL,
    }))
  }
  const storeVoices = speechStore.availableVoices[providerId] || []
  if (storeVoices.length > 0) {
    return storeVoices
  }
  return fallbackVoices
})

const defaultModelOptions = [
  { value: 'omnivoice-tts', label: 'OmniVoice Q8_0 (Recommended)' },
  { value: 'higgs-audio-tts', label: 'Higgs Audio v3 TTS Q8_0' },
  { value: 'fish-audio-tts', label: 'Fish Audio S2 Pro Q8_0' },
  { value: 'chatterbox-tts', label: 'Chatterbox TTS Q8_0' },
  { value: 'moss-tts', label: 'MOSS TTS Local v1.5 Q8_0' },
]

const modelOptions = computed(() => {
  if (discoveredModels.value.length > 0) {
    return discoveredModels.value.map(m => ({
      value: m.id,
      label: m.name,
    }))
  }
  return defaultModelOptions
})

// Curation Stats & Filtering
const totalVoices = computed(() => voicesList.value.length)
const verifiedVoicesCount = computed(() => voicesList.value.filter(v => v.has_transcript).length)
const needsTranscriptCount = computed(() => voicesList.value.filter(v => !v.has_transcript).length)
const clonedVoicesCount = computed(() => voicesList.value.filter(v => v.type === 'cloned' || v.type === 'custom').length)

const filteredVoices = computed(() => {
  let list = voicesList.value

  // 1. Category Filter
  if (selectedFilter.value === 'verified') {
    list = list.filter(v => v.has_transcript)
  }
  else if (selectedFilter.value === 'needs_transcript') {
    list = list.filter(v => !v.has_transcript)
  }
  else if (selectedFilter.value === 'cloned') {
    list = list.filter(v => v.type === 'cloned' || v.type === 'custom')
  }

  // 2. Search Query Filter
  const query = searchQuery.value.trim().toLowerCase()
  if (query) {
    list = list.filter(v =>
      v.name.toLowerCase().includes(query)
      || v.id.toLowerCase().includes(query)
      || (v.reference_text && v.reference_text.toLowerCase().includes(query))
      || (v.description && v.description.toLowerCase().includes(query)),
    )
  }

  return list
})

// Audio Preview Handling
function stopVoicePreview() {
  if (previewAudio.value) {
    previewAudio.value.pause()
    previewAudio.value = null
  }
  if (previewObjectUrl.value) {
    URL.revokeObjectURL(previewObjectUrl.value)
    previewObjectUrl.value = null
  }
  activePreviewVoiceId.value = null
  isPreviewLoading.value = false
}

function formatServerErrorMessage(err: any, endpointName: string): string {
  const message = err?.message || ''
  if (message.includes('404') || err?.status === 404) {
    return `${endpointName} endpoint not found (HTTP 404). Please update your airi-audio-server to the latest commit.`
  }
  return err?.message || 'Unknown error occurred'
}

async function toggleVoicePreview(v: AudioServerVoice) {
  if (activePreviewVoiceId.value === v.id) {
    stopVoicePreview()
    return
  }

  stopVoicePreview()
  activePreviewVoiceId.value = v.id
  isPreviewLoading.value = true

  try {
    let audioUrl = v.preview_url
    if (!audioUrl) {
      audioUrl = `${baseUrl.value}voices/${encodeURIComponent(v.id)}/audio`
    }
    else if (audioUrl.startsWith('/')) {
      const root = baseUrl.value.replace(/\/v1\/?$/, '')
      audioUrl = `${root}${audioUrl}`
    }

    const res = await fetch(audioUrl, { headers: getAuthHeaders() })
    if (!res.ok) {
      const error: any = new Error(`Server returned HTTP ${res.status}`)
      error.status = res.status
      throw error
    }

    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    previewObjectUrl.value = objectUrl

    const audio = new Audio(objectUrl)
    previewAudio.value = audio

    audio.onended = () => {
      stopVoicePreview()
    }

    audio.onerror = () => {
      stopVoicePreview()
      toast.error('Failed to decode audio preview')
    }

    await audio.play()
  }
  catch (err: any) {
    stopVoicePreview()
    toast.error(`Audio preview error: ${formatServerErrorMessage(err, 'Voice audio preview')}`)
  }
  finally {
    isPreviewLoading.value = false
  }
}

// Upload & Clone Handlers
function openUploadModal() {
  uploadForm.value = {
    name: '',
    referenceText: '',
    file: null,
  }
  uploadError.value = ''
  isUploadModalOpen.value = true
}

function handleUploadFileSelected(file: File) {
  uploadForm.value.file = file
  if (!uploadForm.value.name.trim()) {
    uploadForm.value.name = file.name
      .replace(/\.[^/.]+$/, '')
      .replace(/[-_]/g, ' ')
      .trim()
  }
}

function onUploadFileInputChange(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    handleUploadFileSelected(file)
  }
  target.value = ''
}

function onUploadDrop(e: DragEvent) {
  isDraggingAudio.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) {
    handleUploadFileSelected(file)
  }
}

async function submitVoiceUpload() {
  if (!uploadForm.value.file) {
    uploadError.value = 'Please select or drop an audio file.'
    return
  }
  if (!uploadForm.value.name.trim()) {
    uploadError.value = 'Please provide a name for this voice.'
    return
  }

  isUploading.value = true
  uploadError.value = ''

  try {
    const formData = new FormData()
    formData.append('audio', uploadForm.value.file)
    formData.append('name', uploadForm.value.name.trim())
    if (uploadForm.value.referenceText.trim()) {
      formData.append('reference_text', uploadForm.value.referenceText.trim())
    }

    const res = await fetch(`${baseUrl.value}voices`, {
      method: 'POST',
      body: formData,
      headers: getAuthHeaders(),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      const error: any = new Error(errData?.error || `Upload failed with HTTP ${res.status}`)
      error.status = res.status
      throw error
    }

    const data = await res.json()
    toast.success(`Voice "${uploadForm.value.name}" uploaded and curated!`)
    isUploadModalOpen.value = false
    await checkServerStatus()
    if (data?.voice_id) {
      voice.value = data.voice_id
    }
  }
  catch (err: any) {
    uploadError.value = formatServerErrorMessage(err, 'Voice upload')
    toast.error(uploadError.value)
  }
  finally {
    isUploading.value = false
  }
}

// Edit Transcript Handlers
function openEditTranscriptModal(v: AudioServerVoice) {
  editingVoice.value = v
  editingTranscriptText.value = v.reference_text || ''
  editTranscriptError.value = ''
  isEditTranscriptModalOpen.value = true
}

async function submitSaveTranscript() {
  if (!editingVoice.value)
    return

  isSavingTranscript.value = true
  editTranscriptError.value = ''

  try {
    const targetVoiceId = editingVoice.value.id
    const res = await fetch(`${baseUrl.value}voices/${encodeURIComponent(targetVoiceId)}/transcript`, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript: editingTranscriptText.value.trim(),
      }),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      const error: any = new Error(errData?.error || `Update failed with HTTP ${res.status}`)
      error.status = res.status
      throw error
    }

    // Update in-memory models
    const matched = voicesList.value.find(v => v.id === targetVoiceId)
    if (matched) {
      matched.reference_text = editingTranscriptText.value.trim()
      matched.has_transcript = !!matched.reference_text
    }
    if (editingVoice.value) {
      editingVoice.value.reference_text = editingTranscriptText.value.trim()
      editingVoice.value.has_transcript = !!editingTranscriptText.value.trim()
    }

    toast.success(`Transcript updated for "${editingVoice.value?.name}"`)
    isEditTranscriptModalOpen.value = false
  }
  catch (err: any) {
    editTranscriptError.value = formatServerErrorMessage(err, 'Voice transcript update')
    toast.error(editTranscriptError.value)
  }
  finally {
    isSavingTranscript.value = false
  }
}

// Delete Voice Handlers
function openDeleteVoiceModal(v: AudioServerVoice) {
  voiceToDelete.value = v
  isDeleteModalOpen.value = true
}

async function executeDeleteVoice() {
  if (!voiceToDelete.value)
    return

  isDeletingVoice.value = true
  try {
    const targetVoiceId = voiceToDelete.value.id
    const targetVoiceName = voiceToDelete.value.name
    const res = await fetch(`${baseUrl.value}voices/${encodeURIComponent(targetVoiceId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      const error: any = new Error(errData?.error || `Delete failed with HTTP ${res.status}`)
      error.status = res.status
      throw error
    }

    toast.success(`Voice "${targetVoiceName}" removed.`)
    isDeleteModalOpen.value = false
    if (activePreviewVoiceId.value === targetVoiceId) {
      stopVoicePreview()
    }
    await checkServerStatus()
  }
  catch (err: any) {
    toast.error(formatServerErrorMessage(err, 'Voice deletion'))
  }
  finally {
    isDeletingVoice.value = false
  }
}

function setActiveVoice(id: string) {
  voice.value = id
  toast.success('Active speech voice updated!')
}

// Watch speed slider changes
watch(speed, async () => {
  if (!providers.value[providerId])
    providers.value[providerId] = {}
  ;(providers.value[providerId] as any).speed = speed.value
  ;(providers.value[providerId] as any).voiceSettings = {
    ...defaultVoiceSettings,
    speed: speed.value,
  }
})

// Re-check server on baseUrl change
watch(() => providers.value[providerId]?.baseUrl, () => {
  checkServerStatus()
})

onMounted(async () => {
  if (!providers.value[providerId]) {
    providers.value[providerId] = {}
  }
  if (!providers.value[providerId].baseUrl) {
    providers.value[providerId].baseUrl = defaultBaseUrl
  }
  if (!providers.value[providerId].model) {
    providers.value[providerId].model = defaultModel
  }
  await checkServerStatus()
  if (serverOnline.value === false && audioSpawner.autoSpawnOnLaunch.value && audioSpawner.spawnCommand.value.trim() && audioSpawner.isElectron.value) {
    toast.info('AIRI Audio Server is unreachable. Auto-spawning configured server...')
    await audioSpawner.handleSpawn()
  }
})

onUnmounted(() => {
  stopVoicePreview()
})

// Generate speech via speechStore
async function handleGenerateSpeech(input: string, voiceId: string, _useSSML: boolean) {
  const provider = await providersStore.getProviderInstance<SpeechProvider<string>>(providerId)
  if (!provider) {
    throw new Error('Failed to initialize AIRI Audio Server provider instance')
  }

  const providerConfig = providersStore.getProviderConfig(providerId)
  const modelToUse = model.value || defaultModel

  return await speechStore.speech(
    provider,
    modelToUse,
    input,
    voiceId || voice.value || 'omnivoice-default',
    {
      ...providerConfig,
      ...defaultVoiceSettings,
      speed: speed.value,
    },
  )
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Hero / Repository Introduction Card -->
    <div class="relative overflow-hidden border border-amber-500/20 rounded-2xl from-amber-500/10 via-neutral-100 to-neutral-50 bg-gradient-to-br p-6 dark:from-amber-950/20 dark:via-neutral-900/60 dark:to-neutral-900">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-3">
          <div class="h-12 w-12 flex items-center justify-center border border-amber-500/30 rounded-xl bg-amber-500/20 text-amber-500 shadow-sm">
            <span class="i-solar:server-square-bold-duotone text-2xl" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-lg text-neutral-900 font-bold dark:text-white">
                AIRI Audio Server
              </h2>
              <span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-600 font-semibold dark:text-amber-400">
                audio.cpp C++ Engine
              </span>
            </div>
            <p class="text-xs text-neutral-600 dark:text-neutral-400">
              High-performance, zero-Python local audio microservice supporting OmniVoice, Higgs v3, Fish Audio, and Chatterbox.
            </p>
          </div>
        </div>

        <!-- GitHub Repo CTA Link -->
        <a
          href="https://github.com/dasilva333/airi-audio-server"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex cursor-pointer items-center justify-center gap-2 border border-neutral-300 rounded-xl bg-white px-4 py-2 text-xs text-neutral-800 font-semibold shadow-sm transition-all dark:border-neutral-700 hover:border-amber-500 dark:bg-neutral-800 dark:text-neutral-200 hover:shadow-md dark:hover:border-amber-400"
        >
          <span class="i-simple-icons:github text-sm" />
          <span>View on GitHub</span>
          <span class="i-solar:arrow-right-up-linear text-xs text-neutral-400" />
        </a>
      </div>

      <!-- Quick Start Accordion / Guide -->
      <div class="mt-4 border-t border-neutral-200/60 pt-4 dark:border-neutral-800/60">
        <span class="text-[11px] text-neutral-500 font-bold tracking-wider uppercase dark:text-neutral-400">
          Quick Setup Guide (Local Machine)
        </span>
        <div class="grid grid-cols-1 mt-2 gap-2 lg:grid-cols-4 md:grid-cols-2">
          <!-- Step 1 -->
          <div class="flex flex-col justify-between border border-neutral-200/80 rounded-xl bg-white/70 p-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-900/70">
            <div class="flex items-center justify-between">
              <span class="text-[10px] text-amber-600 font-bold dark:text-amber-400">1. Clone Repository</span>
              <button
                class="cursor-pointer text-[10px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                @click="copyCommand('git clone https://github.com/dasilva333/airi-audio-server.git', 1)"
              >
                {{ copiedStep === 1 ? 'Copied!' : 'Copy' }}
              </button>
            </div>
            <code class="mt-1 block truncate rounded bg-neutral-100 p-1 text-[10px] text-neutral-700 font-mono dark:bg-neutral-800 dark:text-neutral-300">
              git clone https://github.com/dasilva333/airi-audio-server.git
            </code>
          </div>

          <!-- Step 2 -->
          <div class="flex flex-col justify-between border border-neutral-200/80 rounded-xl bg-white/70 p-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-900/70">
            <div class="flex items-center justify-between">
              <span class="text-[10px] text-amber-600 font-bold dark:text-amber-400">2. Install Dependencies</span>
              <button
                class="cursor-pointer text-[10px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                @click="copyCommand('install.bat', 2)"
              >
                {{ copiedStep === 2 ? 'Copied!' : 'Copy' }}
              </button>
            </div>
            <code class="mt-1 block truncate rounded bg-neutral-100 p-1 text-[10px] text-neutral-700 font-mono dark:bg-neutral-800 dark:text-neutral-300">
              install.bat (or npm install)
            </code>
          </div>

          <!-- Step 3 -->
          <div class="flex flex-col justify-between border border-neutral-200/80 rounded-xl bg-white/70 p-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-900/70">
            <div class="flex items-center justify-between">
              <span class="text-[10px] text-amber-600 font-bold dark:text-amber-400">3. Download Models</span>
              <button
                class="cursor-pointer text-[10px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                @click="copyCommand('npm run setup', 3)"
              >
                {{ copiedStep === 3 ? 'Copied!' : 'Copy' }}
              </button>
            </div>
            <code class="mt-1 block truncate rounded bg-neutral-100 p-1 text-[10px] text-neutral-700 font-mono dark:bg-neutral-800 dark:text-neutral-300">
              npm run setup
            </code>
          </div>

          <!-- Step 4 -->
          <div class="flex flex-col justify-between border border-neutral-200/80 rounded-xl bg-white/70 p-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-900/70">
            <div class="flex items-center justify-between">
              <span class="text-[10px] text-amber-600 font-bold dark:text-amber-400">4. Run Server (Port 8095)</span>
              <button
                class="cursor-pointer text-[10px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                @click="copyCommand('npm start', 4)"
              >
                {{ copiedStep === 4 ? 'Copied!' : 'Copy' }}
              </button>
            </div>
            <code class="mt-1 block truncate rounded bg-neutral-100 p-1 text-[10px] text-neutral-700 font-mono dark:bg-neutral-800 dark:text-neutral-300">
              npm start
            </code>
          </div>
        </div>
      </div>
    </div>

    <!-- Live Connection Status Banner -->
    <div
      :class="[
        'flex items-center justify-between p-3.5 rounded-xl border text-xs transition-all duration-200',
        serverOnline === true
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
          : serverOnline === false
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
            : 'bg-neutral-100 dark:bg-neutral-800/40 border-neutral-200 dark:border-neutral-750 text-neutral-600 dark:text-neutral-400',
      ]"
    >
      <div class="flex items-center gap-2.5">
        <span
          :class="[
            'h-2.5 w-2.5 rounded-full shrink-0',
            serverOnline === true
              ? 'bg-emerald-500 animate-pulse'
              : serverOnline === false
                ? 'bg-amber-500'
                : 'bg-neutral-400',
          ]"
        />
        <div class="flex flex-col">
          <span class="font-bold">
            {{
              serverOnline === true
                ? 'AIRI Audio Server Connected'
                : serverOnline === false
                  ? 'Server Offline or Unreachable'
                  : 'Checking Connection...'
            }}
          </span>
          <span class="text-[11px] opacity-80">
            {{
              serverOnline === true
                ? `${discoveredModels.length} models detected, ${discoveredVoices.length} voices available on ${baseUrl}`
                : serverError || 'Ensure npm start is running on http://127.0.0.1:8095'
            }}
          </span>
        </div>
      </div>
      <button
        :disabled="isCheckingHealth"
        class="inline-flex cursor-pointer items-center gap-1 border border-current/20 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all active:scale-95 hover:bg-current/10 disabled:opacity-50"
        @click="checkServerStatus"
      >
        <span :class="['i-solar:restart-bold text-xs', isCheckingHealth ? 'animate-spin' : '']" />
        <span>Recheck</span>
      </button>
    </div>

    <!-- Server Lifecycle & Process Spawner Card -->
    <ProcessLifecycleCard
      :spawner="audioSpawner"
      title="Server Lifecycle & Process Spawner"
      description="Run local sidecar binary or execute remote start/stop scripts directly from AIRI."
      placeholder-spawn="e.g. npx airi-audio-server or ./start_server.sh or ssh user@host &quot;command&quot;"
      placeholder-stop="e.g. killall airi-audio-server or ./stop_server.sh or ssh user@host &quot;command&quot;"
      spawn-button-label="Spawn Server"
      stop-button-label="Stop Server"
      icon="i-solar:server-square-bold-duotone"
    />

    <!-- Provider Settings: Two Column Layout (Basic + Voice on Left, Playground on Right) -->
    <SpeechProviderSettings
      :provider-id="providerId"
      default-model="omnivoice-tts"
      :additional-settings="defaultVoiceSettings"
    >
      <!-- Voice Settings Slot (Left Column) -->
      <template #voice-settings>
        <FieldSelect
          v-model="model"
          label="Active Model"
          description="Select the neural speech model (audio.cpp CUDA / CPU engine)"
          :options="modelOptions"
        />

        <FieldRange
          v-model="speed"
          :label="t('settings.pages.providers.provider.common.fields.field.speed.label')"
          :description="`Playback speed multiplier: ${speed.toFixed(2)}x`"
          :min="0.5"
          :max="2.0"
          :step="0.05"
        />

        <!-- Paralinguistic Expression Tags Preview -->
        <div v-if="expressionTags.length > 0" class="border border-neutral-200/80 rounded-xl bg-neutral-50/60 p-3.5 dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex items-center justify-between">
            <span class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
              Expression Tags
            </span>
            <span class="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-600 font-semibold dark:text-amber-400">
              {{ expressionTags.length }} Tags
            </span>
          </div>
          <p class="mt-1 text-[11px] text-neutral-500 leading-snug">
            Tagged vocalizations supported by active model (/v1/capabilities):
          </p>
          <div class="mt-2.5 flex flex-wrap gap-1">
            <span
              v-for="item in expressionTags"
              :key="item.tag"
              class="shadow-2xs dark:border-neutral-750 border border-neutral-200/80 rounded bg-white px-1.5 py-0.5 text-[10px] text-neutral-700 font-mono dark:bg-neutral-800 dark:text-neutral-300"
              :title="item.description || item.tag"
            >
              {{ item.tag }}
            </span>
          </div>
        </div>
      </template>

      <!-- Playground Slot (Right Column) -->
      <template #playground>
        <SpeechPlayground
          :available-voices="availableVoices"
          :generate-speech="handleGenerateSpeech"
          :api-key-configured="true"
          :voices-loading="isCheckingHealth"
          default-text="Hello! This is a real-time speech synthesis test powered by AIRI Audio Server."
        />
      </template>
    </SpeechProviderSettings>

    <!-- Voice Catalog & Curation Studio -->
    <div class="shadow-xs border border-neutral-200/80 rounded-2xl bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900/60">
      <!-- Studio Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="i-solar:users-group-two-rounded-bold-duotone text-xl text-amber-500" />
            <h3 class="text-base text-neutral-900 font-bold dark:text-white">
              Voice Catalog & Curation Studio
            </h3>
          </div>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Manage zero-shot prompt references, verify spoken transcripts for acoustic alignment, and clone custom voices.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            class="shadow-2xs dark:hover:bg-neutral-750 inline-flex cursor-pointer items-center gap-1.5 border border-neutral-300 rounded-xl bg-white px-3 py-2 text-xs text-neutral-700 font-semibold transition-all dark:border-neutral-700 hover:border-neutral-400 dark:bg-neutral-800 hover:bg-neutral-50 dark:text-neutral-300"
            title="Refresh voices from server"
            :disabled="isCheckingHealth"
            @click="checkServerStatus"
          >
            <span :class="['i-solar:restart-bold text-xs text-neutral-500', isCheckingHealth ? 'animate-spin' : '']" />
            <span>Sync</span>
          </button>

          <button
            class="inline-flex cursor-pointer items-center justify-center gap-2 border border-amber-600 rounded-xl bg-amber-500 px-4 py-2 text-xs text-white font-semibold shadow-sm transition-all active:scale-95 hover:bg-amber-600 disabled:opacity-50"
            @click="openUploadModal"
          >
            <span class="i-solar:cloud-upload-bold text-sm" />
            <span>Upload & Clone Voice</span>
          </button>
        </div>
      </div>

      <!-- Stats Summary Cards -->
      <div class="grid grid-cols-2 mt-4 gap-3 sm:grid-cols-4">
        <!-- Stat: Total Voices -->
        <div class="flex items-center gap-3 border border-neutral-200/80 rounded-xl bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-800/30">
          <div class="h-9 w-9 flex items-center justify-center rounded-lg bg-neutral-200/60 text-neutral-600 dark:bg-neutral-700/50 dark:text-neutral-300">
            <span class="i-solar:microphone-3-bold-duotone text-lg" />
          </div>
          <div class="flex flex-col">
            <span class="text-[10px] text-neutral-400 font-bold uppercase dark:text-neutral-500">Total Voices</span>
            <span class="text-base text-neutral-900 font-bold dark:text-white">{{ totalVoices }}</span>
          </div>
        </div>

        <!-- Stat: Verified Transcripts -->
        <div class="flex items-center gap-3 border border-emerald-500/20 rounded-xl bg-emerald-500/5 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
          <div class="h-9 w-9 flex items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <span class="i-solar:check-circle-bold text-lg" />
          </div>
          <div class="flex flex-col">
            <span class="text-[10px] text-emerald-600 font-bold uppercase dark:text-emerald-400">Verified Transcripts</span>
            <span class="text-base text-emerald-700 font-bold dark:text-emerald-300">{{ verifiedVoicesCount }}</span>
          </div>
        </div>

        <!-- Stat: Needs Transcript -->
        <div class="flex items-center gap-3 border border-amber-500/20 rounded-xl bg-amber-500/5 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
          <div class="h-9 w-9 flex items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <span class="i-solar:danger-triangle-bold text-lg" />
          </div>
          <div class="flex flex-col">
            <span class="text-[10px] text-amber-600 font-bold uppercase dark:text-amber-400">Needs Transcript</span>
            <span class="text-base text-amber-700 font-bold dark:text-amber-300">{{ needsTranscriptCount }}</span>
          </div>
        </div>

        <!-- Stat: Cloned Voices -->
        <div class="flex items-center gap-3 border border-purple-500/20 rounded-xl bg-purple-500/5 p-3 dark:border-purple-500/20 dark:bg-purple-500/10">
          <div class="h-9 w-9 flex items-center justify-center rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-400">
            <span class="i-solar:magic-stick-3-bold-duotone text-lg" />
          </div>
          <div class="flex flex-col">
            <span class="text-[10px] text-purple-600 font-bold uppercase dark:text-purple-400">Cloned / Custom</span>
            <span class="text-base text-purple-700 font-bold dark:text-purple-300">{{ clonedVoicesCount }}</span>
          </div>
        </div>
      </div>

      <!-- Filter Tabs & Search Bar -->
      <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <!-- Segmented Filter Buttons -->
        <div class="inline-flex border border-neutral-200 rounded-xl bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/60">
          <button
            :class="[
              'px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer',
              selectedFilter === 'all'
                ? 'bg-white text-neutral-900 shadow-2xs dark:bg-neutral-700 dark:text-white'
                : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200',
            ]"
            @click="selectedFilter = 'all'"
          >
            All ({{ totalVoices }})
          </button>
          <button
            :class="[
              'px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer',
              selectedFilter === 'verified'
                ? 'bg-white text-neutral-900 shadow-2xs dark:bg-neutral-700 dark:text-white'
                : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200',
            ]"
            @click="selectedFilter = 'verified'"
          >
            Verified ({{ verifiedVoicesCount }})
          </button>
          <button
            :class="[
              'px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer',
              selectedFilter === 'needs_transcript'
                ? 'bg-white text-neutral-900 shadow-2xs dark:bg-neutral-700 dark:text-white'
                : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200',
            ]"
            @click="selectedFilter = 'needs_transcript'"
          >
            Needs Transcript ({{ needsTranscriptCount }})
          </button>
          <button
            :class="[
              'px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer',
              selectedFilter === 'cloned'
                ? 'bg-white text-neutral-900 shadow-2xs dark:bg-neutral-700 dark:text-white'
                : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200',
            ]"
            @click="selectedFilter = 'cloned'"
          >
            Cloned ({{ clonedVoicesCount }})
          </button>
        </div>

        <!-- Search Input -->
        <div class="relative max-w-sm w-full">
          <span class="i-solar:magnifer-linear absolute left-3 top-1/2 text-sm text-neutral-400 -translate-y-1/2" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search voices by name, ID, or transcript..."
            class="w-full border border-neutral-200 rounded-xl bg-neutral-50 py-1.5 pl-9 pr-8 text-xs text-neutral-800 outline-none transition-all dark:border-neutral-800 focus:border-amber-500 dark:bg-neutral-950/50 dark:text-neutral-200"
          >
          <button
            v-if="searchQuery"
            class="absolute right-2.5 top-1/2 text-neutral-400 -translate-y-1/2 hover:text-neutral-600 dark:hover:text-neutral-200"
            @click="searchQuery = ''"
          >
            <span class="i-solar:close-circle-bold text-xs" />
          </button>
        </div>
      </div>

      <!-- Voice Cards Grid -->
      <div v-if="filteredVoices.length > 0" class="grid grid-cols-1 mt-4 gap-3 lg:grid-cols-2">
        <div
          v-for="v in filteredVoices"
          :key="v.id"
          :class="[
            'flex flex-col justify-between p-4 rounded-xl border transition-all duration-200',
            v.id === voice
              ? 'border-amber-500/60 bg-amber-500/[0.03] ring-1 ring-amber-500/30'
              : 'border-neutral-200/80 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/40 hover:border-neutral-300 dark:hover:border-neutral-700',
          ]"
        >
          <div>
            <!-- Voice Title & Badges -->
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h4 class="truncate text-sm text-neutral-900 font-bold dark:text-white">
                    {{ v.name }}
                  </h4>
                  <!-- Active Voice Marker -->
                  <span
                    v-if="v.id === voice"
                    class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-600 font-bold uppercase dark:text-amber-400"
                  >
                    Active Voice
                  </span>
                </div>
                <div class="mt-0.5 text-[11px] text-neutral-400 font-mono dark:text-neutral-500">
                  {{ v.id }}
                </div>
              </div>

              <!-- Status Badges -->
              <div class="flex shrink-0 items-center gap-1.5">
                <!-- Cloned vs System -->
                <span
                  :class="[
                    'px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase',
                    v.type === 'cloned' || v.type === 'custom'
                      ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400',
                  ]"
                >
                  {{ v.type === 'cloned' || v.type === 'custom' ? 'Cloned' : 'Built-in' }}
                </span>

                <!-- Transcript Status Badge -->
                <span
                  :class="[
                    'inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full',
                    v.has_transcript
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                  ]"
                >
                  <span :class="[v.has_transcript ? 'i-solar:check-circle-bold text-xs' : 'i-solar:danger-triangle-bold text-xs']" />
                  <span>{{ v.has_transcript ? 'Verified' : 'Needs Transcript' }}</span>
                </span>
              </div>
            </div>

            <!-- Reference Transcript or Missing Warning -->
            <div class="mt-3">
              <div
                v-if="v.reference_text"
                class="flex items-start gap-2 rounded-xl bg-neutral-100/70 p-2.5 text-xs text-neutral-700 italic dark:bg-neutral-800/50 dark:text-neutral-300"
              >
                <span class="i-solar:dialog-bold mt-0.5 shrink-0 text-sm text-neutral-400" />
                <span class="line-clamp-2">"{{ v.reference_text }}"</span>
              </div>
              <div
                v-else
                class="flex items-center gap-2 rounded-xl bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300"
              >
                <span class="i-solar:danger-triangle-bold shrink-0 text-sm" />
                <span class="text-[11px] leading-snug">
                  Missing spoken transcript. OmniVoice and Higgs v3 cross-attention require exact text to prevent gibberish.
                </span>
              </div>
            </div>

            <!-- Model Compatibility Tags -->
            <div v-if="v.model_compatibility && v.model_compatibility.length > 0" class="mt-2.5 flex flex-wrap gap-1">
              <span
                v-for="mc in v.model_compatibility"
                :key="mc"
                class="border border-neutral-200 rounded bg-neutral-100 px-1.5 py-0.2 text-[9px] text-neutral-600 font-mono dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-400"
              >
                {{ mc }}
              </span>
            </div>
          </div>

          <!-- Card Action Footer -->
          <div class="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800/80">
            <div class="flex items-center gap-1.5">
              <!-- Play / Stop Audio Preview -->
              <button
                :class="[
                  'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer',
                  activePreviewVoiceId === v.id
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'border border-neutral-200 dark:border-neutral-750 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800',
                ]"
                :title="activePreviewVoiceId === v.id ? 'Stop audio playback' : 'Listen to reference audio'"
                @click="toggleVoicePreview(v)"
              >
                <span
                  v-if="isPreviewLoading && activePreviewVoiceId === v.id"
                  class="i-solar:restart-bold animate-spin text-xs"
                />
                <span
                  v-else
                  :class="[activePreviewVoiceId === v.id ? 'i-solar:stop-circle-bold text-xs' : 'i-solar:play-circle-bold text-xs']"
                />
                <span>{{ activePreviewVoiceId === v.id ? 'Stop' : 'Listen' }}</span>
              </button>

              <!-- Edit Transcript Button -->
              <button
                class="dark:border-neutral-750 inline-flex cursor-pointer items-center gap-1 border border-neutral-200 rounded-lg px-2.5 py-1 text-xs text-neutral-700 font-semibold transition-all hover:border-neutral-300 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                title="Edit spoken reference transcript"
                @click="openEditTranscriptModal(v)"
              >
                <span class="i-solar:pen-new-square-bold text-xs text-neutral-500" />
                <span>Transcript</span>
              </button>
            </div>

            <div class="flex items-center gap-1.5">
              <!-- Set as Active Voice Button -->
              <button
                v-if="v.id !== voice"
                class="dark:border-neutral-750 cursor-pointer border border-neutral-200 rounded-lg px-2.5 py-1 text-xs text-neutral-600 font-semibold transition-all hover:border-amber-500 dark:text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400"
                @click="setActiveVoice(v.id)"
              >
                Select
              </button>

              <!-- Delete Voice Button (Available for all non-system or cloned voices) -->
              <button
                class="cursor-pointer border border-transparent rounded-lg p-1.5 text-neutral-400 transition-all hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-500"
                title="Delete voice from server"
                @click="openDeleteVoiceModal(v)"
              >
                <span class="i-solar:trash-bin-trash-bold text-xs" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="flex flex-col items-center justify-center border border-neutral-200 rounded-xl border-dashed bg-neutral-50/50 p-8 text-center dark:border-neutral-800 dark:bg-neutral-900/30"
      >
        <div class="i-solar:microphone-3-bold-duotone mb-2 text-3xl text-neutral-400" />
        <p class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
          {{ searchQuery ? `No voices found matching "${searchQuery}"` : 'No voices available on AIRI Audio Server' }}
        </p>
        <p class="mt-1 text-[11px] text-neutral-500">
          {{ searchQuery ? 'Try adjusting your search query or filter tab.' : 'Upload reference audio to clone your first zero-shot voice.' }}
        </p>
        <button
          v-if="!searchQuery"
          class="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs text-white font-semibold transition-all hover:bg-amber-600"
          @click="openUploadModal"
        >
          <span class="i-solar:cloud-upload-bold text-xs" />
          <span>Upload Audio Sample</span>
        </button>
      </div>
    </div>

    <!-- Modal: Upload & Clone Voice -->
    <DialogRoot v-model:open="isUploadModalOpen">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-md data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
        <DialogContent
          class="fixed left-1/2 top-1/2 z-[10000] m-0 max-h-[90vh] max-w-xl w-[90vw] flex flex-col overflow-hidden border border-neutral-200 rounded-2xl bg-white shadow-2xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-800 dark:bg-neutral-900"
          @pointer-down-outside.prevent
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-neutral-100 p-6 pb-4 dark:border-neutral-800">
            <div class="flex items-center gap-2.5">
              <div class="rounded-xl bg-amber-500/10 p-2 text-amber-500 shadow-sm">
                <span class="i-solar:cloud-upload-bold-duotone text-xl" />
              </div>
              <div>
                <DialogTitle class="text-base text-neutral-900 font-bold dark:text-white">
                  Upload & Clone Voice
                </DialogTitle>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  Ingest clean reference audio for zero-shot cloning on OmniVoice, Higgs v3, and Fish Audio.
                </p>
              </div>
            </div>
            <button
              class="cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              @click="isUploadModalOpen = false"
            >
              <span class="i-solar:close-circle-bold text-lg" />
            </button>
          </div>

          <!-- Form Content -->
          <div class="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
            <!-- Audio Dropzone -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[10px] text-neutral-400 font-bold tracking-wider uppercase dark:text-neutral-500">
                Reference Audio Sample (.wav, .mp3, .flac, .ogg, .m4a)
              </label>

              <input
                ref="uploadFileInputRef"
                type="file"
                accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a"
                class="hidden"
                @change="onUploadFileInputChange"
              >

              <div
                :class="[
                  'flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all',
                  isDraggingAudio
                    ? 'border-amber-500 bg-amber-500/10'
                    : uploadForm.file
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-neutral-300 dark:border-neutral-750 hover:border-amber-500/50 bg-neutral-50 dark:bg-neutral-950/40',
                ]"
                @dragover.prevent="isDraggingAudio = true"
                @dragleave.prevent="isDraggingAudio = false"
                @drop.prevent="onUploadDrop"
                @click="uploadFileInputRef?.click()"
              >
                <div v-if="uploadForm.file" class="flex flex-col items-center text-center">
                  <span class="i-solar:check-circle-bold text-2xl text-emerald-500" />
                  <span class="mt-1 text-xs text-neutral-800 font-bold dark:text-neutral-200">
                    {{ uploadForm.file.name }}
                  </span>
                  <span class="text-[10px] text-neutral-400">
                    {{ (uploadForm.file.size / (1024 * 1024)).toFixed(2) }} MB · Click to choose different file
                  </span>
                </div>
                <div v-else class="flex flex-col items-center text-center">
                  <span class="i-solar:upload-square-line-duotone mb-1 text-3xl text-neutral-400" />
                  <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                    Click to select audio or drag & drop here
                  </span>
                  <span class="text-[10px] text-neutral-400">
                    Optimal duration: 5 to 15 seconds of clear, uninterrupted speech
                  </span>
                </div>
              </div>
            </div>

            <!-- Voice Name Field -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[10px] text-neutral-400 font-bold tracking-wider uppercase dark:text-neutral-500">
                Voice Name
              </label>
              <input
                v-model="uploadForm.name"
                type="text"
                placeholder="e.g. Elysia or Warm Narrator"
                class="w-full border border-neutral-200 rounded-xl bg-neutral-50 px-3.5 py-2 text-xs text-neutral-800 outline-none dark:border-neutral-800 focus:border-amber-500 dark:bg-neutral-950/50 dark:text-neutral-200"
              >
            </div>

            <!-- Reference Transcript Field -->
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <label class="text-[10px] text-neutral-400 font-bold tracking-wider uppercase dark:text-neutral-500">
                  Prompt Spoken Transcript (Highly Recommended)
                </label>
                <span class="text-[10px] text-amber-600 font-semibold dark:text-amber-400">
                  Zero-Shot Acoustic Alignment
                </span>
              </div>
              <textarea
                v-model="uploadForm.referenceText"
                rows="3"
                placeholder="Enter the exact words spoken in the audio sample..."
                class="w-full resize-none border border-neutral-200 rounded-xl bg-neutral-50 px-3.5 py-2 text-xs text-neutral-800 outline-none dark:border-neutral-800 focus:border-amber-500 dark:bg-neutral-950/50 dark:text-neutral-200"
              />
              <div class="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                <span class="i-solar:info-circle-bold mt-0.5 shrink-0 text-xs" />
                <span>
                  OmniVoice, Higgs v3, and Fish Audio cross-attend to the reference transcript. Providing exact text guarantees pristine acoustic cloning and eliminates noise.
                </span>
              </div>
            </div>

            <!-- Error Banner -->
            <div v-if="uploadError" class="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-600 dark:text-red-400">
              {{ uploadError }}
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-2 border-t border-neutral-100 p-6 pt-4 dark:border-neutral-800">
            <button
              class="dark:border-neutral-750 cursor-pointer border border-neutral-200 rounded-xl px-4 py-2 text-xs text-neutral-700 font-semibold hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              :disabled="isUploading"
              @click="isUploadModalOpen = false"
            >
              Cancel
            </button>
            <button
              class="inline-flex cursor-pointer items-center gap-1.5 border border-amber-600 rounded-xl bg-amber-500 px-4 py-2 text-xs text-white font-semibold shadow-sm active:scale-95 hover:bg-amber-600 disabled:opacity-50"
              :disabled="isUploading || !uploadForm.file || !uploadForm.name.trim()"
              @click="submitVoiceUpload"
            >
              <span v-if="isUploading" class="i-solar:restart-bold animate-spin text-xs" />
              <span>{{ isUploading ? 'Uploading & Ingesting...' : 'Upload & Clone Voice' }}</span>
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <!-- Modal: Edit Transcript -->
    <DialogRoot v-model:open="isEditTranscriptModalOpen">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-md data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
        <DialogContent
          class="fixed left-1/2 top-1/2 z-[10000] m-0 max-h-[90vh] max-w-lg w-[90vw] flex flex-col overflow-hidden border border-neutral-200 rounded-2xl bg-white shadow-2xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-800 dark:bg-neutral-900"
          @pointer-down-outside.prevent
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-neutral-100 p-6 pb-4 dark:border-neutral-800">
            <div class="flex items-center gap-2.5">
              <div class="rounded-xl bg-amber-500/10 p-2 text-amber-500 shadow-sm">
                <span class="i-solar:pen-new-square-bold-duotone text-xl" />
              </div>
              <div>
                <DialogTitle class="text-base text-neutral-900 font-bold dark:text-white">
                  Edit Reference Transcript
                </DialogTitle>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  Spoken prompt alignment for <span class="text-neutral-900 font-bold dark:text-white">{{ editingVoice?.name }}</span>
                </p>
              </div>
            </div>
            <button
              class="cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              @click="isEditTranscriptModalOpen = false"
            >
              <span class="i-solar:close-circle-bold text-lg" />
            </button>
          </div>

          <!-- Content -->
          <div class="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
            <!-- Audio Reference Player Mini Bar -->
            <div
              v-if="editingVoice"
              class="flex items-center justify-between border border-neutral-200/80 rounded-xl bg-neutral-50/70 p-3 dark:border-neutral-800 dark:bg-neutral-800/40"
            >
              <div class="min-w-0 flex items-center gap-2">
                <span class="i-solar:volume-loud-bold-duotone text-amber-500" />
                <span class="truncate text-xs text-neutral-700 font-medium dark:text-neutral-300">
                  Listen to prompt audio while editing:
                </span>
              </div>
              <button
                :class="[
                  'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer',
                  activePreviewVoiceId === editingVoice.id
                    ? 'bg-amber-500 text-white'
                    : 'border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100',
                ]"
                @click="toggleVoicePreview(editingVoice)"
              >
                <span :class="[activePreviewVoiceId === editingVoice.id ? 'i-solar:stop-circle-bold text-xs' : 'i-solar:play-circle-bold text-xs']" />
                <span>{{ activePreviewVoiceId === editingVoice.id ? 'Stop' : 'Play' }}</span>
              </button>
            </div>

            <!-- Transcript Textarea -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[10px] text-neutral-400 font-bold tracking-wider uppercase dark:text-neutral-500">
                Exact Spoken Text
              </label>
              <textarea
                v-model="editingTranscriptText"
                rows="4"
                placeholder="Enter the exact words spoken in this reference recording..."
                class="w-full resize-none border border-neutral-200 rounded-xl bg-neutral-50 px-3.5 py-2 text-xs text-neutral-800 outline-none dark:border-neutral-800 focus:border-amber-500 dark:bg-neutral-950/50 dark:text-neutral-200"
              />
            </div>

            <!-- Notice -->
            <div class="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-2 text-[11px] text-emerald-700 dark:text-emerald-300">
              <span class="i-solar:check-circle-bold mt-0.5 shrink-0 text-xs" />
              <span>
                Saving an accurate transcript marks this voice as <strong>Verified</strong> and prevents phoneme drift during zero-shot synthesis.
              </span>
            </div>

            <!-- Error Banner -->
            <div v-if="editTranscriptError" class="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-600 dark:text-red-400">
              {{ editTranscriptError }}
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-2 border-t border-neutral-100 p-6 pt-4 dark:border-neutral-800">
            <button
              class="dark:border-neutral-750 cursor-pointer border border-neutral-200 rounded-xl px-4 py-2 text-xs text-neutral-700 font-semibold hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              :disabled="isSavingTranscript"
              @click="isEditTranscriptModalOpen = false"
            >
              Cancel
            </button>
            <button
              class="inline-flex cursor-pointer items-center gap-1.5 border border-amber-600 rounded-xl bg-amber-500 px-4 py-2 text-xs text-white font-semibold shadow-sm active:scale-95 hover:bg-amber-600 disabled:opacity-50"
              :disabled="isSavingTranscript"
              @click="submitSaveTranscript"
            >
              <span v-if="isSavingTranscript" class="i-solar:restart-bold animate-spin text-xs" />
              <span>{{ isSavingTranscript ? 'Saving...' : 'Save Transcript' }}</span>
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <!-- Modal: Delete Confirmation -->
    <DialogRoot v-model:open="isDeleteModalOpen">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-md data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
        <DialogContent
          class="fixed left-1/2 top-1/2 z-[10000] m-0 max-h-[90vh] max-w-md w-[90vw] flex flex-col overflow-hidden border border-neutral-200 rounded-2xl bg-white shadow-2xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-800 dark:bg-neutral-900"
          @pointer-down-outside.prevent
        >
          <div class="p-6">
            <div class="flex items-center gap-3">
              <div class="rounded-xl bg-red-500/10 p-2.5 text-red-500">
                <span class="i-solar:trash-bin-trash-bold text-2xl" />
              </div>
              <div>
                <DialogTitle class="text-base text-neutral-900 font-bold dark:text-white">
                  Delete Voice Reference
                </DialogTitle>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  Are you sure you want to delete <span class="text-neutral-900 font-bold dark:text-white">"{{ voiceToDelete?.name }}"</span>?
                </p>
              </div>
            </div>

            <p class="mt-4 rounded-xl bg-red-500/5 p-3 text-xs text-red-600 leading-relaxed dark:text-red-400">
              This will permanently delete the prompt audio file and its transcript from the audio server's voice catalog.
            </p>

            <div class="mt-6 flex items-center justify-end gap-2">
              <button
                class="dark:border-neutral-750 cursor-pointer border border-neutral-200 rounded-xl px-4 py-2 text-xs text-neutral-700 font-semibold hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                :disabled="isDeletingVoice"
                @click="isDeleteModalOpen = false"
              >
                Cancel
              </button>
              <button
                class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs text-white font-semibold shadow-sm active:scale-95 hover:bg-red-700 disabled:opacity-50"
                :disabled="isDeletingVoice"
                @click="executeDeleteVoice"
              >
                <span v-if="isDeletingVoice" class="i-solar:restart-bold animate-spin text-xs" />
                <span>{{ isDeletingVoice ? 'Deleting...' : 'Delete Voice' }}</span>
              </button>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
