import type { BrowserWindow } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronCustomizerToggleVisibility, electronGetCustomizerWindowState } from '../../../shared/eventa'
import { get } from '../registry'
import { showWindowOnAllWorkspaces } from '../shared/app-icon'
import { requireRpcBootstrap } from '../shared/create-window'
import { createPortedWindow } from '../shared/ported'

export interface CustomizerWindowManager {
  getWindow: () => Promise<BrowserWindow>
  isVisible: () => boolean
  toggleVisibility: (payload?: boolean | { enabled?: boolean, group?: string }) => Promise<void>
  onVisibilityChanged: (listener: () => void) => () => void
}

export function setupCustomizerWindowManager(params: {
  mainWindow: BrowserWindow
  serverChannel: ServerChannel
  i18n: I18n
}): CustomizerWindowManager {
  void params.mainWindow
  let current: Awaited<ReturnType<typeof createPortedWindow>> | undefined
  const visibilityListeners = new Set<() => void>()

  const emitVisibilityChanged = () => {
    for (const listener of visibilityListeners) {
      try {
        listener()
      }
      catch {}
    }
  }

  async function ensureWindow() {
    await bindMainHandlers()
    if (current && !current.isDestroyed())
      return current
    current = await createPortedWindow({
      tag: 'customizer',
      title: 'AIRI — Customizer',
      width: 780,
      height: 620,
      route: '/customizer',
      transparent: true,
      alwaysOnTop: true,
      setupBase: { i18n: params.i18n, serverChannel: params.serverChannel },
    })
    // Electrobun's `setAlwaysOnTop(true)` has no macOS screen-saver level; creation order and
    // this flag are the closest equivalent (docs/design-electrobun-port.md §1.2).
    showWindowOnAllWorkspaces(current.native)
    current.facade.on('show', emitVisibilityChanged)
    current.facade.on('hide', emitVisibilityChanged)
    current.facade.on('close', emitVisibilityChanged)
    return current
  }

  function isVisible(): boolean {
    return Boolean(current && !current.isDestroyed() && current.facade.isVisible())
  }

  async function toggleVisibility(payload?: boolean | { enabled?: boolean, group?: string }) {
    const enabled = typeof payload === 'object' ? payload.enabled : payload
    const group = typeof payload === 'object' ? payload.group : undefined

    if (enabled === false || (enabled === undefined && isVisible())) {
      current?.facade.hide()
      emitVisibilityChanged()
      return
    }

    const ported = await ensureWindow()
    ported.facade.show()
    ported.facade.focus()
    emitVisibilityChanged()

    // NOTICE: the renderer's `set-customizer-group` listener is a raw ipcRenderer channel.
    // The Electrobun bridge only carries eventa frames, so this dispatch has no transport yet;
    // group selection is otherwise driven by the renderer's own state. See wave-4 gap list.
    void group
  }

  // The Control Strip is built after this manager in the DI graph, so bind its two
  // visibility invokes lazily, on the first call (or once its view is registered).
  let mainHandlersBound = false
  let bindAttempts = 0
  async function bindMainHandlers() {
    if (mainHandlersBound)
      return
    const mainView = get('main')?.webview
    if (!mainView) {
      // The Control Strip is provided later in the DI graph; retry briefly instead of
      // leaving `electronGetCustomizerWindowState` invokes parked with no handler.
      if (bindAttempts++ < 20)
        setTimeout(() => void bindMainHandlers().catch(() => {}), 500)
      return
    }
    mainHandlersBound = true
    const mainContext = await requireRpcBootstrap().contextFor(mainView)
    defineInvokeHandler(mainContext, electronCustomizerToggleVisibility, async payload => toggleVisibility(payload))
    defineInvokeHandler(mainContext, electronGetCustomizerWindowState, async () => isVisible())
  }
  void bindMainHandlers().catch(err => console.warn('[Customizer] Failed to bind Control Strip invokes:', err))

  return {
    getWindow: async () => (await ensureWindow()).window,
    isVisible,
    toggleVisibility,
    onVisibilityChanged: (listener) => {
      visibilityListeners.add(listener)
      return () => {
        visibilityListeners.delete(listener)
      }
    },
  }
}
