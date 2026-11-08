<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, ref, watch } from 'vue'

import { useStickersStore } from '../../../stores/stickers'

const props = defineProps<{
  file: Blob | null
}>()

const emit = defineEmits<{
  (e: 'added', id: string): void
  (e: 'close'): void
}>()

const open = defineModel<boolean>({ default: false })

const stickersStore = useStickersStore()

const workingBlob = ref<Blob | null>(null)
const previewUrl = ref<string | null>(null)
const label = ref('')
const phase = ref<'idle' | 'loading-model' | 'segmenting'>('idle')
const progress = ref<number | null>(null)
const error = ref<string | null>(null)
const lastMaskData = ref<Uint8Array | null>(null)
const lastSourceImageData = ref<ImageData | null>(null)
const sensitivity = ref(65)

let aborter: AbortController | null = null

const isBusy = computed(() => phase.value !== 'idle')
const isTransparent = computed(() => !!workingBlob.value && workingBlob.value !== props.file)

function revokePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
}

function reset(file: Blob | null) {
  aborter?.abort()
  aborter = null
  revokePreview()
  error.value = null
  phase.value = 'idle'
  progress.value = null
  lastMaskData.value = null
  lastSourceImageData.value = null
  sensitivity.value = 65
  workingBlob.value = file
  label.value = ''
  if (file) {
    const name = (file as File).name || 'sticker.png'
    label.value = name.replace(/\.[^/.]+$/, '')
    previewUrl.value = URL.createObjectURL(file)
  }
}

watch(() => [open.value, props.file] as const, ([isOpen, file]) => {
  if (isOpen && file)
    reset(file)
}, { immediate: true })

function close() {
  aborter?.abort()
  aborter = null
  revokePreview()
  lastMaskData.value = null
  lastSourceImageData.value = null
  sensitivity.value = 65
  workingBlob.value = null
  open.value = false
  emit('close')
}

async function handleMakeTransparent() {
  if (!props.file || isBusy.value)
    return
  aborter?.abort()
  aborter = new AbortController()
  error.value = null
  phase.value = 'loading-model'
  progress.value = null
  try {
    const cutout = await stickersStore.removeImageBackground(props.file, {
      signal: aborter.signal,
      sensitivity: sensitivity.value,
      onProgress: (stage, percent) => {
        phase.value = stage
        progress.value = typeof percent === 'number' && percent >= 0 ? Math.round(percent) : null
      },
    })
    lastMaskData.value = cutout.maskData ?? null
    lastSourceImageData.value = cutout.sourceImageData ?? null
    workingBlob.value = cutout
    revokePreview()
    previewUrl.value = URL.createObjectURL(cutout)
  }
  catch (err) {
    if ((err as Error)?.name === 'AbortError' || aborter?.signal.aborted)
      return
    console.error('[StickerUploadDialog] Background removal failed:', err)
    error.value = err instanceof Error ? err.message : 'Background removal failed.'
  }
  finally {
    phase.value = 'idle'
  }
}

async function handleSensitivityChange() {
  if (!lastSourceImageData.value || !lastMaskData.value)
    return

  try {
    const newCutout = await stickersStore.recomputeCutoutBlob(
      lastSourceImageData.value,
      lastMaskData.value,
      sensitivity.value,
    )
    workingBlob.value = newCutout
    revokePreview()
    previewUrl.value = URL.createObjectURL(newCutout)
  }
  catch (err) {
    console.error('[StickerUploadDialog] Failed to recompute cutout with sensitivity:', err)
  }
}

function handleRevert() {
  if (!props.file || isBusy.value)
    return
  aborter?.abort()
  error.value = null
  lastMaskData.value = null
  lastSourceImageData.value = null
  sensitivity.value = 65
  workingBlob.value = props.file
  revokePreview()
  previewUrl.value = URL.createObjectURL(props.file)
}

async function handleAdd() {
  const file = workingBlob.value ?? props.file
  if (!file || isBusy.value)
    return
  try {
    const id = await stickersStore.addSticker(file, label.value.trim() || undefined)
    emit('added', id)
    close()
  }
  catch (err) {
    console.error('[StickerUploadDialog] Failed to add sticker:', err)
    error.value = err instanceof Error ? err.message : 'Failed to add sticker.'
  }
}

