<script setup lang="ts">
import type { ConsciousnessConfig } from './useConsciousnessConfig'

import { Button } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  config: ConsciousnessConfig
}>()

const { t } = useI18n()
const { config } = props
</script>

<template>
  <aside
    v-motion
    :initial="{ opacity: 0, y: 8 }"
    :enter="{ opacity: 1, y: 0 }"
    :duration="350"
    :delay="150"
    :class="[
      'rounded-[20px] border p-4 sm:p-5 flex flex-col gap-3 min-w-0 lg:sticky lg:top-0 self-start w-full',
      'border-neutral-200/80 bg-white/70 shadow-sm dark:border-neutral-800/80 dark:bg-neutral-900/60 backdrop-blur-md',
    ]"
  >
    <div :class="['flex items-start gap-2.5']">
      <div :class="['h-8 w-8 rounded-full bg-sky-500 text-white flex items-center justify-center flex-shrink-0 shadow-sm']">
        <div :class="['i-solar:play-bold text-sm']" />
      </div>
      <div :class="['min-w-0']">
        <h2 :class="['text-base font-bold text-neutral-900 dark:text-white leading-tight']">
          {{ t('onboarding.steps.consciousness.tryBrain') }}
        </h2>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed']">
          {{ t('onboarding.steps.consciousness.testDescription') }}
        </p>
      </div>
    </div>

    <div :class="['border-t border-neutral-200/70 dark:border-white/10']" />

    <!-- Effective configuration summary -->
    <div :class="['rounded-xl border border-neutral-200/70 dark:border-white/10 bg-neutral-50/70 dark:bg-black/20 px-3 py-2.5 flex flex-col gap-1']">
      <span :class="['text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500']">
        {{ t('onboarding.steps.consciousness.testingLabel') }}
      </span>
      <span :title="config.effectiveModelLabel.value" :class="['text-sm font-semibold text-neutral-800 dark:text-neutral-100 truncate']">
        {{ config.effectiveModelLabel.value }}
      </span>
      <span :title="config.effectiveProviderLabel.value" :class="['text-[11px] text-neutral-500 dark:text-neutral-400 truncate']">
        {{ config.effectiveProviderLabel.value }}
      </span>
    </div>

    <!-- Test message input -->
    <div :class="['flex flex-col gap-1.5']">
      <label :class="['text-xs font-semibold text-neutral-700 dark:text-neutral-300']">
        {{ t('onboarding.steps.consciousness.testMessage') }}
      </label>
      <input
        v-model="config.testSimulationPrompt.value"
        type="text"
        :placeholder="t('onboarding.steps.consciousness.sayHelloAndIntroduceYourself')"
        :disabled="config.probeState.value === 'connecting' || config.probeState.value === 'inferencing'"
        :class="[
          'w-full border border-neutral-200 rounded-xl bg-white px-3 py-2 text-sm text-neutral-800 outline-none transition',
          'dark:border-neutral-700 focus:border-primary-500 dark:bg-neutral-800 dark:text-neutral-100 disabled:opacity-50 min-h-[44px]',
        ]"
        @keydown.enter="config.testBrainConnection"
      >
    </div>

    <Button
      variant="primary"
      :disabled="!config.canRunProbe.value"
      :class="[
        'w-full flex items-center justify-center gap-2 rounded-xl px-4 min-h-[44px]',
        'text-sm font-semibold text-white shadow-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
      ]"
      @click="config.testBrainConnection"
    >
      <div :class="[config.probeState.value === 'connecting' || config.probeState.value === 'inferencing' ? 'i-solar:refresh-circle-bold animate-spin h-4 w-4' : 'i-solar:play-bold h-4 w-4']" />
      <span>{{ config.probeState.value === 'connecting' || config.probeState.value === 'inferencing' ? t('onboarding.steps.consciousness.testing') : t('onboarding.steps.consciousness.simulateTurn') }}</span>
    </Button>

    <!-- Response area -->
    <div :class="['flex flex-col gap-1.5 min-w-0']">
      <span :class="['text-xs font-semibold text-neutral-700 dark:text-neutral-300']">
        {{ t('onboarding.steps.consciousness.response') }}
      </span>

      <div
        v-if="config.probeState.value === 'connecting' || config.probeState.value === 'inferencing'"
        :class="['flex items-center gap-2 py-2 text-xs text-neutral-400 italic']"
      >
        <div :class="['i-solar:refresh-circle-bold h-4 w-4 animate-spin text-primary-500 flex-shrink-0']" />
        <span>{{ config.probeState.value === 'connecting' ? t('onboarding.steps.consciousness.establishingProviderConnection') : t('onboarding.steps.consciousness.generatingInCharacterCompanionResponse') }}</span>
      </div>

      <div
        v-else-if="config.probeState.value === 'verified' && config.probeResponseMessage.value"
        :class="['flex flex-col gap-2 border border-emerald-500/20 rounded-xl bg-emerald-50/50 dark:bg-emerald-500/5 p-3.5 text-xs max-h-64 overflow-y-auto']"
      >
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/15 pb-2">
          <div class="flex items-center gap-1.5 text-emerald-600 font-bold dark:text-emerald-400">
            <span class="h-2 w-2 rounded-full bg-emerald-500" />
            <span>{{ t('onboarding.steps.consciousness.brainActiveVerified') }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
            <span v-if="config.probeBenchmarkMs.value !== null" class="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-700 font-bold dark:text-emerald-300">
              {{ t('onboarding.steps.consciousness.verification.latencyPlain', { latency: config.probeBenchmarkMs.value }) }}
            </span>
            <span v-if="config.probeTokens.value !== null" class="rounded bg-primary-500/15 px-2 py-0.5 text-primary-700 font-bold dark:text-primary-300">
              {{ t('onboarding.steps.consciousness.verification.tokensPlain', { tokens: config.probeTokens.value }) }}
            </span>
            <span :class="['px-2 py-0.5 rounded font-bold', config.probeHasReasoning.value ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300']">
              {{ config.probeHasReasoning.value ? t('onboarding.steps.consciousness.reasoningLabel') : t('onboarding.steps.consciousness.streamLabel') }}
            </span>
          </div>
        </div>
        <p class="select-text whitespace-pre-wrap text-sm text-neutral-800 leading-relaxed dark:text-neutral-200">
          {{ config.probeResponseMessage.value }}
        </p>
      </div>

      <div
        v-else-if="config.probeState.value === 'error' && config.probeErrorMessage.value"
        class="max-h-64 flex items-start gap-2.5 overflow-y-auto border border-red-500/20 rounded-xl bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400"
      >
        <div class="i-solar:danger-triangle-bold-duotone mt-0.5 h-4.5 w-4.5 flex-shrink-0 text-red-500" />
        <div class="min-w-0 flex-1">
          <span class="font-bold">{{ t('onboarding.steps.consciousness.brainConnectionFailed') }}</span>
          <p class="mt-0.5 break-all text-[11px] leading-snug">
            {{ config.probeErrorMessage.value }}
          </p>
        </div>
      </div>

      <div
        v-else
        :class="['rounded-xl border border-dashed border-neutral-300/70 dark:border-neutral-700/70 bg-neutral-50/50 dark:bg-black/20 px-3 py-6 flex flex-col items-center justify-center gap-2 text-center']"
      >
        <div :class="['i-solar:chat-round-dots-linear h-7 w-7 text-neutral-300 dark:text-neutral-600']" />
        <span :class="['text-xs text-neutral-400 dark:text-neutral-500']">
          {{ t('onboarding.steps.consciousness.responsePlaceholder') }}
        </span>
      </div>
    </div>

    <!-- Verification status -->
    <div :class="['flex items-center gap-1.5 text-xs font-semibold']">
      <span v-if="config.verificationDisplay.value === 'empty'" :class="['flex items-center gap-1.5 text-neutral-400']">
        <span :class="['h-2 w-2 rounded-full bg-neutral-300 dark:bg-neutral-600']" />
        <span>{{ t('onboarding.steps.consciousness.notConfigured') }}</span>
      </span>
      <span v-else-if="config.verificationDisplay.value === 'not-ready'" :class="['flex items-center gap-1.5 text-amber-600 dark:text-amber-400']">
        <span :class="['h-2 w-2 rounded-full bg-amber-500']" />
        <span>{{ t('onboarding.steps.consciousness.downloadRequired') }}</span>
      </span>
      <span v-else-if="config.verificationDisplay.value === 'ready'" :class="['flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400']">
        <span :class="['h-2 w-2 rounded-full bg-emerald-500']" />
        <span>{{ t('onboarding.steps.consciousness.readyToTest') }}</span>
      </span>
      <span v-else-if="config.verificationDisplay.value === 'testing'" :class="['flex items-center gap-1.5 text-primary-600 dark:text-primary-400']">
        <span :class="['h-2 w-2 rounded-full bg-primary-500 animate-pulse']" />
        <span>{{ t('onboarding.steps.consciousness.testing') }}</span>
      </span>
      <span v-else-if="config.verificationDisplay.value === 'verified'" :class="['flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400']">
        <span :class="['h-2 w-2 rounded-full bg-emerald-500']" />
        <span>{{ t('onboarding.steps.consciousness.brainVerified') }}</span>
      </span>
      <span v-else :class="['flex items-center gap-1.5 text-red-600 dark:text-red-400']">
        <span :class="['h-2 w-2 rounded-full bg-red-500']" />
        <span>{{ t('onboarding.steps.consciousness.connectionFailed') }}</span>
      </span>
    </div>
  </aside>
</template>
