import type { Rectangle } from 'electrobun/main'
import type { BrowserWindow } from 'electron'
import type { InferOutput } from 'valibot'

import type { globalAppConfigSchema } from '../../configs/global'
import type { Config } from '../../libs/electron/persistence'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { ActorStageWindowManager } from '../stage'

import { createHash } from 'node:crypto'

import { defineInvokeHandler } from '@moeru/eventa'
import { Screen } from 'electrobun/main'
import { debounce, throttle } from 'es-toolkit'
import { boolean, number, object, optional, record, string } from 'valibot'

import { captionFollowStagePositionChanged, captionFollowStageVisibilityChanged, captionGetFollowStagePosition, captionGetFollowStageVisibility } from '../../../shared/eventa'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { showWindowOnAllWorkspaces } from '../shared/app-icon'
import { displayMatching, mapForBreakpoints, resolutionBreakpoints, widthFrom } from '../shared/display'
import { createConfig } from '../shared/persistence'
import { createPortedWindow } from '../shared/ported'

const captionConfigSchema = object({
  followStagePosition: boolean(),
  followStageVisibility: boolean(),
  matrices: record(string(), object({
    bounds: object({
      x: number(),
      y: number(),
      width: number(),
      height: number(),
    }),
    relativeToMain: optional(object({
      dx: number(),
      dy: number(),
    })),
  })),
})
type CaptionConfig = InferOutput<typeof captionConfigSchema>

function computeDisplayMatrixHash(): string {
  let displays: Array<{ bounds: Rectangle, scaleFactor?: number }> = []
  try {
    displays = Screen.getAllDisplays()
  }
  catch {
    return 'fallback'
  }
  const signature = displays
    .slice()
    .sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y))
    .map(d => [d.bounds.x, d.bounds.y, d.bounds.width, d.bounds.height, d.scaleFactor ?? 1].join(','))
    .join('|')
  return createHash('sha256').update(signature).digest('hex').slice(0, 16)
}

function clampBoundsWithinRect(bounds: Rectangle, rect: Rectangle): Rectangle {
  return {
    x: Math.min(Math.max(bounds.x, rect.x), rect.x + rect.width - bounds.width),
    y: Math.min(Math.max(bounds.y, rect.y), rect.y + rect.height - bounds.height),
    width: bounds.width,
    height: bounds.height,
  }
}

function resolveStageWindow(stageWindow?: BrowserWindow | ActorStageWindowManager | null): BrowserWindow | undefined {
  if (!stageWindow)
    return undefined
  if (typeof (stageWindow as ActorStageWindowManager).getExistingWindow === 'function')
    return (stageWindow as ActorStageWindowManager).getExistingWindow()
  return stageWindow as BrowserWindow
}

function stageBounds(stageWindow?: BrowserWindow | ActorStageWindowManager | null): Rectangle {
  const win = resolveStageWindow(stageWindow)
  const bounds = win?.isDestroyed() ? undefined : win?.getBounds()
  return {
    x: Number.isNaN(bounds?.x) ? 0 : bounds?.x ?? 0,
    y: Number.isNaN(bounds?.y) ? 0 : bounds?.y ?? 0,
    width: bounds?.width && !Number.isNaN(bounds.width) ? bounds.width : 450,
    height: bounds?.height && !Number.isNaN(bounds.height) ? bounds.height : 600,
  }
}

function computeInitialCaptionBounds(params: {
  stageWindow?: BrowserWindow | ActorStageWindowManager | null
  captionOptions?: Partial<Rectangle>
}): Rectangle {
  const main = stageBounds(params.stageWindow)
  const targetDisplay = displayMatching(main)
  const displayWorkArea = targetDisplay.workArea
  const width = mapForBreakpoints(displayWorkArea.width, {
    '720p': widthFrom(displayWorkArea, { percentage: 0.9, max: { actual: 560 }, min: { actual: 280 } }),
    '1080p': widthFrom(displayWorkArea, { percentage: 0.5, max: { actual: 640 }, min: { actual: 320 } }),
    '2k': widthFrom(displayWorkArea, { percentage: 0.4, max: { actual: 720 }, min: { actual: 360 } }),
    '4k': widthFrom(displayWorkArea, { percentage: 0.33, max: { actual: 768 }, min: { actual: 420 } }),
  }, { breakpoints: resolutionBreakpoints })
  const height = Math.max(Math.floor(width / 3.2), 120)
  const margin = 16
  let x = main.x + main.width + margin
  let y = main.y + main.height - height
  const displayRight = displayWorkArea.x + displayWorkArea.width
  if (x + width > displayRight)
    x = main.x - width - margin
  if (x < displayWorkArea.x || x + width > displayRight)
    x = displayWorkArea.x + Math.floor((displayWorkArea.width - width) / 2)
  if (y < displayWorkArea.y)
    y = displayWorkArea.y + margin
  return { ...clampBoundsWithinRect({ x, y, width, height }, displayWorkArea), ...params.captionOptions }
}

