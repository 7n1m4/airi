<script setup lang="ts">
import type { CursorState } from '../../../types/arcade'

import { ref } from 'vue'

import ArcadeGhostCursor from './ArcadeGhostCursor.vue'
import ArcadeGridOverlay from './ArcadeGridOverlay.vue'

const props = withDefaults(defineProps<{
  engine?: 'jsdos' | 'canvas-2048'
  showGridOverlay?: boolean
  cursorState?: CursorState
  characterName?: string
  loading?: boolean
  loadingProgress?: string
  splashUrl?: string | null
  gameTitle?: string
  isGameReady?: boolean
  isPointerLocked?: boolean
  isFpsGame?: boolean
  isCanvasFocused?: boolean
}>(), {
  engine: 'jsdos',
  showGridOverlay: false,
  characterName: 'Airi',
  loading: false,
  loadingProgress: '',
  splashUrl: null,
  gameTitle: '',
  isGameReady: false,
  isPointerLocked: false,
  isFpsGame: false,
  isCanvasFocused: false,
})

const emit = defineEmits<{
  (e: 'dosClick'): void
  (e: 'canvasClick'): void
  (e: 'canvasKeydown', event: KeyboardEvent): void
  (e: 'dropFiles', event: DragEvent): void
  (e: 'mountDosContainer', el: HTMLDivElement | null): void
  (e: 'mountCanvas', el: HTMLCanvasElement | null): void
}>()

const dosContainerEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)

function setDosContainer(el: any) {
  dosContainerEl.value = el
  emit('mountDosContainer', el)
}

function setCanvas(el: any) {
  canvasEl.value = el
  emit('mountCanvas', el)
}

defineExpose({
  dosContainerEl,
  canvasEl,
})
</script>

