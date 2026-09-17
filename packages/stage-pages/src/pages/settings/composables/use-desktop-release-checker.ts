import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useBuildInfo } from '@proj-airi/stage-ui/composables'
import { computed, getCurrentInstance, onMounted, ref } from 'vue'

export interface DesktopUpdateCache {
  lastCheckedAt: number
  latestVersion: string | null
  releaseTitle: string | null
  releaseUrl: string | null
  releaseNotes: string | null
  publishedAt: string | null
  dismissedVersion: string | null
}

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  dateStamp: number
  raw: string
}

export const STORAGE_KEY = 'settings/system/update-checker'
export const CACHE_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours
export const GITHUB_REPO = 'dasilva333/airi'

/**
 * Parses semver string with optional -stable.YYYYMMDD date stamp suffix.
 * Handles 'v0.9.32-stable.20260915', '0.9.17', 'v1.0.0', etc.
 */
export function parseVersion(versionStr: string): ParsedVersion | null {
  if (!versionStr || versionStr === 'dev')
    return null

  const cleaned = versionStr.trim().replace(/^v/, '')
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-stable\.(\d{8}))?/)
  if (!match)
    return null

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    dateStamp: match[4] ? Number.parseInt(match[4], 10) : 0,
    raw: versionStr,
  }
}

/**
 * Returns true if remoteStr is strictly newer than currentStr.
 */
export function isNewerVersion(remoteStr: string, currentStr: string): boolean {
  const remote = parseVersion(remoteStr)
  const current = parseVersion(currentStr)

  if (!current || !remote)
    return false

  if (remote.major !== current.major)
    return remote.major > current.major
  if (remote.minor !== current.minor)
    return remote.minor > current.minor
  if (remote.patch !== current.patch)
    return remote.patch > current.patch

  // When semver is identical, compare daily date stamps
  if (remote.dateStamp && current.dateStamp)
    return remote.dateStamp > current.dateStamp

  return false
}

function loadCache(): DesktopUpdateCache {
  try {
    if (typeof localStorage === 'undefined') {
      return {
        lastCheckedAt: 0,
        latestVersion: null,
        releaseTitle: null,
        releaseUrl: null,
        releaseNotes: null,
        publishedAt: null,
        dismissedVersion: null,
      }
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        lastCheckedAt: 0,
        latestVersion: null,
        releaseTitle: null,
        releaseUrl: null,
        releaseNotes: null,
        publishedAt: null,
        dismissedVersion: null,
      }
    }
    return JSON.parse(raw)
  }
  catch {
    return {
      lastCheckedAt: 0,
      latestVersion: null,
      releaseTitle: null,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      dismissedVersion: null,
    }
  }
}

function saveCache(cache: DesktopUpdateCache) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    }
  }
  catch {
    // LocalStorage write fails gracefully (e.g. quota exceeded)
  }
}

export interface DesktopReleaseCheckerOptions {
  customCurrentVersion?: string
  immediate?: boolean
}

export function useDesktopReleaseChecker(options: DesktopReleaseCheckerOptions = {}) {
  const buildInfo = useBuildInfo()
  const currentVersion = computed(() => options.customCurrentVersion || buildInfo.version || '0.0.0')

  const latestVersion = ref<string | null>(null)
  const releaseTitle = ref<string | null>(null)
  const releaseUrl = ref<string | null>(null)
  const releaseNotes = ref<string | null>(null)
  const publishedAt = ref<string | null>(null)
  const dismissedVersion = ref<string | null>(null)
  const isChecking = ref(false)

  // Initialize from cache immediately
  const initialCache = loadCache()
  latestVersion.value = initialCache.latestVersion
  releaseTitle.value = initialCache.releaseTitle
  releaseUrl.value = initialCache.releaseUrl
  releaseNotes.value = initialCache.releaseNotes
  publishedAt.value = initialCache.publishedAt
  dismissedVersion.value = initialCache.dismissedVersion

  const isDismissed = computed(() => {
    if (!dismissedVersion.value || !latestVersion.value)
      return false
    return dismissedVersion.value === latestVersion.value
  })

  const hasUpdate = computed(() => {
    if (!isStageTamagotchi())
      return false
    if (!latestVersion.value)
      return false
    if (isDismissed.value)
      return false
    return isNewerVersion(latestVersion.value, currentVersion.value)
  })

  async function checkForUpdates(force = false) {
    if (!isStageTamagotchi())
      return

    const currentCache = loadCache()
    const now = Date.now()

    // 24-hour cache throttle: skip remote fetch if checked recently
    if (!force && currentCache.lastCheckedAt && now - currentCache.lastCheckedAt < CACHE_DURATION_MS) {
      latestVersion.value = currentCache.latestVersion
      releaseTitle.value = currentCache.releaseTitle
      releaseUrl.value = currentCache.releaseUrl
      releaseNotes.value = currentCache.releaseNotes
      publishedAt.value = currentCache.publishedAt
      dismissedVersion.value = currentCache.dismissedVersion
      return
    }

    isChecking.value = true
    try {
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })

      if (!response.ok) {
        // Silent backoff on non-200 (e.g. 403 rate limit)
        return
      }

      const data = await response.json()
      if (data && data.tag_name) {
        latestVersion.value = data.tag_name
        releaseTitle.value = data.name || data.tag_name
        releaseUrl.value = data.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${data.tag_name}`
        releaseNotes.value = data.body || ''
        publishedAt.value = data.published_at || null

        // Clear snooze if a newer release arrived
        if (currentCache.dismissedVersion && currentCache.dismissedVersion !== data.tag_name) {
          dismissedVersion.value = null
        }

        saveCache({
          lastCheckedAt: now,
          latestVersion: latestVersion.value,
          releaseTitle: releaseTitle.value,
          releaseUrl: releaseUrl.value,
          releaseNotes: releaseNotes.value,
          publishedAt: publishedAt.value,
          dismissedVersion: dismissedVersion.value,
        })
      }
    }
    catch {
      // Network/offline errors fail silently
    }
    finally {
      isChecking.value = false
    }
  }

  function dismiss() {
    if (latestVersion.value) {
      dismissedVersion.value = latestVersion.value
      const currentCache = loadCache()
      currentCache.dismissedVersion = latestVersion.value
      saveCache(currentCache)
    }
  }

  if (getCurrentInstance()) {
    onMounted(() => {
      if (options.immediate !== false) {
        checkForUpdates()
      }
    })
  }

  return {
    currentVersion,
    latestVersion,
    releaseTitle,
    releaseUrl,
    releaseNotes,
    publishedAt,
    isChecking,
    isDismissed,
    hasUpdate,
    checkForUpdates,
    dismiss,
  }
}
