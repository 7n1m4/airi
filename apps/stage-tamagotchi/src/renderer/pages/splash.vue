<script setup lang="ts">
import type { StartupMilestoneId, StartupSnapshot } from '../../shared/eventa'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useBuildInfo } from '@proj-airi/stage-ui/composables'
import { Button, Progress } from '@proj-airi/ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  electronSplashDismiss,
  electronSplashReportMilestone,
  electronSplashStateChanged,
  electronStageRelease,
} from '../../shared/eventa'

const { t } = useI18n()
const { version } = useBuildInfo()

const reportMilestone = useElectronEventaInvoke(electronSplashReportMilestone)
const dismissSplash = useElectronEventaInvoke(electronSplashDismiss)
const releaseStage = useElectronEventaInvoke(electronStageRelease)

const snapshot = ref<StartupSnapshot | null>(null)
const exiting = ref(false)
let dismissRequested = false
let watchdogTimer: ReturnType<typeof setTimeout> | undefined
let readyHoldTimer: ReturnType<typeof setTimeout> | undefined
let exitTimer: ReturnType<typeof setTimeout> | undefined

// NOTICE: Retry commands travel window-to-window over BroadcastChannel so no
// new Main IPC contract is needed. The Control Strip owns re-running the step.
const retryChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('airi:startup-retry')
  : undefined

const MILESTONE_KEYS: Record<StartupMilestoneId, string> = {
  'core-services': 'stage.startup.milestones.core_services',
  'sync-engine': 'stage.startup.milestones.sync_engine',
  'character-card': 'stage.startup.milestones.character_card',
  'stage-actor': 'stage.startup.milestones.stage_actor',
}

const progress = computed(() => snapshot.value?.progress ?? 0)
const failed = computed(() => snapshot.value?.failed)
const isReady = computed(() => snapshot.value?.ready ?? false)

const statusLabel = computed(() => {
  const snap = snapshot.value
  if (!snap)
    return t('stage.startup.milestones.core_services')
  if (snap.failed)
    return snap.failed.error || t('stage.startup.timeout')
  if (snap.ready)
    return t('stage.startup.ready')
  const stageSkipped = snap.resources.find(r => r.id === 'stage-actor')?.status === 'skipped'
  const active = snap.resources.find(r => r.status === 'loading')
    ?? snap.resources.find(r => r.status === 'queued')
  // Defensive: a skipped stage with pending siblings can only happen on
  // out-of-order reports. Prefer the skipped notice over a stale queued label.
  if (!active && stageSkipped)
    return t('stage.startup.milestones.stage_actor_skipped')
  if (!active)
    return t('stage.startup.ready')
  if (active.id === 'stage-actor' && stageSkipped)
    return t('stage.startup.milestones.stage_actor_skipped')
  return t(MILESTONE_KEYS[active.id])
})

async function handleRetry() {
  const failedMilestone = failed.value
  if (!failedMilestone)
    return
  await reportMilestone({ id: failedMilestone.id, status: 'loading' }).catch(() => {})
  retryChannel?.postMessage({ id: failedMilestone.id })
}

async function handleContinueWithoutAvatar() {
  await reportMilestone({ id: 'stage-actor', status: 'skipped' }).catch(() => {})
  await releaseStage().catch(() => {})
}

const context = useElectronEventaContext()
let stateListenerAttached = false
watch(context, (ctx) => {
  if (!ctx || stateListenerAttached)
    return
  stateListenerAttached = true
  ctx.on(electronSplashStateChanged, (event) => {
    if (event?.body)
      snapshot.value = event.body
  })
}, { immediate: true })

// NOTICE: Zero-click auto-close. Hold "Ready!" so the user perceives
// completion, fade out, then let Main atomically reveal the windows.
watch(isReady, (ready) => {
  if (!ready || dismissRequested)
    return
  dismissRequested = true
  if (watchdogTimer) {
    clearTimeout(watchdogTimer)
    watchdogTimer = undefined
  }
  readyHoldTimer = setTimeout(() => {
    exiting.value = true
    exitTimer = setTimeout(() => {
      void dismissSplash().catch(() => {})
    }, 300)
  }, 300)
})

onMounted(() => {
  // NOTICE: Watchdog marks the stalled milestone failed via the existing
  // report contract. Main rebroadcasts, which flips this view into recovery.
  watchdogTimer = setTimeout(() => {
    const snap = snapshot.value
    if (!snap || snap.ready || snap.failed)
      return
    const stalled = snap.resources.find(r => r.status === 'loading')
      ?? snap.resources.find(r => r.status === 'queued')
    if (stalled) {
      void reportMilestone({
        id: stalled.id,
        status: 'failed',
        error: t('stage.startup.timeout'),
      }).catch(() => {})
    }
  }, 10000)
})

