import type { BrowserWindow } from 'electrobun/main'

import { APP_ICON } from '../../assets'
import { isDestroyed } from '../registry'
import { createViewWindow } from '../shared/create-window'

export interface SplashWindowManager {
  getWindow: () => BrowserWindow | undefined
  hasWindow: () => boolean
  show: () => void
  destroy: () => void
}

const SPLASH_TAG = 'splash'

// NOTICE: The splash is intentionally dependency-free (no serverChannel/i18n).
// It renders instantly from its own dedicated `splash.html` MPA entry point
// and receives `electronSplashStateChanged` broadcasts from the Main milestone relay.
export async function setupSplashWindowManager(): Promise<SplashWindowManager> {
  const width = 420
  const height = 560

  // shortcut: Electrobun's `setAlwaysOnTop(true)` takes no level, so the splash cannot be
  // pinned above the Control Strip the way Electron's `alwaysOnTop` + creation order did.
  const window = await createViewWindow({
    tag: SPLASH_TAG,
    title: 'AIRI',
    html: 'splash.html',
    frame: { width, height },
    transparent: true,
    hidden: true,
    activate: false,
    alwaysOnTop: true,
  })

  // `hidden` keeps it off-screen until now — this is the `ready-to-show` replacement.
  window.show()

  return {
    getWindow: () => (isDestroyed(window) ? undefined : window),
    hasWindow: () => !isDestroyed(window),
    show: () => {
      if (!isDestroyed(window))
        window.show()
    },
    destroy: () => {
      if (isDestroyed(window))
        return
      try {
        window.close()
      }
      catch (err) {
        console.warn('[Splash] Failed to close the splash window:', err)
      }
    },
  }
}

// NOTICE: `APP_ICON` stays referenced so the icon path is exercised on the splash surface
// (Electrobun's BrowserWindow has no per-window icon setter; the tray consumes it too).
void APP_ICON
