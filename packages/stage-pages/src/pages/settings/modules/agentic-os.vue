<script setup lang="ts">
import type { AutonomousDecisionRecord, AutonomousMode, CompanionShareScope } from '@proj-airi/stage-shared/agentic'

import { MAX_COOLDOWN_MINUTES, MIN_COOLDOWN_MINUTES, useAgenticStore } from '@proj-airi/stage-ui/stores/agentic'
import { COMPANION_SCOPES, useCompanionStore } from '@proj-airi/stage-ui/stores/companion'
import { useEventLogStore } from '@proj-airi/stage-ui/stores/event-log'
import { usePresenceStore } from '@proj-airi/stage-ui/stores/presence'
import { Button, FieldCheckbox, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

const { t } = useI18n()

const agenticStore = useAgenticStore()
const presenceStore = usePresenceStore()
const eventLogStore = useEventLogStore()
const companionStore = useCompanionStore()

const { consent, isSharing, shareCard } = storeToRefs(companionStore)

/** Share scope picked by the radio row; the grant writes it to main. */
const selectedScope = ref<CompanionShareScope>('card-only')

const scopeLabelKeys: Record<CompanionShareScope, string> = {
  'card-only': 'settings.modules.agentic-os.scopeCardOnly',
  'card-and-echo-chips': 'settings.modules.agentic-os.scopeCardAndEchoChips',
  'card-and-lifetime': 'settings.modules.agentic-os.scopeCardAndLifetime',
}

/** What the current grant actually lets a guest read, in words. */
const scopeDescriptionKeys: Record<CompanionShareScope, string> = {
  'card-only': 'settings.modules.agentic-os.guestBoundaryDesc',
  'card-and-echo-chips': 'settings.modules.agentic-os.scopeChipsEffect',
  'card-and-lifetime': 'settings.modules.agentic-os.scopeLifetimeEffect',
}

async function handleGrantConsent() {
  await companionStore.setConsent({ granted: true, scope: selectedScope.value })
  toast.success(t('settings.modules.agentic-os.consentGrantedToast'))
}

async function handleRevokeConsent() {
  await companionStore.setConsent({ granted: false, scope: 'card-only' })
  toast.success(t('settings.modules.agentic-os.consentRevokedToast'))
}

async function handleShareNow() {
  const result = await companionStore.share(selectedScope.value)
  if (result.shared) {
    toast.success(t('settings.modules.agentic-os.shared'))
  }
  else if (result.reason === 'consent-not-granted') {
    toast.error(t('settings.modules.agentic-os.consentNotGranted'))
  }
  else {
    toast.error(`${t('settings.modules.agentic-os.shareFailed')}: ${result.reason}`)
  }
}

const { autonomousMode, cooldownMinutes, httpEndpointEnabled } = storeToRefs(agenticStore)
const { presence } = storeToRefs(presenceStore)

const autonomousModes: { value: AutonomousMode, labelKey: string, descKey: string }[] = [
  { value: 'disabled', labelKey: 'settings.modules.agentic-os.modeDisabled', descKey: 'settings.modules.agentic-os.modeDisabledDesc' },
  { value: 'when-away', labelKey: 'settings.modules.agentic-os.modeWhenAway', descKey: 'settings.modules.agentic-os.modeWhenAwayDesc' },
  { value: 'always', labelKey: 'settings.modules.agentic-os.modeAlways', descKey: 'settings.modules.agentic-os.modeAlwaysDesc' },
]

/**
 * Presence labels by state, so the page renders a readable reason for the state
 * it is showing.
 */
const presenceLabelKeys: Record<string, string> = {
  'active': 'settings.modules.agentic-os.presenceActive',
  'idle': 'settings.modules.agentic-os.presenceIdle',
  'away': 'settings.modules.agentic-os.presenceAway',
  'screen-locked': 'settings.modules.agentic-os.presenceScreenLocked',
  'sleep': 'settings.modules.agentic-os.presenceSleep',
}

const isRunningCycle = computed(() => agenticStore.isCycleRunning)
const systemOneConfigured = computed(() => agenticStore.systemOneStore.configured)

/** The autonomous ledger entries, newest first. */
const autonomousEvents = computed(() => eventLogStore.autonomousEvents.slice(0, 25))

const lastDecision = computed<AutonomousDecisionRecord | null>(() => agenticStore.lastDecision)

const cooldownRemaining = computed(() => {
  const remaining = agenticStore.cooldownRemainingMs()
  if (remaining <= 0)
    return null
  return Math.ceil(remaining / 60000)
})

const httpToken = ref('')

function handleModeChange(next: AutonomousMode) {
  autonomousMode.value = next
  // The main process owns the authoritative copy; the renderer mirror is only
  // a cache, so every change is written back through the eventa contract.
  void agenticStore.invokeApplyConfig({ autonomousMode: next })
}

async function handleRunNow() {
  await agenticStore.runCycle('manual')
  await nextTick()
}

function handleCooldownChange(value: number | undefined) {
  if (value == null)
    return
  cooldownMinutes.value = value
  void agenticStore.invokeApplyConfig({ cooldownMinutes: value })
}

async function handleToggleHttpEndpoint(next: boolean) {
  httpEndpointEnabled.value = next
  await agenticStore.invokeApplyConfig({ httpEndpointEnabled: next })
  toast.success(next ? t('settings.modules.agentic-os.enableHttpEndpoint') : t('settings.modules.agentic-os.httpEndpoint'))
}

async function handleRotateToken() {
  const config = await agenticStore.invokeRotateHttpToken()
  if (config?.httpAuthToken) {
    httpToken.value = config.httpAuthToken
    toast.success(t('settings.modules.agentic-os.tokenRotated'))
  }
}

async function handleCopyToken() {
  if (!httpToken.value)
    return
  await navigator.clipboard.writeText(httpToken.value)
  toast.success(t('settings.modules.agentic-os.tokenCopied'))
}

const endpointUrl = computed(() => {
  const base = agenticStore.config.httpEndpointEnabled ? 'http://127.0.0.1' : ''
  return `${base}/status`
})

onMounted(() => {
  void eventLogStore.init()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Autonomous mode -->
    <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
      <h3 class="text-lg font-semibold">
        {{ t('settings.modules.agentic-os.autonomousMode') }}
      </h3>
      <p class="text-sm text-neutral-600 dark:text-neutral-400">
        {{ t('settings.modules.agentic-os.autonomousModeDesc') }}
      </p>

      <div class="flex flex-col gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <label
          v-for="mode in autonomousModes"
          :key="mode.value"
          class="flex cursor-pointer items-start gap-3"
        >
          <input
            type="radio"
            :value="mode.value"
            :checked="autonomousMode === mode.value"
            class="mt-1"
            @change="handleModeChange(mode.value)"
          >
          <div>
            <p class="font-medium">
              {{ t(mode.labelKey) }}
            </p>
            <p class="text-sm text-neutral-600 dark:text-neutral-400">
              {{ t(mode.descKey) }}
            </p>
          </div>
        </label>
      </div>

      <div class="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p class="font-medium">
          {{ t('settings.modules.agentic-os.cooldown') }}
        </p>
        <p class="text-sm text-neutral-600 dark:text-neutral-400">
          {{ t('settings.modules.agentic-os.cooldownDesc') }}
        </p>
        <div class="flex items-center gap-3">
          <FieldRange
            :model-value="cooldownMinutes"
            :min="MIN_COOLDOWN_MINUTES"
            :max="MAX_COOLDOWN_MINUTES"
            :step="1"
            class="flex-1"
            @update:model-value="handleCooldownChange"
          />
          <span class="w-20 text-right text-sm">
            {{ t('settings.modules.agentic-os.cooldownMinutes', { n: cooldownMinutes }) }}
          </span>
        </div>
        <p v-if="cooldownRemaining" class="text-sm text-neutral-500 dark:text-neutral-400">
          {{ t('settings.modules.agentic-os.lastCycle') }}: {{ cooldownRemaining }} min
        </p>
      </div>

      <div class="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <div>
          <p class="font-medium">
            {{ t('settings.modules.agentic-os.runNow') }}
          </p>
          <p class="text-sm text-neutral-600 dark:text-neutral-400">
            {{ t('settings.modules.agentic-os.rankingPolicyDesc') }}
          </p>
        </div>
        <Button variant="secondary" size="sm" :loading="isRunningCycle" @click="handleRunNow">
          {{ isRunningCycle ? t('settings.modules.agentic-os.running') : t('settings.modules.agentic-os.runNow') }}
        </Button>
      </div>
    </div>

    <!-- Presence -->
    <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
      <h3 class="text-lg font-semibold">
        {{ t('settings.modules.agentic-os.presence') }}
      </h3>
      <p class="text-sm text-neutral-600 dark:text-neutral-400">
        {{ t('settings.modules.agentic-os.presenceDesc') }}
      </p>

      <div class="flex flex-col gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <div class="flex items-center gap-3">
          <span class="font-medium">{{ t('settings.modules.agentic-os.presenceState') }}:</span>
          <span class="text-sm">
            {{ t(presenceLabelKeys[presence.state] ?? 'settings.modules.agentic-os.presenceActive') }}
          </span>
          <span class="text-sm text-neutral-500 dark:text-neutral-400">— {{ presence.reason }}</span>
        </div>

        <div>
          <p class="font-medium">
            {{ t('settings.modules.agentic-os.derivableStates') }}
          </p>
          <ul class="flex flex-wrap gap-2 pt-1">
            <li
              v-for="state in ['active', 'idle', 'away']"
              :key="state"
              class="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-300"
            >
              {{ t(presenceLabelKeys[state]) }}
            </li>
          </ul>
        </div>

        <div>
          <p class="font-medium">
            {{ t('settings.modules.agentic-os.unavailableStates') }}
          </p>
          <ul class="flex flex-col gap-2 pt-1 text-sm text-neutral-600 dark:text-neutral-400">
            <li>
              <span class="font-medium">{{ t('settings.modules.agentic-os.presenceScreenLocked') }}</span> —
              {{ t('settings.modules.agentic-os.screenLockedUnavailable') }}
            </li>
            <li>
              <span class="font-medium">{{ t('settings.modules.agentic-os.presenceSleep') }}</span> —
              {{ t('settings.modules.agentic-os.sleepUnavailable') }}
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Decision engine -->
    <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
      <h3 class="text-lg font-semibold">
        {{ t('settings.modules.agentic-os.decisionEngine') }}
      </h3>
      <p :class="systemOneConfigured ? 'text-sm text-emerald-700 dark:text-emerald-300' : 'text-sm text-amber-700 dark:text-amber-300'">
        {{
          systemOneConfigured
            ? t('settings.modules.agentic-os.decisionEngineConfigured')
            : t('settings.modules.agentic-os.decisionEngineUnconfigured')
        }}
      </p>

      <div class="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p class="font-medium">
          {{ t('settings.modules.agentic-os.rankingPolicy') }}
        </p>
        <p class="text-sm text-neutral-600 dark:text-neutral-400">
          {{ t('settings.modules.agentic-os.rankingPolicyDesc') }}
        </p>
      </div>
    </div>

    <!-- OS automation endpoint -->
    <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
      <h3 class="text-lg font-semibold">
        {{ t('settings.modules.agentic-os.httpEndpoint') }}
      </h3>
      <p class="text-sm text-neutral-600 dark:text-neutral-400">
        {{ t('settings.modules.agentic-os.httpEndpointDesc') }}
      </p>

      <div class="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p class="font-medium">
          {{ t('settings.modules.agentic-os.enableHttpEndpoint') }}
        </p>
        <FieldCheckbox
          :model-value="httpEndpointEnabled"
          @update:model-value="handleToggleHttpEndpoint"
        />
      </div>

      <div v-if="httpEndpointEnabled" class="flex flex-col gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <div>
          <p class="font-medium">
            {{ t('settings.modules.agentic-os.endpointAddress') }}
          </p>
          <code class="block break-all rounded bg-neutral-200 px-3 py-2 text-sm dark:bg-neutral-800">
            {{ endpointUrl }}
          </code>
        </div>

        <div>
          <p class="font-medium">
            {{ t('settings.modules.agentic-os.authToken') }}
          </p>
          <p class="text-sm text-neutral-600 dark:text-neutral-400">
            {{ t('settings.modules.agentic-os.authTokenDesc') }}
          </p>
          <div class="flex items-center gap-2 pt-1">
            <input
              v-model="httpToken"
              type="text"
              readonly
              class="flex-1 rounded bg-neutral-200 px-3 py-2 text-sm dark:bg-neutral-800"
            >
            <Button variant="ghost" size="sm" :disabled="!httpToken" @click="handleCopyToken">
              {{ t('settings.modules.agentic-os.token') }}
            </Button>
            <Button variant="secondary" size="sm" @click="handleRotateToken">
              {{ t('settings.modules.agentic-os.rotateToken') }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Autonomous log -->
    <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
      <h3 class="text-lg font-semibold">
        {{ t('settings.modules.agentic-os.autonomousLog') }}
      </h3>
      <p class="text-sm text-neutral-600 dark:text-neutral-400">
        {{ t('settings.modules.agentic-os.autonomousLogDesc') }}
      </p>

      <div v-if="lastDecision" class="flex flex-col gap-1 rounded-lg bg-neutral-200/60 p-3 text-sm dark:bg-neutral-800/60">
        <p class="font-medium">
          {{ t('settings.modules.agentic-os.undoLast') }}: {{ lastDecision.outcome }}
        </p>
        <p class="text-neutral-600 dark:text-neutral-400">
          {{ lastDecision.detail ?? '' }}
        </p>
      </div>

      <ul v-if="autonomousEvents.length" class="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <li
          v-for="event in autonomousEvents"
          :key="event.id"
          class="flex items-start gap-3 text-sm"
        >
          <code class="w-20 shrink-0 text-neutral-500 dark:text-neutral-400">{{ new Date(event.timestamp).toLocaleTimeString() }}</code>
          <span>{{ event.textSummary }}</span>
        </li>
      </ul>
      <p v-else class="text-sm text-neutral-500 dark:text-neutral-400">
        {{ t('settings.modules.agentic-os.noAutonomousEvents') }}
      </p>
    </div>

    <!-- Companion sharing consent -->
    <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
      <h3 class="text-lg font-semibold">
        {{ t('settings.modules.agentic-os.consent') }}
      </h3>
      <p class="text-sm text-neutral-600 dark:text-neutral-400">
        {{ t('settings.modules.agentic-os.consentDesc') }}
      </p>

      <div class="flex items-center gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <span
          class="h-2.5 w-2.5 rounded-full"
          :style="{ backgroundColor: consent.granted ? '#22c55e' : '#6b7280' }"
        />
        <span class="text-sm">
          {{
            consent.granted
              ? t('settings.modules.agentic-os.consentGranted')
              : t('settings.modules.agentic-os.consentNotGranted')
          }}
        </span>
        <span v-if="consent.grantedAt" class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ new Date(consent.grantedAt).toLocaleString() }}
        </span>
      </div>

      <div class="flex flex-col gap-2">
        <p class="font-medium">
          {{ t('settings.modules.agentic-os.shareScope') }}
        </p>
        <label
          v-for="scope in COMPANION_SCOPES"
          :key="scope"
          class="flex cursor-pointer items-start gap-3"
        >
          <input
            v-model="selectedScope"
            type="radio"
            :value="scope"
            class="mt-1"
          >
          <div>
            <p class="font-medium">
              {{ t(scopeLabelKeys[scope]) }}
            </p>
            <p class="text-sm text-neutral-600 dark:text-neutral-400">
              {{ t(scopeDescriptionKeys[scope]) }}
            </p>
          </div>
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <Button variant="secondary" size="sm" @click="handleGrantConsent">
          {{ t('settings.modules.agentic-os.grantConsent') }}
        </Button>
        <Button variant="ghost" size="sm" :disabled="!consent.granted" @click="handleRevokeConsent">
          {{ t('settings.modules.agentic-os.revokeConsent') }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :loading="isSharing"
          :disabled="!consent.granted"
          @click="handleShareNow"
        >
          {{ t('settings.modules.agentic-os.shareNow') }}
        </Button>
      </div>

      <div v-if="shareCard" class="border-t border-neutral-200 pt-4 text-sm dark:border-neutral-800">
        <p class="font-medium">
          {{ t('settings.modules.agentic-os.guestBoundary') }}
        </p>
        <p class="text-neutral-600 dark:text-neutral-400">
          {{ t('settings.modules.agentic-os.guestBoundaryDesc') }}
        </p>
        <p class="pt-2 text-neutral-600 dark:text-neutral-400">
          {{ t('settings.modules.agentic-os.sharedCard') }}: <code class="rounded bg-neutral-200 px-1.5 dark:bg-neutral-800">{{ shareCard.name }}</code>
        </p>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.agentic-os.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
