import type { BrowserWindow as ElectrobunBrowserWindow } from 'electrobun/main'
import type { BrowserWindow } from 'electron'

import type { globalAppConfigSchema } from '../configs/global'
import type { Config } from '../libs/electron/persistence'
import type { I18n } from '../libs/i18n'
import type { ChatWindowManager } from '../windows/chat'
import type { CustomizerWindowManager } from '../windows/customizer'
import type { OnboardingWindowManager } from '../windows/onboarding'
import type { SettingsWindowManager } from '../windows/settings'
import type { ActorStageWindowManager } from '../windows/stage'

import Electrobun, { Utils } from 'electrobun/main'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { effect } from 'alien-signals'
import { debounce, once } from 'es-toolkit'
import { isMacOS } from 'std-env'

import { electronAppIconGet, electronAppIconSet } from '../../shared/eventa'
import { TRAY_ICON as icon, TRAY_ICON_MACOS as macOSTrayIcon } from '../assets'
import { ipcMain } from '../eventa-bus'
import { onAppBeforeQuit } from '../libs/bootkit/lifecycle'
import { notImplemented } from '../rpc'
import { AppIconVisibility } from '../windows/shared/app-icon'
import { toggleWindowShow } from '../windows/shared/window'

export interface SetupTrayParams {
  /** The Control Strip window, as returned by `setupMainWindow` (native Electrobun handle). */
  mainWindow: ElectrobunBrowserWindow
  settingsWindow: SettingsWindowManager
  onboardingWindow: OnboardingWindowManager
  aboutWindow: () => Promise<BrowserWindow>
  chatWindow?: ChatWindowManager
  stageWindow?: ActorStageWindowManager | BrowserWindow | null
  customizerWindow: CustomizerWindowManager
  i18n: I18n
  appConfig: Config<typeof globalAppConfigSchema>
}

/**
 * The hand-written `electrobun/main` ambient declaration does not list `Tray`
 * yet, but the SDK's default export carries it (devkit `sdks/main/index.ts`).
 * Declare the slice this module uses rather than editing that shared file.
 */
const { Tray } = Electrobun as unknown as {
  Tray: new (options: { image?: string, title?: string, template?: boolean, width?: number, height?: number }) => {
    visible: boolean
    setTitle: (title: string) => void
    setMenu: (menu: Array<{ type?: string, label?: string, action?: string, enabled?: boolean }>) => void
    on: (name: 'tray-clicked', handler: (event: { action?: string }) => void) => void
    remove: () => void
  }
}

/** Menu item actions are plain strings in Electrobun; dispatch them in one place. */
const TRAY_ACTIONS = {
  showMain: 'show-main',
  toggleChat: 'toggle-chat',
  toggleStage: 'toggle-stage',
  resetPositions: 'reset-window-positions',
  customizer: 'customizer',
  onboarding: 'onboarding',
  animadex: 'animadex',
  settings: 'settings',
  about: 'about',
  devtools: 'devtools',
  quit: 'quit',
} as const

