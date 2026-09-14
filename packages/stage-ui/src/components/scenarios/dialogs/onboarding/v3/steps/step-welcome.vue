<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  onNext: () => void
  onQuickStart?: () => void
  onSkip?: () => void
}>()

const { t } = useI18n()

const showSkipConfirmation = ref(false)

const featurePills = computed(() => [
  { icon: 'i-solar:cpu-bolt-bold-duotone', label: t('onboarding.steps.welcome.pills.webgpu'), color: 'text-cyan-400' },
  { icon: 'i-solar:shield-check-bold-duotone', label: t('onboarding.steps.welcome.pills.offline'), color: 'text-emerald-400' },
  { icon: 'i-solar:magic-stick-3-bold-duotone', label: t('onboarding.steps.welcome.pills.souls'), color: 'text-purple-400' },
])

function confirmCloseToTray() {
  showSkipConfirmation.value = false
  props.onSkip?.()
}
</script>

<template>
  <div :class="['h-full flex flex-col items-center justify-center gap-5 px-4 text-center select-none py-2 relative']">
    <!-- Top Header Animation (Radiant Icon Orb with Ping Animation) -->
    <div
      v-motion
      :initial="{ opacity: 0, scale: 0.8 }"
      :enter="{ opacity: 1, scale: 1 }"
      :duration="500"
      :class="['relative']"
    >
      <div
        :class="['absolute inset-0 animate-ping rounded-full bg-cyan-500/20']"
        style="animation-duration: 3s"
      />
      <div
        :class="[
          'relative h-20 w-20 flex items-center justify-center border border-cyan-500/30 rounded-3xl',
          'from-cyan-500/20 to-indigo-500/20 bg-gradient-to-br shadow-lg shadow-cyan-500/10',
        ]"
      >
        <div :class="['i-solar:stars-line-bold-duotone h-10 w-10 text-cyan-400']" />
      </div>
    </div>

    <!-- Title & Subtitle -->
    <div
      v-motion
      :initial="{ opacity: 0, y: 10 }"
      :enter="{ opacity: 1, y: 0 }"
      :duration="400"
      :delay="100"
      :class="['text-center']"
    >
      <h1 :class="['text-3xl text-neutral-900 dark:text-white font-bold tracking-tight']">
        {{ t('onboarding.steps.welcome.heroTitle') }}
      </h1>
      <p :class="['mt-2 text-sm text-neutral-600 dark:text-neutral-400']">
        {{ t('onboarding.steps.welcome.heroSubtitle') }}
      </p>
    </div>

    <!-- Chat Bubble (Companion Speech Bubble with Tail) -->
    <div
      v-motion
      :initial="{ opacity: 0, y: 10 }"
      :enter="{ opacity: 1, y: 0 }"
      :duration="400"
      :delay="200"
      :class="['max-w-xl w-full flex items-start gap-3.5 text-left']"
    >
      <!-- Companion Avatar Circle -->
      <div
        :class="[
          'h-10 w-10 flex flex-shrink-0 items-center justify-center border border-primary-500/30 rounded-full',
          'bg-gradient-to-br from-primary-500/20 to-indigo-500/20 shadow-sm mt-0.5',
        ]"
      >
        <div :class="['i-solar:emoji-funny-circle-bold-duotone h-6 w-6 text-primary-400']" />
      </div>

      <!-- Bubble Container -->
      <div
        :class="[
          'relative flex-1 border border-primary-500/25 rounded-2xl rounded-tl-sm px-5 py-3.5',
          'text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed backdrop-blur-md bg-primary-500/5 dark:bg-primary-950/20 shadow-lg shadow-primary-950/10',
        ]"
      >
        "{{ t('onboarding.steps.welcome.companionQuote') }}"
      </div>
    </div>

    <!-- Feature Pills -->
    <div
      v-motion
      :initial="{ opacity: 0, y: 10 }"
      :enter="{ opacity: 1, y: 0 }"
      :duration="400"
      :delay="300"
      :class="['flex flex-wrap items-center justify-center gap-2 max-w-lg']"
    >
      <div
        v-for="pill in featurePills"
        :key="pill.label"
        :class="[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium',
          'border-neutral-200/80 dark:border-white/10 bg-white/50 dark:bg-white/5 backdrop-blur-md',
          'text-neutral-700 dark:text-neutral-300 shadow-xs',
        ]"
      >
        <div :class="[pill.icon, pill.color, 'h-3.5 w-3.5 shrink-0']" />
        <span>{{ pill.label }}</span>
      </div>
    </div>

    <!-- Action Buttons -->
    <div
      v-motion
      :initial="{ opacity: 0, y: 10 }"
      :enter="{ opacity: 1, y: 0 }"
      :duration="400"
      :delay="400"
      :class="['flex flex-col sm:flex-row items-center gap-3 pt-3']"
    >
      <button
        v-if="props.onQuickStart"
        type="button"
        :class="[
          'rounded-xl px-5 py-2.5 text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer',
          'border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 shadow-sm shadow-cyan-500/10',
        ]"
        @click="props.onQuickStart"
      >
        <div :class="['i-solar:bolt-bold text-cyan-400 h-4 w-4']" />
        <span>{{ t('onboarding.steps.welcome.actions.quickStart') }}</span>
      </button>

      <Button
        variant="primary"
        :class="[
          'rounded-xl px-6 py-2.5 text-sm font-semibold shadow-lg shadow-primary-500/20 transition-all cursor-pointer',
          'flex items-center gap-2',
        ]"
        @click="props.onNext"
      >
        <span>{{ t('onboarding.steps.welcome.actions.guidedSetup') }}</span>
        <div :class="['i-solar:alt-arrow-right-line-duotone h-4 w-4']" />
      </Button>

      <button
        type="button"
        :class="['rounded-xl px-4 py-2.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer']"
        @click="showSkipConfirmation = true"
      >
        {{ t('onboarding.steps.welcome.actions.setupLater') }}
      </button>
    </div>

    <!-- Skip Later Confirmation Modal Dialog -->
    <div
      v-if="showSkipConfirmation"
      :class="['fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn']"
    >
      <div :class="['relative max-w-sm w-full rounded-2xl border border-neutral-200 dark:border-white/15 bg-white dark:bg-[#10101c] p-6 text-center shadow-2xl space-y-4']">
        <div :class="['mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary-500/30 bg-primary-950/20 text-primary-400 shadow-inner']">
          <div :class="['i-solar:tray-bold-duotone h-8 w-8']" />
        </div>

        <div>
          <h3 :class="['text-base font-bold text-neutral-900 dark:text-white']">
            {{ t('onboarding.steps.welcome.dialog.savedTitle') }}
          </h3>
          <p :class="['mt-2 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed']">
            {{ t('onboarding.steps.welcome.dialog.savedDescription') }}
          </p>
          <div :class="['mt-3 rounded-xl border border-primary-500/30 bg-primary-500/10 dark:bg-primary-950/30 px-3.5 py-2 text-xs font-semibold text-primary-600 dark:text-primary-300 flex items-center justify-center gap-2']">
            <div :class="['i-solar:cursor-square-bold-duotone h-4 w-4']" />
            <span>{{ t('onboarding.steps.welcome.dialog.trayItem') }}</span>
          </div>
        </div>

        <div :class="['flex items-center gap-3 pt-2']">
          <button
            type="button"
            :class="['flex-1 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-100 dark:bg-white/5 px-4 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-white/10 transition-colors cursor-pointer']"
            @click="showSkipConfirmation = false"
          >
            {{ t('onboarding.steps.welcome.dialog.continue') }}
          </button>
          <button
            type="button"
            :class="['flex-1 rounded-xl bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-500 transition-colors shadow-md shadow-primary-600/30 cursor-pointer']"
            @click="confirmCloseToTray"
          >
            {{ t('onboarding.steps.welcome.dialog.closeToTray') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.animate-fadeIn {
  animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
</style>
