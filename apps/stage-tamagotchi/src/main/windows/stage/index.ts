import type { Buffer } from 'node:buffer'

import type { Rectangle } from 'electrobun/main'
import type { BrowserWindow } from 'electron'

import type { globalAppConfigSchema } from '../../configs/global'
import type { Config } from '../../libs/electron/persistence'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import process from 'node:process'

import { throttle } from 'es-toolkit'

import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { ensureWindowInVisibleBounds } from '../shared/display'
import { createPortedWindow } from '../shared/ported'

let isStageVisible = true

export function isStageDisabledByFlag(): boolean {
  return process.argv.includes('--disable-webgl-stage') || process.env.AIRI_DISABLE_WEBGL_STAGE === 'true'
}

export function setStageVisibleState(visible: boolean) {
  isStageVisible = visible
}

export function getStageVisibleState(): boolean {
  return isStageVisible
}

export type StageLifecycleEvent = 'show' | 'hide' | 'minimize' | 'restore'

export interface ActorStageWindowManager {
  ensureWindow: () => Promise<BrowserWindow | null>
  hasWindow: () => boolean
  getExistingWindow: () => BrowserWindow | undefined
  isDestroyed: () => boolean
  isVisible: () => boolean
  show: () => void
  hide: () => void
  showInactive: () => void
  setAlwaysOnTop: (flag: boolean, level?: string, relativeLevel?: number) => void
  setBounds: (bounds: Rectangle) => void
  getBounds: () => Rectangle | undefined
  on: (event: 'move' | 'resize', listener: () => void) => () => void
  removeListener: (event: 'move' | 'resize', listener: () => void) => void
  onWindowCreated: (listener: (window: BrowserWindow) => void) => () => void
  onLifecycle: (event: StageLifecycleEvent, listener: () => void) => () => void
  /** Wave-4 gap: `webContents.capturePage()` has no CEF equivalent; use `Screen.captureRegion`. */
  capturePage: () => Promise<Buffer | null>
  destroy: () => void
}

