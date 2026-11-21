import type { RequestWindowPayload } from '../../../shared/eventa'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import { defineInvokeHandler } from '@moeru/eventa'

import { noticeWindowEventa } from '../../../shared/eventa'
import { createPortedWindow } from '../shared/ported'
import { createReferencedWindowManager } from '../shared/referenced-window'

export interface NoticeWindowManager {
  open: (payload: RequestWindowPayload) => Promise<boolean>
}

export function setupNoticeWindowManager(params: {
  i18n: I18n
  serverChannel: ServerChannel
}): NoticeWindowManager {
  const manager = createReferencedWindowManager({
    eventa: noticeWindowEventa,
    i18n: params.i18n,
    serverChannel: params.serverChannel,
    createWindow: async () => createPortedWindow({
      tag: 'notice',
      title: 'AIRI — Notice',
      width: 1020,
      height: 600,
      transparent: true,
    }),
    loadRoute: async (ported, payload) => {
      await ported.loadRoute(`${payload.route}?id=${payload.id}`)
    },
  })

  return {
    open: async (payload: RequestWindowPayload) => {
      const handle = await manager.open(payload)
      return await new Promise<boolean>((resolve) => {
        defineInvokeHandler(handle.context, noticeWindowEventa.windowAction, (action) => {
          if (!action?.id || action.id !== handle.id)
            return
          resolve(action.action === 'confirm')
          manager.close(handle.id)
        })
      })
    },
  }
}
