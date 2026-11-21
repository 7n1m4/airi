import type { Rectangle } from 'electrobun/main'
import type { BrowserWindow } from 'electron'
import type { InferOutput } from 'valibot'

import type { WidgetsAddPayload, WidgetSnapshot } from '../../../shared/eventa'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import { number, object, optional } from 'valibot'

import { widgetsClearEvent, widgetsRemoveEvent, widgetsRenderEvent, widgetsUpdateEvent } from '../../../shared/eventa'
import { createConfig } from '../../libs/electron/persistence'
import { setupArtistryBridge } from '../../services/airi/widgets/artistry-bridge'
import { displayMatching } from '../shared/display'
import { createPortedWindow } from '../shared/ported'
import { setupWidgetsWindowInvokes } from './rpc'

export interface WidgetsWindowManager {
  getWindow: () => Promise<BrowserWindow>
  openWindow: (params?: { id?: string }) => Promise<void>
  hideWindow: (params?: { id?: string }) => Promise<void>
  pushWidget: (payload: WidgetsAddPayload) => Promise<string>
  updateWidget: (payload: { id: string, componentProps?: Record<string, any> }) => Promise<void>
  removeWidget: (id: string) => Promise<void>
  clearWidgets: () => Promise<void>
  getWidgetSnapshot: (id: string) => WidgetSnapshot | undefined
  prepareWidgetWindow: (options?: { id?: string }) => string
  resizeWidgetWindow: (payload: { id?: string, width?: number, height?: number, window?: BrowserWindow }) => Promise<void>
  emit: (event: any, payload: any) => void
}

const widgetsWindowConfigSchema = object({
  bounds: optional(object({
    x: number(),
    y: number(),
    width: number(),
    height: number(),
  })),
})

type WidgetsWindowConfig = InferOutput<typeof widgetsWindowConfigSchema>

function workArea(): Rectangle {
  return displayMatching({ x: 0, y: 0, width: 0, height: 0 }).workArea
}

function computeDefaultBounds(): Rectangle {
  const primary = workArea()
  const width = Math.min(500, Math.floor(primary.width * 0.35))
  const height = Math.min(500, Math.floor(primary.height * 0.6))
  return {
    x: primary.x + primary.width - width - 16,
    y: primary.y + 16,
    width,
    height,
  }
}

function computeStickerBounds(weight?: number, pos?: string): Rectangle {
  const primary = workArea()
  const clampedWeight = Math.max(0.1, Math.min(1.0, typeof weight === 'number' && !Number.isNaN(weight) ? weight : 0.5))
  const size = Math.round(160 + (clampedWeight - 0.1) * (140 / 0.9))
  const jitterX = Math.round((Math.random() - 0.5) * 40)
  const jitterY = Math.round((Math.random() - 0.5) * 40)
  const margin = 36
  const validPositions = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']
  const targetPos = (!pos || pos === 'random' || !validPositions.includes(pos))
    ? validPositions[Math.floor(Math.random() * validPositions.length)]
    : pos

  let x: number
  let y: number
  switch (targetPos) {
    case 'topLeft':
      x = primary.x + margin + jitterX
      y = primary.y + margin + jitterY
      break
    case 'topRight':
      x = primary.x + primary.width - size - margin + jitterX
      y = primary.y + margin + jitterY
      break
    case 'bottomLeft':
      x = primary.x + margin + jitterX
      y = primary.y + primary.height - size - margin + jitterY
      break
    case 'bottomRight':
    default:
      x = primary.x + primary.width - size - margin + jitterX
      y = primary.y + primary.height - size - margin + jitterY
      break
  }

  return {
    x: Math.max(primary.x, Math.min(x, primary.x + primary.width - size)),
    y: Math.max(primary.y, Math.min(y, primary.y + primary.height - size)),
    width: size,
    height: size,
  }
}

interface WidgetRecord extends WidgetSnapshot {
  timer?: ReturnType<typeof setTimeout>
}

interface WidgetWindowContext {
  widgetId: string
  windowBuilder: () => Promise<BrowserWindow>
  window?: BrowserWindow
}

type PortedWindow = Awaited<ReturnType<typeof createPortedWindow>>

