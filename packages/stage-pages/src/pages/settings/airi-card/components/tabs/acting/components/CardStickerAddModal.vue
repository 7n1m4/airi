<script setup lang="ts">
import type { CardCustomSticker } from '@proj-airi/stage-ui/types/card.schema'

import { useStickersStore } from '@proj-airi/stage-ui/stores/stickers'
import { Button } from '@proj-airi/ui'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

interface Props {
  modelValue: boolean
  cardId?: string
  existingIds?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  existingIds: () => [],
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'created', sticker: CardCustomSticker): void
}>()

const stickersStore = useStickersStore()

const fileInputRef = ref<HTMLInputElement>()
const selectedFile = ref<File | null>(null)
const previewUrl = ref<string>('')
const stickerId = ref<string>('')
const label = ref<string>('')
const description = ref<string>('')
const emotionsInput = ref<string>('')
const idManuallyEdited = ref(false)
const isSaving = ref(false)
const isDragging = ref(false)

const EMOTION_SUGGESTIONS = [
  'happy',
  'smug',
  'love',
  'sad',
  'angry',
  'surprised',
  'shocked',
  'confused',
  'tired',
  'thanks',
  'celebrate',
  'awkward',
]

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\.[^/.]+$/, '') // remove extension
    .replace(/[^a-z0-9_-]+/g, '-') // replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
}

function handleFileSelected(file: File) {
  if (!file.type.startsWith('image/')) {
    toast.error('Please select an image file (PNG, WebP, GIF, or JPEG).')
    return
  }

  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }

  selectedFile.value = file
  previewUrl.value = URL.createObjectURL(file)

  if (!idManuallyEdited.value || !stickerId.value) {
    stickerId.value = slugify(file.name)
  }

  if (!label.value) {
    const rawName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim()
    label.value = rawName.charAt(0).toUpperCase() + rawName.slice(1)
  }
}

function onFileInputChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files && files[0]) {
    handleFileSelected(files[0])
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files && files[0]) {
    handleFileSelected(files[0])
  }
}

function handleIdInput(e: Event) {
  idManuallyEdited.value = true
  const input = (e.target as HTMLInputElement).value
  stickerId.value = slugify(input)
}

function toggleEmotionChip(emotion: string) {
  const current = emotionsInput.value
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

  const index = current.indexOf(emotion)
  if (index >= 0) {
    current.splice(index, 1)
  }
  else {
    current.push(emotion)
  }
  emotionsInput.value = current.join(', ')
}

const idCollision = computed(() => {
  if (!stickerId.value)
    return false
  return props.existingIds.includes(stickerId.value)
})

const isValid = computed(() => {
  return (
    !!selectedFile.value
    && !!stickerId.value
    && !idCollision.value
    && !!label.value.trim()
    && !!description.value.trim()
  )
})

function resetForm() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  selectedFile.value = null
  previewUrl.value = ''
  stickerId.value = ''
  label.value = ''
  description.value = ''
  emotionsInput.value = ''
  idManuallyEdited.value = false
  isSaving.value = false
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      resetForm()
    }
  },
)

