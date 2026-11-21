import type { BrowserWindow } from 'electron'

import type { globalAppConfigSchema } from '../../configs/global'
import type { Config } from '../../libs/electron/persistence'
import type { I18n } from '../../libs/i18n'
import type { AcpAgentsManager } from '../../services/airi/acp-agents'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { McpStdioManager } from '../../services/airi/mcp-servers'
import type { SettingsWindowManager } from '../settings'
import type { WidgetsWindowManager } from '../widgets'

import { throttle } from 'es-toolkit'

import { ensureWindowInVisibleBounds } from '../shared/display'
import { createPortedWindow } from '../shared/ported'
import { setupChatWindowElectronInvokes } from './rpc'

export interface ChatWindowManager {
  getWindow: () => Promise<BrowserWindow>
  openChat: (enabled?: boolean) => Promise<void>
  isVisible: () => boolean
  hasWindow: () => boolean
  getExistingWindow: () => BrowserWindow | undefined
}

export function setupChatWindowReusableFunc(params: {
  settingsWindow: SettingsWindowManager
  widgetsManager: WidgetsWindowManager
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  acpAgentsManager: AcpAgentsManager
  i18n: I18n
  appConfig: Config<typeof globalAppConfigSchema>
}): ChatWindowManager {
  let current: Awaited<ReturnType<typeof createPortedWindow>> | undefined

  const getConfig = () => params.appConfig.get() ?? { language: 'en', windows: [], microphoneToggleHotkey: 'Scroll' as const }
  const chatConfig = () => getConfig().windows?.find(w => w.title === 'AIRI' && w.tag === 'chat')

  function persistBounds() {
    if (!current || current.isDestroyed())
      return
    const bounds = current.facade.getBounds()
    const config = getConfig()
    const windows = Array.isArray(config.windows) ? config.windows : []
    const index = windows.findIndex(w => w.title === 'AIRI' && w.tag === 'chat')
    const entry = {
      ...(index === -1 ? { title: 'AIRI', tag: 'chat' } : windows[index]),
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    }
    if (index === -1)
      windows.push(entry)
    else
      windows[index] = entry
    params.appConfig.update({ ...config, windows })
  }

  const throttledPersist = throttle(persistBounds, 200)

  async function ensureWindow() {
    if (current && !current.isDestroyed())
      return current

    const saved = chatConfig()
    let width = saved?.width ?? 600
    let height = saved?.height ?? 800
    let x = saved?.x
    let y = saved?.y
    if (x !== undefined && y !== undefined && !Number.isNaN(x) && !Number.isNaN(y)) {
      const valid = ensureWindowInVisibleBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      })
      ;({ x, y, width, height } = valid)
    }

    current = await createPortedWindow({
      tag: 'chat',
      title: 'AIRI — Chat',
      width,
      height,
      x,
      y,
      route: '/chat',
      setupBase: { i18n: params.i18n, serverChannel: params.serverChannel },
    })
    current.facade.on('resize', () => throttledPersist())
    current.facade.on('move', () => throttledPersist())
    // NOTICE: the Electron listeners pushed `chat-window-state` to the Control Strip over a raw
    // webContents channel the renderer's eventa bridge cannot receive. The Control Strip now
    // reads the authoritative state via `electronGetChatWindowState`, registered in main/index.ts.
    await setupChatWindowElectronInvokes({
      context: current.context,
      window: current.window,
      settingsWindow: params.settingsWindow,
      widgetsManager: params.widgetsManager,
      serverChannel: params.serverChannel,
      mcpStdioManager: params.mcpStdioManager,
      acpAgentsManager: params.acpAgentsManager,
      i18n: params.i18n,
    })
    return current
  }

  async function openChat(enabled?: boolean) {
    if (enabled === false) {
      current?.close()
      return
    }
    const ported = await ensureWindow()
    ported.facade.show()
    ported.facade.focus()
  }

  return {
    getWindow: async () => (await ensureWindow()).window,
    openChat,
    isVisible: () => Boolean(current && !current.isDestroyed() && current.facade.isVisible()),
    hasWindow: () => Boolean(current && !current.isDestroyed()),
    getExistingWindow: () => (current && !current.isDestroyed() ? current.window : undefined),
  }
}
