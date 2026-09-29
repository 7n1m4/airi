import type { StartupMilestoneId, StartupSnapshot } from '../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { version } from '~build/package'

import {
  electronSplashDismiss,
  electronSplashGetSnapshot,
  electronSplashReportMilestone,
  electronSplashStateChanged,
  electronStageRelease,
} from '../shared/eventa'

// NOTICE: Milestone labels for the dedicated splash screen.
// Kept self-contained so the splash paints instantly (<10ms) without waiting
// on i18n initialization or the monolithic main.ts application graph.
const MILESTONE_LABELS: Record<StartupMilestoneId, string> = {
  'core-services': 'Starting core services...',
  'sync-engine': 'Initializing sync engine...',
  'character-card': 'Loading active character...',
  'stage-actor': 'Preparing avatar stage...',
}

// DOM Elements
const splashCard = document.getElementById('splash-card')
const versionBadge = document.getElementById('version-badge')
const spinner = document.getElementById('spinner')
const checkIcon = document.getElementById('check-icon')
const statusLabel = document.getElementById('status-label')
const progressBar = document.getElementById('progress-bar')
const progressPercent = document.getElementById('progress-percent')
const subHint = document.getElementById('sub-hint')
const btnCloseDebug = document.getElementById('btn-close-debug')
const errorZone = document.getElementById('error-zone')
const errorMsg = document.getElementById('error-msg')
const errorDetails = document.getElementById('error-details')
const btnRetry = document.getElementById('btn-retry')
const btnSkipAvatar = document.getElementById('btn-skip-avatar')

// Populate version badge immediately
if (versionBadge && version) {
  versionBadge.textContent = `v${version}`
}

// IPC & Eventa context
const ipcRenderer = (window as unknown as { electron?: { ipcRenderer?: unknown } })?.electron?.ipcRenderer
const eventaAdapter = ipcRenderer ? createContext(ipcRenderer as any) : undefined
const context = eventaAdapter?.context

const getSnapshot = context ? defineInvoke(context, electronSplashGetSnapshot) : undefined
const dismissSplash = context ? defineInvoke(context, electronSplashDismiss) : undefined
const reportMilestone = context ? defineInvoke(context, electronSplashReportMilestone) : undefined
const releaseStage = context ? defineInvoke(context, electronStageRelease) : undefined

const retryChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('airi:startup-retry')
  : undefined

let currentSnapshot: StartupSnapshot | null = null
let dismissRequested = false
let watchdogTimer: ReturnType<typeof setTimeout> | undefined

function resetWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer)
  }
  // If no milestone updates arrive for 15s, show timeout warning
  watchdogTimer = setTimeout(() => {
    if (!currentSnapshot?.ready && !currentSnapshot?.failed) {
      if (statusLabel) {
        statusLabel.textContent = 'Startup is taking longer than expected...'
      }
    }
  }, 15000)
}

function resolveStatusLabel(snap: StartupSnapshot): string {
  if (snap.failed) {
    return snap.failed.error || 'Startup failed'
  }
  if (snap.ready) {
    return 'Ready!'
  }
  const stageSkipped = snap.resources.find(r => r.id === 'stage-actor')?.status === 'skipped'
  const active = snap.resources.find(r => r.status === 'loading')
    ?? snap.resources.find(r => r.status === 'queued')

  if (!active && stageSkipped) {
    return 'Avatar skipped (starting in minimal mode)'
  }
  if (!active) {
    return 'Ready!'
  }
  if (active.id === 'stage-actor' && stageSkipped) {
    return 'Avatar skipped (starting in minimal mode)'
  }
  return MILESTONE_LABELS[active.id] || 'Loading AIRI...'
}

function render(snap: StartupSnapshot) {
  currentSnapshot = snap

  const progress = Math.min(100, Math.max(0, snap.progress ?? 0))
  const isReady = Boolean(snap.ready)
  const failed = snap.failed

  if (progressBar) {
    progressBar.style.width = `${progress}%`
  }
  if (progressPercent) {
    progressPercent.textContent = `${progress}%`
  }

  if (failed) {
    if (spinner)
      spinner.style.display = 'none'
    if (checkIcon)
      checkIcon.style.display = 'none'
    if (errorZone)
      errorZone.classList.add('visible')
    if (errorMsg)
      errorMsg.textContent = failed.error || 'Startup failed'
    if (errorDetails)
      errorDetails.textContent = failed.error || 'Unknown error occurred during startup'
    if (btnSkipAvatar) {
      btnSkipAvatar.style.display = failed.id === 'stage-actor' ? 'inline-block' : 'none'
    }
    return
  }

  if (errorZone) {
    errorZone.classList.remove('visible')
  }

  if (statusLabel) {
    statusLabel.textContent = resolveStatusLabel(snap)
  }

  if (isReady) {
    if (spinner)
      spinner.style.display = 'none'
    if (checkIcon)
      checkIcon.style.display = 'block'
    if (subHint)
      subHint.style.display = 'none'

    // NOTICE: When ready, notify Main to reveal the app windows.
    // For debugging we also provide a manual Close button so DevTools stay inspectable.
    if (!dismissRequested) {
      dismissRequested = true
      if (watchdogTimer) {
        clearTimeout(watchdogTimer)
        watchdogTimer = undefined
      }
      void dismissSplash?.().catch(() => {})
    }

    if (btnCloseDebug) {
      btnCloseDebug.style.display = 'inline-block'
    }
  }
  else {
    if (spinner)
      spinner.style.display = 'block'
    if (checkIcon)
      checkIcon.style.display = 'none'
  }
}

// User Action Handlers
btnRetry?.addEventListener('click', async () => {
  const failedMilestone = currentSnapshot?.failed
  if (!failedMilestone)
    return
  await reportMilestone?.({ id: failedMilestone.id, status: 'loading' }).catch(() => {})
  retryChannel?.postMessage({ id: failedMilestone.id })
})

btnSkipAvatar?.addEventListener('click', async () => {
  await reportMilestone?.({ id: 'stage-actor', status: 'skipped' }).catch(() => {})
  await releaseStage?.().catch(() => {})
})

btnCloseDebug?.addEventListener('click', () => {
  if (splashCard) {
    splashCard.classList.add('exiting')
  }
  setTimeout(() => {
    window.close()
  }, 300)
})

// Attach Eventa Listeners
if (context) {
  context.on(electronSplashStateChanged, (event) => {
    if (event?.body) {
      resetWatchdog()
      render(event.body)
    }
  })

  // Initial snapshot query
  void getSnapshot?.().then((snap) => {
    if (snap) {
      render(snap)
    }
  }).catch(() => {})
}

resetWatchdog()
