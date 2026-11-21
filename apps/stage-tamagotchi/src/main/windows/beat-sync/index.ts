import type { BrowserWindow } from 'electron'

import { createPortedWindow } from '../shared/ported'

export interface BeatSyncWindowManager {
  getWindow: () => Promise<BrowserWindow>
}

/**
 * Beat-sync owns its own MPA entry (`beat-sync.html`); it has no hash route and no base
 * window services (the renderer talks to the channel server directly).
 *
 * `initScreenCaptureForWindow` from `@proj-airi/electron-screen-capture` is deliberately
 * dropped: `desktopCapturer` has no Electrobun equivalent (docs/design-electrobun-port.md §3.1).
 */
export function setupBeatSync(): BeatSyncWindowManager {
  let current: Awaited<ReturnType<typeof createPortedWindow>> | undefined

  return {
    getWindow: async () => {
      if (current && !current.isDestroyed())
        return current.window
      current = await createPortedWindow({
        tag: 'beat-sync',
        title: 'AIRI — Beat Sync',
        width: 1020,
        height: 640,
        html: 'beat-sync.html',
      })
      return current.window
    },
  }
}