export function setupWidgetsWindowManager(params: {
  serverChannel: ServerChannel
  i18n: I18n
}): WidgetsWindowManager {
  const { setup, get: getConfigRaw, update } = createConfig('windows-widgets', 'config.json', widgetsWindowConfigSchema, {
    default: {},
    autoHeal: true,
  })
  const getConfig = (): WidgetsWindowConfig => getConfigRaw() ?? {}
  setup()

  let current: PortedWindow | undefined
  const widgetRecords = new Map<string, WidgetRecord>()
  const windowContexts = new Map<string, WidgetWindowContext>()
  const standaloneWindows = new Map<string, PortedWindow>()

  const defaultRoute = '/widgets'
  let pendingRoute: string | undefined
  let currentRoute: string | undefined
  let widgetsManager: WidgetsWindowManager | undefined

  async function ensureWindow() {
    if (current && !current.isDestroyed())
      return current
    const saved = getConfig().bounds
    const bounds = saved
      ? {
          x: Math.min(Math.max(saved.x, 0), Math.max(0, 1920 - saved.width)),
          y: Math.min(Math.max(saved.y, 0), Math.max(0, 1080 - saved.height)),
          width: Math.min(saved.width, 1920),
          height: Math.min(saved.height, 1080),
        }
      : computeDefaultBounds()
    current = await createPortedWindow({
      tag: 'widgets',
      title: 'AIRI — Widgets',
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      transparent: true,
      alwaysOnTop: true,
      route: pendingRoute ?? defaultRoute,
      setupBase: { i18n: params.i18n, serverChannel: params.serverChannel },
    })
    currentRoute = pendingRoute ?? defaultRoute
    pendingRoute = undefined

    const persist = () => {
      if (!current?.isDestroyed())
        update({ bounds: current!.facade.getBounds() })
    }
    current.facade.on('resize', () => persist())
    current.facade.on('move', () => persist())
    current.native.on('close', () => {
      currentRoute = undefined
      for (const context of windowContexts.values()) {
        if (context.window === current?.window)
          context.window = undefined
      }
    })

    await setupWidgetsWindowInvokes({
      widgetWindow: current.window,
      context: current.context,
      widgetsManager: widgetsManager!,
      i18n: params.i18n,
      serverChannel: params.serverChannel,
    })
    return current
  }

  function prepareWidgetWindow(options?: { id?: string }): string {
    const id = options?.id ?? Math.random().toString(36).slice(2, 10)
    if (!windowContexts.has(id)) {
      windowContexts.set(id, {
        widgetId: id,
        windowBuilder: () => getWindow(),
        window: undefined,
      })
    }
    return id
  }

  function toSnapshot(record: WidgetRecord): WidgetSnapshot {
    const { timer: _timer, ...snapshot } = record
    return snapshot
  }

  function upsertRecord(snapshot: WidgetSnapshot) {
    const existing = widgetRecords.get(snapshot.id)
    if (existing?.timer)
      clearTimeout(existing.timer)
    const record: WidgetRecord = { ...snapshot }
    if (snapshot.ttlMs > 0)
      record.timer = setTimeout(() => removeWidgetInternal(snapshot.id), snapshot.ttlMs)
    widgetRecords.set(snapshot.id, record)
  }

  function removeWidgetInternal(id: string, emitEvent = true) {
    const existing = widgetRecords.get(id)
    if (!existing)
      return
    if (existing.timer)
      clearTimeout(existing.timer)
    widgetRecords.delete(id)
    windowContexts.delete(id)
    const standalone = standaloneWindows.get(id)
    if (standalone && !standalone.isDestroyed())
      standalone.close()
    standaloneWindows.delete(id)
    if (emitEvent)
      current?.context.emit(widgetsRemoveEvent, { id })
  }

  async function getWindowFromContext(context?: WidgetWindowContext): Promise<BrowserWindow> {
    if (!context)
      return (await ensureWindow()).window
    if (context.window && !context.window.isDestroyed())
      return context.window
    const resolved = await context.windowBuilder()
    context.window = resolved
    return resolved
  }

  async function showWindowWithRoute(route: string, context?: WidgetWindowContext) {
    pendingRoute = route
    const window = await getWindowFromContext(context)
    pendingRoute = undefined
    const ported = current!
    if (currentRoute !== route)
      await ported.loadRoute(route)
    currentRoute = route
    ported.facade.showInactive()
    if (context)
      context.window = window
    return ported
  }

  async function getWindow(): Promise<BrowserWindow> {
    return (await ensureWindow()).window
  }

  async function openWindow(params?: { id?: string }) {
    const id = params?.id ? prepareWidgetWindow({ id: params.id }) : undefined
    const route = id ? `${defaultRoute}?id=${id}` : defaultRoute
    await showWindowWithRoute(route, id ? windowContexts.get(id) : undefined)
  }

  async function hideWindow(params?: { id?: string }) {
    const id = params?.id
    const context = id ? windowContexts.get(id) : undefined
    if (context?.window) {
      const standalone = [...standaloneWindows.values()].find(win => win.window === context.window)
      standalone?.close()
      context.window = undefined
      return
    }
    current?.close()
  }

  async function pushWidget(payload: WidgetsAddPayload): Promise<string> {
    const id = prepareWidgetWindow({ id: payload.id })
    const snapshot: WidgetSnapshot = {
      id,
      componentName: payload.componentName,
      componentProps: payload.componentProps ?? {},
      size: payload.size ?? 'm',
      ttlMs: payload.ttlMs ?? 0,
    }
    upsertRecord(snapshot)
    const context = windowContexts.get(id)
    const isSticker = payload.componentName === 'sticker'
    let ported: PortedWindow

    if (isSticker) {
      const bounds = payload.bounds
        ? {
            x: payload.bounds.x ?? 0,
            y: payload.bounds.y ?? 0,
            width: payload.bounds.width ?? 220,
            height: payload.bounds.height ?? 220,
          }
        : computeStickerBounds(payload.componentProps?.weight, payload.componentProps?.pos)
      ported = await createPortedWindow({
        tag: `widget-sticker-${id}`,
        title: 'AIRI — Sticker',
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        transparent: true,
        alwaysOnTop: true,
        passthrough: true,
      })
      standaloneWindows.set(id, ported)
      ported.native.on('close', () => {
        standaloneWindows.delete(id)
        removeWidgetInternal(id, true)
      })
      const query = new URLSearchParams({
        id,
        stickerId: String(payload.componentProps?.stickerId || 'airi-happy'),
        src: String(payload.componentProps?.src || ''),
        weight: String(payload.componentProps?.weight ?? 0.5),
        ttlMs: String(payload.ttlMs ?? 0),
        pos: String(payload.componentProps?.pos || 'random'),
      })
      await ported.loadRoute(`${defaultRoute}?${query}`)
      ported.facade.showInactive()
      if (context)
        context.window = ported.window
    }
    else {
      ported = await showWindowWithRoute(`${defaultRoute}?id=${id}`, context)
    }

    if (payload.bounds && !isSticker) {
      ported.facade.setBounds({
        x: payload.bounds.x ?? ported.facade.getBounds().x,
        y: payload.bounds.y ?? ported.facade.getBounds().y,
        width: payload.bounds.width ?? ported.facade.getBounds().width,
        height: payload.bounds.height ?? ported.facade.getBounds().height,
      })
    }
    current?.context.emit(widgetsRenderEvent, snapshot)
    return id
  }

  async function updateWidget(payload: { id: string, componentProps?: Record<string, any> }) {
    if (!payload?.id)
      return
    const existing = widgetRecords.get(payload.id)
    if (!existing)
      return
    const nextSnapshot: WidgetSnapshot = {
      ...toSnapshot(existing),
      componentProps: payload.componentProps
        ? { ...existing.componentProps, ...payload.componentProps }
        : existing.componentProps,
    }
    upsertRecord(nextSnapshot)
    current?.context.emit(widgetsUpdateEvent, { id: nextSnapshot.id, componentProps: nextSnapshot.componentProps })
  }

  async function removeWidget(id: string) {
    if (!id)
      return
    removeWidgetInternal(id, false)
    current?.context.emit(widgetsRemoveEvent, { id })
  }

  async function clearWidgets() {
    for (const id of [...widgetRecords.keys()])
      removeWidgetInternal(id, false)
    current?.context.emit(widgetsClearEvent, undefined)
    windowContexts.clear()
  }

  function getWidgetSnapshot(id: string) {
    const record = widgetRecords.get(id)
    return record ? toSnapshot(record) : undefined
  }

  function emit(event: any, payload: any) {
    current?.context.emit(event, payload)
  }

  async function resizeWidgetWindow(payload: { id?: string, width?: number, height?: number, window?: BrowserWindow }) {
    let target: PortedWindow | undefined
    if (payload.window) {
      target = [current, ...standaloneWindows.values()].find(win => win && win.window === payload.window)
    }
    if (!target && payload.id)
      target = standaloneWindows.get(payload.id)
    if (!target)
      target = await ensureWindow()
    if (!target || target.isDestroyed())
      return

    const bounds = target.facade.getBounds()
    const workArea = displayMatching(bounds).workArea
    const clampedWidth = Math.min(Math.max(160, payload.width ?? bounds.width), workArea.width)
    const clampedHeight = Math.min(Math.max(80, payload.height ?? bounds.height), workArea.height)
    if (bounds.width !== clampedWidth || bounds.height !== clampedHeight) {
      target.facade.setBounds({ x: bounds.x, y: bounds.y, width: clampedWidth, height: clampedHeight })
    }
  }

  widgetsManager = {
    getWindow,
    openWindow,
    hideWindow,
    pushWidget,
    updateWidget,
    removeWidget,
    clearWidgets,
    getWidgetSnapshot,
    prepareWidgetWindow,
    resizeWidgetWindow,
    emit,
  }

  // Initialize Artistry Bridge (handles ComfyUI + Replicate image generation)
  setupArtistryBridge({ widgetsManager })

  return widgetsManager
}
