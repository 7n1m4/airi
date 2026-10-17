<script setup lang="ts">
import type { OdometerPose } from '../layouts/odometer-engine'

import { computed } from 'vue'

withDefaults(defineProps<{
  size?: number
  pose: OdometerPose
  cleanMode?: boolean
  showDetentTicks?: boolean
}>(), {
  size: 380,
  cleanMode: false,
  showDetentTicks: true,
})

const CANONICAL_SIZE = 380

const cx = CANONICAL_SIZE / 2
const cy = CANONICAL_SIZE / 2

// Radii in canonical coordinate space
const r1 = CANONICAL_SIZE * 0.40
const r2 = CANONICAL_SIZE * 0.26
const r3 = CANONICAL_SIZE * 0.13

// Cardinal points at radius r before rotation (Top, Right, Bottom, Left)
function getBaseSquarePoints(radius: number) {
  return [
    { x: 0, y: -radius },
    { x: radius, y: 0 },
    { x: 0, y: radius },
    { x: -radius, y: 0 },
  ]
}

const outerPoints = computed(() => getBaseSquarePoints(r1))
const middlePoints = computed(() => getBaseSquarePoints(r2))
const innerPoints = computed(() => getBaseSquarePoints(r3))

// 16-step 22.5° calibration compass ticks around outer perimeter
const compassTicks = computed(() => {
  const ticks: Array<{ x1: number, y1: number, x2: number, y2: number, isQuarter: boolean }> = []
  const tickR1 = r1 + 6
  for (let i = 0; i < 16; i++) {
    const angleRad = (i * 22.5 - 90) * (Math.PI / 180)
    const isQuarter = i % 4 === 0
    const len = isQuarter ? 6 : 3
    ticks.push({
      x1: cx + tickR1 * Math.cos(angleRad),
      y1: cy + tickR1 * Math.sin(angleRad),
      x2: cx + (tickR1 + len) * Math.cos(angleRad),
      y2: cy + (tickR1 + len) * Math.sin(angleRad),
      isQuarter,
    })
  }
  return ticks
})
</script>