onUnmounted(() => {
  if (watchdogTimer)
    clearTimeout(watchdogTimer)
  if (readyHoldTimer)
    clearTimeout(readyHoldTimer)
  if (exitTimer)
    clearTimeout(exitTimer)
  retryChannel?.close()
})
</script>

<template>
  <div
    :class="[
      'h-screen w-screen flex items-center justify-center overflow-hidden',
      'transition-all duration-300 ease-in-out',
      exiting ? 'scale-[0.98] opacity-0' : 'scale-100 opacity-100',
    ]"
    style="background: radial-gradient(circle at 50% 35%, #1e1e24, #121212 75%);"
  >
    <div
      :class="[
        'flex flex-col items-center gap-4 px-8 py-6 text-center',
      ]"
    >
      <!-- Drag handle: brand zone moves the floating card -->
      <div
        :class="[
          'flex flex-col items-center gap-3',
        ]"
        style="-webkit-app-region: drag;"
      >
        <div
          :class="[
            'relative flex items-center justify-center',
            'h-13 w-13 rounded-2xl',
            'border border-primary-500/25 bg-primary-500/10',
            'shadow-[0_8px_32px_rgba(0,0,0,0.4)]',
          ]"
        >
          <div
            :class="[
              'absolute rounded-2xl bg-primary-500/15 blur-[8px]',
              '-inset-1.5 animate-pulse',
            ]"
          />
          <div
            :class="[
              'relative h-4 w-4 rounded-md',
              'bg-gradient-to-br from-primary-400 to-primary-600',
              'shadow-[0_0_12px_rgba(244,114,182,0.6)]',
            ]"
          />
        </div>
        <div
          :class="[
            'text-lg font-bold tracking-[0.3em] text-neutral-100',
          ]"
        >
          AIRI
        </div>
        <div
          :class="[
            'rounded-full border border-neutral-700/60 px-2.5 py-0.5',
            'font-mono text-[11px] text-neutral-400',
          ]"
        >
          v{{ version }}
        </div>
      </div>

      <div
        :class="[
          'h-px w-56 bg-neutral-800/80',
        ]"
      />

      <!-- Loading view -->
      <div
        v-if="!failed"
        :class="[
          'flex flex-col items-center gap-3',
        ]"
      >
        <div
          v-if="!isReady"
          :class="[
            'size-5 animate-spin rounded-full',
            'border-2 border-neutral-700 border-t-primary-400',
          ]"
        />
        <div
          v-else
          :class="[
            'i-solar:check-circle-bold size-5 text-green-400',
          ]"
        />
        <div
          :class="[
            'min-h-5 max-w-70 text-sm text-neutral-300',
          ]"
        >
          {{ statusLabel }}
        </div>
        <div
          :class="[
            'w-64',
          ]"
        >
          <Progress :progress="progress" />
        </div>
        <div
          :class="[
            'font-mono text-xs text-neutral-500',
          ]"
        >
          {{ progress }}%
        </div>
      </div>

      <!-- Error recovery view -->
      <div
        v-else
        :class="[
          'flex flex-col items-center gap-3',
        ]"
      >
        <div
          :class="[
            'i-solar:danger-triangle-bold size-6 text-red-400',
          ]"
        />
        <div
          :class="[
            'max-w-70 text-sm text-neutral-200',
          ]"
        >
          {{ statusLabel }}
        </div>
        <details
          :class="[
            'max-w-70 w-full rounded-lg border border-neutral-800 bg-black/30 p-2 text-left',
          ]"
        >
          <summary
            :class="[
              'cursor-pointer text-xs text-neutral-500',
            ]"
          >
            Details
          </summary>
          <div
            :class="[
              'mt-1 max-h-20 overflow-y-auto break-words font-mono text-[11px] text-neutral-400',
            ]"
          >
            {{ failed.error }}
          </div>
        </details>
        <div
          :class="[
            'flex items-center gap-2',
          ]"
        >
          <Button size="sm" variant="secondary" @click="handleRetry">
            {{ t('stage.startup.retry') }}
          </Button>
          <Button
            v-if="failed.id === 'stage-actor'"
            size="sm"
            variant="primary"
            @click="handleContinueWithoutAvatar"
          >
            {{ t('stage.startup.continue-without-model') }}
          </Button>
        </div>
      </div>

      <div
        v-if="!failed && !isReady"
        :class="[
          'text-xs text-neutral-600',
        ]"
      >
        Ready in a moment...
      </div>
    </div>
  </div>
</template>
