import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { AutoUpdater } from '../../services/electron/auto-updater'

import { join, resolve } from 'node:path'

import { BrowserWindow } from 'electron'

import { APP_ICON as icon } from '../../assets'
import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electrobun/location'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { openExternalSafely } from '../shared/open-external'
import { setupAboutWindowElectronInvokes } from './rpc/index.electron'

export function setupAboutWindowReusable(params: {
  autoUpdater: AutoUpdater
  i18n: I18n
  serverChannel: ServerChannel
}) {
  return createReusableWindow(async () => {
    const window = new BrowserWindow({
      title: 'AIRI — About',
      width: 670,
      height: 730,
      show: false,
      resizable: true,
      maximizable: false,
      minimizable: false,
      icon,
      webPreferences: {
        preload: join(getElectronMainDirname(), '../preload/index.cjs'),
        sandbox: true,
      },
    })

    window.on('ready-to-show', () => window.show())
    window.webContents.setWindowOpenHandler((details) => {
      openExternalSafely(details.url)
      return { action: 'deny' }
    })

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/about'))

    await setupAboutWindowElectronInvokes({
      window,
      autoUpdater: params.autoUpdater,
      i18n: params.i18n,
      serverChannel: params.serverChannel,
    })

    return window
  }).getWindow
}
