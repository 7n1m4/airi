import type { BrowserWindow } from 'electron'

import type { RequestWindowPayload } from '../../../shared/eventa'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import { join, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { safeClose } from '@proj-airi/electron-vueuse/main'
import { BrowserWindow as ElectronBrowserWindow } from 'electron'

import { noticeWindowEventa } from '../../../shared/eventa'
import { APP_ICON as icon } from '../../assets'
import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electrobun/location'
import { openExternalSafely } from '../shared/open-external'
import { createReferencedWindowManager } from '../shared/referenced-window'

export interface NoticeWindowManager {
  open: (payload: RequestWindowPayload) => Promise<boolean>
}

export function setupNoticeWindowManager(params: {
  i18n: I18n
  serverChannel: ServerChannel
}): NoticeWindowManager {
  const rendererBase = baseUrl(resolve(getElectronMainDirname(), '..', 'renderer'))

  function createWindow(_id: string): BrowserWindow {
    const window = new ElectronBrowserWindow({
      title: 'AIRI — Notice',
      width: 1020,
      height: 600,
      show: false,
      icon,
      webPreferences: {
        preload: join(getElectronMainDirname(), '../preload/index.cjs'),
        sandbox: true,
      },
    })

    window.webContents.setWindowOpenHandler((details) => {
      openExternalSafely(details.url)
      return { action: 'deny' }
    })

    return window
  }

  async function loadNoticeRoute(window: BrowserWindow, payload: RequestWindowPayload & { id: string }) {
    const routeWithId = `${payload.route}?id=${payload.id}`
    await load(window, withHashRoute(rendererBase, routeWithId))
  }

  const manager = createReferencedWindowManager({
    eventa: noticeWindowEventa,
    i18n: params.i18n,
    serverChannel: params.serverChannel,
    createWindow,
    loadRoute: loadNoticeRoute,
  })

  return {
    open: async (payload: RequestWindowPayload) => {
      const handle = await manager.open(payload)
      return await new Promise<boolean>((resolve) => {
        defineInvokeHandler(handle.context, noticeWindowEventa.windowAction, (action) => {
          if (!action?.id || action.id !== handle.id)
            return
          resolve(action.action === 'confirm')
          safeClose(handle.window)
        })
      })
    },
  }
}
