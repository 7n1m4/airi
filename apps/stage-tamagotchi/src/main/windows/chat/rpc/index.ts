import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { AnyEventaContext } from '../../../rpc'
import type { AcpAgentsManager } from '../../../services/airi/acp-agents'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { SettingsWindowManager } from '../../settings'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronOpenMainDevtools, electronOpenSettings } from '../../../../shared/eventa'
import { createAcpAgentsService } from '../../../services/airi/acp-agents'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createWidgetsService } from '../../../services/airi/widgets'

/** Chat's own eventa surface, bound to the chat view's context. */
export async function setupChatWindowElectronInvokes(params: {
  window: BrowserWindow
  context: AnyEventaContext
  settingsWindow: SettingsWindowManager
  widgetsManager: WidgetsWindowManager
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  acpAgentsManager: AcpAgentsManager
  i18n: I18n
}) {
  createWidgetsService({
    context: params.context,
    widgetsManager: params.widgetsManager,
    window: params.window,
  })
  createMcpServersService({ context: params.context, manager: params.mcpStdioManager })
  createAcpAgentsService({ context: params.context, manager: params.acpAgentsManager })

  defineInvokeHandler(params.context, electronOpenSettings, async payload => params.settingsWindow.openWindow(payload?.route))
  defineInvokeHandler(params.context, electronOpenMainDevtools, () => {
    params.window.webContents.openDevTools({ mode: 'detach' })
  })
}
