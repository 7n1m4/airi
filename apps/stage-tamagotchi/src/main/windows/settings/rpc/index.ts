import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { AnyEventaContext } from '../../../rpc'
import type { AcpAgentsManager } from '../../../services/airi/acp-agents'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../../services/electron/auto-updater'
import type { DevtoolsWindowManager } from '../../devtools'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronOpenDevtoolsWindow, electronOpenSettingsDevtools } from '../../../../shared/eventa'
import { createAcpAgentsService } from '../../../services/airi/acp-agents'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createWidgetsService } from '../../../services/airi/widgets'
import { createAutoUpdaterService } from '../../../services/electron'

/**
 * Settings' own eventa surface, bound to its view context.
 *
 * The base window services (screen/window/app/i18n/sensors) are registered by
 * `createPortedWindow`; only the Settings-specific invokes live here.
 */
export async function setupSettingsWindowInvokes(params: {
  context: AnyEventaContext
  settingsWindow: BrowserWindow
  widgetsManager: WidgetsWindowManager
  autoUpdater: AutoUpdater
  devtoolsMarkdownStressWindow: DevtoolsWindowManager
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  acpAgentsManager: AcpAgentsManager
  i18n: I18n
}) {
  createWidgetsService({
    context: params.context,
    widgetsManager: params.widgetsManager,
    window: params.settingsWindow,
  })
  try {
    createAutoUpdaterService({
      context: params.context,
      window: params.settingsWindow,
      service: params.autoUpdater,
    })
  }
  catch (error) {
    console.warn('[Settings] Auto-updater service unavailable:', error instanceof Error ? error.message : error)
  }
  createMcpServersService({ context: params.context, manager: params.mcpStdioManager })
  createAcpAgentsService({ context: params.context, manager: params.acpAgentsManager })

  defineInvokeHandler(params.context, electronOpenSettingsDevtools, async () => {
    params.settingsWindow.webContents.openDevTools({ mode: 'detach' })
  })
  defineInvokeHandler(params.context, electronOpenDevtoolsWindow, async (payload) => {
    await params.devtoolsMarkdownStressWindow.openWindow(payload?.route)
  })

  return params.context
}
