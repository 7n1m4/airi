<script setup lang="ts">
import type { AiriCard } from '@proj-airi/stage-ui/stores/modules/airi-card'

import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { Button } from '@proj-airi/ui'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'

import cardExportFrameUrl from '../card-export-frame.png?url'

interface Props {
  modelValue: boolean
  card?: AiriCard | null
}

const props = withDefaults(defineProps<Props>(), {
  card: null,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const displayModelsStore = useDisplayModelsStore()

// 3-part segment at top: defaults to 'zip'
const activeSegment = ref<'zip' | 'png' | 'json'>('zip')

// Mock data fallbacks for standalone preview
const mockCard = computed(() => {
  return props.card || {
    id: 'mock-airi-id',
    name: 'Airi',
    description: 'Autonomous digital companion with live 3D avatars, multi-modal vision perception, and rich episodic memory.',
    version: '1.0.0',
    creator: 'Moeru AI',
    tags: ['Companion', 'Assistant', 'Anime', 'Live2D', 'VRM'],
    systemPrompt: 'You are Airi, an attentive and insightful digital companion.',
    greetings: [
      'Hello there! Ready to build something great today?',
    ],
    extensions: {
      airi: {
        consciousness: { provider: 'openrouter', model: 'anthropic/claude-3.7-sonnet' },
        speech: { provider: 'elevenlabs', voiceId: '21m00Tcm4TlvDq8ikWAM' },
        artistry: { enabled: true },
        proactivity: { heartbeatIntervalSeconds: 30 },
      },
    },
  } as unknown as AiriCard
})

// ZIP Section Options
const zipFlavor = ref<'v2' | 'v1'>('v2') // v2 Extended vs v1 Upstream main
const includeModels = ref(true)
const includeBackground = ref(true)
const includeVoiceProfiles = ref(true)
const includeCoverFrame = ref(true)
const includeMemories = ref(false)
const generateReadme = ref(true)

// PNG Section Options
const pngFramed = ref(true)
const pngOmitNotes = ref(false)

// JSON Section Options
const jsonPretty = ref(true)
const jsonIncludeMemories = ref(false)

// Model preview image lookup
const modelPreviewUrl = computed(() => {
  const cardData = mockCard.value as any
  const displayModelId = cardData?.displayModelId || cardData?.extensions?.airi?.model?.displayModelId
  if (!displayModelId)
    return null
  const model = displayModelsStore.displayModels.find(m => m.id === displayModelId)
  return model?.previewImage || null
})

// Mock JSON payload for JSON preview
const previewJsonString = computed(() => {
  const payload = {
    format: 'airi-card',
    version: 1,
    exportedAt: new Date().toISOString(),
    card: mockCard.value,
  }
  return JSON.stringify(payload, null, jsonPretty.value ? 2 : 0)
})

// 3-part compatibility matrix across dasilva333/airi, SillyTavern, and moeru-ai/airi
const compatibilityMatrix = computed(() => {
  switch (activeSegment.value) {
    case 'zip':
      return {
        dasilva: true,
        sillyTavern: false,
        moeru: true,
      }
    case 'png':
      return {
        dasilva: true,
        sillyTavern: true,
        moeru: false,
      }
    case 'json':
      return {
        dasilva: true,
        sillyTavern: false,
        moeru: false,
      }
  }
})

function handleClose() {
  emit('update:modelValue', false)
}

function handleMockCopyPayload() {
  navigator.clipboard?.writeText(previewJsonString.value)
  toast.success('Payload copied to clipboard (Mock)')
}

function handleMockExportDownload() {
  toast.info(`Exporting as .${activeSegment.value.toLowerCase()} is in preview/design mode.`)
}
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogPortal>
      <DialogOverlay
        :class="[
          'fixed inset-0 z-999 bg-black/60 backdrop-blur-sm',
          'data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn',
        ]"
      />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-1000 max-h-[85vh] w-[92vw] max-w-3xl -translate-x-1/2 -translate-y-1/2',
          'flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900',
          'border border-neutral-200 dark:border-neutral-800',
          'data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow',
        ]"
      >
        <!-- Modal Header -->
        <div
          :class="[
            'flex items-center justify-between px-6 pt-5 pb-3',
            'bg-white dark:bg-neutral-900',
          ]"
        >
          <div :class="['flex items-center gap-2.5']">
            <div
              :class="[
                'flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-950/60',
                'text-primary-600 dark:text-primary-400',
              ]"
            >
              <div i-solar:export-bold-duotone :class="['text-lg']" />
            </div>
            <div>
              <DialogTitle :class="['text-base font-semibold text-neutral-800 dark:text-neutral-100']">
                Export Character Card
              </DialogTitle>
              <p :class="['text-xs text-neutral-400']">
                {{ mockCard.name }} (v{{ mockCard.version || '1.0' }})
              </p>
            </div>
          </div>

          <button
            :class="[
              'rounded-lg p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200',
              'hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors',
            ]"
            @click="handleClose"
          >
            <div i-solar:close-circle-linear :class="['text-xl']" />
          </button>
        </div>

        <!-- Cute 3-Part Segmented Control at Top -->
        <div :class="['px-6 pb-2']">
          <div
            :class="[
              'grid grid-cols-3 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/80',
              'border border-neutral-200/50 dark:border-neutral-700/50',
            ]"
          >
            <!-- ZIP Tab -->
            <button
              :class="[
                'flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all',
                activeSegment === 'zip'
                  ? 'bg-white text-primary-600 shadow-sm dark:bg-neutral-700 dark:text-primary-400'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
              ]"
              @click="activeSegment = 'zip'"
            >
              <div i-solar:archive-bold-duotone :class="['text-base']" />
              <span>ZIP Package</span>
            </button>

            <!-- PNG Tab -->
            <button
              :class="[
                'flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all',
                activeSegment === 'png'
                  ? 'bg-white text-primary-600 shadow-sm dark:bg-neutral-700 dark:text-primary-400'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
              ]"
              @click="activeSegment = 'png'"
            >
              <div i-solar:gallery-wide-bold-duotone :class="['text-base']" />
              <span>Portable PNG</span>
            </button>

            <!-- JSON Tab -->
            <button
              :class="[
                'flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all',
                activeSegment === 'json'
                  ? 'bg-white text-primary-600 shadow-sm dark:bg-neutral-700 dark:text-primary-400'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
              ]"
              @click="activeSegment = 'json'"
            >
              <div i-solar:code-file-bold-duotone :class="['text-base']" />
              <span>Raw JSON</span>
            </button>
          </div>
        </div>

        <!-- 3-Part Compatibility Chips Bar -->
        <div :class="['px-6 pb-2 pt-1 flex items-center justify-center gap-2 flex-wrap']">
          <!-- moeru-ai/airi -->
          <div
            :class="[
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all',
              compatibilityMatrix.moeru
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-neutral-100 dark:bg-neutral-800/60 text-neutral-400 dark:text-neutral-500 border-neutral-200 dark:border-neutral-700 line-through opacity-60',
            ]"
          >
            <div
              :class="[
                compatibilityMatrix.moeru
                  ? 'i-solar:check-circle-bold text-emerald-500'
                  : 'i-solar:close-circle-bold text-neutral-400',
                'text-sm',
              ]"
            />
            <span>moeru-ai/airi</span>
          </div>

          <!-- SillyTavern -->
          <div
            :class="[
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all',
              compatibilityMatrix.sillyTavern
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-neutral-100 dark:bg-neutral-800/60 text-neutral-400 dark:text-neutral-500 border-neutral-200 dark:border-neutral-700 line-through opacity-60',
            ]"
          >
            <div
              :class="[
                compatibilityMatrix.sillyTavern
                  ? 'i-solar:check-circle-bold text-emerald-500'
                  : 'i-solar:close-circle-bold text-neutral-400',
                'text-sm',
              ]"
            />
            <span>SillyTavern Compatible</span>
          </div>

          <!-- dasilva333/airi -->
          <div
            :class="[
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all',
              compatibilityMatrix.dasilva
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-neutral-100 dark:bg-neutral-800/60 text-neutral-400 dark:text-neutral-500 border-neutral-200 dark:border-neutral-700 line-through opacity-60',
            ]"
          >
            <div
              :class="[
                compatibilityMatrix.dasilva
                  ? 'i-solar:check-circle-bold text-emerald-500'
                  : 'i-solar:close-circle-bold text-neutral-400',
                'text-sm',
              ]"
            />
            <span>dasilva333/airi</span>
          </div>
        </div>

        <!-- Focused Segment Content Body -->
        <div :class="['flex-1 overflow-y-auto px-6 py-3']">
          <!-- ==================== 1. ZIP SECTION ==================== -->
          <div v-if="activeSegment === 'zip'" :class="['flex flex-col sm:flex-row gap-5 items-start']">
            <!-- Left: Archive Tree Preview (Fixed width side-by-side) -->
            <div :class="['w-full sm:w-[220px] shrink-0 flex flex-col gap-1.5']">
              <span :class="['text-[11px] font-semibold uppercase tracking-wider text-neutral-400']">
                Archive Layout Preview
              </span>
              <div
                :class="[
                  'h-[220px] overflow-auto rounded-xl bg-neutral-950 p-2.5 text-[10px] font-mono text-neutral-300 leading-relaxed',
                  'border border-neutral-800 flex flex-col gap-1',
                ]"
              >
                <div :class="['flex items-center gap-1.5 text-primary-400 font-bold pb-1 border-b border-neutral-800/80']">
                  <div i-solar:archive-linear />
                  <span>{{ mockCard.name.toLowerCase() }}_card.zip</span>
                </div>
                <div :class="['flex items-center gap-1.5 text-neutral-300 pt-1']">
                  <div i-solar:file-code-linear :class="['text-amber-400']" />
                  <span>manifest.json</span>
                </div>
                <div :class="['flex items-center gap-1.5 text-neutral-300']">
                  <div i-solar:file-code-linear :class="['text-sky-400']" />
                  <span>card.json</span>
                </div>
                <div v-if="includeCoverFrame" :class="['flex items-center gap-1.5 text-neutral-300']">
                  <div i-solar:gallery-linear :class="['text-emerald-400']" />
                  <span>cover.png</span>
                </div>
                <div v-if="includeBackground" :class="['flex items-center gap-1.5 text-neutral-300']">
                  <div i-solar:wallpaper-linear :class="['text-emerald-400']" />
                  <span>background.png</span>
                </div>
                <div v-if="includeModels" :class="['flex flex-col pl-2 border-l border-neutral-800 text-neutral-300']">
                  <span :class="['text-neutral-500 text-[9px] uppercase font-bold']">📁 models/</span>
                  <div :class="['flex items-center gap-1.5 pl-2 py-0.5']">
                    <div i-solar:box-linear :class="['text-purple-400']" />
                    <span>base_model.vrm</span>
                  </div>
                </div>
                <div v-if="includeVoiceProfiles" :class="['flex flex-col pl-2 border-l border-neutral-800 text-neutral-300']">
                  <span :class="['text-neutral-500 text-[9px] uppercase font-bold']">📁 voices/</span>
                  <div :class="['flex items-center gap-1.5 pl-2 py-0.5']">
                    <div i-solar:soundwave-linear :class="['text-pink-400']" />
                    <span>voice_profile.json</span>
                  </div>
                </div>
                <div v-if="includeMemories" :class="['flex flex-col pl-2 border-l border-neutral-800 text-neutral-300']">
                  <span :class="['text-neutral-500 text-[9px] uppercase font-bold']">📁 memories/</span>
                  <div :class="['flex items-center gap-1.5 pl-2 py-0.5']">
                    <div i-solar:chat-round-dots-linear :class="['text-teal-400']" />
                    <span>chat_sessions.json</span>
                  </div>
                </div>
                <div v-if="generateReadme" :class="['flex items-center gap-1.5 text-neutral-400 mt-1']">
                  <div i-solar:document-text-linear :class="['text-blue-400']" />
                  <span>README.md</span>
                </div>
              </div>
            </div>

            <!-- Right: ZIP Options -->
            <div :class="['flex-1 w-full flex flex-col gap-2.5']">
              <!-- Package Spec Flavor -->
              <div :class="['flex items-center gap-2 p-1 rounded-lg bg-neutral-100 dark:bg-neutral-800/60 w-fit text-xs font-medium']">
                <button
                  :class="[
                    'px-2.5 py-1 rounded-md transition-all',
                    zipFlavor === 'v2' ? 'bg-white shadow-xs text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100 font-semibold' : 'text-neutral-500',
                  ]"
                  @click="zipFlavor = 'v2'"
                >
                  AIRI Extended (v2)
                </button>
                <button
                  :class="[
                    'px-2.5 py-1 rounded-md transition-all',
                    zipFlavor === 'v1' ? 'bg-white shadow-xs text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100 font-semibold' : 'text-neutral-500',
                  ]"
                  @click="zipFlavor = 'v1'"
                >
                  moeru-ai Standard (v1)
                </button>
              </div>

              <!-- Checkboxes -->
              <div :class="['flex flex-col gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 bg-neutral-50/50 dark:bg-neutral-950/20 text-xs']">
                <label :class="['flex items-start gap-2 cursor-pointer select-none']">
                  <input v-model="includeModels" type="checkbox" :class="['mt-0.5 rounded text-primary-600']">
                  <div :class="['flex flex-col']">
                    <span :class="['font-medium text-neutral-800 dark:text-neutral-200']">Bundle 3D/2D Display Models</span>
                    <span :class="['text-[11px] text-amber-600 dark:text-amber-400']">Only share if model licenses permit redistribution</span>
                  </div>
                </label>

                <label v-if="zipFlavor === 'v2'" :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="includeBackground" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['text-neutral-700 dark:text-neutral-300']">Include scene background image</span>
                </label>

                <label v-if="zipFlavor === 'v2'" :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="includeVoiceProfiles" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['text-neutral-700 dark:text-neutral-300']">Include virtual voice profiles</span>
                </label>

                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="includeCoverFrame" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['text-neutral-700 dark:text-neutral-300']">Include collectible glass-framed cover (925×1436)</span>
                </label>

                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="includeMemories" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['text-neutral-700 dark:text-neutral-300']">Include episodic memories &amp; chat history</span>
                </label>

                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="generateReadme" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['text-neutral-700 dark:text-neutral-300']">Generate README.md with credits &amp; compatibility</span>
                </label>
              </div>
            </div>
          </div>

          <!-- ==================== 2. PNG SECTION ==================== -->
          <div v-else-if="activeSegment === 'png'" :class="['flex flex-col sm:flex-row gap-5 items-start']">
            <!-- Left: PNG Card Preview (Fixed width side-by-side) -->
            <div :class="['w-full sm:w-[170px] shrink-0 flex flex-col items-center justify-center p-2 rounded-xl bg-neutral-50 dark:bg-neutral-950/50 border border-neutral-200 dark:border-neutral-800']">
              <div
                v-if="pngFramed"
                :class="[
                  'relative aspect-[925/1436] w-full max-w-[150px] overflow-hidden rounded-lg shadow-md border border-neutral-200 dark:border-neutral-700 bg-neutral-900',
                ]"
              >
                <div :class="['absolute inset-x-[7%] top-[5.5%] bottom-[10%] overflow-hidden rounded bg-neutral-800 flex items-center justify-center']">
                  <img v-if="modelPreviewUrl" :src="modelPreviewUrl" alt="Preview" :class="['h-full w-full object-cover object-top']">
                  <div v-else i-solar:user-bold-duotone :class="['text-4xl text-primary-400/80']" />
                </div>
                <img :src="cardExportFrameUrl" alt="Glass Frame" :class="['pointer-events-none absolute inset-0 h-full w-full object-fill z-10']">
              </div>
              <div
                v-else
                :class="[
                  'relative aspect-square w-full max-w-[150px] overflow-hidden rounded-xl shadow-md border border-neutral-200 dark:border-neutral-700 bg-neutral-800 flex items-center justify-center',
                ]"
              >
                <img v-if="modelPreviewUrl" :src="modelPreviewUrl" alt="Portrait" :class="['h-full w-full object-cover object-top']">
                <div v-else i-solar:user-bold-duotone :class="['text-5xl text-primary-400']" />
              </div>
              <span :class="['mt-2 text-[10px] text-neutral-400 font-mono']">
                {{ pngFramed ? '925 × 1436 px (Glass Frame)' : '1:1 Aspect (Raw)' }}
              </span>
            </div>

            <!-- Right: PNG Options -->
            <div :class="['flex-1 w-full flex flex-col gap-3']">
              <div :class="['flex flex-col gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-xs bg-neutral-50/50 dark:bg-neutral-950/20']">
                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="pngFramed" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['font-medium text-neutral-800 dark:text-neutral-200']">Apply AIRI Collectible Glass Frame Overlay</span>
                </label>
                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="pngOmitNotes" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['text-neutral-700 dark:text-neutral-300']">Omit private creator notes &amp; scratchpad</span>
                </label>
              </div>
            </div>
          </div>

          <!-- ==================== 3. JSON SECTION ==================== -->
          <div v-else :class="['flex flex-col sm:flex-row gap-5 items-start']">
            <!-- Left: JSON Code Preview -->
            <div :class="['w-full sm:w-[220px] shrink-0 flex flex-col gap-1.5']">
              <span :class="['text-[11px] font-semibold uppercase tracking-wider text-neutral-400']">
                Manifest Code Preview
              </span>
              <div
                :class="[
                  'h-[200px] overflow-auto rounded-xl bg-neutral-950 p-2.5 text-[10px] font-mono text-neutral-300 leading-relaxed',
                  'border border-neutral-800',
                ]"
              >
                <pre><code>{{ previewJsonString }}</code></pre>
              </div>
            </div>

            <!-- Right: JSON Options -->
            <div :class="['flex-1 w-full flex flex-col gap-3']">
              <div :class="['flex flex-col gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-xs bg-neutral-50/50 dark:bg-neutral-950/20']">
                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="jsonPretty" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['font-medium text-neutral-800 dark:text-neutral-200']">Pretty-print with 2-space indentation (for git)</span>
                </label>
                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="jsonIncludeMemories" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['text-neutral-700 dark:text-neutral-300']">Include short-term &amp; long-term memory logs</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div
          :class="[
            'flex items-center justify-between px-6 py-3.5 border-t border-neutral-200 dark:border-neutral-800',
            'bg-neutral-50/70 dark:bg-neutral-900/70 backdrop-blur-md',
          ]"
        >
          <Button
            variant="secondary"
            :class="['flex items-center gap-1.5 text-xs']"
            @click="handleMockCopyPayload"
          >
            <div i-solar:copy-linear :class="['text-sm']" />
            <span>Copy {{ activeSegment.toUpperCase() }}</span>
          </Button>

          <div :class="['flex items-center gap-3']">
            <Button
              variant="secondary"
              @click="handleClose"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              :class="['flex items-center gap-1.5']"
              @click="handleMockExportDownload"
            >
              <div i-solar:download-minimalistic-bold-duotone :class="['text-base']" />
              <span>Export &amp; Download (.{{ activeSegment }})</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
