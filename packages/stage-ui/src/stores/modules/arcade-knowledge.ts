import type { AcquiredGameKnowledge } from '../../types/arcade'

import localforage from 'localforage'

import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'

export const useArcadeKnowledgeStore = defineStore('arcade-knowledge', () => {
  const db = localforage.createInstance({
    name: 'airi-arcade-knowledge',
    storeName: 'profiles',
  })

  const profiles = ref<Record<string, AcquiredGameKnowledge>>({})
  const isInitialized = ref(false)
  const isLoading = ref(false)

  const allProfiles = computed(() => Object.values(profiles.value))
  const acquiredCount = computed(() => Object.keys(profiles.value).length)
  const recentlyPlayed = computed(() =>
    allProfiles.value.slice().sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0)),
  )

  async function initialize(): Promise<void> {
    if (isInitialized.value)
      return

    isLoading.value = true
    try {
      const loaded: Record<string, AcquiredGameKnowledge> = {}
      await db.iterate<AcquiredGameKnowledge, void>((value, key) => {
        if (value && typeof value === 'object') {
          loaded[key] = value
        }
      })
      profiles.value = loaded
      isInitialized.value = true
    }
    catch (err) {
      console.error('[ArcadeKnowledgeStore] Failed to initialize knowledge database:', err)
    }
    finally {
      isLoading.value = false
    }
  }

  function getKnowledge(gameId: string): AcquiredGameKnowledge | undefined {
    return profiles.value[gameId]
  }

  function hasKnowledge(gameId: string): boolean {
    return Boolean(profiles.value[gameId])
  }

  async function saveKnowledge(knowledge: AcquiredGameKnowledge): Promise<void> {
    const raw = JSON.parse(JSON.stringify(toRaw(knowledge))) as AcquiredGameKnowledge
    profiles.value[knowledge.gameId] = raw
    await db.setItem(knowledge.gameId, raw)
  }

  async function deleteKnowledge(gameId: string): Promise<void> {
    delete profiles.value[gameId]
    await db.removeItem(gameId)
  }

  async function recordSession(gameId: string, options?: { score?: number }): Promise<void> {
    const existing = profiles.value[gameId]
    if (!existing)
      return

    existing.lastPlayedAt = Date.now()
    existing.playCount = (existing.playCount || 0) + 1

    if (options?.score !== undefined) {
      if (existing.highScore === undefined || options.score > existing.highScore) {
        existing.highScore = options.score
      }
    }

    await saveKnowledge(existing)
  }

  function exportKnowledgeJson(gameId: string): string | null {
    const item = profiles.value[gameId]
    if (!item)
      return null
    return JSON.stringify(item, null, 2)
  }

  async function importKnowledgeJson(json: string): Promise<AcquiredGameKnowledge> {
    const parsed = JSON.parse(json) as AcquiredGameKnowledge
    if (!parsed.gameId || !parsed.gameTitle) {
      throw new Error('Invalid knowledge file: missing gameId or gameTitle')
    }
    await saveKnowledge(parsed)
    return parsed
  }

  return {
    profiles,
    isInitialized,
    isLoading,
    allProfiles,
    acquiredCount,
    recentlyPlayed,
    initialize,
    getKnowledge,
    hasKnowledge,
    saveKnowledge,
    deleteKnowledge,
    recordSession,
    exportKnowledgeJson,
    importKnowledgeJson,
  }
})
