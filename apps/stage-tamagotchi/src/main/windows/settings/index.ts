import type { BrowserWindow } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { AcpAgentsManager } from '../../services/airi/acp-agents'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { McpStdioManager } from '../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../services/electron/auto-updater'
import type { DevtoolsWindowManager } from '../devtools'
import type { WidgetsWindowManager } from '../widgets'

import { electronSettingsNavigate } from '../../../shared/eventa'
import { createPortedWindow } from '../shared/ported'
import { toggleWindowShow } from '../shared/window'
import { setupSettingsWindowInvokes } from './rpc'

export interface SettingsWindowManager {
  getWindow: () => Promise<BrowserWindow>
  openWindow: (route?: string) => Promise<void>
}

export function setupSettingsWindowReusableFunc(params: {
  widgetsManager: WidgetsWindowManager
  autoUpdater: AutoUpdater
  devtoolsMarkdownStressWindow: DevtoolsWindowManager
  onWindowCreated?: (window: BrowserWindow) => void
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  acpAgentsManager: AcpAgentsManager
  i18n: I18n
}): SettingsWindowManager {
  const defaultRoute = '/settings'
  let currentRoute = defaultRoute
  let current: Awaited<ReturnType<typeof createPortedWindow>> | undefined

  async function ensureWindow() {
    if (current && !current.isDestroyed())
      return current
    current = await createPortedWindow({
      tag: 'settings',
      title: 'AIRI — Settings',
      width: 600,
      height: 800,
      route: currentRoute,
      setupBase: { i18n: params.i18n, serverChannel: params.serverChannel },
    })
    params.onWindowCreated?.(current.window)
    await setupSettingsWindowInvokes({
      context: current.context,
      settingsWindow: current.window,
      widgetsManager: params.widgetsManager,
      autoUpdater: params.autoUpdater,
      devtoolsMarkdownStressWindow: params.devtoolsMarkdownStressWindow,
      serverChannel: params.serverChannel,
      mcpStdioManager: params.mcpStdioManager,
      acpAgentsManager: params.acpAgentsManager,
      i18n: params.i18n,
    })
    return current
  }

  return {
    getWindow: async () => (await ensureWindow()).window,
    openWindow: async (route) => {
      if (route)
        currentRoute = route
      const ported = await ensureWindow()
      if (route)
        ported.context.emit(electronSettingsNavigate, { route })
      if (!ported.facade.getURL().includes(`#${currentRoute}`))
        await ported.loadRoute(currentRoute)
      toggleWindowShow(ported.window)
    },
  }
}
