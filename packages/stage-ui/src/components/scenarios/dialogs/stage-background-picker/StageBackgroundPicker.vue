<script setup lang="ts">
import { useBackgroundStore } from '@proj-airi/stage-ui/stores'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  cardId?: string
  gridMaxHeightClass?: string
  allowInherit?: boolean
  autoApply?: boolean
  title?: string
  subtitle?: string
}>(), {
  gridMaxHeightClass: 'max-h-[60vh]',
  allowInherit: false,
  autoApply: true,
  title: 'Gallery View',
  subtitle: 'History of images generated and stage scenes.',
})

const emit = defineEmits<{
  (e: 'pick', id: string): void
  (e: 'update:modelValue', id: string): void
  (e: 'update:selectedId', id: string): void
}>()

const modelValue = defineModel<string>({ required: false })
const selectedIdModel = defineModel<string>('selectedId', { required: false })

const cardStore = useAiriCardStore()
const backgroundStore = useBackgroundStore()
const isRefreshingGallery = ref(false)
const localSelectedId = ref<string>()

// Get selected card data
const selectedCard = computed(() => {
  if (!props.cardId)
    return undefined
  return cardStore.getCard(props.cardId)
})

// All available backgrounds for this card (builtin + shared scenes + character journal images)
const allBackgrounds = computed(() => {
  if (props.cardId) {
    return backgroundStore.getCharacterBackgrounds(props.cardId)
  }
  return backgroundStore.availableBackgrounds || []
})

// Current background ID
const activeBackgroundId = computed<string>({
  get: () => {
    if (selectedIdModel.value !== undefined)
      return selectedIdModel.value
    if (modelValue.value !== undefined)
      return modelValue.value
    if (localSelectedId.value !== undefined)
      return localSelectedId.value
    return selectedCard.value?.extensions?.airi?.modules?.activeBackgroundId || 'none'
  },
  set: async (val: string) => {
    localSelectedId.value = val
    if (selectedIdModel.value !== undefined) {
      selectedIdModel.value = val
    }
    if (modelValue.value !== undefined) {
      modelValue.value = val
    }
    emit('pick', val)
    emit('update:modelValue', val)
    emit('update:selectedId', val)

    if (props.autoApply && props.cardId && selectedCard.value) {
      const extension = JSON.parse(JSON.stringify(selectedCard.value.extensions || {}))
      if (!extension.airi)
        extension.airi = {}
      if (!extension.airi.modules)
        extension.airi.modules = {}

      extension.airi.modules.activeBackgroundId = val

      await cardStore.updateCard(props.cardId, {
        ...selectedCard.value,
        extensions: extension,
      })
    }
  },
})

function handleSetAsBackground(id: string) {
  activeBackgroundId.value = id
}

async function handleDeleteEntry(id: string) {
  if (confirm('Are you sure you want to delete this image?')) {
    await backgroundStore.removeBackground(id)
  }
}

async function handleRefreshGallery() {
  isRefreshingGallery.value = true
  try {
    await backgroundStore.initializeStore()
  }
  finally {
    isRefreshingGallery.value = false
  }
}

async function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file)
    return
  try {
    const newId = await backgroundStore.addBackground('scene', file, file.name.replace(/\.[^/.]+$/, ''), undefined, props.cardId || null)
    handleSetAsBackground(newId)
  }
  catch (err) {
    console.error('Failed to add background:', err)
  }
  finally {
    target.value = ''
  }
}

