import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { AnyEventaContext } from '../../../rpc'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { WidgetsWindowManager } from '../index'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronOpenMainDevtools } from '../../../../shared/eventa'
import { createWidgetsService } from '../../../services/airi/widgets'

/** Widgets' own eventa surface, bound to the widgets view's context. */
export async function setupWidgetsWindowInvokes(params: {
  widgetWindow: BrowserWindow
  context: AnyEventaContext
  widgetsManager: WidgetsWindowManager
  i18n: I18n
  serverChannel: ServerChannel
}) {
  createWidgetsService({
    context: params.context,
    widgetsManager: params.widgetsManager,
    window: params.widgetWindow,
  })

  defineInvokeHandler(params.context, electronOpenMainDevtools, () => {
    params.widgetWindow.webContents.openDevTools({ mode: 'detach' })
  })

  return { context: params.context }
}
