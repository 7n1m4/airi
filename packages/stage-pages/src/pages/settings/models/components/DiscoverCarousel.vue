<script setup lang="ts">
import type { SpotlightModel } from '@proj-anima/stage-ui/constants'

import { useElementSize } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  models: SpotlightModel[]
}>()

const emits = defineEmits<{
  (e: 'select', model: SpotlightModel): void
}>()

const activeId = defineModel<string>('activeId')

const containerRef = ref<HTMLElement | null>(null)
const { width: containerWidth } = useElementSize(containerRef)

const currentIndex = ref(0)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragDeltaX = ref(0)
const lastWheelTime = ref(0)
const failedImages = ref<Record<string, boolean>>({})

// Fallback container width
const effectiveWidth = computed(() => {
  return containerWidth.value > 0 ? containerWidth.value : 750
})

// Dynamic capacity based on width
const maxHalfCount = computed(() => {
  const w = effectiveWidth.value
  if (w < 500)
    return 1
  if (w < 800)
    return 2
  return 3
})

const halfCount = computed(() => {
  const total = props.models.length
  if (total <= 1)
    return 0
  const availableHalf = Math.floor((total - 1) / 2)
  return Math.min(maxHalfCount.value, Math.max(1, availableHalf))
})

const stepX = computed(() => {
  const w = effectiveWidth.value
  const count = halfCount.value
  if (count <= 0)
    return 0
  const targetRatio = w < 500 ? 0.44 : w < 800 ? 0.40 : 0.36
  const ideal = (w * targetRatio) / count
  return Math.round(Math.max(120, Math.min(ideal, 220)))
})

const centerModel = computed<SpotlightModel | null>(() => {
  if (props.models.length === 0)
    return null
  return props.models[currentIndex.value] ?? null
})

// Sync activeId with currentIndex
watch(
  () => props.models,
  (newModels) => {
    if (newModels.length === 0) {
      currentIndex.value = 0
      activeId.value = undefined
      return
    }
    const foundIdx = newModels.findIndex(m => m.id === activeId.value)
    if (foundIdx !== -1) {
      currentIndex.value = foundIdx
    }
    else {
      currentIndex.value = 0
      activeId.value = newModels[0]?.id
    }
  },
  { immediate: true },
)

watch(
  currentIndex,
  (idx) => {
    const model = props.models[idx]
    if (model) {
      activeId.value = model.id
    }
  },
)

watch(
  () => activeId.value,
  (id) => {
    if (!id || props.models.length === 0)
      return
    const idx = props.models.findIndex(m => m.id === id)
    if (idx !== -1 && idx !== currentIndex.value) {
      currentIndex.value = idx
    }
  },
)

function normalizeIndex(index: number, total: number): number {
  if (total <= 0)
    return 0
  return ((index % total) + total) % total
}

function prev() {
  if (props.models.length <= 1)
    return
  currentIndex.value = normalizeIndex(currentIndex.value - 1, props.models.length)
}

function next() {
  if (props.models.length <= 1)
    return
  currentIndex.value = normalizeIndex(currentIndex.value + 1, props.models.length)
}

function stepToOffset(offset: number) {
  if (offset === 0)
    return
  if (props.models.length <= 1)
    return
  currentIndex.value = normalizeIndex(currentIndex.value + offset, props.models.length)
}

interface VisibleSlot {
  model: SpotlightModel
  offset: number
  key: string
}

const visibleSlots = computed<VisibleSlot[]>(() => {
  const total = props.models.length
  if (total === 0)
    return []

  const count = halfCount.value
  const offsets: number[] = []
  for (let i = -count; i <= count; i++) {
    offsets.push(i)
  }

  return offsets.map((offset) => {
    const idx = normalizeIndex(currentIndex.value + offset, total)
    const model = props.models[idx]
    return {
      model,
      offset,
      key: `${model.id}-${offset}`,
    }
  })
})

function getSlotStyle(offset: number) {
  const abs = Math.abs(offset)
  const x = offset * stepX.value + (isDragging.value ? dragDeltaX.value * 0.35 : 0)
  const scale = abs === 0 ? 1.12 : Math.max(0.55, 0.90 - (abs - 1) * 0.14)
  const opacity = abs === 0 ? 1 : Math.max(0.35, 0.82 - (abs - 1) * 0.20)
  const zIndex = 30 - abs * 5

  return {
    transform: `translateX(calc(-50% + ${x}px)) scale(${scale})`,
    left: '50%',
    opacity,
    zIndex,
  }
}

// Drag & Wheel Gestures
function onPointerDown(e: PointerEvent) {
  if (props.models.length <= 1)
    return
  isDragging.value = true
  dragStartX.value = e.clientX
  dragDeltaX.value = 0
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value)
    return
  dragDeltaX.value = e.clientX - dragStartX.value
}

function onPointerUp() {
  if (!isDragging.value)
    return
  isDragging.value = false
  const threshold = 35
  if (dragDeltaX.value > threshold) {
    prev()
  }
  else if (dragDeltaX.value < -threshold) {
    next()
  }
  dragDeltaX.value = 0
}

