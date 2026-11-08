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

// NOTICE: Milestone labels and hints tailored for the warm companion experience.
// Kept self-contained so the splash paints instantly (<10ms) without waiting
// on i18n initialization or the monolithic main.ts application graph.
interface MilestoneInfo {
  label: string
  subHint: string
  icon: string
}

const MILESTONE_INFO: Record<StartupMilestoneId, MilestoneInfo> = {
  'core-services': {
    label: 'Starting core systems',
    subHint: 'Initializing runtime environment',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>`,
  },
  'sync-engine': {
    label: 'Syncing your companion',
    subHint: 'Restoring local state and memories',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>`,
  },
  'character-card': {
    label: 'Loading your character',
    subHint: 'Preparing the stage',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>`,
  },
  'stage-actor': {
    label: 'Preparing the stage',
    subHint: 'Loading avatar shaders & lights',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
    </svg>`,
  },
}

const ICON_READY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="20 6 9 17 4 12"></polyline>
</svg>`

const ICON_FAILED = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"></circle>
  <line x1="12" y1="8" x2="12" y2="12"></line>
  <line x1="12" y1="16" x2="12.01" y2="16"></line>
</svg>`

// DOM Elements
const splashCard = document.getElementById('splash-card')
const btnCloseWindow = document.getElementById('btn-close-window')
const btnThemeToggle = document.getElementById('btn-theme-toggle')
const themeLabel = document.getElementById('theme-label')
const themeIconSun = document.getElementById('theme-icon-sun')
const themeIconMoon = document.getElementById('theme-icon-moon')
const iconBadge = document.getElementById('icon-badge')
const milestoneLabel = document.getElementById('milestone-label')
const progressBar = document.getElementById('progress-bar')
const progressPercent = document.getElementById('progress-percent')
const subHint = document.getElementById('sub-hint')
const errorZone = document.getElementById('error-zone')
const errorMsg = document.getElementById('error-msg')
const errorDetails = document.getElementById('error-details')
const btnRetry = document.getElementById('btn-retry')
const btnSkipAvatar = document.getElementById('btn-skip-avatar')
const versionFooter = document.getElementById('version-footer')
const splashDiscovery = document.getElementById('splash-discovery')
const discoveryText = document.getElementById('discovery-text')

// NOTICE: Curated discovery quotes and personality lines for the startup screen.
// Kept self-contained and fact-checked against AIRI features.
const DISCOVERY_TIPS: string[] = [
  'Search avatars by appearance: click \'Reindex\' under Tags in the Model Selector to auto-tag your collection.',
  'Explore shared memories: head to Memory → Mind Map to see connections between people, places, and topics.',
  'Relive past conversations: switch to the Timeline tab in the Mind Map to scrub through your history.',
  'Teach your companion your name: add custom phonetic pronunciation rules in Audio Studio.',
  'Mute roleplay actions & emojis: configure Audio Studio so your companion speaks dialogue without narrating actions.',
  'Sculpt your companion\'s voice: tune pitch, speaking rate, and vintage radio or ASMR effects in Audio Studio.',
  'Preview before you pick: audition your companion\'s greeting in Speech settings to find the right voice.',
  'Respect your bedtime: set quiet hours in Proactivity settings to pause spontaneous check-ins at night.',
  'Switch your send shortcut: click the arrow beside Send in chat to toggle between Enter and Ctrl+Enter.',
  'Make AIRI your own: adjust the chromatic theme hue in Appearance settings to tint the entire interface.',
  'Code and file assistance: open the Virtual Terminal to give your companion a sandboxed desktop workstation.',
  'Recall past moments: search your companion\'s Long-Term Journal directly from the Memory tab.',
  'Practical stage tools: ask your companion to spawn a focus timer, sticky notes, or a checklist.',
  'Custom screen layout: drag stage widgets anywhere on your display for a comfortable workspace.',
  'Four little pastel squares: a suspicious amount of personality.',
  'Preparing your companion: they insist this loading bar counts as getting dressed.',
  'Safety guarantee: no actual strawberries were harmed in the making of Strawberry Pet.',
  'Productivity alert: your to-do list has requested a focus timer; negotiations are ongoing.',
  'No rush: not every conversation needs a destination.',
  'Cozy moments: a small ritual can make an ordinary day feel like yours.',
  'Comfortable spaces: there\'s always room here for unfinished thoughts.',
  'Quiet company: sometimes company is simply having someone nearby while you do your thing.',
]

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = arr[i]
    arr[i] = arr[j]
    arr[j] = temp
  }
  return arr
}

let discoveryDeck = shuffleArray(DISCOVERY_TIPS)
let discoveryIndex = 0
let discoveryInterval: ReturnType<typeof setInterval> | undefined

function initDiscovery() {
  if (!discoveryText)
    return
  discoveryText.textContent = discoveryDeck[discoveryIndex]
  startDiscoveryRotation()
}

function startDiscoveryRotation() {
  if (discoveryInterval)
    return
  discoveryInterval = setInterval(() => {
    if (!discoveryText)
      return
    discoveryText.classList.add('fading')
    setTimeout(() => {
      discoveryIndex++
      if (discoveryIndex >= discoveryDeck.length) {
        discoveryDeck = shuffleArray(DISCOVERY_TIPS)
        discoveryIndex = 0
      }
      discoveryText.textContent = discoveryDeck[discoveryIndex]
      discoveryText.classList.remove('fading')
    }, 300)
  }, 8500)
}

