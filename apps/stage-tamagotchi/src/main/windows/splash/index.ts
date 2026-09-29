import type { BrowserWindow } from 'electron'

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BrowserWindow as ElectronBrowserWindow, screen } from 'electron'

import icon from '../../../../resources/icon.png?asset'

import { baseUrl, load, withHashRoute } from '../../libs/electron/location'
import { transparentWindowConfig } from '../shared/window'

export interface SplashWindowManager {
  getWindow: () => BrowserWindow | undefined
  hasWindow: () => boolean
  show: () => void
  destroy: () => void
}

// NOTICE: The splash is intentionally dependency-free (no serverChannel/i18n).
// It renders instantly from `index.html` pre-bootstrap CSS and only receives
// `electronSplashStateChanged` broadcasts from the Main milestone relay.
export async function setupSplashWindowManager(): Promise<SplashWindowManager> {
  let initialX: number | undefined
  let initialY: number | undefined
  const width = 360
  const height = 500

  try {
    const workArea = screen.getPrimaryDisplay().workArea
    initialX = Math.round(workArea.x + (workArea.width - width) / 2)
    initialY = Math.round(workArea.y + (workArea.height - height) / 2)
  }
  catch (e) {
    console.warn('Failed to calculate Splash window position:', e)
  }

  const window = new ElectronBrowserWindow({
    title: 'AIRI',
    width,
    height,
    x: initialX,
    y: initialY,
    show: false,
    icon,
    webPreferences: {
      preload: resolve(dirname(fileURLToPath(import.meta.url)), '../preload/index.cjs'),
      sandbox: true,
    },
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    ...transparentWindowConfig(),
  })

  window.setMovable(true)

  window.on('ready-to-show', () => {
    if (!window.isDestroyed())
      window.show()
  })

  await load(window, withHashRoute(baseUrl(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'renderer')), '/splash'))

  return {
    getWindow: () => (window.isDestroyed() ? undefined : window),
    hasWindow: () => !window.isDestroyed(),
    show: () => {
      if (!window.isDestroyed())
        window.show()
    },
    destroy: () => {
      if (!window.isDestroyed()) {
        window.removeAllListeners()
        window.destroy()
      }
    },
  }
}
