import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

import { useDataMaintenance } from '../composables/use-data-maintenance'

export const useBackupStore = defineStore('backup', () => {
  const isBackupEnabled = useLocalStorageManualReset<boolean>('settings/backup/enabled', true)
  const backupPath = useLocalStorageManualReset<string>('settings/backup/path', '')
  const lastBackupTime = useLocalStorageManualReset<number>('settings/backup/last-time', 0)

  const dataMaintenance = useDataMaintenance()

  async function triggerBackup() {
    console.info('[Backup] Triggering backup...')

    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-')
      const files: Record<string, string> = {}

      // 1. Export Chats
      const chatsBlob = await dataMaintenance.exportChatSessions()
      files[`airi-chat-sessions-${timestamp}.json`] = await chatsBlob.text()

      // 2. Export Characters
      const charactersBlob = await dataMaintenance.exportAllCharacters()
      files[`airi-characters-${timestamp}.json`] = await charactersBlob.text()

      // 3. Export Memory
      const memoryBlob = await dataMaintenance.exportMemory()
      files[`airi-memory-${timestamp}.json`] = await memoryBlob.text()

      // 4. Export LocalStorage
      const storageData: Record<string, string> = {}
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) {
          storageData[key] = localStorage.getItem(key) || ''
        }
      }
      files[`airi-localstorage-${timestamp}.json`] = JSON.stringify(storageData, null, 2)

      // Save as bundle (ZIP)
      const result = await (window as any).electron.ipcRenderer.invoke('save-backup-bundle', {
        timestamp,
        files,
        customPath: backupPath.value,
      }) as { success: boolean, path: string }

      // Update last backup time
      lastBackupTime.value = Date.now()
      console.info('[Backup] Backup completed successfully!')
      return result.path
    }
    catch (error) {
      console.error('[Backup] Backup failed:', error)
      return null
    }
  }

  async function listBackups() {
    try {
      const result = await (window as any).electron.ipcRenderer.invoke('list-backups', {
        customPath: backupPath.value,
      })
      return result.directories || []
    }
    catch (error) {
      console.error('[Backup] Failed to list backups:', error)
      return []
    }
  }

  async function restoreBackup(backupDir: string, options: { characters: boolean, sessions: boolean, memory: boolean, localStorage: boolean }) {
    console.info(`[Backup] Restoring backup from ${backupDir} with options:`, options)
    try {
      const res = await (window as any).electron.ipcRenderer.invoke('read-backup-files', { backupDir })
      if (!res.success) {
        throw new Error(res.error || 'Failed to read backup files')
      }

      const files = res.files as Record<string, string>

      // 1. Restore Characters
      if (options.characters) {
        const charFile = Object.keys(files).find(f => f.startsWith('airi-characters-') && f.endsWith('.json'))
        if (charFile) {
          const payload = JSON.parse(files[charFile])
          await dataMaintenance.importAllCharacters(payload)
        }
      }

      // 2. Restore Sessions
      if (options.sessions) {
        const sessionFile = Object.keys(files).find(f => f.startsWith('airi-chat-sessions-') && f.endsWith('.json'))
        if (sessionFile) {
          const payload = JSON.parse(files[sessionFile])
          await dataMaintenance.importChatSessions(payload)
        }
      }

      // 3. Restore Memory
      if (options.memory) {
        const memoryFile = Object.keys(files).find(f => f.startsWith('airi-memory-') && f.endsWith('.json'))
        if (memoryFile) {
          const payload = JSON.parse(files[memoryFile])
          await dataMaintenance.importMemory(payload)
        }
      }

      // 4. Restore LocalStorage
      if (options.localStorage) {
        const storageFile = Object.keys(files).find(f => f.startsWith('airi-localstorage-') && f.endsWith('.json'))
        if (storageFile) {
          const storageData = JSON.parse(files[storageFile]) as Record<string, string>
          for (const [key, value] of Object.entries(storageData)) {
            // CRITICAL: Skip any keys starting with 'airi_cc_' to prevent writing bloated base64 Data URIs back to LocalStorage
            if (key.startsWith('airi_cc_')) {
              console.info(`[Backup Restore] Skipping bloated image color cache key: ${key.substring(0, 100)}...`)
              continue
            }
            localStorage.setItem(key, value)
          }
        }
      }

      return { success: true }
    }
    catch (error) {
      console.error('[Backup] Restore failed:', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    isBackupEnabled,
    backupPath,
    lastBackupTime,
    triggerBackup,
    listBackups,
    restoreBackup,
  }
})