function calculateDockingBounds(win: BrowserWindow, stage: BrowserWindow | ActorStageWindowManager | null | undefined, dock?: 'top' | 'bottom'): Rectangle {
  const main = stageBounds(stage)
  const b = win.getBounds()
  const workArea = displayMatching(main).workArea
  const maxHeight = 240
  const dockInsideThreshold = 30
  const insideHeight = 80

  if (dock === 'bottom') {
    const spaceBottom = workArea.height - (main.y + main.height - workArea.y)
    if (spaceBottom >= maxHeight)
      return { x: main.x, y: Math.round(main.y + main.height), width: main.width, height: maxHeight }
    if (spaceBottom >= dockInsideThreshold)
      return { x: main.x, y: Math.round(main.y + main.height), width: main.width, height: Math.round(spaceBottom) }
    return { x: main.x, y: Math.round(main.y + main.height - insideHeight), width: main.width, height: insideHeight }
  }
  if (dock === 'top') {
    const spaceTop = main.y - workArea.y
    if (spaceTop >= maxHeight)
      return { x: main.x, y: Math.round(main.y - maxHeight), width: main.width, height: maxHeight }
    if (spaceTop >= dockInsideThreshold)
      return { x: main.x, y: Math.round(workArea.y), width: main.width, height: Math.round(spaceTop) }
    return { x: main.x, y: main.y, width: main.width, height: insideHeight }
  }
  return { x: main.x, y: main.y, width: b.width || 480, height: b.height || 180 }
}

