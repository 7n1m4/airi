/**
 * Electrobun port: single-instance lock.
 *
 * Electrobun has no `app.requestSingleInstanceLock()`. A lockfile in userData
 * carrying the owner pid is enough: the second process reads the pid, asks the
 * first instance's window to surface, and exits.
 */

import process from 'node:process'

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Utils } from 'electrobun/main'

import { all, get } from '../windows/registry'

const LOCK_FILE = 'instance.lock'

interface LockRecord {
  pid: number
  tag?: string
  startedAt: string
}

/** Alive even when the owner belongs to another user (EPERM, not ESRCH). */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

export interface SingleInstanceProbe {
  /** True when this process owns the lock and must keep running. */
  primary: boolean
}

export function claimSingleInstance(userData: string, tag?: string): SingleInstanceProbe {
  const path = join(userData, LOCK_FILE)

  if (existsSync(path)) {
    let record: LockRecord | null = null
    try {
      record = JSON.parse(readFileSync(path, 'utf-8')) as LockRecord
    }
    catch {
      record = null
    }

    if (record && record.pid !== process.pid && processAlive(record.pid)) {
      // NOTICE: registry order is creation order, so the Control Strip (created
      // first) wins the fallback slot when the record carries no usable tag.
      const target = (tag && get(tag)) || (record.tag ? get(record.tag) : undefined) || all()[0]
      if (target) {
        try {
          if (target.isMinimized())
            target.unminimize()
          target.show()
        }
        catch (err) {
          console.warn('[SingleInstance] Failed to surface the existing window:', err)
        }
      }
      return { primary: false }
    }

    // Stale lock from a crashed owner: take it over.
    try {
      unlinkSync(path)
    }
    catch {}
  }

  try {
    mkdirSync(dirname(path), { recursive: true })
    const record: LockRecord = { pid: process.pid, tag, startedAt: new Date().toISOString() }
    writeFileSync(path, JSON.stringify(record, null, 2), { flag: 'wx' })
  }
  catch (err) {
    console.error('[SingleInstance] Failed to write the instance lock:', err)
  }

  process.once('exit', () => {
    try {
      const record = JSON.parse(readFileSync(path, 'utf-8')) as LockRecord
      if (record.pid === process.pid)
        unlinkSync(path)
    }
    catch {}
  })

  return { primary: true }
}

/** Resolve the effective userData path, honouring the AIRI/APP overrides. */
export function resolveUserDataPath(): string {
  return process.env.AIRI_USER_DATA_DIR?.trim() || process.env.APP_USER_DATA_PATH?.trim() || Utils.paths.userData
}
