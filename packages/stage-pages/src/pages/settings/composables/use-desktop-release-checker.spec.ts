import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CACHE_DURATION_MS,
  isNewerVersion,
  parseVersion,
  STORAGE_KEY,
  useDesktopReleaseChecker,
} from './use-desktop-release-checker'

// Mock stage-shared to simulate desktop Electron environment
vi.mock('@proj-airi/stage-shared', () => ({
  isStageTamagotchi: () => true,
}))

// Mock stage-ui composables
vi.mock('@proj-airi/stage-ui/composables', () => ({
  useBuildInfo: () => ({
    version: '0.9.32-stable.20260915',
  }),
}))

describe('desktop Release Checker - Version Parsing & Comparison', () => {
  it('parses standard semver versions correctly', () => {
    const parsed = parseVersion('0.9.17')
    expect(parsed).toEqual({
      major: 0,
      minor: 9,
      patch: 17,
      dateStamp: 0,
      raw: '0.9.17',
    })
  })

  it('parses versions with v prefix and date stamp correctly', () => {
    const parsed = parseVersion('v0.9.32-stable.20260915')
    expect(parsed).toEqual({
      major: 0,
      minor: 9,
      patch: 32,
      dateStamp: 20260915,
      raw: 'v0.9.32-stable.20260915',
    })
  })

  it('returns null for dev builds or invalid strings', () => {
    expect(parseVersion('dev')).toBeNull()
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('invalid-version')).toBeNull()
  })

  it('correctly detects newer versions across semver bumps', () => {
    // Newer patch
    expect(isNewerVersion('v0.9.32', '0.9.17')).toBe(true)
    expect(isNewerVersion('v0.9.17', '0.9.32')).toBe(false)

    // Newer minor
    expect(isNewerVersion('v0.10.0', '0.9.32')).toBe(true)
    expect(isNewerVersion('v0.9.32', '0.10.0')).toBe(false)

    // Newer major
    expect(isNewerVersion('v1.0.0', '0.9.32')).toBe(true)

    // Identical versions
    expect(isNewerVersion('v0.9.32', '0.9.32')).toBe(false)
  })

  it('correctly compares daily date stamps when semver is identical', () => {
    expect(isNewerVersion('v0.9.32-stable.20260915', '0.9.32-stable.20260911')).toBe(true)
    expect(isNewerVersion('v0.9.32-stable.20260911', '0.9.32-stable.20260915')).toBe(false)
    expect(isNewerVersion('v0.9.32-stable.20260915', '0.9.32-stable.20260915')).toBe(false)
  })

  it('handles dev versions safely without reporting updates', () => {
    expect(isNewerVersion('v0.9.32', 'dev')).toBe(false)
    expect(isNewerVersion('dev', '0.9.32')).toBe(false)
  })
})

const storageMap = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => storageMap.set(key, String(val)),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
  key: () => null,
  length: 0,
}

describe('desktop Release Checker - Cache & Snooze Lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage)
    mockLocalStorage.clear()
    vi.restoreAllMocks()
  })

  it('snoozes the current update when dismiss() is called', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lastCheckedAt: Date.now(),
        latestVersion: 'v0.9.33',
        releaseTitle: 'AIRI v0.9.33',
        releaseUrl: 'https://github.com/dasilva333/airi/releases/tag/v0.9.33',
        releaseNotes: 'New features',
        publishedAt: '2026-09-17T00:00:00Z',
        dismissedVersion: null,
      }),
    )

    const checker = useDesktopReleaseChecker({
      customCurrentVersion: '0.9.32',
      immediate: false,
    })

    expect(checker.hasUpdate.value).toBe(true)
    expect(checker.isDismissed.value).toBe(false)

    checker.dismiss()

    expect(checker.isDismissed.value).toBe(true)
    expect(checker.hasUpdate.value).toBe(false)

    // Verify localStorage reflects the snooze
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.dismissedVersion).toBe('v0.9.33')
  })

  it('skips remote fetch when lastCheckedAt is within 24 hours', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lastCheckedAt: Date.now() - (CACHE_DURATION_MS / 2), // 12 hours ago
        latestVersion: 'v0.9.32',
        releaseTitle: 'AIRI v0.9.32',
        releaseUrl: 'https://github.com/dasilva333/airi/releases/tag/v0.9.32',
        releaseNotes: 'Cached notes',
        publishedAt: '2026-09-15T00:00:00Z',
        dismissedVersion: null,
      }),
    )

    const checker = useDesktopReleaseChecker({
      customCurrentVersion: '0.9.31',
      immediate: false,
    })

    await checker.checkForUpdates(false)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(checker.latestVersion.value).toBe('v0.9.32')
  })
})