export function setupCaptionWindowManager(params: {
  mainWindow: BrowserWindow
  stageWindow?: BrowserWindow | ActorStageWindowManager | null
  serverChannel: ServerChannel
  i18n: I18n
  appConfig: Config<typeof globalAppConfigSchema>
}) {
  void params.mainWindow
  const matrixHash = computeDisplayMatrixHash()
  const { setup, get: getConfigRaw, update: updateConfig } = createConfig('windows-caption', 'config.json', captionConfigSchema, {
    default: { followStagePosition: true, followStageVisibility: true, matrices: {} },
    autoHeal: true,
  })
  const getConfig = (): CaptionConfig => getConfigRaw() ?? { followStagePosition: true, followStageVisibility: true, matrices: {} }
  setup()

  let followStagePosition = getConfig().followStagePosition ?? true
  let followStageVisibility = getConfig().followStageVisibility ?? true
  let lastProgrammaticMoveAt = 0
  let lastTarget: Rectangle | undefined
  let triggerMoveInternal: (() => void) | undefined
  let detachFollow: (() => void) | undefined
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

  function syncGlobalConfig() {
    const appConfig = params.appConfig.get()
    const windows = appConfig?.windows ?? []
    const index = windows.findIndex(w => w.tag === 'caption')
    const entry = { tag: 'caption', enabled: Boolean(current && !current.isDestroyed() && current.facade.isVisible()) }
    if (index === -1)
      windows.push(entry)
    else
      windows[index] = { ...windows[index], ...entry }
    params.appConfig.update({
      ...appConfig,
      language: appConfig?.language ?? 'en',
      microphoneToggleHotkey: appConfig?.microphoneToggleHotkey ?? 'Scroll',
      windows,
    })
  }

  function computeRelativeOffset(win: BrowserWindow): { dx: number, dy: number } {
    const caption = win.getBounds()
    const main = stageBounds(params.stageWindow)
    let dx = caption.x - main.x
    let dy = caption.y - main.y
    if (Number.isNaN(dx) || Number.isNaN(dy)) {
      dx = 466
      dy = 420
    }
    return { dx, dy }
  }

  function applyBounds(win: BrowserWindow, bounds: Rectangle, options: { programmatic?: boolean } = {}) {
    if (win.isDestroyed())
      return
    const now = win.getBounds()
    if (Math.abs(now.x - bounds.x) < 1 && Math.abs(now.y - bounds.y) < 1 && Math.abs(now.width - bounds.width) < 1 && Math.abs(now.height - bounds.height) < 1)
      return
    if (options.programmatic)
      lastProgrammaticMoveAt = Date.now()
    win.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    })
  }

  function persistBounds() {
    if (!current || current.isDestroyed())
      return
    const config = getConfig()
    const b = current.facade.getBounds()
    config.matrices[matrixHash] = { ...config.matrices[matrixHash], bounds: b }
    config.followStagePosition = followStagePosition
    config.followStageVisibility = followStageVisibility
    if (followStagePosition && Date.now() - lastProgrammaticMoveAt > 100)
      config.matrices[matrixHash] = { ...config.matrices[matrixHash], bounds: b, relativeToMain: computeRelativeOffset(current.window) }
    updateConfig(config)
  }

  function followStageWindow(win: BrowserWindow) {
    detachFollow?.()
    const cfg = getConfig()
    const initialOffset = cfg.matrices?.[matrixHash]?.relativeToMain ?? computeRelativeOffset(win)
    const toSave = getConfig()
    toSave.matrices[matrixHash] = { ...toSave.matrices[matrixHash], relativeToMain: initialOffset }
    updateConfig(toSave)

    const syncNow = () => {
      if (win.isDestroyed())
        return
      const dock = params.appConfig.get()?.windows?.find(w => w.tag === 'caption')?.dock as 'top' | 'bottom' | undefined
      let target: Rectangle
      if (dock) {
        target = calculateDockingBounds(win, params.stageWindow, dock)
      }
      else {
        const stored = getConfig()?.matrices[matrixHash]?.relativeToMain ?? initialOffset
        const main = stageBounds(params.stageWindow)
        const b = win.getBounds()
        const dx = stored?.dx ?? main.width + 16
        const dy = stored?.dy ?? main.height - b.height
        target = { x: main.x + dx, y: main.y + dy, width: b.width || 480, height: b.height || 180 }
      }
      const clamped = clampBoundsWithinRect(target, displayMatching(target).workArea)
      if (lastTarget && Math.abs(lastTarget.x - clamped.x) < 1 && Math.abs(lastTarget.y - clamped.y) < 1 && Math.abs(lastTarget.width - clamped.width) < 1 && Math.abs(lastTarget.height - clamped.height) < 1)
        return
      lastTarget = clamped
      applyBounds(win, clamped, { programmatic: true })
    }

    const moveThrottled = throttle(syncNow, 1000 / 60)
    const settleDebounced = debounce(() => {
      if (lastTarget)
        applyBounds(win, lastTarget, { programmatic: true })
    }, 200)
    const onMainChange = () => {
      moveThrottled()
      settleDebounced()
    }
    triggerMoveInternal = () => {
      syncNow()
      onMainChange()
    }
    onMainChange()

    const stage = params.stageWindow as ActorStageWindowManager | undefined
    if (stage && typeof stage.on === 'function') {
      const offMove = stage.on('move', onMainChange)
      const offResize = stage.on('resize', onMainChange)
      detachFollow = () => {
        moveThrottled.cancel()
        settleDebounced.cancel()
        offMove()
        offResize()
        triggerMoveInternal = undefined
        detachFollow = undefined
      }
    }
    else {
      detachFollow = () => {
        moveThrottled.cancel()
        settleDebounced.cancel()
        triggerMoveInternal = undefined
        detachFollow = undefined
      }
    }
    onAppBeforeQuit(() => detachFollow?.())
  }

  function detachFromMain() {
    detachFollow?.()
  }

  // Re-attach position-follow when a lazily-created stage appears later.
  const stageManager = params.stageWindow as ActorStageWindowManager | undefined
  stageManager?.onWindowCreated(() => {
    if (followStagePosition && current && !current.isDestroyed())
      followStageWindow(current.window)
  })

  async function ensureWindow() {
    if (current && !current.isDestroyed())
      return current
    current = await createPortedWindow({
      tag: 'caption',
      title: 'AIRI — Caption',
      width: 480,
      height: 180,
      route: '/caption',
      transparent: true,
      passthrough: true,
      alwaysOnTop: true,
      setupBase: { i18n: params.i18n, serverChannel: params.serverChannel },
    })
    showWindowOnAllWorkspaces(current.native)
    const win = current.window

    const saved = getConfig().matrices?.[matrixHash]?.bounds
    if (saved)
      win.setBounds(clampBoundsWithinRect(saved, displayMatching(saved).workArea))
    else
      win.setBounds(computeInitialCaptionBounds({ stageWindow: params.stageWindow }))

    win.on('resize', persistBounds)
    win.on('move', persistBounds)
    win.on('show', () => {
      emitVisibilityChanged()
      syncGlobalConfig()
    })
    win.on('hide', () => {
      emitVisibilityChanged()
      syncGlobalConfig()
    })
    win.on('close', () => {
      detachFromMain()
      emitVisibilityChanged()
      if (current?.isDestroyed())
        current = undefined
    })

    defineInvokeHandler(current.context, captionGetFollowStagePosition, async () => followStagePosition)
    defineInvokeHandler(current.context, captionGetFollowStageVisibility, async () => followStageVisibility)
    try {
      current.context.emit(captionFollowStagePositionChanged, followStagePosition)
      current.context.emit(captionFollowStageVisibilityChanged, followStageVisibility)
    }
    catch {}
    if (followStagePosition)
      followStageWindow(win)
    return current
  }

  function isVisible(): boolean {
    return Boolean(current && !current.isDestroyed() && current.facade.isVisible())
  }

  return {
    getWindow: async () => (await ensureWindow()).window,
    hasWindow: () => Boolean(current && !current.isDestroyed()),
    setFollowStagePosition: async (shouldFollow: boolean) => {
      followStagePosition = shouldFollow
      if (shouldFollow && current && !current.isDestroyed())
        followStageWindow(current.window)
      else
        detachFromMain()
      const config = getConfig()
      config.followStagePosition = followStagePosition
      updateConfig(config)
      try {
        current?.context.emit(captionFollowStagePositionChanged, followStagePosition)
      }
      catch {}
      syncGlobalConfig()
    },
    setFollowStageVisibility: async (shouldFollow: boolean) => {
      followStageVisibility = shouldFollow
      const config = getConfig()
      config.followStageVisibility = followStageVisibility
      updateConfig(config)
      try {
        current?.context.emit(captionFollowStageVisibilityChanged, followStageVisibility)
      }
      catch {}
    },
    getIsFollowingStagePosition: () => followStagePosition,
    getIsFollowingStageVisibility: () => followStageVisibility,
    resetToSide: async () => {
      if (!current || current.isDestroyed())
        return
      lastProgrammaticMoveAt = Date.now()
      current.window.setBounds(computeInitialCaptionBounds({ stageWindow: params.stageWindow }))
      persistBounds()
    },
    isVisible,
    toggleVisibility: async (enabled?: boolean) => {
      if (enabled === false || (enabled === undefined && isVisible())) {
        current?.close()
        return
      }
      const ported = await ensureWindow()
      ported.facade.show()
      ported.facade.focus()
    },
    onVisibilityChanged: (listener: () => void) => {
      visibilityListeners.add(listener)
      return () => visibilityListeners.delete(listener)
    },
    triggerMove: async (forcedDock?: 'top' | 'bottom') => {
      if (!current || current.isDestroyed())
        return
      const ported = current
      if (triggerMoveInternal) {
        triggerMoveInternal()
        return
      }
      const dock = forcedDock || (params.appConfig.get()?.windows?.find(w => w.tag === 'caption')?.dock as 'top' | 'bottom' | undefined)
      if (dock) {
        const target = calculateDockingBounds(ported.window, params.stageWindow, dock)
        applyBounds(ported.window, clampBoundsWithinRect(target, displayMatching(target).workArea), { programmatic: true })
      }
    },
  }
}