function stopDiscoveryRotation() {
  if (discoveryInterval) {
    clearInterval(discoveryInterval)
    discoveryInterval = undefined
  }
}

// Theme Toggle Management
function applyTheme(isDark: boolean) {
  if (!splashCard)
    return
  splashCard.dataset.theme = isDark ? 'dark' : 'light'
  if (themeLabel) {
    themeLabel.textContent = isDark ? 'Light' : 'Dark'
  }
  if (themeIconSun && themeIconMoon) {
    themeIconSun.style.display = isDark ? 'block' : 'none'
    themeIconMoon.style.display = isDark ? 'none' : 'block'
  }
  try {
    localStorage.setItem('vueuse-color-mode', isDark ? 'dark' : 'light')
  }
  catch {}
}

const initialIsDark = (() => {
  try {
    const saved = localStorage.getItem('vueuse-color-mode')
    if (saved === 'dark')
      return true
    if (saved === 'light')
      return false
  }
  catch {}
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
})()

applyTheme(initialIsDark)

btnThemeToggle?.addEventListener('click', () => {
  const currentDark = splashCard?.dataset.theme === 'dark'
  applyTheme(!currentDark)
})

// Populate version footer in the exact "v0.9.38 · stable" format
if (versionFooter && version) {
  const cleanVersion = version.split('-')[0] || '0.9.38'
  const channel = version.includes('stable') ? 'stable' : 'dev'
  versionFooter.textContent = `v${cleanVersion} · ${channel}`
}

// Close button quits / closes the splash window
btnCloseWindow?.addEventListener('click', () => {
  stopDiscoveryRotation()
  window.close()
})

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
      if (subHint) {
        subHint.textContent = 'Startup is taking longer than expected...'
      }
    }
  }, 15000)
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
    stopDiscoveryRotation()
    if (splashDiscovery) {
      splashDiscovery.style.display = 'none'
    }
    if (iconBadge) {
      iconBadge.innerHTML = ICON_FAILED
      iconBadge.style.background = '#fee2e2'
      iconBadge.style.color = '#dc2626'
    }
    if (milestoneLabel) {
      milestoneLabel.textContent = 'Startup issue detected'
    }
    if (subHint) {
      subHint.textContent = failed.error || 'A problem occurred while loading'
    }
    if (errorZone) {
      errorZone.classList.add('visible')
    }
    if (errorMsg) {
      errorMsg.textContent = failed.error || 'Startup failed'
    }
    if (errorDetails) {
      errorDetails.textContent = failed.error || 'Unknown error occurred during startup'
    }
    if (btnSkipAvatar) {
      btnSkipAvatar.style.display = failed.id === 'stage-actor' ? 'inline-block' : 'none'
    }
    return
  }

  if (errorZone) {
    errorZone.classList.remove('visible')
  }

  if (splashDiscovery && splashDiscovery.style.display === 'none') {
    splashDiscovery.style.display = 'flex'
    startDiscoveryRotation()
  }

  if (isReady) {
    stopDiscoveryRotation()
    if (iconBadge) {
      iconBadge.innerHTML = ICON_READY
      iconBadge.style.background = '#dcfce7'
      iconBadge.style.color = '#16a34a'
    }
    if (milestoneLabel) {
      milestoneLabel.textContent = 'Ready!'
    }
    if (subHint) {
      subHint.textContent = 'Welcome back'
    }

    // NOTICE: Zero-click auto-close. Hold "Ready!" so the user perceives
    // completion, fade out, then let Main atomically reveal the windows and destroy the splash.
    if (!dismissRequested) {
      dismissRequested = true
      if (watchdogTimer) {
        clearTimeout(watchdogTimer)
        watchdogTimer = undefined
      }
      setTimeout(() => {
        if (splashCard) {
          splashCard.classList.add('exiting')
        }
        setTimeout(() => {
          void dismissSplash?.().catch(() => {})
        }, 300)
      }, 350)
    }
    return
  }

  // Active or queued milestone resolution
  const stageSkipped = snap.resources.find(r => r.id === 'stage-actor')?.status === 'skipped'
  const active = snap.resources.find(r => r.status === 'loading')
    ?? snap.resources.find(r => r.status === 'queued')

  const milestoneId = active?.id || 'character-card'
  const info = MILESTONE_INFO[milestoneId]

  if (iconBadge && info) {
    iconBadge.innerHTML = info.icon
    const isDark = splashCard?.dataset.theme === 'dark'
    iconBadge.style.background = isDark ? 'rgba(2, 132, 199, 0.22)' : '#e0f2fe'
    iconBadge.style.color = isDark ? '#38bdf8' : '#0284c7'
  }

  if (milestoneLabel) {
    if (stageSkipped && (!active || active.id === 'stage-actor')) {
      milestoneLabel.textContent = 'Text-only companion mode'
    }
    else {
      milestoneLabel.textContent = info ? info.label : 'Loading your companion...'
    }
  }

  if (subHint) {
    if (stageSkipped && (!active || active.id === 'stage-actor')) {
      subHint.textContent = 'Stage actor bypassed'
    }
    else {
      subHint.textContent = info ? info.subHint : 'Preparing the stage'
    }
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
initDiscovery()
