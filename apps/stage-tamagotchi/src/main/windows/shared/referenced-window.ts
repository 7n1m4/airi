import type { BrowserWindow } from 'electron'

import type { createRequestWindowEventa, RequestWindowPayload } from '../../../shared/eventa'
import type { I18n } from '../../libs/i18n'
import type { AnyEventaContext } from '../../rpc'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { PortedWindow } from './ported'

import { defineInvokeHandler } from '@moeru/eventa'

import { setupBaseWindowElectronInvokes } from './window'

export interface ReferencedWindowHandle {
  id: string
  window: BrowserWindow
  context: AnyEventaContext
  eventa: ReturnType<typeof createRequestWindowEventa>
}

export interface ReferencedWindowManager<Payload extends RequestWindowPayload = RequestWindowPayload> {
  open: (payload: Payload & { id?: string }) => Promise<ReferencedWindowHandle>
  close: (id: string) => void
}

/**
 * Per-id window manager for notice-like surfaces.
 *
 * Ported to Electrobun: the window and its eventa context are created together by
 * `createPortedWindow`, so each id gets its own view-bound context instead of sharing the
 * flat Electron `ipcMain` namespace.
 */
export function createReferencedWindowManager<Payload extends RequestWindowPayload = RequestWindowPayload>(params: {
  eventa: ReturnType<typeof createRequestWindowEventa>
  i18n: I18n
  serverChannel: ServerChannel
  createWindow: (id: string) => Promise<PortedWindow>
  loadRoute: (ported: PortedWindow, payload: Payload & { id: string }) => Promise<void>
}): ReferencedWindowManager<Payload> {
  const windows = new Map<string, { ported: PortedWindow, context: AnyEventaContext }>()

  async function bindContext(id: string, payload: Payload, ported: PortedWindow) {
    const { context } = ported

    defineInvokeHandler(context, params.eventa.pageMounted, (req) => {
      if (req?.id && req.id !== id)
        return undefined
      return { id, type: payload.type, payload: payload.payload }
    })

    defineInvokeHandler(context, params.eventa.pageUnmounted, (req) => {
      if (req?.id && req.id !== id)
        return
      windows.delete(id)
    })

    await setupBaseWindowElectronInvokes({
      context,
      window: ported.window,
      i18n: params.i18n,
      serverChannel: params.serverChannel,
    })

    // NOTICE: the native layer emits `close-<id>`, so the event name is `close`
    // (Electron's `closed`). Listening for `closed` here silently leaked the map entry.
    ported.native.on('close', () => windows.delete(id))

    return { ported, context }
  }

  async function open(payload: Payload & { id?: string }): Promise<ReferencedWindowHandle> {
    const id = payload.id ?? Math.random().toString(36).slice(2, 10)
    let ctx = windows.get(id)

    if (!ctx || ctx.ported.isDestroyed()) {
      const ported = await params.createWindow(id)
      ctx = await bindContext(id, payload, ported)
      windows.set(id, ctx)
    }

    try {
      await params.loadRoute(ctx.ported, { ...payload, id })
      ctx.ported.facade.show()
      ctx.ported.facade.focus()
    }
    catch (error) {
      const wrapped = error ?? new Error('Failed to open referenced window')
      console.error('[referenced-window] open failed', wrapped)
      throw wrapped
    }

    return { id, window: ctx.ported.window, context: ctx.context, eventa: params.eventa }
  }

  function close(id: string) {
    const ctx = windows.get(id)
    if (!ctx)
      return
    ctx.ported.close()
    windows.delete(id)
  }

  return { open, close }
}