async function handleSave() {
  if (!isValid.value || !selectedFile.value) {
    return
  }

  isSaving.value = true
  try {
    const finalId = stickerId.value
    const parsedEmotions = emotionsInput.value
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)

    if (parsedEmotions.length === 0) {
      parsedEmotions.push(finalId)
    }

    // Save binary into localforage directly
    await stickersStore.addSticker(
      selectedFile.value,
      label.value.trim(),
      props.cardId,
      finalId,
    )

    const newSticker: CardCustomSticker = {
      id: finalId,
      label: label.value.trim(),
      description: description.value.trim(),
      emotions: parsedEmotions,
      createdAt: Date.now(),
    }

    emit('created', newSticker)
    emit('update:modelValue', false)
    toast.success(`Sticker "<|STICKER ${finalId}|>" created!`)
  }
  catch (err: any) {
    console.error('[CardStickerAddModal] Failed to save sticker:', err)
    toast.error(`Failed to save sticker: ${err?.message || 'Unknown error'}`)
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-[9999] max-h-[90vh] max-w-lg w-full flex flex-col overflow-hidden border border-neutral-200 rounded-2xl bg-white shadow-2xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-800 dark:bg-neutral-900"
      >
        <!-- Modal Header -->
        <div class="flex items-center justify-between border-b border-neutral-100 p-5 dark:border-neutral-800">
          <div class="flex items-center gap-2.5">
            <div class="rounded-xl bg-primary-500/10 p-2 text-primary-500">
              <div class="i-solar:sticker-smile-circle-bold-duotone text-xl" />
            </div>
            <div>
              <DialogTitle class="text-base text-neutral-800 font-semibold dark:text-neutral-100">
                Add Custom Reaction Sticker
              </DialogTitle>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                Upload a transparent PNG/WebP and configure its LLM prompt directives.
              </p>
            </div>
          </div>
          <button
            type="button"
            class="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            @click="emit('update:modelValue', false)"
          >
            <div class="i-solar:close-circle-bold text-lg" />
          </button>
        </div>

        <!-- Modal Body (Scrollable) -->
        <div class="flex flex-col gap-5 overflow-y-auto p-5">
          <!-- Image Dropzone / Preview -->
          <div class="flex flex-col gap-2">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Sticker Artwork <span class="text-red-500">*</span>
            </label>

            <input
              ref="fileInputRef"
              type="file"
              accept="image/png,image/webp,image/gif,image/jpeg"
              class="hidden"
              @change="onFileInputChange"
            >

            <div
              v-if="!selectedFile"
              class="cursor-pointer border-2 rounded-xl border-dashed p-6 text-center transition-all"
              :class="[
                isDragging
                  ? 'border-primary-500 bg-primary-500/10'
                  : 'border-neutral-200 dark:border-neutral-800 hover:border-primary-500/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/40',
              ]"
              @click="fileInputRef?.click()"
              @dragover.prevent="isDragging = true"
              @dragleave.prevent="isDragging = false"
              @drop.prevent="onDrop"
            >
              <div class="flex flex-col items-center gap-2">
                <div class="rounded-full bg-primary-500/10 p-3 text-primary-500">
                  <div class="i-solar:upload-track-2-bold-duotone text-2xl" />
                </div>
                <div class="text-xs text-neutral-700 font-medium dark:text-neutral-200">
                  Click to select PNG or drag image here
                </div>
                <div class="text-[11px] text-neutral-400 dark:text-neutral-500">
                  Recommended: Transparent PNG or WebP, square (256×256 or 512×512)
                </div>
              </div>
            </div>

            <!-- Preview box with checkerboard background -->
            <div
              v-else
              class="flex items-center gap-4 border border-neutral-200 rounded-xl bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/60"
            >
              <div
                class="relative size-24 shrink-0 overflow-hidden border border-neutral-200 rounded-lg dark:border-neutral-700"
                style="background-image: linear-gradient(45deg, #e5e5e5 25%, transparent 25%), linear-gradient(-45deg, #e5e5e5 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e5e5 75%), linear-gradient(-45deg, transparent 75%, #e5e5e5 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px;"
              >
                <img
                  :src="previewUrl"
                  :alt="label || 'Sticker preview'"
                  class="size-full object-contain"
                >
              </div>

              <div class="flex flex-1 flex-col gap-1 overflow-hidden">
                <span class="truncate text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                  {{ selectedFile.name }}
                </span>
                <span class="text-[11px] text-neutral-400">
                  {{ (selectedFile.size / 1024).toFixed(1) }} KB • {{ selectedFile.type || 'image/png' }}
                </span>
                <div class="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    class="rounded px-2 py-0.5 text-xs text-primary-600 transition-colors hover:bg-primary-500/10 dark:text-primary-400"
                    @click="fileInputRef?.click()"
                  >
                    Change Image
                  </button>
                  <span class="text-neutral-300 dark:text-neutral-700">|</span>
                  <button
                    type="button"
                    class="rounded px-2 py-0.5 text-xs text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                    @click="resetForm"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Token ID Slug -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
                Token Slug (ID) <span class="text-red-500">*</span>
              </label>
              <div v-if="stickerId" class="text-[11px] text-neutral-400 font-mono">
                Emit: <span class="text-primary-500 font-semibold">&lt;|STICKER {{ stickerId }}|&gt;</span>
              </div>
            </div>

            <div class="relative">
              <input
                :value="stickerId"
                type="text"
                placeholder="e.g. columbina-scheming"
                class="w-full border border-neutral-200 rounded-lg bg-neutral-50 px-3 py-2 text-xs font-mono shadow-sm outline-none transition-all dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-950 focus:bg-white dark:focus:bg-neutral-900"
                :class="{ 'border-red-500 focus:border-red-500': idCollision }"
                @input="handleIdInput"
              >
            </div>
            <span v-if="idCollision" class="text-[11px] text-red-500">
              A sticker with ID "{{ stickerId }}" already exists in the catalog. Please choose another.
            </span>
            <span v-else class="text-[11px] text-neutral-400">
              Lowercase letters, numbers, and hyphens. This is the identifier the character emits.
            </span>
          </div>

          <!-- Display Label -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Display Name / Label <span class="text-red-500">*</span>
            </label>
            <input
              v-model="label"
              type="text"
              placeholder="e.g. Scheming Grin"
              class="w-full border border-neutral-200 rounded-lg bg-neutral-50 px-3 py-2 text-xs shadow-sm outline-none transition-all dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-950 focus:bg-white dark:focus:bg-neutral-900"
            >
          </div>

          <!-- Description (Guides LLM) -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Description & Scene Trigger <span class="text-red-500">*</span>
            </label>
            <textarea
              v-model="description"
              rows="3"
              placeholder="e.g. Mischievous smirk with finger touching lips, teasing and confident"
              class="w-full border border-neutral-200 rounded-lg bg-neutral-50 px-3 py-2 text-xs leading-relaxed shadow-sm outline-none transition-all dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-950 focus:bg-white dark:focus:bg-neutral-900"
            />
            <span class="text-[11px] text-neutral-400">
              The LLM reads this description to understand when to naturally emit this reaction sticker.
            </span>
          </div>

          <!-- Emotions / Tags -->
          <div class="flex flex-col gap-2">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Emotion Tags (comma-separated)
            </label>
            <input
              v-model="emotionsInput"
              type="text"
              placeholder="e.g. smug, teasing, playful"
              class="w-full border border-neutral-200 rounded-lg bg-neutral-50 px-3 py-2 text-xs shadow-sm outline-none transition-all dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-950 focus:bg-white dark:focus:bg-neutral-900"
            >

            <!-- Quick click chips -->
            <div class="flex flex-wrap gap-1.5 pt-1">
              <button
                v-for="chip in EMOTION_SUGGESTIONS"
                :key="chip"
                type="button"
                class="rounded-full px-2 py-0.5 text-[11px] font-medium transition-all"
                :class="[
                  emotionsInput.toLowerCase().includes(chip)
                    ? 'bg-primary-500 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700',
                ]"
                @click="toggleEmotionChip(chip)"
              >
                + {{ chip }}
              </button>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="flex items-center justify-end gap-2.5 border-t border-neutral-100 bg-neutral-50/50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
          <Button
            variant="secondary"
            size="sm"
            label="Cancel"
            @click="emit('update:modelValue', false)"
          />
          <Button
            variant="primary"
            size="sm"
            :disabled="!isValid || isSaving"
            :label="isSaving ? 'Saving...' : 'Add Sticker'"
            @click="handleSave"
          />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
