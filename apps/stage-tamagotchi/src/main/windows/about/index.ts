import type { BrowserWindow } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { AutoUpdater } from '../../services/electron/auto-updater'

import { createAutoUpdaterService } from '../../services/electron'
import { createPortedWindow } from '../shared/ported'

/**
 * About is a normal hash route with the shared base services. The auto-updater service is a
 * wave-4 stub that raises `ElectrobunPortError`, so its registration is best-effort — the
 * window itself must still open and render (docs/design-electrobun-port.md §3.1).
 */
export function setupAboutWindowReusable(params: {
  autoUpdater: AutoUpdater
  i18n: I18n
  serverChannel: ServerChannel
}): () => Promise<BrowserWindow> {
  let current: Awaited<ReturnType<typeof createPortedWindow>> | undefined

  return async () => {
    if (current && !current.isDestroyed())
      return current.window
    current = await createPortedWindow({
      tag: 'about',
      title: 'AIRI — About',
      width: 670,
      height: 730,
      route: '/about',
      setupBase: { i18n: params.i18n, serverChannel: params.serverChannel },
    })
    try {
      createAutoUpdaterService({
        context: current.context,
        window: current.window,
        service: params.autoUpdater,
      })
    }
    catch (error) {
      console.warn('[About] Auto-updater service unavailable:', error instanceof Error ? error.message : error)
    }
    current.facade.show()
    return current.window
  }
}
