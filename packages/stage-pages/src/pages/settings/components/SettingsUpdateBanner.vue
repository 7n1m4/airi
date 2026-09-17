<script setup lang="ts">
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { MarkdownRenderer } from '@proj-airi/stage-ui/components'
import { computed, ref } from 'vue'

import { useDesktopReleaseChecker } from '../composables/use-desktop-release-checker'

const props = withDefaults(defineProps<{
  /** Optional version override for testing/simulation (e.g. '0.9.17') */
  simulateVersion?: string
}>(), {})

const isExpanded = ref(false)

// Check for optional debug simulation stored in localStorage (useful for local verification)
const simulatedVersion = computed(() => {
  if (props.simulateVersion)
    return props.simulateVersion
  if (typeof localStorage !== 'undefined') {
    const debugVer = localStorage.getItem('debug:simulate-outdated-version')
    if (debugVer)
      return debugVer
  }
  return undefined
})

const {
  currentVersion,
  latestVersion,
  releaseUrl,
  releaseNotes,
  publishedAt,
  hasUpdate,
  dismiss,
} = useDesktopReleaseChecker({
  customCurrentVersion: simulatedVersion.value,
})

const formattedPublishedDate = computed(() => {
  if (!publishedAt.value)
    return ''
  try {
    const date = new Date(publishedAt.value)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }
  catch {
    return publishedAt.value
  }
})

/**
 * Clean up release notes for compact in-drawer display:
 * Strips the redundant leading # H1 title and any immediate divider lines,
 * since the drawer header already displays the version and release date.
 */