<template>
  <div
    class="relative h-full w-full flex select-none items-center justify-center font-mono"
    :style="{
      width: size ? `${size}px` : undefined,
      height: size ? `${size}px` : undefined,
    }"
    aria-hidden="true"
  >
    <svg
      viewBox="0 0 380 380"
      class="block h-full max-h-full max-w-full w-full overflow-visible"
      preserveAspectRatio="xMidYMid meet"
    >
      <!-- Extremely faint center alignment crosshair lines -->
      <line
        :x1="cx"
        :y1="cy - r1 - 16"
        :x2="cx"
        :y2="cy + r1 + 16"
        stroke="currentColor"
        class="stroke-0.4 text-neutral-200/50 dark:text-neutral-800/50"
      />
      <line
        :x1="cx - r1 - 16"
        :y1="cy"
        :x2="cx + r1 + 16"
        :y2="cy"
        stroke="currentColor"
        class="stroke-0.4 text-neutral-200/50 dark:text-neutral-800/50"
      />

      <!-- 16-Step (22.5°) Calibration Detent Ticks -->
      <g v-if="showDetentTicks">
        <line
          v-for="(tick, idx) in compassTicks"
          :key="`tick-${idx}`"
          :x1="tick.x1"
          :y1="tick.y1"
          :x2="tick.x2"
          :y2="tick.y2"
          stroke="currentColor"
          :class="[
            tick.isQuarter
              ? 'stroke-0.75 opacity-40 text-neutral-500 dark:text-neutral-400'
              : 'stroke-0.4 opacity-25 text-neutral-400 dark:text-neutral-600',
          ]"
        />
      </g>

      <!-- ════════════════════════════════════════════════════════ -->
      <!-- LAYER 1: Outer Square (Depth 0: Category)                -->
      <!-- ════════════════════════════════════════════════════════ -->
      <g
        :transform="`translate(${cx}, ${cy}) rotate(${pose.angles[0]})`"
        class="text-neutral-900 transition-transform duration-250 ease-out dark:text-neutral-100"
      >
        <!-- Square Perimeter Hairline (0.75px) -->
        <polygon
          :points="`${outerPoints[0].x},${outerPoints[0].y} ${outerPoints[1].x},${outerPoints[1].y} ${outerPoints[2].x},${outerPoints[2].y} ${outerPoints[3].x},${outerPoints[3].y}`"
          fill="none"
          stroke="currentColor"
          :class="[
            pose.layers[0].isActive
              ? 'stroke-1 opacity-70 text-neutral-900 dark:text-neutral-100'
              : 'stroke-0.75 opacity-30 text-neutral-400 dark:text-neutral-600',
          ]"
        />

        <!-- Exactly 4 Cardinal Tracking Nodes -->
        <g v-for="(node, idx) in outerPoints" :key="`outer-node-${idx}`" :transform="`translate(${node.x}, ${node.y})`">
          <!-- Top Node (Marker) -->
          <polygon
            v-if="idx === 0"
            points="0,-4.5 4.5,0 0,4.5 -4.5,0"
            fill="currentColor"
            class="text-neutral-900 dark:text-neutral-100"
          />
          <!-- Cardinal Tracking Nodes -->
          <polygon
            v-else
            points="0,-3 3,0 0,3 -3,0"
            fill="none"
            stroke="currentColor"
            class="stroke-0.75 text-neutral-500 opacity-50 dark:text-neutral-400"
          />
        </g>
      </g>

      <!-- ════════════════════════════════════════════════════════ -->
      <!-- LAYER 2: Middle Square (Depth 1: Section / Module)       -->
      <!-- ════════════════════════════════════════════════════════ -->
      <g
        :transform="`translate(${cx}, ${cy}) rotate(${pose.angles[1]})`"
        class="text-neutral-900 transition-transform duration-250 ease-out dark:text-neutral-100"
      >
        <!-- Square Perimeter Hairline (0.75px) -->
        <polygon
          :points="`${middlePoints[0].x},${middlePoints[0].y} ${middlePoints[1].x},${middlePoints[1].y} ${middlePoints[2].x},${middlePoints[2].y} ${middlePoints[3].x},${middlePoints[3].y}`"
          fill="none"
          stroke="currentColor"
          :class="[
            pose.layers[1].isActive
              ? 'stroke-1 opacity-80 text-neutral-900 dark:text-neutral-100'
              : 'stroke-0.75 opacity-45 text-neutral-500 dark:text-neutral-500',
          ]"
        />

        <!-- Exactly 4 Cardinal Tracking Nodes -->
        <g v-for="(node, idx) in middlePoints" :key="`mid-node-${idx}`" :transform="`translate(${node.x}, ${node.y})`">
          <!-- Top Node (Marker) -->
          <polygon
            v-if="idx === 0"
            points="0,-4.5 4.5,0 0,4.5 -4.5,0"
            fill="currentColor"
            class="text-neutral-900 dark:text-neutral-100"
          />
          <!-- Cardinal Tracking Nodes -->
          <polygon
            v-else
            points="0,-3 3,0 0,3 -3,0"
            fill="none"
            stroke="currentColor"
            class="stroke-0.75 text-neutral-600 opacity-60 dark:text-neutral-300"
          />
        </g>
      </g>

      <!-- ════════════════════════════════════════════════════════ -->
      <!-- LAYER 3: Inner Square (Depth 2: Item / Setting)          -->
      <!-- ════════════════════════════════════════════════════════ -->
      <g
        :transform="`translate(${cx}, ${cy}) rotate(${pose.angles[2]})`"
        class="text-neutral-900 transition-transform duration-250 ease-out dark:text-neutral-100"
      >
        <!-- Square Perimeter Hairline (0.75px) -->
        <polygon
          :points="`${innerPoints[0].x},${innerPoints[0].y} ${innerPoints[1].x},${innerPoints[1].y} ${innerPoints[2].x},${innerPoints[2].y} ${innerPoints[3].x},${innerPoints[3].y}`"
          fill="none"
          stroke="currentColor"
          :class="[
            pose.layers[2].isActive
              ? 'stroke-1.25 opacity-90 text-neutral-950 dark:text-neutral-50'
              : 'stroke-0.75 opacity-60 text-neutral-600 dark:text-neutral-400',
          ]"
        />

        <!-- Exactly 4 Cardinal Tracking Nodes -->
        <g v-for="(node, idx) in innerPoints" :key="`inner-node-${idx}`" :transform="`translate(${node.x}, ${node.y})`">
          <!-- Top Node (Marker) -->
          <polygon
            v-if="idx === 0"
            points="0,-5 5,0 0,5 -5,0"
            fill="currentColor"
            class="text-neutral-950 dark:text-neutral-50"
          />
          <!-- Cardinal Tracking Nodes -->
          <polygon
            v-else
            points="0,-3 3,0 0,3 -3,0"
            fill="none"
            stroke="currentColor"
            class="stroke-0.75 text-neutral-800 opacity-80 dark:text-neutral-200"
          />
        </g>
      </g>

      <!-- Center Axle Pivot Core Dot -->
      <circle
        :cx="cx"
        :cy="cy"
        r="2.5"
        class="fill-neutral-900 dark:fill-neutral-100"
      />
    </svg>
  </div>
</template>
