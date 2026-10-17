const fs = require('node:fs')
const path = require('node:path')

const LOG_FILE = '/Users/richardpinedo/Projects.nosync/airi/personal_airi/logs.txt'
const BACKUP_DIR = '/Volumes/AIRI-Backup-Share/db'

function getBackupPathForKey(key) {
  const cleanKey = key.replace('local:', '')

  if (cleanKey === 'airi-cards') {
    return path.join(BACKUP_DIR, 'airi-cards.json')
  }
  if (cleanKey.startsWith('chat/index/')) {
    const id = cleanKey.replace('chat/index/', '')
    return path.join(BACKUP_DIR, 'chat', 'index', `${id}.json`)
  }
  if (cleanKey.startsWith('chat/sessions/')) {
    const id = cleanKey.replace('chat/sessions/', '')
    return path.join(BACKUP_DIR, 'chat', 'sessions', `${id}.json`)
  }
  if (cleanKey.startsWith('localstorage/')) {
    const rel = cleanKey.replace('localstorage/', '')
    return path.join(BACKUP_DIR, 'localstorage', `${rel}.json`)
  }
  // Skip internal sync metadata timestamps, outbox queue items, and conflicts
  return null
}

try {
  console.info(`Reading sync log file at: ${LOG_FILE}...`)
  const content = fs.readFileSync(LOG_FILE, 'utf8')
  const lines = content.split('\n')

  const parsedKeys = new Map()
  const keyRegex = /Reconciling key:\s+([^\s,]+),\s+localTime=([\d.]+),\s+remoteMtime=([\d.]+)/

  for (const line of lines) {
    const match = line.match(keyRegex)
    if (match) {
      const key = match[1]
      const localTime = Number.parseFloat(match[2])
      const remoteMtime = Number.parseFloat(match[3])
      parsedKeys.set(key, { localTime, remoteMtime })
    }
  }

  console.info(`Found ${parsedKeys.size} distinct database keys in log.`)

  let totalAudited = 0
  const missingBackup = []
  const unsyncedChanges = []

  for (const [key, info] of parsedKeys.entries()) {
    const backupPath = getBackupPathForKey(key)
    if (!backupPath)
      continue // Skip keys we don't care about auditing (meta keys)

    totalAudited++
    const fileExists = fs.existsSync(backupPath)

    if (!fileExists) {
      missingBackup.push({ key, backupPath, info })
    }
    else {
      // Check if local was newer than remote at time of sync
      if (info.localTime > info.remoteMtime) {
        // Double check filesystem stats of backup file to see if it was uploaded later
        const stats = fs.statSync(backupPath)
        const actualBackupTime = stats.mtimeMs
        // If the backup file's current disk mtime is still older than localTime, it's unsynced
        if (actualBackupTime < info.localTime) {
          unsyncedChanges.push({
            key,
            backupPath,
            localTime: new Date(info.localTime).toISOString(),
            remoteMtime: new Date(info.remoteMtime).toISOString(),
            backupFileTime: new Date(actualBackupTime).toISOString(),
          })
        }
      }
    }
  }

  console.info('\n=======================================')
  console.info(`AUDITED ${totalAudited} CRITICAL USER DATA KEYS`)
  console.info('=======================================')

  console.info(`\n1. MISSING FROM BACKUP SHARE: ${missingBackup.length}`)
  if (missingBackup.length > 0) {
    missingBackup.forEach((item) => {
      console.warn(`[MISSING] Key: "${item.key}"`)
      console.warn(`          Expected Backup Path: "${item.backupPath}"`)
    })
  }
  else {
    console.info('🎉 No keys are missing from the backup share!')
  }

  console.info(`\n2. UNSYNCED LOCAL MODIFICATIONS (Local was newer than Backup): ${unsyncedChanges.length}`)
  if (unsyncedChanges.length > 0) {
    unsyncedChanges.forEach((item) => {
      console.warn(`[UNSYNCED] Key: "${item.key}"`)
      console.warn(`           Local Time (Log):  ${item.localTime}`)
      console.warn(`           Remote Time (Log): ${item.remoteMtime}`)
      console.warn(`           Backup File Time:  ${item.backupFileTime}`)
    })
  }
  else {
    console.info('🎉 No keys had unsynced local modifications!')
  }

  console.info('\n=======================================')
  if (missingBackup.length === 0 && unsyncedChanges.length === 0) {
    console.info('🎉 VERDICT: 100% CLEAN SYNC! Every single local key and modification was successfully backed up on `/Volumes/AIRI-Backup-Share` before the reset.')
  }
  else {
    console.info('⚠️ VERDICT: Gaps found! Reconcile missing keys or unsynced changes before clearing IndexedDB.')
  }
  console.info('=======================================')
}
catch (err) {
  console.error('Failed to run audit:', err)
}