<template>
  <div
    :class="[
      'relative flex flex-1 items-center justify-center overflow-hidden',
    ]"
    @dragover.prevent
    @drop.prevent="(e) => emit('dropFiles', e)"
  >
    <!-- 1. RETRO 2048 CANVAS VIEWPORT -->
    <div
      v-if="engine === 'canvas-2048'"
      :class="[
        'relative cursor-pointer border-4 rounded-2xl p-2 shadow-2xl transition-all duration-300',
        isCanvasFocused
          ? 'border-primary-500/80 shadow-primary-500/20 ring-4 ring-primary-500/10'
          : 'border-neutral-800/80 hover:border-neutral-700',
      ]"
      @click="emit('canvasClick')"
    >
      <!-- CRT Badge -->
      <div
        :class="[
          'backdrop-blur-xs absolute left-4 top-4 z-10',
          'flex items-center gap-1 rounded bg-black/60 px-2 py-0.5',
          'text-[9px] text-neutral-400 tracking-widest font-mono uppercase',
        ]"
      >
        <span>CRT 60FPS</span>
      </div>

      <canvas
        :ref="setCanvas"
        tabindex="0"
        width="420"
        height="420"
        class="block rounded-xl outline-none"
        @keydown="(e) => emit('canvasKeydown', e)"
      />

      <!-- Unfocused Overlay -->
      <div
        v-if="!isCanvasFocused"
        :class="[
          'absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-black/40 backdrop-blur-[2px] transition-all',
        ]"
      >
        <div class="i-solar:keyboard-bold mb-2 animate-bounce text-3xl text-white/90" />
        <span
          :class="[
            'rounded-full bg-neutral-900/80 px-3.5 py-1.5',
            'text-xs text-white font-bold tracking-wide shadow-lg',
          ]"
        >
          Click to Control Canvas
        </span>
        <span class="mt-1 text-[10px] text-white/60 font-medium">Use Arrow Keys or WASD</span>
      </div>

      <!-- Overlays -->
      <ArcadeGridOverlay :visible="showGridOverlay" />
      <ArcadeGhostCursor
        v-if="cursorState"
        :cursor-state="cursorState"
        :character-name="characterName"
      />
    </div>

    <!-- 2. JS-DOS WASM PLAYER CONTAINER -->
    <div
      v-show="engine === 'jsdos'"
      :class="[
        'relative h-full max-h-[580px] max-w-[780px] w-full',
        'flex items-center justify-center overflow-hidden',
        'border-4 border-neutral-800/80 rounded-2xl bg-black p-1 shadow-2xl',
      ]"
    >
      <!-- DOS Bezel Badge -->
      <div
        :class="[
          'backdrop-blur-xs pointer-events-none absolute left-3 top-3 z-30',
          'flex items-center gap-1.5 rounded bg-black/70 px-2 py-0.5',
          'text-[9px] text-neutral-400 tracking-widest font-mono uppercase',
        ]"
      >
        <span
          class="h-1.5 w-1.5 rounded-full"
          :class="isGameReady ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'"
        />
        <span>{{ isGameReady ? 'DOSBox WASM &bull; 4:3' : 'DOSBox Initializing...' }}</span>
      </div>

      <!-- Splash Screen Overlay (loading or waiting for ci-ready) -->
      <div
        v-if="!isGameReady"
        :class="[
          'absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden rounded-xl bg-neutral-950',
        ]"
      >
        <!-- Ambient blurred backdrop -->
        <img
          v-if="splashUrl"
          :src="splashUrl"
          :alt="gameTitle"
          class="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-lg filter"
        >
        <div class="absolute inset-0 from-black/90 via-black/50 to-black/80 bg-gradient-to-t" />

        <!-- Foreground Cover -->
        <div
          v-if="splashUrl"
          :class="[
            'relative z-10 max-h-[60%] max-w-[70%] overflow-hidden',
            'border border-white/15 rounded-xl shadow-2xl',
          ]"
        >
          <img
            :src="splashUrl"
            :alt="gameTitle"
            class="max-h-[260px] w-auto object-contain"
            @error="(e: any) => { e.target.style.display = 'none' }"
          >
        </div>
        <div v-else class="relative z-10 text-neutral-600">
          <div class="i-solar:gamepad-bold text-6xl" />
        </div>

        <!-- Title & Progress Spinner -->
        <div class="relative z-10 mt-3 flex flex-col items-center px-4 text-center">
          <div class="text-sm text-white font-bold tracking-wide drop-shadow-md">
            {{ gameTitle }}
          </div>
          <div
            v-if="loading"
            :class="[
              'mt-2 flex items-center gap-2 border border-white/10 rounded-full',
              'bg-black/70 px-3.5 py-1 text-xs text-neutral-200 shadow-lg backdrop-blur-md',
            ]"
          >
            <div class="i-solar:restart-bold animate-spin text-sm text-primary-400" />
            <span>{{ loadingProgress }}</span>
          </div>
        </div>
      </div>

      <!-- Live JS-DOS Mount Point -->
      <div
        :ref="setDosContainer"
        class="h-full w-full cursor-crosshair overflow-hidden rounded-xl"
        @click="emit('dosClick')"
      />

      <!-- Pointer Lock Hint Badge -->
      <transition name="fade">
        <div
          v-if="isFpsGame && isGameReady && !isPointerLocked"
          :class="[
            'pointer-events-none absolute bottom-3 z-30',
            'flex items-center gap-1.5 border border-white/10 rounded-full',
            'bg-black/80 px-3 py-1 text-[11px] text-white/90 shadow-xl backdrop-blur-md',
          ]"
        >
          <div class="i-solar:mouse-bold text-xs text-purple-400" />
          <span>Click game to lock cursor &bull; Press <kbd class="rounded bg-white/20 px-1 py-0.5 text-[9px] text-white font-mono">ESC</kbd> to unlock</span>
        </div>
      </transition>

      <!-- Grid Overlay -->
      <ArcadeGridOverlay
        v-if="engine === 'jsdos' && isGameReady"
        :visible="showGridOverlay"
      />

      <!-- Ghost Cursor Overlay -->
      <ArcadeGhostCursor
        v-if="engine === 'jsdos' && cursorState"
        :cursor-state="cursorState"
        :character-name="characterName"
      />
    </div>
  </div>
</template>