const statusText = computed(() => {
  if (phase.value === 'loading-model')
    return progress.value != null ? `Loading background model… ${progress.value}%` : 'Loading background model…'
  if (phase.value === 'segmenting')
    return 'Removing background…'
  return ''
})
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-100 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <DialogContent class="fixed left-1/2 top-1/2 z-100 m-0 max-h-[85vh] max-w-md w-[92vw] flex flex-col gap-4 border border-neutral-200 rounded-2xl bg-white p-5 shadow-2xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-700 dark:bg-neutral-800">
        <DialogTitle class="text-base text-neutral-800 font-bold dark:text-neutral-100">
          Add Sticker
        </DialogTitle>

        <div
          class="min-h-48 flex items-center justify-center overflow-hidden border border-neutral-200 rounded-xl dark:border-neutral-700"
          style="background-image: repeating-conic-gradient(#d4d4d4 0% 25%, #fafafa 0% 50%); background-size: 16px 16px;"
        >
          <img
            v-if="previewUrl"
            :src="previewUrl"
            class="max-h-64 max-w-full object-contain"
            alt="Sticker preview"
          >
          <span v-else class="p-8 text-xs text-neutral-400">No image selected</span>
        </div>

        <input
          v-model="label"
          type="text"
          placeholder="Sticker label…"
          :disabled="isBusy"
          class="w-full border border-neutral-200 rounded-lg bg-neutral-50/50 px-3 py-2 text-sm outline-none dark:border-neutral-700 focus:border-primary-500 dark:bg-neutral-900/50"
        >

        <div v-if="isBusy" class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <div class="i-ph:spinner-gap-bold size-4 animate-spin" />
          <span>{{ statusText }}</span>
        </div>

        <p v-if="error" class="text-xs text-red-500">
          {{ error }}
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            class="flex items-center gap-1.5"
            :disabled="!props.file || isBusy || isTransparent"
            @click="handleMakeTransparent"
          >
            <div class="i-ph:sparkle-bold size-3" />
            Make Transparent
          </Button>
          <Button
            v-if="isTransparent"
            variant="secondary"
            size="sm"
            class="flex items-center gap-1.5"
            :disabled="isBusy"
            @click="handleRevert"
          >
            <div class="i-ph:arrow-counter-clockwise-bold size-3" />
            Revert
          </Button>
        </div>

        <!-- Edge Sensitivity Slider (Active after background removal) -->
        <div v-if="lastMaskData" class="w-full flex flex-col gap-1.5 border border-neutral-200/80 rounded-lg bg-neutral-50/80 p-2.5 text-left dark:border-neutral-700/80 dark:bg-neutral-800/50">
          <div class="flex items-center justify-between text-xs">
            <label for="sticker-upload-sensitivity-slider" class="flex items-center gap-1.5 text-neutral-600 font-medium dark:text-neutral-300">
              <div class="i-ph:sliders-horizontal-bold size-3.5 text-primary-500" />
              <span>Edge Sensitivity</span>
            </label>
            <span class="text-[11px] text-neutral-500 font-mono dark:text-neutral-400">{{ sensitivity }}%</span>
          </div>
          <input
            id="sticker-upload-sensitivity-slider"
            v-model.number="sensitivity"
            type="range"
            min="0"
            max="100"
            step="1"
            :disabled="isBusy"
            class="h-1.5 w-full cursor-pointer rounded-lg bg-neutral-200 accent-primary-500 dark:bg-neutral-700"
            @input="handleSensitivityChange"
          >
          <div class="flex justify-between text-[10px] text-neutral-400">
            <span>Clean (0%)</span>
            <span class="text-neutral-500 font-medium">Default (65%)</span>
            <span>Preserve Edges (100%)</span>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
          <Button variant="secondary" size="sm" :disabled="isBusy" @click="close">
            Cancel
          </Button>
          <Button variant="primary" size="sm" :disabled="!workingBlob || isBusy" @click="handleAdd">
            Add Sticker
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
