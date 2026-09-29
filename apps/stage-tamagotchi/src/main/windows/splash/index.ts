import type { BrowserWindow } from 'electron'

import { dirname, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { is } from '@electron-toolkit/utils'
import { BrowserWindow as ElectronBrowserWindow, screen } from 'electron'

import icon from '../../../../resources/icon.png?asset'

import { baseUrl, load } from '../../libs/electron/location'
import { transparentWindowConfig } from '../shared/window'

export interface SplashWindowManager {
  getWindow: () => BrowserWindow | undefined
  hasWindow: () => boolean
  show: () => void
  destroy: () => void
}

// NOTICE: The splash is intentionally dependency-free (no serverChannel/i18n).
// It renders instantly from its own dedicated `splash.html` MPA entry point
// and receives `electronSplashStateChanged` broadcasts from the Main milestone relay.
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
    show: true,
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

  if (is.dev || env.MAIN_APP_DEBUG || env.APP_DEBUG) {
    try {
      window.webContents.openDevTools({ mode: 'detach' })
    }
    catch {}
  }

  window.on('ready-to-show', () => {
    if (!window.isDestroyed())
      window.show()
  })

  void load(window, baseUrl(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'renderer'), 'splash.html'))
    .catch((err) => {
      console.error('[@proj-airi/stage-tamagotchi] [Splash] Failed to load splash HTML:', err)
    })

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
