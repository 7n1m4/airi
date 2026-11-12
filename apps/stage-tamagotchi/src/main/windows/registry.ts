/**
 * Electrobun port: module-scope registry of live windows.
 *
 * Electrobun has neither `BrowserWindow.getAllWindows()` nor `webContents` identity
 * nor `isDestroyed()`, so the port tracks windows here: creation registers, the
 * native `close` event unregisters.
 */

import type { BrowserWindow } from 'electrobun/main'

export type WindowTag
  = | 'splash'
    | 'main'
    | 'stage'
    | 'caption'
    | 'chat'
    | 'settings'
    | 'onboarding'
    | 'customizer'
    | 'notice'
    | 'about'
    | 'devtools'
    | 'widgets'
    | 'beat-sync'
    | (string & {})

const windows = new Map<WindowTag, BrowserWindow>()
const destroyed = new WeakSet<BrowserWindow>()

/** A window object is reused for the whole process lifetime; only the native window is gone. */
function watch(win: BrowserWindow): BrowserWindow {
  win.on('close', () => {
    destroyed.add(win)
    for (const [tag, candidate] of windows) {
      if (candidate === win)
        windows.delete(tag)
    }
  })
  return win
}

export function register(win: BrowserWindow, tag: WindowTag): BrowserWindow {
  watch(win)
  windows.set(tag, win)
  return win
}

/** Re-tag an already registered window (a manager that opens under a second tag). */
export function tag(win: BrowserWindow, tag: WindowTag): BrowserWindow {
  return register(win, tag)
}

export function get(tag: WindowTag): BrowserWindow | undefined {
  const win = windows.get(tag)
  return win && !destroyed.has(win) ? win : undefined
}

export function all(): BrowserWindow[] {
  return [...windows.values()].filter(win => !destroyed.has(win))
}

export function isDestroyed(win: BrowserWindow): boolean {
  return destroyed.has(win)
}

export function closeAll(): void {
  for (const win of all())
    win.close()
  windows.clear()
}
