<script setup lang="ts">
import { computed } from 'vue'

export interface TriggerGroup {
  id: string
  name: string
  cluster: 'conflict' | 'relational' | 'system'
  description: string
  icon: string
  enabled: boolean
  impactDelta: string
  keywords: string
  isVeto?: boolean
}

const props = defineProps<{
  cognitivePipelineEnabled: boolean
  firstHopProcessor: 'none' | 'local_nan0' | 'universe_rag'
}>()

const emit = defineEmits<{
  navigateToRouting: []
}>()

const isNan0Active = computed(() => props.cognitivePipelineEnabled && props.firstHopProcessor === 'local_nan0')

const tier1LocalReflexEnabled = defineModel<boolean>('tier1LocalReflexEnabled', { default: true })
const tier2JevChallengerEnabled = defineModel<boolean>('tier2JevChallengerEnabled', { default: true })
const triggerGroups = defineModel<TriggerGroup[]>('triggerGroups', { required: true })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Nan0 Inactive Warning Banner ⭐ -->
    <div
      v-if="!isNan0Active"
      class="flex items-start gap-3 border border-amber-200/80 rounded-xl bg-amber-50/80 p-4 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/30"
    >
      <div class="i-solar:shield-warning-bold-duotone mt-0.5 shrink-0 text-xl text-amber-500" />
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <span class="text-xs text-amber-900 font-bold dark:text-amber-200">
            Nan0 Local Engine is Inactive
          </span>
          <span class="rounded bg-amber-200/60 px-1.5 py-0.2 text-[9px] text-amber-800 font-bold font-mono dark:bg-amber-900/60 dark:text-amber-300">
            NO-OP
          </span>
        </div>
        <p class="text-[11px] text-amber-800/90 leading-relaxed dark:text-amber-300/90">
          These 12 pragmatic speech-act receptors and subconscious reflex gates only execute when the Cognitive Pipeline is enabled and the 1st-Hop Processor is set to <strong>Nan0 Local Engine</strong>. Under your current routing configuration, dialogue turns bypass trigger evaluation.
        </p>
        <button
          type="button"
          class="mt-1.5 inline-flex items-center self-start gap-1.5 rounded-lg bg-amber-600/10 px-2.5 py-1 text-xs text-amber-800 font-medium transition-colors hover:bg-amber-600/20 dark:text-amber-200"
          @click="emit('navigateToRouting')"
        >
          <span class="i-solar:route-bold" />
          <span>Switch 1st-Hop Processor in Routing</span>
          <span class="i-solar:arrow-right-linear text-xs" />
        </button>
      </div>
    </div>

    <!-- Subconscious Reflex Engine Bar -->
    <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
      <div class="flex flex-col gap-3.5">
        <div class="flex items-center gap-2 border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <span class="i-solar:cpu-bolt-bold-duotone text-base text-primary-500" />
          <div class="flex flex-col">
            <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
              Subconscious Reflex Engine • Two-Tier Complement
            </label>
            <span class="text-[10px] text-neutral-400">Combines 26µs local boundary defense with ~440ms calibrated cloud decisions</span>
          </div>
        </div>

        <!-- Tier 1 (Upgraded to Pill Switch) ⭐ -->
        <div class="flex items-start justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-neutral-800 font-medium dark:text-neutral-200">
              Tier 1: Synchronous Local Reflex (26 µs, 100% Offline)
            </span>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              Deterministic TypeScript pattern matching. Enforces boundary protection vetoes and rejects injection attempts with zero latency.
            </p>
          </div>
          <label class="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              v-model="tier1LocalReflexEnabled"
              type="checkbox"
              class="peer sr-only"
            >
            <div class="dark:bg-neutral-850 h-5 w-9 rounded-full bg-neutral-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:border after:border-gray-300 dark:border-neutral-700 after:rounded-full after:bg-white peer-checked:bg-primary-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>

        <!-- Tier 2 (Upgraded to Pill Switch) ⭐ -->
        <div class="flex items-start justify-between gap-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-neutral-800 font-medium dark:text-neutral-200">
              Tier 2: Asynchronous Cloud Decision Challenger (TypeSafe Jev 1.13)
            </span>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              Non-blocking discriminator head via OpenRouter (~440ms). Evaluates 12 rich contrastive choice questions with distractor attractor basins.
            </p>
          </div>
          <label class="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              v-model="tier2JevChallengerEnabled"
              type="checkbox"
              class="peer sr-only"
            >
            <div class="dark:bg-neutral-850 h-5 w-9 rounded-full bg-neutral-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:border after:border-gray-300 dark:border-neutral-700 after:rounded-full after:bg-white peer-checked:bg-primary-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>
      </div>
    </div>

    <!-- 12 Groups Header -->
    <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="i-solar:target-bold-duotone text-base text-primary-500" />
          <div class="flex flex-col">
            <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
              The 12 Canonical Pragmatic Speech-Act Receptors
            </span>
            <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
              Deterministic invariants evaluated across all dialogue turns to perturb affect and execute host vetoes.
            </span>
          </div>
        </div>
        <span class="rounded bg-primary-500/10 px-2 py-0.5 text-[10px] text-primary-600 font-semibold font-mono dark:text-primary-400">
          12 INVARIANTS ACTIVE
        </span>
      </div>
    </div>

    <!-- Group Clusters Grid -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <!-- Cluster 1: Conflict & Trust -->
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-1.5 px-1 text-xs text-neutral-600 font-semibold dark:text-neutral-300">
          <span class="i-solar:shield-warning-bold text-amber-500" />
          <span>Conflict & Trust</span>
        </div>
        <div
          v-for="group in triggerGroups.filter(g => g.cluster === 'conflict')"
          :key="group.id"
          class="flex flex-col gap-2 border border-neutral-200/80 rounded-xl bg-white/70 p-3.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2">
              <span :class="[group.icon, 'text-base text-primary-500']" />
              <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">{{ group.name }}</span>
            </div>
            <!-- Upgraded Mini Pill Switch ⭐ -->
            <label class="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                v-model="group.enabled"
                type="checkbox"
                class="peer sr-only"
              >
              <div class="dark:bg-neutral-850 h-4 w-7 rounded-full bg-neutral-200 after:absolute after:left-[1px] after:top-[1px] after:h-3.5 after:w-3.5 after:border after:border-gray-300 dark:border-neutral-700 after:rounded-full after:bg-white peer-checked:bg-primary-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
            </label>
          </div>
          <p class="text-[11px] text-neutral-500 leading-snug dark:text-neutral-400">
            {{ group.description }}
          </p>
          <div class="mt-1 flex items-center justify-between">
            <span class="rounded bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700 font-medium font-mono dark:bg-rose-950/40 dark:text-rose-300">
              {{ group.impactDelta }}
            </span>
            <span class="text-[9px] text-neutral-400 font-mono">{{ group.id }}</span>
          </div>
        </div>
      </div>

      <!-- Cluster 2: Relational & Boundaries -->
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-1.5 px-1 text-xs text-neutral-600 font-semibold dark:text-neutral-300">
          <span class="i-solar:heart-bold text-rose-500" />
          <span>Relational & Boundaries</span>
        </div>
        <div
          v-for="group in triggerGroups.filter(g => g.cluster === 'relational')"
          :key="group.id"
          class="flex flex-col gap-2 border border-neutral-200/80 rounded-xl bg-white/70 p-3.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2">
              <span :class="[group.icon, 'text-base text-primary-500']" />
              <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">{{ group.name }}</span>
            </div>
            <!-- Upgraded Mini Pill Switch ⭐ -->
            <label class="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                v-model="group.enabled"
                type="checkbox"
                class="peer sr-only"
              >
              <div class="dark:bg-neutral-850 h-4 w-7 rounded-full bg-neutral-200 after:absolute after:left-[1px] after:top-[1px] after:h-3.5 after:w-3.5 after:border after:border-gray-300 dark:border-neutral-700 after:rounded-full after:bg-white peer-checked:bg-primary-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
            </label>
          </div>
          <p class="text-[11px] text-neutral-500 leading-snug dark:text-neutral-400">
            {{ group.description }}
          </p>
          <div class="mt-1 flex items-center justify-between">
            <span
              :class="[
                'rounded px-2 py-0.5 text-[10px] font-medium font-mono',
                group.isVeto
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
              ]"
            >
              {{ group.impactDelta }}
            </span>
            <span class="text-[9px] text-neutral-400 font-mono">{{ group.id }}</span>
          </div>
        </div>
      </div>

      <!-- Cluster 3: Operational & System -->
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-1.5 px-1 text-xs text-neutral-600 font-semibold dark:text-neutral-300">
          <span class="i-solar:settings-bold text-primary-500" />
          <span>Operational & System</span>
        </div>
        <div
          v-for="group in triggerGroups.filter(g => g.cluster === 'system')"
          :key="group.id"
          class="flex flex-col gap-2 border border-neutral-200/80 rounded-xl bg-white/70 p-3.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2">
              <span :class="[group.icon, 'text-base text-primary-500']" />
              <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">{{ group.name }}</span>
            </div>
            <!-- Upgraded Mini Pill Switch ⭐ -->
            <label class="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                v-model="group.enabled"
                type="checkbox"
                class="peer sr-only"
              >
              <div class="dark:bg-neutral-850 h-4 w-7 rounded-full bg-neutral-200 after:absolute after:left-[1px] after:top-[1px] after:h-3.5 after:w-3.5 after:border after:border-gray-300 dark:border-neutral-700 after:rounded-full after:bg-white peer-checked:bg-primary-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
            </label>
          </div>
          <p class="text-[11px] text-neutral-500 leading-snug dark:text-neutral-400">
            {{ group.description }}
          </p>
          <div class="mt-1 flex items-center justify-between">
            <span class="rounded bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-700 font-medium font-mono dark:bg-neutral-800 dark:text-neutral-300">
              {{ group.impactDelta }}
            </span>
            <span class="text-[9px] text-neutral-400 font-mono">{{ group.id }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