const displayReleaseNotes = computed(() => {
  if (!releaseNotes.value)
    return ''
  return releaseNotes.value
    .replace(/^#\s+(?:\S[^\n]*)?\n+/, '')
    .replace(/^-{3,}\s*\n/, '')
    .trim()
})

function openRelease() {
  if (releaseUrl.value && typeof window !== 'undefined') {
    window.open(releaseUrl.value, '_blank')
  }
}

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <!-- Gated strictly to Electron desktop companion and only when an active update is detected -->
  <div
    v-if="isStageTamagotchi() && hasUpdate"
    :class="[
      'relative overflow-hidden rounded-2xl transition-all duration-300',
      'border border-amber-500/35 bg-gradient-to-r from-amber-500/12 via-amber-500/6 to-transparent',
      'dark:border-amber-400/30 dark:from-amber-400/15 dark:via-amber-400/6',
      'shadow-xs backdrop-blur-md',
    ]"
  >
    <!-- Collapsed Top Banner Row -->
    <div :class="['flex flex-wrap items-center justify-between gap-3 p-3.5 sm:px-4.5 sm:py-3.5']">
      <!-- Left: Notification Badge & Message -->
      <div :class="['flex items-center gap-3 min-w-0 flex-1']">
        <div
          :class="[
            'flex size-8 shrink-0 items-center justify-center rounded-xl transition-transform duration-300',
            'bg-amber-500/20 text-amber-600 dark:bg-amber-400/20 dark:text-amber-300',
          ]"
        >
          <div class="i-solar:cloud-download-bold-duotone animate-pulse text-lg" />
        </div>

        <div :class="['min-w-0 flex-1 text-xs sm:text-[13px] text-neutral-800 dark:text-neutral-200 leading-snug']">
          <span>You are on version </span>
          <code :class="['px-1.5 py-0.5 rounded font-mono text-[11px] font-bold bg-neutral-200/80 dark:bg-neutral-800/90 text-neutral-700 dark:text-neutral-300 border border-neutral-300/60 dark:border-neutral-700/60']">
            {{ currentVersion }}
          </code>
          <span> and the latest version </span>
          <code :class="['px-1.5 py-0.5 rounded font-mono text-[11px] font-bold bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30']">
            {{ latestVersion }}
          </code>
          <span> is now available to download on GitHub.</span>
        </div>
      </div>

      <!-- Right: Action Buttons (Download, Notes Toggle, Dismiss) -->
      <div :class="['flex items-center gap-2 shrink-0']">
        <!-- Download on GitHub Button -->
        <button
          type="button"
          :class="[
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold text-xs transition-all duration-200',
            'bg-amber-500 text-white shadow-xs hover:bg-amber-600 active:scale-95',
            'dark:bg-amber-500 dark:text-neutral-950 dark:hover:bg-amber-400',
          ]"
          @click="openRelease"
        >
          <div class="i-solar:arrow-up-linear size-3.5 rotate-45" />
          <span>Download</span>
        </button>

        <!-- (i) Release Notes Accordion Toggle -->
        <button
          type="button"
          :class="[
            'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-medium text-xs transition-all duration-200',
            'border border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 active:scale-95',
            'dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-400/20',
          ]"
          :title="isExpanded ? 'Collapse release notes' : 'View release notes'"
          @click="toggleExpand"
        >
          <div class="i-solar:info-circle-bold-duotone size-3.5" />
          <span class="hidden sm:inline">Notes</span>
          <div
            class="i-solar:alt-arrow-down-linear size-3 transition-transform duration-200"
            :class="[isExpanded ? 'rotate-180' : '']"
          />
        </button>

        <!-- Dismiss Button -->
        <button
          type="button"
          :class="[
            'flex size-7 items-center justify-center rounded-xl transition-all duration-200',
            'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60 active:scale-90',
            'dark:text-neutral-500 dark:hover:text-neutral-200 dark:hover:bg-neutral-800/80',
          ]"
          title="Dismiss until next release"
          @click="dismiss"
        >
          <div class="i-solar:close-circle-bold-duotone size-4.5" />
        </button>
      </div>
    </div>

    <!-- Expandable Release Notes Drawer -->
    <div
      v-if="isExpanded"
      :class="[
        'border-t border-amber-500/20 dark:border-amber-400/20',
        'p-3.5 sm:p-4.5 pt-3',
      ]"
    >
      <div :class="['flex items-center justify-between pb-2 text-[11px] text-neutral-500 dark:text-neutral-400']">
        <div :class="['flex items-center gap-1.5 font-medium']">
          <div class="i-solar:document-text-bold-duotone size-3.5 text-amber-500" />
          <span>Release Highlights · {{ latestVersion }}</span>
        </div>
        <span v-if="formattedPublishedDate" class="text-[10px] font-mono">{{ formattedPublishedDate }}</span>
      </div>

      <!-- Scrollable Markdown Container with compact heading styles -->
      <div
        :class="[
          'update-notes-container max-h-64 overflow-y-auto rounded-xl p-3.5 sm:p-4 text-xs',
          'bg-white/70 dark:bg-neutral-900/70 border border-neutral-200/60 dark:border-neutral-800/80',
          'scrollbar-thin scrollbar-thumb-neutral-300 dark:scrollbar-thumb-neutral-700',
        ]"
      >
        <MarkdownRenderer :content="displayReleaseNotes" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Compact typography scoped strictly to the update notes drawer */
.update-notes-container :deep(h1) {
  font-size: 1.05rem !important;
  font-weight: 700 !important;
  margin-top: 0.5rem !important;
  margin-bottom: 0.25rem !important;
  line-height: 1.3 !important;
  background: none !important;
  -webkit-text-fill-color: initial !important;
}

.update-notes-container :deep(h2) {
  font-size: 0.95rem !important;
  font-weight: 700 !important;
  margin-top: 0.75rem !important;
  margin-bottom: 0.25rem !important;
  line-height: 1.3 !important;
}

.update-notes-container :deep(h3) {
  font-size: 0.85rem !important;
  font-weight: 600 !important;
  margin-top: 0.5rem !important;
  margin-bottom: 0.2rem !important;
  line-height: 1.3 !important;
}

.update-notes-container :deep(p),
.update-notes-container :deep(li) {
  font-size: 0.8125rem !important;
  line-height: 1.55 !important;
}

.update-notes-container :deep(ul) {
  margin-top: 0.25rem !important;
  margin-bottom: 0.5rem !important;
  padding-left: 1.25rem !important;
}

.update-notes-container :deep(hr) {
  margin: 0.6rem 0 !important;
  opacity: 0.25 !important;
}
</style>
