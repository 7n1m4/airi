<script setup lang="ts">
withDefaults(
  defineProps<{
    visible?: boolean
    accentCenter?: boolean
  }>(),
  {
    visible: true,
    accentCenter: true,
  },
)

const gridTicks = [100, 200, 300, 400, 500, 600, 700, 800, 900]
</script>

<template>
  <transition name="fade">
    <div
      v-if="visible"
      class="pointer-events-none absolute inset-0 z-25 select-none overflow-hidden transition-opacity duration-200"
    >
      <svg
        class="h-full w-full"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
      >
        <!-- Grid Lines -->
        <g>
          <!-- Under-stroke shadows for maximum contrast across dark and bright backgrounds -->
          <line
            v-for="x in gridTicks"
            :key="`shadow-v-${x}`"
            :x1="x"
            y1="0"
            :x2="x"
            y2="1000"
            stroke="rgba(0, 0, 0, 0.7)"
            :stroke-width="x === 500 && accentCenter ? 3 : 2"
            vector-effect="non-scaling-stroke"
          />
          <line
            v-for="y in gridTicks"
            :key="`shadow-h-${y}`"
            x1="0"
            :y1="y"
            x2="1000"
            :y2="y"
            stroke="rgba(0, 0, 0, 0.7)"
            :stroke-width="y === 500 && accentCenter ? 3 : 2"
            vector-effect="non-scaling-stroke"
          />

          <!-- Colored Foreground Lines -->
          <!-- Vertical lines -->
          <line
            v-for="x in gridTicks"
            :key="`v-${x}`"
            :x1="x"
            y1="0"
            :x2="x"
            y2="1000"
            :stroke="x === 500 && accentCenter ? '#f59e0b' : 'rgba(56, 189, 248, 0.85)'"
            :stroke-width="x === 500 && accentCenter ? 1.5 : 1"
            :stroke-dasharray="x === 500 && accentCenter ? '' : '6 4'"
            vector-effect="non-scaling-stroke"
          />

          <!-- Horizontal lines -->
          <line
            v-for="y in gridTicks"
            :key="`h-${y}`"
            x1="0"
            :y1="y"
            x2="1000"
            :y2="y"
            :stroke="y === 500 && accentCenter ? '#f59e0b' : 'rgba(56, 189, 248, 0.85)'"
            :stroke-width="y === 500 && accentCenter ? 1.5 : 1"
            :stroke-dasharray="y === 500 && accentCenter ? '' : '6 4'"
            vector-effect="non-scaling-stroke"
          />
        </g>

        <!-- Outer Boundary -->
        <!-- Shadow border -->
        <rect
          x="0"
          y="0"
          width="1000"
          height="1000"
          fill="none"
          stroke="rgba(0, 0, 0, 0.8)"
          stroke-width="3"
          vector-effect="non-scaling-stroke"
        />
        <!-- Foreground border -->
        <rect
          x="0"
          y="0"
          width="1000"
          height="1000"
          fill="none"
          stroke="rgba(56, 189, 248, 0.85)"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />

        <!-- Coordinate Badges -->
        <g
          font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          font-size="11"
          font-weight="bold"
          dominant-baseline="central"
          text-anchor="middle"
        >
          <!-- Origin (0,0) -->
          <rect x="8" y="8" width="46" height="26" rx="4" fill="rgba(0, 0, 0, 0.85)" stroke="#38bdf8" stroke-width="1" vector-effect="non-scaling-stroke" />
          <text x="31" y="21" fill="#38bdf8">0,0</text>

          <!-- Bottom Right (1000,1000) -->
          <rect x="902" y="966" width="90" height="26" rx="4" fill="rgba(0, 0, 0, 0.85)" stroke="#38bdf8" stroke-width="1" vector-effect="non-scaling-stroke" />
          <text x="947" y="979" fill="#38bdf8">1000,1000</text>

          <!-- Top X labels (y=8 to y=34, text at y=21 with ample top clearance) -->
          <g v-for="x in gridTicks" :key="`badge-top-${x}`">
            <rect
              :x="x - 26"
              y="8"
              width="52"
              height="26"
              rx="4"
              fill="rgba(0, 0, 0, 0.85)"
              :stroke="x === 500 && accentCenter ? '#f59e0b' : '#38bdf8'"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
            <text
              :x="x"
              y="21"
              :fill="x === 500 && accentCenter ? '#fbbf24' : '#38bdf8'"
            >
              {{ x }}
            </text>
          </g>

          <!-- Left Y labels (x=8 to x=60, text at x=34) -->
          <g v-for="y in gridTicks" :key="`badge-left-${y}`">
            <rect
              x="8"
              :y="y - 13"
              width="52"
              height="26"
              rx="4"
              fill="rgba(0, 0, 0, 0.85)"
              :stroke="y === 500 && accentCenter ? '#f59e0b' : '#38bdf8'"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
            <text
              x="34"
              :y="y"
              :fill="y === 500 && accentCenter ? '#fbbf24' : '#38bdf8'"
            >
              {{ y }}
            </text>
          </g>

          <!-- Center Crosshair & Marker at (500, 500) -->
          <circle cx="500" cy="500" r="5" fill="#f59e0b" />
          <line x1="485" y1="500" x2="515" y2="500" stroke="#f59e0b" stroke-width="2" vector-effect="non-scaling-stroke" />
          <line x1="500" y1="485" x2="500" y2="515" stroke="#f59e0b" stroke-width="2" vector-effect="non-scaling-stroke" />
          <rect
            x="512"
            y="512"
            width="78"
            height="26"
            rx="4"
            fill="rgba(0, 0, 0, 0.85)"
            stroke="#f59e0b"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
          <text x="551" y="525" fill="#fbbf24">500,500</text>
        </g>
      </svg>
    </div>
  </transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

text {
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 700;
  user-select: none;
}
</style>
