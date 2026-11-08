import { storage } from '../storage'

export interface ProvisioningSession {
  characterId: string
  universeId?: string
  phase: 'idle' | 'aggregating' | 'chunking' | 'synthesizing' | 'distill_pass_1' | 'distill_pass_2' | 'success'
  chunkSummaries: any[]
  baseArchive?: Record<string, any>
  baseContent?: string
  distillPass1Pack?: Record<string, any>
  sourceDocCount: number
  sourceManifest?: {
    rawTurnCount: number
    stmmBlockCount: number
    ltmmEntryCount: number
  }
  lastConsumedDay?: string
  totalChunks: number
  completedChunks: number
  updatedAt: number
  targetTokens?: number
  contextLimitTokens?: number
}

export const provisioningSessionRepo = {
  async get(characterId: string, universeId = 'global') {
    const key = `local:memory/provisioning-session/${characterId}:${universeId}`
    let item = await storage.getItemRaw<ProvisioningSession>(key)
    if (!item && universeId === 'global') {
      const oldKey = `local:memory/provisioning-session/${characterId}`
      item = await storage.getItemRaw<ProvisioningSession>(oldKey)
      if (item) {
        const migrated: ProvisioningSession = { ...item, universeId: 'global' }
        await storage.setItemRaw(key, migrated)
        await storage.removeItem(oldKey)
        item = migrated
      }
    }
    return item
  },

  async save(session: ProvisioningSession) {
    const universeId = session.universeId || 'global'
    const key = `local:memory/provisioning-session/${session.characterId}:${universeId}`
    // Deep clone to strip any Vue/Pinia proxies that cause DataCloneError in IndexedDB
    const cleanSession = JSON.parse(JSON.stringify({ ...session, universeId }))
    await storage.setItemRaw(key, cleanSession)
  },

  async delete(characterId: string, universeId = 'global') {
    const key = `local:memory/provisioning-session/${characterId}:${universeId}`
    await storage.removeItem(key)
    if (universeId === 'global') {
      await storage.removeItem(`local:memory/provisioning-session/${characterId}`)
    }
  },
}