const setupTrayOnce = once((params: SetupTrayParams) => {
  // Electrobun's `Tray` takes an image path directly; there is no nativeImage
  // bitmap wrapper or `setTemplateImage` call. Icons are cosmetic, so a missing
  // asset leaves a title-only tray item rather than aborting startup.
  const trayImage = (isMacOS ? macOSTrayIcon : icon) ?? ''
  if (!trayImage)
    console.warn('[Tray] No tray icon asset resolved; using a title-only tray item.')

  const appTray = new Tray({
    image: trayImage,
    template: isMacOS,
    title: 'AIRI',
    width: 16,
    height: 16,
  })

  const actions: Record<string, () => void> = {
    [TRAY_ACTIONS.showMain]: () => {
      params.mainWindow.show()
      params.mainWindow.focus()
    },
    [TRAY_ACTIONS.toggleChat]: () => {
      void params.chatWindow?.openChat()
    },
    [TRAY_ACTIONS.toggleStage]: () => {
      // NOTICE: The stage is lazily managed (text-only companions have no
      // window). Resolve the live window; spawn on demand when absent.
      const stageWindow = params.stageWindow
      if (!stageWindow)
        return
      if (typeof (stageWindow as ActorStageWindowManager).getExistingWindow === 'function') {
        const manager = stageWindow as ActorStageWindowManager
        const existing = manager.getExistingWindow()
        if (existing && !existing.isDestroyed()) {
          toggleWindowShow(existing)
        }
        else {
          void manager.ensureWindow().then(window => window?.show())
        }
        return
      }
      const window = stageWindow as BrowserWindow
      if (!window.isDestroyed()) {
        toggleWindowShow(window)
      }
    },
    [TRAY_ACTIONS.resetPositions]: () => {
      // NOTICE (design doc §3.1): the old `ipcMain.emit` had no handler in the
      // ported tree. Fail loudly rather than pretending the positions reset.
      notImplemented('ipcMain.emit(reset-window-positions-action)')
    },
    [TRAY_ACTIONS.customizer]: () => void params.customizerWindow.toggleVisibility(),
    [TRAY_ACTIONS.onboarding]: () => void params.onboardingWindow.openWindow('/onboarding-v3'),
    [TRAY_ACTIONS.animadex]: () => void params.settingsWindow.openWindow('/settings/airi-card/guided').catch(err => console.error('[Tray] Failed to open AnimaDex wizard:', err)),
    [TRAY_ACTIONS.settings]: () => void params.settingsWindow.openWindow('/settings').catch(err => console.error('[Tray] Failed to open settings window:', err)),
    [TRAY_ACTIONS.about]: () => void params.aboutWindow().then(window => toggleWindowShow(window)),
    [TRAY_ACTIONS.devtools]: () => {
      // NOTICE: Electrobun has no per-window devtools toggle (`webContents` is
      // gone); remote debugging is configured through `chromiumFlags` instead.
      notImplemented('BrowserWindow.webContents.openDevTools')
    },
    [TRAY_ACTIONS.quit]: () => Utils.quit(),
  }

  appTray.on('tray-clicked', (event: unknown) => {
    const action = (event as { action?: string } | null)?.action
    if (!action)
      return
    const handler = actions[action]
    if (!handler)
      return
    try {
      handler()
    }
    catch (err) {
      console.error(`[Tray] Menu action ${action} failed:`, err)
    }
  })

  const rebuildContextMenu = debounce((): void => {
    if (!appTray.visible || !params.mainWindow)
      return

    appTray.setMenu([
      // NOTICE: desktop tray left-click → show main window has no Linux
      // equivalent (design doc §3.1), so the action lives in the menu.
      { label: 'Show Control Strip', action: TRAY_ACTIONS.showMain },
      { label: 'Toggle Chat', action: TRAY_ACTIONS.toggleChat },
      {
        label: 'Toggle Character Stage',
        // NOTICE: The stage is lazily managed (text-only companions have no
        // window). The action resolves or spawns it on demand.
        enabled: Boolean(params.stageWindow),
        action: TRAY_ACTIONS.toggleStage,
      },
      { label: 'Reset Window Positions', action: TRAY_ACTIONS.resetPositions },
      { type: 'separator' },
      { label: 'Control Strip Settings', action: TRAY_ACTIONS.customizer },
      { label: 'Companion Wizard', action: TRAY_ACTIONS.onboarding },
      { label: 'AnimaDex Wizard', action: TRAY_ACTIONS.animadex },
      { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.settings'), action: TRAY_ACTIONS.settings },
      { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.about'), action: TRAY_ACTIONS.about },
      { type: 'separator' },
      { label: 'Toggle Developer Tools', action: TRAY_ACTIONS.devtools },
      { type: 'separator' },
      { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.quit'), action: TRAY_ACTIONS.quit },
    ])
  }, 50)

  onAppBeforeQuit(() => {
    rebuildContextMenu.cancel()
    appTray.remove()
  })

  rebuildContextMenu()

  effect(() => {
    const locale = params.i18n.locale as (() => string | undefined)
    locale()
    rebuildContextMenu()
  })

  const appIcon = new AppIconVisibility(params.appConfig)
  const { context } = createContext(ipcMain as never)
  defineInvokeHandler(context, electronAppIconGet, () => appIcon.hidden)
  defineInvokeHandler(context, electronAppIconSet, async (payload) => {
    await appIcon.setHidden(Boolean(payload))
    return appIcon.hidden
  })

  appTray.setTitle('Project AIRI')
})

export function setupTray(params: SetupTrayParams): void {
  setupTrayOnce(params)
}