async function handleDownloadEntry(id: string, title: string) {
  const url = backgroundStore.getBackgroundUrl(id)
  if (!url)
    return

  const link = document.createElement('a')
  link.href = url
  link.download = `${title || 'image'}.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

const previewImageUrl = ref<string | null>(null)
const previewImageTitle = ref<string | null>(null)

function handlePreviewEntry(id: string, title: string) {
  const url = backgroundStore.getBackgroundUrl(id)
  if (url) {
    previewImageUrl.value = url
    previewImageTitle.value = title
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-neutral-100 pb-4 dark:border-neutral-700/50">
      <div class="flex flex-col gap-1">
        <h3 class="text-sm text-neutral-900 font-semibold dark:text-neutral-100">
          {{ title }}
        </h3>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ subtitle }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <!-- Inherit / No Override Button -->
        <button
          v-if="allowInherit"
          class="h-8 flex items-center gap-1.5 border rounded-lg px-3 text-xs font-semibold transition-all active:scale-95"
          :class="[
            activeBackgroundId === 'inherit'
              ? 'border-primary-500 bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
              : 'border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 hover:border-primary-300 hover:text-primary-500',
          ]"
          @click="handleSetAsBackground('inherit')"
        >
          <div
            class="text-sm"
            :class="activeBackgroundId === 'inherit' ? 'i-solar:restart-bold' : 'i-solar:restart-linear'"
          />
          <span>Inherit Default</span>
        </button>

        <!-- Clear / None Background Button -->
        <button
          class="h-8 flex items-center gap-1.5 border rounded-lg px-3 text-xs font-semibold transition-all active:scale-95"
          :class="[
            activeBackgroundId === 'none'
              ? 'border-primary-500 bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
              : 'border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 hover:border-primary-300 hover:text-primary-500',
          ]"
          @click="handleSetAsBackground('none')"
        >
          <div
            class="text-sm"
            :class="activeBackgroundId === 'none' ? 'i-solar:gallery-remove-bold' : 'i-solar:gallery-remove-linear'"
          />
          <span>None</span>
        </button>

        <!-- Upload Button -->
        <label
          class="dark:hover:bg-neutral-850 h-8 flex cursor-pointer items-center gap-1.5 border border-neutral-200 rounded-lg bg-neutral-50 px-3 text-xs text-neutral-500 font-semibold transition-all active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:text-neutral-200"
          title="Upload new background"
        >
          <input
            type="file"
            accept="image/*"
            class="hidden"
            @change="handleFileUpload"
          >
          <div class="i-solar:upload-linear text-xs" />
          <span>Upload</span>
        </label>

        <!-- Refresh Button -->
        <button
          class="dark:hover:bg-neutral-850 h-8 flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-neutral-50 px-3 text-xs text-neutral-500 font-semibold transition-all active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:text-neutral-200"
          :disabled="isRefreshingGallery"
          @click="handleRefreshGallery"
        >
          <div
            class="i-lucide:refresh-cw text-xs"
            :class="{ 'animate-spin': isRefreshingGallery }"
          />
          <span>Refresh</span>
        </button>
      </div>
    </div>

    <!-- Grid -->
    <div :class="['grid grid-cols-2 gap-3 overflow-y-auto pr-2 scrollbar-none lg:grid-cols-4 md:grid-cols-3', gridMaxHeightClass]">
      <!-- Empty state -->
      <div v-if="allBackgrounds.length === 0" class="col-span-full flex flex-col items-center justify-center py-12 text-center text-neutral-400">
        <div class="i-solar:gallery-broken mb-2 text-4xl" />
        <p class="text-xs">
          No background images found in gallery.
        </p>
        <p class="mt-1 text-[10px] text-neutral-500">
          Upload a background image or generate one via Artistry to populate your gallery.
        </p>
      </div>

      <!-- Background Items -->
      <div
        v-for="entry in allBackgrounds"
        :key="entry.id"
        class="group relative h-36 cursor-pointer overflow-hidden border-2 rounded-xl bg-neutral-100 transition-all sm:aspect-square sm:h-auto active:scale-95 dark:bg-neutral-900"
        :class="[
          activeBackgroundId === entry.id
            ? 'border-primary-500 ring-2 ring-primary-500/20'
            : 'border-neutral-200 dark:border-neutral-800 hover:border-primary-300',
        ]"
        @click="handleSetAsBackground(entry.id)"
      >
        <img
          :src="backgroundStore.getBackgroundUrl(entry.id) ?? undefined"
          class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          loading="lazy"
        >

        <!-- Overlay Actions -->
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <button
            class="flex items-center gap-1 rounded-full px-3 py-1.5 text-[10px] text-white font-bold backdrop-blur-md transition-all active:scale-95"
            :class="activeBackgroundId === entry.id ? 'bg-primary-500 hover:bg-primary-600' : 'bg-white/20 hover:bg-white/30'"
            @click.stop="handleSetAsBackground(entry.id)"
          >
            <div :class="activeBackgroundId === entry.id ? 'i-solar:pin-bold' : 'i-solar:pin-linear'" />
            {{ activeBackgroundId === entry.id ? 'ACTIVE' : 'SELECT' }}
          </button>
          <div class="flex gap-2" @click.stop>
            <button
              class="h-8 w-8 flex items-center justify-center rounded-full bg-neutral-500/80 text-white backdrop-blur-md transition-all active:scale-95 hover:bg-neutral-600"
              title="Preview"
              @click.stop="handlePreviewEntry(entry.id, entry.title)"
            >
              <div class="i-solar:eye-linear text-sm" />
            </button>
            <button
              class="h-8 w-8 flex items-center justify-center rounded-full bg-blue-500/80 text-white backdrop-blur-md transition-all active:scale-95 hover:bg-blue-500"
              title="Download"
              @click.stop="handleDownloadEntry(entry.id, entry.title)"
            >
              <div class="i-solar:download-square-linear text-sm" />
            </button>
            <button
              v-if="entry.type !== 'builtin'"
              class="h-8 w-8 flex items-center justify-center rounded-full bg-red-500/80 text-white backdrop-blur-md transition-all active:scale-95 hover:bg-red-500"
              title="Delete"
              @click.stop="handleDeleteEntry(entry.id)"
            >
              <div class="i-solar:trash-bin-trash-linear text-sm" />
            </button>
          </div>
        </div>

        <!-- Info Badge -->
        <div class="pointer-events-none absolute bottom-1 left-1 right-1 truncate rounded bg-black/40 px-2 py-1 text-[9px] text-white/90 backdrop-blur-sm">
          {{ entry.title }}
        </div>

        <!-- Active Indicator -->
        <div v-if="activeBackgroundId === entry.id" class="absolute right-2 top-2 rounded-full bg-primary-500 p-1 text-white shadow-lg">
          <div class="i-solar:check-circle-bold text-[10px]" />
        </div>
      </div>
      <!-- Image Preview Overlay -->
      <div
        v-if="previewImageUrl"
        class="fixed inset-0 z-[10020] flex flex-col items-center justify-center bg-black/95 p-4 transition-all duration-300"
        @click="previewImageUrl = null"
      >
        <!-- Close Button -->
        <button
          class="absolute right-6 top-6 h-12 w-12 flex items-center justify-center rounded-full bg-white/10 text-white transition-all active:scale-95 hover:bg-white/20"
          @click="previewImageUrl = null"
        >
          <div class="i-solar:close-circle-bold text-2xl" />
        </button>

        <!-- Fullscreen Image -->
        <div class="animate-in zoom-in-95 relative max-h-[80vh] max-w-[90vw] flex flex-col items-center gap-4 duration-200" @click.stop>
          <img
            :src="previewImageUrl"
            class="max-h-[75vh] max-w-full rounded-2xl object-contain shadow-2xl"
          >
          <div class="text-center">
            <h4 class="text-sm text-white/90 font-semibold">
              {{ previewImageTitle }}
            </h4>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
