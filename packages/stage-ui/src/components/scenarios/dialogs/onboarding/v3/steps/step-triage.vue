<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSyncEngineStore } from '../../../../../../stores/sync-engine'
import { useOnboardingV3Draft } from '../stores/useOnboardingV3Draft'

const props = defineProps<{
  onNext: () => void
  onPrevious: () => void
  onFinish?: () => void
}>()

const emit = defineEmits<{
  (e: 'previous'): void
  (e: 'next'): void
  (e: 'finish'): void
}>()

const { t } = useI18n()

const draftStore = useOnboardingV3Draft()
const syncStore = useSyncEngineStore()

const isLoadingCatalog = ref(false)
const hasCheckedRemote = ref(false)
const remoteCardsCount = ref(0)

const selectedPath = computed<'local' | 'cloud'>({
  get: () => draftStore.state.architecture || 'local',
  set: (val) => {
    draftStore.setArchitecture(val)
  },
})

async function probeRemoteCatalog() {
  isLoadingCatalog.value = true
  try {
    const res = await syncStore.fetchRemoteSyncManifestCatalog()
    if (res && res.success) {
      remoteCardsCount.value = (res.cards || []).length
    }
  }
  catch (e) {
    console.warn('[StepTriage] Failed to probe remote catalog:', e)
  }
  finally {
    isLoadingCatalog.value = false
    hasCheckedRemote.value = true
  }
}

onMounted(() => {
  void probeRemoteCatalog()
})

function chooseLocal() {
  selectedPath.value = 'local'
}
</script>