function onWheel(e: WheelEvent) {
  if (props.models.length <= 1)
    return
  const now = Date.now()
  if (now - lastWheelTime.value < 220)
    return

  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (Math.abs(delta) > 18) {
    lastWheelTime.value = now
    if (delta > 0)
      next()
    else
      prev()
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    prev()
  }
  else if (e.key === 'ArrowRight') {
    e.preventDefault()
    next()
  }
  else if (e.key === 'Enter' || e.key === ' ') {
    if (centerModel.value) {
      e.preventDefault()
      emits('select', centerModel.value)
    }
  }
}

function handleModelClick(model: SpotlightModel, offset: number) {
  if (offset !== 0) {
    stepToOffset(offset)
  }
  else {
    emits('select', model)
  }
}

function onImageError(modelId: string) {
  failedImages.value[modelId] = true
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div
    ref="containerRef"
    class="relative h-[380px] w-full flex flex-col select-none justify-between overflow-hidden outline-none sm:h-[420px]"
    tabindex="0"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel.passive="onWheel"
  >
    <!-- Empty State -->
    <div
      v-if="models.length === 0"
      class="h-full flex flex-col items-center justify-center gap-3 p-6 text-neutral-400"
    >
      <div class="i-solar:ghost-bold-duotone text-5xl opacity-40" />
      <div class="text-sm font-semibold">
        No featured models for this filter
      </div>
      <div class="text-xs opacity-70">
        More curated models for this format are being indexed.
      </div>
    </div>

    <!-- Active Coverflow Stage -->
    <div v-else class="relative h-full w-full flex flex-1 items-center justify-center overflow-visible">
      <!-- Left Chevron -->
      <button
        v-if="models.length > 1"
        type="button"
        class="absolute left-2 top-1/2 z-35 flex items-center justify-center border border-neutral-200/80 rounded-full bg-white/90 p-2.5 shadow-md backdrop-blur-md transition-all -translate-y-1/2 active:scale-95 hover:scale-105 dark:border-neutral-700/80 dark:bg-neutral-800/90 hover:bg-white dark:hover:bg-neutral-700"
        aria-label="Previous Model"
        @click.stop="prev"
      >
        <div class="i-solar:alt-arrow-left-bold text-base text-neutral-700 dark:text-neutral-200" />
      </button>

      <!-- Right Chevron -->
      <button
        v-if="models.length > 1"
        type="button"
        class="absolute right-2 top-1/2 z-35 flex items-center justify-center border border-neutral-200/80 rounded-full bg-white/90 p-2.5 shadow-md backdrop-blur-md transition-all -translate-y-1/2 active:scale-95 hover:scale-105 dark:border-neutral-700/80 dark:bg-neutral-800/90 hover:bg-white dark:hover:bg-neutral-700"
        aria-label="Next Model"
        @click.stop="next"
      >
        <div class="i-solar:alt-arrow-right-bold text-base text-neutral-700 dark:text-neutral-200" />
      </button>

      <!-- Model Cards -->
      <div class="relative h-full w-full flex items-center justify-center">
        <div
          v-for="slot in visibleSlots"
          :key="slot.key"
          class="absolute bottom-6 flex flex-col cursor-pointer items-center ease-out"
          :class="[
            isDragging ? 'transition-none' : 'transition-all duration-300',
          ]"
          :style="getSlotStyle(slot.offset)"
          @click.stop="handleModelClick(slot.model, slot.offset)"
        >
          <!-- Avatar Silhouette Container -->
          <div
            class="relative h-[300px] w-48 flex flex-col items-center justify-end md:w-60 sm:h-[340px] sm:w-54"
            :class="[
              slot.offset === 0 ? 'hover:scale-102 transition-transform duration-200' : '',
            ]"
          >
            <!-- Soft Contact Shadow Under Feet -->
            <div
              class="pointer-events-none absolute h-3 w-3/4 rounded-full blur-[3px] -bottom-1"
              :style="{
                background: 'radial-gradient(ellipse at center, rgba(0, 0, 0, 0.32) 0%, rgba(0, 0, 0, 0) 70%)',
              }"
            />

            <!-- Model Image -->
            <img
              v-if="slot.model.previewUrl && !failedImages[slot.model.id]"
              :src="slot.model.previewUrl"
              :alt="slot.model.name"
              class="pointer-events-none max-h-full max-w-full select-none object-contain drop-shadow-md filter transition-transform duration-300"
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="onImageError(slot.model.id)"
            >

            <!-- Fallback Card -->
            <div
              v-else
              class="h-56 w-44 flex flex-col items-center justify-center gap-2 border border-neutral-200/80 rounded-2xl bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-neutral-800/80 dark:bg-neutral-800/80"
            >
              <div class="i-solar:user-bold-duotone text-5xl text-neutral-400 opacity-40" />
              <div class="line-clamp-2 text-center text-xs text-neutral-700 font-bold dark:text-neutral-200">
                {{ slot.model.name }}
              </div>
              <span class="rounded bg-primary-500/10 px-2 py-0.5 text-[10px] text-primary-600 font-bold dark:text-primary-400">
                {{ slot.model.formatLabel || slot.model.format.toUpperCase() }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
