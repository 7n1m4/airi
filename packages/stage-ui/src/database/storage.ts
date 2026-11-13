import indexedDbDriver from 'unstorage/drivers/indexedb'
import memoryDriver from 'unstorage/drivers/memory'

import { createStorage } from 'unstorage'

import { isSecretStorageKey } from '../libs/secret-storage-keys'

export const storage = createStorage({
  driver: memoryDriver(),
})

const isIndexedDbAvailable = typeof indexedDB !== 'undefined'
storage.mount('local', isIndexedDbAvailable ? indexedDbDriver({ base: 'airi-local' }) : memoryDriver())
storage.mount('outbox', isIndexedDbAvailable ? indexedDbDriver({ base: 'airi-sync-queue' }) : memoryDriver())

// Exportable state to bypass outbox enqueuing during remote reconciliation imports
export const storageState = {
  isImportingRemoteData: false,
  // Writes dropped by the import window are held here and replayed when the window ends;
  // reconcile drains this on exit, other windows discard it on their next entry.
  pendingImportWrites: [] as Array<{ key: string, action: 'upsert' | 'delete' }>,
}

// Sync queue helper
async function enqueueSync(key: string, action: 'upsert' | 'delete') {
  if (!key.startsWith('local:'))
    return
  if (key.startsWith('local:sync-metadata'))
    return // Skip metadata keys
  if (key === 'local:sync/tombstones')
    return // Device-local delete tombstones; never synced
  // Bridge keys carry the credential outside the local: prefix, so probe both forms.
  const secretProbe = key.startsWith('local:localstorage/') ? key.substring('local:localstorage/'.length) : key
  if (isSecretStorageKey(secretProbe) || isSecretStorageKey(key))
    return // Secrets are never synced, by any path
  if (storageState.isImportingRemoteData) {
    storageState.pendingImportWrites.push({ key, action })
    return
  }
  if (typeof window !== 'undefined' && localStorage.getItem('settings/sync/enabled') !== 'true')
    return

  const keyWithoutPrefix = key.replace('local:', '')

  try {
    // 1. Update/remove local modification timestamp
    const timestampKey = `local:sync-metadata/timestamps/${keyWithoutPrefix}`
    const now = Date.now()
    if (action === 'upsert') {
      await storage.setItemRaw(timestampKey, now)
    }
    else {
      await storage.removeItem(timestampKey)
    }

    // 2. Queue in outbox
    const syncKey = `outbox:queue/${keyWithoutPrefix}`
    await storage.setItemRaw(syncKey, {
      key,
      action,
      timestamp: now,
    })
  }
  catch (err) {
    console.error(`[StorageSync] Failed to enqueue sync for ${key}:`, err)
  }
}

// Replay the writes held back during a remote-import window. Called by the engine when
// an import window ends; entries still subject to all the exclusions above.
export async function flushPendingImportWrites() {
  const pending = storageState.pendingImportWrites.splice(0, storageState.pendingImportWrites.length)
  for (const { key, action } of pending) {
    await enqueueSync(key, action)
  }
}

// Wrap setItem to intercept writes
const orgSetItem = storage.setItem
storage.setItem = async function (key: string, value: any, opts?: any) {
  const res = await orgSetItem.call(this, key, value, opts)
  await enqueueSync(key, 'upsert')
  return res
}

// Wrap setItemRaw to intercept raw writes
const orgSetItemRaw = storage.setItemRaw
storage.setItemRaw = async function (key: string, value: any, opts?: any) {
  const res = await orgSetItemRaw.call(this, key, value, opts)
  await enqueueSync(key, 'upsert')
  return res
}

// Wrap removeItem to intercept deletes
const orgRemoveItem = storage.removeItem
storage.removeItem = async function (key: string, opts?: any) {
  const res = await orgRemoveItem.call(this, key, opts)
  await enqueueSync(key, 'delete')
  return res
}