<template>
  <div :class="['w-full max-w-4xl mx-auto flex flex-col gap-4 py-2 select-none']">
    <!-- Header Section -->
    <div :class="['flex flex-col items-center text-center gap-3']">
      <!-- Title & Subtitle -->
      <div
        v-motion
        :initial="{ opacity: 0, y: -6 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="350"
        :class="['text-center']"
      >
        <div :class="['inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary-500/20 bg-primary-500/10 text-primary-400 text-xs font-semibold mb-1']">
          <div :class="['i-solar:server-square-bold-duotone h-3.5 w-3.5']" />
          <span>{{ t('onboarding.steps.triage.stepBadge', { current: 2, total: 17 }) }}</span>
        </div>
        <h1 :class="['text-2xl font-bold tracking-tight text-neutral-900 dark:text-white']">
          {{ t('onboarding.steps.triage.title') }}
        </h1>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400 mt-0.5']">
          {{ t('onboarding.steps.triage.description') }}
        </p>
      </div>

      <!-- Compact Companion Speech Bubble -->
      <div
        v-motion
        :initial="{ opacity: 0, scale: 0.98 }"
        :enter="{ opacity: 1, scale: 1 }"
        :duration="350"
        :delay="100"
        :class="['max-w-xl w-full flex items-start gap-3 text-left']"
      >
        <div
          :class="[
            'h-8 w-8 flex flex-shrink-0 items-center justify-center border border-primary-500/30 rounded-full',
            'bg-gradient-to-br from-primary-500/20 to-indigo-500/20 shadow-xs mt-0.5',
          ]"
        >
          <div :class="['i-solar:emoji-funny-circle-bold-duotone h-5 w-5 text-primary-400']" />
        </div>
        <div
          :class="[
            'relative flex-1 border border-primary-500/20 rounded-xl rounded-tl-xs px-4 py-2',
            'text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed backdrop-blur-md',
            'bg-primary-500/5 dark:bg-primary-950/20 shadow-sm',
          ]"
        >
          "{{ t('onboarding.steps.triage.companionGreeting') }}"
        </div>
      </div>
    </div>

    <!-- Architecture Choice Grid -->
    <div
      v-motion
      :initial="{ opacity: 0, y: 10 }"
      :enter="{ opacity: 1, y: 0 }"
      :duration="400"
      :delay="150"
      :class="['grid grid-cols-1 md:grid-cols-2 gap-5 w-full pt-1 items-stretch']"
    >
      <!-- Option 1: Local Companion (100% Offline) -->
      <div
        :class="[
          'relative flex flex-col justify-between overflow-hidden rounded-2xl p-5 border-2 transition-all duration-200 cursor-pointer min-h-[340px] backdrop-blur-xl',
          selectedPath === 'local'
            ? 'border-primary-500 bg-white/95 dark:bg-neutral-900/95 shadow-lg shadow-primary-500/10 ring-1 ring-primary-500/30'
            : 'border-neutral-200/80 dark:border-neutral-800 bg-white/85 dark:bg-neutral-900/75 hover:border-neutral-300 dark:hover:border-neutral-700',
        ]"
        @click="chooseLocal"
      >
        <div :class="['space-y-4']">
          <!-- Top Row: Icon + Badge + Radio Indicator -->
          <div :class="['flex items-center justify-between']">
            <div :class="['flex items-center gap-2.5']">
              <div
                :class="[
                  'h-10 w-10 rounded-xl flex items-center justify-center transition-colors',
                  selectedPath === 'local'
                    ? 'bg-primary-500 text-white shadow-md shadow-primary-500/25'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400',
                ]"
              >
                <div :class="['i-solar:home-smile-bold-duotone text-xl']" />
              </div>
              <span :class="['rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-primary-500/15 text-primary-600 dark:text-primary-400']">
                {{ t('onboarding.steps.triage.local.badge') }}
              </span>
            </div>

            <!-- Radio Indicator -->
            <div
              :class="[
                'h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors',
                selectedPath === 'local'
                  ? 'border-primary-500 bg-primary-500'
                  : 'border-neutral-300 dark:border-neutral-600',
              ]"
            >
              <div
                v-if="selectedPath === 'local'"
                :class="['h-2 w-2 rounded-full bg-white']"
              />
            </div>
          </div>

          <!-- Main Info -->
          <div>
            <h2 :class="['text-base font-bold text-neutral-900 dark:text-white']">
              {{ t('onboarding.steps.triage.local.title') }}
            </h2>
            <p :class="['text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed']">
              {{ t('onboarding.steps.triage.local.description') }}
            </p>
          </div>

          <!-- Feature Bullets -->
          <div :class="['space-y-2 pt-1 border-t border-neutral-100 dark:border-neutral-800/80']">
            <div
              v-for="(bullet, i) in [
                t('onboarding.steps.triage.local.features.f1'),
                t('onboarding.steps.triage.local.features.f2'),
                t('onboarding.steps.triage.local.features.f3'),
              ]"
              :key="i"
              :class="['flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300']"
            >
              <div :class="['i-solar:check-circle-bold text-primary-500 shrink-0 h-4 w-4']" />
              <span>{{ bullet }}</span>
            </div>
          </div>
        </div>

        <!-- Action Button -->
        <div :class="['pt-5']">
          <Button
            type="button"
            :class="['w-full justify-center text-xs py-2.5 font-semibold rounded-xl']"
            :variant="selectedPath === 'local' ? 'primary' : 'secondary'"
            @click.stop="chooseLocal"
          >
            {{ selectedPath === 'local' ? t('onboarding.steps.triage.local.selectedCta') : t('onboarding.steps.triage.local.selectCta') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Navigation Action Bar -->
    <div
      v-motion
      :initial="{ opacity: 0, y: 10 }"
      :enter="{ opacity: 1, y: 0 }"
      :duration="350"
      :delay="250"
      :class="['flex items-center justify-between pt-3 border-t border-neutral-200/80 dark:border-white/5']"
    >
      <button
        type="button"
        :class="['flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer']"
        @click="props.onPrevious"
      >
        <div :class="['i-solar:alt-arrow-left-line-duotone h-4 w-4']" />
        <span>{{ t('onboarding.shell.previous') }}</span>
      </button>

      <div :class="['text-[11px] text-neutral-400 font-medium']">
        Path: <span :class="['text-neutral-700 dark:text-neutral-200 font-semibold']">{{ t('onboarding.steps.triage.local.title') }}</span>
      </div>

      <Button
        variant="primary"
        size="md"
        :class="[
          'flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-500 px-5 py-2',
          'text-xs font-semibold text-white shadow-md shadow-primary-600/25 transition-all active:scale-95 cursor-pointer',
        ]"
        @click="props.onNext"
      >
        <span>{{ t('onboarding.shell.next') }}</span>
        <div :class="['i-solar:alt-arrow-right-line-duotone h-4 w-4']" />
      </Button>
    </div>
  </div>
</template>
