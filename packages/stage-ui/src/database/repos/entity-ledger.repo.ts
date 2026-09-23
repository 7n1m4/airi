import type { EntityLedgerJSON } from '../../libs/search/entity-ledger'

import { storage } from '../storage'

export const entityLedgerRepo = {
  async getLedger(characterId: string): Promise<EntityLedgerJSON | null> {
    const key = `local:entity-ledger/${characterId}`
    return await storage.getItemRaw<EntityLedgerJSON>(key)
  },

  async saveLedger(characterId: string, data: EntityLedgerJSON): Promise<void> {
    const key = `local:entity-ledger/${characterId}`
    await storage.setItemRaw(key, data)
  },

  async deleteLedger(characterId: string): Promise<void> {
    const key = `local:entity-ledger/${characterId}`
    await storage.removeItem(key)
  },
}