export function setupActorStageWindowManager(params: {
  appConfig: Config<typeof globalAppConfigSchema>
  serverChannel: ServerChannel
  i18n: I18n
}): ActorStageWindowManager {
  const getConfig = () => params.appConfig.get() ?? { language: 'en', windows: [], microphoneToggleHotkey: 'Scroll' as const }
  let current: Awaited<ReturnType<typeof createPortedWindow>> | undefined
  let inFlight: Promise<BrowserWindow | null> | null = null
  const createdListeners = new Set<(window: BrowserWindow) => void>()
  const lifecycleListeners: Record<StageLifecycleEvent, Set<() => void>> = {
    show: new Set(),
    hide: new Set(),
    minimize: new Set(),
    restore: new Set(),
  }
  const nativeListeners = new Map<'move' | 'resize', Set<() => void>>([
    ['move', new Set()],
    ['resize', new Set()],
  ])

  function emitLifecycle(event: StageLifecycleEvent) {
    for (const listener of lifecycleListeners[event]) {
      try {
        listener()
      }
      catch {}
    }
  }

  function handleNewBounds(bounds: Rectangle) {
    if (current?.isDestroyed() || (current?.facade as any).__is_programmatic_resize)
      return
    const config = getConfig()
    const windows = Array.isArray(config.windows) ? config.windows : []
    const entry = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    }
    const index = windows.findIndex(w => w.title === 'AIRI' && w.tag === 'actor')
    if (index === -1)
      windows.push({ title: 'AIRI', tag: 'actor', ...entry })
    else
      windows[index] = { ...windows[index], ...entry }
    if ((current?.facade as any).__is_dating_sim_active) {
      const dsIndex = windows.findIndex(w => w.title === 'AIRI' && w.tag === 'actor-dating-sim')
      if (dsIndex === -1)
        windows.push({ title: 'AIRI', tag: 'actor-dating-sim', ...entry })
      else
        windows[index] = { ...windows[dsIndex], ...entry }
    }
    params.appConfig.update({ ...config, windows })
  }

  async function createStageWindow(): Promise<BrowserWindow> {
    const actorConfig = getConfig().windows?.find(w => w.title === 'AIRI' && w.tag === 'actor')
    let width = actorConfig?.width ?? 450
    let height = actorConfig?.height ?? 600
    let x = actorConfig?.x
    let y = actorConfig?.y
    if (x !== undefined && y !== undefined && !Number.isNaN(x) && !Number.isNaN(y)) {
      const valid = ensureWindowInVisibleBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) })
      ;({ x, y, width, height } = valid)
    }

    current = await createPortedWindow({
      tag: 'stage',
      title: 'AIRI - Actor Stage',
      width,
      height,
      x,
      y,
      route: '/actor',
      transparent: true,
      alwaysOnTop: true,
      setupBase: { i18n: params.i18n, serverChannel: params.serverChannel },
    })
    const facade = current.facade

    const throttledPersist = throttle((bounds: Rectangle) => handleNewBounds(bounds), 200)
    const onGeometry = () => {
      if (!current?.isDestroyed())
        throttledPersist(facade.getBounds())
    }
    facade.on('move', onGeometry)
    facade.on('resize', onGeometry)
    // Caption's position-follow subscribes through `ActorStageWindowManager.on()`; forward
    // the native geometry events to those listeners (Electrobun has no `removeListener`, so
    // the manager keeps its own listener sets and never detaches from the facade).
    facade.on('move', () => {
      for (const listener of nativeListeners.get('move')!)
        listener()
    })
    facade.on('resize', () => {
      for (const listener of nativeListeners.get('resize')!)
        listener()
    })

    facade.on('show', () => {
      isStageVisible = true
      emitLifecycle('show')
    })
    facade.on('hide', () => {
      isStageVisible = false
      emitLifecycle('hide')
    })
    facade.on('minimize', () => emitLifecycle('minimize'))
    facade.on('restore', () => emitLifecycle('restore'))
    facade.on('close', () => {
      current = undefined
    })

    onAppBeforeQuit(() => {
      throttledPersist.cancel()
    })

    // The renderer uses `-webkit-app-region: drag`; the old native drag invoke and the
    // `stage-window-set-bounds` raw ipcMain channel have no Electrobun counterpart.
    for (const listener of createdListeners) {
      try {
        listener(current.window)
      }
      catch {}
    }
    return current.window
  }

  async function ensureWindow(): Promise<BrowserWindow | null> {
    if (isStageDisabledByFlag())
      return null
    if (current && !current.isDestroyed())
      return current.window
    if (inFlight)
      return inFlight
    inFlight = createStageWindow().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    ensureWindow,
    hasWindow: () => Boolean(current && !current.isDestroyed()),
    getExistingWindow: () => (current && !current.isDestroyed() ? current.window : undefined),
    isDestroyed: () => !current || current.isDestroyed(),
    isVisible: () => Boolean(current && !current.isDestroyed() && current.facade.isVisible()),
    show: () => current?.facade.show(),
    hide: () => current?.facade.hide(),
    showInactive: () => current?.facade.showInactive(),
    setAlwaysOnTop: flag => current?.facade.setAlwaysOnTop(flag),
    setBounds: bounds => current?.facade.setBounds(bounds),
    getBounds: () => (current && !current.isDestroyed() ? current.facade.getBounds() : undefined),
    on: (event, listener) => {
      const set = nativeListeners.get(event)!
      set.add(listener)
      return () => set.delete(listener)
    },
    removeListener: (event, listener) => {
      nativeListeners.get(event)?.delete(listener)
    },
    onWindowCreated: (listener) => {
      createdListeners.add(listener)
      return () => createdListeners.delete(listener)
    },
    onLifecycle: (event, listener) => {
      lifecycleListeners[event].add(listener)
      return () => lifecycleListeners[event].delete(listener)
    },
    capturePage: async () => null,
    destroy: () => {
      current?.close()
      current = undefined
    },
  }
}
